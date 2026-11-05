// Hiding the keyboard before the input it serves goes away. On Android (NSH 0.3.0) a focused input removed in the same
// update as Keyboard.dismiss() leaves the keyboard up with nothing to type into (2026-10-30, emulator API 35: after
// pairing the home screen kept a keyboard, `dumpsys input_method` showed mServedView=null).
import { Keyboard, keyboardFrame } from 'nsh'

type Frame = () => { height: number; duration: number }

export function keyboardGone(o: { frame?: Frame; dismiss?: () => void; step?: number; limit?: number } = {}): Promise<void> {
  const frame = o.frame ?? keyboardFrame
  const step = o.step ?? 50
  const limit = o.limit ?? 600
  ;(o.dismiss ?? (() => Keyboard.dismiss()))()
  return new Promise((resolve) => {
    const t0 = Date.now()
    const check = () => (frame().height <= 0 || Date.now() - t0 >= limit ? resolve() : setTimeout(check, step))
    check()
  })
}
