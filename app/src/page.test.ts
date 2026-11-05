import { expect, test } from 'nsh/test'
import { wantsKeepAlive } from './page.ts'

test('the phone stays connected in the background while it has a computer to stay connected to, and the person wants it', () => {
  for (const c of ['connecting', 'ready', 'reconnecting', 'failed']) expect(wantsKeepAlive(c, true)).toBe(true)
  for (const c of ['idle', 'unpaired']) expect(wantsKeepAlive(c, true)).toBe(false)
  expect(wantsKeepAlive('ready', false)).toBe(false)
})
