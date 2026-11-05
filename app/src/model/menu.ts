// A blocked agent's choices, read off its screen: the numbered menu it draws, one option per number. Only layouts
// checked against a real run are read; any other program, or a screen without its menu, gives nothing, and the
// phone falls back to the key row rather than guess.
//
// Claude Code 2.1.314, measured 2026-10-31 in a scratch herdr-core session: the menu is "❯ 1. Yes / 2. … / 4. No"
// under the question, the highlighted line marked ❯; pressing an option's digit picks it at once. "No" interrupts
// the tool, and Claude asks "What should Claude do instead?" at its prompt; "Type something." (AskUserQuestion)
// opens its text answer. Both want text next.
export type Option = {
  n: number
  /** The option's first line: what a button shows. */
  label: string
  /** Everything it says, wrapped lines joined and a detail line after " — ": what a long press shows. */
  full: string
  selected: boolean
  /** Picking it asks for text next: the composer takes the focus. */
  typed: boolean
  keys: string[]
}
export type Menu = { question: string; options: Option[] }

const READERS: Record<string, (screen: string) => Menu | undefined> = { 'claude-code': readClaude }

/** The options as the phone shows them: the highlighted one first, then the others in the menu's order. */
export function shownOrder(m: Menu): Option[] {
  return [...m.options.filter((o) => o.selected), ...m.options.filter((o) => !o.selected)]
}

export function readMenu(app: string | null | undefined, screen: string): Menu | undefined {
  const read = app ? READERS[app] : undefined
  return read?.(screen)
}

const OPTION = /^(\s*)(❯\s*)?(\d+)\.\s+(.*)$/
const RULE = /^\s*[─╌━-]{3,}\s*$/
const TYPED = /^No\b|tell Claude|Type something|something else/i

function readClaude(screen: string): Menu | undefined {
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, ''))
  let cursor = -1
  for (let i = lines.length - 1; i >= 0 && cursor < 0; i--) { const m = OPTION.exec(lines[i]); if (m?.[2]) cursor = i }
  if (cursor < 0) return undefined
  // Up from the highlighted line to option 1, over the lines that belong to options.
  let first = cursor
  for (let i = cursor; i >= 0; i--) {
    const m = OPTION.exec(lines[i])
    if (m) { first = i; if (m[3] === '1') break; continue }
    if (!lines[i].trim() || RULE.test(lines[i]) || !/^\s/.test(lines[i])) return undefined
  }
  if (OPTION.exec(lines[first])?.[3] !== '1') return undefined
  const options: Option[] = []
  let col = 0
  for (let i = first; i < lines.length; i++) {
    const line = lines[i]
    const m = OPTION.exec(line)
    if (m && Number(m[3]) === options.length + 1) {
      col = line.length - m[4].length
      options.push({ n: Number(m[3]), label: m[4].trim(), full: m[4].trim(), selected: !!m[2], typed: false, keys: [m[3]] })
      continue
    }
    if (RULE.test(line)) continue
    const indent = line.length - line.trimStart().length
    if (!line.trim() || m || indent < col) break
    // A line under an option: its label wrapped (it goes on in lower case) or a line of detail.
    const o = options[options.length - 1]
    const text = line.trim()
    if (/^[a-z(]/.test(text) && o.full === o.label) { o.label = `${o.label} ${text}`; o.full = o.label }
    else o.full = `${o.full} — ${text}`
  }
  for (const o of options) o.typed = TYPED.test(o.full)
  let question = ''
  for (let i = first - 1; i >= 0 && !question; i--) if (lines[i].trim() && !RULE.test(lines[i])) question = lines[i].trim()
  return { question, options }
}
