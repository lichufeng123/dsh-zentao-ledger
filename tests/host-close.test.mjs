import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { ZenTaoApi } from '../src/host/api.mjs'
import { ZenTaoSession } from '../src/host/session.mjs'

function fixture({ tid = 'tabA1234', formAction, formHtml, ajaxFormHtml, status = 'resolved', post = 'success', upload = 'success', readbackDelay = 0, closeBeforePlain = false } = {}) {
    const identity = { origin: 'https://zentao.example', account: 'tester', userId: '8', tid, token: 'never-return-this' }
    const bug = { id: '42', title: '已经解决的单条问题', status, closedBy: '', closedDate: '' }
    const actions = [{ id: '10', action: 'resolved', actor: 'dev' }]
    const calls = []
    let posts = 0, uploads = 0, remainingStaleReads = readbackDelay, pendingComment = null, plainClosed = false
    const finish = (comment = '') => {
        bug.status = 'closed'; bug.closedBy = identity.account; bug.closedDate = '2026-11-06 09:00:00'
        actions.push({ id: '11', action: 'closed', actor: identity.account, comment })
    }
    const session = {
        context: async () => identity,
        json: async path => {
            calls.push({ method: 'GET_JSON', path })
            if (path !== '/bug-view-42.json') throw Error('unexpected GET')
            if (pendingComment !== null && remainingStaleReads <= 0) { const value = pendingComment; pendingComment = null; finish(value) }
            const response = { status: 'success', data: JSON.stringify({ bug, actions }) }
            if (pendingComment !== null && remainingStaleReads > 0) remainingStaleReads--
            return response
        },
        send: async (state, url, options = {}) => {
            assert.equal(state, identity)
            calls.push({ method: options.method || 'GET', url: url.href, ...(options.method === 'POST' ? { options } : {}) })
            if (url.pathname === '/api.php/v1/user') return new Response(JSON.stringify({ profile: { id: identity.userId, account: identity.account } }), { headers: { 'content-type': 'application/json' } })
            if (url.pathname === '/api.php/v1/files') {
                uploads++
                if (upload === 'rejected') return new Response('', { status: 403 })
                return new Response(JSON.stringify({ id: 901, url: '/file-read-901.png' }), { headers: { 'content-type': 'application/json' } })
            }
            if (options.method !== 'POST') {
                if (closeBeforePlain && !options.headers?.['x-requested-with'] && !plainClosed) { finish(); plainClosed = true }
                return new Response(options.headers?.['x-requested-with'] && ajaxFormHtml !== undefined ? ajaxFormHtml :
                    formHtml ?? `<form method="post"${formAction === undefined ? '' : ` action="${formAction}"`}><input type="hidden" name="status" value="closed"><input type="hidden" name="uid" value="serverUid-42"><textarea name="comment"></textarea></form>`)
            }
            posts++
            const submittedComment = new URLSearchParams(options.body).get('comment') || ''
            if (post === 'success' || post === 'transportCommitted' || post === 'rejectedCommitted') {
                if (readbackDelay > 0) pendingComment = submittedComment
                else finish(submittedComment)
            }
            if (post === 'transportCommitted' || post === 'transportFailed') throw Error('network-with-secret-never-return-this')
            return new Response('', { status: post === 'rejectedCommitted' ? 403 : 200 })
        }
    }
    return { api: new ZenTaoApi({ session }), identity, bug, actions, calls, finish, get posts() { return posts }, get uploads() { return uploads } }
}
const confirmation = { action: 'closeBug', id: '42', title: '已经解决的单条问题', status: 'resolved', account: 'tester', userId: '8' }
const close = (api, confirmed = confirmation) => api.closeResolvedBug({ bugId: '42', confirmation: confirmed, comment: '验收通过' })

test('verified Host session retains its random tid and rotates it with the grant', async () => {
    let token = 'first-grant'
    const session = new ZenTaoSession({
        getCredential: async () => ({ origin: 'https://zentao.example', account: 'tester', userId: '8', binding: 'same-owner', token }),
        transport: async url => {
            if (new URL(url).pathname === '/user-login.html') return new Response('', { headers: { 'set-cookie': 'sid=safe; Path=/' } })
            return new Response(JSON.stringify({ status: 'success', data: JSON.stringify({ user: { id: '8', account: 'tester' } }) }))
        }
    })
    const first = await session.context()
    assert.match(first.tid, /^[0-9a-f]{8}$/)
    assert.equal((await session.context()).tid, first.tid)
    token = 'second-grant'
    const second = await session.context()
    assert.match(second.tid, /^[0-9a-f]{8}$/)
    assert.notEqual(second.tid, first.tid)
})

for (const [name, override] of [
    ['missing', null], ['wrong account', { ...confirmation, account: 'someone-else' }],
    ['wrong title', { ...confirmation, title: '另一个 Bug' }],
    ['wrong id', { ...confirmation, id: '41' }],
    ['wrong user id', { ...confirmation, userId: '9' }],
    ['not an explicit close action', { ...confirmation, action: 'editBug' }]
]) test(`close rejects ${name} confirmation before any POST`, async () => {
    const f = fixture()
    await assert.rejects(close(f.api, override), error => error.code === 'confirmationMismatch')
    assert.equal(f.posts, 0)
    assert.ok(f.calls.every(call => call.method !== 'POST'))
})

test('stale resolved UI reconciles a close already owned by the current account', async () => {
    const f = fixture()
    f.finish()
    const receipt = await close(f.api)
    assert.equal(receipt.status, 'closed')
    assert.equal(receipt.reconciled, true)
    assert.equal(receipt.actionId, '11')
    assert.equal(f.posts, 0)
    assert.ok(!f.calls.some(call => call.method === 'GET' && call.url.includes('bug-close-42')))
})

test('only a currently resolved Bug may be closed', async () => {
    for (const status of ['active', 'closed']) {
        const f = fixture({ status })
        await assert.rejects(close(f.api), error => error.code === 'invalidBugStatus')
        assert.equal(f.posts, 0)
        assert.ok(!f.calls.some(call => call.method === 'GET' && call.url.includes('bug-close-42')))
    }
})

test('closing uses the current form tid, one POST, and a fresh closed action receipt', async () => {
    for (const tid of ['tabA1234', 'tabB9876']) {
        const f = fixture({ tid })
        const receipt = await close(f.api)
        assert.deepEqual(receipt, { id: '42', title: confirmation.title, status: 'closed', closedBy: 'tester', actionId: '11', closedDate: '2026-11-06 09:00:00' })
        assert.equal(f.posts, 1)
        const write = f.calls.find(call => call.method === 'POST')
        assert.equal(new URL(write.url).searchParams.get('tid'), tid)
        assert.equal(new URL(write.url).searchParams.get('onlybody'), 'yes')
        assert.equal(new URL(write.url).pathname, '/bug-close-42.html')
        const fields = new URLSearchParams(write.options.body)
        assert.equal(fields.get('status'), 'closed')
        assert.equal(fields.get('comment'), '验收通过')
        assert.equal(fields.get('uid'), 'serverUid-42')
        assert.equal(write.options.headers['x-requested-with'], 'XMLHttpRequest')
        const formGet = f.calls.find(call => call.method === 'GET')
        assert.equal(new URL(formGet.url).searchParams.get('tid'), tid)
        assert.equal(formGet.url, write.url)
        assert.equal(f.calls.filter(call => call.method === 'GET').length, 1)
        assert.ok(f.calls.filter(call => call.path === '/bug-view-42.json').length >= 2)
        assert.ok(!JSON.stringify(receipt).includes(f.identity.token))
        await assert.rejects(close(f.api), error => error.code === 'writeLocked')
        assert.equal(f.posts, 1)
    }
})

for (const action of [
    '/bug-close-42.html',
    '/bug-close-42.html?onlybody=yes',
    '/bug-close-42.html?tid=tabA1234',
    '/bug-close-42.html?onlybody=yes&tid=tabA1234'
]) test(`safe close form action may omit transport query fields: ${action}`, async () => {
    const f = fixture({ formAction: action })
    assert.equal((await close(f.api)).status, 'closed')
    assert.equal(f.posts, 1)
})

test('current close form without uid sends one close POST and omits uid', async () => {
    const formHtml = '<form method="post" action="/bug-close-42.html?onlybody=yes&tid=tabA1234"><input type="hidden" name="status" value="closed"><textarea name="comment"></textarea><button type="submit">关闭</button></form>'
    const f = fixture({ formHtml })
    assert.equal((await close(f.api)).status, 'closed')
    assert.equal(f.posts, 1)
    const write = f.calls.find(call => call.method === 'POST')
    const fields = new URLSearchParams(write.options.body)
    assert.equal(fields.get('status'), 'closed')
    assert.equal(fields.get('comment'), '验收通过')
    assert.equal(fields.has('uid'), false)
})

test('repeated close forms are ambiguous and block POST', async () => {
    const form = '<form method="POST" action="/bug-close-42.html"><input type="hidden" name="STATUS" value="CLOSED"><input type="hidden" name="UID" value="sameUid-42"><textarea name="COMMENT"></textarea></FORM>'
    const f = fixture({ formHtml: form + form })
    await assert.rejects(close(f.api), error => error.code === 'closeFormUnavailable')
    assert.equal(f.posts, 0)
})

test('delayed close history is reconciled by bounded GET-only polling without a second POST', async () => {
    const f = fixture({ readbackDelay: 1 })
    const receipt = await close(f.api)
    assert.equal(receipt.status, 'closed')
    assert.equal(receipt.actionId, '11')
    assert.equal(f.posts, 1)
    assert.ok(f.calls.filter(call => call.method === 'GET_JSON').length >= 3)
})

test('disappearing close form reconciles an already committed close without POST', async () => {
    const f = fixture({ ajaxFormHtml: '<div>stale shell</div>', formHtml: '<div>already closed</div>', closeBeforePlain: true })
    const receipt = await close(f.api)
    assert.equal(receipt.status, 'closed')
    assert.equal(receipt.actionId, '11')
    assert.equal(receipt.reconciled, true)
    assert.equal(f.posts, 0)
})

test('invalid AJAX fragment falls back to one strict read-only full-form GET before POST', async () => {
    const f = fixture({ ajaxFormHtml: '<div>modal shell only</div>' })
    assert.equal((await close(f.api)).status, 'closed')
    assert.equal(f.calls.filter(call => call.method === 'GET').length, 2)
    assert.equal(f.posts, 1)
})

for (const action of [
    '/bug-close-41.html?onlybody=yes&tid=tabA1234',
    'https://evil.invalid/bug-close-42.html?onlybody=yes&tid=tabA1234',
    '/bug-close-42.html?onlybody=no&tid=tabA1234',
    '/bug-close-42.html?onlybody=yes&tid=anotherTab',
    '/bug-close-42.html?onlybody=yes&tid=tabA1234&token=secret'
]) test(`unsafe close form action blocks POST: ${action}`, async () => {
    const f = fixture({ formAction: action })
    await assert.rejects(close(f.api), error => error.code === 'closeFormUnavailable')
    assert.equal(f.posts, 0)
})

for (const formHtml of [
    '<html><body>ZenTao shell</body></html>',
    '<form method="get"><input type="hidden" name="status" value="closed"><input type="hidden" name="uid" value="serverUid-42"></form>',
    '<form method="post"><input type="hidden" name="status" value="active"><input type="hidden" name="uid" value="serverUid-42"></form>',
    '<form method="post"><input type="hidden" name="status" value="closed"></form>'
]) test('invalid close form blocks POST', async () => {
    const f = fixture({ formHtml })
    await assert.rejects(close(f.api), error => error.code === 'closeFormUnavailable')
    assert.equal(f.posts, 0)
})

test('current Host session must provide a valid tid before close form GET', async () => {
    const f = fixture({ tid: '' })
    await assert.rejects(close(f.api), error => error.code === 'closeFormUnavailable')
    assert.equal(f.posts, 0)
    assert.ok(!f.calls.some(call => call.method === 'GET'))
})

test('transport uncertainty reconciles with GET and does not resend the POST', async () => {
    const f = fixture({ post: 'transportCommitted' })
    const receipt = await close(f.api)
    assert.equal(receipt.status, 'closed')
    assert.equal(f.posts, 1)
    assert.equal((await f.api.reconcileClosedBug({ bugId: '42' })).actionId, '11')
    await assert.rejects(close(f.api), error => error.code === 'writeLocked')
    assert.equal(f.posts, 1)
})

test('unconfirmed transport outcome stays locked while reconcile is read-only', async () => {
    const f = fixture({ post: 'transportFailed' })
    await assert.rejects(close(f.api), error => error.code === 'writeUnknown')
    await assert.rejects(f.api.reconcileClosedBug({ bugId: '42' }), error => error.code === 'readbackMismatch')
    await assert.rejects(close(f.api), error => error.code === 'writeLocked')
    assert.equal(f.posts, 1)
    f.finish() // Simulates a delayed server commit; no second POST.
    const receipt = await f.api.reconcileClosedBug({ bugId: '42' })
    assert.equal(receipt.actionId, '11')
    assert.equal(f.posts, 1)
})

test('close uploads acceptance screenshots with a generated uid even when the form omits uid', async () => {
    const formHtml = '<form method="post"><input type="hidden" name="status" value="closed"><textarea name="comment"></textarea><button type="submit">关闭</button></form>'
    const f = fixture({ formHtml })
    const media = [{ kind: 'image', name: '验收通过.png', type: 'image/png', bytes: Buffer.from([137, 80, 78, 71]), size: 4 }]
    const receipt = await f.api.closeResolvedBug({ bugId: '42', confirmation, comment: '验收通过', media })
    assert.equal(receipt.status, 'closed')
    assert.equal(f.uploads, 1)
    assert.equal(f.posts, 1)
    const uploadCall = f.calls.find(call => String(call.url || '').includes('/api.php/v1/files'))
    const uploadUid = new URL(uploadCall.url).searchParams.get('uid')
    assert.match(uploadUid, /^ds[0-9a-f]{24}$/)
    assert.notEqual(uploadUid, 'serverUid-42', 'media uid must be generated independently of optional close-form uid')
    const closeCall = f.calls.find(call => call.method === 'POST' && String(call.url || '').includes('/bug-close-42.html'))
    const submitted = new URLSearchParams(closeCall.options.body)
    assert.equal(submitted.get('uid'), uploadUid, 'close POST must bind the same uid used by file upload')
    assert.match(submitted.get('comment'), /验收通过<h3>验收截图<\/h3>/)
    assert.match(submitted.get('comment'), /file-read-901\.png/)
    assert.match(f.actions.at(-1).comment, /file-read-901\.png/)
})

test('Cookie authentication refuses REST screenshot upload before any media or close POST', async () => {
    const f = fixture()
    f.identity.authMode = 'cookie'
    f.identity.token = 'sid=synthetic'
    const media = [{ kind: 'image', name: 'demo.png', type: 'image/png', bytes: Buffer.from([137, 80, 78, 71]), size: 4 }]
    await assert.rejects(f.api.closeResolvedBug({ bugId: '42', confirmation, media }), { code: 'mediaAuthUnavailable' })
    assert.equal(f.uploads, 0)
    assert.equal(f.posts, 0)
    assert.equal(f.calls.some(call => String(call.url || '').includes('/api.php/')), false)
    assert.equal((await close(f.api)).status, 'closed')
    assert.equal(f.posts, 1)
})

test('definite screenshot rejection sends no close POST and permits corrected retry', async () => {
    const f = fixture({ upload: 'rejected' })
    const media = [{ kind: 'image', name: '验收失败.png', type: 'image/png', bytes: Buffer.from([137, 80, 78, 71]), size: 4 }]
    await assert.rejects(f.api.closeResolvedBug({ bugId: '42', confirmation, media }), error => error.code === 'mediaUploadFailed')
    assert.equal(f.uploads, 1)
    assert.equal(f.posts, 0)
    assert.equal((await close(f.api)).status, 'closed')
    assert.equal(f.posts, 1)
})

test('HTTP rejection with a committed close is judged from readback, not status alone', async () => {
    const f = fixture({ post: 'rejectedCommitted' })
    assert.equal((await close(f.api)).status, 'closed')
    assert.equal(f.posts, 1)
})

test('readback requires a new close action by the verified account', async () => {
    const f = fixture({ post: 'success' })
    const original = f.api.details.bind(f.api)
    let calls = 0
    f.api.details = async id => {
        const detail = await original(id)
        if (++calls > 1) detail.actions[1].actor = 'other-user'
        return detail
    }
    await assert.rejects(close(f.api), error => error.code === 'writeUnknown')
    assert.equal(f.posts, 1)
    await assert.rejects(f.api.reconcileClosedBug({ bugId: '42' }), error => error.code === 'readbackMismatch')
    assert.equal(f.posts, 1)
})
