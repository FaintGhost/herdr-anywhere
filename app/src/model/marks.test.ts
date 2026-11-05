// A space's badge colour, picked as the desktop's spaces list picks it.
import { expect, test } from 'nsh/test'
import { MARK, gitTail, spaceMarks } from './marks.ts'

test('each space takes the least-used colour, in the palette order; the home space "~" keeps the first', () => {
  const m = spaceMarks([{ id: 'a', name: 'api' }, { id: 'h', name: '~' }, { id: 'b', name: 'web' }, { id: 'c', name: 'docs' }])
  expect(m).toEqual({ a: MARK.ansi6, h: MARK.ansi6, b: MARK.ansi3, c: MARK.ansi4 })
})

test("a space's git tail names the repo and the branch, leaving out what its name already says and main or master", () => {
  expect(gitTail('api', { top: '/Users/sam/src/api', branch: 'feature/login' })).toBe('feature/login')
  expect(gitTail('login fix', { top: '/Users/sam/src/api', branch: 'main' })).toBe('api')
  expect(gitTail('login fix', { top: '/Users/sam/src/api', branch: 'fix' })).toBe('api · fix')
  expect(gitTail('api', { top: '/Users/sam/src/api', branch: 'master' })).toBe('')
  expect(gitTail('api', undefined)).toBe('')
})

test('past six spaces the colours come round again', () => {
  const ids = ['1', '2', '3', '4', '5', '6', '7']
  const m = spaceMarks(ids.map((id) => ({ id, name: id })))
  expect(ids.map((id) => m[id])).toEqual([MARK.ansi6, MARK.ansi3, MARK.ansi4, MARK.ansi5, MARK.ansi2, MARK.ansi1, MARK.ansi6])
})
