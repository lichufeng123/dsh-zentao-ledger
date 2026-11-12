// ZenTao groups builds by product/execution. createdBy is the actual creator;
// builder denotes the person responsible for producing a build. The caller must
// provide the verified account, because display names need not be unique.
export function parseCreatorBuilds(data, account) {
    if (!data || typeof data !== 'object' || !data.projectBuilds ||
        typeof account !== 'string' || !account.trim()) throw new Error('buildCreatorUnavailable')
    const rows = new Map()
    function visit(value, depth = 0) {
        if (!value || typeof value !== 'object' || depth > 8) return
        if (/^[1-9]\d*$/.test(String(value.id || '')) && 'createdBy' in value) {
            rows.set(String(value.id), value)
            return
        }
        for (const child of Object.values(value)) visit(child, depth + 1)
    }
    visit(data.projectBuilds)
    const total = Number(data.buildsTotal)
    if (!Number.isSafeInteger(total) || total < 0 || rows.size < total)
        throw new Error('buildCreatorIncomplete')
    const ids = [...rows.values()]
        .filter(
            (row) =>
                String(row.deleted || '0') !== '1' &&
                row.createdBy === account,
        )
        .map((row) => String(row.id))
    return { ids, total: rows.size }
}

export function availableBuildOptions(editor, options) {
    if (!editor.buildCreatorOnly) return options
    const ids = new Set(editor.creatorBuildIds || [])
    return options.filter((option) => ids.has(option.value))
}
