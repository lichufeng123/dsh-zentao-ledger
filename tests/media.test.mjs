import test from 'node:test'
import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { parseMedia, imageReference, imageMarkup, videosSaved } from '../src/host/media.mjs'
import { ZenTaoSession } from '../src/host/session.mjs'
import { ZenTaoApi } from '../src/host/api.mjs'
import { createHost } from '../index.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1])
const mp4 = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])
const files = [new File([png], '现场.png', { type: 'image/png' }), new File([mp4], 'record.mp4', { type: 'video/mp4' })]
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

const editor = () => ({
  mode: 'create', id: '', origin: 'https://zentao.example', data: { products: { 1: 'Demo Workspace' }, projects: { 2: 'Demo Workspace' }, builds: { 8: '构建' } }, raw: {},
  fields: { product: '1', project: '2', branch: '0', module: '0', execution: '0', title: '模拟文件提交', assignedTo: '', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: ['8'], descriptionAction: 'replace', description: '步骤', comment: '' }
})

function scenario({ attachment = true, upload = 'success', restAccount = 'alice', serverDeadline = '0000-00-00', serverSteps } = {}) {
  const calls = [], state = { steps: '', files: {} }
  let uploads = 0
  const session = new ZenTaoSession({ credentials: async () => ({ origin: 'https://zentao.example', binding: 'mock', account: 'alice', userId: '7', token: 'hidden' }), transport: async (url, options) => {
    const path = new URL(url).pathname
    calls.push({ path, query: new URL(url).search, options })
    if (path === '/user-login.html') return new Response('', { headers: { 'set-cookie': 'sid=mock; Path=/' } })
    if (path === '/my-profile.json') return json({ user: { id: '7', account: 'alice' } })
    if (path === '/api.php/v1/user') {
      assert.equal(options.method, 'GET')
      assert.equal(options.headers.get('Token'), 'hidden')
      return restAccount ? json({ profile: { account: restAccount } }) : new Response('', { status: 401 })
    }
    if (path === '/api.php/v1/files') {
      assert.equal(options.headers.get('Token'), 'hidden')
      assert.equal(options.method, 'POST')
      assert.match(options.body.get('imgFile')?.name || '', /\.png$/)
      if (upload === 'unknown') throw Error('transport lost')
      if (upload === 'http403') return new Response('secret-bearing response', { status: 403 })
      uploads += 1
      return json(upload === 'reject' ? { error: 1, message: 'unsupported' } : { error: upload === 'zeroString' ? '0' : undefined, id: 900 + uploads, url: `/file-read-${899 + uploads}.png` })
    }
    if (path.startsWith('/bug-create-')) {
      const body = options.body
      assert.ok(body instanceof FormData)
      state.steps = body.get('steps')
      assert.match(state.steps, /步骤/)
      assert.match(state.steps, /file-read-900\.png/)
      assert.equal(body.get('uid'), pathFromUpload(calls))
      if (body.get('files[]')) {
        assert.equal(body.get('files[]').name, 'record.mp4')
        assert.equal(body.get('labels[]'), 'record.mp4')
      }
      if (attachment) state.files = { 901: { id: '901', title: 'record.mp4', extension: 'mp4', size: mp4.length } }
      return json({ result: 'success', id: '42' })
    }
    if (path === '/bug-view-42.json') return json({ status: 'success', data: JSON.stringify({ bug: { ...editor().fields, deadline: serverDeadline, id: '42', steps: (serverSteps ?? state.steps) + (serverSteps ? ' <img src="/file-read-900.png">' : ''), files: state.files } }) })
    throw Error('unexpected path')
  } })
  return { api: new ZenTaoApi({ session }), calls }
}
const pathFromUpload = calls => new URLSearchParams(calls.find(call => call.path === '/api.php/v1/files')?.query).get('uid')

test('image and video selection validates bytes, sizes and same-origin references', async () => {
  const selected = await parseMedia(files)
  assert.deepEqual(selected.map(file => file.kind), ['image', 'video'])
  await assert.rejects(parseMedia([new File(['fake'], 'image.png')]), { message: 'invalidMedia' })
  await assert.rejects(parseMedia([new File([png], 'script.mp4')]), { message: 'invalidMedia' })
  await assert.rejects(parseMedia([new File([mp4], 'too-big.mp4', { type: 'video/mp4' }), ...Array(6).fill(files[0])]), { message: 'mediaLimit' })
  assert.throws(() => imageReference('https://evil.example/file-read-9.png', 'https://zentao.example'), { message: 'invalidMediaResponse' })
  assert.equal(imageMarkup('/file-read-9.png', '<x>'), '<p><img src="/file-read-9.png" alt="&lt;x&gt;"></p>')
  assert.equal(videosSaved({ files: { 901: { id: '901', title: 'record.mp4', extension: 'mp4', size: mp4.length } } }, [{ name: 'record.mp4', size: mp4.length }], ['901']), false)
})

test('one confirmed create uploads inline image then binds MP4 and verifies both by GET', async () => {
  const { api, calls } = scenario()
  const result = await api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia(files))
  assert.equal(result.id, '42')
  assert.equal(result.bug.files['901'].title, 'record.mp4')
  assert.match(pathFromUpload(calls), /^ds[0-9a-f]{24}$/)
  assert.equal(calls.filter(call => call.path === '/api.php/v1/user' && call.options.method === 'GET').length, 1)
  assert.equal(calls.filter(call => call.path === '/api.php/v1/files').length, 1)
  assert.equal(calls.filter(call => call.path.startsWith('/bug-create-')).length, 1)
  assert.equal(calls.filter(call => call.path === '/bug-view-42.json').length, 1)
})

test('ZenTao editor paragraphs and spacing still confirm saved Bug text', async () => {
  const draft = editor()
  draft.fields.description = '步骤\nai 自己分析出来的'
  const { api, calls } = scenario({ serverSteps: '<p>步骤</p><p>ai自己分析出来的</p>' })
  const result = await api.commit(draft, { account: 'alice', title: draft.fields.title }, await parseMedia(files))
  assert.equal(result.id, '42')
  assert.equal(result.readbackPending, undefined)
  assert.equal(calls.filter(call => call.path.startsWith('/bug-create-')).length, 1)
})

test('materially different description remains unconfirmed', async () => {
  const { api } = scenario({ serverSteps: '<p>另一段描述</p>' })
  const result = await api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia(files))
  assert.equal(result.readbackPending, true)
})

test('a real deadline mismatch stays pending while ZenTao zero-date is accepted', async () => {
  const exact = scenario()
  const verified = await exact.api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia(files))
  assert.equal(verified.bug.deadline, '0000-00-00')
  assert.equal(verified.readbackPending, undefined)
  const beforeRecheckPosts = exact.calls.filter(call => call.options.method === 'POST').length
  const reread = await exact.api.reconcile({ ...editor(), mediaExpected: { images: ['/file-read-900.png'], videos: [{ name: 'record.mp4', size: mp4.length }], previousIds: [] } }, '42')
  assert.equal(reread.id, '42')
  assert.equal(exact.calls.filter(call => call.options.method === 'POST').length, beforeRecheckPosts)
  const mismatch = scenario({ serverDeadline: '2027-02-03' })
  const pending = await mismatch.api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia(files))
  assert.equal(pending.readbackPending, true)
  await assert.rejects(mismatch.api.reconcile({ ...editor(), mediaExpected: pending.mediaExpected }, '42'), { code: 'readbackMismatch' })
})

test('REST image response accepts zero string with verified file URL', async () => {
  const { api, calls } = scenario({ upload: 'zeroString' })
  const result = await api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia(files))
  assert.equal(result.id, '42')
  assert.equal(calls.filter(call => call.path === '/api.php/v1/files').length, 1)
})

test('Bug success without its video attachment stays pending and cannot be posted twice', async () => {
  const { api, calls } = scenario({ attachment: false })
  const result = await api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia(files))
  assert.equal(result.id, '42')
  assert.equal(result.readbackPending, true)
  assert.deepEqual(result.mediaExpected.videos, [{ name: 'record.mp4', size: mp4.length }])
  await assert.rejects(api.reconcile({ ...editor(), mediaExpected: result.mediaExpected }, '42'), { code: 'readbackMismatch' })
  await assert.rejects(api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia(files)), { code: 'writeLocked' })
  assert.equal(calls.filter(call => call.path.startsWith('/bug-create-')).length, 1)
})

test('media authorization probe verifies REST identity without upload', async () => {
  const approved = scenario()
  assert.deepEqual(await approved.api.mediaUploadStatus(), { ready: true, account: 'alice' })
  assert.equal(approved.calls.filter(call => call.options.method === 'POST').length, 0)
  const denied = scenario({ restAccount: 'different-account' })
  await assert.rejects(denied.api.mediaUploadStatus(), { code: 'mediaAuthUnavailable' })
  assert.equal(denied.calls.filter(call => call.options.method === 'POST').length, 0)
})

test('REST identity mismatch blocks image upload and releases the unsent draft', async () => {
  for (const restAccount of ['', 'different-account']) {
    const { api, calls } = scenario({ restAccount })
    const draft = editor()
    const image = await parseMedia([files[0]])
    await assert.rejects(api.commit(draft, { account: 'alice', title: draft.fields.title }, image), { code: 'mediaAuthUnavailable' })
    await assert.rejects(api.commit(draft, { account: 'alice', title: draft.fields.title }, image), { code: 'mediaAuthUnavailable' })
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 0)
    assert.equal(calls.filter(call => call.path === '/api.php/v1/user').length, 2)
  }
})

test('HTTP upload rejection returns safe status without echoing response body', async () => {
  const { api, calls } = scenario({ upload: 'http403' })
  const failure = await api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia([files[0]])).catch(error => error)
  assert.equal(failure.code, 'mediaUploadFailed')
  assert.match(failure.fields.form, /HTTP 403/)
  assert.equal(JSON.stringify(failure).includes('secret-bearing'), false)
  assert.equal(calls.filter(call => call.path.startsWith('/bug-create-')).length, 0)
})

test('explicit image rejection permits correction, uncertain upload locks the draft', async () => {
  const rejected = scenario({ upload: 'reject' })
  await assert.rejects(rejected.api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia([files[0]])), { code: 'mediaUploadFailed' })
  assert.equal(rejected.calls.filter(call => call.path.startsWith('/bug-create-')).length, 0)
  await assert.rejects(rejected.api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia([files[0]])), { code: 'mediaUploadFailed' })
  const unknown = scenario({ upload: 'unknown' })
  await assert.rejects(unknown.api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia([files[0]])), { code: 'writeUnknown' })
  await assert.rejects(unknown.api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, await parseMedia([files[0]])), { code: 'writeLocked' })
  assert.equal(unknown.calls.filter(call => call.path.startsWith('/bug-create-')).length, 0)
})

test('native edit HTML success requires a newly bound video file in GET readback', async () => {
  const draft = editor()
  Object.assign(draft, { mode: 'edit', id: '42', raw: { lastEditedDate: '2026-11-04', steps: '<p>旧描述</p>' } })
  draft.data.openedBuilds = { 8: '构建' }
  draft.fields.descriptionAction = 'keep'
  draft.fields.description = ''
  let changed = false, reads = 0, posts = 0
  const session = new ZenTaoSession({ credentials: async () => ({ origin: 'https://zentao.example', binding: 'mock', account: 'alice', userId: '7', token: 'hidden' }), transport: async (url, options) => {
    const path = new URL(url).pathname
    if (path === '/user-login.html') return new Response('', { headers: { 'set-cookie': 'sid=mock; Path=/' } })
    if (path === '/my-profile.json') return json({ user: { id: '7', account: 'alice' } })
    if (path === '/bug-view-42.json') {
      reads++
      return json({ status: 'success', data: JSON.stringify({ bug: { ...draft.fields, id: '42', steps: draft.raw.steps, files: changed ? { 901: { id: '901', title: 'record.mp4', extension: 'mp4', size: mp4.length } } : {} } }) })
    }
    if (path === '/bug-edit-42.json' && options.method === 'POST') { posts++; changed = true; return new Response('<script>location.href="/bug-view-42.html"</script>', { headers: { 'content-type': 'text/html' } }) }
    throw Error('unexpected request')
  } })
  const result = await new ZenTaoApi({ session }).commit(draft, { account: 'alice', title: '模拟文件提交', id: '42' }, await parseMedia([files[1]]))
  assert.equal(result.id, '42')
  assert.equal(result.bug.files['901'].title, 'record.mp4')
  assert.equal(reads, 2)
  assert.equal(posts, 1)
})

test('Host multipart route forwards validated bytes only after fixed metadata review', async () => {
  const host = createHost({ credentials: { readRecord: async () => undefined } }, { config: { origin: 'https://zentao.example', productId: '1', projectId: '2' }, transport: async () => { throw Error('no real network') } })
  host.api.editor = async () => editor()
  host.api.commit = async (prepared, approval, selected) => ({
    id: '42', title: prepared.fields.title, account: approval.account,
    media: selected.map(file => ({ name: file.name, kind: file.kind, size: file.bytes.length }))
  })
  const form = new FormData()
  form.set('editor', JSON.stringify(editor()))
  form.set('confirmation', JSON.stringify({ account: 'alice', title: '模拟文件提交' }))
  for (const file of files) form.append('media', file, file.name)
  const response = await host.media(new Request('http://localhost/api/zentao-ledger/media', { method: 'POST', body: form }))
  const result = await response.json()
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.media, [{ name: '现场.png', kind: 'image', size: png.length }, { name: 'record.mp4', kind: 'video', size: mp4.length }])
})

test('Host rejects forged media bytes before any ZenTao request', async () => {
  let requests = 0
  const host = createHost({ credentials: { readRecord: async () => undefined } }, { config: { origin: 'https://zentao.example', productId: '1', projectId: '2' }, transport: async () => { requests++; throw Error('must not reach ZenTao') } })
  const form = new FormData()
  form.set('editor', JSON.stringify(editor()))
  form.set('confirmation', JSON.stringify({ account: 'alice', title: '模拟文件提交' }))
  form.append('media', new File(['fake'], 'forged.png'), 'forged.png')
  const response = await host.media(new Request('http://localhost/api/zentao-ledger/media', { method: 'POST', body: form }))
  assert.equal((await response.json()).error, 'invalidMedia')
  assert.equal(requests, 0)
})

test('expected and actual screenshots are grouped under readable headings', async () => {
  const seen = { steps: '' }
  let uploads = 0
  const session = new ZenTaoSession({ credentials: async () => ({ origin: 'https://zentao.example', binding: 'mock', account: 'alice', userId: '7', token: 'hidden' }), transport: async (url, options) => {
    const path = new URL(url).pathname
    if (path === '/user-login.html') return new Response('', { headers: { 'set-cookie': 'sid=mock; Path=/' } })
    if (path === '/my-profile.json') return json({ user: { id: '7', account: 'alice' } })
    if (path === '/api.php/v1/user') return json({ profile: { account: 'alice' } })
    if (path === '/api.php/v1/files') { uploads += 1; return json({ id: 900 + uploads, url: `/file-read-${899 + uploads}.png` }) }
    if (path.startsWith('/bug-create-')) {
      const body = options.body instanceof FormData ? options.body : new URLSearchParams(String(options.body))
      seen.steps = String(body.get('steps') || '')
      return json({ result: 'success', id: '42' })
    }
    if (path === '/bug-view-42.json') return json({ status: 'success', data: JSON.stringify({ bug: { ...editor().fields, id: '42', steps: seen.steps, files: {} } }) })
    throw Error('unexpected path ' + path)
  } })
  const api = new ZenTaoApi({ session })
  const two = [
    new File([png], '预期首页.png', { type: 'image/png' }),
    new File([png], '实际首页.png', { type: 'image/png' })
  ]
  const parsed = (await parseMedia(two)).map((file, index) => ({ ...file, role: index === 0 ? 'expected' : 'actual' }))
  const result = await api.commit(editor(), { account: 'alice', title: '模拟文件提交' }, parsed)
  assert.equal(result.id, '42')
  assert.equal(uploads, 2)
  assert.match(seen.steps, /<h3>预期结果<\/h3>/)
  assert.match(seen.steps, /<h3>实际结果<\/h3>/)
  assert.ok(seen.steps.indexOf('预期结果') < seen.steps.indexOf('实际结果'))
})

test('Host close-media route accepts images only and forwards explicit close confirmation', async () => {
  const host = createHost({ credentials: { readRecord: async () => undefined } }, { config: { origin: 'https://zentao.example', productId: '1', projectId: '2' }, transport: async () => { throw Error('no real network') } })
  host.api.closeResolvedBug = async ({ bugId, confirmation, comment, media }) => ({
    id: bugId, status: 'closed', actionId: '99', account: confirmation.account, comment,
    media: media.map(file => ({ name: file.name, kind: file.kind, size: file.bytes.length }))
  })
  const form = new FormData()
  form.set('operation', 'closeBug')
  form.set('bugId', '42')
  form.set('comment', '验收通过')
  form.set('confirmation', JSON.stringify({ action: 'closeBug', origin: 'https://zentao.example', id: '42', title: '问题', status: 'resolved', account: 'alice', userId: '7' }))
  form.append('media', files[0], files[0].name)
  const response = await host.media(new Request('http://localhost/api/zentao-ledger/media', { method: 'POST', body: form }))
  const result = await response.json()
  assert.equal(result.ok, true)
  assert.equal(result.value.id, '42')
  assert.deepEqual(result.value.media, [{ name: '现场.png', kind: 'image', size: png.length }])
})

test('Host close-media route rejects video before close handling', async () => {
  const host = createHost({ credentials: { readRecord: async () => undefined } }, { config: { origin: 'https://zentao.example', productId: '1', projectId: '2' }, transport: async () => { throw Error('no network') } })
  let closes = 0
  host.api.closeResolvedBug = async () => { closes++; return { id: '42' } }
  const form = new FormData()
  form.set('operation', 'closeBug')
  form.set('bugId', '42')
  form.set('comment', '')
  form.set('confirmation', JSON.stringify({ action: 'closeBug', id: '42' }))
  form.append('media', files[1], files[1].name)
  const response = await host.media(new Request('http://localhost/api/zentao-ledger/media', { method: 'POST', body: form }))
  assert.equal((await response.json()).error, 'invalidRequest')
  assert.equal(closes, 0)
})

test('media route rejects unknown screenshot roles before any upload', async () => {
  const host = createHost({ credentials: { readRecord: async () => undefined } }, { config: { origin: 'https://zentao.example', productId: '1', projectId: '2' }, transport: async () => { throw Error('no network') } })
  let commits = 0
  host.api.commit = async () => { commits++; return { id: '42' } }
  const form = new FormData()
  form.set('editor', JSON.stringify(editor()))
  form.set('confirmation', JSON.stringify({ account: 'alice', title: '模拟文件提交' }))
  form.set('roles', JSON.stringify(['something-else']))
  form.append('media', files[0], files[0].name)
  const response = await host.media(new Request('http://localhost/api/zentao-ledger/media', { method: 'POST', body: form }))
  assert.equal((await response.json()).error, 'invalidRequest')
  assert.equal(commits, 0)
})
