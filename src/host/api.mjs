import { submittedPath, loadReportPage, groupUnresolved } from '../shared/report.js'
import { newBugEditor, createFormPath, bugFormBody, parseWriteResponse, WriteError } from '../shared/editor.js'
import { parseCreatorBuilds } from '../shared/build-creators.js'
import { ZenTaoSession } from './session.mjs'
import { randomBytes } from 'node:crypto'
import { imageReference, imageMarkup, videosSaved } from './media.mjs'

const id = (value) => {
    if (!/^[1-9]\d*$/.test(String(value))) throw new TypeError('invalid id')
    return String(value)
}
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const records = (value) => Array.isArray(value) ? value : object(value) ? Object.values(value) : []
const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const dateText = (value) => /^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:$|[ T])/.test(text(value)) ? text(value) : ''
const decodeHtml = (value) => value.replace(/&#(\d+);?/g, (_, number) => String.fromCodePoint(Math.min(Number(number), 0x10ffff)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity.toLowerCase()] || entity)
function parseMembers(html) {
    if (typeof html !== 'string') return []
    const members = []
    for (const match of html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi)) {
        const attributes = match[1]
        const attribute = (name) => {
            const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attributes)
            return decodeHtml(found?.[1] ?? found?.[2] ?? found?.[3] ?? '')
        }
        const memberId = attribute('value')
        if (!/^[1-9]\d*$/.test(memberId)) continue
        members.push({ id: memberId, name: decodeHtml(match[2].replace(/<[^>]*>/g, '')).trim() || attribute('title'), keys: attribute('data-keys') })
    }
    return members
}
function normalizeBug(raw, users = {}, products = {}) {
    if (!object(raw) || !/^[1-9]\d*$/.test(String(raw.id)) || typeof raw.title !== 'string') throw new Error('invalidBug')
    const assignee = text(raw.assignedTo)
    return {
        id: String(raw.id), title: raw.title,
        product: text(raw.productName) || text(products[text(raw.product)]) || text(raw.product),
        productId: text(raw.product), status: text(raw.status), priority: text(raw.pri), severity: text(raw.severity),
        assignedTo: text(users[assignee]) || assignee, assignedAccount: assignee,
        openedDate: dateText(raw.openedDate),
        updatedAt: dateText(raw.lastEditedDate) || dateText(raw.assignedDate) || dateText(raw.openedDate),
    }
}

// ZenTao JSON routes sometimes encode data as a JSON string inside a result envelope.
export function unwrapEnvelope(input) {
    let value = input
    for (let i = 0; i < 4; i++) {
        if (typeof value === 'string') {
            try { value = JSON.parse(value) } catch { throw new Error('invalidEnvelope') }
            continue
        }
        if (!object(value)) throw new Error('invalidEnvelope')
        if (value.loginExpired || /user-login/i.test(String(value.locate || ''))) throw new Error('authExpired')
        if (value.result === 'fail' || value.result === 'error' || value.status === 'fail' || value.status === 'error') throw new Error('serverRejected')
        if ('data' in value && (value.result === 'success' || value.status === 'success' || Object.keys(value).length === 1)) {
            value = value.data
            continue
        }
        return value
    }
    if (object(value)) return value
    throw new Error('invalidEnvelope')
}

function reportPage(data, page) {
    if (!object(data) || !('bugs' in data) || (!object(data.bugs) && !Array.isArray(data.bugs))) throw new Error('invalidBugList')
    const raw = records(data.bugs)
    const pager = data.pager || {}
    const current = Number(data.page ?? pager.pageID ?? pager.page ?? page)
    const rawPages = Number(data.pages ?? pager.pageTotal ?? pager.pageCount ?? pager.pages)
    const pages = rawPages === 0 && raw.length === 0 && page === 1 ? 1 : rawPages
    if (!Number.isSafeInteger(current) || current !== page || !Number.isSafeInteger(pages) || pages < page) throw new Error('invalidPagination')
    const bugs = raw.filter((item) => text(item?.deleted) !== '1').map((item) => normalizeBug(item, data.users, data.products))
    return { bugs, page, pages, members: parseMembers(data.userList), total: Number(data.total ?? pager.recTotal ?? bugs.length) }
}

function compareReadback(editor, bug, media = {}) {
    if (!object(bug)) return false
    const f = editor.fields
    const scalar = ['title', 'product', 'branch', 'module', 'project', 'execution', 'assignedTo', 'severity', 'pri', 'type', 'deadline']
    const deadline = value => /^$|^0000-00-00(?: 00:00:00)?$/.test(String(value ?? '')) ? '' : String(value)
    if (scalar.some((key) => key === 'deadline'
        ? deadline(bug.deadline) !== deadline(f.deadline)
        : String(bug[key] ?? '') !== String(key === 'title' ? f.title.trim() : f[key]))) return false
    const actualBuilds = Array.isArray(bug.openedBuild) ? bug.openedBuild.map(String) : String(bug.openedBuild ?? '').split(',').filter(Boolean)
    if (actualBuilds.length !== f.openedBuild.length || actualBuilds.some((value) => !f.openedBuild.includes(value))) return false
    if (f.descriptionAction !== 'keep') {
        const text = String(bug.steps ?? '')
        const plain = value => String(value).replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/gi, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' })[entity.toLowerCase()] || entity).replace(/[\s\u00a0]+/g, '')
        if (!f.description || !plain(text).includes(plain(f.description))) return false
    }
    if ((media.images || []).some(path => !String(bug.steps || '').includes(path))) return false
    if (!videosSaved(bug, media.videos || [], media.previousIds || [])) return false
    return true
}

export function closeFormUid(html, url) {
    if (typeof html !== 'string' || html.length > 128000) throw new WriteError('closeFormUnavailable')
    const attribute = (tag, name) => {
        const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
        return found?.[1] ?? found?.[2] ?? found?.[3]
    }
    const matches = []
    for (const form of html.matchAll(/<form\b[^>]*>/gi)) {
        if (attribute(form[0], 'method')?.toUpperCase() !== 'POST') continue
        const rawAction = attribute(form[0], 'action')
        if (rawAction) {
            let action
            try { action = new URL(rawAction.replaceAll('&amp;', '&'), url) } catch { continue }
            const onlybody = action.searchParams.get('onlybody')
            const tid = action.searchParams.get('tid')
            if (action.origin !== url.origin || action.pathname !== url.pathname ||
                onlybody !== null && onlybody !== 'yes' || tid !== null && tid !== url.searchParams.get('tid') ||
                action.searchParams.has('token') || action.username || action.password || action.hash) continue
        }
        const tail = html.slice(form.index + form[0].length)
        const closing = /<\/form\s*>/i.exec(tail)
        if (!closing) continue
        const end = form.index + form[0].length + closing.index
        const body = html.slice(form.index, end)
        const inputs = [...body.matchAll(/<input\b[^>]*>/gi)].map(match => match[0])
        const textareas = [...body.matchAll(/<textarea\b[^>]*>/gi)].map(match => match[0])
        const hidden = (name) => inputs.filter(input => attribute(input, 'type')?.toLowerCase() === 'hidden' && attribute(input, 'name')?.toLowerCase() === name)
        const comments = textareas.filter(textarea => attribute(textarea, 'name')?.toLowerCase() === 'comment')
        const uids = hidden('uid')
        if (hidden('status').length !== 1 || attribute(hidden('status')[0], 'value')?.toLowerCase() !== 'closed' || comments.length !== 1 || uids.length > 1) continue
        const uid = uids.length ? attribute(uids[0], 'value') : ''
        if (uid === '' || typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid)) matches.push(uid)
    }
    if (matches.length !== 1) throw new WriteError('closeFormUnavailable')
    return matches[0]
}

function closeReceipt(detail, attempt) {
    const bug = detail.bug
    if (String(bug.id) !== attempt.id || bug.title !== attempt.title || bug.status !== 'closed' ||
        String(bug.closedBy || '') !== attempt.account) return null
    const action = detail.actions.find(item => item.action === 'closed' && /^[1-9]\d*$/.test(String(item.id)) &&
        !attempt.beforeActions.has(String(item.id)) && String(item.actor || '') === attempt.account &&
        (attempt.expectedImages || []).every(path => String(item.comment || '').includes(path)))
    if (!action) return null
    return { id: attempt.id, title: attempt.title, status: 'closed', closedBy: attempt.account,
        actionId: String(action.id), closedDate: dateText(bug.closedDate) }
}
function existingCloseReceipt(detail, target) {
    const bug = detail.bug
    if (String(bug.id) !== target.id || bug.title !== target.title || bug.status !== 'closed' ||
        String(bug.closedBy || '') !== target.account) return null
    const action = [...detail.actions].reverse().find(item => item.action === 'closed' && /^[1-9]\d*$/.test(String(item.id)) && String(item.actor || '') === target.account)
    if (!action) return null
    return { id: target.id, title: target.title, status: 'closed', closedBy: target.account,
        actionId: String(action.id), closedDate: dateText(bug.closedDate), reconciled: true }
}

export class ZenTaoApi {
    constructor(options = {}) {
        this.session = options.session || new ZenTaoSession(options)
        this.productId = String(options.productId || '')
        this.writeLocks = new Set()
        this.pendingWrites = new Map()
        this.closeLocks = new Map()
    }

    async read(path) {
        try { return unwrapEnvelope(await this.session.json(path)) }
        catch (error) {
            // A GET is safe to replay once after the web session expires. Never
            // apply this recovery to a POST with an unknown write result.
            if (String(error?.code || error?.message) !== 'authExpired') throw error
            this.session.clear()
            return unwrapEnvelope(await this.session.json(path))
        }
    }

    async profile() {
        const state = await this.session.context()
        return { origin: state.origin, account: state.account, userId: state.userId }
    }

    async listReports({ page = 1, status = 'active', userId } = {}) {
        const identity = await this.profile()
        const reporter = userId === undefined ? identity.userId : id(userId)
        const fetchPage = async (number) => reportPage(await this.read(submittedPath(reporter, number)), number)
        return loadReportPage(fetchPage, page, status)
    }

    async unresolvedBoard({ userId } = {}) {
        const first = await this.listReports({ userId, page: 1, status: 'all' })
        const bugs = [...first.bugs]
        for (let page = 2; page <= first.pages; page++) {
            const next = await this.listReports({ userId, page, status: 'all' })
            bugs.push(...next.bugs)
        }
        return groupUnresolved(bugs)
    }

    async listStories({ page = 1 } = {}) {
        const number = Number(page)
        if (!Number.isSafeInteger(number) || number < 1 || number > 500) throw new Error('invalidPagination')
        if (!/^[1-9]\d*$/.test(this.productId)) throw new Error('configMissing')
        const data = await this.read(`/api.php/v1/products/${this.productId}/stories?limit=20&page=${number}`)
        if (!object(data) || !Array.isArray(data.stories) || !Array.isArray(data.requirements)) throw new Error('invalidStoryList')
        const current = Number(data.page), limit = Number(data.limit), total = Number(data.total)
        if (current !== number || limit !== 20 || !Number.isSafeInteger(total) || total < 0 || total > 100000 ||
            number > Math.max(1, Math.ceil(total / limit))) throw new Error('invalidPagination')
        const raw = [...data.stories, ...data.requirements]
        if (raw.some(item => !object(item) || !/^[1-9]\d*$/.test(String(item.id)) ||
            String(item.product) !== this.productId || typeof item.title !== 'string' ||
            !['story', 'requirement'].includes(String(item.type)))) throw new Error('invalidStoryList')
        const stories = raw.filter(item => item.deleted !== true && String(item.deleted) !== '1').map(item => ({
            id: String(item.id), title: item.title, type: item.type,
            status: text(item.status), stage: text(item.stage), priority: text(item.pri),
            openedBy: text(item.openedBy), assignedTo: text(item.assignedTo),
            openedDate: dateText(item.openedDate), updatedAt: dateText(item.lastEditedDate) || dateText(item.changedDate)
        }))
        return { product: this.productId, stories, page: current, pages: Math.max(1, Math.ceil(total / limit)), total }
    }

    async details(bugId) {
        const data = await this.read(`/bug-view-${id(bugId)}.json`)
        if (!object(data.bug) || String(data.bug.id) !== id(bugId)) throw new Error('detailMismatch')
        return { bug: data.bug, actions: records(data.actions), histories: records(data.histories), data }
    }

    async createMetadata(fields = {}) {
        return this.read(createFormPath(fields))
    }

    async editMetadata(bugId) {
        const data = await this.read(`/bug-edit-${id(bugId)}.json`)
        if (!object(data.bug) || String(data.bug.id) !== id(bugId)) throw new Error('editMismatch')
        return data
    }

    async editor(mode, fields = {}, bugId = '') {
        if (mode === 'create') return newBugEditor(await this.createMetadata(fields), mode)
        if (mode === 'edit') return newBugEditor(await this.editMetadata(bugId), mode, id(bugId))
        throw new TypeError('invalid editor mode')
    }

    async listMembers() {
        const data = await this.read('/user-bug-0-assignedTo-id_desc-0-1-1.json')
        const members = parseMembers(data.userList)
        if (!members.length) throw new Error('membersUnavailable')
        return members
    }

    async creatorBuilds(_product) {
        const identity = await this.profile()
        const data = await this.read('/project-build-0-all-0-id_desc-0-1000-1.json')
        return parseCreatorBuilds(data, identity.account)
    }

    async image(path) { return this.session.image(path) }

    async mediaUploadStatus(sessionState) {
        const state = sessionState || await this.session.context()
        if (state.authMode === 'cookie') throw new WriteError('mediaAuthUnavailable')
        const userUrl = new URL('/api.php/v1/user', state.origin)
        try {
            const check = await this.session.send(state, userUrl, { headers: {
                'Token': state.token, 'accept': 'application/json'
            } })
            if (!check.ok) throw new Error('mediaAuthUnavailable')
            const result = await check.json()
            const profile = result?.profile ?? result?.data?.profile ?? result
            if (profile?.account !== state.account ||
                (profile.id != null && String(profile.id) !== state.userId)) throw new Error('mediaAuthUnavailable')
            return { ready: true, account: state.account }
        } catch { throw new WriteError('mediaAuthUnavailable') }
    }

    async assertContext(expected) {
        const current = await this.session.context()
        if (['origin', 'account', 'userId', 'token', 'authMode'].some(key => current[key] !== expected[key])) throw new WriteError('identityMismatch')
        return current
    }

    // Explicit confirmation is bound to the verified identity and exact form title.
    // A write stays locked after transport uncertainty or failed GET verification.
    async commit(editor, confirmation, media = []) {
        if (!editor || !['create', 'edit'].includes(editor.mode)) throw new TypeError('invalid editor')
        const encodedBody = bugFormBody(editor) // validate before any POST
        const state = await this.session.context()
        if (editor.origin && editor.origin !== state.origin) throw new WriteError('identityMismatch')
        if (!confirmation || confirmation.account !== state.account || confirmation.title !== editor.fields.title.trim() ||
            (editor.mode === 'edit' && confirmation.id !== editor.id)) throw new WriteError('confirmationMismatch')
        const lock = JSON.stringify([state.origin, state.account, state.userId])
        if (this.writeLocks.has(lock)) throw new WriteError('writeLocked')
        this.writeLocks.add(lock)
        const path = editor.mode === 'create' ? createFormPath(editor.fields) : `/bug-edit-${id(editor.id)}.json`
        const images = media.filter(file => file.kind === 'image')
        const videos = media.filter(file => file.kind === 'video')
        const expected = { images: [], videos: videos.map(file => ({ name: file.name, size: file.size })), previousIds: [] }
        const uploads = []
        const params = new URLSearchParams(encodedBody)
        if (media.length && editor.mode === 'edit') {
            try { expected.previousIds = Object.keys((await this.details(editor.id)).bug.files || {}) }
            catch { throw new WriteError('writeUnknown') }
        }
        if (images.length) {
            // The proven REST upload flow uses a 26-character uid. Verify the
            // separate REST token before any file POST; web-cookie identity alone
            // does not establish REST upload permission.
            try { await this.mediaUploadStatus(state) }
            catch {
                this.writeLocks.delete(lock)
                throw new WriteError('mediaAuthUnavailable')
            }
            const uid = 'ds' + randomBytes(12).toString('hex')
            for (const file of images) {
                try {
                    const upload = new FormData()
                    upload.append('imgFile', new Blob([file.bytes], { type: file.type }), file.name)
                    const uploadUrl = new URL('/api.php/v1/files', state.origin)
                    uploadUrl.searchParams.set('uid', uid)
                    await this.assertContext(state)
                    const uploaded = await this.session.send(state, uploadUrl, { method: 'POST', headers: {
                        'Token': state.token, 'accept': 'application/json'
                    }, body: upload })
                    if (!uploaded.ok) {
                        if (uploaded.status >= 400 && uploaded.status < 500) throw new WriteError('mediaUploadFailed', { form: `上传接口返回 HTTP ${uploaded.status}，Bug 尚未提交。` })
                        throw new Error('writeUnknown')
                    }
                    let answer
                    try { answer = await uploaded.json() } catch { throw new Error('writeUnknown') }
                    if (typeof answer?.data === 'string' && answer.status === 'success') {
                        try { answer = JSON.parse(answer.data) } catch { throw new Error('writeUnknown') }
                    }
                    if (answer?.error != null && ![0, '0', false].includes(answer.error) || ['fail', 'error'].includes(answer?.status)) throw new WriteError('mediaUploadFailed', { form: '上传接口返回文件拒绝结果，Bug 尚未提交。' })
                    if (typeof answer?.url !== 'string' || !/^[1-9]\d*$/.test(String(answer?.id ?? ''))) throw new Error('writeUnknown')
                    const reference = imageReference(answer.url, state.origin)
                    if (expected.images.includes(reference)) throw new Error('invalidMediaResponse')
                    expected.images.push(reference)
                    uploads.push({ reference, name: file.name, role: file.role === 'expected' ? 'expected' : 'actual' })
                } catch (error) {
                    if (error?.code === 'mediaUploadFailed') { this.writeLocks.delete(lock); throw error }
                    throw new WriteError('writeUnknown')
                }
            }
            params.set('uid', uid)
            // Group screenshots under the reader-facing headings so 预期结果 and
            // 实际结果 stay distinguishable inside the single ZenTao passage.
            const grouped = [['expected', '预期结果'], ['actual', '实际结果']].map(([role, label]) => {
                const items = uploads.filter(item => item.role === role)
                return items.length ? `<h3>${label}</h3>` + items.map(item => imageMarkup(item.reference, item.name)).join('') : ''
            }).join('')
            params.set('steps', String(params.get('steps') || '') + grouped)
        }
        let body = params.toString()
        if (videos.length) {
            const multipart = new FormData()
            for (const [key, value] of params) multipart.append(key, value)
            for (const file of videos) {
                multipart.append('files[]', new Blob([file.bytes], { type: file.type }), file.name)
                multipart.append('labels[]', file.name)
            }
            body = multipart
        }
        let response
        try {
            await this.assertContext(state)
            if (media.length) {
                const url = new URL(path, state.origin)
                url.searchParams.set('tid', state.tid)
                const sent = await this.session.send(state, url, { method: 'POST', headers: {
                    ...(videos.length ? {} : { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' }),
                    'accept': 'text/html, */*; q=0.01', 'origin': state.origin,
                    'referer': new URL(path, state.origin).href, 'x-requested-with': 'XMLHttpRequest'
                }, body })
                if (!sent.ok) throw new Error('writeUnknown')
                const text = await sent.text()
                try { response = JSON.parse(text) } catch { if (editor.mode === 'create') throw new Error('writeUnknown') }
            } else response = await this.session.json(path, { method: 'POST', headers: {
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'accept': 'text/html, */*; q=0.01',
                'origin': state.origin,
                'referer': new URL(path, state.origin).href,
                'x-requested-with': 'XMLHttpRequest',
            }, body })
        } catch { throw new WriteError('writeUnknown') }
        let result
        try {
            // The shared parser expects an id at the envelope level; normalize
            // the common ZenTao {result:'success', data:{id}} response here.
            if (!response && editor.mode === 'edit' && media.length) result = { id: editor.id }
            else {
                let parsed = response.data
                if (typeof parsed === 'string' && parsed.startsWith('{')) {
                    try { parsed = JSON.parse(parsed) } catch { /* shared parser handles it */ }
                }
                const normalized = response.result === 'success' && object(parsed) && parsed.id
                    ? { ...response, id: parsed.id }
                    : response
                result = parseWriteResponse(JSON.stringify(normalized), editor.mode, editor.id)
            }
        }
        catch (error) {
            if (error instanceof WriteError && ['serverRejected', 'writeAuthExpired'].includes(error.code)) {
                this.writeLocks.delete(lock)
                // Keep only field-level validation messages, with secrets removed.
                const allowed = new Set(['title', 'product', 'branch', 'module', 'project', 'execution', 'assignedTo', 'severity', 'pri', 'type', 'deadline', 'openedBuild', 'openedBuild[]', 'steps', 'comment', 'form'])
                const secrets = [state.token, ...(state.cookies?.values?.() || []),
                    ...(state.authMode === 'cookie' ? state.token.split(';').map(pair => pair.slice(pair.indexOf('=') + 1).trim()) : [])]
                    .filter(value => typeof value === 'string' && value).flatMap(value => [value, encodeURIComponent(value)])
                    .sort((a, b) => b.length - a.length)
                const redact = value => secrets.reduce((message, secret) => message.split(secret).join('[已隐藏]'), String(value))
                    .replace(/(?:token|password|cookie)\s*[:=]\s*\S+/gi, '[已隐藏]').slice(0, 300)
                const fields = Object.fromEntries(Object.entries(error.fields || {})
                    .filter(([key]) => allowed.has(key))
                    .map(([key, value]) => [key, redact(value)]))
                throw new WriteError(error.code, fields)
            }
            throw error
        }
        try {
            const detail = await this.details(result.id)
            if (!compareReadback(editor, detail.bug, expected)) {
                this.pendingWrites.set(lock, { id: String(result.id), editor, expected })
                return { id: result.id, readbackPending: true, ...(media.length ? { mediaExpected: expected } : {}) }
            }
            this.writeLocks.delete(lock)
            // The verified readback already contains the safe display-name map.
            // Preserve it so the immediate post-create detail never falls back
            // to raw ZenTao accounts while deliberately skipping a duplicate GET.
            return {
                id: result.id,
                bug: detail.bug,
                actions: detail.actions,
                histories: detail.histories,
                data: { users: object(detail.data?.users) ? detail.data.users : {} }
            }
        } catch {
            this.pendingWrites.set(lock, { id: String(result.id), editor, expected })
            return { id: result.id, readbackPending: true, ...(media.length ? { mediaExpected: expected } : {}) }
        }
    }

    // The caller supplies a confirmation from the visible, single-Bug UI. A
    // fresh detail read and the authenticated Session both have to agree with
    // it before the sole POST. Unknown outcomes retain both locks; reconciliation
    // is GET-only and cannot authorize a retry.
    async closeResolvedBug({ bugId, confirmation, comment = '', media = [] } = {}) {
        const bugIdText = id(bugId)
        if (typeof comment !== 'string' || comment.length > 5000 || /[\u0000\r]/.test(comment)) throw new WriteError('invalidCloseComment')
        if (!Array.isArray(media) || media.some(file => file?.kind !== 'image')) throw new WriteError('invalidMedia')
        let state = await this.session.context()
        const writer = JSON.stringify([state.origin, state.account, state.userId])
        const key = JSON.stringify([state.origin, state.account, state.userId, bugIdText])
        if (this.writeLocks.has(writer) || this.closeLocks.has(key)) throw new WriteError('writeLocked')
        const before = await this.details(bugIdText)
        const current = await this.session.context()
        if (current.origin !== state.origin || current.account !== state.account || current.userId !== state.userId)
            throw new WriteError('identityMismatch')
        state = current
        if (!confirmation || confirmation.action !== 'closeBug' || String(confirmation.id) !== bugIdText ||
            confirmation.title !== before.bug.title || confirmation.status !== 'resolved' ||
            confirmation.account !== state.account || String(confirmation.userId) !== state.userId)
            throw new WriteError('confirmationMismatch')
        if (before.bug.status !== 'resolved') {
            const receipt = existingCloseReceipt(before, { id: bugIdText, title: before.bug.title, account: state.account })
            if (receipt) return receipt
            throw new WriteError('invalidBugStatus')
        }
        if (!/^[A-Za-z0-9_-]{4,80}$/.test(state.tid || '')) throw new WriteError('closeFormUnavailable')
        const url = new URL(`/bug-close-${bugIdText}.html`, state.origin)
        url.searchParams.set('onlybody', 'yes')
        url.searchParams.set('tid', state.tid)
        const form = await this.session.send(state, url, { method: 'GET', headers: {
            'accept': 'text/html, */*; q=0.01', 'x-requested-with': 'XMLHttpRequest'
        } })
        if (!form.ok) {
            const latest = await this.details(bugIdText)
            const receipt = existingCloseReceipt(latest, { id: bugIdText, title: before.bug.title, account: state.account })
            if (receipt) return receipt
            if (latest.bug.status !== 'resolved') throw new WriteError('invalidBugStatus')
            throw new WriteError('closeFormUnavailable')
        }
        let uid
        try { uid = closeFormUid(await form.text(), url) }
        catch (error) {
            if (error?.code !== 'closeFormUnavailable') throw error
            // Some ZenTao builds return a shell fragment for AJAX but the
            // complete close form for a normal GET. Both reads are safe; no
            // POST is allowed until the same strict form contract passes.
            const plain = await this.session.send(state, url, { method: 'GET', headers: {
                'accept': 'text/html, */*; q=0.01'
            } })
            if (!plain.ok) {
                const latest = await this.details(bugIdText)
                const receipt = existingCloseReceipt(latest, { id: bugIdText, title: before.bug.title, account: state.account })
                if (receipt) return receipt
                if (latest.bug.status !== 'resolved') throw new WriteError('invalidBugStatus')
                throw new WriteError('closeFormUnavailable')
            }
            try { uid = closeFormUid(await plain.text(), url) }
            catch (plainError) {
                if (plainError?.code !== 'closeFormUnavailable') throw plainError
                // A previous close may have committed while ZenTao's detail JSON
                // was briefly stale. Reconcile with GET only; never resend POST.
                const latest = await this.details(bugIdText)
                const receipt = existingCloseReceipt(latest, { id: bugIdText, title: before.bug.title, account: state.account })
                if (receipt) return receipt
                if (latest.bug.status !== 'resolved') throw new WriteError('invalidBugStatus')
                throw plainError
            }
        }
        if (this.writeLocks.has(writer) || this.closeLocks.has(key)) throw new WriteError('writeLocked')
        // The REST file endpoint requires the same proven 26-character uid
        // used by create/edit uploads. Current ZenTao close forms may omit uid;
        // when screenshots exist, generate one association key and bind it to
        // both the uploads and the sole close POST.
        const submitUid = media.length ? 'ds' + randomBytes(12).toString('hex') : uid
        const attempt = { id: bugIdText, title: before.bug.title, account: state.account,
            beforeActions: new Set(before.actions.map(action => String(action.id))), expectedImages: [] }
        this.writeLocks.add(writer)
        this.closeLocks.set(key, attempt)
        if (media.length) {
            try { await this.mediaUploadStatus(state) }
            catch {
                this.writeLocks.delete(writer); this.closeLocks.delete(key)
                throw new WriteError('mediaAuthUnavailable')
            }
            for (const file of media) {
                try {
                    const upload = new FormData()
                    upload.append('imgFile', new Blob([file.bytes], { type: file.type }), file.name)
                    const uploadUrl = new URL('/api.php/v1/files', state.origin)
                    uploadUrl.searchParams.set('uid', submitUid)
                    await this.assertContext(state)
                    const uploaded = await this.session.send(state, uploadUrl, { method: 'POST', headers: {
                        'Token': state.token, 'accept': 'application/json'
                    }, body: upload })
                    if (!uploaded.ok) {
                        if (uploaded.status >= 400 && uploaded.status < 500) throw new WriteError('mediaUploadFailed', { form: `上传接口返回 HTTP ${uploaded.status}，关闭请求尚未发送。` })
                        throw new Error('writeUnknown')
                    }
                    let answer
                    try { answer = await uploaded.json() } catch { throw new Error('writeUnknown') }
                    if (typeof answer?.data === 'string' && answer.status === 'success') {
                        try { answer = JSON.parse(answer.data) } catch { throw new Error('writeUnknown') }
                    }
                    if (answer?.error != null && ![0, '0', false].includes(answer.error) || ['fail', 'error'].includes(answer?.status)) throw new WriteError('mediaUploadFailed', { form: '上传接口拒绝了验收截图，关闭请求尚未发送。' })
                    if (typeof answer?.url !== 'string' || !/^[1-9]\d*$/.test(String(answer?.id ?? ''))) throw new Error('writeUnknown')
                    const reference = imageReference(answer.url, state.origin)
                    if (attempt.expectedImages.includes(reference)) throw new Error('invalidMediaResponse')
                    attempt.expectedImages.push(reference)
                } catch (error) {
                    if (error?.code === 'mediaUploadFailed') {
                        this.writeLocks.delete(writer); this.closeLocks.delete(key)
                        throw error
                    }
                    throw new WriteError('writeUnknown')
                }
            }
        }
        const evidence = attempt.expectedImages.length ? '<h3>验收截图</h3>' + attempt.expectedImages.map((path, index) => imageMarkup(path, media[index].name)).join('') : ''
        const fields = new URLSearchParams({ status: 'closed', comment: comment + evidence })
        if (submitUid) fields.set('uid', submitUid)
        const body = fields.toString()
        await this.assertContext(state)
        // A timeout, redirect, rejected response or invalid HTML body does not
        // prove the server ignored the POST. Always reconcile with a safe GET.
        try {
            const response = await this.session.send(state, url, { method: 'POST', headers: {
                'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'accept': 'text/html, */*; q=0.01',
                'origin': state.origin,
                'referer': url.href,
                'x-requested-with': 'XMLHttpRequest'
            }, body })
            if (!response.ok) throw new WriteError('writeUnknown')
        } catch { /* Reconcile the one attempted POST. Never resend it. */ }
        // ZenTao can expose the close action a few hundred milliseconds after
        // accepting the POST. Poll with bounded GET-only reads; never resend.
        for (const delay of [0, 150, 500]) {
            if (delay) await new Promise(resolve => setTimeout(resolve, delay))
            try {
                const detail = await this.details(bugIdText)
                const receipt = closeReceipt(detail, attempt)
                if (receipt) {
                    this.writeLocks.delete(writer)
                    return receipt
                }
            } catch { /* Missing readback is still an unknown write outcome. */ }
        }
        throw new WriteError('writeUnknown')
    }

    async reconcileClosedBug({ bugId } = {}) {
        const bugIdText = id(bugId)
        const state = await this.session.context()
        const key = JSON.stringify([state.origin, state.account, state.userId, bugIdText])
        const attempt = this.closeLocks.get(key)
        if (!attempt) throw new WriteError('closeAttemptMissing')
        const receipt = closeReceipt(await this.details(bugIdText), attempt)
        if (!receipt) throw new WriteError('readbackMismatch')
        return receipt // Retain the per-Bug lock; this method never sends a POST.
    }

    // Read-only reconciliation never clears an uncertain POST lock: an old Bug
    // with identical fields would otherwise allow an accidental duplicate.
    async reconcile(editor, bugId) {
        const state = await this.session.context()
        const lock = JSON.stringify([state.origin, state.account, state.userId])
        const pending = this.pendingWrites.get(lock)
        const target = id(bugId)
        if (pending && (pending.id !== target ||
            pending.editor.mode !== editor?.mode ||
            pending.editor.fields.title !== editor?.fields?.title)) throw new WriteError('readbackMismatch')
        const detail = await this.details(target)
        if (!compareReadback(pending?.editor || editor, detail.bug, pending?.expected || editor?.mediaExpected || {})) throw new WriteError('readbackMismatch')
        if (pending) {
            this.pendingWrites.delete(lock)
            this.writeLocks.delete(lock)
        }
        return detail.bug
    }
}
