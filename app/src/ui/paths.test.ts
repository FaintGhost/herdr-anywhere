import { expect, test } from 'nsh/test'
import { shortPath } from './paths.ts'

test('a folder under home reads from ~, also as macOS resolves /var and /tmp under /private', () => {
  expect(shortPath('/Users/sam/src/api', '/Users/sam')).toBe('~/src/api')
  expect(shortPath('/Users/sam', '/Users/sam')).toBe('~')
  expect(shortPath('/Users/samuel', '/Users/sam')).toBe('/Users/samuel')
  expect(shortPath('/private/var/folders/x/home/src', '/var/folders/x/home')).toBe('~/src')
  expect(shortPath('/opt/x', '')).toBe('/opt/x')
})
