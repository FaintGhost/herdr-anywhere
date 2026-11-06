// The page's side of alerts (web-host.js) over a stand-in browser: whether the page is in front, and the system's
// notifications it posts while it is not.
import { expect, test } from 'nsh/test'
import { createHost } from './web-host.js'

function browser(permission = 'granted') {
  const listeners = new Map<string, (() => void)[]>()
  const on = (type: string, f: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), f])
  const fire = (type: string) => { for (const f of listeners.get(type) ?? []) f() }
  const posted: any[] = []
  const page = { visibilityState: 'visible', focused: true }
  class FakeNotification {
    static permission = permission
    static requestPermission = async () => { FakeNotification.permission = 'granted'; return 'granted' }
    onclick: (() => void) | null = null
    closed = false
    constructor(public title: string, public options: any) { posted.push(this) }
    close() { this.closed = true }
  }
  const g = globalThis as any
  g.document = { get visibilityState() { return page.visibilityState }, hasFocus: () => page.focused, addEventListener: on }
  g.addEventListener = on
  g.focus = () => {}
  g.Notification = FakeNotification
  const events: { name: string; data: any }[] = []
  const host = createHost({ hostEvent: (name: string, data: any) => events.push({ name, data }) })
  return { host, page, fire, posted, events, Notification: FakeNotification }
}

test('the page says whether it is in front, and tells the app when that changes', () => {
  const b = browser()
  expect(b.host.call('page.front')).toBe(true)
  b.page.visibilityState = 'hidden'
  b.fire('visibilitychange')
  b.fire('blur')
  b.page.visibilityState = 'visible'
  b.fire('visibilitychange')
  expect(b.events).toEqual([{ name: 'page.front', data: { front: false } }, { name: 'page.front', data: { front: true } }])
})

test('a page in another tab posts the notification; tapping it brings the page and the agent back', () => {
  const b = browser()
  b.page.visibilityState = 'hidden'
  expect(b.host.call('page.notify', { title: 'Claude Code needs you', body: 'api / fix login', terminal: 't1' })).toBe(true)
  expect(b.posted.map((n) => [n.title, n.options.body, n.options.tag])).toEqual([['Claude Code needs you', 'api / fix login', 't1']])
  b.posted[0].onclick()
  expect(b.posted[0].closed).toBe(true)
  expect(b.events).toEqual([{ name: 'page.open', data: { terminal: 't1' } }])
})

test('a page in front, or one the person did not allow, posts nothing', () => {
  const front = browser()
  expect(front.host.call('page.notify', { title: 'x', terminal: 't1' })).toBe(false)
  expect(front.posted).toEqual([])
  const denied = browser('denied')
  denied.page.focused = false
  expect(denied.host.call('page.notify', { title: 'x', terminal: 't1' })).toBe(false)
  expect(denied.posted).toEqual([])
})

test('the app reads and asks for the permission through the page', async () => {
  const b = browser('default')
  expect(b.host.call('page.notifications')).toBe('default')
  expect(await b.host.call('page.allowNotifications')).toBe('granted')
  expect(b.host.call('page.notifications')).toBe('granted')
  delete (globalThis as any).Notification
  expect(b.host.call('page.notifications')).toBe('unsupported')
})

test('new words for a posted notification replace it without a sound; a closed one stays closed', () => {
  const b = browser()
  b.page.visibilityState = 'hidden'
  b.host.call('page.notify', { title: 'Claude Code finished', body: 'Sky color reply', terminal: 't1' })
  expect(b.host.call('page.notify', { title: 'Claude Code finished', body: 'replied', terminal: 't1', quiet: true })).toBe(true)
  expect(b.posted.map((n) => [n.options.body, n.options.tag, !!n.options.silent])).toEqual([['Sky color reply', 't1', false], ['replied', 't1', true]])
  b.posted[1].onclick()
  expect(b.host.call('page.notify', { title: 'Claude Code finished', body: 'later', terminal: 't1', quiet: true })).toBe(false)
  expect(b.posted.length).toBe(2)
})
