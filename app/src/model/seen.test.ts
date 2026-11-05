// Where "new since you looked" goes: the lines last seen, found again in the replayed history.
import { expect, test } from 'nsh/test'
import { findSince, sinceLabel, tailOf } from './seen.ts'

const before = ['$ npm test', '', 'PASS src/a.test.ts', 'PASS src/b.test.ts', '']
const after = [...before.slice(0, 4), '$ git status', 'On branch main', '']

test('the last lines seen are the last few lines with text', () => {
  expect(tailOf(before)).toEqual(['$ npm test', 'PASS src/a.test.ts', 'PASS src/b.test.ts'])
  expect(tailOf(['', '  ', ''])).toEqual([])
})

test('new output after the lines last seen starts at the next line with text', () => {
  expect(findSince(after, tailOf(before))).toBe(4)
})

test('no mark when nothing came after, or the lines seen are not in the history any more', () => {
  expect(findSince(before, tailOf(before))).toBe(undefined)
  expect(findSince(['$ clear', 'fresh'], tailOf(before))).toBe(undefined)
  expect(findSince(after, [])).toBe(undefined)
})

test('the same lines seen twice: the later one is where you were', () => {
  const twice = ['ok', 'done', 'ok', 'done', 'next']
  expect(findSince(twice, ['ok', 'done'])).toBe(4)
})

test('trailing spaces do not matter', () => {
  expect(findSince(['a  ', 'b', 'c'], ['a', 'b '])).toBe(2)
})

test('the label says when you looked: the time today, the day and time before', () => {
  const now = new Date(2026, 9, 31, 15, 30).getTime()
  expect(sinceLabel(new Date(2026, 9, 31, 9, 5).getTime(), now)).toBe('New since you looked, 09:05')
  expect(sinceLabel(new Date(2026, 9, 29, 22, 41).getTime(), now)).toBe('New since you looked, Oct 29 22:41')
})
