// The app over an in-memory herdr-core (src/testing/fakecore.ts), already paired, for the screen tests.
// `host.params.scene`: "empty" (a fresh computer), "busy" (two spaces, agents in every state), "unpaired",
// "link" (never paired, opened with the `#pair=` link in `host.params.link`, as the web app is), "link-forgotten" (the
// same, and the computer forgets the phone right after).
// For Settings › Computer: `via: "tailpocket"` with `routes` ("relay:tok,direct": what the tunnel answers in turn, the
// last one for good; "throws": it fails), `url` (the link's address), `conn: "lost"` (the core stops answering) and
// `info: "none"` (the companion gives no version).
import { host, mount, Storage } from 'nsh'
import { Linker, type Route, type Tunnel } from '../src/link.ts'
import { PrefStore } from '../src/prefs.ts'
import { Store } from '../src/store.ts'
import { Root } from '../src/ui/root.tsx'
import { FakeCore } from '../src/testing/fakecore.ts'
import { FakeFolders } from '../src/testing/fake-folders.ts'

const scene = String((host.params as any)?.scene ?? 'busy')
const opened = scene.startsWith('link')
const params = (host.params ?? {}) as Record<string, string | undefined>
const paired = params.via === 'tailpocket' ? { url: 'tailpocket:', via: 'tailpocket' } : { url: params.url ?? 'http://192.0.2.10:7681' }
const memory = new Map<string, string>(opened ? [] : [['link', JSON.stringify({ ...paired, token: 'synthetic-token', device: 'd1', name: 'studio', enc: 'bin' })]])
const io = { load: async (k: string) => memory.get(k) ?? null, save: (k: string, v: string) => void memory.set(k, v), remove: (k: string) => void memory.delete(k) }

export const core = new FakeCore()
core.echo = true
;(globalThis as any).__core = core
// Claude Code's permission menu as it draws it (2.1.314), for the choices the phone reads off the screen.
const EDIT_MENU = [' Edit file', ' src/api/login.ts', '', ' Do you want to make this edit to login.ts?', ' ❯ 1. Yes',
  '   2. Yes, allow all edits during this session (shift+tab)', '   3. No, and tell Claude what to do differently (esc)', ''].join('\n')
if (scene === 'busy' || scene === 'single') {
  const doc = { spaces: [] as any[] }
  const add = (space: string, folder: string, name: string, tabs: { id: string; name?: string; argv: string[]; status?: string; title?: string; kind?: string; msg?: string; screen?: string }[]) => {
    const s = { id: space, name, folder, tabs: [] as any[] }
    for (const t of tabs) {
      const term = core.run({ argv: t.argv, cwd: folder, labels: { 'herdr.space': space, 'herdr.tab': t.id } })
      // What herdr-core answers for each (hc get, 2026-11-03): Codex is its node launcher in the foreground.
      if (scene === 'single') term.foreground = t.argv[0] === 'codex' ? { name: 'node', argv: ['node', '/usr/local/bin/codex'], cwd: folder } : { name: t.argv[0], argv: t.argv, cwd: folder }
      if (t.screen) core.screens.set(term.address, t.screen)
      if (t.status) core.setStatus(term.address, t.status, t.argv[0] === 'codex' ? 'codex' : 'claude-code', { kind: t.kind, msg: t.msg })
      if (t.title) term.title = t.title
      s.tabs.push({ id: t.id, name: t.name ?? '', root: { id: t.id, type: 'row', children: [{ id: `p-${t.id}`, type: 'block', content: { terminal: term.address } }] } })
    }
    doc.spaces.push(s)
  }
  // `scene: "single"`: one terminal running `params.argv`, silent unless `params.status` says otherwise.
  if (scene === 'single') add('sp1', '/Users/sam/src/api', '', [{ id: 'tb1', argv: [params.argv ?? 'zsh'], status: params.status }])
  else add('sp1', '/Users/sam/src/api', '', [
    { id: 'tb1', name: 'fix login', argv: ['claude'], status: 'blocked', kind: 'permission', msg: 'approve Write: /Users/sam/src/api/login.ts', screen: EDIT_MENU },
    { id: 'tb2', argv: ['codex'], status: 'working' },
  ])
  if (scene === 'busy') add('sp2', '/Users/sam/src/clients/northwind/storefront-redesign-2026/web', 'web', [{ id: 'tb3', argv: ['zsh'] }])
  core.docs.set('', { value: doc, version: 1 })
}
// Keys pressed in a terminal, where a test reads them (`app.storage()['fake-keys']`); an answered agent goes on working.
const pressed: [string, string[]][] = []
core.onKeys = (addr, keys) => {
  pressed.push([addr, keys])
  void Storage.setItem('fake-keys', JSON.stringify(pressed))
  const st = core.terms.get(addr)?.status
  if (st?.state === 'blocked') core.setStatus(addr, 'working', st.app)
}
// A test moves an agent to another state: `app.host.send('fake.status', { address, state })`.
host.on('fake.status', (d: any) => {
  if (typeof d.screen === 'string') core.screens.set(d.address, d.screen)
  core.setStatus(d.address, d.state, core.terms.get(d.address)?.status?.app, { kind: d.kind, msg: d.msg })
})
// A test drops the line: `app.host.send('fake.drop', {})`; the computer then stops answering.
host.on('fake.drop', () => core.drop('network'))
// Text the app sent (`terminal.send`), where a test reads it (`app.storage()['fake-sent']`).
const sent: [string, string, boolean][] = []
core.onSend = (addr, text, force) => { sent.push([addr, text, force]); void Storage.setItem('fake-sent', JSON.stringify(sent)) }
// The computer's folders for the folder picker (GET/POST /api/folders); a folder made is recorded in `fake-created`.
const disk = new FakeFolders(core.home, ['src/api', 'src/demo-app', 'src/web', 'src/clients/northwind/storefront-redesign-2026/web', 'Documents', 'notes', '.config'],
  ['src/api', 'src/demo-app', 'src/clients/northwind/storefront-redesign-2026/web'])
const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body })
async function folders(url: string, init: any) {
  if (init?.method === 'POST') {
    const path = await disk.create(JSON.parse(init.body).path)
    void Storage.setItem('fake-created', JSON.stringify(disk.created))
    return answer(200, { path, created: true })
  }
  const q = url.split('?')[1] ?? ''
  const r = await disk.list(decodeURIComponent(/(?:^|&)path=([^&]*)/.exec(q)?.[1] ?? ''), /(?:^|&)hidden=1/.test(q))
  return 'missing' in r ? answer(404, { error: 'no such folder', ...r }) : answer(200, r)
}
// "unpaired": the computer refuses the saved token; a token from pairing again gets through.
let forgot = 0
const pipe = (l: Linker) => () => {
  const forgotten = (scene === 'unpaired' && l.link.get()?.token === 'synthetic-token') || (scene === 'link-forgotten' && !forgot++)
  if (forgotten) { const c = new FakeCore(); c.send = () => c.drop('unpaired'); return c }
  return core
}

const routes = (params.routes ?? 'direct').split(',')
const fakeTunnel: Tunnel = {
  pair: async () => '', scan: async () => '', forget: () => {},
  connect: async () => ({
    baseUrl: 'http://127.0.0.1:1', close: () => {},
    path: async () => {
      const next = routes.length > 1 ? routes.shift()! : routes[0]
      if (next === 'throws') throw new Error('unreachable')
      const [route, relay] = next.split(':')
      return (route === 'relay' ? { route, relay } : { route }) as Route
    },
  }),
}
if (params.conn === 'lost') setTimeout(() => core.drop('network'), 0)

mount(() => (
  <Root deps={{
    linker: new Linker(params.via === 'tailpocket' ? { ...io, tunnel: fakeTunnel } : io),
    opensSettings: params.open === 'settings',
    prefs: new PrefStore(io),
    makeStore: (l) => new Store({ pipe: pipe(l) }),
    device: 'Test phone',
    pairLink: opened ? String((host.params as any)?.link) : undefined,
    // Recorded where a test can read it: the app's own storage.
    pairLinkUsed: () => void Storage.setItem('pair-link-used', '1'),
    fetcher: (async (url: string, init: any) => {
      if (url.includes('/api/folders')) return folders(url, init)
      if (url.includes('/api/info')) return { ok: params.info !== 'none', json: async () => (params.info === 'none' ? {} : { version: '9.9.9' }) }
      const body = JSON.parse(init.body)
      const ok = body.code === 'GOOD-CODE'
      return { ok, status: ok ? 200 : 401, json: async () => (ok ? { token: 'new-token', device: 'd2', name: 'studio' } : { error: 'unknown pairing code' }) }
    }) as any,
  }} />
))
