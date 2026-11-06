// Whether a new version is out, and installing it. The computer asks GitHub (companion/internal/update); the phone asks
// only the computer, and reaches GitHub only to download the app when the person says so.
import manifest from '../nsh.json'
import { Signal, type Conn } from './store.ts'
import { t } from './strings/index.ts'

export const APP_VERSION: string = (manifest as any).version

export type { Conn }
export type AppFile = { url: string; digest: string; bytes: number }
export type CompanionInfo = { version: string; latest: string; knowsReleases: boolean; canUpdate: boolean; autoUpdate: boolean; app: AppFile | null }
/** What the person can do now: one at a time, the computer first, so the app keeps its connection while that happens. */
export type Notice = { kind: 'computer' | 'computerByHand' | 'app' | 'rebuild'; version: string }
export type InstallResult = 'installing' | 'needsPermission'

const parts = (v: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '')
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Version a comes after b. Anything that isn't numbers, such as a developer's build, is never newer or older. */
export function newer(a: string, b: string): boolean {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** What to tell the person about a refused install: Android's words, unless plainer ones exist. */
export function installProblem(message: string): string {
  return message.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE') ? t('updateWrongKey') : message
}

function readInfo(body: any): CompanionInfo | null {
  if (typeof body?.version !== 'string' || !body.version) return null
  const a = body.app
  return {
    version: body.version,
    latest: typeof body.latest === 'string' ? body.latest : '',
    knowsReleases: 'latest' in body,
    canUpdate: body.canUpdate === true,
    autoUpdate: body.autoUpdate === true,
    app: typeof a?.url === 'string' && typeof a?.digest === 'string' ? { url: a.url, digest: a.digest, bytes: Number(a.bytes) || 0 } : null,
  }
}

export class Updates {
  readonly info = new Signal<CompanionInfo | null>(null)
  readonly busy = new Signal<'computer' | 'app' | null>(null)
  /** How much of the app has downloaded, 0 to 1. */
  readonly progress = new Signal(0)
  private off?: () => void

  constructor(private d: {
    baseUrl: () => Promise<string>
    token: () => string
    conn: Signal<Conn>
    fetcher: typeof fetch
    os: string
    appVersion: string
    toast: (t: { title: string; body?: string; level: 'info' | 'error' }) => void
    install: (app: AppFile, progress: (done: number) => void) => Promise<InstallResult>
    /** How long the computer gets to come back as the new version. */
    waitMs?: number
  }) {}

  start() {
    this.off = this.d.conn.sub((c) => { if (c === 'ready') void this.refresh() })
    if (this.d.conn.get() === 'ready') void this.refresh()
  }

  stop() {
    this.off?.()
    this.off = undefined
  }

  async refresh() {
    try {
      const r = await this.d.fetcher(`${await this.d.baseUrl()}/api/info`)
      const info = r.ok ? readInfo(await r.json()) : null
      if (info) this.info.set(info)
    } catch {}
  }

  notice(): Notice | null {
    const i = this.info.get()
    if (!i) return null
    // A companion from before it knew of releases: the app knows at least of itself.
    if (!i.knowsReleases) return newer(this.d.appVersion, i.version) ? { kind: 'computerByHand', version: this.d.appVersion } : null
    if (newer(i.latest, i.version)) return { kind: i.canUpdate ? 'computer' : 'computerByHand', version: i.latest }
    if (!newer(i.latest, this.d.appVersion)) return null
    if (this.d.os === 'android') return i.app ? { kind: 'app', version: i.latest } : null
    if (this.d.os === 'ios') return { kind: 'rebuild', version: i.latest }
    return null
  }

  private post(path: string, body?: string) {
    return this.d.baseUrl().then((base) => this.d.fetcher(`${base}${path}`, {
      method: 'POST', body, headers: { authorization: `Bearer ${this.d.token()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    }))
  }

  async updateComputer() {
    if (this.busy.get()) return
    this.busy.set('computer')
    try {
      const r = await this.post('/api/update')
      const body: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error ?? t('refusedStatus', { status: r.status }))
      const version = String(body.version ?? '')
      if (await this.comesBackAs(version)) this.d.toast({ title: t('computerUpdated', { version }), level: 'info' })
      else this.d.toast({ title: t('couldntUpdateComputer'), body: t('computerNotBack', { version }), level: 'error' })
    } catch (e: any) {
      this.d.toast({ title: t('couldntUpdateComputer'), body: e?.message, level: 'error' })
    } finally {
      this.busy.set(null)
    }
  }

  /** The computer restarts as the new file, and the connection comes back by itself. */
  private async comesBackAs(version: string): Promise<boolean> {
    const until = Date.now() + (this.d.waitMs ?? 60_000)
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, Math.min(1000, this.d.waitMs ?? 1000)))
      if (this.d.conn.get() !== 'ready') continue
      await this.refresh()
      if (this.info.get()?.version === version) return true
    }
    return false
  }

  async updateApp() {
    const app = this.info.get()?.app
    if (this.busy.get() || !app) return
    this.busy.set('app')
    this.progress.set(0)
    try {
      const r = await this.d.install(app, (done) => this.progress.set(done))
      if (r === 'needsPermission') this.d.toast({ title: t('allowInstallTitle'), body: t('allowInstallDetail'), level: 'info' })
    } catch (e: any) {
      this.d.toast({ title: t('couldntUpdateApp'), body: installProblem(String(e?.message ?? '')), level: 'error' })
    } finally {
      this.busy.set(null)
    }
  }

  async setAuto(on: boolean) {
    const r = await this.post('/api/update/auto', JSON.stringify({ on }))
    const i = this.info.get()
    if (r.ok && i) this.info.set({ ...i, autoUpdate: on })
  }
}
