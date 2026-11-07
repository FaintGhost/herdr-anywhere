import { expect, test } from 'nsh/test'
import { programIconKey } from './kit.tsx'

test("an icon drawn white (Kimi's K) has a dark one on the light theme; the others stay as they are", () => {
  expect(programIconKey('kimi', 'light')).toBe('kimi-light')
  expect(programIconKey('kimi', 'dark')).toBe('kimi')
  expect(programIconKey('claude', 'light')).toBe('claude')
  expect(programIconKey('codex', 'light')).toBe('codex')
  expect(programIconKey(undefined, 'light')).toBe('shell')
  expect(programIconKey('no-such-icon', 'dark')).toBe('shell')
})
