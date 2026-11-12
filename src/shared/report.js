export const REPORT_STATUSES = ['active', 'all', 'resolved', 'board', 'closed']

export function reportStatus(value) {
    return REPORT_STATUSES.includes(value) ? value : 'active'
}

export function submittedPath(userId, page) {
    if (!/^[1-9]\d*$/.test(String(userId))) throw new Error('Invalid reporter')
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page')
    return `/user-bug-${userId}-openedBy-id_desc-0-50-${page}.json`
}

export function filterReportBugs(bugs, status) {
    const scope = reportStatus(status)
    return scope === 'all'
        ? bugs
        : bugs.filter(
              (bug) => bug.status === (scope === 'board' ? 'active' : scope),
          )
}

export function hangingDays(openedDate, now = Date.now()) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(openedDate || '')
    if (!match || Number(match[1]) < 1970) return null
    const date = Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
    )
    const parsed = new Date(date)
    if (
        parsed.getUTCMonth() !== Number(match[2]) - 1 ||
        parsed.getUTCDate() !== Number(match[3])
    )
        return null
    const today = new Date(now)
    return Math.max(
        0,
        Math.floor(
            (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
                date) /
                86400000,
        ),
    )
}

export function searchReports(bugs, query) {
    const needle = query.trim().toLowerCase()
    return needle
        ? bugs.filter((bug) =>
              [bug.id, bug.title, bug.product, bug.assignedTo]
                  .join(' ')
                  .toLowerCase()
                  .includes(needle),
          )
        : bugs
}

export function groupUnresolved(bugs, now = Date.now()) {
    const groups = new Map()
    for (const bug of bugs.filter((item) => item.status === 'active')) {
        const key = bug.assignedAccount || ''
        if (!groups.has(key))
            groups.set(key, {
                key,
                name: bug.assignedTo || '',
                bugs: [],
                oldest: 0,
            })
        const group = groups.get(key)
        group.bugs.push(bug)
        group.oldest = Math.max(
            group.oldest,
            hangingDays(bug.openedDate, now) || 0,
        )
    }
    for (const group of groups.values())
        group.bugs.sort((a, b) => {
            const urgency = (bug) =>
                bug.priority === '5' || bug.priority === '1'
                    ? 0
                    : Number(bug.priority) || 9
            return (
                urgency(a) - urgency(b) ||
                (hangingDays(b.openedDate, now) || 0) -
                    (hangingDays(a.openedDate, now) || 0) ||
                Number(b.id) - Number(a.id)
            )
        })
    return [...groups.values()].sort(
        (a, b) =>
            Number(Boolean(a.key)) - Number(Boolean(b.key)) ||
            b.oldest - a.oldest ||
            b.bugs.length - a.bugs.length ||
            a.name.localeCompare(b.name),
    )
}

// A status may first occur on a later server page. Record the LAST scanned page.
export async function loadReportPage(fetchPage, page, status) {
    const scope = reportStatus(status)
    for (;;) {
        const result = await fetchPage(page)
        if (
            result.page !== page ||
            !Number.isSafeInteger(result.pages) ||
            result.pages < page
        )
            throw new Error('Invalid pagination response')
        const bugs = filterReportBugs(result.bugs, scope)
        if (bugs.length || page === result.pages) return { ...result, bugs }
        page++
    }
}
