// What a blocked agent asks, from its status report.
import { expect, test } from 'nsh/test'
import { asks } from './answers.ts'

test('what a blocked agent asks drops its report\'s verb; an agent that is not blocked asks nothing', () => {
  expect(asks({ state: 'blocked', app: 'claude-code', kind: 'permission', msg: 'approve Write: /Users/sam/src/api/hello.txt' })).toBe('Write: /Users/sam/src/api/hello.txt')
  expect(asks({ state: 'blocked', app: 'claude-code', kind: 'question', msg: 'answer: Which color do you like? (Red · Blue)' })).toBe('Which color do you like? (Red · Blue)')
  expect(asks({ state: 'working', app: 'claude-code', kind: 'permission', msg: 'approve rm' })).toBe('')
  expect(asks(null)).toBe('')
})
