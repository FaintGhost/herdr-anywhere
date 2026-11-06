import { expect, test } from 'nsh/test'
import { rowKeys } from './pane-bar.tsx'

const has = (keys: { key: string }[], k: string) => keys.some((x) => x.key === k)

test('the key row has Esc only when nothing else on screen does', () => {
  expect(has(rowKeys('compose'), 'esc')).toBe(false)
  expect(has(rowKeys('keys'), 'esc')).toBe(false)
  expect(has(rowKeys('choices'), 'esc')).toBe(true)
})

test('the keys a phone keyboard lacks stay', () => {
  for (const k of ['btab', 'tab', 'ctrl', 'ctrlc', 'left', 'up', 'down', 'right', 'enter']) expect(has(rowKeys('compose'), k)).toBe(true)
})
