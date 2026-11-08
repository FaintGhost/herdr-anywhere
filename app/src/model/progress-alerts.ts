// Notifications from the progress tree (model/progress.ts): one per task that newly needs the user. "Done, please
// check" notifications stop for a top-level task whose last ones the user ignored, the way xiaok/hermes-autonomous mutes a
// category after three ignored messages in 30 days (its README). "Waiting on you" always rings: an agent
// is stopped until the user answers.
import type { Task, Tree } from './progress.ts'
import { t } from '../strings/index.ts'

export type Alert = { task: string; goal: string; kind: 'wait' | 'review'; title: string; body: string }
type Sent = { task: string; goal: string; kind: string; at: number; opened?: number }

const DAY = 86_400_000
const WINDOW = 30 * DAY
const SEEN_WITHIN = 3_600_000 // opened within an hour: seen
const IGNORED_TO_MUTE = 3

/** What happened to each notification sent: opened in time, or not. Kept on the phone, 30 days. */
export class Outcomes {
  private items: Sent[] = []

  static from(s: string | null): Outcomes {
    const o = new Outcomes()
    try { const v = JSON.parse(s ?? '[]'); if (Array.isArray(v)) o.items = v.filter((x) => x && typeof x.task === 'string' && typeof x.at === 'number') } catch {}
    return o
  }

  sent(a: { task: string; goal: string; kind: string }, at: number) { this.items.push({ task: a.task, goal: a.goal, kind: a.kind, at }) }

  /** The user opened the task: the latest notification for it counts as seen if this is within the hour. */
  opened(task: string, at: number) {
    const s = [...this.items].reverse().find((x) => x.task === task && x.opened === undefined)
    if (s) s.opened = at
  }

  muted(goal: string, kind: string, now: number): boolean {
    if (kind !== 'review') return false
    const ignored = this.items.filter((x) => x.goal === goal && x.kind === kind && now - x.at <= WINDOW && now - x.at > SEEN_WITHIN
      && (x.opened === undefined || x.opened - x.at > SEEN_WITHIN))
    return ignored.length >= IGNORED_TO_MUTE
  }

  list(): Sent[] { return this.items }

  save(now: number): string {
    this.items = this.items.filter((x) => now - x.at <= WINDOW)
    return JSON.stringify(this.items)
  }
}

// A task under others: the titles above it, then its own name. A top-level task: its name, then the agent's words.
function body(task: Task, top: boolean): string {
  if (task.group === 'waiting') return t('alertWaiting', { text: task.waiting || task.outcome })
  if (task.group === 'done') return t('alertDone', { text: (top && task.said) || task.outcome })
  const text = (top && task.said) || task.outcome
  return t('alertReview', { text: task.evidence.length ? t('withEvidence', { text, evidence: task.evidence[0] }) : text })
}

/** The notifications for going from `prev` to `next`: none on the first reading, which was already there. */
export function alertsFor(prev: Tree | null, next: Tree, o: Outcomes, now: number): Alert[] {
  if (!prev) return []
  const before = new Set([...prev.needsYou, ...prev.justDone].map((t) => `${t.id} ${t.group}`))
  const out: Alert[] = []
  for (const t of [...next.needsYou, ...next.justDone]) {
    if (before.has(`${t.id} ${t.group}`)) continue
    const kind = t.group === 'waiting' ? 'wait' : 'review'
    const path = t.path ?? []
    const goal = path[0] ?? t.id // muted per top-level task
    if (o.muted(goal, kind, now)) continue
    const a: Alert = { task: t.id, goal, kind, title: path.join(' › ') || t.outcome, body: body(t, !path.length) }
    o.sent(a, now)
    out.push(a)
  }
  return out
}
