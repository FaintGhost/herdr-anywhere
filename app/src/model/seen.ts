// "New since you looked": herdr-core keeps no time or position for a terminal's output (its schema has neither), so
// the phone keeps, per pane, when you last looked and the last lines you saw. Opened again, the pane's history is
// replayed (terminal.attach `history`); the line after the lines you saw, found again, is where the new output starts.
// Lines no longer in the history (cleared, scrolled out) give no mark.

import { formats, t } from '../strings/index.ts'

const TAIL = 4

/** The last few lines with text: what was on screen when you looked. */
export function tailOf(lines: string[]): string[] {
  return lines.map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-TAIL)
}

/** The index in `lines` of the first line with text after the last place `tail` appears; undefined when it doesn't, or
 *  nothing came after it. */
export function findSince(lines: string[], tail: string[]): number | undefined {
  if (!tail.length) return undefined
  const want = tail.map((l) => l.trimEnd())
  const text = lines.map((l, i) => ({ l: l.trimEnd(), i })).filter((x) => x.l.trim())
  for (let end = text.length - 1; end >= want.length - 1; end--) {
    let ok = true
    for (let k = 0; k < want.length && ok; k++) ok = text[end - k].l === want[want.length - 1 - k]
    if (ok) return end + 1 < text.length ? text[end + 1].i : undefined
  }
  return undefined
}

const two = (n: number) => String(n).padStart(2, '0')

/** "New since you looked, 14:02", with the day when it was not today. */
export function sinceLabel(at: number, now: number): string {
  const d = new Date(at)
  const n = new Date(now)
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`
  const today = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  return t('newSince', { when: today ? time : `${formats().monthDay(d.getMonth(), d.getDate())} ${time}` })
}
