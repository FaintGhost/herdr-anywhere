// The progress page's model over `herdr-anywhere track tree --json`: one nestable structure, the task.
// Version one is view only: the page shows, the computer decides.
import { expect, test } from 'nsh/test'
import { agentsLine, findTask, flagsOf, items, langLine, parseAgents, pathOf, pickLine, stageText, subLine, taskOn, trackLine, type Task } from './progress.ts'
import { parseTree } from './progress.ts'

// Real output of `track tree --json` for the sample scene: fixtures/make-tree-v2.sh writes it.
const real = async () => parseTree(JSON.stringify((await import('../../fixtures/tree-v2.json')).default))

test('the tree reads: what needs the user, what just finished, and tasks with the tasks under them', async () => {
  const t = await real()
  expect(t.needsYou.map((x) => [x.id, x.group, x.waiting])).toEqual([['T6', 'waiting', '价格取整，还是保留到分？']])
  expect(t.justDone.map((x) => [x.id, x.said ?? '', x.path])).toEqual([
    ['T2', '', ['上线 Acme 商店的新结账流程', '让顾客能保存银行卡']], ['P2', '对比写好了，等你看', []]])
  expect(t.tasks.map((x) => x.id)).toEqual(['P1'])
  expect(t.tasks[0].children.map((x) => x.id)).toEqual(['T1', 'T5', 'T6', 'T9'])
  expect(t.tasks[0].children[0].children.map((x) => [x.id, x.group])).toEqual([['T2', 'done'], ['T3', 'parked'], ['T4', 'parked']])
  expect(t.tasks[0].children[1].pane_rows).toEqual([]) // null in the JSON
  expect(t.queue).toBe(0)
  expect(parseTree('{}')).toEqual({ needsYou: [], justDone: [], tasks: [], closed: [], queue: 0, organizerWaits: undefined })
  expect(parseTree('{"queue":2,"organizer_waits":{"addr":"t8"}}').organizerWaits).toEqual({ addr: 't8' })
})

test('a card says the stage in the phone\'s words and, under it, why it waits or the agent\'s words', async () => {
  const t = await real()
  const p1 = t.tasks[0]
  // Stages come as codes; the phone words them (English here: tests run in English unless they say).
  expect(stageText('parked')).toBe('Queued')
  expect(stageText('waiting')).toBe('Waiting on you')
  expect(stageText('done')).toBe('Done')
  expect(subLine(p1.children[2])).toBe('价格取整，还是保留到分？')
  expect(subLine(p1.children[1])).toBe('等银行卡的活做完再跑 · 你说过：跑完告诉我')
  expect(items(p1.children[0])).toEqual([
    { done: true, text: '加上银行卡表单' }, { done: false, text: '输入时就校验卡号' }, { done: false, text: '让顾客能删掉存过的卡' }])
})

test('a task is found anywhere in the tree, with the titles above it', async () => {
  const t = await real()
  expect(findTask(t, 'T3')?.outcome).toBe('输入时就校验卡号')
  expect(pathOf(t, 'T3')).toEqual(['上线 Acme 商店的新结账流程', '让顾客能保存银行卡'])
  expect(pathOf(t, 'P2')).toEqual([])
  expect(findTask(t, 'nope')).toBe(undefined)
})

// herdr-core only: `--herdr -` keeps track from asking old Herdr for its agent list on the user's computer.
test('commands run the companion from where the README installs it, else from PATH, with every argument quoted', () => {
  const b = `b="$HOME/.local/bin/herdr-anywhere"; [ -x "$b" ] || b=herdr-anywhere; "$b"`
  expect(trackLine(['tree', "P'1"])).toBe(`${b} track 'tree' 'P'\\''1' '--herdr' '-'`)
  expect(agentsLine()).toBe(`${b} progress 'agents'`)
  // Picking the filing agent turns filing on in the same go.
  expect(pickLine('pi', 'ja')).toBe(`${b} progress 'organizer' '--agent' 'pi' '--lang' 'ja' && "$b" progress 'on'`)
  expect(langLine('zh-Hant')).toBe(`${b} progress 'lang' 'zh-Hant'`)
})

test('the agents to pick from: the ones that can be picked first', () => {
  const a = parseAgents(JSON.stringify({ agents: [{ id: 'codex', name: 'Codex', cmd: 'codex', usable: false, note: 'needs 0.163 or later', needs: '0.163', version: '0.150.0' }, { id: 'pi', name: 'Pi', cmd: 'pi', usable: true }], chosen: 'pi' }))
  expect(a).toEqual({ agents: [{ id: 'pi', name: 'Pi', usable: true, note: '', needs: '', version: '' }, { id: 'codex', name: 'Codex', usable: false, note: 'needs 0.163 or later', needs: '0.163', version: '0.150.0' }], chosen: 'pi' })
  expect(parseAgents('{}')).toEqual({ agents: [], chosen: '' })
})

test('the agent list says which task a pane is on: the open one it was last handed and still works on', async () => {
  const t = await real()
  expect(taskOn(t, 't2')?.id).toBe('T9') // T1 was handed on to the receipt email task
  expect(taskOn(t, 't4')?.id).toBe('T6')
  expect(taskOn(t, 't3')).toBe(undefined) // P2 is done
})

// The computer sends each pane's row; the phone words what is wrong in its language (track.go flags the same cases).
test('what is wrong with a task\'s panes is worded on the phone', () => {
  const task = (rows: Task['pane_rows']): Task => ({ id: 'T1', outcome: 'x', stage: 'doing', group: 'stuck', evidence: [], pane_rows: rows, notes: [], children: [], done: 0, total: 1 })
  expect(flagsOf(task([{ id: 't2', name: 'phone', state: 'live', status: 'blocked', msg: 'approve Bash: git push' }]))).toEqual(['phone asks: approve Bash: git push'])
  expect(flagsOf(task([{ id: 't2', state: 'live', status: 'blocked' }]))).toEqual(['t2 is waiting on you'])
  expect(flagsOf(task([{ id: 't2', name: 'api', state: 'live', status: 'idle', quiet: true, quiet_for_ms: 2 * 3_600_000 }]))).toEqual(['api: no new turn in 2h since handed this'])
  expect(flagsOf(task([{ id: 't3', state: 'missing' }, { id: 't4', state: 'live', status: 'blocked', handed_on: true }]))).toEqual(["Can't find t3"])
  expect(subLine(task([{ id: 't2', name: 'phone', state: 'live', status: 'error' }]))).toBe('phone hit an error')
})

