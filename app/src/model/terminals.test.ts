import { expect, test } from 'nsh/test'
import { Terminals } from './terminals.ts'

const ev = (seq: number, type: string, terminal: string, data: any) => ({ jsonrpc: '2.0', method: 'event', params: { seq, type, terminal, data } })
const t1 = { address: 't1', state: 'live', argv: ['zsh'], cwd: '/a', labels: {}, pid: 9, foreground: { name: 'zsh' } }

test('events after the snapshot apply in order; older ones are dropped', () => {
  const ts = new Terminals()
  ts.snapshot(5, [t1])
  ts.apply(ev(5, 'title', 't1', { title: 'stale' }))
  ts.apply(ev(6, 'title', 't1', { title: 'fresh' }))
  expect(ts.get('t1')!.title).toBe('fresh')
})

test('created, status, labels, size, foreground, keep, turn', () => {
  const ts = new Terminals()
  ts.snapshot(0, [])
  ts.apply(ev(1, 'created', 't2', { ...t1, address: 't2' }))
  ts.apply(ev(2, 'status', 't2', { status: { state: 'working', app: 'claude-code' }, records: {}, reported: true }))
  ts.apply(ev(3, 'labels', 't2', { labels: { 'herdr.space': 'sp1' } }))
  ts.apply(ev(4, 'size', 't2', { cols: 90, rows: 30 }))
  ts.apply(ev(5, 'foreground', 't2', { pid: 3, name: 'claude', argv: ['claude'], cwd: '/b' }))
  ts.apply(ev(6, 'keep', 't2', { keep: true }))
  ts.apply(ev(7, 'turn', 't2', { turn: 4, state: 'working' }))
  const t = ts.get('t2')!
  expect(t.status).toEqual({ state: 'working', app: 'claude-code' })
  expect(t.reported).toBe(true)
  expect(t.labels).toEqual({ 'herdr.space': 'sp1' })
  expect([t.cols, t.rows]).toEqual([90, 30])
  expect(t.foreground.cwd).toBe('/b')
  expect(t.keep).toBe(true)
  expect(t.turn).toBe(4)
})

test('lost keeps it live without a pid; finished marks it; removed drops it; restarted replaces it', () => {
  const ts = new Terminals()
  ts.snapshot(0, [t1])
  ts.apply(ev(1, 'lost', 't1', { reason: 'signal', exit_code: null, signal: 9, finished_ms: null }))
  expect(ts.get('t1')!.state).toBe('live')
  expect(ts.get('t1')!.pid).toBe(undefined)
  expect(ts.get('t1')!.foreground).toBe(undefined)
  ts.apply(ev(2, 'restarted', 't1', { ...t1, pid: 10 }))
  expect(ts.get('t1')!.pid).toBe(10)
  ts.apply(ev(3, 'finished', 't1', { reason: 'exited', exit_code: 0, signal: null, finished_ms: 5 }))
  expect(ts.get('t1')!.state).toBe('finished')
  ts.apply(ev(4, 'removed', 't1', {}))
  expect(ts.get('t1')).toBe(undefined)
})

test('missed replaces the whole list and asks for every document again', () => {
  const ts = new Terminals()
  ts.snapshot(3, [t1])
  const r = ts.apply({ jsonrpc: '2.0', method: 'missed', params: { seq: 9, terminals: [{ ...t1, address: 't7' }] } })
  expect(ts.list().map((t) => t.address)).toEqual(['t7'])
  expect(r.rereadDocs).toBe(true)
  ts.apply(ev(9, 'title', 't7', { title: 'old' }))
  expect(ts.get('t7')!.title).toBe(undefined)
})

test('doc events name the machine they came from', () => {
  const ts = new Terminals()
  ts.snapshot(0, [])
  expect(ts.apply({ method: 'event', params: { seq: 1, type: 'doc', data: { name: 'herdr-app', version: 2 } } }).doc).toEqual({ machine: undefined, name: 'herdr-app', version: 2 })
  expect(ts.apply({ method: 'event', params: { seq: 2, type: 'doc', machine: 'vps', data: { name: 'herdr-app', version: 9 } } }).doc).toEqual({ machine: 'vps', name: 'herdr-app', version: 9 })
})
