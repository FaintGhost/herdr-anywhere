// A space's badge colour, as herdr-app's spaces list picks it (defaults/mods/spaces/main.js, MARK and render()):
// one strong colour per hue, the same in light and dark; each space takes the least-used one in the palette's order,
// and the home space "~" takes none of its own (it shows the first). The desktop keeps its picks in its shared
// settings, which the phone does not read, so after spaces close and open the two can differ.
export const MARK = { ansi6: '#22a99a', ansi3: '#e3814f', ansi4: '#5b8def', ansi5: '#8b7cf6', ansi2: '#3fae6a', ansi1: '#d9649a' } as const
const PALETTE = ['ansi6', 'ansi3', 'ansi4', 'ansi5', 'ansi2', 'ansi1'] as const

/** What follows a space's name (gitTail of defaults/mods/spaces): "repo · branch", without the repo when the space is
 * named after it and without the branch when it is the space's name, main or master. */
export function gitTail(spaceName: string, g: { top: string; branch?: string } | undefined): string {
  if (!g) return ''
  const same = (a: string) => a.toLowerCase() === spaceName.toLowerCase()
  const raw = g.branch ?? ''
  const name = g.top.replace(/\/+$/, '').split('/').pop() ?? ''
  const branch = same(raw) || raw === 'main' || raw === 'master' ? '' : raw
  const repo = same(name) ? '' : name
  return [repo, branch].filter(Boolean).join(' · ')
}

export function spaceMarks(spaces: { id: string; name: string }[]): Record<string, string> {
  const kept: Record<string, (typeof PALETTE)[number]> = {}
  const uses = (c: string) => Object.values(kept).filter((v) => v === c).length
  for (const s of spaces) if (s.name !== '~') kept[s.id] = PALETTE.reduce((best, c) => (uses(c) < uses(best) ? c : best))
  return Object.fromEntries(spaces.map((s) => [s.id, MARK[kept[s.id] ?? 'ansi6']]))
}
