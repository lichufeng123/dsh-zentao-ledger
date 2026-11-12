import Schema from '@deepseek-ai/schemastery'

export const Config = Schema.object({
  origin: Schema.string().default('').description('ZenTao root origin, for example https://zentao.example. Classic JSON/web-form routes are required; subdirectory installations are unsupported.'),
  allowHttp: Schema.boolean().default(false).description('Allow unencrypted HTTP only when explicitly needed for a trusted local deployment.'),
  productId: Schema.string().default('').description('Product ID used for requirements and new Bugs.'),
  projectId: Schema.string().default('').description('Project ID used for new Bugs.'),
  productName: Schema.string().default('').description('Optional exact product name check.'),
  projectName: Schema.string().default('').description('Optional exact project name check.'),
  authMode: Schema.union([Schema.const('token'), Schema.const('cookie')]).default('token').description('Token login exchange or a Cookie header supplied through the panel credential form.'),
  ai: Schema.object({
    enabled: Schema.boolean().default(false).description('Enable draft assistance using the explicitly chosen DSH provider and model.'),
    provider: Schema.string().default('').description('DSH provider ID. Drafts and selected images are sent to this provider only.'),
    model: Schema.string().default('').description('Exact model ID. No fallback provider or model is selected.')
  }).default({ enabled: false, provider: '', model: '' })
})

export function normalizeOrigin(value, allowHttp = false) {
  if (typeof value !== 'string' || !value || /[\s\\\u0000-\u001f]/.test(value)) throw new Error('invalidOrigin')
  let url
  try { url = new URL(value) } catch { throw new Error('invalidOrigin') }
  if (!/^https?:\/\/[^/?#]+\/?$/i.test(value) || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    (url.protocol !== 'https:' && !(allowHttp === true && url.protocol === 'http:')) || !url.hostname) throw new Error('invalidOrigin')
  return url.origin
}

export function normalizeConfig(input = {}) {
  const string = value => typeof value === 'string' ? value.trim() : ''
  const origin = input.origin ? normalizeOrigin(input.origin, input.allowHttp) : ''
  const productId = string(input.productId), projectId = string(input.projectId)
  if ([productId, projectId].some(value => value && !/^[1-9]\d{0,9}$/.test(value))) throw new Error('invalidConfig')
  const authMode = input.authMode ?? 'token'
  if (!['token', 'cookie'].includes(authMode)) throw new Error('invalidConfig')
  const ai = { enabled: input.ai?.enabled === true, provider: string(input.ai?.provider), model: string(input.ai?.model) }
  if ([ai.provider, ai.model].some(value => value.length > 200 || /[\u0000-\u001f]/.test(value))) throw new Error('invalidConfig')
  return Object.freeze({ origin, allowHttp: input.allowHttp === true, productId, projectId,
    productName: string(input.productName), projectName: string(input.projectName), authMode, ai: Object.freeze(ai) })
}
