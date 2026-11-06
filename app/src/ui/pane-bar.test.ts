import { expect, test } from 'nsh/test'
import { rowKeys } from './pane-bar.tsx'

const has = (keys: { key: string }[], k: string) => keys.some((x) => x.key === k)

test('the key row has Esc only when nothing else on screen does', () => {
  expect(has(rowKeys('compose'), 'esc')).toBe(false)
  expect(has(rowKeys('keys'), 'esc')).toBe(false)
  expect(has(rowKeys('choices'), 'esc')).toBe(true)
})

test('the keys a phone keyboard lacks stay', () => {
  for (const k of ['shift', 'tab', 'ctrl', 'ctrlc', 'left', 'up', 'down', 'right', 'enter']) expect(has(rowKeys('compose'), k)).toBe(true)
})

test('Shift is a key held for the next one, as Ctrl is, in place of a Shift+Tab key', () => {
  expect(has(rowKeys('compose'), 'btab')).toBe(false)
  expect(rowKeys('compose').map((k) => k.key).slice(0, 3)).toEqual(['shift', 'tab', 'ctrl'])
})
