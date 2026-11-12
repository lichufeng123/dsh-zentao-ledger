import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverCredential, ZenTaoSession } from '../src/host/session.mjs'
import { ZenTaoApi } from '../src/host/api.mjs'
import { parseCreatorBuilds } from '../src/shared/build-creators.js'
import { createHost } from '../index.js'
import { Config, normalizeConfig, normalizeOrigin } from '../config.js'
import { createHash } from 'node:crypto'

const origin = 'https://zentao.example'
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

test('portable onboarding binds token exchange to the explicitly configured site', async () => {
  const calls = []
  const identity = await discoverCredential('synthetic-secret', async (url) => {
    calls.push(new URL(url))
    return new URL(url).pathname === '/user-login.html' ? new Response('', { headers: { 'set-cookie': 'sid=synthetic' } }) : json({ user: { account: 'alice', id: '7' } })
  }, origin, 'token')
  assert.ok(calls.every(url => url.origin === origin))
  assert.deepEqual(identity, { origin, account: 'alice', userId: '7' })
})

test('cookie onboarding reads profile directly and never treats cookie header as a REST token', async () => {
  const calls = []
  const identity = await discoverCredential('sid=synthetic; session=fixture', async (url, init) => {
    calls.push({ url: new URL(url), headers: init.headers })
    assert.equal(init.headers.get('cookie'), 'sid=synthetic; session=fixture')
    return json({ user: { account: 'alice', id: '7' } })
  }, origin, 'cookie')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url.pathname, '/my-profile.json')
  assert.equal(calls[0].headers.get('token'), null)
  assert.equal(identity.origin, origin)
  const api = new ZenTaoApi({ session: { context: async () => ({ ...identity, authMode: 'cookie', token: 'sid=synthetic' }), send: async () => { throw Error('must not send') } } })
  await assert.rejects(api.mediaUploadStatus(), { code: 'mediaAuthUnavailable' })
})

test('requirements route and ownership use configured product instead of a fixed product', async () => {
  const paths = []
  const api = new ZenTaoApi({ productId: '23', session: { json: async path => {
    paths.push(path)
    return { stories: [{ id: '50', product: '23', type: 'story', title: 'Demo story' }], requirements: [], page: 1, total: 1, limit: 20 }
  } } })
  assert.equal((await api.listStories()).product, '23')
  assert.equal(paths[0], '/api.php/v1/products/23/stories?limit=20&page=1')
})

test('creator filtering uses the authenticated account even when display names collide', () => {
  const data = { users: { alice: 'Casey', casey: 'Casey' }, buildsTotal: 2, projectBuilds: [{ id: '1', createdBy: 'alice' }, { id: '2', createdBy: 'casey' }] }
  assert.deepEqual(parseCreatorBuilds(data, 'alice').ids, ['1'])
})

const settings = { origin, productId: '23', projectId: '45', productName: 'Demo Product', projectName: 'Demo Project' }
const invoke = async (host, method, args = {}) => (await host.rpc(new Request('http://localhost/api/zentao-ledger/rpc', {
  method: 'POST', body: JSON.stringify({ method, args })
}))).json()
function harness(config = settings, records = new Map()) {
  const calls = [], keys = []
  let metadata = { productID: '23', projectID: '45', products: { 23: 'Demo Product' }, projects: { 45: 'Demo Project' }, builds: { 8: 'Demo Build' } }
  const credentials = {
    readRecord: async key => { keys.push(key); return records.get(key) },
    modifyRecord: async (key, mutate) => { keys.push(key); records.set(key, await mutate(records.get(key))) },
    deleteRecord: async key => { keys.push(key); records.delete(key) }
  }
  const transport = async (url, init) => {
    const parsed = new URL(url)
    calls.push({ url: parsed, init })
    if (parsed.pathname === '/user-login.html') return new Response('', { headers: { 'set-cookie': 'sid=fixture' } })
    if (parsed.pathname === '/my-profile.json') return json({ user: { id: '7', account: 'alice', realname: 'Alice' } })
    if (parsed.pathname.startsWith('/bug-create-')) return json({ result: 'success', data: metadata })
    if (parsed.pathname === '/api.php/v1/products/23/stories') return json({ stories: [], requirements: [], page: 1, total: 0, limit: 20 })
    throw Error('unexpected mock route')
  }
  return { host: createHost({ credentials }, { config, transport }), calls, keys, records, credentials,
    restart: config => createHost({ credentials }, { config, transport }), setMetadata(value) { metadata = value } }
}

test('real DSH schema resolves safe empty defaults; origin syntax is strict and HTTP is opt-in', () => {
  assert.deepEqual(Config({}), { origin: '', allowHttp: false, productId: '', projectId: '', productName: '', projectName: '', authMode: 'token', ai: { enabled: false, provider: '', model: '' } })
  for (const value of ['http://zentao.example', 'https://alice@zentao.example', 'https://zentao.example/sub', 'https://zentao.example/?x=1', 'https://zentao.example/#x', 'https://zentao.example/a/..', 'https://zentao.example\\evil', 'https://zentao.example\n']) assert.throws(() => normalizeOrigin(value), /invalidOrigin/)
  assert.equal(normalizeOrigin(origin + '/'), origin)
  assert.equal(normalizeOrigin('http://localhost:1234', true), 'http://localhost:1234')
  assert.throws(() => normalizeConfig({ ...settings, productId: 'wrong' }), /invalidConfig/)
  assert.throws(() => normalizeConfig({ ...settings, authMode: 'other' }), /invalidConfig/)
})

test('unconfigured host returns actionable site status without touching credentials or network', async () => {
  const f = harness({})
  const status = await invoke(f.host, 'status')
  assert.equal(status.ok, true)
  assert.equal(status.value.configured, false)
  assert.equal(status.value.error, 'configMissing')
  assert.deepEqual(status.value.site, { origin: '', productId: '', projectId: '', productName: '', projectName: '', configured: false, authMode: 'token', excludedAssignees: [], aiEnabled: false })
  assert.equal((await invoke(f.host, 'configure', { token: 'synthetic' })).error, 'configMissing')
  assert.equal((await invoke(f.host, 'setPreferredView', { view: 'all' })).error, 'configMissing')
  assert.equal(f.calls.length, 0)
  assert.equal(f.keys.length, 0)
})

test('public credential records are namespaced and site-bound; another site never reuses a grant', async () => {
  const f = harness()
  const result = await invoke(f.host, 'configure', { token: 'synthetic-secret' })
  assert.equal(result.ok, true)
  assert.equal(result.value.identity.origin, origin)
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false)
  const recordKey = 'dsh-zentao-ledger/site-' + createHash('sha256').update(origin).digest('hex')
  assert.ok(f.keys.every(key => key === recordKey))
  assert.equal(f.records.get(recordKey).payload.origin, origin)
  assert.equal(f.records.get(recordKey).payload.authMode, 'token')
  const nextOrigin = 'https://second.zentao.example'
  const nextHost = f.restart({ ...settings, origin: nextOrigin })
  const before = f.calls.length
  const disconnected = await invoke(nextHost, 'status')
  assert.equal(disconnected.value.configured, false)
  assert.equal(disconnected.value.site.origin, nextOrigin)
  assert.equal(f.calls.length, before)
  const secondKey = 'dsh-zentao-ledger/site-' + createHash('sha256').update(nextOrigin).digest('hex')
  f.records.set(secondKey, f.records.get(recordKey)) // Malformed cross-site record is ignored, too.
  assert.equal((await invoke(nextHost, 'status')).value.configured, false)
  assert.equal(f.calls.length, before)
  assert.equal((await invoke(f.restart({ ...settings, authMode: 'cookie' }), 'status')).value.configured, false)
})

test('Cookie host stores only in backend, resumes by profile GET and rejects REST image auth without a request', async () => {
  const f = harness({ ...settings, authMode: 'cookie' })
  assert.equal((await invoke(f.host, 'configure', { token: 'wrong-key' })).error, 'missingToken')
  const result = await invoke(f.host, 'configure', { cookie: 'sid=fixture; session=synthetic' })
  assert.equal(result.ok, true)
  assert.equal(result.value.site.authMode, 'cookie')
  assert.equal(JSON.stringify(result).includes('sid=fixture'), false)
  assert.ok(f.calls.every(call => call.url.pathname !== '/user-login.html' && !call.url.searchParams.has('token') && !call.init.headers.has('token')))
  assert.ok(f.calls.every(call => call.init.headers.get('cookie') === 'sid=fixture; session=synthetic'))
  const before = f.calls.length
  assert.equal((await invoke(f.host, 'mediaUploadStatus')).error, 'mediaAuthUnavailable')
  assert.equal(f.calls.length, before)
  assert.equal((await invoke(f.host, 'listStories')).ok, true)
  assert.equal(f.calls.at(-1).url.pathname, '/api.php/v1/products/23/stories')
  assert.equal(f.calls.at(-1).init.headers.has('token'), false)
  assert.equal((await invoke(f.restart({ ...settings, authMode: 'cookie' }), 'status')).value.identity.account, 'alice')
  const editor = (await invoke(f.host, 'editor', { mode: 'create' })).value
  Object.assign(editor.fields, { title: 'Demo bug', description: 'Demo description', openedBuild: ['8'] })
  await assert.rejects(f.host.methods.commit({ editor, confirmation: { account: 'alice', title: 'Demo bug' } }, [{ kind: 'image', name: 'demo.png', bytes: new Uint8Array([1]), type: 'image/png', size: 1 }]), { code: 'mediaAuthUnavailable' })
  assert.equal(f.calls.some(call => call.init.method === 'POST'), false)
})

test('configured product/project bind the editor and are checked again at the write boundary', async () => {
  const f = harness()
  await invoke(f.host, 'configure', { token: 'synthetic-secret' })
  const editor = (await invoke(f.host, 'editor', { mode: 'create', fields: { product: '999', project: '999', module: '999' } })).value
  const context = { product: '23', project: '45', branch: '0', module: '0', execution: '0' }
  assert.deepEqual(editor.context, context)
  assert.equal(editor.origin, origin)
  assert.ok(Object.entries(context).every(([key, value]) => editor.fields[key] === value))
  let writes = 0
  f.host.api.commit = async prepared => {
    writes++
    assert.deepEqual(prepared.context, context)
    assert.ok(Object.entries(context).every(([key, value]) => prepared.fields[key] === value))
    return { id: '42' }
  }
  const confirmation = { account: 'alice', title: 'Demo bug' }
  editor.fields.title = confirmation.title
  const stale = await invoke(f.host, 'commit', { editor: { ...editor, origin: 'https://second.zentao.example' }, confirmation })
  assert.equal(stale.error, 'identityMismatch')
  Object.assign(editor.fields, { product: '999', project: '999', module: '999', execution: '999' })
  assert.equal((await invoke(f.host, 'commit', { editor, confirmation })).ok, true)
  assert.equal(writes, 1)
  f.setMetadata({ productID: '23', projectID: '45', products: { 23: 'Demo Product' }, projects: { 45: 'Different project' } })
  assert.equal((await invoke(f.host, 'commit', { editor, confirmation })).error, 'contextUnavailable')
  assert.equal(writes, 1)
  assert.equal(f.calls.some(call => call.init.method === 'POST'), false)
})

test('optional name checks allow another deployment while missing metadata remains blocked', async () => {
  const f = harness({ ...settings, productName: '', projectName: '' })
  await invoke(f.host, 'configure', { token: 'synthetic-secret' })
  f.setMetadata({ productID: '23', projectID: '45', products: { 23: 'Another product label' }, projects: { 45: 'Another project label' } })
  assert.equal((await invoke(f.host, 'editor', { mode: 'create' })).ok, true)
  f.setMetadata({ productID: '23', projectID: '45', products: { 23: 'Another product label' }, projects: {} })
  assert.equal((await invoke(f.host, 'editor', { mode: 'create' })).error, 'contextUnavailable')
})

test('invalid Cookie headers and default HTTP are rejected before transport', async () => {
  let calls = 0
  const transport = async () => { calls++; return json({ user: { id: '7', account: 'alice' } }) }
  for (const cookie of ['Cookie: sid=fixture', 'sid=x\r\nToken: synthetic', 'sid=first; sid=second', 'not-a-cookie']) await assert.rejects(discoverCredential(cookie, transport, origin, 'cookie'), { code: 'credentialsUnavailable' })
  await assert.rejects(discoverCredential('synthetic', transport, 'http://zentao.example', 'token'), { code: 'invalidOrigin' })
  assert.equal(calls, 0)
})

test('session revalidates a replaced site grant immediately before business POST', async () => {
  let reads = 0
  const calls = []
  const owner = { origin, binding: 'public-fixture', token: 'synthetic', account: 'alice', userId: '7' }
  const session = new ZenTaoSession({ credentials: async () => ++reads === 1 ? owner : { ...owner, origin: 'https://second.zentao.example' }, transport: async (url, init) => {
    calls.push({ url, init })
    return new URL(url).pathname === '/user-login.html' ? new Response('') : json({ user: { id: '7', account: 'alice' } })
  } })
  await assert.rejects(session.json('/bug-edit-42.json', { method: 'POST', body: 'title=Demo' }), { code: 'identityMismatch' })
  assert.equal(calls.length, 2)
  assert.equal(calls.some(call => call.init.method === 'POST'), false)
})

test('Host readback rejects a stale site draft before reconciling a same-number Bug', async () => {
  const f = harness()
  let reconciliations = 0
  f.host.api.reconcile = async () => { reconciliations++; return { id: '42' } }
  const editor = { mode: 'edit', id: '42', origin: 'https://second.zentao.example' }
  assert.equal((await invoke(f.host, 'readback', { id: '42', editor })).error, 'identityMismatch')
  assert.equal(reconciliations, 0)
  assert.equal(f.calls.length, 0)
  assert.equal((await invoke(f.host, 'readback', { id: '42', editor: { ...editor, origin } })).ok, true)
  assert.equal(reconciliations, 1)
})

test('Host closing rejects stale site confirmation before any business request', async () => {
  const f = harness()
  await invoke(f.host, 'configure', { token: 'synthetic' })
  const before = f.calls.length
  assert.equal((await invoke(f.host, 'closeBug', { bugId: '42', confirmation: { origin: 'https://second.zentao.example' } })).error, 'confirmationMismatch')
  assert.equal(f.calls.length, before)
})
