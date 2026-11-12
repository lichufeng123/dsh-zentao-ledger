import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, inject } from '../index.js'

function harness({ chunks = ['{"title":"优化标题",', '"description":"概述\\n步骤：打开页面"}'], failModels = [], config = { ai: { enabled: true, provider: 'demo-provider', model: 'demo-model' } } } = {}) {
  const requests = []
  const ctx = {
    credentials: { readRecord: async () => undefined },
    llm: {
      stream(request) {
        requests.push(request)
        return (async function* () {
          if (failModels.includes(request.model)) throw Object.assign(Error('route unavailable'), { code: 'routeUnavailable' })
          for (const text of chunks) yield { type: 'text-delta', index: 0, text }
          yield { type: 'finish' }
        })()
      }
    }
  }
  const host = createHost(ctx, { config, transport: async () => { throw Error('AI must not touch ZenTao') } })
  const rpc = async args => {
    const response = await host.rpc(new Request('http://localhost/api/zentao-ledger/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'optimizeDraft', args })
    }))
    return response.json()
  }
  return { rpc, requests }
}

test('plugin explicitly injects the model service used by AI optimization', () => {
  assert.equal(inject.includes('llm'), true)
})

test('AI is disabled until explicitly enabled with both provider and model', async () => {
  for (const config of [{}, { ai: { enabled: false, provider: 'demo-provider', model: 'demo-model' } }, { ai: { enabled: true, provider: '', model: 'demo-model' } }, { ai: { enabled: true, provider: 'demo-provider', model: '' } }]) {
    const f = harness({ config })
    assert.equal((await f.rpc({ title: 't', description: 'd' })).error, 'aiUnavailable')
    assert.equal(f.requests.length, 0)
  }
})

test('AI rewrite bounds image count and model output size', async () => {
  const f = harness()
  const image = { name: 'demo.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }
  assert.equal((await f.rpc({ title: 't', description: 'd', images: Array(7).fill(image) })).error, 'invalidRequest')
  assert.equal(f.requests.length, 0)
  const excessive = harness({ chunks: ['x'.repeat(20001)] })
  assert.equal((await excessive.rpc({ title: 't', description: 'd' })).error, 'aiOutputTooLong')
  assert.equal(excessive.requests.length, 1)
})

test('AI rewrite returns a parsed suggestion without any ZenTao request', async () => {
  const { rpc, requests } = harness()
  const result = await rpc({ title: '原标题', description: '没有登录也要弹出自动更新提醒', openedBuild: ['490'] })
  assert.equal(result.ok, true)
  assert.equal(result.value.title, '优化标题')
  assert.match(result.value.description, /打开页面/)
  assert.equal(result.value.provider, 'demo-provider')
  assert.equal(result.value.model, 'demo-model')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].provider, 'demo-provider')
  assert.equal(requests[0].model, 'demo-model')
  const prompt = requests[0].messages.at(-1).content[0].text
  assert.match(prompt, /没有登录也要弹出自动更新提醒/)
  assert.match(prompt, /490/)
})

test('AI rewrite sends bounded screenshots with their evidence roles to the pinned model', async () => {
  const { rpc, requests } = harness()
  const result = await rpc({ title: '标签删除报错冗余', description: '删除标签时提示重复', openedBuild: ['490'], images: [
    { name: '实际结果.png', role: 'actual', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
    { name: '预期结果.jpg', role: 'expected', mimeType: 'image/jpeg', data: '/9j/2Q==' }
  ] })
  assert.equal(result.ok, true)
  const content = requests[0].messages.at(-1).content
  assert.equal(content.length, 3)
  assert.deepEqual(content.slice(1).map(part => [part.type, part.mimeType, part.data]), [
    ['image', 'image/png', 'iVBORw0KGgo='],
    ['image', 'image/jpeg', '/9j/2Q==']
  ])
  assert.match(content[0].text, /图片 1：实际结果，文件名 实际结果\.png/)
  assert.match(content[0].text, /图片 2：预期结果，文件名 预期结果\.jpg/)
  assert.match(content[0].text, /不要只改写原句/)
})

test('AI rewrite rejects malformed or oversized image input before calling the model', async () => {
  const { rpc, requests } = harness()
  const result = await rpc({ title: 't', description: 'd', images: [{ name: 'bad.png', role: 'actual', mimeType: 'image/png', data: 'not-base64!' }] })
  assert.equal(result.error, 'invalidRequest')
  assert.equal(requests.length, 0)
})

test('AI rewrite tolerates code fences and rejects unusable output', async () => {
  const fenced = harness({ chunks: ['```json\n{"title":"A","description":"B"}\n```'] })
  assert.equal((await fenced.rpc({ title: 't', description: 'd' })).value.title, 'A')
  const broken = harness({ chunks: ['抱歉，我无法完成。'] })
  const failure = await broken.rpc({ title: 't', description: 'd' })
  assert.equal(failure.ok, false)
  assert.equal(failure.error, 'aiParseFailed')
  assert.match(failure.fields.form, /unparsed output/)
})

test('AI rewrite uses only the configured route and never falls back after failure', async () => {
  const retried = harness({ failModels: ['demo-model'] })
  const result = await retried.rpc({ title: 't', description: 'd' })
  assert.equal(result.error, 'aiUnavailable')
  assert.deepEqual(retried.requests.map(request => [request.provider, request.model]), [['demo-provider', 'demo-model']])
})

test('AI rewrite validates input and reports a failed configured route', async () => {
  const { rpc } = harness()
  assert.equal((await rpc({ title: '', description: 'd' })).error, 'invalidRequest')
  assert.equal((await rpc({ title: 't', description: 'x'.repeat(12001) })).error, 'invalidRequest')
  const unavailable = harness({ failModels: ['demo-model', 'unused-model'] })
  const result = await unavailable.rpc({ title: 't', description: 'd' })
  assert.equal(result.error, 'aiUnavailable')
  assert.match(result.fields.form, /demo-provider\/demo-model/)
})
