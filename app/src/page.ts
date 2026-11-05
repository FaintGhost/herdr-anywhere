// The web page the app runs in (web-host.js): its address, and dropping a used pairing code from it. Elsewhere, none.
import { host } from 'nsh'

export type Page = { href: string; origin: string }

export async function pageAddress(): Promise<Page | null> {
  if (!host.available()) return null
  try {
    const p: any = await host.call('page.address')
    return typeof p?.href === 'string' && typeof p?.origin === 'string' && /^https?:/.test(p.origin) ? p : null
  } catch {
    return null
  }
}

export function dropPairFromPage() {
  if (host.available()) host.call('page.dropPair').catch(() => {})
}

/** The browser's word for the system's notifications: what the person allowed, or "unsupported" (no page, no API). */
export type Permission = 'granted' | 'denied' | 'default' | 'unsupported'
const permission = (p: unknown): Permission => (p === 'granted' || p === 'denied' || p === 'default' ? p : 'unsupported')

export async function notifications(): Promise<Permission> {
  if (!host.available()) return 'unsupported'
  return host.call('page.notifications').then(permission, () => 'unsupported' as const)
}

export async function allowNotifications(): Promise<Permission> {
  if (!host.available()) return 'unsupported'
  return host.call('page.allowNotifications').then(permission, () => 'unsupported' as const)
}

/** Posts the system's notification for an alert; the page posts it only while it is not in front. A finished agent's
 *  (`done`) is the quieter kind where the host has one (Android: a channel without sound). */
export function notifyFromPage(n: { title: string; body?: string; terminal?: string; kind: 'blocked' | 'done' }) {
  if (host.available()) host.call('page.notify', { title: n.title, body: n.body ?? null, terminal: n.terminal ?? null, kind: n.kind }).catch(() => {})
}

/** Follows whether the page is in front (`front`), and taps on its notifications (`open`). Returns the stop. */
export function followPage(on: { front: (front: boolean) => void; open: (terminal: string) => void }): () => void {
  if (!host.available()) return () => {}
  host.call('page.front').then((f) => { if (typeof f === 'boolean') on.front(f) }, () => {})
  const a = host.on('page.front', (d: any) => { if (typeof d?.front === 'boolean') on.front(d.front) })
  const b = host.on('page.open', (d: any) => { if (typeof d?.terminal === 'string') on.open(d.terminal) })
  return () => { a(); b() }
}
