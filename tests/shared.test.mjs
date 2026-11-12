import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupUnresolved, hangingDays } from '../src/shared/report.js'
import { newBugEditor, bugFormBody } from '../src/shared/editor.js'
import { parseCreatorBuilds, availableBuildOptions } from '../src/shared/build-creators.js'

test('same-name developers remain separate, unassigned leads, urgent reports lead each group', () => {
  const bugs = [
    { id: '1', status: 'active', assignedAccount: 'a', assignedTo: '同名', priority: '3', openedDate: '2026-10-01' },
    { id: '2', status: 'active', assignedAccount: 'b', assignedTo: '同名', priority: '1', openedDate: '2026-10-20' },
    { id: '3', status: 'active', assignedAccount: '', assignedTo: '', priority: '3', openedDate: '2026-10-21' },
    { id: '4', status: 'active', assignedAccount: 'a', assignedTo: '同名', priority: '5', openedDate: '2026-10-23' },
    { id: '5', status: 'closed', assignedAccount: 'a', assignedTo: '同名', priority: '1', openedDate: '2026-09-01' }
  ]
  const groups = groupUnresolved(bugs, new Date('2026-11-04T00:00:00+08:00').getTime())
  assert.deepEqual(groups.map(group => group.key), ['', 'a', 'b'])
  assert.deepEqual(groups[1].bugs.map(bug => bug.id), ['4', '1'])
  assert.equal(hangingDays('0000-00-00'), null)
  assert.equal(hangingDays('2026-02-30'), null)
})

test('edit preserves hidden associations and supports keep, append, replace without workflow transitions', () => {
  const data = { bug: { id: '42', product: '1', branch: '0', module: '0', project: '0', execution: '0', title: '原题', assignedTo: 'dev', severity: '3', pri: '2', type: 'codeerror', openedBuild: '7', steps: '<p>原图<img src="/file-read-12.png"></p>', lastEditedDate: '2026-11-01 09:00:00', status: 'active', story: '91', mailto: 'reviewer' }, products: { 1: '产品' }, openedBuilds: { 7: '版本' }, assignedToList: { dev: '研发' } }
  const editor = newBugEditor(data, 'edit', '42')
  const base = new URLSearchParams(bugFormBody(editor))
  assert.equal(base.get('steps'), data.bug.steps)
  assert.equal(base.get('story'), '91')
  assert.equal(base.get('lastEditedDate'), data.bug.lastEditedDate)
  assert.equal(base.get('status'), 'active')
  editor.fields.descriptionAction = 'append'; editor.fields.description = '补充 < 说明'
  assert.match(new URLSearchParams(bugFormBody(editor)).get('steps'), /原图<img[^>]+><\/p><p>补充 &lt; 说明<\/p>/)
  editor.fields.descriptionAction = 'replace'
  assert.equal(new URLSearchParams(bugFormBody(editor)).get('steps'), '<p>补充 &lt; 说明</p>')
})

test('creator filter uses createdBy and preserves selected builds outside filtered candidates', () => {
  const metadata = { users: { owner: 'Alice', builder: 'Casey' }, projectBuilds: { group: [{ id: '8', createdBy: 'owner', builder: 'builder' }, { id: '9', createdBy: 'builder', builder: 'owner' }] }, buildsTotal: 2 }
  assert.deepEqual(parseCreatorBuilds(metadata, 'owner').ids, ['8'])
  assert.deepEqual(availableBuildOptions({ buildCreatorOnly: true, creatorBuildIds: ['8'] }, [{ value: '8' }, { value: '9' }]), [{ value: '8' }])
  assert.deepEqual(parseCreatorBuilds({ ...metadata, users: { owner: 'Alice', duplicate: 'Alice' } }, 'owner').ids, ['8'])
  assert.throws(() => parseCreatorBuilds({ ...metadata, buildsTotal: 3 }, 'owner'), /buildCreatorIncomplete/)
})
