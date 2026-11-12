import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { File } from 'node:buffer'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const site = { origin: 'https://zentao.example', productId: '9', projectId: '17', productName: 'Demo Product', projectName: 'Demo Project', configured: true, authMode: 'token', excludedAssignees: [], aiEnabled: false }
const scopeFor = origin => encodeURIComponent(JSON.stringify([origin, 'demo_owner', '42']))
const context = { product: '9', project: '17', branch: '0', module: '0', execution: '0' }
function fixture(initial, respond = () => null, indexedDB) {
  const states = [initial], refs = [], effects = [], calls = [], storage = new Map()
  let cursor = 0, refCursor = 0, loaded, Page
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(value) { const i = cursor++; if (!(i in states)) states[i] = value; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] },
    useRef(value) { return refs[refCursor++] ||= { current: value } },
    useMemo: create => create(), useEffect: effect => effects.push(effect)
  }
  const document = { baseURI: 'http://localhost:8000/', getElementById: () => true, addEventListener() {}, removeEventListener() {} }
  let helpers
  const instrumented = source.replace('    const panelCss =', '    globalThis.captureHelpers({ storageScopeFor, writeSnapshot, readSnapshot, writeDraftMedia, readDraftMedia, clearUserDraftMedia });\n    const panelCss =')
  runInNewContext(instrumented, { indexedDB, File, Blob, captureHelpers: value => { helpers = value }, window: { __ModuleLoader__: { load: value => { loaded = value } }, addEventListener() {}, removeEventListener() {} }, document, URL, Promise, setTimeout,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (url, options) => { const body = JSON.parse(options.body); calls.push({ url: String(url), ...body }); return { ok: true, json: async () => ({ ok: true, value: await respond(body) }) } }
  })
  loaded.factory(() => React).apply({ slots: { inject: (_name, callback) => callback(), register: (definition, Component) => { if (definition.name === 'main') Page = Component } } })
  const wrapper = Page()
  const render = () => { cursor = 0; refCursor = 0; return wrapper.type(wrapper.props) }
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const nodes = () => visit(render())
  return { states, refs, effects, calls, storage, render, nodes, loaded, helpers }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const connected = origin => ({ connected: true, configured: true, account: 'demo_owner', userId: '42', origin, site: { ...site, origin } })

test('public client uses its own module and authenticated BFF namespace', async () => {
  const f = fixture(null, () => ({ site }))
  f.render(); f.effects.find(effect => effect.name === 'restoreEntry')(); await tick()
  assert.equal(f.loaded.id, 'dsh-zentao-ledger')
  assert.equal(f.calls[0].url, 'http://localhost:8000/api/zentao-ledger/rpc')
})

test('unconfigured site gives actionable onboarding without credentials or outbound links', () => {
  const f = fixture({ connected: false, site: { ...site, origin: '', configured: false } })
  assert.match(JSON.stringify(f.render()), /DSH.*配置/)
  assert.equal(f.nodes().some(node => node.type === 'input' && node.props.type === 'password'), false)
  assert.equal(f.nodes().some(node => node.type === 'a' && /^https?:/.test(node.props.href || '')), false)
})

test('cookie login sends only the entered cookie to host and clears the input', async () => {
  const f = fixture({ connected: false, site: { ...site, authMode: 'cookie' } }, () => connected(site.origin))
  const input = f.nodes().find(node => node.type === 'input' && node.props.type === 'password')
  assert.match(input.props['aria-label'], /Cookie/)
  input.props.ref.current = { value: 'demo_cookie=secret' }
  f.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await tick()
  assert.deepEqual(f.calls[0].args, { cookie: 'demo_cookie=secret' })
  assert.equal(input.props.ref.current.value, '')
  assert.equal(JSON.stringify([...f.storage]).includes('secret'), false)
  assert.doesNotMatch(JSON.stringify(f.render()), /MG CLI/)
})

test('links require verified matching identity origin and derive from configured site', () => {
  const f = fixture(connected(site.origin))
  assert.equal(f.nodes().find(node => node.type === 'a')?.props.href, 'https://zentao.example/product-browse-9.html')
  f.states[0] = { ...connected('https://other.example'), site }
  assert.equal(f.nodes().some(node => node.type === 'a' && /^https?:/.test(node.props.href || '')), false)
})

test('create metadata accepts explicit configured context and rejects mismatches', async () => {
  let returned = { ...context }
  const f = fixture(connected(site.origin), () => ({ mode: 'create', origin: site.origin, context, fields: returned, data: { products: { '9': 'Demo Product' }, projects: { '17': 'Demo Project' } } }))
  f.nodes().find(node => node.type === 'button' && node.children.includes('新建 Bug')).props.onClick(); await tick()
  assert.deepEqual(f.calls[0].args.fields, context)
  assert.equal(f.states[19].context.product, '9')
  returned = { ...context, project: '88' }
  f.nodes().find(node => node.type === 'button' && node.children.includes('新建 Bug')).props.onClick(); await tick()
  assert.equal(f.states[19], null)
  assert.match(JSON.stringify(f.render()), /归属.*不可用/)
})

test('draft and snapshot caches isolate the same account across origins', async () => {
  const f = fixture(connected(site.origin))
  f.states[19] = { mode: 'create', origin: site.origin, storageScope: scopeFor(site.origin), context, data: {}, fields: { ...context, title: 'Site A draft', description: 'Only site A', openedBuild: [] } }
  f.states[43] = true
  f.render(); f.effects.findLast(effect => effect.name === 'persistCreateDraft')(); await tick()
  const keysA = [...f.storage.keys()]
  assert.equal(keysA.length, 1)
  assert.match(keysA[0], /^dsh-zentao-ledger:create-draft:/)
  assert.ok(keysA[0].includes(encodeURIComponent(site.origin)))
  f.states[0] = connected('https://other.example')
  f.render(); f.effects.findLast(effect => effect.name === 'persistCreateDraft')(); await tick()
  assert.equal([...f.storage.keys()].length, 1, 'a stale editor cannot copy site A text into site B')
  f.states[19] = { ...f.states[19], origin: 'https://other.example', storageScope: scopeFor('https://other.example'), fields: { ...f.states[19].fields, title: 'Site B draft' } }
  f.render(); f.effects.findLast(effect => effect.name === 'persistCreateDraft')(); await tick()
  assert.equal([...f.storage.keys()].length, 2)
  assert.notEqual([...f.storage.keys()][0], [...f.storage.keys()][1])
})

test('manual create remains available when optional AI is disabled', () => {
  const f = fixture(connected(site.origin))
  f.states[19] = { mode: 'create', origin: site.origin, storageScope: scopeFor(site.origin), context, data: {}, fields: { ...context, title: 'Manual draft', description: 'Manual description', openedBuild: [] } }
  f.states[20] = 'review'
  assert.equal(f.nodes().some(node => node.type === 'button' && node.props.onClick?.name === 'requestAiOptimization'), false)
  assert.ok(f.nodes().some(node => node.type === 'button' && node.children.includes('确认提交')))
})


test('snapshots do not cross sites or accounts with the same numeric user ID', () => {
  const f = fixture(connected(site.origin))
  const scopeA = f.helpers.storageScopeFor(connected(site.origin))
  const scopeB = f.helpers.storageScopeFor(connected('https://other.example'))
  const scopeC = f.helpers.storageScopeFor({ ...connected(site.origin), account: 'demo_reviewer' })
  f.helpers.writeSnapshot(scopeA, { view: 'active', reporter: '42', page: 1, pages: 1, items: [{ id: '11', title: 'Site A only' }] })
  assert.equal(f.helpers.readSnapshot(scopeA).items[0].title, 'Site A only')
  assert.equal(f.helpers.readSnapshot(scopeB), null)
  assert.equal(f.helpers.readSnapshot(scopeC), null)
  assert.equal(f.helpers.readSnapshot('42'), null, 'numeric-only legacy keys are never accepted')
})

function memoryIndexedDB() {
  const records = new Map(), names = []
  const db = { close() {}, transaction() {
    const transaction = { objectStore() {
      const operation = action => {
        const request = {}
        setImmediate(() => { request.result = action(); request.onsuccess?.(); setImmediate(() => transaction.oncomplete?.()) })
        return request
      }
      return { put: value => operation(() => { records.set(value.key, value); return value.key }), get: key => operation(() => records.get(key)), delete: key => operation(() => records.delete(key)),
        openCursor() {
          const request = {}, iterator = records.entries()
          const next = () => setImmediate(() => {
            const entry = iterator.next()
            request.result = entry.done ? null : { value: entry.value[1], delete: () => records.delete(entry.value[0]), continue: next }
            request.onsuccess?.()
            if (entry.done) setImmediate(() => transaction.oncomplete?.())
          })
          next(); return request
        }
      }
    } }
    return transaction
  } }
  return { records, names, open(name) { names.push(name); const request = {}; setImmediate(() => { request.result = db; request.onsuccess?.() }); return request } }
}

test('IndexedDB media persists in the public namespace and clears only its site/account scope', async () => {
  const db = memoryIndexedDB(), f = fixture(connected(site.origin), () => null, db)
  const a = f.helpers.storageScopeFor(connected(site.origin)), b = f.helpers.storageScopeFor(connected('https://other.example'))
  const c = f.helpers.storageScopeFor({ ...connected(site.origin), account: 'demo_reviewer' })
  const file = new File(['demo pixels'], 'demo.png', { type: 'image/png' }); file.role = 'expected'
  for (const scope of [a, b, c]) assert.equal(await f.helpers.writeDraftMedia(scope, 'current', [file]), true)
  assert.ok(db.names.every(name => name === 'dsh-zentao-ledger-draft-media'))
  assert.equal(db.records.size, 3)
  const restored = await f.helpers.readDraftMedia(a, 'current')
  assert.equal(restored[0].name, 'demo.png'); assert.equal(restored[0].role, 'expected')
  await f.helpers.clearUserDraftMedia(a)
  assert.equal((await f.helpers.readDraftMedia(a, 'current')).length, 0)
  assert.equal((await f.helpers.readDraftMedia(b, 'current')).length, 1)
  assert.equal((await f.helpers.readDraftMedia(c, 'current')).length, 1)
})

test('create rejects missing context and editor origin from another site', async () => {
  let response = { mode: 'create', origin: site.origin, fields: context, data: {} }
  const f = fixture(connected(site.origin), () => response)
  const open = () => f.nodes().find(node => node.type === 'button' && node.children.includes('新建 Bug')).props.onClick()
  open(); await tick(); assert.equal(f.states[19], null)
  response = { ...response, context, origin: 'https://other.example' }
  open(); await tick(); assert.equal(f.states[19], null)
  assert.match(JSON.stringify(f.render()), /归属.*不可用/)
})
