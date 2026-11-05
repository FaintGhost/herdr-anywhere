// herdr-core's framed mode (herdr-core/schema/README.md "Framing"):
// [channel u32 LE][kind u8][len u32 LE][payload], payload at most 16 MiB.

export const DATA = 0
export const CREDIT = 1
export const CLOSE = 2
export const RESIZE = 3
export const FOCUS = 4
export const FACTS = 5

export const MAX_PAYLOAD = 16 * 1024 * 1024
const HEADER = 9

export function encodeFrame(channel: number, kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER + payload.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, channel, true)
  v.setUint8(4, kind)
  v.setUint32(5, payload.length, true)
  out.set(payload, HEADER)
  return out
}

export function u32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n, true)
  return out
}

export function resizePayload(cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(4)
  const v = new DataView(out.buffer)
  v.setUint16(0, cols, true)
  v.setUint16(2, rows, true)
  return out
}

export type FrameHandler = (channel: number, kind: number, payload: Uint8Array) => void

/** Collects bytes cut anywhere and calls `onFrame` once per whole frame. */
export class FrameParser {
  private buf = new Uint8Array(0)

  constructor(private onFrame: FrameHandler) {}

  reset() {
    this.buf = new Uint8Array(0)
  }

  push(chunk: Uint8Array) {
    let buf = this.buf.length ? concat(this.buf, chunk) : chunk
    let at = 0
    while (buf.length - at >= HEADER) {
      const v = new DataView(buf.buffer, buf.byteOffset + at, HEADER)
      const len = v.getUint32(5, true)
      if (len > MAX_PAYLOAD) throw new Error(`frame too large: ${len} bytes`)
      if (buf.length - at < HEADER + len) break
      // A copy, so the handler may keep it after the next push.
      const payload = buf.slice(at + HEADER, at + HEADER + len)
      this.onFrame(v.getUint32(0, true), v.getUint8(4), payload)
      at += HEADER + len
    }
    this.buf = at === buf.length ? new Uint8Array(0) : buf.slice(at)
  }
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
