// The phone's whole path against a real computer: pairing with the companion over HTTP, then the app's own
// Linker → SocketPipe → HcClient → Store over a real WebSocket into a real herdr-core (an isolated session).
// Run by e2e/run.sh, which starts both and writes the pairing link into e2e/pair.ts for the run.
import { expect, open, test } from 'nsh/test'

test('pair, connect, run, type, share the layout, close, and refuse an unknown token', async () => {
  const app = await open('./live-app.tsx', { network: 'live' })
  await app.waitUntil(() => app.texts().some((t) => t === 'done' || t.startsWith('FAIL')), { timeout: 40000 })
  expect(app.texts()).toEqual([
    'paired: token long',
    'second use: That code expired or was already used. Run herdr-anywhere pair again.',
    'connected: ready generation 1',
    'ran: hm-e2e-42',
    'typed: typed-42',
    'other screen: e2e',
    'git: feature/x',
    'adopted git: feature/x',
    'late git: feature/x',
    'closed: finished',
    'bad token: This computer no longer knows this phone. Pair it again.',
    'done',
  ])
}, 60000)
