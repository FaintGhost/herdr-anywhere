// Leaving a screen whose input has the keyboard: wait for the keyboard to go first.
import { expect, test } from 'nsh/test'
import { keyboardGone } from './keyboard.ts'

test('waits until the keyboard has no height, then resolves', async () => {
  let height = 300
  let dismissed = 0
  const done = keyboardGone({ frame: () => ({ height, duration: 0 }), dismiss: () => { dismissed++ }, step: 1, limit: 1000 })
  let settled = false
  void done.then(() => { settled = true })
  await new Promise((r) => setTimeout(r, 10))
  expect(dismissed).toBe(1)
  expect(settled).toBe(false)
  height = 0
  await done
  expect(settled).toBe(true)
})

test('gives up after the limit, so a keyboard that never reports does not block the screen', async () => {
  const t0 = Date.now()
  await keyboardGone({ frame: () => ({ height: 300, duration: 0 }), dismiss: () => {}, step: 5, limit: 40 })
  expect(Date.now() - t0 < 1000).toBe(true)
})

test('without a keyboard up it resolves at once', async () => {
  let dismissed = 0
  await keyboardGone({ frame: () => ({ height: 0, duration: 0 }), dismiss: () => { dismissed++ }, step: 1, limit: 1000 })
  expect(dismissed).toBe(1)
})
