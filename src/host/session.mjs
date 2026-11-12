// Host-only ZenTao session. No credentials, token URLs or cookies leave this module.
import { randomBytes } from 'node:crypto'
import { normalizeOrigin } from '../../config.js'
export class SessionError extends Error {
    constructor(code) {
        super(code)
        this.name = 'SessionError'
        this.code = code
    }
}

const positiveId = (value) => /^[1-9]\d*$/.test(String(value || ''))
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_SIDE = 8192
const MAX_IMAGE_PIXELS = 40_000_000

async function imageBytes(response) {
    const length = response.headers.get('content-length')
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_IMAGE_BYTES)) throw new SessionError('invalidImage')
    if (!response.body?.getReader) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > MAX_IMAGE_BYTES) throw new SessionError('invalidImage')
        return bytes
    }
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (!(value instanceof Uint8Array)) throw new SessionError('invalidImage')
            size += value.length
            if (size > MAX_IMAGE_BYTES) throw new SessionError('invalidImage')
            chunks.push(value)
        }
    } catch (error) {
        reader.cancel().catch(() => {})
        throw error
    } finally {
        reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return bytes
}

export function imageDimensions(bytes, type) {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const starts = (offset, ...signature) => signature.every((byte, index) => bytes[offset + index] === byte)
    if (type === 'image/png') {
        if (bytes.length < 24 || !starts(0, 137, 80, 78, 71, 13, 10, 26, 10) ||
            data.getUint32(8) !== 13 || !starts(12, 73, 72, 68, 82)) return null
        return [data.getUint32(16), data.getUint32(20)]
    }
    if (type === 'image/gif') {
        if (bytes.length < 10 || (!starts(0, 71, 73, 70, 56, 55, 97) && !starts(0, 71, 73, 70, 56, 57, 97))) return null
        return [data.getUint16(6, true), data.getUint16(8, true)]
    }
    if (type === 'image/jpeg') {
        if (!starts(0, 255, 216, 255)) return null
        let offset = 2
        while (offset + 4 <= bytes.length) {
            if (bytes[offset++] !== 255) return null
            while (bytes[offset] === 255) offset++
            const marker = bytes[offset++]
            if (marker === 0xd9 || marker === 0xda || marker === undefined) return null
            if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
            if (offset + 2 > bytes.length) return null
            const length = data.getUint16(offset)
            if (length < 2 || offset + length > bytes.length) return null
            if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
                (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
                if (length < 7) return null
                return [data.getUint16(offset + 5), data.getUint16(offset + 3)]
            }
            offset += length
        }
        return null
    }
    if (type === 'image/webp') {
        if (bytes.length < 30 || !starts(0, 82, 73, 70, 70) || !starts(8, 87, 69, 66, 80)) return null
        const chunk = String.fromCharCode(...bytes.slice(12, 16))
        const uint24 = (offset) => bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536
        if (chunk === 'VP8X') return [uint24(24) + 1, uint24(27) + 1]
        if (chunk === 'VP8L' && bytes[20] === 0x2f) {
            const bits = data.getUint32(21, true)
            return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
        }
        if (chunk === 'VP8 ' && starts(23, 0x9d, 0x01, 0x2a))
            return [data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff]
    }
    return null
}

function originOf(value, allowHttp = false) {
    try { return normalizeOrigin(value, allowHttp) }
    catch { throw new SessionError('invalidOrigin') }
}

function suppliedCookies(secret) {
    if (typeof secret !== 'string' || !secret || secret.length > 4096 || /[\u0000-\u001f\u007f]/.test(secret)) throw new SessionError('credentialsUnavailable')
    const jar = new Map()
    for (const pair of secret.split(';')) {
        const match = /^\s*([!#$%&'*+.^_`|~\w-]+)=([\x21-\x3a\x3c-\x7e]*)\s*$/.exec(pair)
        if (!match || jar.has(match[1])) throw new SessionError('credentialsUnavailable')
        jar.set(match[1], match[2])
    }
    return jar
}

function safeUrl(origin, path) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\u0000-\u001f\\]/.test(path))
        throw new SessionError('invalidPath')
    let url
    try { url = new URL(path, origin) } catch { throw new SessionError('invalidPath') }
    if (url.origin !== origin || url.username || url.password || url.hash || url.searchParams.has('token'))
        throw new SessionError('invalidPath')
    return url
}

function cookieHeaders(headers) {
    if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
    const one = headers.get('set-cookie')
    return one ? [one] : []
}

function saveCookies(jar, headers) {
    for (const line of cookieHeaders(headers)) {
        const first = line.split(';', 1)[0]
        const index = first.indexOf('=')
        if (index < 1) continue
        const name = first.slice(0, index).trim()
        if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)) continue
        const value = first.slice(index + 1)
        if (/\r|\n|;/.test(value)) continue
        if (value) jar.set(name, value)
        else jar.delete(name)
    }
}

// Onboarding starts with a token alone. The host keeps the token, then uses
// the returned identity to construct its credential provider for later calls.
export async function discoverCredential(token, transport = globalThis.fetch, origin, authMode = 'token', allowHttp = false) {
    if (typeof token !== 'string' || !token || token.length > 4096 || /[\u0000-\u001f\u007f]/.test(token) || typeof transport !== 'function' || !['token', 'cookie'].includes(authMode))
        throw new SessionError('credentialsUnavailable')
    const session = new ZenTaoSession({ credentials: async () => null, transport, allowHttp })
    const state = { origin: originOf(origin, allowHttp), authMode, token, cookies: authMode === 'cookie' ? suppliedCookies(token) : new Map() }
    try {
        if (authMode === 'token') {
            const login = new URL('/user-login.html', state.origin)
            login.searchParams.set('token', token)
            const response = await session.send(state, login, { method: 'GET' }, true)
            if (!response.ok) throw new SessionError('authFailed')
        }
        const profile = await session.rawJson(state, '/my-profile.json')
        if (profile.loginExpired || profile.result === 'fail' || profile.status === 'fail') throw new SessionError('authFailed')
        let identity = profile.data ?? profile
        if (typeof identity === 'string') identity = JSON.parse(identity)
        const person = identity?.user || identity?.profile || identity
        const account = person?.account
        const userId = String(person?.id || '')
        if (typeof account !== 'string' || !account.trim() || !positiveId(userId)) throw new SessionError('identityMismatch')
        return { origin: state.origin, account, userId }
    } catch (error) {
        if (error instanceof SessionError) throw error
        throw new SessionError('authFailed')
    } finally {
        state.cookies.clear()
    }
}

export class ZenTaoSession {
    // getCredential()/credentials() => {origin, account, userId, token, binding}; binding identifies an
    // installation/credential owner, not a reusable token or a display name.
    constructor({ credentials, getCredential, transport = globalThis.fetch, timeoutMs = 15000, allowHttp = false } = {}) {
        const provider = credentials || getCredential
        if (typeof provider !== 'function' || typeof transport !== 'function') throw new TypeError('credential provider and transport callbacks required')
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('invalid timeout')
        this.credentials = provider
        this.transport = transport
        this.timeoutMs = timeoutMs
        this.allowHttp = allowHttp === true
        this.sessions = new Map()
    }

    async context() {
        const secret = await this.credentials()
        if (!secret || typeof secret !== 'object' || !positiveId(secret.userId) ||
            typeof secret.account !== 'string' || !secret.account.trim() ||
            typeof secret.binding !== 'string' || !secret.binding.trim() ||
            typeof secret.token !== 'string' || !secret.token || secret.token.length > 4096 || /[\u0000-\u001f\u007f]/.test(secret.token) ||
            !['token', 'cookie'].includes(secret.authMode ?? 'token'))
            throw new SessionError('credentialsUnavailable')
        const origin = originOf(secret.origin, this.allowHttp)
        const authMode = secret.authMode ?? 'token'
        const key = JSON.stringify([origin, authMode, secret.binding, secret.account, String(secret.userId)])
        let state = this.sessions.get(key)
        if (!state || state.token !== secret.token) {
            state = { origin, authMode, account: secret.account, userId: String(secret.userId), token: secret.token,
                tid: randomBytes(4).toString('hex'), cookies: authMode === 'cookie' ? suppliedCookies(secret.token) : new Map(), verified: false, pending: null }
            this.sessions.set(key, state)
        }
        if (!state.tid) state.tid = randomBytes(4).toString('hex')
        if (!state.verified) {
            if (!state.pending) state.pending = this.authenticate(state).finally(() => { state.pending = null })
            await state.pending
        }
        return state
    }

    async authenticate(state) {
        // The token occurs only in the transport URL; never in errors or logs.
        try {
            if (state.authMode === 'token') {
                const login = new URL('/user-login.html', state.origin)
                login.searchParams.set('token', state.token)
                const response = await this.send(state, login, { method: 'GET' }, true)
                if (!response.ok) throw new SessionError('authFailed')
            }
            const profile = await this.rawJson(state, '/my-profile.json')
            if (profile.loginExpired || profile.result === 'fail' || profile.status === 'fail') throw new SessionError('authExpired')
            let identity = profile.data ?? profile
            if (typeof identity === 'string') {
                try { identity = JSON.parse(identity) } catch { throw new SessionError('identityMismatch') }
            }
            const person = identity?.user || identity?.profile || identity
            if (String(person.account || '') !== state.account || String(person.id || '') !== state.userId)
                throw new SessionError('identityMismatch')
            state.verified = true
        } catch (error) {
            state.cookies.clear()
            state.verified = false
            if (error instanceof SessionError) throw error
            throw new SessionError('authFailed')
        }
    }

    async bounded(task, signal) {
        let timer
        let abort
        try {
            return await Promise.race([
                task,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new SessionError('timeout')), this.timeoutMs)
                    if (signal) {
                        abort = () => reject(new SessionError('timeout'))
                        signal.addEventListener('abort', abort, { once: true })
                        if (signal.aborted) abort()
                    }
                }),
            ])
        } finally {
            clearTimeout(timer)
            if (abort) signal.removeEventListener('abort', abort)
        }
    }

    async send(state, url, options = {}, login = false) {
        const method = (options.method || 'GET').toUpperCase()
        if (!['GET', 'POST'].includes(method)) throw new SessionError('invalidMethod')
        if (method === 'POST') {
            // Re-read the owner grant at every write boundary, including REST
            // uploads. A prior verified state cannot authorize another site's
            // request after disconnect, credential replacement or account change.
            const secret = await this.credentials()
            if (!secret || originOf(secret.origin, this.allowHttp) !== state.origin || secret.account !== state.account ||
                String(secret.userId) !== state.userId || secret.token !== state.token || (secret.authMode ?? 'token') !== (state.authMode ?? 'token')) throw new SessionError('identityMismatch')
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeoutMs)
        const external = options.signal
        const abort = () => controller.abort()
        external?.addEventListener('abort', abort, { once: true })
        if (external?.aborted) controller.abort()
        try {
            for (let redirects = 0; redirects <= 5; redirects++) {
                if (url.origin !== state.origin) throw new SessionError('crossOriginRedirect')
                const headers = new Headers(options.headers || {})
                headers.delete('authorization')
                headers.delete('cookie')
                if (state.authMode === 'cookie') headers.delete('token')
                if (state.cookies.size) headers.set('cookie', [...state.cookies].map(([name, value]) => `${name}=${value}`).join('; '))
                let response
                try {
                    response = await this.bounded(this.transport(url.href, { method, headers, body: options.body, signal: controller.signal, redirect: 'manual' }), controller.signal)
                } catch (error) {
                    throw error instanceof SessionError && error.code === 'timeout' ? error : new SessionError('transportFailed')
                }
                if (!response || typeof response.status !== 'number' || !response.headers) throw new SessionError('invalidResponse')
                saveCookies(state.cookies, response.headers)
                if (response.status >= 300 && response.status < 400) {
                    if (method === 'POST') throw new SessionError('writeUnknown')
                    const location = response.headers.get('location')
                    if (!location) throw new SessionError('invalidRedirect')
                    let next
                    try { next = new URL(location, url) } catch { throw new SessionError('invalidRedirect') }
                    if (next.origin !== state.origin || next.username || next.password || next.hash ||
                        (!login && next.searchParams.has('token')))
                        throw new SessionError('crossOriginRedirect')
                    url = next
                    continue
                }
                return response
            }
            throw new SessionError('tooManyRedirects')
        } finally {
            clearTimeout(timer)
            external?.removeEventListener('abort', abort)
        }
    }

    async rawJson(state, path, options = {}) {
        return this.bounded((async () => {
            const response = await this.send(state, safeUrl(state.origin, path), options)
            if (!response.ok) throw new SessionError('httpError')
            let text
            try { text = await response.text() }
            catch { throw new SessionError('invalidJson') }
            try { return JSON.parse(text) }
            catch { throw new SessionError('invalidJson') }
        })())
    }

    async json(path, options = {}) {
        const state = await this.context()
        const url = safeUrl(state.origin, path)
        url.searchParams.set('tid', state.tid)
        return this.rawJson(state, url.pathname + url.search, options)
    }

    async image(path) {
        const state = await this.context()
        return this.bounded((async () => {
            const url = typeof path === 'string' && path.startsWith('https:') ? new URL(path) : safeUrl(state.origin, path)
            if (url.origin !== state.origin || url.username || url.password || url.hash || url.searchParams.has('token')) throw new SessionError('invalidPath')
            const response = await this.send(state, url)
            const reportedType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || ''
            if (!response.ok || !/^image\/(?:png|jpe?g|gif|webp)$/.test(reportedType))
                throw new SessionError('invalidImage')
            const bytes = await imageBytes(response)
            const type = reportedType === 'image/jpg' ? 'image/jpeg' : reportedType
            const dimensions = imageDimensions(bytes, type)
            if (!dimensions || dimensions.some((side) => !side || side > MAX_IMAGE_SIDE) ||
                dimensions[0] * dimensions[1] > MAX_IMAGE_PIXELS) throw new SessionError('invalidImage')
            return { bytes, contentType: type, width: dimensions[0], height: dimensions[1] }
        })())
    }

    clear() { this.sessions.clear() }
}
