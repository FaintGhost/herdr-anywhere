// TailPocket on a phone: the native bridge the app's host project attaches (ios/Sources/App.swift, android
// MainActivity), through TailPocket's NSH client (third_party/tailpocket-8ae23dd/sdk/js). It keeps the computer's
// link, which holds the phone's private key, in the Keychain / Android Keystore under one slot.
import { tailPocket } from '../../third_party/tailpocket-8ae23dd/sdk/js/nsh.ts'
import type { Tunnel } from './link.ts'

/** What `herdr-anywhere pair` starts its invites with (companion/internal/tailcat Prefix); TailPocket's own differs. */
export const PREFIX = 'herdr1:'
const SLOT = 'herdr'

export const nativeTunnel: Tunnel = {
  async pair(invite, device) {
    const decoded = await tailPocket.decodeInvite(invite, PREFIX)
    const link = await tailPocket.pair(decoded, { device, save: true, slot: SLOT })
    return link.payload ?? ''
  },
  scan: () => tailPocket.scan(PREFIX),
  async connect() {
    const c = await tailPocket.connect({ slot: SLOT })
    return { baseUrl: c.baseUrl, close: () => void c.close().catch(() => {}), path: () => c.path() }
  },
  forget: () => void tailPocket.store.deleteLink(SLOT).catch(() => {}),
}
