export class WriteError extends Error {
    constructor(code, fields = {}) {
        super(code)
        this.code = code
        this.fields = fields
    }
}

export function formOptions(value) {
    if (!value || typeof value !== 'object') return []
    return Object.entries(value)
        .map(([key, label]) => ({
            value: key,
            label:
                typeof label === 'object' && label
                    ? String(label.name || label.title || key)
                    : String(label ?? key),
        }))
        .filter((option) => option.label.trim())
}
const asList = (value) =>
    Array.isArray(value)
        ? value.map(String)
        : String(value || '')
              .split(',')
              .filter(Boolean)
const str = (value, fallback = '') =>
    value === undefined || value === null ? fallback : String(value)
export function newBugEditor(data, mode, id = '') {
    const raw = mode === 'edit' ? data.bug : {}
    if (!raw || typeof raw !== 'object') throw new WriteError('formUnavailable')
    const fields = {
        product: str(
            raw.product ||
                data.productID ||
                formOptions(data.products)[0]?.value,
        ),
        branch: str(raw.branch ?? data.branch, '0'),
        module: str(raw.module ?? data.moduleID, '0'),
        project: str(raw.project ?? data.projectID, '0'),
        execution: str(raw.execution ?? data.executionID, '0'),
        title: str(raw.title),
        assignedTo: str(raw.assignedTo || data.assignedTo),
        severity: str(raw.severity, '3'),
        pri: str(raw.pri, '3'),
        type: str(raw.type, 'codeerror'),
        deadline: str(raw.deadline).slice(0, 10),
        openedBuild: asList(raw.openedBuild || data.buildID),
        descriptionAction: mode === 'create' ? 'replace' : 'keep',
        description: '',
        comment: '',
    }
    if (/^0000-/.test(fields.deadline)) fields.deadline = ''
    return { mode, id, data, raw: { ...raw }, fields }
}
export function editorChoices(editor, key) {
    const data = editor.data
    const assignees =
        editor.mode === 'edit' ? data.assignedToList : data.productMembers
    const map = {
        product: data.products,
        branch: data.branches || data.branchTagOption,
        module: data.moduleOptionMenu,
        project: data.projects,
        execution: data.executions,
        openedBuild: editor.mode === 'edit' ? data.openedBuilds : data.builds,
        assignedTo: formOptions(assignees).length ? assignees : data.users,
    }
    const options = formOptions(map[key])
    if (key === 'openedBuild' && editor.mode === 'edit') {
        for (const value of asList(editor.raw.openedBuild))
            if (!options.some((item) => item.value === value))
                options.push({ value, label: value })
    }
    return options
}
export function applyCreateMetadata(editor, data) {
    const next = { ...editor, data, fields: { ...editor.fields } }
    for (const key of [
        'product',
        'branch',
        'module',
        'project',
        'execution',
        'assignedTo',
    ]) {
        const options = editorChoices(next, key)
        if (
            next.fields[key] &&
            !options.some((item) => item.value === next.fields[key])
        ) {
            next.fields[key] =
                key === 'assignedTo'
                    ? ''
                    : key === 'product'
                      ? String(data.productID || options[0]?.value || '')
                      : '0'
        }
    }
    const builds = new Set(
        editorChoices(next, 'openedBuild').map((item) => item.value),
    )
    next.fields.openedBuild = next.fields.openedBuild.filter((id) =>
        builds.has(id),
    )
    return next
}
export function createFormPath(fields = {}) {
    const numeric = (value) =>
        /^\d+$/.test(String(value ?? 0)) ? String(value ?? 0) : '0'
    const product = numeric(fields.product)
    return `/bug-create-${product}-${numeric(fields.branch)}-productID=${product},moduleID=${numeric(fields.module)},projectID=${numeric(fields.project)},executionID=${numeric(fields.execution)},allBuilds=0,allUsers=0.json`
}
export function validateBugEditor(editor) {
    const f = editor.fields
    const errors = {}
    if (!f.title.trim()) errors.title = 'titleRequired'
    if (f.title.trim().length > 255) errors.title = 'titleTooLong'
    if (!/^[1-9]\d*$/.test(f.product)) errors.product = 'productRequired'
    for (const key of ['product', 'branch', 'module', 'project', 'execution']) {
        const value = f[key]
        if (key !== 'product' && value === '0') continue
        if (editor.mode === 'edit' && String(editor.raw[key] ?? '') === value)
            continue
        if (
            !editorChoices(editor, key).some((option) => option.value === value)
        )
            errors[key] = 'invalidChoice'
    }
    if (!f.openedBuild.length) errors.openedBuild = 'buildRequired'
    const builds = new Set(
        editorChoices(editor, 'openedBuild').map((item) => item.value),
    )
    if (f.openedBuild.some((id) => !builds.has(id)))
        errors.openedBuild = 'invalidChoice'
    if (
        f.assignedTo &&
        !editorChoices(editor, 'assignedTo').some(
            (item) => item.value === f.assignedTo,
        )
    )
        errors.assignedTo = 'invalidChoice'
    if (f.deadline) {
        const parsed = new Date(f.deadline + 'T00:00:00Z')
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(f.deadline) ||
            !Number.isFinite(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== f.deadline
        )
            errors.deadline = 'dateInvalid'
    }
    if (
        !['1', '2', '3', '4'].includes(f.severity) ||
        !['1', '2', '3', '4', '5'].includes(f.pri)
    )
        errors.level = 'invalidChoice'
    if (
        editor.mode === 'edit' &&
        (!/^[1-9]\d*$/.test(editor.id) ||
            typeof editor.raw.lastEditedDate !== 'string')
    )
        errors.form = 'formUnavailable'
    return errors
}
export function escapeDescription(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\r?\n/g, '<br>')
}
export function bugFormBody(editor) {
    const validation = validateBugEditor(editor)
    if (Object.keys(validation).length)
        throw new WriteError('validationFailed', validation)
    const f = editor.fields
    const raw = editor.raw
    const payload = {}
    // Preserve existing, non-exposed associations and workflow state during ordinary edits.
    if (editor.mode === 'edit')
        for (const key of [
            'plan',
            'story',
            'storyVersion',
            'task',
            'toTask',
            'toStory',
            'case',
            'caseVersion',
            'testtask',
            'result',
            'keywords',
            'color',
            'feedbackBy',
            'notifyEmail',
            'issueKey',
            'repo',
            'entry',
            'lines',
            'v1',
            'v2',
            'repoType',
            'status',
            'subStatus',
            'confirmed',
            'resolution',
            'resolvedBy',
            'resolvedBuild',
            'resolvedDate',
            'closedBy',
            'closedDate',
            'duplicateBug',
            'lastEditedDate',
        ])
            if (raw[key] !== undefined && raw[key] !== null)
                payload[key] = String(raw[key])
    for (const key of [
        'product',
        'branch',
        'module',
        'project',
        'execution',
        'assignedTo',
        'severity',
        'pri',
        'type',
        'deadline',
    ])
        payload[key] = f[key]
    payload.title = f.title.trim()
    payload['openedBuild[]'] = f.openedBuild
    for (const key of ['os', 'browser', 'mailto'])
        payload[key + '[]'] = asList(raw[key])
    const original = str(raw.steps)
    payload.steps =
        f.descriptionAction === 'keep'
            ? original
            : f.descriptionAction === 'append'
              ? original + '<p>' + escapeDescription(f.description) + '</p>'
              : '<p>' + escapeDescription(f.description) + '</p>'
    if (editor.mode === 'edit') {
        payload.id = editor.id
        payload.comment = escapeDescription(f.comment)
    }
    return Object.entries(payload)
        .flatMap(([key, value]) =>
            (Array.isArray(value) ? value : [value]).map(
                (item) =>
                    encodeURIComponent(key) +
                    '=' +
                    encodeURIComponent(String(item)),
            ),
        )
        .join('&')
}
export function parseWriteResponse(body, mode, originalId = '') {
    let payload
    try {
        payload = JSON.parse(body)
    } catch {
        throw new WriteError('writeUnknown')
    }
    for (let depth = 0; depth < 3; depth++) {
        if (!payload || typeof payload !== 'object')
            throw new WriteError('writeUnknown')
        if (
            payload.loginExpired ||
            /user-login/.test(String(payload.locate || ''))
        )
            throw new WriteError('writeAuthExpired')
        let inner = payload.data
        if (typeof inner === 'string' && /^[\s]*[{[]/.test(inner)) {
            try {
                inner = JSON.parse(inner)
            } catch {}
        }
        const rejected = [payload.result, payload.status].some(
            (value) => value === 'fail' || value === 'error',
        )
        if (
            !rejected &&
            inner &&
            typeof inner === 'object' &&
            (inner.result || inner.status)
        ) {
            payload = inner
            continue
        }
        const result = rejected ? 'fail' : payload.result || payload.status
        if (result === 'fail' || result === 'error') {
            const message = payload.message
            const fields =
                message && typeof message === 'object'
                    ? Object.fromEntries(
                          Object.entries(message).map(([key, value]) => [
                              key,
                              (Array.isArray(value)
                                  ? value.join('；')
                                  : String(value)
                              )
                                  .replace(/<[^>]*>/g, '')
                                  .slice(0, 500),
                          ]),
                      )
                    : {
                          form:
                              typeof message === 'string' &&
                              !/token=|user-login/i.test(message)
                                  ? message
                                        .replace(/<[^>]*>/g, '')
                                        .slice(0, 500)
                                  : 'serverRejected',
                      }
            throw new WriteError('serverRejected', fields)
        }
        if (result !== 'success') throw new WriteError('writeUnknown')
        const id = String(
            payload.id ||
                (typeof inner === 'string' || typeof inner === 'number'
                    ? inner
                    : '') ||
                (mode === 'edit' ? originalId : ''),
        )
        if (!/^[1-9]\d*$/.test(id)) throw new WriteError('writeUnknown')
        if (mode === 'edit' && id !== originalId)
            throw new WriteError('writeUnknown')
        return { id }
    }
    throw new WriteError('writeUnknown')
}
