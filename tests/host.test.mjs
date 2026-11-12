import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHost, apply } from '../index.js'

const config = { origin: 'https://zentao.example', productId: '1', projectId: '2', productName: 'Demo Product', projectName: 'Demo Product' }
const site = { ...config, configured: true, authMode: 'token', excludedAssignees: [], aiEnabled: false }
const envelope = value => ({ status: 'success', data: JSON.stringify(value) })
function fixture({ profileExpired = () => false, projectName = 'Demo Product', realname = '', memberName = '' } = {}) {
  let stored, requests = [], posts = 0
  const credentials = {
    readRecord: async () => stored ? { kind: 'grant', payload: stored } : undefined,
    describeRecord: async () => ({ configured: Boolean(stored) }),
    modifyRecord: async (_, mutate) => { stored = (await mutate(stored ? { kind: 'grant', payload: stored } : undefined))?.payload },
    deleteRecord: async () => { stored = undefined }
  }
  const transport = async (url, init) => {
    const u = new URL(url)
    requests.push({ path: u.pathname, method: init.method, cookie: init.headers.get('cookie') || '' })
    if (init.method === 'POST') posts++
    if (u.pathname === '/user-login.html') return new Response('', { headers: { 'set-cookie': `sid=${u.searchParams.get('token') === 'old-secret' ? 'old' : u.searchParams.get('token') === 'other-secret' ? 'other' : 'mock'}; Path=/` } })
    if (u.pathname === '/my-profile.json') return new Response(JSON.stringify(profileExpired(init.headers.get('cookie') || '') ? { loginExpired: true } : envelope({ user: { id: '8', account: init.headers.get('cookie')?.includes('sid=other') ? 'mallory' : 'tester', ...(realname ? { realname } : {}) } })))
    if (u.pathname.startsWith('/bug-create-')) return new Response(JSON.stringify(envelope({ productID: '1', projectID: '2', products: { 1: 'Demo Product' }, projects: { 0: '', 2: projectName }, builds: { 8: '版本' } })))
    if (u.pathname === '/bug-edit-42.json') return new Response(JSON.stringify(envelope({ bug: { id: '42', product: '1', branch: '0', module: '44', project: '2', execution: '0', title: '原题', assignedTo: 'dev', severity: '3', pri: '2', type: 'codeerror', openedBuild: '8', lastEditedDate: '2026-11-04 19:00:00' }, products: { 1: 'Demo Product' }, projects: { 2: 'Demo Product' }, openedBuilds: { 8: '版本' } })))
    if (u.pathname === '/user-bug-0-assignedTo-id_desc-0-1-1.json' && memberName) return new Response(JSON.stringify(envelope({ userList: `<option value="8">${memberName}</option>` })))
    if (u.pathname === '/api.php/v1/products/1/stories') return new Response(JSON.stringify({ page: Number(u.searchParams.get('page')), limit: 20, total: 21,
      stories: [{ id: 1302, product: '1', type: 'story', title: '可见需求', deleted: '0' }], requirements: [] }))
    if (u.pathname.startsWith('/user-bug-')) return new Response(JSON.stringify(envelope({ bugs: [], pager: { pageTotal: 0 }, users: {}, products: {} })))
    return new Response('', { status: 404 })
  }
  const context = { credentials }
  return { host: createHost(context, { transport, config }), restart: () => createHost(context, { transport, config }), get stored() { return stored }, get requests() { return requests }, get posts() { return posts } }
}
const rpc = async (host, method, args = {}) => {
  const response = await host.rpc(new Request('http://localhost/api/zentao-ledger/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) }))
  return response.json()
}

test('onboarding verifies identity, persists only in host store and reuses verified session', async () => {
  const f = fixture()
  assert.deepEqual(await rpc(f.host, 'status'), { ok: true, value: { configured: false, site, preferredView: 'active', preferredPlace: { view: 'active', page: 1, bugId: '', query: '' } } })
  const configured = await rpc(f.host, 'configure', { token: 'mock-secret' })
  assert.equal(configured.value.identity.userId, '8')
  assert.equal(JSON.stringify(configured).includes('mock-secret'), false)
  assert.deepEqual((await rpc(f.host, 'status')).value.identity, { origin: config.origin, account: 'tester', userId: '8' })
  const page = await rpc(f.host, 'listReports', { status: 'active', page: 1 })
  assert.equal(page.ok, true)
  assert.equal(page.value.page, 1)
  assert.equal(f.posts, 0)
  assert.deepEqual(await rpc(f.host, 'disconnect'), { ok: true, value: { configured: false, site, preferredView: 'active', preferredPlace: { view: 'active', page: 1, bugId: '', query: '' } } })
  assert.equal((await rpc(f.host, 'status')).value.configured, false)
})

test('requirements RPC reads only product 1 under the saved identity', async () => {
  const f = fixture()
  assert.equal((await rpc(f.host, 'listStories', { page: 1 })).ok, false)
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  const page = await rpc(f.host, 'listStories', { product: '999', page: 1 })
  assert.equal(page.ok, true)
  assert.equal(page.value.product, '1')
  assert.equal(page.value.stories[0].title, '可见需求')
  assert.ok(f.requests.some(call => call.path === '/api.php/v1/products/1/stories' && call.method === 'GET' && call.cookie.includes('sid=mock')))
  assert.equal((await rpc(f.host, 'listStories', { page: 501 })).error, 'invalidPagination')
  assert.equal(f.posts, 0)
})

test('verified current user name appears after connect and restart without replacing account identity', async () => {
  const fixtureWithName = fixture({ realname: 'Alice' })
  const connected = await rpc(fixtureWithName.host, 'configure', { token: 'mock-secret' })
  assert.deepEqual(connected.value.identity, { origin: config.origin, account: 'tester', userId: '8', realname: 'Alice' })
  assert.deepEqual((await rpc(fixtureWithName.restart(), 'status')).value.identity, connected.value.identity)
  const fromMembers = fixture({ memberName: 'Casey' })
  const memberLogin = await rpc(fromMembers.host, 'configure', { token: 'mock-secret' })
  assert.deepEqual(memberLogin.value.identity, { origin: config.origin, account: 'tester', userId: '8', realname: 'Casey' })
  const nameless = fixture()
  await rpc(nameless.host, 'configure', { token: 'mock-secret' })
  assert.deepEqual((await rpc(nameless.host, 'status')).value.identity, { origin: config.origin, account: 'tester', userId: '8' })
  assert.equal(fixtureWithName.posts + fromMembers.posts + nameless.posts, 0)
})

test('external renewal modes are rejected without saving a grant', async () => {
  const f = fixture()
  assert.deepEqual(await rpc(f.host, 'configure', { token: 'mock-secret', renewal: 'external-cli' }), { ok: false, error: 'invalidRequest' })
  assert.equal(f.stored, undefined)
  assert.equal(f.requests.length, 0)
})

test('preferred ledger view survives host restart without skipping identity verification', async () => {
  const f = fixture()
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  assert.deepEqual(await rpc(f.host, 'setPreferredView', { view: 'resolved' }), { ok: true, value: { preferredView: 'resolved' } })
  assert.equal(f.stored.preferredView, 'resolved')
  assert.equal((await rpc(f.restart(), 'status')).value.preferredView, 'resolved')
  assert.equal((await rpc(f.host, 'setPreferredView', { view: 'arbitrary' })).error, 'invalidRequest')
  assert.equal(f.stored.preferredView, 'resolved')
  assert.equal(f.posts, 0)
})

test('saved grant silently restores after host restart and reuses cookie on repeated entry', async () => {
  const f = fixture()
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  const before = f.requests.filter(call => call.path === '/user-login.html').length
  await rpc(f.host, 'status')
  await rpc(f.host, 'status')
  assert.equal(f.requests.filter(call => call.path === '/user-login.html').length, before)
  const restarted = f.restart()
  const restored = await rpc(restarted, 'status')
  assert.deepEqual(restored.value.identity, { origin: config.origin, account: 'tester', userId: '8' })
  assert.equal(f.requests.filter(call => call.path === '/user-login.html').length, before + 1)
  assert.equal(JSON.stringify(restored).includes('mock-secret'), false)
})

test('status stops claiming connected when saved token no longer authorizes a GET', async () => {
  let expired = false
  const f = fixture({ profileExpired: () => expired })
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  assert.equal((await rpc(f.host, 'status')).value.identity.account, 'tester')
  expired = true
  const status = (await rpc(f.host, 'status')).value
  assert.deepEqual(status, { configured: true, site, error: 'authExpired', preferredView: 'active', preferredPlace: { view: 'active', page: 1, bugId: '', query: '' } })
  assert.equal(f.posts, 0)
})

test('expired grants return reconnect state without external renewal', async () => {
  let expired = false
  const f = fixture({ profileExpired: () => expired })
  await rpc(f.host, 'configure', { token: 'old-secret' })
  expired = true
  assert.deepEqual((await rpc(f.host, 'status')).value, { configured: true, site, error: 'authExpired', preferredView: 'active', preferredPlace: { view: 'active', page: 1, bugId: '', query: '' } })
  assert.equal(f.stored.token, 'old-secret')
  assert.equal(f.posts, 0)
})

test('new Bug form and write boundary force verified configured product/project without a real POST', async () => {
  const f = fixture()
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  const supplied = { product: '9', project: '99', branch: '8', module: '88', execution: '77' }
  const form = await rpc(f.host, 'editor', { mode: 'create', fields: supplied })
  assert.equal(form.ok, true)
  assert.deepEqual(Object.fromEntries(['product', 'project', 'branch', 'module', 'execution'].map(key => [key, form.value.fields[key]])),
    { product: '1', project: '2', branch: '0', module: '0', execution: '0' })
  const attempted = await rpc(f.host, 'commit', { editor: {
    mode: 'create', origin: config.origin, fields: { ...form.value.fields, ...supplied, title: '仅模拟，不提交', description: '描述', openedBuild: ['8'] }
  }, confirmation: { account: 'someone-else', title: '仅模拟，不提交' } })
  assert.equal(attempted.error, 'confirmationMismatch')
  assert.ok(f.requests.filter(call => call.path.startsWith('/bug-create-')).every(call =>
    call.path.includes('bug-create-1-0-productID=1,moduleID=0,projectID=2,executionID=0')))
  assert.equal(f.posts, 0)
})

test('editing preserves the original hidden module and execution at the Host write boundary', async () => {
  const f = fixture()
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  f.host.api.commit = async prepared => ({ module: prepared.fields.module, project: prepared.fields.project, execution: prepared.fields.execution })
  const result = await rpc(f.host, 'commit', { editor: { mode: 'edit', origin: config.origin, id: '42', raw: { lastEditedDate: '2026-11-04 19:00:00' }, fields: { module: '999', project: '99', execution: '77' } }, confirmation: {} })
  assert.deepEqual(result, { ok: true, value: { module: '44', project: '2', execution: '0' } })
  assert.equal(f.posts, 0)
})

test('missing configured project mapping blocks new Bug form before any write', async () => {
  const f = fixture({ projectName: '别的项目' })
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  assert.deepEqual(await rpc(f.host, 'editor', { mode: 'create' }), { ok: false, error: 'contextUnavailable' })
  assert.equal(f.posts, 0)
})

test('Host mounts authenticated Connection routes and disposes them', () => {
  const mounted = [], effects = []
  const ctx = {
    credentials: { readRecord: async () => undefined },
    connection: { fetch: { register(route) { mounted.push(route); return () => mounted.splice(mounted.indexOf(route), 1) } } },
    effect(install) { effects.push(install()) }
  }
  apply(ctx)
  assert.deepEqual(mounted.map(route => [route.path, route.methods]), [
    ['/api/zentao-ledger/rpc', ['POST']], ['/api/zentao-ledger/image', ['GET']], ['/api/zentao-ledger/media', ['POST']]
  ])
  effects.forEach(dispose => dispose())
  assert.equal(mounted.length, 0)
})

test('unknown method and unconfirmed POST are rejected without exposing secrets', async () => {
  const f = fixture()
  const unknown = await rpc(f.host, 'anUnknownMethod', { token: 'private' })
  assert.deepEqual(unknown, { ok: false, error: 'unknownMethod' })
  const attempt = await rpc(f.host, 'commit', {})
  assert.deepEqual(attempt, { ok: false, error: 'invalidRequest' })
  assert.equal(f.posts, 0)
})

test('remembered ledger place survives restart and rejects unsafe values', async () => {
  const f = fixture()
  await rpc(f.host, 'configure', { token: 'mock-secret' })
  const saved = await rpc(f.host, 'setPreferredPlace', { place: { view: 'resolved', page: 3, bugId: '42', query: '登录' } })
  assert.deepEqual(saved, { ok: true, value: { place: { view: 'resolved', page: 3, bugId: '42', query: '登录' } } })
  assert.equal(f.stored.preferredView, 'resolved')
  const restarted = await rpc(f.restart(), 'status')
  assert.deepEqual(restarted.value.preferredPlace, { view: 'resolved', page: 3, bugId: '42', query: '登录' })
  assert.equal(restarted.value.preferredView, 'resolved')

  const clamped = await rpc(f.host, 'setPreferredPlace', { place: { view: 'all', page: 9999, bugId: '12?token=x', query: 'x'.repeat(400) } })
  assert.deepEqual(clamped.value.place, { view: 'all', page: 1, bugId: '', query: '' })
  assert.equal((await rpc(f.host, 'setPreferredPlace', { place: { view: 'bogus' } })).error, 'invalidRequest')
  assert.equal((await rpc(f.host, 'setPreferredPlace', {})).error, 'invalidRequest')
  assert.equal(f.stored.preferredView, 'all')
})
