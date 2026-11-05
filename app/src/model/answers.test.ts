// What a blocked agent asks, from its status report.
import { expect, test } from 'nsh/test'
import { activity, asks } from './answers.ts'

test('what a blocked agent asks drops its report\'s verb; an agent that is not blocked asks nothing', () => {
  expect(asks({ state: 'blocked', app: 'claude-code', kind: 'permission', msg: 'approve Write: /Users/sam/src/api/hello.txt' })).toBe('Write: /Users/sam/src/api/hello.txt')
  expect(asks({ state: 'blocked', app: 'claude-code', kind: 'question', msg: 'answer: Which color do you like? (Red · Blue)' })).toBe('Which color do you like? (Red · Blue)')
  expect(asks({ state: 'working', app: 'claude-code', kind: 'permission', msg: 'approve rm' })).toBe('')
  expect(asks(null)).toBe('')
})

test("an agent's activity: what it asks, then what it says it did, then its title; its own name says nothing", () => {
  expect(activity({ state: 'blocked', msg: 'approve Write: a.ts' }, 'Fix login', 'Claude Code')).toBe('Write: a.ts')
  expect(activity({ state: 'done', msg: 'ran the tests' }, 'Fix login', 'Claude Code')).toBe('ran the tests')
  expect(activity({ state: 'working' }, 'Fix login', 'Claude Code')).toBe('Fix login')
  expect(activity({ state: 'working' }, 'Claude Code', 'Claude Code')).toBe('')
  expect(activity(undefined, '', 'Claude Code')).toBe('')
})
