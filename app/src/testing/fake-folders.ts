// The companion's folder calls (GET/POST /api/folders) over a made-up home, for tests and the demo fixture: the
// answers have the companion's shapes (companion/internal/server/folders.go).
import type { FolderApi, Listing, Missing } from '../model/folders.ts'

export class FakeFolders implements FolderApi {
  private dirs = new Set<string>()
  private git: Set<string>
  readonly created: string[] = []
  /** While set, answers wait for release(): a test of answers that come back late. */
  delay = false
  private waiting: (() => void)[] = []

  constructor(private home: string, folders: string[], git: string[] = []) {
    for (const f of folders) this.add(`${home}/${f}`)
    this.add(home)
    this.git = new Set(git.map((g) => `${home}/${g}`))
  }

  private add(path: string) {
    for (let p = path; p && p !== '/'; p = p.slice(0, p.lastIndexOf('/')) || '/') this.dirs.add(p)
    this.dirs.add('/')
  }

  release() { for (const w of this.waiting.splice(0)) w() }

  private abs(path: string) {
    const p = path.trim()
    const a = p === '' || p === '~' ? this.home : p.startsWith('~/') ? this.home + p.slice(1) : p
    return a.length > 1 ? a.replace(/\/+$/, '') : a
  }

  async list(path: string, hidden = false): Promise<Listing | Missing> {
    if (this.delay) await new Promise<void>((r) => this.waiting.push(r))
    const p = this.abs(path)
    if (!this.dirs.has(p)) {
      let e = p
      do e = e.slice(0, e.lastIndexOf('/')) || '/'; while (!this.dirs.has(e))
      return { missing: true, path: p, existing: e }
    }
    const prefix = p === '/' ? '/' : `${p}/`
    const folders = [...this.dirs]
      .filter((d) => d.startsWith(prefix) && d !== p && !d.slice(prefix.length).includes('/'))
      .map((d) => ({ name: d.slice(prefix.length), git: this.git.has(d), ...(d.slice(prefix.length).startsWith('.') ? { hidden: true } : {}) }))
      .filter((f) => hidden || !f.hidden)
      .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
    return { path: p, home: this.home, parent: p.slice(0, p.lastIndexOf('/')) || '/', git: this.git.has(p), folders }
  }

  async create(path: string): Promise<string> {
    const p = this.abs(path)
    this.created.push(p)
    this.add(p)
    return p
  }
}
