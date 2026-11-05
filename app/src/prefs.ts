// This phone's own settings (herdr-app's Look and Alerts sections), kept in the app's storage.
import { Signal } from './store.ts'

export type Appearance = 'system' | 'light' | 'dark'
export type Prefs = { appearance: Appearance; fontSize: number; alertBlocked: boolean; alertDone: boolean; stayConnected: boolean; askedNotifications: boolean }
export const DEFAULTS: Prefs = { appearance: 'system', fontSize: 13, alertBlocked: true, alertDone: true, stayConnected: true, askedNotifications: false }
import { FONT_MAX, FONT_MIN } from './ui/terminal-page.ts'
export { FONT_MAX, FONT_MIN }

export class PrefStore {
  readonly prefs = new Signal<Prefs>(DEFAULTS)
  constructor(private io: { load: (k: string) => Promise<string | null>; save: (k: string, v: string) => void }) {}

  async load() {
    const v = await this.io.load('prefs')
    if (!v) return
    try {
      const p = JSON.parse(v)
      this.prefs.set(clean({ ...DEFAULTS, ...p }))
    } catch {}
  }

  set(change: Partial<Prefs>) {
    const p = clean({ ...this.prefs.get(), ...change })
    this.prefs.set(p)
    this.io.save('prefs', JSON.stringify(p))
  }
}

function clean(p: Prefs): Prefs {
  return {
    appearance: (['system', 'light', 'dark'] as const).includes(p.appearance) ? p.appearance : 'system',
    fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(Number(p.fontSize) || DEFAULTS.fontSize))),
    alertBlocked: p.alertBlocked !== false,
    alertDone: p.alertDone !== false,
    stayConnected: p.stayConnected !== false,
    askedNotifications: p.askedNotifications === true,
  }
}
