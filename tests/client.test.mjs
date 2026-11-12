import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { File } from 'node:buffer'
import { webcrypto } from 'node:crypto'

const demoSite = { origin: 'https://zentao.example', productId: '9', projectId: '17', productName: 'Demo Product', projectName: 'Demo Project', configured: true, authMode: 'token', excludedAssignees: [], aiEnabled: true }
const demoContext = { product: '9', project: '17', branch: '0', module: '0', execution: '0' }
const demoScope = encodeURIComponent(JSON.stringify([demoSite.origin, 'reporter', '42']))
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function mount(fetchImpl, ReactOverride) {
  const registered = []
  const clipboardWrites = []
  const styles = []
  const storage = new Map()
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { storage.set(key, String(value)) },
    removeItem: key => { storage.delete(key) }
  }
  const document = {
    baseURI: 'http://127.0.0.1:59060/',
    getElementById(id) { return styles.find(style => style.id === id) },
    createElement() { return { id: '', textContent: '' } },
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
    head: { append(style) { styles.push(style) } }
  }
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(value) { return [value, () => {}] },
    useEffect(effect) { effect() },
    useMemo(create) { return create() },
    useRef(value) { return { current: value } }
  }
  let loaded
  runInNewContext(source, { window: { __ModuleLoader__: { load(value) { loaded = value } }, addEventListener() {}, removeEventListener() {} }, document, fetch: fetchImpl, URL, Blob, File, FormData, Promise, setTimeout, localStorage, crypto: webcrypto, navigator: { clipboard: { writeText: async value => { clipboardWrites.push(value) } } } })
  const module = loaded.factory(name => {
    assert.equal(name, 'react')
    return ReactOverride || React
  })
  const ctx = {
    slots: {
      inject(name, callback) { assert.ok(['main', 'sidebar.panellist'].includes(name)); callback() },
      register(definition, Component) { registered.push({ definition, Component }) }
    }
  }
  module.apply(ctx)
  return { registered, styles, ctx, clipboardWrites, storage }
}

test('registers matching main and sidebar identifiers and embeds styles once', () => {
  const mounted = mount(async () => ({ ok: true, json: async () => ({ ok: true, value: { configured: false } }) }))
  assert.equal(mounted.registered[0].definition.key, 'zentao-ledger')
  assert.equal(mounted.registered[1].definition.id, 'zentao-ledger')
  assert.equal(mounted.styles.length, 1)
  assert.match(mounted.styles[0].textContent, /zt-workspace/)
  assert.equal(mounted.styles[0].textContent, readFileSync(new URL('../client.css', import.meta.url), 'utf8'))
})

test('status request uses authenticated same-origin host RPC', async () => {
  const requests = []
  const mounted = mount(async (url, options) => {
    requests.push({ url: String(url), options })
    return { ok: true, json: async () => ({ ok: true, value: { configured: false } }) }
  })
  const main = mounted.registered[0]
  const wrapper = main.Component()
  wrapper.type(wrapper.props)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://127.0.0.1:59060/api/zentao-ledger/rpc')
  assert.equal(requests[0].options.credentials, 'same-origin')
  assert.deepEqual(JSON.parse(requests[0].options.body), { method: 'status', args: {} })
  assert.equal(source.includes('dangerouslySetInnerHTML'), false)
})

function recoveryFixture(resultFor) {
  const states = []
  const refs = []
  let stateCursor = 0, refCursor = 0
  const calls = []
  const effects = []
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(initial) {
      const index = stateCursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect(effect) { effects.push(effect) },
    useMemo(factory) { return factory() },
    useRef(initial) { const index = refCursor++; return refs[index] ||= { current: initial } }
  }
  const mounted = mount(async (_url, options) => {
    const body = options.body instanceof FormData ? {
      method: 'media', url: String(_url), operation: options.body.get('operation') || '',
      names: options.body.getAll('media').map(file => file.name),
      ...(options.body.get('editor') ? { editor: JSON.parse(options.body.get('editor')) } : {}),
      ...(options.body.get('bugId') ? { bugId: options.body.get('bugId'), comment: options.body.get('comment'), confirmation: JSON.parse(options.body.get('confirmation')) } : {})
    } : JSON.parse(options.body)
    calls.push(body)
    let result = resultFor(body)
    if (result && body.method === 'editor') result = { origin: demoSite.origin, ...result }
    if (result && ['status', 'configure', 'disconnect'].includes(body.method)) result = { site: demoSite, ...result, ...(result.identity ? { identity: { origin: demoSite.origin, ...result.identity } } : {}) }
    return { ok: true, json: async () => result && result.__error ? { ok: false, error: result.fields ? { code: result.__error, fields: result.fields } : result.__error } : { ok: true, value: result } }
  }, React)
  states[0] = { connected: true, configured: true, account: 'reporter', userId: '42' }
  states[4] = true
  states[19] = {
    mode: 'create', id: '', origin: demoSite.origin, context: demoContext, storageScope: demoScope, data: { products: { '9': '示例产品' }, projects: { '17': '示例项目' }, builds: { '8': '示例版本' } }, raw: {},
    fields: { product: '9', branch: '0', module: '0', project: '17', execution: '0', title: '安全回读测试',
      assignedTo: '', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: ['8'],
      descriptionAction: 'replace', description: '仅模拟提交，不调用真实禅道。', comment: '' }
  }
  states[20] = 'review'
  const wrapper = mounted.registered[0].Component()
  function render() { stateCursor = 0; refCursor = 0; if (states[0]) states[0] = { site: demoSite, origin: demoSite.origin, ...states[0] }; return wrapper.type(wrapper.props) }
  function findButton(tree, label) {
    if (!tree || typeof tree !== 'object') return null
    if (Array.isArray(tree)) return tree.map(node => findButton(node, label)).find(Boolean)
    if (tree.type === 'button' && tree.children.some(child => typeof child === 'string' && child.includes(label))) return tree
    return findButton(tree.children, label)
  }
  return { states, refs, calls, effects, render, findButton, ctx: mounted.ctx, clipboardWrites: mounted.clipboardWrites, storage: mounted.storage }
}

test('all requirements entry opens the supplied ZenTao page without creating a requirement', () => {
  const fixture = recoveryFixture(() => { throw new Error('Rendering the link must not call ZenTao') })
  const findLink = node => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(findLink).find(Boolean)
    if (node.type === 'a' && node.children.includes('原站需求页 ↗')) return node
    return findLink(node.children)
  }
  for (const state of [{ connected: false }, { connected: true, account: 'reporter', userId: '42' }]) {
    fixture.states[0] = state
    const link = findLink(fixture.render())
    assert.ok(link)
    assert.equal(link.props.href, 'https://zentao.example/product-browse-9.html')
    assert.equal(link.props.target, '_blank')
    assert.equal(link.props.rel, 'noopener noreferrer')
    assert.match(link.props['aria-label'], /查看所有需求或创建需求/)
  }
  assert.equal(fixture.calls.length, 0)
})

test('requirements tab embeds a read-only configured product list and opens records on ZenTao', async () => {
  const fixture = recoveryFixture(body => {
    assert.equal(body.method, 'listStories')
    assert.equal(body.args.page, 1)
    return { product: '9', stories: [{ id: '1302', title: '示例需求', type: 'story', status: 'active' }], page: 1, pages: 2, total: 30 }
  })
  const switcher = fixture.findButton(fixture.render(), '所有需求')
  assert.ok(switcher)
  switcher.props.onClick()
  const screen = fixture.render()
  const internal = screen.children.find(node => node?.type?.name === 'RequirementsView')
  assert.ok(internal, 'requirements render inside the ledger, rather than an iframe')
  assert.equal(screen.children.some(node => node?.type === 'iframe'), false)
  internal.type(internal.props)
  fixture.effects.at(-1)()
  await new Promise(resolve => setImmediate(resolve))
  const after = fixture.render().children.find(node => node?.type?.name === 'RequirementsView')
  const rendered = after.type(after.props)
  const serialized = JSON.stringify(rendered)
  assert.match(serialized, /示例需求/)
  assert.match(serialized, /story-view-1302-0-0-story.html/)
  assert.match(serialized, /原站查看 \/ 新建需求/)
  assert.deepEqual(fixture.calls.map(call => call.method), ['listStories'])
})

test('restores the resolved tab before requesting its report list', async () => {
  const fixture = recoveryFixture(body => {
    if (body.method === 'status') return { configured: true, preferredView: 'resolved', identity: { account: 'reporter', userId: '42' } }
    if (body.method === 'listReports') return { page: 1, pages: 1, bugs: [] }
    throw Error('unexpected method ' + body.method)
  })
  fixture.states[4] = false
  fixture.render()
  fixture.effects.find(effect => effect.name === 'restoreEntry')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[3], 'resolved')
  assert.equal(fixture.states[4], true)
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'loadReports')()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['status', 'listReports'])
  assert.equal(fixture.calls[1].args.status, 'resolved')
})

test('switching to resolved persists the tab without changing login credentials', async () => {
  const fixture = recoveryFixture(body => {
    if (body.method === 'status') return { configured: true, preferredView: 'active', identity: { account: 'reporter', userId: '42' } }
    if (body.method === 'setPreferredView') return { preferredView: body.args.view }
    throw Error('unexpected method ' + body.method)
  })
  fixture.states[4] = false
  fixture.render()
  fixture.effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  const resolved = fixture.findButton(fixture.render(), '已解决')
  assert.ok(resolved)
  resolved.props.onClick()
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'persistView')()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['status', 'setPreferredView'])
  assert.deepEqual(fixture.calls[1].args, { view: 'resolved' })
})

test('entry waits for saved credential restore before showing login form', () => {
  const fixture = recoveryFixture(() => { throw new Error('Unexpected request') })
  fixture.states[0] = null
  fixture.states[2] = ''
  const screen = JSON.stringify(fixture.render())
  assert.match(screen, /正在使用本机已保存的授权恢复会话/)
  assert.doesNotMatch(screen, /访问令牌/)
})

test('long ledger scrolls separately from paging and announces loading', () => {
  const fixture = recoveryFixture(() => { throw new Error('Rendering should not request data') })
  fixture.states[11] = true
  const screen = fixture.render()
  const ledger = screen.children.find(node => node?.props?.className === 'zt-columns')?.children[0]
  assert.ok(ledger)
  const content = ledger.children
  const scroller = content.find(node => node?.props?.className === 'zt-list-scroll')
  const pager = content.find(node => node?.props?.className === 'zt-pager')
  const status = content.find(node => node?.props?.role === 'status')
  assert.ok(scroller && pager && status)
  assert.equal(scroller.props.tabIndex, 0)
  assert.equal(scroller.props['aria-busy'], 'true')
  assert.match(JSON.stringify(status), /正在读取台账/)
  assert.ok(content.indexOf(scroller) < content.indexOf(pager))
  assert.equal(scroller.children.some(node => node?.props?.className === 'zt-pager'), false)
})

test('automatic saved-session restore clears stale token warning', async () => {
  const fixture = recoveryFixture(body => {
    assert.equal(body.method, 'status')
    return { configured: true, identity: { account: 'reporter', userId: '42' } }
  })
  fixture.states[2] = '请先填写可交换禅道会话的访问令牌。'
  fixture.render()
  fixture.effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[0].account, 'reporter')
  assert.equal(fixture.states[2], '')
  assert.deepEqual(fixture.calls.map(call => call.method), ['status'])
})

test('expired saved grant removes connected badge and offers reconnect', async () => {
  const fixture = recoveryFixture(body => {
    assert.equal(body.method, 'status')
    return { configured: true, error: 'authExpired' }
  })
  fixture.render()
  fixture.effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[0].connected, false)
  assert.equal(fixture.states[0].configured, true)
  assert.match(fixture.states[2], /重新连接/)
  assert.match(JSON.stringify(fixture.render()), /新的禅道授权令牌/)
})

test('expired list read revokes the connected badge during the same visit', async () => {
  const fixture = recoveryFixture(body => body.method === 'listReports'
    ? { __error: 'authExpired' }
    : body.method === 'status' ? { configured: true, error: 'authExpired' } : null)
  fixture.render()
  fixture.effects[4]()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['listReports', 'status'])
  assert.equal(fixture.states[0].connected, false)
  assert.match(fixture.states[2], /重新连接/)
  assert.doesNotMatch(JSON.stringify(fixture.render()), /reporter · 已连接/)
})

test('token connection sends only the session grant without a renewal adapter', async () => {
  const fixture = recoveryFixture(body => body.method === 'configure'
    ? { configured: true, identity: { account: 'reporter', userId: '42' } } : null)
  fixture.states[0] = { connected: false, configured: false }
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const nodes = visit(fixture.render())
  nodes.find(node => node.type === 'input' && node.props.type === 'password').props.ref.current = { value: 'mock-secret' }
  assert.equal(nodes.some(node => node.type === 'input' && node.props.type === 'checkbox'), false)
  nodes.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls, [{ method: 'configure', args: { token: 'mock-secret' } }])
})

test('empty token shows Chinese inline guidance without native browser validation', async () => {
  const fixture = recoveryFixture(() => { throw new Error('Empty token must not call Host') })
  fixture.states[0] = { connected: false, configured: false }
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean)
    return predicate(node) ? node : find(node.children, predicate)
  }
  const first = fixture.render()
  const input = find(first, node => node.type === 'input' && node.props.type === 'password')
  assert.ok(input)
  assert.equal(input.props.required, undefined)
  fixture.findButton(first, '连接禅道').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const alert = find(fixture.render(), node => node.props.role === 'alert')
  assert.ok(alert)
  assert.match(JSON.stringify(alert.children), /请先填写可交换禅道会话的访问令牌/)
  assert.equal(fixture.calls.length, 0)
})

test('verified commit uses host readback and blocks double submit', async () => {
  const fixture = recoveryFixture(body => {
    assert.equal(body.method, 'commit')
    return { id: '19', bug: { id: '19', title: '安全回读测试' } }
  })
  const confirm = fixture.findButton(fixture.render(), '确认提交')
  assert.ok(confirm)
  confirm.props.onClick()
  confirm.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['commit'])
  assert.equal(fixture.states[19], null)
  assert.equal(fixture.states[20], 'edit')
})

test('known ID without readback can retry GET only with original editor', async () => {
  const fixture = recoveryFixture(body => body.method === 'commit'
    ? { id: '19', readbackPending: true }
    : { bug: { id: '19', title: '安全回读测试' } })
  fixture.findButton(fixture.render(), '确认提交').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[20], 'savedPending')
  const retry = fixture.findButton(fixture.render(), '重试读取 Bug #19')
  assert.ok(retry)
  retry.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['commit', 'readback'])
  assert.equal(fixture.calls[1].args.id, '19')
  assert.equal(fixture.calls[1].args.editor.fields.title, '安全回读测试')
  assert.equal(fixture.states[19], null)
})

test('unknown write result keeps form locked against another POST', async () => {
  const fixture = recoveryFixture(() => ({ __error: 'writeUnknown' }))
  fixture.findButton(fixture.render(), '确认提交').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[20], 'uncertain')
  const tree = fixture.render()
  assert.ok(!fixture.findButton(tree, '确认提交'))
  assert.ok(!fixture.findButton(tree, '预览并核对'))
  assert.deepEqual(fixture.calls.map(call => call.method), ['commit'])
})

test('prewrite conflict unlocks and reopens fresh edit metadata without resubmitting', async () => {
  const fixture = recoveryFixture(body => body.method === 'commit'
    ? { __error: 'conflict' }
    : { data: { bug: { id: '19', title: '更新后的标题' } }, raw: { lastEditedDate: '2026-01-01' } })
  fixture.states[15] = '19'
  fixture.states[19].mode = 'edit'
  fixture.states[19].id = '19'
  fixture.findButton(fixture.render(), '确认提交').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[20], 'conflict')
  const reopen = fixture.findButton(fixture.render(), '重新打开编辑表单')
  assert.ok(reopen)
  reopen.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['commit', 'editor'])
  assert.deepEqual(fixture.calls[1].args, { mode: 'edit', fields: {}, id: '19' })
})

test('server field aliases display beside controls and unknown error stays plain text', async () => {
  const fixture = recoveryFixture(() => ({ __error: 'serverRejected', fields: {
    branch: '分支无效', module: '模块无效', execution: '执行无效', assignedTo: '负责人无效', severity: '严重程度无效',
    pri: '优先级无效', type: '类型无效', steps: '<b>描述无效</b>', 'openedBuild[]': '版本无效',
    unsupportedField: '<img src=x onerror=alert(1)>其他字段无效'
  } }))
  fixture.findButton(fixture.render(), '确认提交').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[20], 'edit')
  const errors = fixture.states[24]
  assert.equal(errors.branch, undefined)
  assert.equal(errors.module, undefined)
  assert.equal(errors.execution, undefined)
  assert.equal(errors.assignedTo, '负责人无效')
  assert.equal(errors.severity, '严重程度无效')
  assert.equal(errors.pri, '优先级无效')
  assert.equal(errors.type, '类型无效')
  assert.equal(errors.description, '描述无效')
  assert.equal(errors.openedBuild, '版本无效')
  assert.equal(errors.form, '分支无效；模块无效；执行无效；其他字段无效')
  assert.ok(fixture.findButton(fixture.render(), '预览并核对'))
  assert.deepEqual(fixture.calls.map(call => call.method), ['commit'])
})

test('ledger still renders after closing a creator-filtered editor', () => {
  const fixture = recoveryFixture(() => { throw Error('render must not request data') })
  fixture.states[19] = null
  fixture.states[25] = true
  fixture.states[27] = ['8']
  const screen = JSON.stringify(fixture.render())
  assert.match(screen, /禅道台账/)
  assert.doesNotMatch(screen, /TypeError/)
})

test('create form shows configured product and project ownership without hidden association controls', () => {
  const fixture = recoveryFixture(() => { throw Error('render must not call Host') })
  const editor = fixture.states[19]
  editor.data.products = { '9': 'Demo Product' }
  editor.data.projects = { '17': 'Demo Project' }
  Object.assign(editor.fields, { product: '9', project: '17', branch: '0', module: '0' })
  fixture.states[20] = 'edit'
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const screen = visit(fixture.render())
  const fixed = screen.filter(node => node.props.className === 'zt-fixed-value').map(node => node.children[0])
  const controls = screen.map(node => node.props.field).filter(Boolean)
  assert.deepEqual(Array.from(fixed), ['Demo Product', 'Demo Project'])
  assert.ok(['product', 'project', 'branch', 'module', 'execution'].every(field => !controls.includes(field)))
  assert.equal(fixture.calls.length, 0)
})

test('pasted screenshot queues locally with selected media and rejects unsupported images', () => {
  const fixture = recoveryFixture(() => { throw Error('pasting must not contact Host') })
  fixture.states[20] = 'edit'
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const zone = role => visit(fixture.render()).find(node => node.props.className === 'zt-field zt-media' && String(node.props['aria-label']).includes(role === 'expected' ? '预期结果' : '实际结果'))
  const screenshot = new File([Buffer.from([137, 80, 78, 71])], 'image.png', { type: 'image/png' })
  let prevented = 0
  zone('expected').props.onPaste({ clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => screenshot }] }, preventDefault: () => prevented++ })
  assert.equal(prevented, 1)
  assert.equal(fixture.states[32].length, 1)
  assert.match(fixture.states[32][0].name, /^粘贴图片-\d+-1\.png$/)
  assert.equal(fixture.states[32][0].type, 'image/png')
  assert.equal(fixture.calls.length, 0)
  const input = visit(fixture.render()).find(node => node.type === 'input' && node.props.type === 'file' && node.props['aria-label'].includes('实际结果'))
  input.props.onChange({ target: { files: [new File(['video'], 'demo.mp4', { type: 'video/mp4' })], value: 'demo.mp4' } })
  assert.equal(fixture.states[32].length, 2)
  const description = visit(fixture.render()).find(node => node.type === 'textarea' && node.props.placeholder?.includes('粘贴截图'))
  let mixedPrevented = false
  description.props.onPaste({ clipboardData: { items: [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/png', getAsFile: () => screenshot }] }, preventDefault: () => { mixedPrevented = true } })
  assert.equal(mixedPrevented, false, 'text in mixed paste should remain in the description')
  assert.equal(fixture.states[32].length, 3)
  zone('expected').props.onPaste({ clipboardData: { items: [{ kind: 'file', type: 'image/webp', getAsFile: () => new File(['webp'], 'image.webp', { type: 'image/webp' }) }] }, preventDefault: () => prevented++ })
  assert.equal(fixture.states[32].length, 3, 'unsupported image must not be queued')
  assert.match(fixture.states[23], /文件格式或内容/)
  assert.equal(fixture.calls.length, 0)
})

test('assignee options show all by default and support explicit site exclusions and search', () => {
  const fixture = recoveryFixture(() => { throw Error('assignee filtering must stay local') })
  fixture.states[20] = 'edit'
  fixture.states[19].data.productMembers = { '': '请选择', demo_owner: 'Demo Owner', demo_reviewer: 'Demo Reviewer', demo_admin: 'Demo Admin' }
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const assignee = () => { const component = visit(fixture.render()).find(node => node.props.field === 'assignedTo'); return component.type(component.props) }
  const options = () => visit(assignee()).filter(node => node.type === 'option').map(node => node.children[0])
  assert.deepEqual(options(), ['请选择', 'Demo Owner', 'Demo Reviewer', 'Demo Admin'])
  fixture.states[0].site = { ...demoSite, excludedAssignees: ['demo_admin'] }
  assert.deepEqual(options(), ['请选择', 'Demo Owner', 'Demo Reviewer'])
  visit(assignee()).find(node => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value: 'reviewer' } })
  assert.deepEqual(options(), ['请选择', 'Demo Reviewer'])
  fixture.states[19].fields.assignedTo = 'demo_admin'
  assert.deepEqual(options(), ['Demo Reviewer', 'Demo Admin'])
  assert.equal(fixture.calls.length, 0)
})

test('selected media stays local through review and can be removed before submission', () => {
  const fixture = recoveryFixture(() => { throw Error('selecting a file must not contact Host') })
  const editor = fixture.states[19]
  editor.data.products = { '9': 'Demo Product' }
  editor.data.projects = { '17': 'Demo Project' }
  Object.assign(editor.fields, { product: '9', project: '17', branch: '0', module: '0', execution: '0' })
  fixture.states[20] = 'edit'
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== 'object') return null
    if (Array.isArray(tree)) return tree.map(node => find(node, predicate)).find(Boolean)
    return predicate(tree) ? tree : find(tree.children, predicate)
  }
  const upload = find(fixture.render(), node => node.type === 'input' && node.props.type === 'file' && /mp4/.test(node.props.accept))
  assert.match(upload.props.accept, /\.mp4/)
  const target = { files: [{ name: 'demo.mp4', size: 1024, type: 'video/mp4' }], value: 'demo.mp4' }
  upload.props.onChange({ target })
  assert.equal(target.value, '')
  assert.equal(fixture.states[32].length, 1)
  assert.equal(fixture.calls.length, 0)
  find(fixture.render(), node => node.type === 'form' && node.props.className === 'zt-form').props.onSubmit({ preventDefault() {} })
  assert.equal(fixture.states[20], 'review')
  assert.match(JSON.stringify(fixture.render()), /demo.mp4/)
  fixture.findButton(fixture.render(), '返回修改').props.onClick()
  const mediaItem = find(fixture.render(), node => typeof node.type === 'function' && node.type.name === 'LocalMediaPreview')
  assert.equal(mediaItem.props.file.name, 'demo.mp4')
  mediaItem.props.onRemove(mediaItem.props.file)
  assert.equal(fixture.states[32].length, 0)
  assert.equal(fixture.calls.length, 0)
})

test('media ordering controls the multipart submission order and review shows image previews', async () => {
  const fixture = recoveryFixture(body => body.method === 'media' ? { id: '42', bug: { id: '42', title: '安全回读测试' } } : { __error: 'unexpected' })
  fixture.states[19].data.products = { '9': 'Demo Product' }
  fixture.states[19].data.projects = { '17': 'Demo Project' }
  Object.assign(fixture.states[19].fields, { product: '9', project: '17', branch: '0', module: '0', execution: '0' })
  fixture.states[20] = 'edit'
  const files = ['第一张.png', '第二张.png', '第三张.png'].map(name => {
    const file = new File([Buffer.from([137, 80, 78, 71])], name, { type: 'image/png' })
    file.role = 'actual'
    return file
  })
  fixture.states[32] = files
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const editItems = visit(fixture.render()).filter(node => typeof node.type === 'function' && node.type.name === 'LocalMediaPreview')
  assert.deepEqual(editItems.map(node => node.props.file.name), ['第一张.png', '第二张.png', '第三张.png'])
  editItems[1].props.onMove(editItems[1].props.file, -1)
  assert.equal(Array.from(fixture.states[32], file => file.name).join('|'), '第二张.png|第一张.png|第三张.png')
  fixture.states[20] = 'review'
  const reviewItems = visit(fixture.render()).filter(node => typeof node.type === 'function' && node.type.name === 'LocalMediaPreview' && node.props.compact)
  assert.deepEqual(reviewItems.map(node => node.props.file.name), ['第二张.png', '第一张.png', '第三张.png'])
  assert.ok(reviewItems.every(node => node.props.label === '实际结果'))
  fixture.findButton(fixture.render(), '确认提交').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const submission = fixture.calls.find(call => call.method === 'media')
  assert.deepEqual(submission.names, ['第二张.png', '第一张.png', '第三张.png'])
})

test('local image previews create and revoke temporary object URLs', () => {
  assert.match(source, /URL\.createObjectURL\(file\)/)
  assert.match(source, /URL\.revokeObjectURL\?\.\(next\)/)
  assert.match(source, /zt-media-item:hover \.zt-media-hover/)
})

test('review media uses a full evidence preview with an original-image link', () => {
  assert.match(source, /className: 'zt-review-media-visual'/)
  assert.match(source, /'aria-label': `查看原图：\$\{file\.name\}`/)
  assert.match(source, /className: 'zt-review-media-caption'/)
  assert.match(source, /点击查看原图/)
  assert.match(readFileSync(new URL('../client.css', import.meta.url), 'utf8'), /\.zt-review-media-visual img\{[^}]*object-fit:contain/)
})

test('Bug detail loads every safe image and numbers the complete evidence sequence', () => {
  assert.match(source, /const imageTotal = lines\.filter\(item => item\.kind === 'image'\)\.length/)
  assert.match(source, /index: \+\+imageIndex, total: imageTotal/)
  assert.match(source, /`图片 \$\{index\} \/ \$\{total\}`/)
  assert.match(source, /className: 'zt-image-link'/)
  assert.doesNotMatch(source, /new IntersectionObserver/)
  assert.match(readFileSync(new URL('../client.css', import.meta.url), 'utf8'), /\.zt-image-link img,[^{]*\{[^}]*max-height:none[^}]*object-fit:contain/)
})

test('confirmed media uses the authenticated multipart route and definite rejection unlocks editing', async () => {
  const fixture = recoveryFixture(body => body.method === 'media' ? { __error: 'invalidMedia' } : { __error: 'unexpected' })
  fixture.states[20] = 'review'
  fixture.states[32] = [new File([Buffer.from([137, 80, 78, 71])], 'demo.png', { type: 'image/png' })]
  fixture.findButton(fixture.render(), '确认提交').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.calls.length, 1)
  assert.equal(fixture.calls[0].method, 'media')
  assert.equal(fixture.calls[0].url, 'http://127.0.0.1:59060/api/zentao-ledger/media')
  assert.deepEqual(fixture.calls[0].names, ['demo.png'])
  assert.equal(fixture.states[20], 'edit')
  assert.match(fixture.states[23], /文件格式或内容/)
})

test('image authorization check reports readiness without attempting a write', async () => {
  const fixture = recoveryFixture(body => body.method === 'mediaUploadStatus' ? { ready: true, account: 'reporter' } : { __error: 'unexpected' })
  fixture.states[20] = 'edit'
  const button = fixture.findButton(fixture.render(), '检查图片上传授权')
  assert.ok(button)
  button.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['mediaUploadStatus'])
  assert.equal(fixture.states[35].state, 'ready')
  assert.match(fixture.states[35].text, /尚未上传图片或提交 Bug/)
})

test('applied AI suggestion offers one explicit direct submit without another preview', async () => {
  const fixture = recoveryFixture(body => body.method === 'optimizeDraft'
    ? { title: '优化后的标题', description: '概述\n操作步骤：1. 打开页面', model: 'test-model' }
    : body.method === 'commit' ? { id: '42', bug: { id: '42', title: '优化后的标题' } }
    : { __error: 'unexpected' })
  fixture.states[19].data.products = { '9': 'Demo Product' }
  fixture.states[19].data.projects = { '17': 'Demo Project' }
  Object.assign(fixture.states[19].fields, { product: '9', project: '17', branch: '0', module: '0', execution: '0', title: '需要优化的标题', description: '当前描述' })
  fixture.storage.set('dsh-zentao-ledger:draft-box:' + demoScope, JSON.stringify({ v: 1, drafts: [{ id: 'draft_other', at: Date.now(), fields: { title: '另一条未提交 Bug' } }] }))
  fixture.findButton(fixture.render(), '交给 AI 优化描述').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['optimizeDraft'])
  assert.equal(fixture.calls[0].args.title, '需要优化的标题')
  assert.equal(fixture.calls[0].args.description, '当前描述')
  assert.deepEqual(fixture.calls[0].args.images, [])
  assert.equal(fixture.states[20], 'review', 'the suggestion must not auto-submit')
  assert.match(JSON.stringify(fixture.render()), /test-model/)
  fixture.findButton(fixture.render(), '应用建议并返回修改').props.onClick()
  assert.equal(fixture.states[20], 'edit')
  assert.equal(fixture.states[19].fields.title, '优化后的标题')
  assert.match(fixture.states[19].fields.description, /操作步骤/)
  assert.equal(fixture.calls.filter(call => call.method === 'commit').length, 0)
  const direct = fixture.findButton(fixture.render(), '直接提交')
  assert.ok(direct)
  direct.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.calls.filter(call => call.method === 'commit').length, 1)
  assert.equal(fixture.calls.find(call => call.method === 'commit').args.confirmation.title, '优化后的标题')
  assert.deepEqual(JSON.parse(fixture.storage.get('dsh-zentao-ledger:draft-box:' + demoScope)).drafts.map(draft => draft.id), ['draft_other'])
})

test('AI failure keeps the original draft untouched', async () => {
  const fixture = recoveryFixture(() => ({ __error: 'aiUnavailable' }))
  fixture.findButton(fixture.render(), '交给 AI 优化描述').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[19].fields.title, '安全回读测试')
  assert.equal(fixture.states[20], 'review')
  assert.match(JSON.stringify(fixture.render()), /AI 优化未完成/)
  assert.equal(fixture.calls.filter(call => call.method === 'commit').length, 0)
})

test('known receipt allows read-only tabs while keeping create action disabled', () => {
  const fixture = recoveryFixture(() => { throw Error('render must not write') })
  fixture.states[20] = 'savedPending'
  fixture.states[21] = '13484'
  fixture.render()
  fixture.refs[4].current = true
  const screen = fixture.render()
  assert.equal(fixture.findButton(screen, '新建 Bug').props.disabled, true)
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  assert.equal(visit(screen).find(node => node.type === 'button' && node.props.role === 'tab')?.props.disabled, false)
  assert.ok(fixture.findButton(screen, '只读重试 Bug #13484'))
})

test('confirmed pending readback unlocks create without repeating submit', async () => {
  const fixture = recoveryFixture(body => body.method === 'readback' ? { bug: { id: '13484', title: '已保存' }, actions: [] } : { __error: 'unexpected' })
  fixture.states[20] = 'savedPending'
  fixture.states[21] = '13484'
  fixture.render()
  fixture.refs[4].current = true
  fixture.findButton(fixture.render(), '只读重试 Bug #13484').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['readback'])
  assert.equal(fixture.states[21], '')
  assert.equal(fixture.refs[4].current, false)
  assert.equal(fixture.findButton(fixture.render(), '新建 Bug').props.disabled, false)
})

test('rejected image upload leaves the failed Bug draft and chosen screenshot intact', async () => {
  const fixture = recoveryFixture(body => body.method === 'media' ? { __error: 'mediaUploadFailed' } : { __error: 'unexpected' })
  fixture.states[20] = 'review'
  fixture.states[19].fields.title = '提交 bug 测试'
  fixture.states[19].fields.openedBuild = ['8']
  fixture.states[19].fields.description = '现场复现步骤'
  fixture.states[32] = [new File([Buffer.from([137, 80, 78, 71])], '壁纸截图.png', { type: 'image/png' })]
  fixture.findButton(fixture.render(), '确认提交').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.map(call => call.method), ['media'])
  assert.equal(fixture.states[20], 'edit')
  assert.equal(fixture.states[19].fields.title, '提交 bug 测试')
  assert.deepEqual(Array.from(fixture.states[19].fields.openedBuild), ['8'])
  assert.equal(fixture.states[19].fields.description, '现场复现步骤')
  assert.equal(fixture.states[32][0].name, '壁纸截图.png')
  assert.match(fixture.states[23], /已通过本地格式和大小检查/)
})

test('create form requests configured context and rejects stale zero-context Host replies', async () => {
  const stale = recoveryFixture(() => ({ mode: 'create', context: demoContext, data: { productID: '0', projectID: '0', products: { '9': 'Demo Product' }, projects: { '0': '' }, builds: { '1': '无关构建' } }, fields: { product: '0', project: '0', branch: '0', module: '0', execution: '0' } }))
  stale.findButton(stale.render(), '新建 Bug').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(stale.calls[0], { method: 'editor', args: { mode: 'create', fields: { product: '9', project: '17', branch: '0', module: '0', execution: '0' }, id: '' } })
  assert.equal(stale.states[19], null)
  assert.match(stale.states[23], /归属暂不可用/)
  const current = recoveryFixture(() => ({ mode: 'create', context: demoContext, data: { productID: '9', projectID: '17', products: { '9': 'Demo Product' }, projects: { '17': 'Demo Project' }, builds: { '8': '版本' } }, fields: { product: '9', project: '17', branch: '0', module: '0', execution: '0' } }))
  current.findButton(current.render(), '新建 Bug').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(current.states[19].fields.product, '9')
  assert.equal(current.states[19].fields.project, '17')
  assert.equal(current.states[19].fields.execution, '0')
})

test('opening an editor resets the build chooser to its newest entries', () => {
  const fixture = recoveryFixture(() => { throw Error('scroll reset must not request data') })
  fixture.states[20] = 'edit'
  fixture.states[42] = 1
  const visit = node => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(visit).find(Boolean)
    if (node.props?.className === 'zt-builds') return node
    return visit(node.children)
  }
  const chooser = visit(fixture.render())
  assert.ok(chooser)
  chooser.props.ref.current = { scrollTop: 640 }
  fixture.effects.findLast(effect => effect.name === 'resetBuildScroll')()
  assert.equal(chooser.props.ref.current.scrollTop, 0)
})

test('build chooser shows every candidate newest first while preserving search and selection', () => {
  const fixture = recoveryFixture(() => { throw Error('sorting must not call Host') })
  fixture.states[19].data.builds = Object.fromEntries([
    ...Array.from({ length: 120 }, (_, index) => [String(index + 1), `候选 ${index + 1}`]),
    ['trunk', '主干']
  ])
  fixture.states[19].fields.openedBuild = ['2']
  fixture.states[20] = 'edit'
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== 'object') return null
    if (Array.isArray(tree)) return tree.map(node => find(node, predicate)).find(Boolean)
    return predicate(tree) ? tree : find(tree.children, predicate)
  }
  const candidates = () => find(fixture.render(), node => node.props.className === 'zt-builds').children[0]
  const all = candidates()
  assert.equal(all.length, 121)
  assert.equal(all[0].children[0].props.checked, false)
  assert.equal(all[0].children[1], '候选 120')
  assert.equal(all.at(-1).children[1], '主干')
  assert.ok(all.find(node => node.children[1] === '候选 2').children[0].props.checked)
  fixture.states[26] = '120'
  assert.equal(candidates().length, 1)
  assert.equal(candidates()[0].children[1], '候选 120')
  assert.deepEqual(fixture.states[19].fields.openedBuild, ['2'])
  assert.equal(fixture.calls.length, 0)
})

test('detail shows creator names and connection name while retaining account fallback', () => {
  const fixture = recoveryFixture(() => { throw Error('display must not call Host') })
  fixture.states[0] = { connected: true, configured: true, account: 'demo_account_2', userId: '42', realname: 'Demo Owner' }
  fixture.states[15] = '13471'
  fixture.states[19] = null
  fixture.states[16] = { bug: { id: '13471', title: '显示姓名', status: 'active', openedBy: 'demo_account_2', assignedTo: 'demo_account_3' }, data: { users: { demo_account_2: 'Demo Owner', demo_account_3: 'Demo Reviewer' } }, actions: [], histories: [] }
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const tree = visit(fixture.render())
  const connected = tree.find(node => String(node.props.className || '').includes('zt-connection'))
  assert.equal(connected.children[1], 'Demo Owner · 已连接')
  assert.equal(connected.props.title, '禅道账号：demo_account_2')
  const fact = label => tree.find(node => node.type === 'div' && node.children[0]?.type === 'dt' && node.children[0].children[0] === label)?.children[1]?.children[0]
  assert.equal(fact('创建人'), 'Demo Owner')
  assert.equal(fact('负责人'), 'Demo Reviewer')
  assert.doesNotMatch(JSON.stringify(tree), /报告人/)
  fixture.states[16] = { bug: { id: '13471', title: '无姓名映射', status: 'active', openedBy: 'demo_account_2' }, data: { users: {} }, actions: [], histories: [] }
  assert.match(JSON.stringify(fixture.render()), /demo_account_2/)
  fixture.states[0] = { connected: true, configured: true, account: 'demo_account_2', userId: '42' }
  assert.match(JSON.stringify(fixture.render()), /demo_account_2 · 已连接/)
  fixture.states[16].data.users = { demo_account_2: 'Demo Owner' }
  assert.equal(visit(fixture.render()).find(node => String(node.props.className || '').includes('zt-connection')).children[1], 'Demo Owner · 已连接')
  assert.equal(fixture.calls.length, 0)
})

test('history shows real names, Chinese operations and resolution labels', () => {
  const fixture = recoveryFixture(() => { throw Error('history rendering must not call Host') })
  fixture.states[15] = '13504'
  fixture.states[19] = null
  fixture.states[16] = {
    bug: { id: '13504', title: '兼任员工待写问题', status: 'resolved' },
    data: { users: { demo_account_2: 'Demo Owner', demo_account_4: 'Demo Developer' } },
    actions: [
      { id: '69347', actor: 'demo_account_2', action: 'opened', date: '2026-11-07 18:02:15', comment: '' },
      { id: '69348', actor: 'demo_account_4', action: 'resolved', date: '2026-11-07 18:22:30', extra: 'bydesign', comment: '' }
    ], histories: []
  }
  const tree = fixture.render()
  const text = node => node == null || node === false ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node.children)
  const visible = text(tree)
  assert.match(visible, /Demo Owner · 创建了 Bug/)
  assert.match(visible, /Demo Developer · 解决了 Bug/)
  assert.match(visible, /解决方案：设计如此/)
  assert.match(visible, /2026-11-07 18:22:30/)
  assert.doesNotMatch(visible, /demo_account_2|demo_account_4|暂无内容|bydesign|opened|resolved/)
  assert.equal(fixture.calls.length, 0)
})

test('unknown history actions stay readable without exposing English action codes', () => {
  const fixture = recoveryFixture(() => { throw Error('history rendering must not call Host') })
  fixture.states[15] = '13505'
  fixture.states[19] = null
  fixture.states[16] = { bug: { id: '13505', title: '未知动作', status: 'active' }, data: { users: { dev: '开发者' } }, actions: [{ id: '1', actor: 'dev', action: 'customAction', date: '2026-11-08 10:00:00' }], histories: [] }
  const text = node => node == null || node === false ? '' : typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : text(node.children)
  const visible = text(fixture.render())
  assert.match(visible, /开发者 · 更新了 Bug/)
  assert.doesNotMatch(visible, /customAction|暂无内容/)
})

test('detail Bug ID copies only its validated ZenTao URL', async () => {
  const fixture = recoveryFixture(() => { throw Error('copy must not call Host') })
  fixture.states[15] = '13485'
  fixture.states[16] = { bug: { id: '13485', title: '提醒问题', status: 'active' }, actions: [], histories: [] }
  fixture.states[19] = null
  fixture.findButton(fixture.render(), '#13485').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.clipboardWrites, ['https://zentao.example/bug-view-13485.html'])
  assert.match(JSON.stringify(fixture.render()), /链接已复制/)
  fixture.states[16] = { bug: { id: '13485?token=private', title: '异常编号', status: 'active' }, actions: [] }
  assert.equal(fixture.findButton(fixture.render(), '#13485?token=private'), undefined)
  assert.equal(fixture.clipboardWrites.length, 1)
  assert.equal(fixture.calls.length, 0)
})

test('detail opens only a validated Bug ID at the configured ZenTao origin', () => {
  const fixture = recoveryFixture(() => { throw Error('web link must not call Host') })
  fixture.states[15] = '13462'
  fixture.states[16] = { bug: { id: '13462', title: '示例问题', status: 'active' }, actions: [], histories: [] }
  fixture.states[19] = null
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean)
    return predicate(node) ? node : find(node.children, predicate)
  }
  const link = find(fixture.render(), node => node.type === 'a' && node.children.includes('在禅道打开'))
  assert.ok(link)
  assert.equal(link.props.href, 'https://zentao.example/bug-view-13462.html')
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noopener noreferrer')
  assert.equal(link.props['aria-label'], '在禅道网页打开 Bug #13462')
  const links = () => {
    const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [...(node.type === 'a' && node.props.href?.startsWith('https://zentao.example/bug-') ? [node] : []), ...visit(node.children)]
    return visit(fixture.render())
  }
  assert.deepEqual(links().map(node => node.props.href), [
    'https://zentao.example/bug-view-13462.html', 'https://zentao.example/bug-edit-13462.html'
  ])
  fixture.states[16] = { bug: { id: '13462', title: '示例问题', status: 'resolved' }, actions: [], histories: [] }
  assert.deepEqual(links().map(node => node.props.href), [
    'https://zentao.example/bug-view-13462.html', 'https://zentao.example/bug-edit-13462.html',
    'https://zentao.example/bug-activate-13462.html', 'https://zentao.example/bug-close-13462.html'
  ])
  fixture.states[16] = { bug: { id: '13462', title: '示例问题', status: 'closed' }, actions: [], histories: [] }
  assert.deepEqual(links().map(node => node.props.href), [
    'https://zentao.example/bug-view-13462.html', 'https://zentao.example/bug-edit-13462.html',
    'https://zentao.example/bug-activate-13462.html'
  ])
  assert.ok(links().every(node => node.props.target === '_blank' && node.props.rel === 'noopener noreferrer' && node.props.className === 'zt-button'))
  assert.equal(fixture.calls.length, 0)
  fixture.states[16] = { bug: { id: '13462?token=private', title: '异常编号', status: 'resolved' }, actions: [], histories: [] }
  assert.equal(links().length, 0)
})

test('close action is absent for active and closed Bugs', () => {
  const fixture = recoveryFixture(() => { throw Error('render must not request Host') })
  fixture.states[15] = '13478'
  fixture.states[19] = null
  for (const status of ['active', 'closed']) {
    fixture.states[16] = { bug: { id: '13478', title: '滚动问题', status }, actions: [], histories: [] }
    assert.equal(fixture.findButton(fixture.render(), '验收后关闭 Bug'), undefined)
  }
  assert.equal(fixture.calls.length, 0)
})

test('resolved Bug closes only after explicit in-panel confirmation', async () => {
  const fixture = recoveryFixture(body => body.method === 'closeBug'
    ? { id: '13478', status: 'closed', actionId: '70123', closedBy: 'reporter' }
    : body.method === 'details' ? { bug: { id: '13478', title: '滚动问题', status: 'closed' }, actions: [] } : null)
  fixture.states[15] = '13478'
  fixture.states[16] = { bug: { id: '13478', title: '滚动问题', status: 'resolved' }, actions: [], histories: [] }
  fixture.states[19] = null
  fixture.findButton(fixture.render(), '验收后关闭 Bug').props.onClick()
  assert.equal(fixture.calls.length, 0)
  const review = fixture.render()
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(item => find(item, predicate)).find(Boolean)
    return predicate(node) ? node : find(node.children, predicate)
  }
  const confirm = fixture.findButton(review, '确认关闭 Bug #13478')
  assert.equal(confirm.props.disabled, true)
  find(review, node => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === false)?.props.onChange({ target: { checked: true } })
  const enabled = fixture.findButton(fixture.render(), '确认关闭 Bug #13478')
  assert.equal(enabled.props.disabled, false)
  enabled.props.onClick(); enabled.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.calls.filter(call => call.method === 'closeBug').length, 1)
  assert.deepEqual(fixture.calls[0].args.confirmation, { action: 'closeBug', id: '13478', title: '滚动问题', status: 'resolved', origin: demoSite.origin, account: 'reporter', userId: '42' })
  assert.equal(fixture.states[33]['13478'].stage, 'closed')
})

test('close confirmation keeps acceptance screenshots local until one multipart close request', async () => {
  const fixture = recoveryFixture(body => body.method === 'media' && body.operation === 'closeBug'
    ? { id: '13478', status: 'closed', actionId: '70125', closedBy: 'reporter' }
    : body.method === 'details' ? { bug: { id: '13478', title: '滚动问题', status: 'closed' }, actions: [] }
    : { __error: 'unexpected' })
  fixture.states[15] = '13478'
  fixture.states[16] = { bug: { id: '13478', title: '滚动问题', status: 'resolved' }, actions: [], histories: [] }
  fixture.states[19] = null
  fixture.findButton(fixture.render(), '验收后关闭 Bug').props.onClick()
  const visit = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(visit) : [node, ...visit(node.children)]
  const file = new File([Buffer.from([137, 80, 78, 71])], '验收通过.png', { type: 'image/png' })
  const input = visit(fixture.render()).find(node => node.type === 'input' && node.props['aria-label'] === '选择验收截图')
  const target = { files: [file], value: '验收通过.png' }
  input.props.onChange({ target })
  assert.equal(target.value, '')
  assert.equal(fixture.calls.length, 0, 'selecting evidence must stay local')
  assert.match(JSON.stringify(fixture.render()), /验收通过\.png/)
  fixture.states[33]['13478'].confirmed = true
  fixture.findButton(fixture.render(), '确认关闭 Bug #13478').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const close = fixture.calls.find(call => call.method === 'media')
  assert.equal(close.operation, 'closeBug')
  assert.equal(close.bugId, '13478')
  assert.deepEqual(close.names, ['验收通过.png'])
  assert.equal(close.confirmation.action, 'closeBug')
  assert.equal(fixture.calls.filter(call => call.method === 'media').length, 1)
})

test('uncertain close only offers read-only reconciliation', async () => {
  const fixture = recoveryFixture(body => body.method === 'closeBug' ? { __error: 'writeUnknown' }
    : body.method === 'reconcileClose' ? { id: '13478', status: 'closed', actionId: '70124' } : null)
  fixture.states[15] = '13478'
  fixture.states[16] = { bug: { id: '13478', title: '滚动问题', status: 'resolved' }, actions: [], histories: [] }
  fixture.states[19] = null
  fixture.findButton(fixture.render(), '验收后关闭 Bug').props.onClick()
  fixture.states[33]['13478'].confirmed = true
  fixture.findButton(fixture.render(), '确认关闭 Bug #13478').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[33]['13478'].stage, 'uncertain')
  assert.equal(fixture.findButton(fixture.render(), '验收后关闭 Bug').props.disabled, true)
  fixture.findButton(fixture.render(), '只读核对关闭结果').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.filter(call => ['closeBug', 'reconcileClose'].includes(call.method)).map(call => call.method), ['closeBug', 'reconcileClose'])
})

test('acceptance draft is editable local text with no remote write', () => {
  const fixture = recoveryFixture(() => { throw Error('draft must not call host') })
  fixture.states[15] = '19'
  fixture.states[16] = { bug: { id: '19', title: '示例问题', status: 'resolved' }, actions: [], histories: [] }
  fixture.states[19] = null
  fixture.findButton(fixture.render(), '填写验收记录模板').props.onClick()
  assert.equal(fixture.states[29], true)
  assert.match(fixture.states[30], /Bug #19 示例问题/)
  assert.match(fixture.states[30], /测试范围：\n实测结果：\n结论：\n未测项：/)
  assert.equal(fixture.calls.length, 0)
})

test('re-entering restores the page, search text and open Bug', async () => {
  const fixture = recoveryFixture(body => {
    if (body.method === 'status') return { configured: true, identity: { account: 'reporter', userId: '42' }, preferredView: 'active', preferredPlace: { view: 'active', page: 2, bugId: '13485', query: '登录' } }
    if (body.method === 'listReports') return { page: body.args.page, pages: 3, bugs: body.args.page === 2 ? [{ id: '13485', title: '提醒', status: 'active' }] : [] }
    if (body.method === 'details') return { bug: { id: '13485', title: '提醒', status: 'active' }, actions: [], histories: [] }
    throw Error('unexpected ' + body.method)
  })
  fixture.states[4] = false
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'restoreEntry')()
  await new Promise(resolve => setImmediate(resolve))
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'loadReports')()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.filter(call => call.method === 'listReports').map(call => call.args.page), [1, 2])
  assert.equal(fixture.states[15], '13485', 'the previously open Bug is selected again')
  assert.equal(fixture.states[14], '登录')
  assert.equal(fixture.states[9], 2)
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'loadDetail')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.calls.filter(call => call.method === 'details').length, 1)
})

test('cached rows render before refresh and are replaced by fresh data', async () => {
  const fixture = recoveryFixture(body => {
    if (body.method === 'status') return { configured: true, identity: { account: 'reporter', userId: '42' }, preferredView: 'active', preferredPlace: { view: 'active', page: 2, bugId: '', query: '' } }
    if (body.method === 'listReports') return { page: body.args.page, pages: 3, bugs: [{ id: '9' + body.args.page, title: '新标题' + body.args.page, status: 'active' }] }
    throw Error('unexpected ' + body.method)
  })
  fixture.storage.set('dsh-zentao-ledger:snapshot:' + demoScope, JSON.stringify({ v: 1, at: Date.now(), view: 'active', reporter: '42', page: 2, pages: 3,
    items: [{ id: '13486', title: '缓存标题', status: 'active' }] }))
  fixture.states[4] = false
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'restoreEntry')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[8][0].title, '缓存标题', 'cached rows appear immediately')
  assert.match(JSON.stringify(fixture.render()), /显示上次结果|上次结果/)
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'loadReports')()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fixture.calls.filter(call => call.method === 'listReports').map(call => call.args.page), [1, 2])
  assert.equal(fixture.states[8].length, 2)
  assert.equal(fixture.states[8][0].title, '新标题1')
  const saved = JSON.parse(fixture.storage.get('dsh-zentao-ledger:snapshot:' + demoScope))
  assert.equal(saved.page, 2)
  assert.deepEqual(saved.items.map(row => row.id), ['91', '92'])
  assert.equal(JSON.stringify(saved).includes('token'), false)
})

test('new Bug edits auto-save locally and can clear the cached draft', async () => {
  const fixture = recoveryFixture(() => { throw Error('draft caching must stay local') })
  fixture.states[20] = 'edit'
  const visit = (node, predicate) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) return node.map(item => visit(item, predicate)).find(Boolean)
    return predicate(node) ? node : visit(node.children, predicate)
  }
  const title = visit(fixture.render(), node => node.type === 'input' && node.props.value === '安全回读测试')
  title.props.onChange({ target: { value: '尚未提交的缓存标题' } })
  fixture.render()
  fixture.effects.findLast(effect => effect.name === 'persistCreateDraft')()
  await new Promise(resolve => setImmediate(resolve))
  const saved = JSON.parse(fixture.storage.get('dsh-zentao-ledger:create-draft:' + demoScope))
  assert.equal(saved.fields.title, '尚未提交的缓存标题')
  assert.equal(saved.fields.description, '仅模拟提交，不调用真实禅道。')
  assert.equal(Object.hasOwn(saved.fields, 'product'), false)
  assert.equal(JSON.stringify(saved).includes('token'), false)
  assert.match(fixture.states[44], /自动保存/)
  fixture.findButton(fixture.render(), '清除本机草稿').props.onClick()
  assert.equal(fixture.storage.has('dsh-zentao-ledger:create-draft:' + demoScope), false)
  assert.equal(fixture.states[43], false)
})

test('new Bug form restores current draft fields and drops stale choices', async () => {
  const fixture = recoveryFixture(body => {
    if (body.method !== 'editor') throw Error('unexpected ' + body.method)
    return {
      context: demoContext, data: { products: { '9': 'Demo Product' }, projects: { '17': 'Demo Project' }, builds: { '490': '当前版本' }, productMembers: { '8': '开发者' }, types: { codeerror: '代码错误' } },
      fields: { product: '9', project: '17', branch: '0', module: '0', execution: '0', title: '', assignedTo: '', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: [], descriptionAction: 'replace', description: '', comment: '' }
    }
  })
  fixture.storage.set('dsh-zentao-ledger:create-draft:' + demoScope, JSON.stringify({ v: 1, at: Date.now(), mediaCount: 2, fields: {
    title: '恢复的 Bug 标题', assignedTo: '8', severity: '1', pri: '2', type: 'codeerror', deadline: '', openedBuild: ['490', 'stale-build'], description: '恢复的详细描述'
  } }))
  fixture.states[19] = null
  fixture.states[20] = 'edit'
  fixture.findButton(fixture.render(), '新建 Bug').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[19].fields.title, '恢复的 Bug 标题')
  assert.equal(fixture.states[19].fields.description, '恢复的详细描述')
  assert.deepEqual([...fixture.states[19].fields.openedBuild], ['490'])
  assert.equal(fixture.states[19].fields.assignedTo, '8')
  assert.equal(fixture.states[32].length, 0)
  assert.match(fixture.states[44], /已恢复文字草稿/)
  assert.match(fixture.states[44], /2 个媒体文件无法恢复/)
})

test('current Bug can move into a multi-draft box while a blank urgent Bug opens', async () => {
  const fixture = recoveryFixture(body => {
    if (body.method !== 'editor') throw Error('unexpected ' + body.method)
    return {
      context: demoContext, data: { products: { '9': 'Demo Product' }, projects: { '17': 'Demo Project' }, builds: { '490': '当前版本' }, productMembers: { '8': '开发者' }, types: { codeerror: '代码错误' } },
      fields: { product: '9', project: '17', branch: '0', module: '0', execution: '0', title: '', assignedTo: '', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: ['490'], descriptionAction: 'replace', description: '', comment: '' }
    }
  })
  fixture.states[20] = 'edit'
  fixture.states[19].fields.title = '先处理了一半的 Bug'
  fixture.states[19].fields.description = '已经记录的复现步骤'
  fixture.findButton(fixture.render(), '存入草稿箱并新建').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const stored = JSON.parse(fixture.storage.get('dsh-zentao-ledger:draft-box:' + demoScope))
  assert.equal(stored.drafts.length, 1)
  assert.equal(stored.drafts[0].fields.title, '先处理了一半的 Bug')
  assert.equal(fixture.storage.has('dsh-zentao-ledger:create-draft:' + demoScope), false)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[19].fields.title, '')
  assert.equal(fixture.states[19].fields.description, '')
  assert.equal(fixture.states[45].length, 1)
  assert.equal(fixture.calls.filter(call => call.method === 'editor').length, 1)
})

test('draft box restores one Bug and removes only that stored copy', async () => {
  const fixture = recoveryFixture(body => {
    if (body.method !== 'editor') throw Error('unexpected ' + body.method)
    return {
      context: demoContext, data: { products: { '9': 'Demo Product' }, projects: { '17': 'Demo Project' }, builds: { '490': '当前版本' }, productMembers: { '8': '开发者' }, types: { codeerror: '代码错误' } },
      fields: { product: '9', project: '17', branch: '0', module: '0', execution: '0', title: '', assignedTo: '', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: [], descriptionAction: 'replace', description: '', comment: '' }
    }
  })
  fixture.states[19] = null
  fixture.storage.set('dsh-zentao-ledger:draft-box:' + demoScope, JSON.stringify({ v: 1, drafts: [
    { id: 'draft_first', at: Date.now(), mediaCount: 2, fields: { title: '恢复第一个 Bug', description: '原步骤', assignedTo: '8', severity: '1', pri: '2', type: 'codeerror', deadline: '', openedBuild: ['490'] } },
    { id: 'draft_second', at: Date.now() - 1000, mediaCount: 0, fields: { title: '保留第二个 Bug', description: '另一个草稿', assignedTo: '', severity: '3', pri: '3', type: 'codeerror', deadline: '', openedBuild: ['490'] } }
  ] }))
  fixture.findButton(fixture.render(), '草稿箱').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[46], true)
  assert.match(JSON.stringify(fixture.render()), /恢复第一个 Bug/)
  fixture.findButton(fixture.render(), '继续编辑').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.states[19].fields.title, '恢复第一个 Bug')
  assert.equal(fixture.states[19].fields.description, '原步骤')
  assert.equal(fixture.states[32].length, 0)
  assert.match(fixture.states[44], /2 个媒体文件无法恢复/)
  const remaining = JSON.parse(fixture.storage.get('dsh-zentao-ledger:draft-box:' + demoScope)).drafts
  assert.deepEqual(remaining.map(draft => draft.id), ['draft_second'])
  assert.equal(fixture.states[45].length, 1)
  fixture.findButton(fixture.render(), '草稿箱').props.onClick()
  fixture.findButton(fixture.render(), '删除').props.onClick()
  assert.equal(fixture.states[45].length, 0)
  assert.deepEqual(JSON.parse(fixture.storage.get('dsh-zentao-ledger:draft-box:' + demoScope)).drafts, [])
})

test('draft media uses IndexedDB blobs and restores File role and order', () => {
  assert.match(source, /indexedDB\.open\(DRAFT_MEDIA_DB, 1\)/)
  assert.match(source, /createObjectStore\('drafts', \{ keyPath: 'key' \}\)/)
  assert.match(source, /const draftMediaQueues = new Map\(\)/)
  assert.match(source, /previous\.catch\(\(\) => \{\}\)\.then\(operation\)/)
  assert.match(source, /files\.slice\(0, 6\)\.map\(file => \(\{ blob: file/)
  assert.match(source, /new File\(\[item\.blob\], str\(item\.name\)/)
  assert.match(source, /file\.role = item\.role === 'expected' \? 'expected' : 'actual'/)
  assert.match(source, /await readDraftMedia\(storageScope, draftId\)/)
  assert.match(source, /已从草稿箱恢复 \$\{restoredMedia\.length\} 个截图或视频，角色和顺序保持不变/)
})

test('AI optimization prepares screenshots and labels visual-analysis status', () => {
  assert.match(source, /const prepared = await prepareAiImages\(mediaFiles\)/)
  assert.match(source, /images: prepared\.images/)
  assert.match(source, /AI 识图优化描述/)
  assert.match(source, /正在读取截图并生成详细建议/)
})

test('disconnecting clears cached list and Bug draft data', async () => {
  const fixture = recoveryFixture(body => body.method === 'disconnect'
    ? { configured: false, preferredView: 'active' }
    : { configured: true, identity: { account: 'reporter', userId: '42' }, preferredView: 'active' })
  fixture.storage.set('dsh-zentao-ledger:snapshot:' + demoScope, JSON.stringify({ v: 1, at: Date.now(), view: 'active', reporter: '42', page: 1, pages: 1, items: [] }))
  fixture.storage.set('dsh-zentao-ledger:create-draft:' + demoScope, JSON.stringify({ v: 1, at: Date.now(), fields: { title: '草稿' } }))
  fixture.storage.set('dsh-zentao-ledger:draft-box:' + demoScope, JSON.stringify({ v: 1, drafts: [{ id: 'draft_saved', at: Date.now(), fields: { title: '草稿箱' } }] }))
  fixture.findButton(fixture.render(), '断开').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.storage.has('dsh-zentao-ledger:snapshot:' + demoScope), false)
  assert.equal(fixture.storage.has('dsh-zentao-ledger:create-draft:' + demoScope), false)
  assert.equal(fixture.storage.has('dsh-zentao-ledger:draft-box:' + demoScope), false)
  assert.equal(fixture.calls.some(call => call.method === 'disconnect'), true)
})

test('prompt copy fallback works when the model call is unavailable', async () => {
  const fixture = recoveryFixture(() => ({ __error: 'aiUnavailable', fields: { form: 'no configured model' } }))
  fixture.states[19].fields.title = '顾客预约后没有接待记录'
  fixture.findButton(fixture.render(), '复制优化提示词').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fixture.clipboardWrites.length, 1)
  assert.match(fixture.clipboardWrites[0], /顾客预约后没有接待记录/)
  assert.match(fixture.clipboardWrites[0], /建议标题/)
  assert.match(JSON.stringify(fixture.render()), /优化提示词已复制/)
})
