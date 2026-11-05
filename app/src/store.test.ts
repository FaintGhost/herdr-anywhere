import { expect, test } from 'nsh/test'
import { Store } from './store.ts'
import { FakeCore, settle } from './testing/fakecore.ts'
import { panes, terminalOf } from './model/layout.ts'
import { spaceActiveTab } from './model/model.ts'

function setup(core = new FakeCore()) {
  let now = 1_000_000
  const timers: (() => void)[] = []
  const saved = new Map<string, string>()
  const store = new Store({
    pipe: () => core,
    setInterval: (() => 0) as any,
    clearInterval: (() => {}) as any,
    setTimeout: ((f: () => void) => { timers.push(f); return 0 }) as any,
    now: () => now,
    load: async (k) => saved.get(k) ?? null,
    save: (k, v) => saved.set(k, v),
  })
  return { core, store, timers, saved, advance: (ms: number) => { now += ms } }
}

test('connecting reads the environment, the machines and an empty layout', async () => {
  const { core, store } = setup()
  await store.connect()
  expect(store.conn.get()).toBe('ready')
  expect(store.home).toBe('/Users/sam')
  expect(store.shell).toBe('/bin/zsh')
  expect(core.calls.map((c) => c.method).slice(0, 4)).toEqual(['events.subscribe', 'machine.exec', 'machine.list', 'doc.get'])
  expect(store.model.spaces).toEqual([])
})

test('a new space starts a kept, labeled terminal and writes the shared layout', async () => {
  const { core, store } = setup()
  await store.connect()
  const r = await store.newSpace({ argv: ['claude'], task: 'fix the login bug' })
  await settle()
  const run = core.calls.find((c) => c.method === 'terminal.run')!.params
  expect(run.keep).toBe(true)
  expect(run.env).toEqual({ TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'herdr' })
  expect(run.labels).toEqual({ 'herdr.space': r.space, 'herdr.tab': r.tab })
  expect(run.argv).toEqual(['/bin/zsh', '-ic', '"$@"; exec "$0" -i', '/bin/zsh', 'claude', 'fix the login bug'])
  const doc = core.doc()
  expect(doc.spaces.length).toBe(1)
  expect(doc.spaces[0].id).toBe(r.space)
  expect(doc.spaces[0].folder).toBe('/Users/sam')
  expect(doc.spaces[0].tabs[0].root.children[0].content).toEqual({ terminal: r.terminal })
  expect(r.space.startsWith('sp') && r.tab.startsWith('tb') && r.pane.startsWith('p')).toBe(true)
})

test('a layout written by another screen replaces ours, keeping our focus where it still applies', async () => {
  const { core, store } = setup()
  await store.connect()
  const a = await store.newSpace({})
  const b = await store.splitPane(a.pane, 'right')
  store.focusPane(a.pane)
  await settle()
  const doc = core.doc()
  doc.spaces[0].name = 'renamed elsewhere'
  core.writeDoc(doc)
  await settle(10)
  expect(store.model.spaces[0].name).toBe('renamed elsewhere')
  expect(store.model.focusedPane()).toBe(a.pane)
  expect(panes(store.model.tabs()[0].root).map((n) => n.id)).toEqual([a.pane, b.pane])
})

test('a stale write loses to the other screen and says so', async () => {
  const { core, store } = setup()
  await store.connect()
  await store.newSpace({ name: 'mine' })
  await settle()
  // Another screen changes the document; our next write is based on the old version.
  const other = JSON.parse(JSON.stringify(core.doc()))
  other.spaces[0].name = 'theirs'
  const d = core.docs.get('')!
  core.docs.set('', { value: other, version: d.version + 1 })
  store.renameSpace(store.model.spaces[0].id, 'mine again')
  await settle(10)
  expect(store.model.spaces[0].name).toBe('theirs')
  expect(store.toasts.get().map((t) => t.title)).toEqual(['Layout changed elsewhere'])
})

test('a labeled terminal started elsewhere gets a pane, and is kept', async () => {
  const { core, store } = setup()
  await store.connect()
  const t = core.run({ argv: ['codex'], labels: { 'herdr.space': 'spX', 'herdr.tab': 'tbX' }, cwd: '/src/api' })
  await settle(10)
  const s = store.model.space('spX')!
  expect(s.folder).toBe('/src/api')
  expect(s.tabs[0].id).toBe('tbX')
  expect(store.model.paneOf(t.address) !== undefined).toBe(true)
  expect(core.terms.get(t.address)!.keep).toBe(true)
  await settle(5)
  expect(core.doc().spaces[0].id).toBe('spX')
})

test('needing you rings, finishing unseen rings, the first listing does not', async () => {
  const core = new FakeCore()
  const pre = core.run({ argv: ['claude'], labels: { 'herdr.space': 's0', 'herdr.tab': 'c0' } })
  core.setStatus(pre.address, 'blocked')
  core.docs.set('', { version: 1, value: { spaces: [{ id: 's0', name: '', folder: '/x', tabs: [{ id: 'c0', name: '', root: { id: 'c0', type: 'row', children: [{ id: 'x0', type: 'block', content: { terminal: pre.address } }] } }] }] } })
  const { store } = setup(core)
  const rung: string[] = []
  store.onAlert = (k, t) => rung.push(`${k}:${t.title}`)
  await store.connect()
  expect(rung).toEqual([])
  const r = await store.newSpace({ argv: ['claude'] })
  await settle()
  core.setStatus(r.terminal, 'working')
  await settle()
  core.setStatus(r.terminal, 'blocked')
  await settle()
  core.setStatus(r.terminal, 'working')
  await settle()
  core.setStatus(r.terminal, 'idle')
  await settle()
  expect(rung).toEqual(['blocked:Claude Code needs you', 'done:Claude Code finished'])
  expect(store.statusOf(r.terminal)).toBe('done')
  // Looking at it makes it idle.
  store.viewingTab = true
  store.sync()
  expect(store.statusOf(r.terminal)).toBe('idle')
})

test('closing a pane ends its terminal; a pane whose terminal ended goes away', async () => {
  const { core, store, advance } = setup()
  await store.connect()
  const a = await store.newSpace({})
  const b = await store.splitPane(a.pane, 'down')
  await settle()
  store.closePane(b.pane)
  await settle()
  expect(core.terms.get(b.terminal)!.state).toBe('finished')
  expect(panes(store.model.tabs()[0].root).length).toBe(1)
  const c = await store.splitPane(a.pane, 'right')
  core.finish(c.terminal)
  advance(6000)
  await settle(10)
  store.sync()
  await settle(10)
  expect(panes(store.model.tabs()[0].root).map((n) => terminalOf(n))).toEqual([a.terminal])
})

test('closing the last tab closes its space; the agents list follows status', async () => {
  const { core, store } = setup()
  await store.connect()
  const r = await store.newSpace({ argv: ['claude'] })
  core.setStatus(r.terminal, 'working')
  await settle()
  expect(store.agents().map((a) => [a.address, a.status, a.programName])).toEqual([[r.terminal, 'working', 'Claude Code']])
  expect(store.counts()).toEqual({ agents: 1, needsYou: 0 })
  store.closeTab(r.tab)
  await settle()
  expect(store.model.spaces).toEqual([])
  expect(core.doc()).toEqual({ spaces: [] })
})

test('losing the line reconnects and resubscribes', async () => {
  const cores = [new FakeCore(), new FakeCore()]
  let n = 0
  const timers: (() => void)[] = []
  const store = new Store({ pipe: () => cores[n++], setInterval: (() => 0) as any, clearInterval: (() => {}) as any,
    setTimeout: ((f: () => void) => { timers.push(f); return 0 }) as any })
  await store.connect()
  cores[0].drop('network')
  await settle()
  expect(store.conn.get()).toBe('reconnecting')
  timers.shift()!()
  await settle(20)
  expect(store.conn.get()).toBe('ready')
  expect(cores[1].calls.some((c) => c.method === 'events.subscribe')).toBe(true)
})

test("a computer that refuses at once has Herdr's companion stopped; one that never answers is asleep or away", async () => {
  let now = 1_000_000
  let mode: 'refuse' | 'silent' = 'refuse'
  const pipe = () => {
    const c = new FakeCore()
    // Refused: the socket closes at once. Silent: it closes after the connect times out.
    c.send = () => { if (mode === 'silent') now += 20_000; c.drop('network') }
    return c
  }
  const timers: (() => void)[] = []
  const store = new Store({ pipe, now: () => now, setInterval: (() => 0) as any, clearInterval: (() => {}) as any,
    setTimeout: ((f: () => void) => { timers.push(f); return 0 }) as any })
  await store.connect().catch(() => {})
  await settle()
  expect(store.conn.get()).toBe('reconnecting')
  expect(store.error.get()).toBe("The computer answers, but Herdr Anywhere's companion isn't running there. Start it; this reconnects by itself.")
  mode = 'silent'
  timers.shift()!()
  await settle(20)
  expect(store.error.get()).toBe("The computer doesn't answer: it may be asleep, off, or on another network. Trying again…")
})

test('while the line is down, the state shown says how old it is', async () => {
  let now = 1_000_000
  const cores = [new FakeCore(), new FakeCore()]
  let n = 0
  const store = new Store({ pipe: () => cores[n++], now: () => now, setInterval: (() => 0) as any, clearInterval: (() => {}) as any,
    setTimeout: (() => 0) as any })
  await store.connect()
  expect(store.staleFor()).toBe(undefined)
  cores[0].drop('network')
  await settle()
  now += 4 * 60_000
  expect(store.staleFor()).toBe(4 * 60_000)
})

test('a new space or tab is placed once, though herdr-core reports its terminal before terminal.run answers', async () => {
  const { core, store } = setup()
  await store.connect()
  core.holding.add('terminal.run')
  const made = store.newSpace({ folder: '/Users/sam/src/api' })
  await settle(20)
  core.release()
  const r = await made
  await settle(20)
  expect(store.model.spaces.filter((p) => p.id === r.space).length).toBe(1)
  const tab = store.newTab({ space: r.space })
  await settle(20)
  core.release()
  const t = await tab
  await settle(20)
  expect(store.model.space(r.space)!.tabs.filter((c) => c.id === t.tab).length).toBe(1)
  expect(store.model.space(r.space)!.tabs.length).toBe(2)
})

test('a sub-agent kept from peek becomes a tab of its own beside its parent', async () => {
  const { core, store } = setup()
  await store.connect()
  const r = await store.newSpace({ argv: ['claude'] })
  const kid = core.run({ argv: ['codex'], parent: r.terminal })
  await settle()
  await store.keepTerminal(kid.address)
  await settle()
  const s = store.model.space(r.space)!
  expect(s.tabs.length).toBe(2)
  expect(core.terms.get(kid.address)!.labels['herdr.space']).toBe(r.space)
  expect(store.model.paneOf(kid.address) !== undefined).toBe(true)
})

test('a computer that forgot this phone stops the retries and asks to pair again, connected or not', async () => {
  const { core, store, timers } = setup()
  await store.connect()
  core.drop('unpaired')
  await settle()
  expect(store.conn.get()).toBe('unpaired')
  expect(store.error.get()).toBe('This computer no longer knows this phone. Pair it again.')
  expect(timers.length).toBe(0)
  // Refused while saying hello: the same.
  const refusing = new FakeCore()
  refusing.send = () => refusing.drop('unpaired')
  const s2 = setup(refusing)
  await s2.store.connect().catch(() => {})
  await settle()
  expect(s2.store.conn.get()).toBe('unpaired')
  expect(s2.timers.length).toBe(0)
})

test('losing the line says what went wrong in words, and keeps retrying', async () => {
  const words: string[] = []
  for (const reason of ['no-core', 'network', 'binary-unsupported']) {
    const { core, store, timers } = setup()
    await store.connect()
    core.drop(reason)
    await settle()
    words.push(store.error.get())
    expect(timers.length).toBe(1)
  }
  expect(words).toEqual([
    "herdr-core isn't installed on the computer. Install it there; this reconnects by itself.",
    'Lost the computer. Reconnecting…',
    'Switching to a slower connection…',
  ])
})

test('alerts the person turned off neither ring nor show', async () => {
  const { core, store } = setup()
  const rung: string[] = []
  store.onAlert = (k) => rung.push(k)
  store.wants = (k) => k !== 'blocked'
  await store.connect()
  const r = await store.newSpace({ argv: ['claude'] })
  await settle()
  for (const st of ['working', 'blocked', 'working', 'idle']) { core.setStatus(r.terminal, st); await settle() }
  expect(rung).toEqual(['done'])
  expect(store.toasts.get().map((t) => t.title)).toEqual(['Claude Code finished'])
})

test("a pane's folder shows its git branch and how far it is ahead and behind", async () => {
  const core = new FakeCore()
  core.git.set('/src/api', '# branch.oid 1\n# branch.head feature/login\n# branch.ab +2 -1\n')
  const { store } = setup(core)
  await store.connect()
  const r = await store.newSpace({ folder: '/src/api' })
  store.sync()
  await settle(10)
  expect(store.model.folderInfo.get(r.terminal)).toEqual({ top: '/src/api', branch: 'feature/login', ahead: 2, behind: 1 })
})

test('a second terminal in a folder looked up a moment ago gets the branch too, without asking git again', async () => {
  const core = new FakeCore()
  core.git.set('/src/api', '# branch.oid 1\n# branch.head feature/login\n')
  const { store } = setup(core)
  await store.connect()
  const a = await store.newSpace({ folder: '/src/api' })
  store.sync()
  await settle(10)
  const b = await store.newSpace({ folder: '/src/api' })
  store.sync()
  await settle(10)
  expect(store.model.folderInfo.get(a.terminal)?.branch).toBe('feature/login')
  expect(store.model.folderInfo.get(b.terminal)?.branch).toBe('feature/login')
  expect(core.calls.filter((c) => c.method === 'machine.exec' && c.params.line.startsWith('git ')).length).toBe(1)
})

test("a blocked agent's toast and its agents row say what it asks", async () => {
  const { core, store } = setup()
  const toasts: string[] = []
  store.onAlert = (_k, t) => toasts.push(`${t.title} | ${t.body}`)
  await store.connect()
  const r = await store.newSpace({ argv: ['claude'], folder: '/Users/sam/src/demo-app' })
  await settle()
  core.emit('title', r.terminal, { title: '✳ Hello.txt file creation' })
  core.setStatus(r.terminal, 'working')
  await settle()
  core.setStatus(r.terminal, 'blocked', 'claude-code', { kind: 'permission', msg: 'approve Write: /Users/sam/src/demo-app/hello.txt' })
  await settle()
  expect(toasts).toEqual(['Claude Code needs you | demo-app › 1 · Write: /Users/sam/src/demo-app/hello.txt'])
  const a = store.agents()[0]
  expect([a.kind, a.msg, a.named]).toEqual(['permission', 'approve Write: /Users/sam/src/demo-app/hello.txt', false])
  expect(store.agentsView().detail.get(r.terminal)).toBe('Hello.txt file creation')
})

test("answering a blocked agent presses its prompt's keys in its terminal; a reply then types the text", async () => {
  const { core, store } = setup()
  await store.connect()
  const r = await store.newSpace({ argv: ['claude'] })
  await settle()
  await store.answer(r.terminal, { keys: ['1'] })
  expect(core.calls.filter((c) => c.method === 'terminal.keys').map((c) => c.params)).toEqual([{ terminal: r.terminal, keys: ['1'] }])
  await store.answer(r.terminal, { keys: ['3'] }, 'green')
  expect(core.calls.filter((c) => c.method.startsWith('terminal.keys') || c.method === 'terminal.send').slice(1).map((c) => [c.method, c.params])).toEqual([
    ['terminal.keys', { terminal: r.terminal, keys: ['3'] }],
    ['terminal.send', { terminal: r.terminal, text: 'green', force: true }],
  ])
})

test("a pane's header names a shell or an agent by its program, as the desktop's does, whatever its title", async () => {
  const { core, store } = setup()
  await store.connect()
  const a = await store.newSpace({})
  const b = await store.newSpace({ argv: ['claude'] })
  core.emit('title', a.terminal, { title: 'sam@studio:~/src/api' })
  core.setStatus(b.terminal, 'working')
  await settle()
  expect(store.paneName(a.terminal)).toBe('zsh')
  expect(store.paneName(b.terminal)).toBe('Claude Code')
})

test("a flick across the terminal goes to the space's next or previous tab, and stops at either end", async () => {
  const { store } = setup()
  await store.connect()
  const a = await store.newSpace({})
  const b = await store.newTab({ space: a.space })
  const c = await store.newTab({ space: a.space })
  const active = () => spaceActiveTab(store.model.space(a.space)!)?.id
  store.selectTab(b.tab)
  store.stepTab(a.space, 'next')
  expect(active()).toBe(c.tab)
  store.stepTab(a.space, 'next')
  expect(active()).toBe(c.tab)
  store.stepTab(a.space, 'prev')
  store.stepTab(a.space, 'prev')
  expect(active()).toBe(a.tab)
})

test('text from the composer goes out with terminal.send; typed while the line is down, it waits as pending and goes once it is back', async () => {
  const cores = [new FakeCore(), new FakeCore()]
  let n = 0
  const timers: (() => void)[] = []
  const store = new Store({ pipe: () => cores[n++], setInterval: (() => 0) as any, clearInterval: (() => {}) as any,
    setTimeout: ((f: () => void) => { timers.push(f); return 0 }) as any })
  await store.connect()
  const r = await store.newSpace({})
  await store.compose(r.terminal, 'ls')
  expect(cores[0].calls.filter((c) => c.method === 'terminal.send').map((c) => [c.params.text, c.params.force])).toEqual([['ls', true]])
  cores[1].terms.set(r.terminal, { ...cores[0].terms.get(r.terminal)! })
  cores[1].docs = cores[0].docs
  cores[0].drop('network')
  await settle()
  await store.compose(r.terminal, 'pwd')
  expect(store.pending.get()).toEqual([{ address: r.terminal, text: 'pwd' }])
  timers.shift()!()
  await settle(30)
  expect(store.conn.get()).toBe('ready')
  store.sync()
  await settle()
  expect(cores[1].calls.filter((c) => c.method === 'terminal.send').map((c) => c.params.text)).toEqual(['pwd'])
  expect(store.pending.get()).toEqual([])
})

test("a blocked agent's menu is read off its screen once; a screen without one is read again, then left to the keys", async () => {
  const { core, store, timers } = setup()
  await store.connect()
  const r = await store.newSpace({ argv: ['claude'] })
  await settle()
  core.screens.set(r.terminal, ' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n')
  core.setStatus(r.terminal, 'blocked', 'claude-code', { kind: 'permission', msg: 'approve Bash: ls' })
  await settle()
  expect(store.menuFor(r.terminal)?.options.map((o) => o.label)).toEqual(['Yes', 'No'])
  expect(core.calls.filter((c) => c.method === 'terminal.read').length).toBe(1)
  core.setStatus(r.terminal, 'working')
  await settle()
  expect(store.menuFor(r.terminal)).toBe(undefined)
  // Blocked again, the menu not drawn yet: read again a moment later, three times in all.
  core.screens.set(r.terminal, '❯ \n')
  core.setStatus(r.terminal, 'blocked', 'claude-code', { kind: 'permission', msg: 'approve Bash: ls' })
  await settle()
  for (let i = 0; i < 3; i++) { for (const f of timers.splice(0)) f(); await settle() }
  expect(core.calls.filter((c) => c.method === 'terminal.read').length).toBe(4)
  expect(store.menuFor(r.terminal)).toBe(undefined)
  expect(store.menuRead(r.terminal)).toBe(true)
})
