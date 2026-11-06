// One pane's terminal on the phone: the web page's messages in, herdr-core's stream out.
import { expect, test } from 'nsh/test'
import { Store } from '../store.ts'
import { FakeCore, settle } from '../testing/fakecore.ts'
import { TerminalSession } from './terminal-session.ts'
import { sinceLabel } from '../model/seen.ts'

async function setup() {
  const cores = [new FakeCore(), new FakeCore()]
  let n = 0
  const timers: (() => void)[] = []
  const store = new Store({ pipe: () => cores[n++], setInterval: (() => 0) as any, clearInterval: (() => {}) as any,
    setTimeout: ((f: () => void) => { timers.push(f); return 0 }) as any })
  await store.connect()
  const r = await store.newSpace({})
  const posted: any[] = []
  const s = new TerminalSession(store, r.terminal, (m) => posted.push(JSON.parse(m)), (f) => { queueMicrotask(f); return 1 })
  return { core: cores[0], cores, store, r, s, posted, timers }
}

test('the page saying ready attaches at its size; output reaches the page after a reset', async () => {
  const { core, r, s, posted } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 61, rows: 19 }))
  await settle()
  const at = core.calls.find((c) => c.method === 'terminal.attach')!.params
  expect([at.terminal, at.cols, at.rows]).toEqual([r.terminal, 61, 19])
  core.output(r.terminal, 'hello')
  await settle()
  expect(posted.map((m) => m.t)).toEqual(['reset', 'write', 'write'])
  expect(posted.slice(1).map((m) => m.data).join('')).toBe(`\x1b[H\x1b[2J${r.terminal}$ hello`)
  expect(s.state.get()).toBe('live')
})

test('typing goes to the terminal; Ctrl from the key bar applies to the next key only', async () => {
  const { core, s } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  s.page(JSON.stringify({ t: 'input', data: 'ls\r' }))
  s.toggleCtrl()
  expect(s.ctrl.get()).toBe(true)
  s.page(JSON.stringify({ t: 'input', data: 'c' }))
  s.page(JSON.stringify({ t: 'input', data: 'c' }))
  await settle()
  expect(core.written.map((w) => w.data)).toEqual(['ls\r', '\x03', 'c'])
  expect(s.ctrl.get()).toBe(false)
})

test('a key from the bar with Ctrl held asks the page for the combination, once', async () => {
  const { s, posted } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  s.toggleCtrl()
  s.key('enter')
  s.key('enter')
  await settle()
  const keys = posted.filter((m: any) => m.t === 'key')
  expect(keys).toEqual([{ t: 'key', name: 'enter', ctrl: true }, { t: 'key', name: 'enter' }])
  expect(s.ctrl.get()).toBe(false)
})

test('a new page size resizes the terminal', async () => {
  const { core, s } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  s.page(JSON.stringify({ t: 'size', cols: 40, rows: 30 }))
  await settle()
  expect(core.resized.map((x) => [x.cols, x.rows])).toEqual([[40, 30]])
})

test('a terminal that ends says why', async () => {
  const { core, r, s } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  core.finish(r.terminal, 'exited')
  await settle()
  expect(s.state.get()).toBe('ended')
  expect(s.why.get()).toBe('The program exited.')
})

test('after the line comes back the terminal attaches again as resumed', async () => {
  const { cores, r, s, store, timers } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  // The second core plays the same computer after the reconnect: it has the terminal.
  cores[1].terms.set(r.terminal, { ...cores[0].terms.get(r.terminal)! })
  cores[1].docs = cores[0].docs
  cores[0].drop('network')
  await settle()
  expect(s.state.get()).toBe('lost')
  timers.shift()!()
  await settle(30)
  expect(store.conn.get()).toBe('ready')
  const again = cores[1].calls.find((c) => c.method === 'terminal.attach')
  expect(again?.params.resumed).toBe(true)
  expect(s.state.get()).toBe('live')
})

// herdr-core, measured 2026-11-06 with two viewers: attaching as resumed leaves the size with the other viewer, and focus
// takes it. A phone in use that kept the Mac's 33 columns after a dropped line wrapped everything at them.
async function backAfterLoss(before: (store: Store) => void) {
  const { cores, r, s, store, timers } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 48, rows: 40 }))
  await settle()
  before(store)
  await settle()
  cores[1].terms.set(r.terminal, { ...cores[0].terms.get(r.terminal)! })
  cores[1].docs = cores[0].docs
  cores[0].drop('network')
  await settle()
  timers.shift()!()
  await settle(30)
  expect(store.conn.get()).toBe('ready')
  return cores[1].focused.length
}

test('a terminal on the phone screen takes the size back when the line returns, touched or not', async () => {
  expect(await backAfterLoss(() => {})).toBe(1)
})

test('a phone with the app in the background leaves the size with the computer when the line returns', async () => {
  expect(await backAfterLoss((store) => { store.appActive = false })).toBe(0)
})

test('copy asks the page for its text and gives it back; paste goes through the page so bracketed paste holds', async () => {
  const { s, posted } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  const copied = s.copy()
  expect(posted.at(-1)).toEqual({ t: 'copy' })
  s.page(JSON.stringify({ t: 'copied', text: 'on screen' }))
  expect(await copied).toBe('on screen')
  s.paste('echo pasted')
  expect(posted.at(-1)).toEqual({ t: 'paste', data: 'echo pasted' })
})

test('peeking watches without taking the size: observe on attach, no resize after', async () => {
  const { core, store, r } = await setup()
  const posted: any[] = []
  const s = new TerminalSession(store, r.terminal, (m) => posted.push(m), (f) => { queueMicrotask(f); return 1 }, { observe: true })
  s.page(JSON.stringify({ t: 'ready', cols: 50, rows: 20 }))
  await settle()
  expect(core.calls.filter((c) => c.method === 'terminal.attach').at(-1)!.params.observe).toBe(true)
  s.page(JSON.stringify({ t: 'size', cols: 40, rows: 10 }))
  await settle()
  expect(core.resized).toEqual([])
})

test("the page's gestures reach the app: flick, link, selection and tap", async () => {
  const { store, r } = await setup()
  const seen: any[] = []
  const s = new TerminalSession(store, r.terminal, () => {}, (f) => { queueMicrotask(f); return 1 }, { on: {
    swipe: (d) => seen.push(['swipe', d]), link: (u) => seen.push(['link', u]),
    selected: (t) => seen.push(['selected', t]), tap: () => seen.push(['tap']) } })
  for (const m of [{ t: 'swipe', dir: 'prev' }, { t: 'link', url: 'https://example.com' }, { t: 'selected', text: 'abc' }, { t: 'tap' }])
    s.page(JSON.stringify(m))
  expect(seen).toEqual([['swipe', 'prev'], ['link', 'https://example.com'], ['selected', 'abc'], ['tap']])
})

test('scrolled back, the page says so; latest takes it to the bottom', async () => {
  const { s, posted } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  expect(s.away.get()).toBe(false)
  s.page(JSON.stringify({ t: 'away', away: true }))
  expect(s.away.get()).toBe(true)
  s.bottom()
  await settle()
  expect(posted.at(-1)).toEqual({ t: 'bottom' })
})

test('opened again, the line after what you last saw is marked new, with when you looked; leaving keeps what you saw', async () => {
  const { store, r, s, posted } = await setup()
  const at = Date.now() - 60_000
  store.saw(r.terminal, ['$ npm test', 'PASS a'], at)
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  // The page has drawn the replayed history: the session asks for its text, then marks the first new line.
  s.page(JSON.stringify({ t: 'tail', lines: ['$ git status', 'On branch main'] }))
  await settle()
  const asked = () => posted.filter((m) => m.t === 'text' || m.t === 'mark')
  expect(asked()).toEqual([{ t: 'text' }])
  s.page(JSON.stringify({ t: 'text', base: 10, lines: ['$ npm test', 'PASS a', '$ git status', 'On branch main'] }))
  await settle()
  expect(asked()).toEqual([{ t: 'text' }, { t: 'mark', line: 12, label: sinceLabel(at, Date.now()) }])
  // Only once per opening.
  s.page(JSON.stringify({ t: 'tail', lines: ['$ git status', 'On branch main', '$ ls'] }))
  await settle()
  expect(posted.filter((m) => m.t === 'text').length).toBe(1)
  s.dispose()
  expect(store.lastSeen(r.terminal)?.tail).toEqual(['$ git status', 'On branch main', '$ ls'])
})

test('a pane never looked at before gets no mark', async () => {
  const { s, posted } = await setup()
  s.page(JSON.stringify({ t: 'ready', cols: 80, rows: 24 }))
  await settle()
  s.page(JSON.stringify({ t: 'tail', lines: ['x'] }))
  await settle()
  expect(posted.filter((m) => m.t === 'text' || m.t === 'mark').length).toBe(0)
})
