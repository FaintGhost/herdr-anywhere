// The web page's side of the app (nsh.json web.host): the app runs inside NSH's runtime and has no `location`,
// `document` or `Notification`, so the page tells it its own address (the companion serves the page, so its origin is
// the computer), takes a used pairing code out of the address bar, says whether it is in front, and posts the
// system's notifications for alerts while it is not.
const front = () => typeof document === 'undefined' || (document.visibilityState === 'visible' && document.hasFocus())
const permission = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

function notify(player, a) {
  if (front() || permission() !== 'granted' || typeof a?.title !== 'string') return false
  const options = { body: a.body ?? undefined, tag: a.terminal ?? undefined }
  try {
    const n = new Notification(a.title, options)
    n.onclick = () => {
      if (typeof focus === 'function') focus()
      n.close()
      if (a.terminal) player.hostEvent('page.open', { terminal: a.terminal })
    }
  } catch {
    // Chrome on Android only posts through a service worker (`new Notification` throws there); its taps open the page.
    navigator.serviceWorker?.ready.then((r) => r.showNotification(a.title, options)).catch(() => {})
  }
  return true
}

export function createHost(player) {
  const functions = new Map([
    ['page.address', () => (typeof location === 'undefined' ? null : { href: location.href, origin: location.origin })],
    ['page.dropPair', () => {
      if (typeof location !== 'undefined' && location.hash.startsWith('#pair=')) history.replaceState(null, '', location.pathname + location.search)
      return null
    }],
    ['page.front', front],
    ['page.notify', (a) => notify(player, a)],
    ['page.notifications', permission],
    // Browsers ask only from a tap, so the app calls this from its Settings button.
    ['page.allowNotifications', () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.requestPermission())],
  ])
  if (typeof document !== 'undefined') {
    let was = front()
    const check = () => {
      const now = front()
      if (now !== was) player.hostEvent('page.front', { front: (was = now) })
    }
    document.addEventListener('visibilitychange', check)
    addEventListener('focus', check)
    addEventListener('blur', check)
  }
  return {
    call(name, args) {
      const f = functions.get(name)
      if (!f) throw new Error(`no host function ${name}`)
      return f(args)
    },
  }
}
