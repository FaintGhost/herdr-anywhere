// The progress page's data: tasks, each with the tasks under it, from `herdr-anywhere track tree --json`
// (companion/internal/track/goals.go), read through herdr-core's machine.exec. Nothing here is stored on the phone.
// Version one is view only: the computer files and judges every task; the phone only reads.
// Words: stages and flags come as codes and pane rows, worded here; titles and questions are written by the sorting
// agent in the phone's language, which the phone tells the computer (pickLine, langLine).
import { t, type Key } from '../strings/index.ts'
import { duration } from './agents.ts'

export type PaneRow = {
  id?: string; found?: boolean; state?: string; status?: string; name?: string; turns_since?: number; handed_on?: boolean; no_status?: boolean
  quiet?: boolean; quiet_for_ms?: number; msg?: string
}
export type Task = {
  id: string; outcome: string; stage: string; group: string; waiting?: string; next?: string; auto?: boolean; std?: string
  parent?: string; said?: string; evidence: string[]; pane_rows: PaneRow[]; updated?: number
  notes: { at: number; text: string }[]; children: Task[]; done: number; total: number
  /** Only on "needs you" rows: the titles above it. */
  path?: string[]
}
export type Tree = {
  needsYou: Task[]
  /** Finished in the last day, newest first, each with the titles above it. */
  justDone: Task[]
  tasks: Task[]; closed: Task[]; queue: number
  /** The filing pane is up but reports no status (a trust dialog or a login screen) while something waits for it. */
  organizerWaits?: { addr: string }
}

const list = <T>(v: unknown, f: (x: any) => T): T[] => (Array.isArray(v) ? v.map(f) : [])
const task = (x: any): Task => ({
  ...x, flags: undefined, evidence: list(x.evidence, String), pane_rows: list(x.pane_rows, (p) => p),
  notes: list(x.notes, (n) => n), children: list(x.children, task), done: x.done ?? 0, total: x.total ?? 0,
})

export function parseTree(s: string): Tree {
  const v = JSON.parse(s) ?? {}
  return {
    needsYou: list(v.needs_you, (x) => ({ ...task(x), path: list(x.path, String) })),
    justDone: list(v.just_done, (x) => ({ ...task(x), path: list(x.path, String) })),
    tasks: list(v.tasks, task), closed: list(v.closed, task), queue: typeof v.queue === 'number' ? v.queue : 0,
    organizerWaits: v.organizer_waits && typeof v.organizer_waits.addr === 'string' ? { addr: v.organizer_waits.addr } : undefined,
  }
}

// Stages come from the computer as codes (companion/internal/track); the phone words them.
const STAGE_KEY: Record<string, Key> = {
  waiting: 'stageWaiting', stuck: 'stageStuck', review: 'stageReview', doing: 'stageDoing', parked: 'stageParked', done: 'stageDone', dropped: 'stageDropped',
}
export const stageText = (group: string) => (STAGE_KEY[group] ? t(STAGE_KEY[group]) : group)
export const closed = (group: string) => group === 'done' || group === 'dropped'

/** What is wrong with a task's panes, worded on the phone from each pane's row (what track.go flags). */
export function flagsOf(task: Task): string[] {
  const out: string[] = []
  for (const p of task.pane_rows) {
    if (p.handed_on) continue
    const pane = p.name || p.id || '?'
    if (p.state === 'live' && p.status === 'blocked') out.push(p.msg ? t('flagAsks', { pane, msg: p.msg }) : t('flagBlocked', { pane }))
    else if (p.state === 'live' && p.status === 'error') out.push(t('flagError', { pane }))
    else if (p.quiet) out.push(t('flagQuiet', { pane, age: duration(p.quiet_for_ms ?? 0) }))
    else if (p.no_status) out.push(t('flagNoStatus', { pane }))
    else if (p.state === 'missing') out.push(t('flagMissing', { pane }))
  }
  return out
}

/** The line under a task's title: what it waits on, what is wrong, the agent's last words, or what comes next. */
export function subLine(task: Task): string {
  return task.waiting || flagsOf(task)[0] || task.said || task.next || ''
}

/** A task's own tasks as ✓/· lines. */
export function items(t: Task): { done: boolean; text: string }[] {
  return t.children.filter((c) => c.group !== 'dropped').map((c) => ({ done: c.group === 'done', text: c.outcome }))
}

function walk(ts: Task[], f: (t: Task, above: Task[]) => boolean, above: Task[] = []): boolean {
  for (const t of ts) if (f(t, above) || walk(t.children, f, [...above, t])) return true
  return false
}

export function findTask(tr: Tree, id: string): Task | undefined {
  let found: Task | undefined
  walk([...tr.tasks, ...tr.closed], (t) => (t.id === id ? ((found = t), true) : false))
  return found
}

/** The titles of the tasks above `id`, top first. */
export function pathOf(tr: Tree, id: string): string[] {
  let path: string[] = []
  walk([...tr.tasks, ...tr.closed], (t, above) => (t.id === id ? ((path = above.map((a) => a.outcome)), true) : false))
  return path
}

/** Every open task with its depth, for picking where something goes. */
export function flat(tr: Tree): { task: Task; depth: number }[] {
  const out: { task: Task; depth: number }[] = []
  const go = (ts: Task[], d: number) => { for (const t of ts) if (!closed(t.group)) { out.push({ task: t, depth: d }); go(t.children, d + 1) } }
  go(tr.tasks, 0)
  return out
}

/** The open task a pane works on now: the deepest one handed to it and not handed on since. */
export function taskOn(tr: Tree, addr: string): Task | undefined {
  let best: { task: Task; depth: number } | undefined
  for (const r of flat(tr)) if (r.task.pane_rows.some((p) => p.id === addr && !p.handed_on) && (!best || r.depth > best.depth)) best = r
  return best?.task
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
// Where the README installs the companion; a shell started by machine.exec may not have ~/.local/bin on PATH.
const BIN = `b="$HOME/.local/bin/herdr-anywhere"; [ -x "$b" ] || b=herdr-anywhere; "$b"`

/** A `herdr-anywhere track` command for herdr-core only: `--herdr -` skips old Herdr's agent list. */
export function trackLine(args: string[]): string {
  return `${BIN} track ${[...args, '--herdr', '-'].map(q).join(' ')}`
}

/** Turns the computer's filing (the companion's progress loop) on or off with the page. */
export function switchLine(on: boolean): string {
  return `${BIN} progress ${q(on ? 'on' : 'off')}`
}

/** The agents on the computer that can sort what the user says. */
export function agentsLine(): string {
  return `${BIN} progress ${q('agents')}`
}

/** Makes `id` the sorting agent, writing in the phone's language `lang`, and turns sorting on. */
export function pickLine(id: string, lang: string): string {
  return `${BIN} progress ${q('organizer')} ${q('--agent')} ${q(id)} ${q('--lang')} ${q(lang)} && "$b" progress ${q('on')}`
}

/** Tells the computer the phone's language changed: what the sorting agent writes in. */
export function langLine(lang: string): string {
  return `${BIN} progress ${q('lang')} ${q(lang)}`
}

/** `needs` and `version`: an agent too old to report its status, so the phone says so in its own language. */
export type AgentChoice = { id: string; name: string; usable: boolean; note: string; needs: string; version: string }

export function parseAgents(s: string): { agents: AgentChoice[]; chosen: string } {
  const v = JSON.parse(s) ?? {}
  const agents = list(v.agents, (a) => ({ id: String(a.id), name: String(a.name ?? a.id), usable: a.usable === true, note: typeof a.note === 'string' ? a.note : '',
    needs: typeof a.needs === 'string' ? a.needs : '', version: typeof a.version === 'string' ? a.version : '' }))
  return { agents: [...agents.filter((a) => a.usable), ...agents.filter((a) => !a.usable)], chosen: typeof v.chosen === 'string' ? v.chosen : '' }
}

export type View = { name: 'home' } | { name: 'task'; id: string }

/** The live pane working on a task: the last one it was handed to that is still there. */
export function paneOf(task: Task): { addr: string; name?: string } | undefined {
  const p = [...task.pane_rows].reverse().find((p) => p.found && p.state === 'live' && !p.handed_on)
  return p?.id ? { addr: p.id, name: p.name } : undefined
}
