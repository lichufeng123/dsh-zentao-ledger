/* ZenTao ledger panel. Host transport is deliberately confined to createService. */
window.__ModuleLoader__.load({
  id: 'dsh-zentao-ledger',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React

    function createService(ctx) {
      // The authenticated same-origin host route owns ZenTao transport and credentials.
      // Keep the route, envelopes and host method mapping confined to this adapter.
      const rpcUrl = new URL('/api/zentao-ledger/rpc', document.baseURI)
      const imageUrl = new URL('/api/zentao-ledger/image', document.baseURI)
      const mediaUrl = new URL('/api/zentao-ledger/media', document.baseURI)
      async function call(method, args = {}) {
        const response = await fetch(rpcUrl, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) })
        let result
        try { result = await response.json() } catch { throw Object.assign(Error('serviceUnavailable'), { code: 'serviceUnavailable' }) }
        if (!response.ok || result && result.ok === false) {
          const failure = result && result.error || {}
          const code = typeof failure === 'string' ? failure : failure.code || 'serviceError'
          throw Object.assign(new Error(code), { code, fields: typeof failure === 'object' ? failure.fields || {} : {} })
        }
        return result && result.ok === true ? result.value : result
      }
      const identityState = state => ({ site: state?.site || {}, origin: state?.identity?.origin || state?.origin || '', connected: !!(state && !state.error && (state.account || state.identity && state.identity.account)), configured: !!(state && (state.configured || state.account || state.identity && state.identity.account)), account: state && !state.error && (state.account || state.identity && state.identity.account), userId: state && !state.error && (state.userId || state.identity && state.identity.userId), realname: state && !state.error && (state.realname || state.identity && state.identity.realname), error: state && state.error, preferredView: state?.preferredView, preferredPlace: state?.preferredPlace })
      return {
        status: () => call('status').then(identityState),
        saveView: view => call('setPreferredView', { view }),
        savePlace: place => call('setPreferredPlace', { place }),
        connect: (secret, authMode) => (secret ? call('configure', authMode === 'cookie' ? { cookie: secret } : { token: secret }) : call('status')).then(identityState),
        disconnect: () => call('disconnect'),
        members: product => call('members', { product }),
        list: ({ userId, page, status }) => call('listReports', { userId, page, status }),
        stories: page => call('listStories', { page }),
        detail: id => call('details', { id }),
        closeBug: async (bugId, confirmation, comment, files = []) => {
          if (!files.length) return call('closeBug', { bugId, confirmation, comment })
          const body = new FormData()
          body.set('operation', 'closeBug')
          body.set('bugId', bugId)
          body.set('confirmation', JSON.stringify(confirmation))
          body.set('comment', comment)
          for (const file of files) body.append('media', file, file.name)
          const response = await fetch(mediaUrl, { method: 'POST', credentials: 'same-origin', body })
          let result
          try { result = await response.json() } catch { throw Object.assign(Error('writeUnknown'), { code: 'writeUnknown' }) }
          if (!response.ok || result?.ok !== true) {
            const code = typeof result?.error === 'string' ? result.error : result?.error?.code || 'writeUnknown'
            throw Object.assign(Error(code), { code, fields: result?.fields || {} })
          }
          return result.value
        },
        reconcileClose: bugId => call('reconcileClose', { bugId }),
        metadata: (mode, fields, id) => call('editor', { mode, fields, id }),
        creatorBuildIds: product => call('creatorBuilds', { product }),
        mediaUploadStatus: () => call('mediaUploadStatus'),
        optimizeDraft: ({ title, description, openedBuild, images }) => call('optimizeDraft', { title, description, openedBuild, images }),
        image: async path => {
          if (!(/^\/(?!\/)/.test(path) || /^https:\/\//i.test(path))) throw Object.assign(Error('invalidImage'), { code: 'invalidImage' })
          const url = new URL(imageUrl)
          url.searchParams.set('path', path)
          const response = await fetch(url, { credentials: 'same-origin' })
          if (!response.ok) throw Object.assign(Error('invalidImage'), { code: 'invalidImage' })
          const contentType = (response.headers.get('content-type') || '').split(';')[0]
          if (!/^image\/(png|jpeg|gif|webp)$/i.test(contentType)) throw Object.assign(Error('invalidImage'), { code: 'invalidImage' })
          return { blob: await response.blob(), contentType }
        },
        write: async (editor, confirmation, files = []) => {
          if (!files.length) return call('commit', { editor, confirmation })
          const body = new FormData()
          body.set('editor', JSON.stringify(editor))
          body.set('confirmation', JSON.stringify(confirmation))
          body.set('roles', JSON.stringify(files.map(file => file.role === 'expected' ? 'expected' : 'actual')))
          for (const file of files) body.append('media', file, file.name)
          const response = await fetch(mediaUrl, { method: 'POST', credentials: 'same-origin', body })
          let result
          try { result = await response.json() } catch { throw Object.assign(Error('writeUnknown'), { code: 'writeUnknown' }) }
          if (!response.ok || result?.ok !== true) {
            const code = typeof result?.error === 'string' ? result.error : result?.error?.code || 'writeUnknown'
            throw Object.assign(Error(code), { code, fields: result?.fields || {} })
          }
          return result.value
        },
        readback: (id, editor) => call('readback', { id, editor })
      }
    }

    // Bounded, site-and-account-scoped snapshot so re-entering paints the last list
    // before the background refresh. Display fields only; never credentials.
    const CACHE_PREFIX = 'dsh-zentao-ledger:snapshot:'
    const CACHE_FIELDS = ['id', 'title', 'status', 'product', 'productName', 'assignedTo', 'assignedAccount', 'openedBy', 'openedDate', 'pri', 'priority', 'severity']
    const readSnapshot = scope => {
      if (!validStorageScope(scope)) return null
      try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem(CACHE_PREFIX + scope) || 'null')
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items) || !validView(parsed.view)) return null
        if (Date.now() - Number(parsed.at || 0) > 7 * 86400000) return null
        return parsed
      } catch { return null }
    }
    const writeSnapshot = (scope, value) => {
      if (!validStorageScope(scope)) return
      try {
        const items = value.items.slice(0, 300).map(row => Object.fromEntries(CACHE_FIELDS.filter(key => row && row[key] !== undefined).map(key => [key, row[key]])))
        globalThis.localStorage?.setItem(CACHE_PREFIX + scope, JSON.stringify({ v: 1, at: Date.now(), view: value.view, reporter: value.reporter, page: value.page, pages: value.pages, items }))
      } catch { /* A full or disabled store must never break the ledger. */ }
    }
    const clearSnapshot = scope => {
      if (!validStorageScope(scope)) return
      try { globalThis.localStorage?.removeItem(CACHE_PREFIX + scope) } catch { /* ignore */ }
    }
    const DRAFT_PREFIX = 'dsh-zentao-ledger:create-draft:'
    const readCreateDraft = scope => {
      if (!validStorageScope(scope)) return null
      try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem(DRAFT_PREFIX + scope) || 'null')
        if (!parsed || parsed.v !== 1 || !parsed.fields || typeof parsed.fields !== 'object' || Array.isArray(parsed.fields)) return null
        if (Date.now() - Number(parsed.at || 0) > 7 * 86400000) { globalThis.localStorage?.removeItem(DRAFT_PREFIX + scope); return null }
        return parsed
      } catch { return null }
    }
    const writeCreateDraft = (scope, editor, mediaCount = 0) => {
      if (!validStorageScope(scope) || editor?.mode !== 'create') return
      const source = editor.fields || {}
      const safeChoice = value => /^[A-Za-z0-9_-]{0,80}$/.test(str(value)) ? str(value) : ''
      const fields = {
        title: str(source.title).slice(0, 255),
        assignedTo: safeChoice(source.assignedTo), severity: safeChoice(source.severity), pri: safeChoice(source.pri), type: safeChoice(source.type),
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(str(source.deadline)) ? str(source.deadline) : '',
        openedBuild: Array.isArray(source.openedBuild) ? source.openedBuild.map(safeChoice).filter(Boolean).slice(0, 50) : [],
        description: str(source.description).slice(0, 12000)
      }
      try { globalThis.localStorage?.setItem(DRAFT_PREFIX + scope, JSON.stringify({ v: 1, at: Date.now(), fields, mediaCount: Math.max(0, Math.min(6, Number(mediaCount) || 0)) })) }
      catch { /* A full or disabled store must never break form editing. */ }
    }
    const clearCreateDraft = scope => {
      if (!validStorageScope(scope)) return
      try { globalThis.localStorage?.removeItem(DRAFT_PREFIX + scope) } catch { /* ignore */ }
    }
    const DRAFT_BOX_PREFIX = 'dsh-zentao-ledger:draft-box:'
    const readDraftBox = scope => {
      if (!validStorageScope(scope)) return []
      try {
        const parsed = JSON.parse(globalThis.localStorage?.getItem(DRAFT_BOX_PREFIX + scope) || 'null')
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.drafts)) return []
        const drafts = parsed.drafts.filter(draft => draft && /^[A-Za-z0-9_-]{6,80}$/.test(str(draft.id)) && draft.fields && Date.now() - Number(draft.at || 0) <= 30 * 86400000).slice(0, 20)
        if (drafts.length !== parsed.drafts.length) globalThis.localStorage?.setItem(DRAFT_BOX_PREFIX + scope, JSON.stringify({ v: 1, drafts }))
        return drafts
      } catch { return [] }
    }
    const writeDraftBox = (scope, drafts) => {
      if (!validStorageScope(scope)) return []
      const safe = drafts.slice(0, 20)
      try { globalThis.localStorage?.setItem(DRAFT_BOX_PREFIX + scope, JSON.stringify({ v: 1, drafts: safe })) } catch { /* ignore */ }
      return safe
    }
    const stashCreateDraft = (scope, editor, mediaCount = 0) => {
      writeCreateDraft(scope, editor, mediaCount)
      const saved = readCreateDraft(scope)
      if (!saved) return readDraftBox(scope)
      const id = 'draft_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
      const record = { ...saved, id, at: Date.now() }
      return writeDraftBox(scope, [record, ...readDraftBox(scope)])
    }
    const removeBoxDraft = (scope, draftId) => writeDraftBox(scope, readDraftBox(scope).filter(draft => draft.id !== draftId))
    const clearDraftBox = scope => {
      if (!validStorageScope(scope)) return
      try { globalThis.localStorage?.removeItem(DRAFT_BOX_PREFIX + scope) } catch { /* ignore */ }
    }
    const DRAFT_MEDIA_DB = 'dsh-zentao-ledger-draft-media'
    const draftMediaKey = (scope, draftId) => `${scope}:${draftId}`
    const openDraftMediaDb = () => new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { resolve(null); return }
      const request = globalThis.indexedDB.open(DRAFT_MEDIA_DB, 1)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts', { keyPath: 'key' }) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || Error('draftMediaUnavailable'))
      request.onblocked = () => reject(Error('draftMediaUnavailable'))
    })
    const draftMediaStore = async (mode, operation) => {
      const db = await openDraftMediaDb()
      if (!db) return null
      try {
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction('drafts', mode)
          const request = operation(transaction.objectStore('drafts'))
          let result
          request.onsuccess = () => { result = request.result }
          request.onerror = () => reject(request.error || Error('draftMediaUnavailable'))
          transaction.oncomplete = () => resolve(result)
          transaction.onabort = () => reject(transaction.error || Error('draftMediaUnavailable'))
        })
      } finally { db.close() }
    }
    const draftMediaQueues = new Map()
    const queueDraftMedia = (key, operation) => {
      const previous = draftMediaQueues.get(key) || Promise.resolve()
      const next = previous.catch(() => {}).then(operation)
      draftMediaQueues.set(key, next)
      next.finally(() => { if (draftMediaQueues.get(key) === next) draftMediaQueues.delete(key) }).catch(() => {})
      return next
    }
    const writeDraftMedia = async (scope, draftId, files) => {
      if (!validStorageScope(scope) || !/^[A-Za-z0-9_-]{3,100}$/.test(str(draftId))) return false
      const key = draftMediaKey(scope, draftId)
      return queueDraftMedia(key, async () => {
        if (!Array.isArray(files) || !files.length) { await draftMediaStore('readwrite', store => store.delete(key)); return true }
        const safe = files.slice(0, 6).map(file => ({ blob: file, name: str(file.name).slice(0, 255), type: str(file.type).slice(0, 80), lastModified: Number(file.lastModified) || Date.now(), role: file.role === 'expected' ? 'expected' : 'actual' }))
        if (safe.some(item => !item.name || !/^image\/(?:png|jpeg|gif)$|^video\/mp4$/i.test(item.type) || !item.blob?.size) || safe.reduce((sum, item) => sum + item.blob.size, 0) > 40 * 1024 * 1024) return false
        const result = await draftMediaStore('readwrite', store => store.put({ key, scope, draftId, at: Date.now(), files: safe }))
        return result !== null
      })
    }
    const readDraftMedia = async (scope, draftId) => {
      if (!validStorageScope(scope) || !/^[A-Za-z0-9_-]{3,100}$/.test(str(draftId))) return []
      const key = draftMediaKey(scope, draftId)
      await draftMediaQueues.get(key)?.catch(() => {})
      const record = await draftMediaStore('readonly', store => store.get(key))
      if (!record || !Array.isArray(record.files) || record.files.length > 6 || Date.now() - Number(record.at || 0) > 30 * 86400000) return []
      const files = []
      for (const item of record.files) {
        if (!item?.blob || !item.name || !/^image\/(?:png|jpeg|gif)$|^video\/mp4$/i.test(str(item.type))) return []
        const file = new File([item.blob], str(item.name).slice(0, 255), { type: str(item.type), lastModified: Number(item.lastModified) || Date.now() })
        try { file.role = item.role === 'expected' ? 'expected' : 'actual' } catch { /* File remains usable without an expando. */ }
        files.push(file)
      }
      return files
    }
    const removeDraftMedia = async (scope, draftId) => {
      if (!validStorageScope(scope) || !/^[A-Za-z0-9_-]{3,100}$/.test(str(draftId))) return false
      const key = draftMediaKey(scope, draftId)
      return queueDraftMedia(key, async () => (await draftMediaStore('readwrite', store => store.delete(key))) !== null)
    }
    const clearUserDraftMedia = async scope => {
      if (!validStorageScope(scope)) return
      await Promise.all([...draftMediaQueues.entries()].filter(([key]) => key.startsWith(scope + ':')).map(([, pending]) => pending.catch(() => {})))
      const db = await openDraftMediaDb()
      if (!db) return
      try {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('drafts', 'readwrite')
          const store = transaction.objectStore('drafts')
          const request = store.openCursor()
          request.onsuccess = () => { const cursor = request.result; if (!cursor) return; if (cursor.value?.scope === scope) cursor.delete(); cursor.continue() }
          request.onerror = () => reject(request.error || Error('draftMediaUnavailable'))
          transaction.oncomplete = resolve
          transaction.onerror = () => reject(transaction.error || Error('draftMediaUnavailable'))
        })
      } finally { db.close() }
    }
    const restoreCreateDraft = (editor, draft) => {
      if (editor?.mode !== 'create' || !draft?.fields) return editor
      const saved = draft.fields
      const allowed = field => new Set(choices(editor, field).map(option => option.value))
      const builds = allowed('openedBuild')
      const assignees = allowed('assignedTo')
      const types = allowed('type')
      const fields = { ...editor.fields,
        title: typeof saved.title === 'string' ? saved.title.slice(0, 255) : editor.fields.title,
        description: typeof saved.description === 'string' ? saved.description.slice(0, 12000) : editor.fields.description,
        assignedTo: saved.assignedTo === '' || assignees.has(saved.assignedTo) ? saved.assignedTo : editor.fields.assignedTo,
        severity: ['1', '2', '3', '4'].includes(saved.severity) ? saved.severity : editor.fields.severity,
        pri: ['1', '2', '3', '4', '5'].includes(saved.pri) ? saved.pri : editor.fields.pri,
        type: types.has(saved.type) ? saved.type : editor.fields.type,
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(saved.deadline || '') && validDate(saved.deadline) !== null ? saved.deadline : '',
        openedBuild: Array.isArray(saved.openedBuild) ? saved.openedBuild.filter(value => builds.has(value)).slice(0, 50) : editor.fields.openedBuild
      }
      return { ...editor, fields }
    }

    let lastView = 'active'
    const views = [
      ['active', '待处理'], ['all', '全部报告'], ['resolved', '已解决'], ['board', '责任人看板']
    ]
    const validView = value => value === 'requirements' || views.some(([key]) => key === value)
    const str = value => value == null ? '' : String(value)
    const personLabel = (person, users = {}) => {
      const account = str(person && typeof person === 'object' ? person.account : person)
      const mapped = users && typeof users === 'object' ? users[account] : ''
      const realname = str(mapped && typeof mapped === 'object' ? mapped.realname || mapped.name : mapped || (person && typeof person === 'object' ? person.realname : '')).trim()
      return realname && realname !== account ? realname : account
    }
    const digits = value => /^[1-9]\d*$/.test(str(value))
    const normalizedOrigin = value => {
      try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : '' } catch { return '' }
    }
    const verifiedOrigin = connection => {
      const origin = normalizedOrigin(connection?.site?.origin)
      const identityOrigin = normalizedOrigin(connection?.origin || connection?.identity?.origin)
      return connection?.site?.configured === true && origin && (!(connection?.connected || connection?.account) || identityOrigin === origin) ? origin : ''
    }
    const storageScopeFor = connection => {
      const origin = verifiedOrigin(connection)
      return origin && connection?.account && digits(connection?.userId) ? encodeURIComponent(JSON.stringify([origin, str(connection.account), str(connection.userId)])) : ''
    }
    const validStorageScope = value => {
      try { const parts = JSON.parse(decodeURIComponent(value)); return Array.isArray(parts) && parts.length === 3 && normalizedOrigin(parts[0]) === parts[0] && !!parts[1] && digits(parts[2]) } catch { return false }
    }
    const createContext = site => ({ product: str(site?.productId), project: str(site?.projectId), branch: '0', module: '0', execution: '0' })
    const fixedCreateValid = (editor, site) => {
      const expected = createContext(site)
      return !!editor?.context && digits(expected.product) && /^\d+$/.test(expected.project) && Object.entries(expected).every(([key, value]) => editor.context[key] === value && editor.fields[key] === value)
    }
    const newestBuildFirst = (a, b) => {
      const aNumber = digits(a.value), bNumber = digits(b.value)
      if (aNumber && bNumber) return BigInt(a.value) > BigInt(b.value) ? -1 : BigInt(a.value) < BigInt(b.value) ? 1 : 0
      return aNumber === bNumber ? 0 : aNumber ? -1 : 1
    }
    const siteUrl = (origin, path) => normalizedOrigin(origin) ? new URL(path, origin + '/').href : ''
    const requirementsPageUrl = (origin, productId) => digits(productId) ? siteUrl(origin, `product-browse-${productId}.html`) : ''
    const storyPageUrl = (row, origin) => digits(row?.id) && ['story', 'requirement'].includes(row?.type)
      ? siteUrl(origin, `story-view-${str(row.id)}-0-0-${row.type}.html`) : ''
    const bugActionUrl = (id, action, origin) => digits(id) && ['view', 'edit', 'activate', 'close'].includes(action) ? siteUrl(origin, `bug-${action}-${str(id)}.html`) : ''
    const bugPageUrl = (id, origin) => bugActionUrl(id, 'view', origin)
    const validDate = value => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(value).slice(0, 10))
      if (!match || Number(match[1]) < 1970) return null
      const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      return new Date(stamp).toISOString().slice(0, 10) === match[0] ? stamp : null
    }
    const hangingDays = value => { const stamp = validDate(value); return stamp === null ? null : Math.max(0, Math.floor((Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - stamp) / 86400000)) }
    const urgency = bug => ['1', '5'].includes(str(bug.pri || bug.priority)) ? 0 : Number(bug.pri || bug.priority) || 9
    const message = error => {
      const code = error && (error.code || error.message)
      const known = {
        serviceUnavailable: '连接服务尚未就绪。请检查面板安装及主机接口。',
        credentialsUnavailable: '请先填写可交换禅道会话的访问令牌。',
        cookieUnavailable: '请先填写你自己的禅道 Cookie。',
        siteUnconfigured: '请先在 DSH 插件配置中设置禅道站点、产品和项目。',
        authExpired: '禅道会话已过期。请重新连接后重试。',
        authFailed: '连接认证失败。请核对主机凭据。',
        identityMismatch: '连接身份与配置不一致，请核对后重新连接。',
        accountChanged: '本机授权账号与已保存账号不一致，自动续期已停止。请核对身份后重新连接。',
        timeout: '请求超时。请检查连接后重试。',
        writeUnknown: '提交结果无法确认。请先在禅道核对记录，切勿重复提交。',
        writeLocked: '上次提交结果未确认。请先核对记录，暂不能再次提交。',
        closeFormUnavailable: '禅道关闭表单未通过校验，请在原站关闭；台账没有发送关闭请求。',
        invalidBugStatus: '这条 Bug 已不是“已解决”，请刷新详情后再判断。',
        invalidCloseComment: '关闭说明不符合长度或格式要求。',
        closeAttemptMissing: '找不到本次关闭尝试；请在禅道原站核对状态和操作历史。',
        conflict: '记录已在别处修改，请重新打开编辑表单。',
        serverRejected: '提交被禅道拒绝，请查看下方字段提示并修改。',
        readbackMismatch: '提交后回读不一致，请在禅道核对记录。',
        invalidPagination: '分页返回异常，请重新加载报告。',
        buildCreatorUnavailable: '暂时无法获取构建创建人信息。',
        buildCreatorIncomplete: '构建列表不完整，无法确认创建人筛选结果。',
        buildCreatorAmbiguous: '无法唯一确定构建创建人。',
        fixedContextUnavailable: '配置的产品与项目归属暂不可用，请核对 DSH 站点配置后重新打开表单。',
        invalidMedia: '文件格式或内容不符合要求，请重新选择图片或 MP4 视频。',
        mediaLimit: '文件数量或大小超出限制，请减少文件后重试。',
        mediaUploadFailed: '图片已通过本地格式和大小检查，但禅道拒绝上传。请核对站点上传权限或限制后再试。',
        mediaAuthUnavailable: '网页登录有效，但禅道文件接口未认可当前授权；本次没有上传图片或提交 Bug。请重新授权文件接口后再试。',
        aiUnavailable: 'AI 优化未完成：当前 DSH 模型服务不可用。草稿仍保留，可重试或手动编辑；没有提交 Bug。',
        aiParseFailed: 'AI 已返回内容，但格式无法解析。草稿仍保留，可重试或手动编辑；没有提交 Bug。',
        aiOutputTooLong: 'AI 返回内容过长，未应用到草稿；没有提交 Bug。',
        invalidMediaResponse: '禅道未返回可信的图片地址，提交已停止，请核对上传状态。'
      }
      return known[code] || '操作未完成，请检查连接或稍后重试。'
    }
    function mapFormErrors(fields, editor) {
      const aliases = { 'openedBuild[]': 'openedBuild', steps: 'description', level: 'form', 'productID': 'product', 'moduleID': 'module', 'projectID': 'project', 'executionID': 'execution' }
      const visible = new Set(['product', 'branch', 'module', 'project', 'execution', 'title', 'assignedTo', 'severity', 'pri', 'type', 'deadline', 'openedBuild', 'description', 'comment', 'form'])
      const codes = { titleRequired: '请输入标题', titleTooLong: '标题不能超过 255 字', productRequired: '请选择产品', buildRequired: '请至少选择一个影响版本', invalidChoice: '选项不在当前可选范围内', dateInvalid: '请选择有效日期', validationFailed: '请核对表单字段' }
      const mapped = {}
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return mapped
      for (const [rawKey, rawValue] of Object.entries(fields)) {
        const key = aliases[rawKey] || rawKey
        let text = Array.isArray(rawValue) ? rawValue.map(str).join('；') : str(rawValue)
        text = codes[text] || text.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300)
        if (/token\s*=|password|cookie|authorization|user-login/i.test(text)) text = '该字段未通过校验，请核对后重试。'
        if (!text) text = '该字段未通过校验，请核对后重试。'
        if (visible.has(key) && !['branch', 'module', 'execution'].includes(key) && !(key === 'description' && editor && editor.mode === 'edit' && editor.fields.descriptionAction === 'keep')) mapped[key] = text
        else mapped.form = [mapped.form, text].filter(Boolean).join('；').slice(0, 500)
      }
      return mapped
    }
    const optionList = source => {
      if (!source || typeof source !== 'object') return []
      if (Array.isArray(source)) return source.map(item => typeof item === 'object' ? { value: str(item.value ?? item.id), label: str(item.label ?? item.name ?? item.title ?? item.value ?? item.id) } : { value: str(item), label: str(item) })
      return Object.entries(source).map(([value, label]) => ({ value, label: str(typeof label === 'object' && label ? label.name || label.title || value : label) }))
    }
    function choices(editor, key) {
      if (!editor) return []
      const data = editor.data || {}
      const source = {
        product: data.products, branch: data.branches || data.branchTagOption,
        module: data.moduleOptionMenu, project: data.projects, execution: data.executions,
        assignedTo: editor.mode === 'edit' ? data.assignedToList || data.users : data.productMembers || data.users,
        openedBuild: editor.mode === 'edit' ? data.openedBuilds : data.builds,
        type: data.types || data.typeList || data.bugTypes || { codeerror: '代码错误', interface: '界面问题', config: '配置问题', install: '安装部署', security: '安全问题', performance: '性能问题', others: '其他' }
      }[key]
      const options = optionList(source)
      if (key === 'openedBuild') for (const value of editor.fields.openedBuild || []) {
        if (!options.some(option => option.value === value)) options.push({ value, label: value + ' · 已选' })
      }
      return options
    }
    function normalizeEditor(result, mode, id) {
      const data = result && result.data || result || {}
      const raw = result && result.raw || (mode === 'edit' ? data.bug || {} : {})
      const f = result && result.fields || {}
      return {
        mode, id: str(result && result.id || id || ''), data, raw, context: result?.context, origin: result?.origin,
        fields: {
          product: str(f.product ?? raw.product ?? data.productID ?? optionList(data.products)[0]?.value),
          branch: str(f.branch ?? raw.branch ?? data.branch ?? '0'),
          module: str(f.module ?? raw.module ?? data.moduleID ?? '0'),
          project: str(f.project ?? raw.project ?? data.projectID ?? '0'),
          execution: str(f.execution ?? raw.execution ?? data.executionID ?? '0'),
          title: str(f.title ?? raw.title), assignedTo: str(f.assignedTo ?? raw.assignedTo ?? data.assignedTo),
          severity: str(f.severity ?? raw.severity ?? '3'), pri: str(f.pri ?? raw.pri ?? '3'),
          type: str(f.type ?? raw.type ?? 'codeerror'), deadline: str(f.deadline ?? raw.deadline).slice(0, 10).replace(/^0000-.*/, ''),
          openedBuild: Array.isArray(f.openedBuild) ? f.openedBuild.map(str) : Array.isArray(raw.openedBuild) ? raw.openedBuild.map(str) : str(raw.openedBuild || data.buildID).split(',').filter(Boolean),
          descriptionAction: str(f.descriptionAction || (mode === 'edit' ? 'keep' : 'replace')),
          description: str(f.description), comment: str(f.comment)
        }
      }
    }
    function safeContent(html, origin) {
      if (typeof DOMParser === 'undefined') return [{ kind: 'text', text: str(html).replace(/<[^>]*>/g, ' ') }]
      const document = new DOMParser().parseFromString(str(html), 'text/html')
      document.querySelectorAll('script,style,iframe,object,embed,svg,form,template').forEach(node => node.remove())
      const blocks = []
      function visit(node) {
        if (node.nodeType === 3) { const text = node.textContent.replace(/\s+/g, ' '); if (text.trim()) blocks.push({ kind: 'text', text }); return }
        if (node.nodeType !== 1) return
        const tag = node.tagName.toLowerCase()
        if (tag === 'img') {
          let path = node.getAttribute('src') || ''
          if (/^https?:\/\//i.test(path)) { try { const url = new URL(path); if (normalizedOrigin(origin) !== url.origin || url.search || url.hash) return; path = url.pathname } catch { return } }
          if (/^\/?file-read-[1-9]\d*\.(?:png|jpe?g|gif|webp)$/i.test(path)) blocks.push({ kind: 'image', path: path.startsWith('/') ? path : '/' + path, alt: node.getAttribute('alt') || '正文图片' })
          return
        }
        if (tag === 'br') { blocks.push({ kind: 'break' }); return }
        if (tag === 'li') blocks.push({ kind: 'text', text: '• ' })
        for (const child of node.childNodes) visit(child)
        if (/^(p|div|li|h[1-6]|tr|blockquote|ul|ol|pre)$/.test(tag)) blocks.push({ kind: 'break' })
      }
      for (const node of document.body.childNodes) visit(node)
      return blocks
    }
    function BodyText({ html, service, origin }) {
      const blocks = useMemo(() => safeContent(html, origin), [html, origin])
      const lines = []
      let text = ''
      for (const block of blocks) {
        if (block.kind === 'text') text += block.text
        else if (block.kind === 'break') { if (text.trim()) lines.push({ kind: 'text', text: text.trim() }); text = '' }
        else { if (text.trim()) lines.push({ kind: 'text', text: text.trim() }); text = ''; lines.push(block) }
      }
      if (text.trim()) lines.push({ kind: 'text', text: text.trim() })
      const imageTotal = lines.filter(item => item.kind === 'image').length
      let imageIndex = 0
      return h('div', { className: 'zt-prose' }, lines.length ? lines.map((item, i) => item.kind === 'image'
        ? h(LazyImage, { key: item.path + i, path: item.path, alt: item.alt, service, index: ++imageIndex, total: imageTotal })
        : h('p', { key: i }, item.text)) : h('p', { className: 'zt-muted' }, '暂无内容'))
    }
    const blobBase64 = async blob => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
      return btoa(binary)
    }
    const aiImage = async file => {
      if (!/^image\/(?:png|jpeg|gif)$/i.test(file?.type || '') || file.size <= 0 || file.size > 8 * 1024 * 1024) return null
      let blob = file, mimeType = file.type
      if (globalThis.createImageBitmap && document?.createElement) {
        let bitmap
        try {
          bitmap = await createImageBitmap(file)
          const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('invalidImage')), 'image/jpeg', .82))
          mimeType = 'image/jpeg'
        } catch { if (file.type === 'image/gif') return null; blob = file; mimeType = file.type }
        finally { bitmap?.close?.() }
      }
      if (!['image/png', 'image/jpeg'].includes(mimeType) || blob.size > 2 * 1024 * 1024) return null
      return { name: str(file.name).slice(0, 255), role: file.role === 'expected' ? 'expected' : 'actual', mimeType, data: await blobBase64(blob) }
    }
    const prepareAiImages = async files => {
      const images = []
      let omitted = 0
      for (const file of files.slice(0, 6)) {
        const image = await aiImage(file)
        if (image) images.push(image); else omitted++
      }
      return { images, omitted: omitted + Math.max(0, files.length - 6) }
    }
    function LocalMediaPreview({ file, label = '', index = 0, total = 1, onMove, onRemove, compact = false }) {
      const [url, setUrl] = useState('')
      const image = /^image\/(?:png|jpeg|gif)$/i.test(file?.type || '')
      useEffect(() => {
        if (!image || !globalThis.URL?.createObjectURL) return
        const next = URL.createObjectURL(file)
        setUrl(next)
        return () => URL.revokeObjectURL?.(next)
      }, [file, image])
      if (compact) return h('li', { className: 'zt-media-item is-review' },
        image && url
          ? h('a', { className: 'zt-review-media-visual', href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `查看原图：${file.name}` }, h('img', { src: url, alt: label ? `${label}：${file.name}` : file.name }))
          : h('span', { className: 'zt-review-media-file', 'aria-hidden': true }, file?.type === 'video/mp4' ? 'MP4' : '文件'),
        h('span', { className: 'zt-review-media-caption' }, label && h('b', null, label), h('span', null, file.name), h('small', null, (file.size / 1024 / 1024).toFixed(1), ' MiB', image ? ' · 点击查看原图' : '')))
      return h('li', { className: 'zt-media-item', tabIndex: image ? 0 : undefined },
        image && url ? h('span', { className: 'zt-media-thumb' }, h('img', { src: url, alt: label ? `${label}：${file.name}` : file.name })) : h('span', { className: 'zt-media-file', 'aria-hidden': true }, file?.type === 'video/mp4' ? 'MP4' : '文件'),
        h('span', { className: 'zt-media-meta' }, label && h('b', null, label), h('span', null, file.name), h('small', null, (file.size / 1024 / 1024).toFixed(1), ' MiB')),
        h('span', { className: 'zt-media-actions' },
          h('button', { type: 'button', className: 'zt-button zt-button-quiet', disabled: index <= 0, onClick: () => onMove(file, -1), 'aria-label': `上移 ${file.name}` }, '上移'),
          h('button', { type: 'button', className: 'zt-button zt-button-quiet', disabled: index >= total - 1, onClick: () => onMove(file, 1), 'aria-label': `下移 ${file.name}` }, '下移'),
          h('button', { type: 'button', className: 'zt-button zt-button-quiet', onClick: () => onRemove(file), 'aria-label': `移除 ${file.name}` }, '移除')),
        image && url && h('span', { className: 'zt-media-hover', 'aria-hidden': true }, h('img', { src: url, alt: '' })))
    }
    function LazyImage({ path, alt, service, index = 1, total = 1 }) {
      const [state, setState] = useState({ loading: true, url: '', error: false })
      const [retry, setRetry] = useState(0)
      useEffect(() => {
        let live = true, url = ''
        setState({ loading: true, url: '', error: false })
        service.image(path).then(result => {
          if (!result || !result.blob) throw Error('invalidImage')
          url = URL.createObjectURL(result.blob)
          if (live) setState({ loading: false, url, error: false }); else URL.revokeObjectURL(url)
        }).catch(() => { if (live) setState({ loading: false, url: '', error: true }) })
        return () => { live = false; if (url) URL.revokeObjectURL(url) }
      }, [path, retry, service])
      const count = `图片 ${index} / ${total}`
      return h('figure', { className: 'zt-image' },
        state.url
          ? h('a', { className: 'zt-image-link', href: state.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${count}：查看原图` }, h('img', { src: state.url, alt, onError: () => setState({ loading: false, url: '', error: true }) }))
          : h('div', { className: 'zt-image-placeholder', role: 'status' }, state.error
            ? h('button', { type: 'button', onClick: () => setRetry(n => n + 1) }, `${count}加载失败 · 重试`)
            : `${count}正在加载…`),
        h('figcaption', null, h('strong', null, count), h('span', null, state.url ? '点击查看原图' : state.error ? '可重试加载' : '正在读取安全图片')))
    }
    function Icon() {
      return h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M7 9h10M7 13h7M7 17h4' }))
    }
    function RequirementsView({ service, site, origin }) {
      const [page, setPage] = useState(1)
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [query, setQuery] = useState('')
      const [revision, setRevision] = useState(0)
      useEffect(() => {
        let live = true
        setLoading(true); setError(''); setData(null)
        service.stories(page).then(result => { if (live) setData(result) })
          .catch(reason => { if (live) setError(message(reason)) })
          .finally(() => { if (live) setLoading(false) })
        return () => { live = false }
      }, [service, page, revision])
      const rows = data?.stories || []
      const needle = query.trim().toLowerCase()
      const visible = rows.filter(row => !needle || [row.id, row.title, row.status, row.assignedTo].join(' ').toLowerCase().includes(needle))
      return h('section', { className: 'zt-ledger', 'aria-label': (site.productName || '产品') + '需求列表', style: { maxWidth: 1200, margin: '0 auto', minHeight: 'min(70vh,640px)' } },
        h('div', { className: 'zt-toolbar' },
          h('div', null, h('h2', null, (site.productName || '产品 ' + site.productId) + ' · 所有需求'), h('p', { className: 'zt-muted' }, '台账内只读查看 · 产品 ' + site.productId)),
          requirementsPageUrl(origin, site.productId) && h('a', { href: requirementsPageUrl(origin, site.productId), target: '_blank', rel: 'noopener noreferrer', className: 'zt-button', style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }, 'aria-label': '在禅道原站查看或新建需求' }, '原站查看 / 新建需求 ↗')),
        h('div', { className: 'zt-filters', style: { gridTemplateColumns: 'minmax(180px, 420px)' } }, h('label', { className: 'zt-search' },
          h('span', null, '在当前页查找'), h('input', { type: 'search', value: query, onChange: event => setQuery(event.target.value), placeholder: '编号、标题、状态或负责人', 'aria-label': '在当前页筛选需求' }))),
        h('div', { className: 'zt-list-meta' }, h('span', null, data ? `共 ${data.total} 条 · 第 ${data.page} / ${data.pages} 页 · 本页 ${visible.length} 条` : '正在读取需求'), h('span', null, '搜索仅筛选当前页')),
        loading && h('div', { className: 'zt-loading', role: 'status', 'aria-live': 'polite' }, h('span', { className: 'zt-loading-spinner', 'aria-hidden': true }), '正在读取需求…'),
        error && h('div', { className: 'zt-notice zt-notice-error', role: 'alert' }, error,
          h('button', { type: 'button', onClick: () => setRevision(value => value + 1) }, '重试')),
        h('div', { className: 'zt-list-scroll', tabIndex: 0, 'aria-label': '需求列表，可独立滚动', 'aria-busy': loading ? 'true' : 'false' },
          !loading && data && (visible.length ? h('div', { className: 'zt-rows' }, visible.map(row =>
            h('a', { key: row.id, href: storyPageUrl(row, origin), target: '_blank', rel: 'noopener noreferrer', className: 'zt-row zt-story-row',
              style: { display: 'flex', alignItems: 'center', gap: 16, color: 'inherit', textDecoration: 'none' },
              'aria-label': `在禅道查看需求 #${row.id}：${row.title}` },
              h('span', { style: { minWidth: 54, color: 'var(--zt-muted)' } }, '#' + row.id),
              h('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } }, row.title),
              h('span', { className: 'zt-muted', style: { whiteSpace: 'nowrap' } }, row.status || '—'),
              h('span', { className: 'zt-muted', style: { whiteSpace: 'nowrap' } }, '↗'))))
            : h('div', { className: 'zt-empty' }, h('strong', null, query ? '当前页没有匹配需求' : '当前页暂无需求'), h('p', null, query ? '搜索只覆盖这一页；可翻页继续查找。' : '请在原站检查产品需求或权限。')))),
        h('div', { className: 'zt-pager' },
          h('button', { type: 'button', className: 'zt-button', disabled: loading || page <= 1, onClick: () => setPage(value => value - 1) }, '上一页'),
          h('span', null, data ? `${data.page} / ${data.pages}` : '—'),
          h('button', { type: 'button', className: 'zt-button', disabled: loading || !data || page >= data.pages, onClick: () => setPage(value => value + 1) }, '下一页'),
          h('button', { type: 'button', className: 'zt-button zt-button-quiet', disabled: loading, onClick: () => setRevision(value => value + 1) }, '刷新本页'))
      )
    }
    function Ledger({ ctx }) {
      const service = useMemo(() => createService(ctx), [ctx])
      const [connection, setConnection] = useState(null)
      const tokenInput = useRef(null)
      const reservedCredentialRef = useRef(null) // Keep existing hook ordering stable.
      const [connecting, setConnecting] = useState(false)
      const [connectionError, setConnectionError] = useState('')
      const [view, setView] = useState(lastView)
      const [viewReady, setViewReady] = useState(false)
      const [viewError, setViewError] = useState('')
      const savedViewRef = useRef('')
      const viewWriteRef = useRef(Promise.resolve())
      const [reporter, setReporter] = useState('')
      const [members, setMembers] = useState([])
      const [items, setItems] = useState([])
      const [page, setPage] = useState(0)
      const [pages, setPages] = useState(0)
      const [loading, setLoading] = useState(false)
      const [loadAll, setLoadAll] = useState(false)
      const [listError, setListError] = useState('')
      const [query, setQuery] = useState('')
      const [selectedId, setSelectedId] = useState('')
      const [detail, setDetail] = useState(null)
      const [detailError, setDetailError] = useState('')
      const [detailLoading, setDetailLoading] = useState(false)
      const [editor, setEditor] = useState(null)
      const [formStage, setFormStage] = useState('edit')
      const [pendingId, setPendingId] = useState('')
      const writeLockedRef = useRef(false)
      const [formBusy, setFormBusy] = useState(false)
      const [formError, setFormError] = useState('')
      const [formErrors, setFormErrors] = useState({})
      const [creatorOnly, setCreatorOnly] = useState(false)
      const [buildQuery, setBuildQuery] = useState('')
      const [creatorIds, setCreatorIds] = useState(null)
      const [creatorError, setCreatorError] = useState('')
      const [draftOpen, setDraftOpen] = useState(false)
      const [draft, setDraft] = useState('')
      const [copyNote, setCopyNote] = useState('')
      const [mediaFiles, setMediaFiles] = useState([])
      const [closeRuns, setCloseRuns] = useState({})
      const [assigneeQuery, setAssigneeQuery] = useState('')
      const [mediaCheck, setMediaCheck] = useState({ state: 'idle', text: '' })
      const [pendingOpen, setPendingOpen] = useState(true)
      const [aiStatus, setAiStatus] = useState('')
      const [aiSuggestion, setAiSuggestion] = useState(null)
      const [linkCopy, setLinkCopy] = useState('')
      const [cacheNote, setCacheNote] = useState('')
      const [aiApplied, setAiApplied] = useState(false)
      const [editorSession, setEditorSession] = useState(0)
      const [draftDirty, setDraftDirty] = useState(false)
      const [draftStatus, setDraftStatus] = useState('')
      const [draftBox, setDraftBox] = useState([])
      const [draftBoxOpen, setDraftBoxOpen] = useState(false)
      const snapshotRef = useRef(null)
      const itemsRef = useRef([])
      const pagesRef = useRef(0)
      const buildListRef = useRef(null)
      const aiBusyRef = useRef(false)
      const sequence = useRef(0)
      const detailSequence = useRef(0)
      const verifiedDetailRef = useRef('')
      const loadRef = useRef(0)
      const busyRef = useRef(false)
      const editorRef = useRef(0)
      const inspectorRef = useRef(null)
      const authGeneration = useRef(0)
      const closeBusyRef = useRef(false)
      const placeRestoreRef = useRef(null)
      const placeRef = useRef({ view: 'active', page: 0, bugId: '', query: '' })
      const connectionScopeRef = useRef('')
      function receiveConnection(state) {
        const nextScope = storageScopeFor(state)
        const previousScope = connectionScopeRef.current || storageScopeFor(connection)
        if (previousScope && previousScope !== nextScope) {
          sequence.current++; detailSequence.current++; editorRef.current++; loadRef.current = -1
          snapshotRef.current = null; placeRestoreRef.current = null; verifiedDetailRef.current = ''
          setItems([]); setMembers([]); setPage(0); setPages(0); setReporter(''); setQuery('')
          setSelectedId(''); setDetail(null); setEditor(null); setMediaFiles([]); setDraftBox([])
          setDraftDirty(false); setDraftStatus(''); setAiSuggestion(null); setAiStatus(''); setAiApplied(false); setCloseRuns({})
          setDraftOpen(false); setDraft(''); setCopyNote(''); setLinkCopy(''); setFormBusy(false); setFormError(''); setFormErrors({}); setDetailError(''); setListError(''); setCacheNote('')
        }
        connectionScopeRef.current = nextScope
        setConnection(state)
      }
      function restoreEntry() {
        let live = true
        const generation = ++authGeneration.current
        service.status().then(state => {
          if (live && generation === authGeneration.current) {
            receiveConnection(state)
            const restored = validView(state.preferredView) ? state.preferredView : 'active'
            const place = state.preferredPlace && validView(state.preferredPlace.view) ? state.preferredPlace : null
            if (place) { placeRestoreRef.current = place; setQuery(place.query || '') }
            const snapshot = readSnapshot(storageScopeFor(state))
            if (snapshot && snapshot.view === (place ? place.view : restored) && snapshot.reporter === String(state.userId)) {
              snapshotRef.current = snapshot
              setItems(snapshot.items); setPage(snapshot.page || 1); setPages(snapshot.pages || 1)
              setCacheNote('cached')
            }
            savedViewRef.current = restored
            lastView = restored
            setView(place ? place.view : restored)
            setViewReady(true)
            setConnectionError(state.error ? message({ code: state.error }) : '')
          }
        }).catch(error => {
          if (live && generation === authGeneration.current) { setViewReady(true); setConnectionError(message(error)) }
        })
        return () => { live = false }
      }
      useEffect(restoreEntry, [service])
      const connected = !!(connection && (connection.connected || connection.account) && verifiedOrigin(connection))
      function persistView() {
        if (!viewReady) return
        lastView = view
        if (!connected || view === savedViewRef.current) return
        const next = view
        savedViewRef.current = next
        setViewError('')
        const pending = viewWriteRef.current.then(() => service.saveView(next))
        viewWriteRef.current = pending.catch(() => {})
        pending.catch(error => {
          if (savedViewRef.current === next) {
            savedViewRef.current = ''
            setViewError('上次视图未保存，下次打开可能回到默认页。' + message(error))
          }
        })
      }
      useEffect(persistView, [view, viewReady, connected, service])
      useEffect(() => {
        const panel = inspectorRef.current
        if (!(selectedId || editor || formBusy) || !panel || panel.closest('.zt-workspace')?.clientWidth > 940) return
        panel.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
        panel.focus?.({ preventScroll: true })
      }, [selectedId, editor, formBusy])
      const site = connection?.site || {}
      const origin = verifiedOrigin(connection)
      const storageScope = storageScopeFor(connection)
      const cookieAuth = site.authMode === 'cookie'
      const account = str(connection && connection.account)
      const selfId = str(connection && connection.userId)
      const selfName = str(connection?.realname || members.find(member => member.value === selfId)?.label || personLabel(account, detail?.data?.users || {}))
      const selectedReporter = reporter || selfId
      placeRef.current = { view, page, bugId: selectedId, query }
      itemsRef.current = items
      pagesRef.current = pages
      useEffect(() => { setDraftOpen(false); setDraft(''); setCopyNote(''); setLinkCopy('') }, [selectedId, account, storageScope])
      function prepareAcceptanceDraft() {
        if (!bug) return
        setDraft(`Bug #${str(bug.id)} ${str(bug.title)}\n测试范围：\n实测结果：\n结论：\n未测项：`)
        setDraftOpen(true); setCopyNote('')
      }
      async function copyDraft() {
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw Error('clipboardUnavailable')
          await navigator.clipboard.writeText(draft)
          setCopyNote('已复制草稿。请核对内容后自行发送。')
        } catch { setCopyNote('无法一键复制，请选中草稿手动复制。') }
      }
      async function copyBugLink() {
        const url = bug && bugPageUrl(bug.id, origin)
        if (!url) return
        try {
          if (!navigator.clipboard?.writeText) throw Error('clipboardUnavailable')
          await navigator.clipboard.writeText(url)
          setLinkCopy('链接已复制')
        } catch { setLinkCopy('复制失败，请选中下方链接手动复制') }
      }
      const closeRun = closeRuns[selectedId] || { stage: 'idle', confirmed: false, comment: '', error: '', media: [] }
      function updateClose(id, patch) {
        setCloseRuns(previous => ({ ...previous, [id]: { ...(previous[id] || { stage: 'idle', confirmed: false, comment: '', error: '', media: [] }), ...patch } }))
      }
      function prepareClose() {
        if (!bug || bug.status !== 'resolved' || writeLockedRef.current || closeBusyRef.current) return
        updateClose(str(bug.id), { stage: 'review', confirmed: false, error: '', media: [] })
      }
      function addCloseImages(incoming) {
        if (!bug || closeRun.stage !== 'review' || closeBusyRef.current || !incoming.length) return
        const selected = [...(closeRun.media || []), ...incoming]
        if (selected.length > 6 || selected.reduce((sum, file) => sum + Number(file.size || 0), 0) > 40 * 1024 * 1024) { updateClose(str(bug.id), { error: message({ code: 'mediaLimit' }) }); return }
        if (selected.some(file => !/\.(?:png|jpe?g|gif)$/i.test(file.name || '') || !/^image\/(?:png|jpeg|gif)$/i.test(file.type || '') || file.size <= 0 || file.size > 8 * 1024 * 1024)) { updateClose(str(bug.id), { error: message({ code: 'invalidMedia' }) }); return }
        updateClose(str(bug.id), { media: selected, error: '' })
      }
      function chooseCloseImages(event) {
        const incoming = Array.from(event.target.files || [])
        event.target.value = ''
        addCloseImages(incoming)
      }
      function pasteCloseImages(event) {
        const items = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        if (!items.length) return
        const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }
        const incoming = []
        for (const item of items) {
          const file = item.getAsFile?.(), ext = extensions[item.type]
          if (!file || !ext) { event.preventDefault(); updateClose(str(bug.id), { error: message({ code: 'invalidMedia' }) }); return }
          incoming.push(new File([file], `验收截图-${Date.now()}-${incoming.length + 1}.${ext}`, { type: item.type }))
        }
        event.preventDefault()
        addCloseImages(incoming)
      }
      function finishClose(id, receipt) {
        const token = detailSequence.current
        updateClose(id, { stage: 'closed', confirmed: false, error: '', media: [], receipt })
        setDetail(previous => previous && str(previous.bug?.id) === id
          ? { ...previous, bug: { ...previous.bug, status: 'closed', closedBy: account } } : previous)
        setItems(previous => view === 'resolved' ? previous.filter(row => str(row.id) !== id)
          : previous.map(row => str(row.id) === id ? { ...row, status: 'closed' } : row))
        service.detail(id).then(value => {
          if (token === detailSequence.current && value?.bug?.status === 'closed' && str(value.bug.id) === id) setDetail(previous => previous && str(previous.bug?.id) === id ? value : previous)
        }).catch(() => {})
      }
      async function confirmClose() {
        if (!bug || bug.status !== 'resolved' || !closeRun.confirmed || closeRun.stage !== 'review' ||
            !digits(bug.id) || !origin || !account || !digits(selfId) || writeLockedRef.current || closeBusyRef.current) return
        const id = str(bug.id)
        const token = editorRef.current
        const comment = closeRun.comment.trim()
        closeBusyRef.current = true
        updateClose(id, { stage: 'sending', error: '' })
        try {
          const receipt = await service.closeBug(id, { action: 'closeBug', id, title: bug.title,
            status: 'resolved', origin, account, userId: selfId }, comment, closeRun.media || [])
          if (token !== editorRef.current) return
          if (str(receipt?.id) !== id || receipt.status !== 'closed' || !digits(receipt.actionId)) throw Object.assign(Error('writeUnknown'), { code: 'writeUnknown' })
          finishClose(id, receipt)
        } catch (error) {
          const definite = ['closeFormUnavailable', 'invalidBugStatus', 'confirmationMismatch', 'invalidCloseComment', 'identityMismatch', 'invalidMedia', 'mediaLimit', 'mediaUploadFailed', 'mediaAuthUnavailable'].includes(error?.code)
          if (token !== editorRef.current) return
          const detail = error?.fields?.form ? '（' + String(error.fields.form).slice(0, 200) + '）' : ''
          updateClose(id, { stage: definite ? 'review' : 'uncertain', confirmed: false, error: message(error) + detail })
        } finally { closeBusyRef.current = false }
      }
      async function reconcileClose() {
        if (!digits(selectedId) || closeRun.stage !== 'uncertain' || closeBusyRef.current) return
        const id = selectedId
        const token = editorRef.current
        closeBusyRef.current = true
        updateClose(id, { error: '' })
        try {
          const receipt = await service.reconcileClose(id)
          if (token !== editorRef.current) return
          if (str(receipt?.id) !== id || receipt.status !== 'closed') throw Object.assign(Error('readbackMismatch'), { code: 'readbackMismatch' })
          finishClose(id, receipt)
        } catch (error) { if (token === editorRef.current) updateClose(id, { stage: 'uncertain', error: message(error) }) }
        finally { closeBusyRef.current = false }
      }
      async function connectionAction(action) {
        const generation = ++authGeneration.current
        setConnecting(true); setConnectionError('')
        try {
          const token = action === 'connect' && tokenInput.current ? tokenInput.current.value.trim() : ''
          if (action === 'connect' && !site.configured) throw Object.assign(Error('siteUnconfigured'), { code: 'siteUnconfigured' })
          if (action === 'connect' && !token && !connection?.configured) throw Object.assign(Error(cookieAuth ? 'cookieUnavailable' : 'credentialsUnavailable'), { code: cookieAuth ? 'cookieUnavailable' : 'credentialsUnavailable' })
          if (tokenInput.current) tokenInput.current.value = ''
          const state = await service[action](token, site.authMode)
          if (generation !== authGeneration.current) return
          receiveConnection(action === 'disconnect' ? { connected: false, site } : state)
          setConnectionError(state?.error ? message({ code: state.error }) : '')
          if (action === 'disconnect') { clearSnapshot(storageScope); clearCreateDraft(storageScope); clearDraftBox(storageScope); void clearUserDraftMedia(storageScope); setDraftBox([]) }
          const restored = action === 'disconnect' ? 'active' : validView(state?.preferredView) ? state.preferredView : 'active'
          savedViewRef.current = restored; lastView = restored; setView(restored); setViewReady(true)
          if (action === 'disconnect') { sequence.current++; detailSequence.current++; loadRef.current++; setItems([]); setSelectedId(''); setDetail(null); setEditor(null); setReporter('') }
        } catch (error) {
          if (generation === authGeneration.current) {
            setConnectionError(message(error))
            if (error?.code === 'credentialsUnavailable') tokenInput.current?.focus()
          }
        } finally { if (generation === authGeneration.current) setConnecting(false) }
      }
      async function fetchPage(next, token, scope, user, apply = true) {
        const request = () => service.list({ page: next, status: scope === 'board' ? 'active' : scope, userId: user })
        let result
        try { result = await request() }
        catch (error) {
          if (!['authExpired', 'authFailed', 'identityMismatch', 'accountChanged'].includes(error?.code)) throw error
          const state = await service.status()
          if (token !== sequence.current) return null
          receiveConnection(state)
          setConnectionError(state.error ? message({ code: state.error }) : '')
          if (!state.connected) throw error
          try { result = await request() }
          catch (retryError) {
            if (['authExpired', 'authFailed', 'identityMismatch', 'accountChanged'].includes(retryError?.code) && token === sequence.current) {
              receiveConnection({ configured: true, connected: false, site, error: retryError.code })
              setConnectionError(message(retryError))
            }
            throw retryError
          }
        }
        if (token !== sequence.current) return null
        const actualPage = Number(result.page ?? next), totalPages = Number(result.pages)
        if (!Number.isSafeInteger(actualPage) || actualPage < next || !Number.isSafeInteger(totalPages) || totalPages < actualPage) throw Error('invalidPagination')
        if (!apply) return { bugs: result.bugs || [], members: result.members, page: actualPage, pages: totalPages, next: actualPage < totalPages ? actualPage + 1 : 0 }
        setItems(previous => next === 1 ? result.bugs || [] : previous.concat(result.bugs || []))
        if (result.members) setMembers(optionList(result.members))
        setPage(actualPage); setPages(totalPages)
        return actualPage < totalPages ? actualPage + 1 : 0
      }
      async function startLoad(next = 1, all = false) {
        if (!connected || busyRef.current) return
        const token = sequence.current
        busyRef.current = true; setLoading(true); setListError(''); setLoadAll(all)
        try {
          let cursor = next
          do { cursor = await fetchPage(cursor, token, view, selectedReporter) } while (all && cursor && token === sequence.current && loadRef.current === token)
        } catch (error) { if (token === sequence.current) setListError(message(error)) }
        finally { busyRef.current = false; if (token === sequence.current) { setLoading(false); setLoadAll(false) } }
      }
      function stopLoad() { loadRef.current = -1; setLoadAll(false) }
      function loadReports() {
        sequence.current++; loadRef.current = sequence.current
        busyRef.current = false
        const restore = placeRestoreRef.current
        placeRestoreRef.current = null
        const target = restore && restore.view === view ? Math.min(restore.page || 1, 50) : 1
        const targetBug = restore && restore.view === view ? str(restore.bugId) : ''
        const snapshot = snapshotRef.current
        snapshotRef.current = null
        const useSnapshot = !!(snapshot && snapshot.view === view && snapshot.reporter === selectedReporter)
        if (!useSnapshot) { setItems([]); setPage(0); setPages(0) }
        setListError(''); setSelectedId(''); setDetail(null); setEditor(null)
        if (!restore) setQuery('')
        if (useSnapshot) { setItems(snapshot.items); setPage(snapshot.page || 1); setPages(snapshot.pages || 1) }
        if (connected && viewReady && selectedReporter && view !== 'requirements') {
          const token = sequence.current
          busyRef.current = true; setLoading(true)
          ;(async () => {
            let cursor = 1
            const collected = []
            let lastPage = 1, lastPages = 1
            try {
              while (cursor) {
                // Buffer the refresh so the cached list stays intact until the
                // same page range is back from ZenTao.
                const chunk = await fetchPage(cursor, token, view, selectedReporter, false)
                if (!chunk) break
                collected.push(...chunk.bugs)
                lastPage = chunk.page; lastPages = chunk.pages
                if (chunk.members) setMembers(optionList(chunk.members))
                cursor = chunk.next
                if (!cursor || cursor > target) break
              }
              if (token === sequence.current) {
                setItems(collected); setPage(lastPage); setPages(lastPages)
                setCacheNote('')
                writeSnapshot(storageScope, { view, reporter: selectedReporter, page: lastPage, pages: lastPages, items: collected })
                if (digits(targetBug)) setSelectedId(targetBug)
              }
            } catch (error) { if (token === sequence.current) setListError(message(error)) }
            finally { if (token === sequence.current) { busyRef.current = false; setLoading(false) } }
          })()
        }
        return () => { sequence.current++; loadRef.current = -1 }
      }
      useEffect(loadReports, [connected, viewReady, selectedReporter, view, service, storageScope])
      function persistPlace() {
        if (!connected) return
        const save = () => {
          const place = placeRef.current
          if (!place || !place.page) return
          writeSnapshot(storageScope, { view: place.view, reporter: selectedReporter, page: place.page, pages: pagesRef.current, items: itemsRef.current })
          service.savePlace({ view: place.view, page: place.page, bugId: digits(place.bugId) ? place.bugId : '', query: place.query || '' }).catch(() => {})
        }
        const onVisibility = () => { if (document.visibilityState === 'hidden') save() }
        document.addEventListener('visibilitychange', onVisibility)
        window.addEventListener('pagehide', save)
        return () => {
          document.removeEventListener('visibilitychange', onVisibility)
          window.removeEventListener('pagehide', save)
          save()
        }
      }
      useEffect(persistPlace, [connected, service, storageScope, selectedReporter])
      function loadDetail() {
        if (!selectedId || !connected) return
        if (verifiedDetailRef.current === selectedId) { verifiedDetailRef.current = ''; return }
        const token = ++detailSequence.current
        setDetail(null); setDetailError(''); setDetailLoading(true)
        service.detail(selectedId).then(value => { if (token === detailSequence.current) setDetail(value) }).catch(error => { if (token === detailSequence.current) setDetailError(message(error)) }).finally(() => { if (token === detailSequence.current) setDetailLoading(false) })
      }
      useEffect(loadDetail, [selectedId, connected, service, storageScope])
      function resetBuildScroll() {
        if (!editorSession || !buildListRef.current) return
        buildListRef.current.scrollTop = 0
      }
      useEffect(resetBuildScroll, [editorSession])
      function persistCreateDraft() {
        if (!connected || !draftDirty || editor?.mode !== 'create' || editor.storageScope !== storageScope) return
        const token = editorRef.current
        writeCreateDraft(storageScope, editor, mediaFiles.length)
        writeDraftMedia(storageScope, 'current', mediaFiles).then(saved => token === editorRef.current && setDraftStatus(mediaFiles.length
          ? saved ? `草稿和 ${mediaFiles.length} 个截图或视频已保存到本机。` : `文字草稿已保存；${mediaFiles.length} 个媒体文件未能持久化，请勿关闭页面。`
          : '草稿已自动保存到本机。')).catch(() => token === editorRef.current && setDraftStatus(mediaFiles.length
            ? `文字草稿已保存；${mediaFiles.length} 个媒体文件未能持久化，请勿关闭页面。` : '草稿已自动保存到本机。'))
      }
      useEffect(persistCreateDraft, [connected, draftDirty, editor, mediaFiles, storageScope])
      function syncDraftBox() {
        setDraftBox(connected ? readDraftBox(storageScope) : [])
      }
      useEffect(syncDraftBox, [connected, storageScope])
      const visible = useMemo(() => items.filter(bug => {
        const needle = query.trim().toLowerCase()
        return !needle || [bug.id, bug.title, bug.product, bug.assignedTo].join(' ').toLowerCase().includes(needle)
      }), [items, query])
      const groups = useMemo(() => {
        const map = new Map()
        for (const bug of visible.filter(row => row.status === 'active')) {
          const key = str(bug.assignedAccount || bug.assignedTo || '')
          if (!map.has(key)) map.set(key, { key, name: str(bug.assignedTo || '未指派'), bugs: [] })
          map.get(key).bugs.push(bug)
        }
        for (const group of map.values()) {
          group.oldest = group.bugs.reduce((oldest, item) => Math.max(oldest, hangingDays(item.openedDate)), 0)
          group.bugs.sort((a, b) => urgency(a) - urgency(b) || hangingDays(b.openedDate) - hangingDays(a.openedDate) || Number(b.id) - Number(a.id))
        }
        return [...map.values()].sort((a, b) => Number(Boolean(a.key)) - Number(Boolean(b.key)) || b.oldest - a.oldest || b.bugs.length - a.bugs.length || a.name.localeCompare(b.name))
      }, [visible])
      function openForm(mode) {
        if (!connected || !storageScope) return
        if (mode === 'edit') setDraftBoxOpen(false)
        if (writeLockedRef.current) { setFormError('上次提交尚未核对，不能再次提交。'); return }
        const id = mode === 'edit' ? selectedId : ''
        if (mode === 'edit' && !id) return
        const token = ++editorRef.current
        setEditor(null); setMediaFiles([]); setAiStatus(''); setAiSuggestion(null); setAiApplied(false); setDraftDirty(false); setDraftStatus(''); setPendingOpen(true); setMediaCheck({ state: 'idle', text: '' }); setAssigneeQuery(''); setFormStage('edit'); setFormError(''); setFormErrors({}); setCreatorOnly(false); setBuildQuery(''); setCreatorIds(null); setCreatorError(''); setFormBusy(true)
        service.metadata(mode, mode === 'create' ? createContext(site) : {}, id).then(async value => {
          if (token !== editorRef.current) return
          let next = { ...normalizeEditor(value, mode, id), storageScope }
          if (next.origin !== origin || mode === 'create' && !fixedCreateValid(next, site)) throw Object.assign(Error('fixedContextUnavailable'), { code: 'fixedContextUnavailable' })
          if (mode === 'create') {
            const saved = readCreateDraft(storageScope)
            if (saved) {
              next = restoreCreateDraft(next, saved)
              let restoredMedia = []
              try { restoredMedia = await readDraftMedia(storageScope, 'current') } catch { /* Keep the text draft recoverable. */ }
              if (token !== editorRef.current) return
              setMediaFiles(restoredMedia)
              setDraftDirty(true)
              setDraftStatus(restoredMedia.length
                ? `已恢复本机草稿和 ${restoredMedia.length} 个截图或视频。`
                : saved.mediaCount ? `已恢复文字草稿；原来的 ${saved.mediaCount} 个媒体文件无法恢复，请重新添加。`
                  : '已恢复上次未提交的本机草稿。')
            }
          }
          setEditor(next)
          setEditorSession(value => value + 1)
        }).catch(error => { if (token === editorRef.current) setFormError(message(error)) }).finally(() => { if (token === editorRef.current) setFormBusy(false) })
      }
      function openDraftBox() {
        setDraftBox(readDraftBox(storageScope))
        setDraftBoxOpen(true)
        if (!editor || editor.mode !== 'create') openForm('create')
      }
      async function stashCurrentAndNew() {
        if (editor?.mode !== 'create' || editor.storageScope !== storageScope || formBusy || writeLockedRef.current) return
        setFormBusy(true)
        const next = stashCreateDraft(storageScope, editor, mediaFiles.length)
        const saved = next[0]
        try {
          const mediaSaved = saved && await writeDraftMedia(storageScope, saved.id, mediaFiles)
          if (mediaFiles.length && !mediaSaved) throw Error('draftMediaUnavailable')
          setDraftBox(next)
          clearCreateDraft(storageScope); await removeDraftMedia(storageScope, 'current')
          setDraftDirty(false); setDraftBoxOpen(false)
          openForm('create')
        } catch {
          if (saved) setDraftBox(removeBoxDraft(storageScope, saved.id))
          setDraftStatus('草稿图片未能保存，当前内容仍在页面中；请重试或先保留此页面。')
          setFormError('草稿箱未能保存截图，没有清空当前内容。')
          setFormBusy(false)
        }
      }
      async function resumeBoxDraft(draftId) {
        if (editor?.mode !== 'create' || formBusy) return
        const saved = draftBox.find(draft => draft.id === draftId)
        if (!saved) return
        setFormBusy(true)
        let restoredMedia = []
        try { restoredMedia = await readDraftMedia(storageScope, draftId) } catch { /* Old text-only drafts remain recoverable. */ }
        setEditor(current => restoreCreateDraft(current, saved))
        setMediaFiles(restoredMedia)
        setAiSuggestion(null); setAiApplied(false); setFormStage('edit'); setFormErrors({}); setFormError('')
        setDraftDirty(true)
        setDraftStatus(restoredMedia.length
          ? `已从草稿箱恢复 ${restoredMedia.length} 个截图或视频，角色和顺序保持不变。`
          : saved.mediaCount ? `已恢复文字草稿；原来的 ${saved.mediaCount} 个媒体文件无法恢复，请重新添加。`
            : '已从草稿箱恢复，可以继续编辑。')
        const next = removeBoxDraft(storageScope, draftId)
        setDraftBox(next); setDraftBoxOpen(false); setFormBusy(false)
        await removeDraftMedia(storageScope, draftId)
      }
      function deleteBoxDraft(draftId) {
        if (formBusy) return
        setDraftBox(removeBoxDraft(storageScope, draftId))
        void removeDraftMedia(storageScope, draftId)
      }
      function changeField(key, value) {
        if (formStage === 'uncertain' || formStage === 'savedPending' || formStage === 'conflict') return
        setEditor(current => current && ({ ...current, fields: { ...current.fields, [key]: value } }))
        if (editor?.mode === 'create') setDraftDirty(true)
        setFormStage('edit'); setFormErrors({}); setFormError('')
      }
      function addMedia(incoming, role = 'actual') {
        if (!incoming.length || !editor || formBusy || formStage !== 'edit' || writeLockedRef.current) return
        for (const file of incoming) { try { file.role = role } catch { /* File stays usable without a role tag. */ } }
        const selected = [...mediaFiles, ...incoming]
        const classify = file => /\.(?:png|jpe?g|gif)$/i.test(file.name) ? 'image' : /\.mp4$/i.test(file.name) ? 'video' : ''
        if (selected.length > 6 || selected.reduce((sum, file) => sum + file.size, 0) > 40 * 1024 * 1024) { setFormError(message({ code: 'mediaLimit' })); return }
        if (selected.some(file => !classify(file) || file.size <= 0 || file.size > (classify(file) === 'video' ? 25 : 8) * 1024 * 1024)) { setFormError(message({ code: 'invalidMedia' })); return }
        setMediaFiles(selected)
        if (editor.mode === 'create') setDraftDirty(true)
        setFormError('')
      }
      function moveMedia(file, delta) {
        setMediaFiles(current => {
          const role = file.role === 'expected' ? 'expected' : 'actual'
          const group = current.filter(item => (item.role === 'expected' ? 'expected' : 'actual') === role)
          const position = group.indexOf(file), target = position + delta
          if (position < 0 || target < 0 || target >= group.length) return current
          const next = [...current], from = next.indexOf(file), to = next.indexOf(group[target])
          ;[next[from], next[to]] = [next[to], next[from]]
          return next
        })
        if (editor?.mode === 'create') setDraftDirty(true)
      }
      function removeMedia(file) {
        setMediaFiles(current => current.filter(item => item !== file))
        if (editor?.mode === 'create') setDraftDirty(true)
      }
      async function checkMediaUpload() {
        if (!editor || editor.storageScope !== storageScope || formBusy || writeLockedRef.current || mediaCheck.state === 'checking') return
        const token = editorRef.current
        setMediaCheck({ state: 'checking', text: '正在只读核对图片上传授权…' })
        try {
          const result = await service.mediaUploadStatus()
          if (token !== editorRef.current) return
          if (result?.ready !== true || result?.account !== account) throw Object.assign(Error('mediaAuthUnavailable'), { code: 'mediaAuthUnavailable' })
          setMediaCheck({ state: 'ready', text: '上传授权已核对；尚未上传图片或提交 Bug。' })
        } catch (error) { if (token === editorRef.current) setMediaCheck({ state: 'error', text: message(error) }) }
      }
      function chooseMedia(role) {
        return event => {
          const incoming = Array.from(event.target.files || [])
          event.target.value = ''
          addMedia(incoming, role)
        }
      }
      function pasteMedia(role) {
        return event => {
        const items = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        if (!items.length) return
        const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }
        const incoming = []
        for (const item of items) {
          const file = item.getAsFile?.()
          const ext = extensions[item.type]
          if (!file || !ext) { event.preventDefault(); setFormError(message({ code: 'invalidMedia' })); return }
          incoming.push(new File([file], `粘贴图片-${Date.now()}-${incoming.length + 1}.${ext}`, { type: item.type }))
        }
        // Keep plain text paste when both text and an image are present; only
        // consume an image-only paste so the browser doesn't insert a stray blob.
        if (!Array.from(event.clipboardData?.items || []).some(item => item.kind === 'string' && item.type === 'text/plain')) event.preventDefault()
        addMedia(incoming, role)
      }
      }
      async function toggleCreator(checked) {
        setCreatorOnly(checked); setCreatorError('')
        if (!checked || !editor || creatorIds) return
        const token = editorRef.current
        try {
          const result = await service.creatorBuildIds(editor.fields.product)
          if (token === editorRef.current) setCreatorIds((result && result.ids || result || []).map(str))
        } catch (error) { if (token === editorRef.current) { setCreatorError(message(error)); setCreatorOnly(false) } }
      }
      function validateEditor() {
        if (!editor || editor.storageScope !== storageScope || editor.origin !== origin) return { form: '表单归属已变化，请重新打开表单。' }
        const fields = editor.fields, errors = {}
        if (!fields.title.trim()) errors.title = '请输入标题'
        if (fields.title.trim().length > 255) errors.title = '标题不能超过 255 字'
        if (!digits(fields.product)) errors.product = '请选择产品'
        if (editor.mode === 'create' && !fixedCreateValid(editor, site)) errors.form = '配置的产品与项目归属信息已变化，请重新打开表单。'
        if (!fields.openedBuild.length) errors.openedBuild = '请至少选择一个影响版本'
        if (fields.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(fields.deadline) || validDate(fields.deadline) === null)) errors.deadline = '请选择有效日期'
        if (editor.mode === 'create' && !fields.description.trim()) errors.description = '请输入问题描述'
        return errors
      }
      function review() {
        if (!editor || formStage !== 'edit' || writeLockedRef.current) return
        const errors = validateEditor()
        setFormErrors(errors)
        if (!Object.keys(errors).length) setFormStage('review')
      }
      function finishSaved(id, value) {
        writeLockedRef.current = false
        if (editor?.mode === 'create') { clearCreateDraft(storageScope); void removeDraftMedia(storageScope, 'current') }
        setPendingId(''); setEditor(null); setMediaFiles([]); setAiApplied(false); setDraftDirty(false); setDraftStatus(''); setFormStage('edit'); setFormError('')
        verifiedDetailRef.current = id
        setSelectedId(id)
        setDetail(value.bug ? value : { bug: value, actions: [], histories: [] })
        setItems(previous => previous.map(row => str(row.id) === id ? { ...row, ...(value.bug || value) } : row))
      }
      async function requestAiOptimization() {
        if (site.aiEnabled !== true || !editor || editor.storageScope !== storageScope || editor.mode !== 'create' || aiBusyRef.current || formBusy || writeLockedRef.current) return
        const token = editorRef.current
        aiBusyRef.current = true
        setAiStatus(mediaFiles.some(file => /^image\//.test(file.type)) ? '正在读取截图并生成详细建议…' : '正在生成优化建议…')
        setAiSuggestion(null)
        setAiApplied(false)
        try {
          const prepared = await prepareAiImages(mediaFiles)
          if (token !== editorRef.current) return
          const suggestion = await service.optimizeDraft({ title: editor.fields.title, description: editor.fields.description, openedBuild: editor.fields.openedBuild, images: prepared.images })
          if (token !== editorRef.current) return
          if (!suggestion?.title || !suggestion?.description) throw Object.assign(Error('aiUnavailable'), { code: 'aiUnavailable' })
          setAiSuggestion(suggestion)
          const vision = prepared.images.length ? `已分析 ${prepared.images.length} 张截图` : '本次没有可读取的截图'
          const omitted = prepared.omitted ? `；另有 ${prepared.omitted} 个媒体文件未纳入分析` : ''
          setAiStatus(`${vision}${omitted}。请核对建议后再应用；此时还没有提交 Bug。`)
        } catch (error) {
          if (token !== editorRef.current) return
          const detail = error?.fields?.form ? '（' + String(error.fields.form).slice(0, 160) + '）' : ''
          setAiStatus((message(error) || 'AI 生成未完成。草稿仍保留，可稍后重试或手动编辑。') + detail)
        }
        finally { aiBusyRef.current = false }
      }
      async function copyAiPrompt() {
        if (!editor) return
        const text = `请把下面的禅道 Bug 草稿整理成清晰的缺陷描述：只依据我给的文字，不要编造；信息不足写“待补充”。输出“建议标题”和“建议描述”，描述按需包含 概述、前提、操作步骤、实际结果、预期结果、未测项。\n\n原标题：${editor.fields.title}\n原描述：\n${editor.fields.description}\n\n影响版本：${editor.fields.openedBuild.join('、') || '未提供'}`
        try {
          if (!navigator.clipboard?.writeText) throw Error('clipboardUnavailable')
          await navigator.clipboard.writeText(text)
          setAiStatus('优化提示词已复制。粘贴到对话里让 AI 整理，再把结果填回表单并重新预览。')
        } catch { setAiStatus('无法访问剪贴板，请手动复制正文后请 AI 整理。') }
      }
      function applyAiSuggestion() {
        if (!aiSuggestion) return
        setEditor(current => current && ({ ...current, fields: { ...current.fields, title: aiSuggestion.title, description: aiSuggestion.description } }))
        setAiApplied(true)
        setDraftDirty(true)
        setFormStage('edit'); setFormErrors({}); setFormError(''); setAiStatus('已填入建议。请检查内容；确认无误后可直接提交并回读。')
      }
      function clearCachedDraft() {
        if (editor?.mode !== 'create' || formBusy) return
        clearCreateDraft(storageScope); void removeDraftMedia(storageScope, 'current')
        setDraftDirty(false)
        setDraftStatus('本机草稿已清除；继续编辑后会重新自动保存。')
      }
      async function retryReadback() {
        if (!digits(pendingId) || formBusy) return
        const token = editorRef.current
        setFormBusy(true); setFormError('')
        try {
          const result = await service.readback(pendingId, editor)
          if (token !== editorRef.current) return
          if (str(result && (result.bug && result.bug.id || result.id)) !== pendingId) throw Object.assign(Error('readbackMismatch'), { code: 'readbackMismatch' })
          finishSaved(pendingId, result)
        } catch (error) { if (token === editorRef.current) setFormError(message(error)) }
        finally { if (token === editorRef.current) setFormBusy(false) }
      }
      async function confirm(direct = false) {
        const directAiSubmit = direct === true && aiApplied && formStage === 'edit'
        if (!editor || formStage !== 'review' && !directAiSubmit || formBusy || writeLockedRef.current) return
        const errors = validateEditor()
        setFormErrors(errors)
        if (Object.keys(errors).length) { setFormStage('edit'); return }
        const token = editorRef.current
        writeLockedRef.current = true
        setFormBusy(true); setFormError('')
        try {
          const result = await service.write(editor, { account, title: editor.fields.title.trim(), ...(editor.mode === 'edit' ? { id: editor.id } : {}) }, mediaFiles)
          if (token !== editorRef.current) return
          const id = str(result && (result.id || result.bug && result.bug.id))
          if (!digits(id)) throw Object.assign(Error('writeUnknown'), { code: 'writeUnknown' })
          if (result.bug && str(result.bug.id) === id && !result.readbackPending) finishSaved(id, result)
          else { if (result.mediaExpected) setEditor(current => current && ({ ...current, mediaExpected: result.mediaExpected })); setPendingId(id); setPendingOpen(true); setFormStage('savedPending'); setFormError('提交已返回编号，但回读尚未确认。仅可按编号重试读取，不能重复提交。') }
        } catch (error) {
          if (token !== editorRef.current) return
          setFormError(message(error))
          if (error && error.fields) setFormErrors(mapFormErrors(error.fields, editor))
          if (error && error.code === 'conflict') { writeLockedRef.current = false; setFormStage('conflict') }
          else if (error && ['serverRejected', 'validationFailed', 'writeAuthExpired', 'invalidMedia', 'mediaLimit', 'mediaUploadFailed', 'mediaAuthUnavailable'].includes(error.code)) { writeLockedRef.current = false; setFormStage('edit') }
          else setFormStage('uncertain')
        } finally { if (token === editorRef.current) setFormBusy(false) }
      }
      const buildOptions = editor ? choices(editor, 'openedBuild') : []
      const creatorBuildOptions = creatorOnly && creatorIds ? buildOptions.filter(option => creatorIds.includes(option.value)) : buildOptions
      const shownBuildOptions = creatorBuildOptions.filter(option => !buildQuery.trim() || (option.label + ' ' + option.value).toLowerCase().includes(buildQuery.trim().toLowerCase())).sort(newestBuildFirst)
      const hiddenSelections = editor && creatorOnly && creatorIds ? editor.fields.openedBuild.filter(id => !creatorIds.includes(id)).length : 0
      const bug = detail && (detail.bug || detail)
      const detailUsers = detail && detail.data && detail.data.users || {}
      const displayUsers = { ...detailUsers }
      if (account && selfName) displayUsers[account] = selfName
      for (const row of items) {
        if (row?.assignedAccount && row?.assignedTo && row.assignedAccount !== row.assignedTo) displayUsers[row.assignedAccount] = row.assignedTo
      }
      const attachedFiles = bug && bug.files && typeof bug.files === 'object' ? Object.values(bug.files).filter(file => digits(file?.id) && typeof file.title === 'string') : []
      const bugLink = bug && bugPageUrl(bug.id, origin)
      const externalBugAction = (action, label) => bugLink && h('a', { href: bugActionUrl(bug.id, action, origin), target: '_blank', rel: 'noopener noreferrer', className: 'zt-button', 'aria-label': `在禅道网页${label} Bug #${str(bug.id)}` }, label)
      return h('main', { className: 'zt-workspace' },
        h('header', { className: 'zt-header' },
          h('div', { className: 'zt-heading' }, h('div', { className: 'zt-mark', 'aria-hidden': true }, h(Icon)), h('div', null, h('h1', null, '禅道台账'), h('p', null, '团队缺陷协作工作台'))),
          h('div', { className: 'zt-header-actions' },
            h('button', { type: 'button', className: 'zt-button', disabled: !connected || writeLockedRef.current && !pendingId || !viewReady, onClick: () => setView(current => current === 'requirements' ? 'active' : 'requirements'), 'aria-pressed': view === 'requirements' }, view === 'requirements' ? '返回 Bug 台账' : '所有需求'),
            requirementsPageUrl(origin, site.productId) && h('a', { href: requirementsPageUrl(origin, site.productId), target: '_blank', rel: 'noopener noreferrer', className: 'zt-button', style: { display: 'inline-flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }, 'aria-label': '在禅道网页查看所有需求或创建需求', title: '原站需求页，可查看或创建需求；网页可能需要单独登录' }, '原站需求页 ↗'),
            h('span', { className: 'zt-connection ' + (connected ? 'is-connected' : ''), title: connected ? '禅道账号：' + account : undefined }, h('i', null), connected ? selfName + ' · 已连接' : connection === null && !connectionError ? '正在连接…' : '未连接'),
            h('button', { type: 'button', className: 'zt-button zt-button-quiet', disabled: !site.configured || connecting || writeLockedRef.current || connection === null && !connectionError, onClick: () => connectionAction(connected ? 'disconnect' : 'connect') }, connecting || connection === null && !connectionError ? '请稍候…' : connected ? '断开' : '连接禅道'))),
        connectionError && h('div', { className: 'zt-notice zt-notice-error', role: 'alert' }, connectionError),
        viewError && h('div', { className: 'zt-notice zt-notice-error', role: 'alert' }, viewError),
        pendingId && h('div', { className: 'zt-notice', role: 'status' }, '已创建 Bug #' + pendingId + '，回读待核对。可浏览台账；新建和编辑保持锁定。', h('button', { type: 'button', className: 'zt-button', onClick: () => { setPendingOpen(true); setView('active') } }, '查看回读状态'), h('button', { type: 'button', className: 'zt-button', disabled: formBusy, onClick: retryReadback }, formBusy ? '读取中…' : '只读重试 Bug #' + pendingId)),
        connection === null && !connectionError ? h('section', { className: 'zt-intro', role: 'status' }, h('h2', null, '正在连接禅道…'), h('p', null, '正在使用本机已保存的授权恢复会话，请稍候。')) :
        !site.configured && !connected ? h('section', { className: 'zt-intro' }, h('h2', null, '配置你的禅道站点'), h('p', null, '请在 DSH 的 dsh-zentao-ledger 插件配置中填写站点 origin、productId 和 projectId，可同时设置产品与项目名称。保存配置后重新打开台账，再连接你自己的账号。'), h('p', { className: 'zt-muted' }, '支持经典禅道会话授权令牌或 Cookie；AI 优化默认关闭，手工提单可直接使用。')) :
        !connected ? h('section', { className: 'zt-intro' }, h('h2', null, '连接后查看报告'),
          h('p', null, cookieAuth ? '粘贴你自己在此禅道站点的 Cookie。主机验证账号后安全保存，Cookie 不会显示在台账页面或写入草稿。' : '输入可交换经典禅道会话的授权令牌，或组织提供的兼容会话授权。此处不使用 REST API Token；主机验证账号后安全保存。'),
          h('p', { className: 'zt-muted' }, site.origin),
          h('form', { className: 'zt-connect-form', onSubmit: event => { event.preventDefault(); connectionAction('connect') } },
            h('label', { className: 'zt-field' }, h('span', null, cookieAuth ? connection?.error ? '新的禅道 Cookie' : '禅道 Cookie' : connection?.error ? '新的禅道授权令牌' : connection?.configured ? '更新会话授权令牌（可选）' : '会话授权令牌'),
              h('input', { ref: tokenInput, type: 'password', autoComplete: 'off', placeholder: '仅用于安全连接', onInput: () => setConnectionError(''), 'aria-label': cookieAuth ? '禅道 Cookie' : '禅道会话授权令牌' })),
            h('button', { type: 'submit', className: 'zt-button zt-button-primary', disabled: connecting }, connecting ? '正在验证…' : '连接禅道')))
          : view === 'requirements' ? h(RequirementsView, { service, site, origin })
          : h('div', { className: 'zt-columns' },
            h('section', { className: 'zt-ledger', 'aria-label': '报告列表' },
              h('div', { className: 'zt-toolbar' },
                h('div', { className: 'zt-tabs', role: 'tablist', 'aria-label': '报告视图' }, views.map(([key, label]) => h('button', { key, type: 'button', role: 'tab', 'aria-selected': view === key, disabled: writeLockedRef.current && !pendingId, className: view === key ? 'is-current' : '', onClick: () => setView(key) }, label))),
                h('div', { className: 'zt-header-actions' },
                  h('button', { type: 'button', className: 'zt-button', disabled: writeLockedRef.current, onClick: openDraftBox }, '草稿箱' + (draftBox.length ? `（${draftBox.length}）` : '')),
                  h('button', { type: 'button', className: 'zt-button zt-button-primary', disabled: writeLockedRef.current, title: writeLockedRef.current ? '请先核对上次提交' : undefined, onClick: () => { setDraftBoxOpen(false); openForm('create') } }, '新建 Bug'))),
              h('div', { className: 'zt-filters' },
                h('label', null, h('span', null, '创建人'), h('select', { value: selectedReporter, disabled: writeLockedRef.current && !pendingId, onChange: event => setReporter(event.target.value) },
                  !members.some(member => member.value === selfId) && h('option', { value: selfId }, selfName || '我'),
                  members.map(member => h('option', { key: member.value, value: member.value }, member.label)))),
                h('label', { className: 'zt-search' }, h('span', null, '在已加载记录中查找'), h('input', { type: 'search', value: query, onChange: event => setQuery(event.target.value), placeholder: '编号、标题、产品或负责人' }))),
              h('div', { className: 'zt-list-meta' }, h('span', null, query ? `已加载 ${items.length} 条 · 匹配 ${visible.length} 条` : `已加载 ${items.length} 条 · 第 ${page || '—'} / ${pages || '—'} 页`), cacheNote === 'cached' ? h('span', null, loading ? '显示上次结果 · 正在刷新…' : '上次结果') : h('span', null, view === 'board' ? '按负责人分组' : '仅检索已加载记录')),
              loading && h('div', { className: 'zt-loading', role: 'status', 'aria-live': 'polite' }, h('span', { className: 'zt-loading-spinner', 'aria-hidden': true }), h('span', null, loadAll ? `正在加载完整台账 · 已读取 ${items.length} 条${pages ? ` · 第 ${page || 1} / ${pages} 页` : ''}` : page ? `正在加载下一页 · 已读取 ${items.length} 条` : '正在读取台账，请稍候…')),
              listError && h('div', { className: 'zt-notice zt-notice-error', role: 'alert' }, listError, page === 0 && h('button', { type: 'button', onClick: () => startLoad(1) }, '重试')),
              h('div', { className: 'zt-list-scroll', 'aria-busy': loading ? 'true' : 'false', tabIndex: 0, 'aria-label': '报告列表，可独立滚动' },
              loading && page === 0 ? h('div', { className: 'zt-skeleton', 'aria-hidden': true }, h('div'), h('div'), h('div'))
                : visible.length ? view === 'board'
                  ? h('div', { className: 'zt-board' }, groups.length ? groups.map(group => h('section', { key: group.key, className: 'zt-group' }, h('h2', null, group.name, h('span', null, group.bugs.length + ' 条')), group.bugs.map(row => h(BugRow, { key: row.id, row, selected: selectedId === str(row.id), onClick: () => { if (writeLockedRef.current && !pendingId) return; setPendingOpen(false); setSelectedId(str(row.id)); if (!pendingId) setEditor(null) } })))) : h('p', { className: 'zt-empty' }, '当前已加载记录中没有待处理 Bug。'))
                  : h('div', { className: 'zt-rows' }, visible.map(row => h(BugRow, { key: row.id, row, selected: selectedId === str(row.id), onClick: () => { if (writeLockedRef.current && !pendingId) return; setPendingOpen(false); setSelectedId(str(row.id)); if (!pendingId) setEditor(null) } })))
                : h('div', { className: 'zt-empty' }, h('strong', null, query ? '没有匹配记录' : '当前范围暂无报告'), h('p', null, query ? '搜索仅覆盖已经加载的页面，可继续加载后再查找。' : '尝试其他视图或创建人。'))),
              h('div', { className: 'zt-pager' },
                h('span', null, page && page >= pages ? '已加载全部页面' : page ? `还有 ${pages - page} 页` : ''),
                loadAll && loading ? h('button', { type: 'button', className: 'zt-button', onClick: stopLoad, title: '当前页读取完毕后停止' }, '完成本页后停止') : null,
                page > 0 && page < pages && !loadAll && h('button', { type: 'button', className: 'zt-button', disabled: loading, onClick: () => { loadRef.current = sequence.current; startLoad(page + 1) } }, loading ? '加载中…' : '加载下一页'),
                page > 0 && page < pages && !loadAll && h('button', { type: 'button', className: 'zt-button zt-button-quiet', disabled: loading, onClick: () => { loadRef.current = sequence.current; startLoad(page + 1, true) } }, '加载全部'),
                page === 0 && !loading && h('button', { type: 'button', className: 'zt-button', onClick: () => startLoad(1) }, '刷新列表')),
              page > 0 && h('div', { className: 'zt-refresh' }, h('button', { type: 'button', disabled: loading, onClick: () => { sequence.current++; loadRef.current = sequence.current; busyRef.current = false; setItems([]); setPage(0); setPages(0); startLoad(1) } }, '从第一页刷新'))),
            h('aside', { ref: inspectorRef, tabIndex: -1, className: 'zt-inspector', 'aria-label': editor && (formStage !== 'savedPending' || pendingOpen) ? 'Bug 编辑' : 'Bug 详情' }, editor && (formStage !== 'savedPending' || pendingOpen) || formBusy && !pendingId || formError && !selectedId && !pendingId
              ? h('div', { className: 'zt-inspector-content' },
                  h('div', { className: 'zt-inspector-title' }, h('h2', null, editor ? editor.mode === 'edit' ? '编辑 Bug' : '新建 Bug' : '准备表单'), h('button', { type: 'button', className: 'zt-close', 'aria-label': '关闭表单', disabled: writeLockedRef.current && !pendingId, onClick: () => { if (pendingId) { setPendingOpen(false); return } editorRef.current++; setEditor(null); setFormError(''); setFormBusy(false) } }, '×')),
                  formBusy && !editor ? h('div', { role: 'status', 'aria-live': 'polite' }, h('div', { className: 'zt-loading' }, h('span', { className: 'zt-loading-spinner', 'aria-hidden': true }), '正在准备表单，请稍候…'), h('div', { className: 'zt-skeleton', 'aria-hidden': true }, h('div'), h('div'))) : null,
                  formError && h('div', { className: 'zt-notice zt-notice-error', role: 'alert' }, formError),
                  editor && h('div', null,
                    editor.mode === 'create' && draftBoxOpen && h('section', { className: 'zt-draft-box', 'aria-label': 'Bug 草稿箱' },
                      h('div', { className: 'zt-draft-box-head' }, h('div', null, h('h3', null, 'Bug 草稿箱'), h('p', { className: 'zt-muted' }, '先存下当前 Bug，再处理紧急 Bug；附件需在恢复后重新添加。')), h('button', { type: 'button', className: 'zt-button zt-button-quiet', onClick: () => setDraftBoxOpen(false) }, '收起')),
                      draftBox.length ? h('ul', { className: 'zt-draft-box-list' }, draftBox.map(draft => h('li', { key: draft.id },
                        h('div', null, h('strong', null, str(draft.fields?.title).trim() || '未命名 Bug'), h('small', null, new Date(draft.at).toLocaleString('zh-CN', { hour12: false }), draft.mediaCount ? ` · ${draft.mediaCount} 个附件需重新添加` : '')),
                        h('div', { className: 'zt-draft-actions' }, h('button', { type: 'button', className: 'zt-button zt-button-primary', onClick: () => resumeBoxDraft(draft.id) }, '继续编辑'), h('button', { type: 'button', className: 'zt-button zt-button-quiet', onClick: () => deleteBoxDraft(draft.id) }, '删除')))))
                        : h('div', { className: 'zt-empty' }, h('strong', null, '草稿箱还是空的'), h('p', null, '编辑新 Bug 时点击“存入草稿箱并新建”，这里就会保留一份。'))),
                    formStage === 'uncertain' ? h('div', { className: 'zt-write-hold', role: 'alert' }, h('h3', null, '提交结果待核对'), h('p', null, '写入终态未知。请在禅道按标题、创建人和时间核对；此表单已锁定，不能再次提交。'))
                      : formStage === 'conflict' ? h('div', { className: 'zt-write-hold', role: 'alert' }, h('h3', null, '编辑记录已变化'), h('p', null, '当前表单基于旧版本，不能继续提交。请重新打开编辑表单获取最新内容。'), h('button', { type: 'button', className: 'zt-button', onClick: () => openForm('edit') }, '重新打开编辑表单'))
                      : formStage === 'savedPending' ? h('div', { className: 'zt-write-hold', role: 'status' }, h('h3', null, '已返回 Bug #' + pendingId), h('p', null, '提交已得到编号。回读尚未确认，只能再次读取这条 Bug。'), h('button', { type: 'button', className: 'zt-button', disabled: formBusy, onClick: retryReadback }, formBusy ? '读取中…' : '重试读取 Bug #' + pendingId))
                    : formStage === 'review' ? h('div', { className: 'zt-review' },
                      h('p', { className: 'zt-muted' }, '请核对以下信息。点击确认后会写入禅道，并回读结果。'),
                      [['标题', editor.fields.title], ['产品', labelFor(editor, 'product')], ['项目', labelFor(editor, 'project')], ['指派给', labelFor(editor, 'assignedTo') || '未指派'], ['影响版本', editor.fields.openedBuild.map(id => labelFor(editor, 'openedBuild', id)).join('、')], ['严重程度 / 优先级', `${editor.fields.severity} / ${editor.fields.pri}`], ['问题描述处理', editor.fields.descriptionAction === 'keep' ? '保留原文' : editor.fields.descriptionAction === 'append' ? '追加' : '替换'], ['待提交媒体', mediaFiles.length ? `${mediaFiles.filter(file => /^image\//.test(file.type)).length} 张图片${mediaFiles.some(file => file.type === 'video/mp4') ? ` · ${mediaFiles.filter(file => file.type === 'video/mp4').length} 个视频` : ''}` : '无']].map(([label, value]) => h('div', { key: label, className: 'zt-review-row' }, h('dt', null, label), h('dd', null, value))),
                      editor.fields.descriptionAction !== 'keep' && h('div', { className: 'zt-review-description' }, h('strong', null, '正文预览'), h('p', null, editor.fields.description)),
                      mediaFiles.length > 0 && h('section', { className: 'zt-review-media', 'aria-label': '待提交媒体预览' }, h('h3', null, '待提交图片与附件'), h('p', { className: 'zt-muted' }, '以下顺序就是写入禅道的顺序；返回修改可继续调整。'), h('ul', { className: 'zt-media-preview-grid' }, [...mediaFiles.filter(file => file.role === 'expected'), ...mediaFiles.filter(file => file.role !== 'expected')].map(file => h(LocalMediaPreview, { key: file.name + file.size, file, compact: true, label: file.role === 'expected' ? '预期结果' : /^image\//.test(file.type) ? '实际结果' : '视频附件' })))),
                      h('div', { className: 'zt-form-actions' }, editor.mode === 'create' && site.aiEnabled === true && h('button', { type: 'button', className: 'zt-button', disabled: formBusy, onClick: requestAiOptimization }, aiStatus.startsWith('正在') ? '正在分析并优化…' : mediaFiles.some(file => /^image\//.test(file.type)) ? 'AI 识图优化描述' : '交给 AI 优化描述'), editor.mode === 'create' && h('button', { type: 'button', className: 'zt-button', disabled: formBusy, onClick: copyAiPrompt }, '复制优化提示词'), h('button', { type: 'button', className: 'zt-button', onClick: () => setFormStage('edit') }, '返回修改'), h('button', { type: 'button', className: 'zt-button zt-button-primary', disabled: formBusy, onClick: confirm }, formBusy ? mediaFiles.length ? '正在上传文件并提交…' : '提交并回读中…' : '确认提交')),
                      aiSuggestion && h('section', { className: 'zt-review-description', 'aria-label': 'AI 优化建议' },
                        h('strong', null, 'AI 建议 · 尚未提交'),
                        h('small', { className: 'zt-muted' }, `模型：${[aiSuggestion.provider, aiSuggestion.model].filter(Boolean).join(' · ') || '已配置模型'}`),
                        h('p', null, h('b', null, '标题：'), aiSuggestion.title),
                        h('p', { style: { whiteSpace: 'pre-wrap' } }, h('b', null, '描述：'), aiSuggestion.description),
                        h('div', { className: 'zt-form-actions' }, h('button', { type: 'button', className: 'zt-button zt-button-primary', onClick: applyAiSuggestion }, '应用建议并返回修改'), h('button', { type: 'button', className: 'zt-button', onClick: () => { setAiSuggestion(null); setAiStatus('已放弃本次建议，原草稿未改变。') } }, '放弃建议'))),
                      aiStatus && h('p', { role: 'status', className: 'zt-muted' }, aiStatus))
                      : h('form', { className: 'zt-form', onSubmit: event => { event.preventDefault(); review() } },
                        editor.mode === 'create' ? h('div', { className: 'zt-field' }, h('span', null, '产品（固定）'), h('div', { className: 'zt-fixed-value' }, labelFor(editor, 'product')), formErrors.product && h('em', null, formErrors.product)) : h(FormSelect, { label: '产品', field: 'product', editor, error: formErrors.product, disabled: true, onChange: () => {} }),
                        editor.mode === 'create' ? h('div', { className: 'zt-field' }, h('span', null, '项目（固定）'), h('div', { className: 'zt-fixed-value' }, labelFor(editor, 'project')), formErrors.project && h('em', null, formErrors.project)) : h(FormSelect, { label: '项目', field: 'project', editor, error: formErrors.project, disabled: true, onChange: () => {} }),
                        h('label', { className: 'zt-field zt-span' }, h('span', null, '标题', h('b', null, ' *')), h('input', { value: editor.fields.title, maxLength: 255, disabled: formBusy, onChange: event => changeField('title', event.target.value) }), formErrors.title && h('em', null, formErrors.title)),
                        h(FormSelect, { label: '指派给', field: 'assignedTo', excluded: site.excludedAssignees, editor, error: formErrors.assignedTo, disabled: formBusy, query: assigneeQuery, onQuery: setAssigneeQuery, onChange: value => changeField('assignedTo', value) }),
                        h('label', { className: 'zt-field' }, h('span', null, '严重程度'), h('select', { value: editor.fields.severity, onChange: event => changeField('severity', event.target.value) }, [1,2,3,4].map(n => h('option', { key: n, value: n }, n))), formErrors.severity && h('em', null, formErrors.severity)),
                        h('label', { className: 'zt-field' }, h('span', null, '优先级'), h('select', { value: editor.fields.pri, onChange: event => changeField('pri', event.target.value) }, [1,2,3,4,5].map(n => h('option', { key: n, value: n }, n))), formErrors.pri && h('em', null, formErrors.pri)),
                        h(FormSelect, { label: '类型', field: 'type', editor, error: formErrors.type, disabled: formBusy, onChange: value => changeField('type', value) }),
                        h('label', { className: 'zt-field' }, h('span', null, '截止日期'), h('input', { type: 'date', value: editor.fields.deadline, onChange: event => changeField('deadline', event.target.value) }), formErrors.deadline && h('em', null, formErrors.deadline)),
                        h('div', { className: 'zt-field zt-span' }, h('span', null, '影响版本 *'), h('label', { className: 'zt-checkline' }, h('input', { type: 'checkbox', checked: creatorOnly, onChange: event => toggleCreator(event.target.checked) }), '只显示当前账号创建的构建'),
                          creatorError && h('em', null, creatorError), hiddenSelections > 0 && h('small', null, `已保留 ${hiddenSelections} 个筛选范围外的已选版本；可在下方移除。`),
                          editor.fields.openedBuild.length > 0 && h('div', { className: 'zt-build-selected', 'aria-label': '已选影响版本' }, editor.fields.openedBuild.map(id => h('button', { key: id, type: 'button', title: '移除 ' + labelFor(editor, 'openedBuild', id), onClick: () => changeField('openedBuild', editor.fields.openedBuild.filter(value => value !== id)) }, labelFor(editor, 'openedBuild', id), ' ×'))),
                           h('input', { type: 'search', value: buildQuery, onChange: event => setBuildQuery(event.target.value), placeholder: '搜索版本名称或编号', 'aria-label': '搜索影响版本' }),
                           h('small', null, `显示 ${shownBuildOptions.length} / ${creatorBuildOptions.length} 个候选版本 · 新建构建在前`),
                           h('div', { ref: buildListRef, className: 'zt-builds' }, shownBuildOptions.length ? shownBuildOptions.map(option => h('label', { key: option.value, className: 'zt-checkline' }, h('input', { type: 'checkbox', checked: editor.fields.openedBuild.includes(option.value), onChange: event => changeField('openedBuild', event.target.checked ? [...editor.fields.openedBuild, option.value] : editor.fields.openedBuild.filter(value => value !== option.value)) }), option.label)) : h('span', { className: 'zt-muted' }, creatorOnly && !creatorIds ? '正在读取创建人信息…' : '没有匹配的版本')), formErrors.openedBuild && h('em', null, formErrors.openedBuild)),
                        editor.mode === 'edit' && h('label', { className: 'zt-field zt-span' }, h('span', null, '原描述处理'), h('select', { value: editor.fields.descriptionAction, onChange: event => changeField('descriptionAction', event.target.value) }, h('option', { value: 'keep' }, '保留'), h('option', { value: 'append' }, '追加'), h('option', { value: 'replace' }, '替换'))),
                        (editor.mode === 'create' || editor.fields.descriptionAction !== 'keep') && h('label', { className: 'zt-field zt-span' }, h('span', null, '问题描述'), h('textarea', { rows: 6, value: editor.fields.description, onChange: event => changeField('description', event.target.value), onPaste: pasteMedia('actual'), placeholder: '发生条件、操作、实际结果与预期结果；可直接粘贴截图（归入实际结果）' }), formErrors.description && h('em', null, formErrors.description)),
                        h('div', { className: 'zt-media-pair zt-span' },
                          h('div', { className: 'zt-field zt-media', tabIndex: 0, onPaste: pasteMedia('expected'), 'aria-label': '预期结果截图区域，可按 ⌘V 粘贴截图' },
                            h('span', null, '预期结果截图'),
                            h('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.gif', disabled: formBusy, onChange: chooseMedia('expected'), 'aria-label': '选择预期结果截图' }),
                            h('small', null, '聚焦这里或直接在正文粘贴：正文粘贴的图归入“实际结果”。'),
                            h('ul', { className: 'zt-media-list' }, mediaFiles.filter(file => file.role === 'expected').map((file, index, group) => h(LocalMediaPreview, { key: file.name + file.size, file, index, total: group.length, onMove: moveMedia, onRemove: removeMedia })))),
                          h('div', { className: 'zt-field zt-media', tabIndex: 0, onPaste: pasteMedia('actual'), 'aria-label': '实际结果截图区域，可按 ⌘V 粘贴截图' },
                            h('span', null, '实际结果截图'),
                            h('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.gif,.mp4', disabled: formBusy, onChange: chooseMedia('actual'), 'aria-label': '选择实际结果截图或 MP4' }),
                            h('small', null, '粘贴或选择实际界面；MP4 作为可下载附件。'),
                            h('ul', { className: 'zt-media-list' }, mediaFiles.filter(file => file.role !== 'expected').map((file, index, group) => h(LocalMediaPreview, { key: file.name + file.size, file, index, total: group.length, onMove: moveMedia, onRemove: removeMedia }))))),
                        h('div', { className: 'zt-field zt-span' },
                          h('small', null, '截图会分别以“预期结果”“实际结果”标题嵌入描述，视频作为附件。最多 6 个，图片单个不超过 8 MiB、视频单个不超过 25 MiB，总计不超过 40 MiB。'),
                          h('div', null, h('button', { type: 'button', className: 'zt-button', disabled: formBusy || mediaCheck.state === 'checking', onClick: checkMediaUpload }, mediaCheck.state === 'checking' ? '正在核对授权…' : '检查图片上传授权')),
                          mediaCheck.text && h('small', { role: mediaCheck.state === 'error' ? 'alert' : 'status' }, mediaCheck.text)),
                         editor.mode === 'edit' && h('label', { className: 'zt-field zt-span' }, h('span', null, '修改说明'), h('textarea', { rows: 3, value: editor.fields.comment, onChange: event => changeField('comment', event.target.value) }), formErrors.comment && h('em', null, formErrors.comment)),
                        formErrors.form && h('div', { className: 'zt-notice zt-notice-error' }, formErrors.form),
                         editor.mode === 'create' && h('div', { className: 'zt-form-actions zt-span', style: { justifyContent: 'space-between', alignItems: 'center' } },
                           h('small', { className: 'zt-muted', role: 'status' }, draftStatus || '编辑内容会自动保存到本机；截图和视频需重新添加。'),
                           h('div', { className: 'zt-draft-actions' },
                             h('button', { type: 'button', className: 'zt-button', disabled: formBusy, onClick: stashCurrentAndNew }, '存入草稿箱并新建'),
                             draftDirty && h('button', { type: 'button', className: 'zt-button zt-button-quiet', disabled: formBusy, onClick: clearCachedDraft }, '清除本机草稿'))),
                        h('div', { className: 'zt-form-actions zt-span' }, aiApplied
                          ? h('button', { type: 'button', className: 'zt-button zt-button-primary', disabled: formBusy || formStage === 'uncertain', onClick: () => confirm(true) }, formBusy ? mediaFiles.length ? '正在上传并提交…' : '正在提交并回读…' : '直接提交')
                          : h('button', { type: 'submit', className: 'zt-button zt-button-primary', disabled: formBusy || formStage === 'uncertain' }, '预览并核对')))))
              : selectedId ? h('div', { className: 'zt-inspector-content' },
                  h('div', { className: 'zt-inspector-title' }, h('h2', null, '报告详情'), h('button', { type: 'button', className: 'zt-close', 'aria-label': '关闭详情', onClick: () => { detailSequence.current++; setSelectedId(''); setDetail(null) } }, '×')),
                  detailLoading ? h('div', { role: 'status', 'aria-live': 'polite' }, h('div', { className: 'zt-loading' }, h('span', { className: 'zt-loading-spinner', 'aria-hidden': true }), '正在读取报告详情…'), h('div', { className: 'zt-skeleton', 'aria-hidden': true }, h('div'), h('div'))) : detailError ? h('div', { className: 'zt-notice zt-notice-error', role: 'alert' }, detailError, h('button', { type: 'button', onClick: () => { const id = selectedId; setSelectedId(''); setTimeout(() => setSelectedId(id), 0) } }, '重试'))
                    : bug && h('div', null, h('div', { className: 'zt-detail-heading' }, h('span', null, bugLink ? h('button', { type: 'button', className: 'zt-bug-id-copy', style: { border: 0, padding: 0, background: 'none', color: 'inherit', font: 'inherit', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer' }, onClick: copyBugLink, title: '复制 Bug #' + str(bug.id) + ' 的禅道链接', 'aria-label': '复制 Bug #' + str(bug.id) + ' 的禅道链接' }, '#' + bug.id) : '#' + bug.id, ' · ' + statusLabel(bug.status)), h('h3', null, bug.title)), linkCopy && h('div', { role: 'status', className: 'zt-muted' }, linkCopy, linkCopy.startsWith('复制失败') && bugLink && h('input', { type: 'text', readOnly: true, value: bugLink, onFocus: event => event.target.select(), 'aria-label': '手动复制禅道链接' })),
                      h('dl', { className: 'zt-facts' }, [['产品', bug.productName || bug.product], ['创建人', personLabel(bug.openedBy, displayUsers)], ['负责人', personLabel(bug.assignedTo, displayUsers)], ['创建时间', bug.openedDate], ['优先级', bug.pri || bug.priority], ['影响版本', Array.isArray(bug.openedBuild) ? bug.openedBuild.join('、') : bug.openedBuild]].map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, str(value) || '—')))),
                      h('div', { className: 'zt-detail-actions' }, bugLink && h('a', { href: bugLink, target: '_blank', rel: 'noopener noreferrer', className: 'zt-button', 'aria-label': '在禅道网页打开 Bug #' + str(bug.id) }, '在禅道打开'), h('button', { type: 'button', className: 'zt-button', onClick: () => openForm('edit') }, '台账内编辑'), externalBugAction('edit', '去禅道编辑'), ['resolved', 'closed'].includes(bug.status) && externalBugAction('activate', '去禅道激活'), bug.status === 'resolved' && h('button', { type: 'button', className: 'zt-button zt-button-primary', disabled: writeLockedRef.current || closeBusyRef.current || ['sending', 'uncertain'].includes(closeRun.stage), onClick: prepareClose }, '验收后关闭 Bug'), bug.status === 'resolved' && externalBugAction('close', '去禅道关闭'), h('button', { type: 'button', className: 'zt-button', onClick: prepareAcceptanceDraft }, '填写验收记录模板')),
                       bugLink && h('p', { className: 'zt-muted' }, '原站提交后返回台账，点击“从第一页刷新”查看最新状态。'),
                       closeRun.stage !== 'idle' && h('section', { className: 'zt-acceptance-draft', 'aria-label': '关闭 Bug 确认' },
                          h('h4', null, '关闭 Bug #' + str(bug.id)),
                          closeRun.stage === 'closed' ? h('p', { role: 'status' }, '已从禅道回读关闭状态与操作历史。操作记录 #' + str(closeRun.receipt?.actionId))
                            : closeRun.stage === 'uncertain' ? h('div', null,
                              h('p', { role: 'alert' }, closeRun.error || '关闭结果尚未确认，请只读核对；切勿重复点击关闭。'),
                              h('button', { type: 'button', className: 'zt-button', disabled: closeBusyRef.current, onClick: reconcileClose }, '只读核对关闭结果'))
                            : h('div', null,
                              h('p', null, '仅在你确认验收通过后关闭这一条 Bug。提交前会重新核对账号、标题与“已解决”状态；此操作不会自动填写验收记录。'),
                              h('p', { className: 'zt-muted' }, '#' + str(bug.id) + ' · ' + str(bug.title)),
                              h('label', { className: 'zt-checkline' }, h('input', { type: 'checkbox', checked: !!closeRun.confirmed, disabled: closeRun.stage === 'sending', onChange: event => updateClose(str(bug.id), { confirmed: event.target.checked }) }), '我已核对验收结果，确认关闭这条 Bug'),
                              h('label', { className: 'zt-field' }, h('span', null, '关闭说明（可选）'), h('textarea', { rows: 2, maxLength: 5000, value: closeRun.comment, disabled: closeRun.stage === 'sending', onChange: event => updateClose(str(bug.id), { comment: event.target.value }) })),
                               h('div', { className: 'zt-field zt-media', tabIndex: 0, onPaste: pasteCloseImages, 'aria-label': '验收截图区域，可粘贴截图' },
                                 h('span', null, '验收截图（可选）'),
                                 h('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.gif', disabled: closeRun.stage === 'sending', onChange: chooseCloseImages, 'aria-label': '选择验收截图' }),
                                 h('small', null, '可直接粘贴或选择图片；确认关闭后才上传，并写入本次关闭记录。最多 6 张，单张不超过 8 MiB。'),
                                 h('ul', { className: 'zt-media-list' }, (closeRun.media || []).map(file => h('li', { key: file.name + file.size }, h('span', null, file.name, ' · ', (file.size / 1024 / 1024).toFixed(1), ' MiB'), h('button', { type: 'button', className: 'zt-button zt-button-quiet', disabled: closeRun.stage === 'sending', onClick: () => updateClose(str(bug.id), { media: closeRun.media.filter(item => item !== file) }) }, '移除'))))),
                              closeRun.error && h('p', { role: 'alert' }, closeRun.error),
                              h('div', { className: 'zt-draft-actions' }, h('button', { type: 'button', className: 'zt-button zt-button-primary', disabled: !closeRun.confirmed || closeRun.stage === 'sending' || closeBusyRef.current, onClick: confirmClose }, closeRun.stage === 'sending' ? (closeRun.media || []).length ? '正在上传截图、关闭并回读…' : '正在关闭并回读…' : '确认关闭 Bug #' + str(bug.id)), h('button', { type: 'button', className: 'zt-button', disabled: closeRun.stage === 'sending', onClick: () => updateClose(str(bug.id), { stage: 'idle', confirmed: false, error: '', media: [] }) }, '取消')))),
                        draftOpen && h('section', { className: 'zt-acceptance-draft', 'aria-label': '验收记录模板' }, h('h4', null, '验收记录模板 · 仅复制'), h('p', null, '填写测试范围、实测结果与结论后可复制到聊天记录。这里不会发送消息、添加禅道备注或关闭 Bug。'), h('textarea', { value: draft, onChange: event => { setDraft(event.target.value); setCopyNote('') }, rows: 9, 'aria-label': '编辑验收草稿' }), h('div', { className: 'zt-draft-actions' }, h('button', { type: 'button', className: 'zt-button', onClick: copyDraft }, '复制草稿'), copyNote && h('span', { role: 'status' }, copyNote))),
                      h('section', { className: 'zt-detail-section' }, h('h4', null, '问题描述'), h(BodyText, { html: bug.steps || bug.description, service, origin })),
                       origin && attachedFiles.length > 0 && h('section', { className: 'zt-detail-section' }, h('h4', null, '附件'), h('ul', { className: 'zt-attachments' }, attachedFiles.map(file => h('li', { key: file.id }, h('a', { href: siteUrl(origin, `file-download-${file.id}.html`), target: '_blank', rel: 'noopener noreferrer' }, file.title), h('small', null, file.extension === 'mp4' ? '视频附件 · 禅道原站下载' : '禅道原站下载'))))),
                      h('section', { className: 'zt-detail-section' }, h('h4', null, '历史记录'), ((detail.actions && detail.actions.length ? detail.actions : detail.histories) || []).length ? (detail.actions && detail.actions.length ? detail.actions : detail.histories).map((action, i) => {
                        const actor = personLabel(action.actor || action.actionBy || action.createdBy, displayUsers) || '禅道用户'
                        const operation = historyActionLabel(action.action || action.type)
                        const extra = historyExtra(action, displayUsers)
                        const content = action.comment || action.content || action.note || ''
                        return h('article', { className: 'zt-history', key: action.id || i },
                          h('div', { className: 'zt-history-head' }, h('strong', null, actor, ' · ', operation), h('time', null, str(action.date || action.actionTime || action.createdDate))),
                          extra && h('p', { className: 'zt-history-extra' }, extra),
                          content && h(BodyText, { html: content, service, origin }))
                      }) : h('p', { className: 'zt-muted' }, '暂无历史记录。'))))
                : h('div', { className: 'zt-detail-empty' }, h(Icon), h('h2', null, '选一条报告查看详情'), h('p', null, '正文与历史记录会在这里展开。'))))
      )
    }
    function labelFor(editor, key, id) {
      const value = str(id === undefined ? editor.fields[key] : id)
      return choices(editor, key).find(option => option.value === value)?.label || value
    }
    function statusLabel(status) { return ({ active: '待处理', resolved: '已解决', closed: '已关闭' })[status] || str(status || '未知状态') }
    const historyActionLabel = action => ({
      opened: '创建了 Bug', edited: '编辑了 Bug', assigned: '指派了 Bug', resolved: '解决了 Bug',
      closed: '关闭了 Bug', activated: '激活了 Bug', commented: '添加了备注', changed: '更新了 Bug',
      confirmed: '确认了 Bug', linked2build: '关联了版本', unlinkedfrombuild: '移除了版本关联',
      linked2story: '关联了需求', unlinkedfromstory: '移除了需求关联', deleted: '删除了 Bug', restored: '还原了 Bug'
    })[str(action).toLowerCase()] || '更新了 Bug'
    const resolutionLabel = value => ({
      fixed: '已修复', bydesign: '设计如此', duplicate: '重复 Bug', external: '外部原因',
      notrepro: '无法重现', postponed: '延期处理', willnotfix: '不予修复', tostory: '转为需求'
    })[str(value).toLowerCase()] || ''
    function historyExtra(action, users) {
      const kind = str(action?.action).toLowerCase(), extra = str(action?.extra)
      if (!extra) return ''
      if (kind === 'resolved') return resolutionLabel(extra) ? '解决方案：' + resolutionLabel(extra) : ''
      if (kind === 'assigned') return '指派给：' + personLabel(extra, users)
      return ''
    }
    function BugRow({ row, selected, onClick }) {
      const state = str(row.status).replace(/[^a-z]/g, '') || 'unknown'
      const priority = str(row.pri || row.priority || 'none').replace(/[^0-9a-z]/gi, '') || 'none'
      const severity = str(row.severity || 'none').replace(/[^0-9a-z]/gi, '') || 'none'
      return h('button', { type: 'button', className: `zt-row zt-row-status-${state} zt-row-pri-${priority} zt-row-severity-${severity}` + (selected ? ' is-selected' : ''), onClick, 'aria-current': selected ? 'true' : undefined },
        h('span', { className: 'zt-row-signal', 'aria-hidden': true }, h('i', { className: 'zt-signal-status' }), h('i', { className: 'zt-signal-owner' }), h('i', { className: 'zt-signal-risk' })),
        h('span', { className: 'zt-row-main' }, h('strong', null, row.title || '未命名报告'), h('small', null, '#' + row.id + '  ·  ' + str(row.productName || row.product || '未指定产品'))),
        h('span', { className: 'zt-row-side' }, h('span', { className: 'zt-status zt-status-' + state }, statusLabel(row.status)),
          h('small', { className: 'zt-row-owner' }, str(row.assignedTo || '未指派') + ' · ' + (validDate(row.openedDate) === null ? '日期未知' : str(row.openedDate).slice(0, 10))),
          h('small', { className: 'zt-row-signals' }, '优先级 ' + str(row.pri || row.priority || '—') + ' · 严重度 ' + str(row.severity || '—') + ' · ' + (hangingDays(row.openedDate) === null ? '天数未知' : row.status === 'active' ? '已悬挂 ' + hangingDays(row.openedDate) + ' 天' : '报告于 ' + hangingDays(row.openedDate) + ' 天前'))))
    }
    const assigneeName = label => str(label).replace(/^\s*[A-Za-z]:\s*/, '').trim()
    function FormSelect({ label, field, editor, onChange, error, disabled, query = '', onQuery, excluded = [] })
 {
      const options = choices(editor, field)
      const excludedAssignees = new Set(Array.isArray(excluded) ? excluded : [])
      const value = editor.fields[field]
      if (field === 'assignedTo') {
        const needle = query.trim().toLocaleLowerCase()
        const visible = options.filter(option =>
          (option.value === value || !excludedAssignees.has(assigneeName(option.label)) && !excludedAssignees.has(option.value)) &&
          (option.value === value || !needle || (option.label + ' ' + option.value).toLocaleLowerCase().includes(needle)))
        return h('div', { className: 'zt-field' }, h('span', null, label),
          h('input', { type: 'search', value: query, disabled, onChange: event => onQuery(event.target.value), placeholder: '搜索指派人姓名或账号', 'aria-label': '搜索指派人姓名或账号' }),
          h('select', { value, disabled, 'aria-label': '指派给', onChange: event => { onChange(event.target.value); onQuery('') } },
            !options.some(option => option.value === value) && h('option', { value }, value || '请选择'),
            visible.map(option => h('option', { key: option.value, value: option.value }, option.label))),
          error && h('em', null, error))
      }
      return h('label', { className: 'zt-field' }, h('span', null, label), h('select', { value, disabled, onChange: event => onChange(event.target.value) },
        !options.some(option => option.value === value) && h('option', { value }, value || '请选择'),
        options.map(option => h('option', { key: option.value, value: option.value }, option.label))), error && h('em', null, error))
    }
    const panelCss = ".zt-workspace{--zt-ink:#213346;--zt-muted:#53677c;--zt-border:#d5dfe7;--zt-paper:#fff;--zt-ground:#f2f6f8;--zt-soft:#eaf1f5;--zt-accent:#176c80;--zt-accent-dark:#0e5265;--zt-danger:#a13438;box-sizing:border-box;min-height:100%;padding:clamp(16px,2.2vw,32px);background:var(--zt-ground);color:var(--zt-ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;letter-spacing:0}.zt-workspace *{box-sizing:border-box}.zt-workspace ::selection{background:#c6e9e9;color:#163b47}.zt-workspace button,.zt-workspace input,.zt-workspace textarea,.zt-workspace select{font:inherit}.zt-workspace button{cursor:pointer}.zt-workspace button:disabled{cursor:not-allowed;opacity:.56}.zt-workspace :focus-visible{outline:2px solid var(--zt-accent);outline-offset:2px}.zt-workspace h1,.zt-workspace h2,.zt-workspace h3,.zt-workspace h4,.zt-workspace p{margin:0}.zt-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}.zt-heading{display:flex;align-items:center;gap:14px}.zt-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:var(--zt-accent);color:white}.zt-heading h1{font-size:22px;line-height:1.2;letter-spacing:-.02em}.zt-heading p{color:var(--zt-muted);margin-top:3px}.zt-header-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.zt-connection{display:inline-flex;align-items:center;gap:8px;color:var(--zt-muted);white-space:nowrap}.zt-connection i{width:7px;height:7px;border-radius:50%;background:#a7b1b9}.zt-connection.is-connected i{background:#1a806a}.zt-button{border:1px solid var(--zt-control-border,#b7c9d1);border-radius:8px;background:var(--zt-control,#fff);color:var(--zt-ink);min-height:36px;padding:7px 13px;line-height:1.3;transition:background .18s,border-color .18s}.zt-button:hover:not(:disabled){background:var(--zt-hover,#eaf4f6);border-color:var(--zt-control-border,#8eaeba)}.zt-button-primary{background:var(--zt-primary,var(--zt-accent));border-color:var(--zt-primary,var(--zt-accent));color:white;font-weight:600}.zt-button-primary:hover:not(:disabled){background:var(--zt-primary-hover,var(--zt-accent-dark));border-color:var(--zt-primary-hover,var(--zt-accent-dark))}.zt-button-quiet{background:transparent;border-color:transparent;color:var(--zt-accent)}.zt-button-quiet:hover:not(:disabled){background:var(--zt-soft)}.zt-columns{display:grid;grid-template-columns:minmax(430px,1.25fr) minmax(340px,.85fr);gap:18px;align-items:start}.zt-ledger,.zt-inspector,.zt-intro{background:var(--zt-paper);border:1px solid var(--zt-border);border-radius:14px;min-width:0;box-shadow:0 6px 22px rgba(31,69,86,.055)}.zt-ledger{overflow:hidden}.zt-inspector{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow:auto;scrollbar-color:#a8bbc5 transparent}.zt-intro{max-width:640px;padding:40px}.zt-intro h2{font-size:20px}.zt-intro p{max-width:62ch;color:var(--zt-muted);margin:8px 0 20px}.zt-toolbar{padding:18px 18px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--zt-border)}.zt-tabs{display:flex;flex-wrap:wrap;gap:4px}.zt-tabs button{border:0;background:transparent;color:var(--zt-muted);padding:9px 11px;border-radius:8px;white-space:nowrap;font-weight:600}.zt-tabs button:hover{background:var(--zt-soft);color:var(--zt-ink)}.zt-tabs button.is-current{background:var(--zt-selected,#dceef0);color:var(--zt-selected-ink,#0c586a)}.zt-filters{display:grid;grid-template-columns:minmax(130px,.42fr) minmax(180px,1fr);gap:12px;padding:16px 18px}.zt-filters label,.zt-field{display:flex;flex-direction:column;gap:5px;min-width:0}.zt-filters label>span,.zt-field>span{font-size:12px;font-weight:650;color:var(--zt-muted)}.zt-filters input,.zt-filters select,.zt-field input:not([type=checkbox]),.zt-field select,.zt-field textarea{border:1px solid var(--zt-control-border,#bdccd6);background:var(--zt-control,#fff);color:var(--zt-ink);border-radius:8px;padding:8px 10px;width:100%;min-width:0;min-height:38px}.zt-field textarea{resize:vertical;min-height:80px}.zt-filters input::placeholder,.zt-field input::placeholder,.zt-field textarea::placeholder{color:#64798a;opacity:1}.zt-list-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--zt-muted);font-size:12px;padding:0 18px 12px}.zt-rows,.zt-board{border-top:1px solid var(--zt-border)}.zt-row{width:100%;border:0;border-bottom:1px solid #e2e9ee;background:transparent;text-align:left;padding:15px 18px;display:flex;justify-content:space-between;align-items:center;gap:16px;color:var(--zt-ink)}.zt-row:last-child{border-bottom:0}.zt-row:hover{background:var(--zt-hover,#f3f8fa)}.zt-row.is-selected{background:var(--zt-selected,#eaf4f6);box-shadow:inset 3px 0 var(--zt-accent)}.zt-row-main{min-width:0;display:flex;flex-direction:column;gap:4px}.zt-row-main strong{font-weight:630;line-height:1.4;overflow-wrap:anywhere}.zt-row small{font-size:12px;color:var(--zt-muted)}.zt-row-side{display:flex;align-items:flex-end;flex-direction:column;gap:5px;flex:none;max-width:42%;white-space:nowrap}.zt-row-signals{white-space:normal;text-align:right}.zt-status{border-radius:5px;padding:2px 7px;font-size:12px;background:#edf1f4;color:#455a6c}.zt-status-active{background:var(--zt-active-bg,#fff0dd);color:var(--zt-active-ink,#79500c)}.zt-status-resolved{background:var(--zt-resolved-bg,#e4f5ee);color:var(--zt-resolved-ink,#22664d)}.zt-status-closed{background:var(--zt-closed-bg,#e9eef3);color:var(--zt-closed-ink,#45576a)}.zt-group{margin-bottom:10px}.zt-group h2{font-size:14px;padding:13px 18px;background:var(--zt-hover,#f3f7f9);display:flex;justify-content:space-between}.zt-group h2 span{font-size:12px;font-weight:500;color:var(--zt-muted)}.zt-empty{padding:46px 24px;text-align:center;color:var(--zt-muted)}.zt-empty strong{display:block;color:var(--zt-ink);font-size:16px;margin-bottom:5px}.zt-pager{padding:14px 18px;border-top:1px solid var(--zt-border);display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.zt-pager span{margin-right:auto;color:var(--zt-muted);font-size:12px}.zt-refresh{border-top:1px solid #edf1f3;text-align:center;padding:7px}.zt-refresh button,.zt-notice button{border:0;background:transparent;color:var(--zt-accent);text-decoration:underline;text-underline-offset:3px}.zt-inspector-content{padding:20px}.zt-inspector-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:18px}.zt-inspector-title h2{font-size:17px}.zt-close{border:0;background:transparent;border-radius:6px;color:var(--zt-muted);font-size:24px;line-height:1;width:32px;height:32px}.zt-close:hover{background:var(--zt-soft)}.zt-detail-empty{padding:78px 24px;text-align:center;color:var(--zt-muted)}.zt-detail-empty svg{color:var(--zt-accent);width:32px;height:32px;margin-bottom:14px}.zt-detail-empty h2{font-size:16px;color:var(--zt-ink);margin-bottom:4px}.zt-detail-heading{border-bottom:1px solid var(--zt-border);padding-bottom:16px}.zt-detail-heading span{color:var(--zt-accent);font-size:12px;font-weight:700}.zt-detail-heading h3{font-size:19px;line-height:1.45;margin-top:6px;overflow-wrap:anywhere}.zt-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px;margin:18px 0}.zt-facts div{min-width:0}.zt-facts dt{font-size:12px;color:var(--zt-muted)}.zt-facts dd{margin:2px 0 0;overflow-wrap:anywhere}.zt-detail-actions{display:flex;flex-wrap:wrap;gap:8px}.zt-acceptance-draft{margin-top:20px;padding:16px;border-radius:9px;background:var(--zt-soft)}.zt-acceptance-draft h4{font-size:14px;margin-bottom:6px}.zt-acceptance-draft p{color:var(--zt-muted);font-size:12px;margin-bottom:10px}.zt-acceptance-draft textarea{width:100%;min-height:180px;resize:vertical;border:1px solid var(--zt-control-border,#bdccd6);border-radius:8px;background:var(--zt-control,#fff);color:var(--zt-ink);padding:10px;line-height:1.6}.zt-draft-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px;color:var(--zt-muted);font-size:12px}.zt-detail-section{margin-top:28px}.zt-detail-section h4{font-size:14px;border-bottom:1px solid var(--zt-border);padding-bottom:9px;margin-bottom:12px}.zt-prose{overflow-wrap:anywhere;line-height:1.7;max-width:72ch}.zt-prose p+p{margin-top:10px}.zt-muted{color:var(--zt-muted)}.zt-history{padding:13px 0;border-bottom:1px solid var(--zt-border)}.zt-history-head{display:flex;justify-content:space-between;gap:12px;color:var(--zt-muted);font-size:12px;margin-bottom:6px}.zt-history-head strong{color:var(--zt-ink)}.zt-history-extra{color:var(--zt-ink);font-size:13px;margin:2px 0 6px!important}.zt-image{margin:12px 0}.zt-image img{max-width:100%;height:auto;display:block;border-radius:6px}.zt-image-placeholder{display:grid;place-items:center;background:var(--zt-soft,#ecf2f5);color:var(--zt-muted);min-height:110px;border-radius:6px}.zt-image-placeholder button{background:transparent;border:0;color:var(--zt-accent);text-decoration:underline}.zt-notice{margin:12px 18px;padding:10px 12px;border-radius:8px;background:#e9f4f5;color:#174e5c}.zt-notice-error{background:var(--zt-error-bg,#fff0ef);color:var(--zt-error-ink,#8a2c32)}.zt-inspector .zt-notice{margin:0 0 14px}.zt-skeleton{padding:20px}.zt-skeleton div{height:44px;border-radius:6px;background:var(--zt-soft,#eaf0f3);margin-bottom:12px}.zt-skeleton div:nth-child(2){width:80%}.zt-skeleton div:nth-child(3){width:65%}.zt-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.zt-form .zt-span{grid-column:1/-1}.zt-field b,.zt-field em{color:var(--zt-danger);font-style:normal}.zt-field em{font-size:12px}.zt-field small{color:var(--zt-muted);font-size:12px}.zt-checkline{display:flex;align-items:flex-start;gap:8px;line-height:1.4;cursor:pointer}.zt-checkline input{accent-color:var(--zt-accent);margin:2px 0 0}.zt-build-selected{display:flex;gap:6px;flex-wrap:wrap}.zt-build-selected button{border:1px solid var(--zt-control-border,#a8c8cd);border-radius:5px;background:var(--zt-selected,#eaf4f6);color:var(--zt-selected-ink,#14586b);padding:3px 7px;max-width:100%;overflow-wrap:anywhere;text-align:left}.zt-connect-form{display:grid;gap:12px;max-width:350px}.zt-connect-form .zt-button{justify-self:start}.zt-builds{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px;max-height:190px;overflow:auto;background:var(--zt-ground);border-radius:8px;padding:12px;scrollbar-color:#a8bbc5 transparent}.zt-builds .zt-checkline{overflow-wrap:anywhere}.zt-form-actions{display:flex;justify-content:flex-end;gap:9px;padding-top:12px;border-top:1px solid var(--zt-border)}.zt-write-hold{padding:20px;border-radius:9px;background:var(--zt-soft,#f1f6f8);color:var(--zt-ink)}.zt-write-hold h3{font-size:16px;margin-bottom:8px}.zt-write-hold p{color:var(--zt-muted);margin-bottom:14px}.zt-review-row{display:grid;grid-template-columns:100px 1fr;gap:10px;padding:9px 0;border-bottom:1px solid #e9eef1}.zt-review-row dt{color:var(--zt-muted)}.zt-review-row dd{margin:0;overflow-wrap:anywhere}.zt-draft-box{margin-bottom:18px;padding:14px;border:1px solid var(--zt-border);border-radius:10px;background:var(--zt-ground)}.zt-draft-box-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.zt-draft-box-head h3{font-size:16px}.zt-draft-box-head p{margin-top:3px}.zt-draft-box-list{list-style:none;margin:12px 0 0;padding:0}.zt-draft-box-list>li{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 0;border-top:1px solid var(--zt-border)}.zt-draft-box-list strong{display:block;overflow-wrap:anywhere}.zt-draft-box-list small{display:block;color:var(--zt-muted);margin-top:3px}.zt-review-description{margin:18px 0;background:var(--zt-ground);padding:12px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.zt-review-description p{margin-top:7px}.zt-review>.zt-muted{margin-bottom:12px}@media(max-width:1050px){.zt-columns{grid-template-columns:minmax(0,1fr)}.zt-inspector{position:static;max-height:none}.zt-detail-empty{padding:38px 20px}}@media(max-width:600px){.zt-media-pair,.zt-media-preview-grid{grid-template-columns:1fr}.zt-media-item{grid-template-columns:44px minmax(0,1fr)}.zt-media-actions{grid-column:1/-1}.zt-draft-box-list>li{align-items:flex-start;flex-direction:column}}@media(max-width:600px){.zt-workspace{padding:12px}.zt-header{align-items:flex-start;flex-direction:column;gap:14px}.zt-header-actions{width:100%;justify-content:space-between}.zt-toolbar{align-items:stretch;padding:12px}.zt-toolbar>.zt-button{align-self:flex-start}.zt-tabs{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.zt-tabs button{white-space:normal}.zt-filters{grid-template-columns:1fr;padding:12px}.zt-row{align-items:flex-start;flex-direction:column;gap:8px;padding:13px}.zt-row-side{flex-direction:row;align-items:center;justify-content:flex-start;flex-wrap:wrap;width:100%;max-width:none;white-space:normal}.zt-row-signals{text-align:left}.zt-inspector-content{padding:16px}.zt-form{grid-template-columns:1fr}.zt-facts{grid-template-columns:1fr 1fr}.zt-builds{grid-template-columns:1fr}.zt-intro{padding:24px}.zt-pager{justify-content:flex-start}.zt-pager span{width:100%}}\n\n/* Keep list actions reachable while long report histories scroll inside the ledger. */\n.zt-workspace{container-type:inline-size}.zt-columns{grid-template-columns:clamp(440px,38%,760px) minmax(0,1fr);height:max(520px,calc(100dvh - 132px));align-items:stretch}.zt-ledger{display:flex;flex-direction:column;min-height:0}.zt-list-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-color:var(--zt-control-border,#a8bbc5) transparent}.zt-list-scroll:focus-visible{outline-offset:-3px}.zt-inspector{position:relative;top:auto;max-height:none;height:100%;overscroll-behavior:contain}.zt-inspector-content{max-width:960px}.zt-detail-actions a.zt-button{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;white-space:nowrap}.zt-inspector > .zt-detail-empty{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:24px}.zt-fixed-value{display:flex;align-items:center;min-height:38px;padding:8px 10px;border:1px solid var(--zt-border);border-radius:8px;background:var(--zt-soft);color:var(--zt-ink);font-weight:600}.zt-media-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.zt-media input[type=file]{height:auto;min-height:40px;padding:7px 10px}.zt-media input::file-selector-button{margin-right:12px;border:1px solid var(--zt-border);border-radius:6px;padding:5px 9px;background:var(--zt-soft);color:var(--zt-ink);cursor:pointer}.zt-media-list,.zt-attachments{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:6px}.zt-media-item{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:9px;padding:7px 9px;border:1px solid var(--zt-border);border-radius:8px;background:var(--zt-soft)}.zt-media-thumb,.zt-media-file{display:grid;place-items:center;width:44px;height:44px;overflow:hidden;border-radius:6px;background:var(--zt-paper);color:var(--zt-muted);font-size:10px;font-weight:700}.zt-media-thumb img{width:100%;height:100%;object-fit:cover}.zt-media-meta{display:grid;min-width:0;overflow-wrap:anywhere}.zt-media-meta b{color:var(--zt-accent-dark);font-size:11px}.zt-media-meta small{color:var(--zt-muted)}.zt-media-actions{display:flex;gap:4px}.zt-media-actions .zt-button{min-height:30px;padding:4px 7px;font-size:12px}.zt-media-hover{display:none;position:absolute;z-index:20;left:54px;bottom:calc(100% + 8px);width:min(340px,70vw);padding:6px;border:1px solid var(--zt-border);border-radius:9px;background:var(--zt-paper);box-shadow:0 12px 28px rgba(28,53,69,.2)}.zt-media-hover img{display:block;width:100%;max-height:300px;object-fit:contain}.zt-media-item:hover .zt-media-hover,.zt-media-item:focus-within .zt-media-hover,.zt-media-item:focus .zt-media-hover{display:block}.zt-review-media{margin:18px 0}.zt-review-media h3{font-size:14px}.zt-review-media>.zt-muted{margin:4px 0 9px}.zt-media-preview-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.zt-media-item.is-review{display:block;padding:8px}.zt-media-item.is-review .zt-media-thumb,.zt-media-item.is-review .zt-media-file{width:100%;height:150px;margin-bottom:7px}.zt-media-item.is-review .zt-media-file{font-size:14px}.zt-media-item.is-review .zt-media-hover{display:none}.zt-media-list>li:not(.zt-media-item){display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 10px;border:1px solid var(--zt-border);border-radius:8px;background:var(--zt-soft)}.zt-media-list>li:not(.zt-media-item) span{min-width:0;overflow-wrap:anywhere}.zt-attachments li{display:flex;gap:10px;flex-wrap:wrap}.zt-attachments a{color:var(--zt-accent-dark);text-underline-offset:3px}.zt-attachments small{color:var(--zt-muted)}.zt-row{padding:11px 16px;align-items:flex-start}.zt-row-side{white-space:normal;max-width:44%;min-width:120px}.zt-loading{display:flex;align-items:center;gap:9px;padding:9px 18px;color:var(--zt-accent-dark);font-size:13px;font-weight:600;background:var(--zt-soft)}.zt-loading-spinner{display:inline-block;width:15px;height:15px;flex:none;border:2px solid var(--zt-control-border,#9fb5be);border-top-color:var(--zt-accent);border-radius:50%;animation:zt-loading-spin .8s linear infinite}@keyframes zt-loading-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.zt-loading-spinner{animation:none;border-color:var(--zt-accent)}}\n@media(max-width:1050px){.zt-columns{grid-template-columns:minmax(0,1fr);height:auto}.zt-ledger{height:min(60dvh,620px);min-height:390px}.zt-inspector{position:static;height:auto;max-height:70dvh;scroll-margin-top:16px}.zt-inspector > .zt-detail-empty{height:auto;min-height:180px}}@container(max-width:940px){.zt-columns{grid-template-columns:minmax(0,1fr);height:auto}.zt-ledger{height:min(60dvh,620px);min-height:390px}.zt-inspector{position:static;height:auto;max-height:70dvh;scroll-margin-top:16px}.zt-inspector > .zt-detail-empty{height:auto;min-height:180px}}@media(max-width:600px){.zt-ledger{height:min(56dvh,500px);min-height:300px}.zt-inspector{max-height:calc(100dvh - 32px)}}\n@media (prefers-color-scheme:dark){html:not([data-theme=\"light\"]):not(.light) .zt-workspace{--zt-ink:#e7eff4;--zt-muted:#b5c9d3;--zt-border:#405765;--zt-paper:#1a2d38;--zt-ground:#101e28;--zt-soft:#263e4b;--zt-accent:#92d9e5;--zt-accent-dark:#b2ebf1;--zt-danger:#ffb7b7;--zt-control:#203744;--zt-control-border:#637e8d;--zt-hover:#2a4350;--zt-selected:#274956;--zt-selected-ink:#c3eff2;--zt-primary:#176c80;--zt-primary-hover:#13576b;--zt-active-bg:#503d25;--zt-active-ink:#ffdb9a;--zt-resolved-bg:#21483c;--zt-resolved-ink:#b8e9d3;--zt-closed-bg:#334451;--zt-closed-ink:#d5e2e9;--zt-error-bg:#4b3037;--zt-error-ink:#ffd6d8;color-scheme:dark}}\n:is([data-theme=\"dark\"],.dark) .zt-workspace{--zt-ink:#e7eff4;--zt-muted:#b5c9d3;--zt-border:#405765;--zt-paper:#1a2d38;--zt-ground:#101e28;--zt-soft:#263e4b;--zt-accent:#92d9e5;--zt-accent-dark:#b2ebf1;--zt-danger:#ffb7b7;--zt-control:#203744;--zt-control-border:#637e8d;--zt-hover:#2a4350;--zt-selected:#274956;--zt-selected-ink:#c3eff2;--zt-primary:#176c80;--zt-primary-hover:#13576b;--zt-active-bg:#503d25;--zt-active-ink:#ffdb9a;--zt-resolved-bg:#21483c;--zt-resolved-ink:#b8e9d3;--zt-closed-bg:#334451;--zt-closed-ink:#d5e2e9;--zt-error-bg:#4b3037;--zt-error-ink:#ffd6d8;color-scheme:dark}\n\n/* Signal Desk v2 — premium mineral workspace */\n.zt-workspace{--zt-ink:#182523;--zt-muted:#5c6a66;--zt-border:#d5d9d3;--zt-paper:#fcfbf8;--zt-ground:#f3f1eb;--zt-soft:#e9ece7;--zt-accent:#0d5b5a;--zt-accent-dark:#073f40;--zt-danger:#a9433e;--zt-control:#fff;--zt-control-border:#b9c3bf;--zt-hover:#edf3f0;--zt-selected:#dce9e5;--zt-selected-ink:#123b39;--zt-primary:#0d5b5a;--zt-primary-hover:#073f40;--zt-brass:#a8793f;--zt-success:#32705b;--zt-warning:#9a651f;container-type:inline-size;display:flex;flex-direction:column;min-height:100%;height:100dvh;overflow:hidden;padding:16px 20px;background:var(--zt-ground);color:var(--zt-ink);font:14px/1.55 \"Avenir Next\",\"SF Pro Text\",\"PingFang SC\",\"Noto Sans CJK SC\",sans-serif;text-rendering:optimizeLegibility;font-feature-settings:\"kern\" 1,\"liga\" 1}.zt-workspace ::selection{background:#c8ddd7;color:#102e2d}.zt-workspace :focus-visible{outline:2px solid var(--zt-accent);outline-offset:3px}.zt-workspace :is(.zt-row-side,.zt-list-meta,.zt-meta,.zt-history time,.zt-bug-id-copy){font-variant-numeric:tabular-nums lining-nums}.zt-header{min-height:66px;margin:-16px -20px 14px;padding:10px 20px;border-bottom:1px solid var(--zt-border);background:var(--zt-paper);gap:20px}.zt-heading{gap:11px}.zt-mark{width:36px;height:36px;border-radius:5px;background:var(--zt-ink);color:#fff}.zt-heading h1{font-size:20px;line-height:1.15;font-weight:650;letter-spacing:-.025em}.zt-heading p{margin-top:2px;font-size:12px;color:var(--zt-muted)}.zt-header-actions{gap:8px}.zt-connection{font-size:12px}.zt-connection i{width:7px;height:7px;background:#8d9894}.zt-connection.is-connected i{background:var(--zt-success);box-shadow:0 0 0 3px color-mix(in srgb,var(--zt-success) 14%,transparent)}.zt-button{min-height:36px;padding:7px 12px;border-color:var(--zt-control-border);border-radius:6px;background:var(--zt-control);transition:background-color .16s cubic-bezier(.16,1,.3,1),border-color .16s cubic-bezier(.16,1,.3,1),transform .16s cubic-bezier(.16,1,.3,1)}.zt-button:hover:not(:disabled){background:var(--zt-hover);border-color:color-mix(in srgb,var(--zt-accent) 45%,var(--zt-control-border));transform:translateY(-1px)}.zt-button:active:not(:disabled){transform:translateY(0)}.zt-button-primary{border-color:var(--zt-primary);background:var(--zt-primary);color:#fff;font-weight:650}.zt-button-primary:hover:not(:disabled){border-color:var(--zt-primary-hover);background:var(--zt-primary-hover)}.zt-columns{flex:1;min-height:0;height:auto;display:grid;grid-template-columns:minmax(620px,1.67fr) minmax(440px,1fr);gap:12px;align-items:stretch}.zt-ledger,.zt-inspector{min-height:0;height:100%;border:1px solid var(--zt-border);border-radius:12px;background:var(--zt-paper);box-shadow:none;overflow:hidden}.zt-ledger{display:flex;flex-direction:column}.zt-toolbar{min-height:56px;padding:0 16px;border-bottom:1px solid var(--zt-border);background:color-mix(in srgb,var(--zt-paper) 92%,var(--zt-soft));gap:14px}.zt-tabs{align-self:stretch;display:flex;gap:22px;overflow-x:auto;scrollbar-width:none}.zt-tabs::-webkit-scrollbar{display:none}.zt-tabs button{position:relative;flex:none;height:100%;padding:0 1px;border:0;border-radius:0;background:transparent;color:var(--zt-muted);font-weight:600}.zt-tabs button:hover{color:var(--zt-ink)}.zt-tabs button.is-current{background:transparent;color:var(--zt-ink)}.zt-tabs button.is-current:after{content:\"\";position:absolute;left:0;right:0;bottom:-1px;height:3px;background:var(--zt-accent)}.zt-filters{display:grid;grid-template-columns:minmax(130px,190px) minmax(220px,1fr);gap:10px;padding:13px 16px 10px;border-bottom:0;background:var(--zt-paper)}.zt-filters label{gap:4px}.zt-filters label>span{font-size:11px;color:var(--zt-muted);font-weight:500}.zt-filters :is(input,select){height:36px;border-color:var(--zt-control-border);border-radius:6px;background:var(--zt-control)}.zt-list-meta{min-height:34px;padding:0 16px;border-bottom:1px solid var(--zt-border);background:var(--zt-paper);color:var(--zt-muted);font-size:12px}.zt-loading{min-height:38px;padding:8px 16px;border-bottom:1px solid var(--zt-border);background:var(--zt-selected);color:var(--zt-selected-ink)}.zt-list-scroll{background:var(--zt-paper);scrollbar-color:color-mix(in srgb,var(--zt-accent) 35%,transparent) transparent}.zt-rows{display:block}.zt-row{position:relative;isolation:isolate;width:100%;min-height:106px;padding:18px 16px 14px 20px;border:0;border-bottom:1px solid var(--zt-border);border-radius:0;background:var(--zt-paper);text-align:left;display:grid;grid-template-columns:minmax(0,1fr) minmax(190px,30%);gap:16px;transition:background-color .16s cubic-bezier(.16,1,.3,1)}.zt-row:hover:not(:disabled){background:color-mix(in srgb,var(--zt-paper) 74%,var(--zt-soft))}.zt-row.is-selected{background:var(--zt-selected);box-shadow:inset 3px 0 var(--zt-accent)}.zt-row-signal{position:absolute;z-index:1;left:0;right:0;top:0;height:3px;display:flex;overflow:hidden}.zt-row-signal i{display:block;height:100%}.zt-signal-status{width:42%;background:var(--zt-accent)}.zt-signal-owner{width:43%;background:#83918c}.zt-signal-risk{width:15%;background:var(--zt-border)}.zt-row-status-resolved .zt-signal-status{background:var(--zt-success)}.zt-row-status-closed .zt-signal-status{background:#71807b}.zt-row-status-active .zt-signal-status{background:var(--zt-accent)}.zt-row-pri-1 .zt-signal-risk,.zt-row-severity-1 .zt-signal-risk{background:var(--zt-danger)}.zt-row-pri-2 .zt-signal-risk,.zt-row-severity-2 .zt-signal-risk{background:var(--zt-warning)}.zt-row-main{min-width:0}.zt-row-main strong{font-size:14px;line-height:1.4;font-weight:650;letter-spacing:-.01em}.zt-row-main small{margin-top:7px;color:var(--zt-muted);font-size:12px}.zt-row-side{align-items:flex-end;gap:3px;max-width:none}.zt-row-side>small{font-size:11px;color:var(--zt-muted)}.zt-row-owner{font-weight:500;color:var(--zt-ink)!important}.zt-row-signals{margin-top:auto}.zt-status{min-height:24px;padding:3px 7px;border:1px solid currentColor;border-radius:4px;background:transparent;font-size:11px;font-weight:650}.zt-pager{min-height:44px;padding:6px 16px;border-top:1px solid var(--zt-border);background:var(--zt-paper)}.zt-refresh{min-height:34px;background:var(--zt-paper)}.zt-inspector{overflow:auto;scrollbar-color:color-mix(in srgb,var(--zt-accent) 35%,transparent) transparent}.zt-inspector-content{max-width:none;min-height:100%;padding:0 20px 24px}.zt-inspector-title{position:sticky;z-index:8;top:0;margin:0 -20px;padding:0 20px;min-height:56px;border-bottom:1px solid var(--zt-border);background:color-mix(in srgb,var(--zt-paper) 96%,transparent);box-shadow:0 8px 22px rgba(20,38,35,.06)}.zt-inspector-title h2{font-size:15px;font-weight:650}.zt-close{width:36px;height:36px;border-radius:6px}.zt-detail-heading{padding:20px 0 18px;border-bottom:1px solid var(--zt-border)}.zt-detail-heading>span{color:var(--zt-accent-dark);font-size:12px;font-weight:650}.zt-detail-heading h3{max-width:28em;margin-top:8px;font-size:clamp(18px,1.35vw,23px);line-height:1.3;letter-spacing:-.025em;font-weight:650}.zt-meta{grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:0;padding:14px 0;border-bottom:1px solid var(--zt-border)}.zt-meta div{padding:3px 12px 3px 0}.zt-meta span{font-size:11px;color:var(--zt-muted)}.zt-meta strong{margin-top:4px;font-size:13px;font-weight:600}.zt-detail-actions{position:sticky;z-index:7;top:56px;margin:0 -20px;padding:10px 20px;border-bottom:1px solid var(--zt-border);background:var(--zt-paper);gap:7px;box-shadow:0 7px 18px rgba(20,38,35,.045)}.zt-detail-actions .zt-button{min-height:34px;padding:6px 10px;font-size:12px}.zt-detail-actions .zt-button-primary{order:-1}.zt-detail-section{margin-top:24px;padding-top:0;border-top:0}.zt-detail-section h4{margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--zt-border);font-size:13px;font-weight:700}.zt-body{max-width:75ch;line-height:1.72}.zt-body img{display:block;width:auto;max-width:min(100%,720px);height:auto;max-height:72dvh;object-fit:contain;border-radius:8px;background:var(--zt-soft)}.zt-history{padding:12px 0;border-bottom:1px solid var(--zt-border)}.zt-history-head{gap:12px}.zt-history-head strong{font-size:13px}.zt-history-head time{font-size:11px;color:var(--zt-muted)}.zt-detail-empty{background:var(--zt-paper);color:var(--zt-muted)}.zt-detail-empty svg{color:var(--zt-accent)}.zt-detail-empty h2{margin-top:12px;color:var(--zt-ink);font-size:17px}.zt-detail-empty p{margin-top:5px;font-size:13px}.zt-form{gap:14px}.zt-field>span{font-size:12px;font-weight:600}.zt-field :is(input,select,textarea){border-color:var(--zt-control-border);border-radius:6px;background:var(--zt-control)}.zt-review,.zt-write-hold,.zt-draft-box,.zt-acceptance-draft{border-radius:10px;background:color-mix(in srgb,var(--zt-paper) 70%,var(--zt-soft));box-shadow:none}.zt-notice{border-radius:8px}.zt-media-item{border-radius:7px;background:var(--zt-soft)}.zt-media-thumb,.zt-media-file{border-radius:5px}.zt-media-hover{border-radius:10px;background:var(--zt-paper);box-shadow:0 16px 36px rgba(12,30,28,.18)}.zt-workspace *{scrollbar-width:thin}.zt-workspace ::-webkit-scrollbar{width:10px;height:10px}.zt-workspace ::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:10px;background:color-mix(in srgb,var(--zt-accent) 40%,transparent);background-clip:padding-box}@media(prefers-reduced-motion:reduce){.zt-workspace *{scroll-behavior:auto!important;transition:none!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}@container(max-width:1120px){.zt-workspace{height:auto;min-height:100%;overflow:visible}.zt-columns{grid-template-columns:minmax(0,1fr);height:auto}.zt-ledger{height:min(62dvh,680px);min-height:420px}.zt-inspector{height:auto;min-height:420px;max-height:none}.zt-detail-actions{top:56px}.zt-meta{grid-template-columns:repeat(3,minmax(0,1fr))}}@container(max-width:700px){.zt-workspace{padding:12px;overflow-x:hidden}.zt-header{align-items:flex-start;margin:-12px -12px 12px;padding:12px;flex-direction:column}.zt-header-actions{width:100%;display:flex;gap:6px}.zt-header-actions .zt-connection{order:-1;width:100%}.zt-header-actions .zt-button{min-height:40px}.zt-columns{gap:10px}.zt-ledger{height:min(64dvh,560px);min-height:360px}.zt-toolbar{padding:0 12px;align-items:flex-start;flex-direction:column;gap:0}.zt-toolbar>.zt-header-actions{padding:8px 0}.zt-tabs{width:100%;height:48px;gap:20px}.zt-filters{grid-template-columns:1fr;padding:10px 12px}.zt-list-meta{padding:7px 12px;align-items:flex-start;gap:3px;flex-direction:column}.zt-row{min-height:126px;padding:17px 12px 12px 16px;grid-template-columns:1fr}.zt-row-side{align-items:flex-start;display:grid;grid-template-columns:auto 1fr;gap:4px 10px}.zt-row-signals{grid-column:1/-1}.zt-pager{padding:8px 12px;flex-wrap:wrap}.zt-inspector-content{padding:0 14px 20px}.zt-inspector-title{margin:0 -14px;padding:0 14px}.zt-detail-actions{position:static;margin:0 -14px;padding:10px 14px;box-shadow:none;flex-wrap:wrap}.zt-meta{grid-template-columns:repeat(2,minmax(0,1fr))}.zt-media-pair,.zt-media-preview-grid{grid-template-columns:1fr}.zt-form-grid{grid-template-columns:1fr}.zt-span{grid-column:auto}.zt-body img{max-height:65dvh}}@media(prefers-color-scheme:dark){html:not([data-theme=\"light\"]):not(.light) .zt-workspace{--zt-ink:#edf1ee;--zt-muted:#aab8b3;--zt-border:#35423e;--zt-paper:#17211f;--zt-ground:#101716;--zt-soft:#202d2a;--zt-accent:#79b8b0;--zt-accent-dark:#9ccdc6;--zt-danger:#e69a95;--zt-control:#1d2927;--zt-control-border:#566660;--zt-hover:#243531;--zt-selected:#243c38;--zt-selected-ink:#d8ebe5;--zt-primary:#2c7772;--zt-primary-hover:#3a8c85;--zt-brass:#c5a06a;--zt-success:#79b49a;--zt-warning:#dbb26b;color-scheme:dark}}:is([data-theme=\"dark\"],.dark) .zt-workspace{--zt-ink:#edf1ee;--zt-muted:#aab8b3;--zt-border:#35423e;--zt-paper:#17211f;--zt-ground:#101716;--zt-soft:#202d2a;--zt-accent:#79b8b0;--zt-accent-dark:#9ccdc6;--zt-danger:#e69a95;--zt-control:#1d2927;--zt-control-border:#566660;--zt-hover:#243531;--zt-selected:#243c38;--zt-selected-ink:#d8ebe5;--zt-primary:#2c7772;--zt-primary-hover:#3a8c85;--zt-brass:#c5a06a;--zt-success:#79b49a;--zt-warning:#dbb26b;color-scheme:dark}\n@media(prefers-color-scheme:dark){html:not([data-theme=\"light\"]):not(.light) .zt-mark{background:#0b4a48;color:#edf1ee}}:is([data-theme=\"dark\"],.dark) .zt-mark{background:#0b4a48;color:#edf1ee}\n\n/* Review media is evidence, not a compact attachment list. */\n.zt-review-media{margin-top:24px;padding-top:20px;border-top:1px solid var(--zt-border)}.zt-review-media>h3{font-size:15px;font-weight:650}.zt-review-media>p{margin-top:4px}.zt-media-preview-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;margin:14px 0 0;padding:0;list-style:none}.zt-media-item.is-review{display:block;padding:0;overflow:hidden;border:1px solid var(--zt-border);border-radius:10px;background:var(--zt-paper)}.zt-review-media-visual{display:flex;align-items:center;justify-content:center;width:100%;min-height:320px;max-height:720px;padding:12px;background:var(--zt-soft);text-decoration:none;cursor:zoom-in}.zt-review-media-visual:hover{background:color-mix(in srgb,var(--zt-soft) 78%,var(--zt-selected))}.zt-review-media-visual img{display:block;width:100%;height:auto;max-height:696px;object-fit:contain}.zt-review-media-file{display:grid;place-items:center;min-height:200px;background:var(--zt-soft);color:var(--zt-muted);font-size:18px;font-weight:650;letter-spacing:.06em}.zt-review-media-caption{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline;gap:6px 12px;padding:12px 14px}.zt-review-media-caption b{color:var(--zt-accent-dark);font-size:13px}.zt-review-media-caption>span{min-width:0;overflow-wrap:anywhere}.zt-review-media-caption small{color:var(--zt-muted);white-space:nowrap}.zt-media-item.is-review .zt-media-hover{display:none}@container(max-width:700px){.zt-review-media-visual{min-height:240px;max-height:600px;padding:8px}.zt-review-media-visual img{max-height:584px}.zt-review-media-caption{grid-template-columns:1fr}.zt-review-media-caption small{white-space:normal}}\n\n/* Bug detail images form a complete, numbered evidence sequence. */\n.zt-prose{display:grid;gap:12px}.zt-prose>p{max-width:75ch}.zt-image{display:block;margin:8px 0 20px;overflow:hidden;border:1px solid var(--zt-border);border-radius:10px;background:var(--zt-paper)}.zt-image-link{display:flex;align-items:center;justify-content:center;width:100%;padding:10px;background:var(--zt-soft);text-decoration:none;cursor:zoom-in}.zt-image-link:hover{background:color-mix(in srgb,var(--zt-soft) 78%,var(--zt-selected))}.zt-image-link img,.zt-body .zt-image-link img{display:block;width:100%;height:auto;max-width:100%;max-height:none;object-fit:contain;border-radius:6px;background:transparent}.zt-image figcaption{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:10px 12px;color:var(--zt-muted);font-size:12px}.zt-image figcaption strong{color:var(--zt-ink);font-size:12px}.zt-image-placeholder{display:grid;place-items:center;min-height:180px;padding:24px;background:var(--zt-soft);color:var(--zt-muted)}.zt-image-placeholder button{min-height:36px;border:1px solid var(--zt-control-border);border-radius:6px;background:var(--zt-control);color:var(--zt-ink)}@container(max-width:700px){.zt-image-link{padding:6px}.zt-image figcaption{align-items:flex-start;flex-direction:column;gap:2px}}\n"
    return {
      inject: ['slots'],
      apply(ctx) {
        if (!document.getElementById('dsh-zentao-ledger-style')) {
          const style = document.createElement('style')
          style.id = 'dsh-zentao-ledger-style'
          style.textContent = panelCss
          document.head.append(style)
        }
        function Page() { return h(Ledger, { ctx }) }
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'zentao-ledger' }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'zentao-ledger', order: 15, label: () => '禅道台账' }, Icon))
      }
    }
  }
})
