// The phone's byte pipe to the companion (companion/internal/server/bridge.go): binary messages, or base64 text
// with `enc=b64`; the companion's close codes tell "pair again" and "no herdr-core" from a lost network.
import { expect, test } from 'nsh/test'
import { SocketPipe, socketUrl } from './ws.ts'

class FakeSocket {
  static last: FakeSocket
  binaryType = 'blob'
  readyState = 0
  sent: any[] = []
  onopen: ((e: any) => void) | null = null
  onmessage: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  onclose: ((e: any) => void) | null = null
  closedWith?: [number | undefined, string | undefined]
  constructor(readonly url: string) { FakeSocket.last = this }
  send(d: any) { if (this.readyState !== 1) throw new Error('not open'); this.sent.push(d) }
  close(code?: number, reason?: string) { this.closedWith = [code, reason]; this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.({}) }
  shut(code: number, reason = '') { this.readyState = 3; this.onclose?.({ code, reason, wasClean: true }) }
}

const timers: { f: () => void; ms: number }[] = []
const io = { WebSocket: FakeSocket as any, setTimeout: ((f: () => void, ms: number) => { timers.push({ f, ms }); return timers.length }) as any, clearTimeout: ((id: number) => { if (timers[id - 1]) timers[id - 1].f = () => {} }) as any }
const bytes = (...n: number[]) => new Uint8Array(n)

test('the socket address follows the companion: ws for http, wss for https, the token and the encoding in the query', () => {
  expect(socketUrl('http://192.168.1.20:7681', 'tok+/=', 'bin')).toBe('ws://192.168.1.20:7681/hc?token=tok%2B%2F%3D')
  expect(socketUrl('https://box.tail1234.ts.net/', 'abc', 'b64')).toBe('wss://box.tail1234.ts.net/hc?token=abc&enc=b64')
})

test('binary: bytes sent before the socket opens go out in order once it does, and arriving bytes come up as bytes', () => {
  const p = new SocketPipe('ws://x/hc?token=t', 'bin', io)
  const got: number[][] = []
  p.onBytes = (b) => got.push([...b])
  p.send(bytes(1, 2))
  p.send(bytes(3))
  const s = FakeSocket.last
  expect(s.binaryType).toBe('arraybuffer')
  s.open()
  expect(s.sent.map((d) => [...new Uint8Array(d)])).toEqual([[1, 2], [3]])
  s.onmessage!({ data: bytes(9, 8).buffer })
  expect(got).toEqual([[9, 8]])
})

test('base64: both directions are base64 text messages', () => {
  const p = new SocketPipe('ws://x/hc?token=t&enc=b64', 'b64', io)
  const got: number[][] = []
  p.onBytes = (b) => got.push([...b])
  const s = FakeSocket.last
  s.open()
  p.send(bytes(0, 255, 10))
  expect(s.sent).toEqual([btoa('\x00\xff\n')])
  s.onmessage!({ data: btoa('{"a":1}\n') })
  expect(got).toEqual([[...new TextEncoder().encode('{"a":1}\n')]])
})

test("the companion's close codes become reasons the app acts on", () => {
  const reasons: string[] = []
  for (const code of [4401, 4503, 1003, 1006]) {
    const p = new SocketPipe('ws://x/hc', 'bin', io)
    p.onClose = (r) => reasons.push(r)
    FakeSocket.last.open()
    FakeSocket.last.shut(code)
  }
  expect(reasons).toEqual(['unpaired', 'no-core', 'binary-unsupported', 'network'])
})

test('a refused connection reports network once, even when an error comes before the close', () => {
  const reasons: string[] = []
  const p = new SocketPipe('ws://x/hc', 'bin', io)
  p.onClose = (r) => reasons.push(r)
  FakeSocket.last.onerror!({ message: 'refused' })
  FakeSocket.last.shut(1006)
  expect(reasons).toEqual(['network'])
})

test('binary that never gets an answer is taken as binary not getting through', () => {
  timers.length = 0
  const reasons: string[] = []
  const p = new SocketPipe('ws://x/hc', 'bin', io)
  p.onClose = (r) => reasons.push(r)
  FakeSocket.last.open()
  p.send(bytes(1))
  const watchdog = timers.find((t) => t.ms === 8000)!
  watchdog.f()
  expect(reasons).toEqual(['binary-unsupported'])
  expect(FakeSocket.last.closedWith![0]).toBe(1000)
  // An answer in time disarms it.
  const q = new SocketPipe('ws://x/hc', 'bin', io)
  const r2: string[] = []
  q.onClose = (r) => r2.push(r)
  FakeSocket.last.open()
  q.send(bytes(1))
  FakeSocket.last.onmessage!({ data: bytes(2).buffer })
  timers.at(-1)!.f()
  expect(r2).toEqual([])
})

test('closing it ourselves says closed, once', () => {
  const reasons: string[] = []
  const p = new SocketPipe('ws://x/hc', 'bin', io)
  p.onClose = (r) => reasons.push(r)
  FakeSocket.last.open()
  p.close()
  FakeSocket.last.shut(1000)
  expect(reasons).toEqual(['closed'])
})

test('a send the socket refuses never throws: a closing socket still reports its close code, else the pipe ends soon after', () => {
  // NSH's WebSocket.send throws "outbound queue is full or closed" (the live e2e: the companion closed
  // with 4401 right after the open, before readyState changed).
  const p = new SocketPipe('ws://x/hc?token=t', 'bin', io)
  const why: string[] = []
  p.onClose = (r) => why.push(r)
  const s = FakeSocket.last
  s.open()
  s.send = () => { throw new Error('WebSocket outbound queue is full or closed') }
  p.send(bytes(1))
  s.shut(4401)
  expect(why).toEqual(['unpaired'])

  const q = new SocketPipe('ws://x/hc?token=t', 'b64', io)
  const why2: string[] = []
  q.onClose = (r) => why2.push(r)
  const s2 = FakeSocket.last
  s2.open()
  s2.send = () => { throw new Error('WebSocket outbound queue is full or closed') }
  q.send(bytes(1))
  q.send(bytes(2))
  expect(why2).toEqual([])
  const t = timers.findLast((t) => t.ms === 5000)!
  t.f()
  expect(why2).toEqual(['network'])
  expect(s2.closedWith?.[0]).toBe(1000)
})

// NSH's queue held 8 credit frames (104 bytes) when it refused one, measured on the emulator; the socket was
// fine and the next send got through. A full queue ended the connection, about every 2 s while a screen redrew.
test('a full queue loses nothing: what it refused goes out soon, in order, as one message, and later sends wait their turn', () => {
  timers.length = 0
  const p = new SocketPipe('ws://x/hc', 'bin', io)
  const why: string[] = []
  p.onClose = (r) => why.push(r)
  const s = FakeSocket.last
  s.open()
  const accept = s.send
  p.send(bytes(1))
  let tried = 0
  s.send = () => { tried++; throw new Error('WebSocket outbound queue is full or closed') }
  p.send(bytes(2))
  expect(tried).toBe(1)
  p.send(bytes(3))
  expect(tried).toBe(1)
  const again = () => { const t = timers.findLast((t) => t.ms < 1000)!; const f = t.f; t.f = () => {}; f() }
  again()
  expect(tried).toBe(2)
  s.send = accept
  again()
  p.send(bytes(4))
  expect(s.sent.map((d) => [...new Uint8Array(d)])).toEqual([[1], [2, 3], [4]])
  // The socket took them: the time it was given to take them no longer runs.
  timers.findLast((t) => t.ms === 5000)!.f()
  expect(why).toEqual([])
})

test('sends made while the socket opens go through the same waiting room', () => {
  timers.length = 0
  const p = new SocketPipe('ws://x/hc', 'bin', io)
  const s = FakeSocket.last
  for (let i = 1; i <= 3; i++) p.send(bytes(i))
  const accept = s.send
  let taken = 0
  s.send = function (this: FakeSocket, d: any) { if (taken++ === 1) throw new Error('full'); accept.call(this, d) } as any
  s.open()
  timers.findLast((t) => t.ms < 1000)!.f()
  expect(s.sent.map((d) => [...new Uint8Array(d)])).toEqual([[1], [2, 3]])
})

test('too much waiting ends the pipe rather than the phone\'s memory', () => {
  timers.length = 0
  const p = new SocketPipe('ws://x/hc', 'bin', io)
  const why: string[] = []
  p.onClose = (r) => why.push(r)
  const s = FakeSocket.last
  s.open()
  s.send = () => { throw new Error('full') }
  p.send(new Uint8Array(4 << 20))
  expect(why).toEqual([])
  p.send(new Uint8Array(5 << 20))
  expect(why).toEqual(['network'])
})

test('one long wait is cut into messages the socket accepts', () => {
  timers.length = 0
  const p = new SocketPipe('ws://x/hc', 'bin', io)
  const s = FakeSocket.last
  s.open()
  const accept = s.send
  s.send = () => { throw new Error('full') }
  for (let i = 0; i < 5; i++) p.send(new Uint8Array(1 << 20).fill(i))
  s.send = accept
  for (let i = 0; i < 6; i++) { const t = timers.findLast((t) => t.ms < 1000); if (!t) break; const f = t.f; t.f = () => {}; f() }
  const sizes = s.sent.map((d) => (d as ArrayBuffer).byteLength)
  expect(sizes.reduce((a, b) => a + b, 0)).toBe(5 << 20)
  expect(Math.max(...sizes)).toBe(2 << 20)
})
