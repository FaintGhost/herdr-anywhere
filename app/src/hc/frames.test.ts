import { expect, test } from 'nsh/test'
import { CLOSE, CREDIT, DATA, FrameParser, RESIZE, encodeFrame, resizePayload, u32 } from './frames.ts'

const bytes = (...n: number[]) => new Uint8Array(n)

test('a frame is channel u32 LE, kind u8, length u32 LE, then the payload', () => {
  const f = encodeFrame(5, DATA, bytes(0x61, 0x62))
  expect(Array.from(f)).toEqual([5, 0, 0, 0, 0, 2, 0, 0, 0, 0x61, 0x62])
})

test('resize carries cols then rows as u16 LE', () => {
  expect(Array.from(resizePayload(300, 40))).toEqual([44, 1, 40, 0])
  expect(Array.from(encodeFrame(1, RESIZE, resizePayload(80, 24))).slice(4, 5)).toEqual([RESIZE])
})

test('credit is a u32 LE count', () => {
  expect(Array.from(u32(70000))).toEqual([0x70, 0x11, 0x01, 0x00])
})

test('the parser joins frames cut anywhere and splits frames glued together', () => {
  const a = encodeFrame(0, DATA, new TextEncoder().encode('{"id":1}'))
  const b = encodeFrame(3, CLOSE, bytes())
  const c = encodeFrame(7, CREDIT, u32(9))
  const all = new Uint8Array([...a, ...b, ...c])
  const got: [number, number, number][] = []
  const p = new FrameParser((ch, kind, payload) => got.push([ch, kind, payload.length]))
  for (const cut of [3, 10, 11, 20]) {
    got.length = 0
    p.reset()
    p.push(all.subarray(0, cut))
    p.push(all.subarray(cut))
    expect(got).toEqual([[0, DATA, 8], [3, CLOSE, 0], [7, CREDIT, 4]])
  }
})

test('the parser hands over a payload that outlives the next push', () => {
  const got: string[] = []
  const p = new FrameParser((_ch, _k, payload) => got.push(new TextDecoder().decode(payload)))
  p.push(encodeFrame(1, DATA, new TextEncoder().encode('first')))
  p.push(encodeFrame(1, DATA, new TextEncoder().encode('again')))
  expect(got).toEqual(['first', 'again'])
})

test('an oversized length is refused instead of waiting forever', () => {
  const p = new FrameParser(() => {})
  const bad = new Uint8Array([0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0x7f])
  expect(() => p.push(bad)).toThrow('frame too large')
})
