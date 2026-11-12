import test from 'node:test'
import assert from 'node:assert/strict'
import { ZenTaoSession, discoverCredential } from '../src/host/session.mjs'
import { ZenTaoApi } from '../src/host/api.mjs'

const origin = 'https://zentao.example'
const credentials = (overrides = {}) => ({ origin, binding: 'workspace-A', account: 'alice', userId: '7', token: 'top-secret', ...overrides })
const json = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', ...init.headers }, ...init })
const route = (handler, credential = credentials()) => {
    const calls = []
    const session = new ZenTaoSession({ credentials: async () => credential, transport: async (url, options) => {
        calls.push({ url, options })
        const path = new URL(url).pathname
        if (path === '/user-login.html') return json({}, { headers: { 'set-cookie': `sid=${credential.account}` } })
        if (path === '/my-profile.json') return json({ data: JSON.stringify({ user: { account: credential.account, id: credential.userId } }), result: 'success' })
        return handler(path, options, url)
    } })
    return { calls, session, api: new ZenTaoApi({ session, productId: '1' }) }
}

const form = (mode = 'create') => ({
    mode, id: mode === 'edit' ? '42' : '',
    data: { products: { 1: 'Product' }, builds: { 2: 'Build' }, openedBuilds: { 2: 'Build' }, productMembers: { bob: 'Bob' }, users: { bob: 'Bob' } },
    raw: mode === 'edit' ? { id: '42', lastEditedDate: '2026-01-01', steps: 'before' } : {},
    fields: { product: '1', branch: '0', module: '0', project: '0', execution: '0', title: 'A bug', assignedTo: 'bob', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: ['2'], descriptionAction: 'keep', description: '', comment: '' },
})
const bug = (id = '42') => ({ id, product: '1', branch: '0', module: '0', project: '0', execution: '0', title: 'A bug', assignedTo: 'bob', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: ['2'] })

test('token exchange, identity, cookies, and GET reuse remain in host memory', async () => {
    const { api, calls } = route(() => json({ result: 'success', data: JSON.stringify({ bug: bug() }) }))
    assert.equal((await api.profile()).account, 'alice')
    assert.equal((await api.details('42')).bug.id, '42')
    assert.equal(calls.filter((call) => call.url.includes('token=')).length, 1)
    assert.equal(calls[1].options.headers.get('cookie'), 'sid=alice')
    assert.equal(calls[2].options.headers.get('cookie'), 'sid=alice')
    assert.deepEqual(await api.profile(), { origin, account: 'alice', userId: '7' })
    assert.equal(calls.length, 3)
})

test('product-1 requirements list uses authenticated GET pagination and validates ownership', async () => {
    const entry = { id: 1302, product: '1', type: 'story', title: '需求标题', deleted: '0', status: 'active', pri: '2', openedBy: 'alice' }
    const { api, calls } = route(path => {
        assert.equal(path, '/api.php/v1/products/1/stories')
        return json({ page: 1, limit: 20, total: 21, stories: [entry], requirements: [] })
    })
    const page = await api.listStories({ page: 1 })
    assert.deepEqual({ product: page.product, total: page.total, pages: page.pages, title: page.stories[0].title },
        { product: '1', total: 21, pages: 2, title: '需求标题' })
    entry.deleted = true
    assert.equal((await api.listStories({ page: 1 })).stories.length, 0)
    entry.deleted = '0'
    assert.equal(calls.at(-1).options.method, 'GET')
    assert.equal(new URL(calls.at(-1).url).searchParams.get('page'), '1')
    await assert.rejects(api.listStories({ page: 0 }), /invalidPagination/)
    await assert.rejects(api.listStories({ page: 501 }), /invalidPagination/)
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/api.php/v1/products/1/stories').length, 2)
    entry.product = '2'
    await assert.rejects(api.listStories({ page: 1 }), /invalidStoryList/)
})

test('expired cookie reauthenticates once for GET without replaying writes', async () => {
    let reads = 0
    const { api, calls } = route(path => path === '/bug-view-42.json'
        ? ++reads === 1 ? json({ loginExpired: true }) : json({ result: 'success', data: JSON.stringify({ bug: bug() }) })
        : json({}))
    assert.equal((await api.details('42')).bug.id, '42')
    assert.equal(reads, 2)
    assert.equal(calls.filter(call => new URL(call.url).pathname === '/user-login.html').length, 2)
    assert.equal(calls.some(call => call.options.method === 'POST'), false)
})

test('token-only discovery returns verified identity without exposing secret', async () => {
    const seen = []
    const identity = await discoverCredential('hidden-token', async (url, init) => {
        seen.push({ url, cookie: init.headers.get('cookie') })
        if (new URL(url).pathname === '/user-login.html') return json({}, { headers: { 'set-cookie': 'sid=onboard' } })
        return json({ result: 'success', data: JSON.stringify({ user: { account: 'alice', id: '7' } }) })
    }, origin, 'token')
    assert.deepEqual(identity, { origin, account: 'alice', userId: '7' })
    assert.equal(seen[0].url, 'https://zentao.example/user-login.html?token=hidden-token')
    assert.equal(seen[1].cookie, 'sid=onboard')
    await assert.rejects(discoverCredential('wrong', async (url) => new URL(url).pathname === '/my-profile.json' ? json({ user: { account: 'x' } }) : json({}), origin, 'token'), { code: 'identityMismatch' })
})

test('getCredential alias supports host-supplied secret callback', async () => {
    const { session } = route(() => json({}))
    const adapter = new ZenTaoSession({ getCredential: async () => credentials(), transport: session.transport })
    assert.equal((await adapter.context()).account, 'alice')
})

test('identity mismatch prevents any business request', async () => {
    const calls = []
    const session = new ZenTaoSession({ credentials: async () => credentials(), transport: async (url) => {
        calls.push(new URL(url).pathname)
        return calls.length === 1 ? json({}) : json({ user: { account: 'mallory', id: '7' } })
    } })
    await assert.rejects(session.json('/bug-view-42.json'), { code: 'identityMismatch' })
    assert.deepEqual(calls, ['/user-login.html', '/my-profile.json'])
})

test('bindings and account switches never reuse cookies', async () => {
    let active = credentials()
    const seen = []
    const session = new ZenTaoSession({ credentials: async () => active, transport: async (url, init) => {
        const path = new URL(url).pathname
        seen.push([active.account, path, init.headers.get('cookie')])
        if (path === '/user-login.html') return json({}, { headers: { 'set-cookie': `sid=${active.account}` } })
        if (path === '/my-profile.json') return json({ user: { account: active.account, id: active.userId } })
        return json({ ok: true })
    } })
    await session.json('/one.json')
    active = credentials({ account: 'bob', userId: '8' })
    await session.json('/two.json')
    active = credentials()
    await session.json('/three.json')
    assert.deepEqual(seen.filter(([, path]) => path === '/user-login.html').map(([account]) => account), ['alice', 'bob'])
    assert.equal(seen.find(([account, path]) => account === 'bob' && path === '/user-login.html')[2], null)
    assert.equal(seen.at(-1)[2], 'sid=alice')
})

test('redirects reject a foreign origin and never forward cookies', async () => {
    const { session, calls } = route(() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/steal' } }))
    await assert.rejects(session.json('/route.json'), { code: 'crossOriginRedirect' })
    assert.equal(calls.length, 3)
    await assert.rejects(session.image('https://elsewhere.example/p.png'), { code: 'invalidPath' })
})

test('same-origin redirects keep session; hung transport has bounded timeout', async () => {
    const { session, calls } = route((path) => path === '/old.json' ? new Response(null, { status: 302, headers: { location: '/new.json' } }) : json({ value: 1 }))
    assert.deepEqual(await session.json('/old.json'), { value: 1 })
    assert.equal(calls.at(-1).options.headers.get('cookie'), 'sid=alice')
    const timed = new ZenTaoSession({ credentials: async () => credentials(), timeoutMs: 5, transport: () => new Promise(() => {}) })
    await assert.rejects(timed.json('/any.json'), { code: 'timeout' })
})

test('list status searches later pages; board scans all pages and groups active bugs', async () => {
    const { api } = route((path) => {
        if (path.includes('user-bug-7')) {
            const page = Number(path.match(/-(\d+)\.json$/)[1])
            return json({ result: 'success', data: JSON.stringify({ bugs: page === 1 ? { 1: { ...bug('1'), pri: '2', status: 'resolved', openedDate: '2026-01-01' } } : { 2: { ...bug('2'), pri: '1', status: 'active', openedDate: '2026-01-02' } }, users: { bob: 'Bob' }, products: { 1: 'Product' }, userList: '<option value="7" data-keys="alice">Alice</option><option value="8">Bob</option>', pager: { pageID: page, pageTotal: 2, recTotal: 2 } }) })
        }
        throw new Error('unexpected route')
    })
    const page = await api.listReports({ status: 'active' })
    assert.equal(page.page, 2)
    assert.deepEqual(page.bugs.map((item) => item.id), ['2'])
    assert.deepEqual(page.members, [{ id: '7', name: 'Alice', keys: 'alice' }, { id: '8', name: 'Bob', keys: '' }])
    assert.deepEqual(page.bugs[0].assignedTo, 'Bob')
    assert.deepEqual(page.bugs[0].assignedAccount, 'bob')
    assert.deepEqual(page.bugs[0].product, 'Product')
    assert.equal(page.bugs[0].priority, '1')
    assert.deepEqual((await api.unresolvedBoard()).flatMap((group) => group.bugs.map((item) => item.id)), ['2'])
})

test('metadata, members and creator builds reuse shared parsers', async () => {
    const { api } = route((path) => {
        if (path === '/user-bug-0-assignedTo-id_desc-0-1-1.json') return json({ data: { userList: '<option value="7" data-keys="alice">Alice</option><option value="8">Bob</option>' } })
        if (path === '/project-build-0-all-0-id_desc-0-1000-1.json') return json({ data: { users: { alice: 'Alice' }, projectBuilds: { group: [{ id: '2', createdBy: 'alice' }] }, buildsTotal: 1 } })
        if (path.startsWith('/bug-create-')) return json({ data: { products: { 1: 'Product' }, productMembers: { bob: 'Bob' } } })
        if (path === '/bug-edit-42.json') return json({ bug: { id: '42', lastEditedDate: '2026-01-01', title: 'A bug' }, openedBuilds: { 2: 'Build' } })
        throw new Error('unexpected')
    })
    assert.deepEqual(await api.listMembers(), [{ id: '7', name: 'Alice', keys: 'alice' }, { id: '8', name: 'Bob', keys: '' }])
    assert.deepEqual(await api.creatorBuilds('1', 'Alice'), { ids: ['2'], total: 1 })
    assert.equal((await api.editor('edit', {}, '42')).fields.title, 'A bug')
})

const png = (width, height) => {
    const bytes = new Uint8Array(24)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return bytes
}
const jpeg = (width, height) => {
    const bytes = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0])
    new DataView(bytes.buffer).setUint16(7, height)
    new DataView(bytes.buffer).setUint16(9, width)
    return bytes
}
const gif = (width, height) => {
    const bytes = new Uint8Array([71, 73, 70, 56, 57, 97, 0, 0, 0, 0])
    new DataView(bytes.buffer).setUint16(6, width, true)
    new DataView(bytes.buffer).setUint16(8, height, true)
    return bytes
}
const webp = (width, height) => {
    const bytes = new Uint8Array(30)
    bytes.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88])
    const dimension = (index, value) => { bytes[index] = (value - 1) & 255; bytes[index + 1] = ((value - 1) >> 8) & 255; bytes[index + 2] = ((value - 1) >> 16) & 255 }
    dimension(24, width)
    dimension(27, height)
    return bytes
}

test('image validates safe dimensions across PNG, JPEG, GIF, and WebP', async () => {
    const fixtures = { '/image.png': [png(3308, 1702), 'image/png'], '/image.jpg': [jpeg(640, 480), 'image/jpeg'], '/image-alias.jpg': [jpeg(480, 320), 'image/jpg'], '/image.gif': [gif(320, 240), 'image/gif'], '/image.webp': [webp(1024, 768), 'image/webp'] }
    const { api } = route((path) => fixtures[path] ? new Response(fixtures[path][0], { headers: { 'content-type': fixtures[path][1] } }) : json({}))
    assert.deepEqual([(await api.image('/image.png')).width, (await api.image('/image.png')).height], [3308, 1702])
    assert.deepEqual([(await api.image('/image.jpg')).width, (await api.image('/image.jpg')).height], [640, 480])
    const alias = await api.image('/image-alias.jpg')
    assert.deepEqual([alias.width, alias.height, alias.contentType], [480, 320, 'image/jpeg'])
    assert.deepEqual([(await api.image('/image.gif')).width, (await api.image('/image.gif')).height], [320, 240])
    assert.deepEqual([(await api.image('/image.webp')).width, (await api.image('/image.webp')).height], [1024, 768])
    await assert.rejects(api.image('/bad.json'), { code: 'invalidImage' })
})

test('image rejects malicious dimensions, oversized headers and oversized stream', async () => {
    const fixtures = { '/wide.png': [png(8193, 1), 'image/png'], '/pixels.png': [png(8192, 8192), 'image/png'], '/wide.jpg': [jpeg(8193, 1), 'image/jpeg'], '/wide.gif': [gif(8193, 1), 'image/gif'], '/wide.webp': [webp(8193, 1), 'image/webp'], '/lie.png': [new TextEncoder().encode('<script>'), 'image/png'] }
    let oversizedRead = false
    const { api } = route((path) => {
        if (path === '/length.png') return new Response(png(1, 1), { headers: { 'content-type': 'image/png', 'content-length': String(10 * 1024 * 1024 + 1) } })
        if (path === '/stream.png') {
            let remaining = 11
            return new Response(new ReadableStream({ pull(controller) {
                oversizedRead = true
                if (remaining--) controller.enqueue(new Uint8Array(1024 * 1024))
                else controller.close()
            } }), { headers: { 'content-type': 'image/png' } })
        }
        return fixtures[path] ? new Response(fixtures[path][0], { headers: { 'content-type': fixtures[path][1] } }) : json({})
    })
    for (const path of [...Object.keys(fixtures), '/length.png', '/stream.png']) await assert.rejects(api.image(path), { code: 'invalidImage' })
    assert.equal(oversizedRead, true)
})

test('confirmation blocks POST, one successful POST is read back by GET', async () => {
    const editor = form()
    const { api, calls } = route((path, init) => {
        if (init.method === 'POST') return json({ result: 'success', data: JSON.stringify({ id: '42' }) })
        if (path === '/bug-view-42.json') return json({ bug: bug(), users: { alice: 'Alice', bob: 'Bob' }, actions: [{ id: '1', actor: 'alice', action: 'opened' }] })
        throw new Error('unexpected')
    })
    await assert.rejects(api.commit(editor, { account: 'wrong', title: 'A bug' }), { code: 'confirmationMismatch' })
    assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 0)
    const result = await api.commit(editor, { account: 'alice', title: 'A bug' })
    assert.equal(result.id, '42')
    assert.deepEqual(result.data.users, { alice: 'Alice', bob: 'Bob' })
    assert.equal(result.actions[0].actor, 'alice')
    assert.equal(calls.filter(({ options }) => options.method === 'POST').length, 1)
    const body = calls.find(({ options }) => options.method === 'POST').options.body
    assert.equal(new URLSearchParams(body).get('title'), 'A bug')
    assert.equal(new URLSearchParams(body).get('openedBuild[]'), '2')
})

test('server rejection is parsed without exposing echoed token and permits corrected retry', async () => {
    const editor = form()
    let writes = 0
    const { api } = route((path, init) => {
        if (init.method === 'POST') {
            writes++
            return json({ result: 'fail', message: { title: 'token=top-secret invalid' } })
        }
        throw new Error('unexpected route')
    })
    const confirmation = { account: 'alice', title: 'A bug' }
    await assert.rejects(api.commit(editor, confirmation), (error) => error.code === 'serverRejected' && typeof error.fields.title === 'string' && !JSON.stringify(error).includes('top-secret'))
    await assert.rejects(api.commit(editor, confirmation), { code: 'serverRejected' })
    assert.equal(writes, 2)
})

test('Cookie rejection messages redact individual cookie values as well as the full header', async () => {
    const first = 'private-session-fixture', second = 'private-other-fixture'
    const { api } = route(() => json({ result: 'fail', message: { title: `Invalid sid=${first}; session=${second}` } }), credentials({ authMode: 'cookie', token: `sid=${first}; session=${second}` }))
    await assert.rejects(api.commit(form(), { account: 'alice', title: 'A bug' }), error => {
        assert.equal(error.code, 'serverRejected')
        assert.equal(JSON.stringify(error.fields).includes(first), false)
        assert.equal(JSON.stringify(error.fields).includes(second), false)
        return true
    })
})

test('confirmed POST retains id when GET fails; recovery only reads and cannot repeat POST', async () => {
    const editor = form()
    let writes = 0
    let reads = 0
    const { api } = route((path, init) => {
        if (init.method === 'POST') { writes++; return json({ result: 'success', data: { id: '42' } }) }
        if (path === '/bug-view-42.json') {
            reads++
            if (reads === 1) throw new Error('GET unavailable')
            return json({ bug: bug() })
        }
        throw new Error('unexpected')
    })
    const confirmation = { account: 'alice', title: 'A bug' }
    assert.deepEqual(await api.commit(editor, confirmation), { id: '42', readbackPending: true })
    await assert.rejects(api.commit(editor, confirmation), { code: 'writeLocked' })
    assert.equal((await api.reconcile(editor, '42')).id, '42')
    assert.equal(writes, 1)
    assert.equal(reads, 2)
    assert.equal(api.writeLocks.size, 0)
    assert.equal(api.pendingWrites.size, 0)
})

test('confirmed POST with mismatched fields returns id and pending readback', async () => {
    const editor = form()
    let writes = 0
    const { api } = route((path, init) => {
        if (init.method === 'POST') { writes++; return json({ result: 'success', id: '42' }) }
        if (path === '/bug-view-42.json') return json({ bug: { ...bug(), title: 'Different' } })
        throw new Error('unexpected')
    })
    const confirmation = { account: 'alice', title: 'A bug' }
    assert.deepEqual(await api.commit(editor, confirmation), { id: '42', readbackPending: true })
    await assert.rejects(api.commit(editor, confirmation), { code: 'writeLocked' })
    assert.equal(writes, 1)
})

test('unknown POST outcome locks retries; read-only reconciliation cannot unlock it', async () => {
    const editor = form('edit')
    let writes = 0
    const { api } = route((path, init) => {
        if (init.method === 'POST') { writes++; throw new Error('lost response') }
        if (path === '/bug-view-42.json') return json({ bug: bug() })
        throw new Error('unexpected')
    })
    const confirm = { account: 'alice', title: 'A bug', id: '42' }
    await assert.rejects(api.commit(editor, confirm), { code: 'writeUnknown' })
    await assert.rejects(api.commit(editor, confirm), { code: 'writeLocked' })
    assert.equal((await api.reconcile(editor, '42')).id, '42')
    await assert.rejects(api.commit(editor, confirm), { code: 'writeLocked' })
    assert.equal(writes, 1)
})
