/** A folder as the desktop shows it: `~` for home. macOS reports /var and /tmp under /private, home may be either. */
export function shortPath(p: string, home: string): string {
  if (!home) return p
  for (const h of [home, '/private' + home]) if (p === h || p.startsWith(h + '/')) return '~' + p.slice(h.length)
  return p
}
