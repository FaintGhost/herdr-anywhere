// Reading a blocked agent's menu off its screen. The screens are Claude Code 2.1.314's, captured 2026-10-31 with
// `hc read` in a scratch herdr-core session (paths changed to fake ones).
import { expect, test } from 'nsh/test'
import { readMenu } from './menu.ts'

const RULE = '─'.repeat(60)
const DASH = '╌'.repeat(60)

const BASH = `
⏺ Bash(touch made-by-claude.txt)
  ⎿  Waiting…

${RULE}
 Bash command
 Tip: auto mode handles these prompts for you — choose "switch to auto mode" below
 Create empty file made-by-claude.txt
${DASH}
 touch made-by-claude.txt
${DASH}
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /Users/sam/src/demo-app from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No

 Esc to cancel · Tab to amend
`

const QUESTION = `
❯ Use the AskUserQuestion tool to ask me which color I like.
${RULE}
 ☐ Color

Which color do you like?

❯ 1. Red
     Red
  2. Blue
     Blue
  3. Green
     Green
  4. Type something.
${RULE}
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`

// The same permission menu on a phone-width terminal: the long labels wrap.
const NARROW = `
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for git push
      commands in this project
   3. No, and tell Claude what to do
      differently (esc)

 Esc to cancel · Tab to amend
`

test("Claude Code's permission menu: every option in order, the highlighted one marked, No asks for text", () => {
  const m = readMenu('claude-code', BASH)!
  expect(m.question).toBe('Do you want to proceed?')
  expect(m.options.map((o) => [o.n, o.label, o.selected, o.typed])).toEqual([
    [1, 'Yes', true, false],
    [2, 'Yes, and always allow access to /Users/sam/src/demo-app from this project', false, false],
    [3, 'Yes, and switch to auto mode · auto mode handles these prompts for you', false, false],
    // Measured: 4 interrupts, and Claude asks "What should Claude do instead?" at its prompt.
    [4, 'No', false, true],
  ])
  expect(m.options.map((o) => o.keys)).toEqual([['1'], ['2'], ['3'], ['4']])
})

test("a question's options keep their first line as the label and the rest as detail; Type something asks for text", () => {
  const m = readMenu('claude-code', QUESTION)!
  expect(m.question).toBe('Which color do you like?')
  expect(m.options.map((o) => [o.n, o.label, o.typed])).toEqual([[1, 'Red', false], [2, 'Blue', false], [3, 'Green', false], [4, 'Type something.', true], [5, 'Chat about this', false]])
  expect(m.options[0].full).toBe('Red — Red')
})

test('wrapped labels are joined again', () => {
  const m = readMenu('claude-code', NARROW)!
  expect(m.options.map((o) => o.full)).toEqual(['Yes', "Yes, and don't ask again for git push commands in this project", 'No, and tell Claude what to do differently (esc)'])
  expect(m.options.map((o) => o.typed)).toEqual([false, false, true])
})

test('no menu, or a program whose layout is not known: nothing, never a guess', () => {
  expect(readMenu('claude-code', '❯ \n  ⏸ manual mode on')).toBe(undefined)
  expect(readMenu('codex', BASH)).toBe(undefined)
  expect(readMenu(null, BASH)).toBe(undefined)
  // A numbered list in the conversation above the prompt is not a menu: nothing is highlighted.
  expect(readMenu('claude-code', '⏺ Steps:\n  1. Build\n  2. Test\n\n❯ \n')).toBe(undefined)
})
