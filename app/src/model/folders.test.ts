import { expect, test } from 'nsh/test'
import { closeNames, crumbs, expand, filterFolders, FolderPicker, recentFolders, tilde } from './folders.ts'
import { FakeFolders } from '../testing/fake-folders.ts'

const HOME = '/Users/sam'
const disk = () => new FakeFolders(HOME, ['src/api', 'src/demo-app', 'src/web', 'src/apps-old', 'Documents', 'notes', '.config'], ['src/api', 'src/demo-app'])
const names = (fs: { name: string }[]) => fs.map((f) => f.name)

test('a path reads with ~ for home, and a typed ~ or / path is a path; other text is a filter', () => {
  expect(tilde('/Users/sam/src/api', HOME)).toBe('~/src/api')
  expect(tilde('/Users/sam', HOME)).toBe('~')
  expect(tilde('/opt/x', HOME)).toBe('/opt/x')
  expect(tilde('/Users/samuel', HOME)).toBe('/Users/samuel')
  expect(expand('~/src/', HOME)).toBe('/Users/sam/src/')
  expect(expand('~', HOME)).toBe('/Users/sam')
  expect(expand('/opt', HOME)).toBe('/opt')
  expect(expand('src', HOME)).toBe(undefined)
})

test('the filter keeps the names that contain it, those that start with it first, any case', () => {
  const fs = [{ name: 'web', git: false }, { name: 'apps-old', git: false }, { name: 'Rapid', git: false }, { name: 'api', git: true }]
  expect(names(filterFolders(fs, 'AP'))).toEqual(['apps-old', 'api', 'Rapid'])
  expect(names(filterFolders(fs, ''))).toEqual(['web', 'apps-old', 'Rapid', 'api'])
})

test('close names are a letter or two off, nearest first; nothing near gives none', () => {
  const fs = ['api', 'apps-old', 'demo-app', 'web'].map((name) => ({ name, git: false }))
  expect(closeNames('apii', fs)).toEqual(['api'])
  expect(closeNames('demoapp', fs)).toEqual(['demo-app'])
  expect(closeNames('wbe', fs)).toEqual(['web'])
  expect(closeNames('zzzz', fs)).toEqual([])
})

test('the breadcrumb starts at ~ inside home and at / outside it, each part its own path', () => {
  expect(crumbs('/Users/sam/src/api', HOME)).toEqual([
    { label: '~', path: '/Users/sam' }, { label: 'src', path: '/Users/sam/src' }, { label: 'api', path: '/Users/sam/src/api' }])
  expect(crumbs('/opt/x', HOME)).toEqual([{ label: '/', path: '/' }, { label: 'opt', path: '/opt' }, { label: 'x', path: '/opt/x' }])
})

test('recent folders: each once, most recently used first', () => {
  expect(recentFolders([
    { folder: '/Users/sam/src/web', at: 10 }, { folder: '/Users/sam/src/api', at: 30 }, { folder: '/Users/sam/src/web', at: 40 }, { folder: '', at: 50 },
  ])).toEqual(['/Users/sam/src/web', '/Users/sam/src/api'])
})

test('browsing: start in a folder, go into a subfolder, the repositories marked', async () => {
  const p = new FolderPicker(disk(), HOME)
  await p.go(HOME)
  expect(names(p.shown())).toEqual(['Documents', 'notes', 'src'])
  await p.go('/Users/sam/src')
  expect(p.shown().map((f) => `${f.name}${f.git ? ' (git)' : ''}`)).toEqual(['api (git)', 'apps-old', 'demo-app (git)', 'web'])
  expect(p.here()).toBe('/Users/sam/src')
})

test('typing a name filters the folder shown', async () => {
  const p = new FolderPicker(disk(), HOME)
  await p.go('/Users/sam/src')
  await p.type('ap')
  expect(names(p.shown())).toEqual(['api', 'apps-old', 'demo-app'])
  expect(p.missing()).toBe(undefined)
})

test('a typed path goes to its folder and filters by its last part; one that exists can be used as typed', async () => {
  const p = new FolderPicker(disk(), HOME)
  await p.go(HOME)
  await p.type('~/src/de')
  expect(p.listing.get()?.path).toBe('/Users/sam/src')
  expect(names(p.shown())).toEqual(['demo-app'])
  expect(p.typedFolder()).toBe(undefined)
  await p.type('~/src/demo-app')
  expect(p.typedFolder()).toBe('/Users/sam/src/demo-app')
  expect(p.missing()).toBe(undefined)
  expect(p.here()).toBe('/Users/sam/src')
})

test("a typed path that doesn't exist says so, with close names from the nearest folder and nothing created", async () => {
  const d = disk()
  const p = new FolderPicker(d, HOME)
  await p.go(HOME)
  await p.type('~/src/apii')
  expect(p.missing()).toEqual({ path: '/Users/sam/src/apii', text: "~/src/apii doesn't exist", suggestions: ['/Users/sam/src/api'],
    create: { name: 'apii', parent: '/Users/sam/src' } })
  expect(p.typedFolder()).toBe(undefined)
  expect(d.created).toEqual([])
})

test('a missing folder deeper down: close names from the nearest existing one, and nothing to create on the way', async () => {
  const p = new FolderPicker(disk(), HOME)
  await p.go(HOME)
  await p.type('~/scr/api')
  expect(p.missing()).toEqual({ path: '/Users/sam/scr/api', text: "~/scr/api doesn't exist", suggestions: ['/Users/sam/src/api'] })
  await expect(() => p.create()).rejects.toThrow('nothing to create')
})

test('Create it makes the folder on the computer, and it is the choice', async () => {
  const d = disk()
  const p = new FolderPicker(d, HOME)
  await p.go(HOME)
  await p.type('~/src/new-thing')
  expect(p.missing()?.text).toBe("~/src/new-thing doesn't exist")
  expect(await p.create()).toBe('/Users/sam/src/new-thing')
  expect(d.created).toEqual(['/Users/sam/src/new-thing'])
})

test('only the latest of quick typing lands', async () => {
  const d = disk()
  const p = new FolderPicker(d, HOME)
  await p.go(HOME)
  d.delay = true
  const first = p.type('~/Documents/')
  const second = p.type('~/src/')
  d.release()
  await Promise.all([first, second])
  expect(p.listing.get()?.path).toBe('/Users/sam/src')
})

test('hidden folders show only when asked, marked as hidden', async () => {
  const p = new FolderPicker(disk(), HOME)
  await p.go(HOME)
  expect(names(p.shown())).toEqual(['Documents', 'notes', 'src'])
  await p.showHidden(true)
  expect(p.shown().map((f) => `${f.name}${f.hidden ? ' (hidden)' : ''}`)).toEqual(['.config (hidden)', 'Documents', 'notes', 'src'])
})

test('Recent shows at the top folder only, filtered by the search, each with its name and path', async () => {
  const p = new FolderPicker(disk(), HOME)
  const recent = ['/Users/sam/src/api', '/Users/sam/src/web', '/Users/sam']
  await p.go(HOME)
  expect(p.recent(recent)).toEqual([{ name: 'api', path: '/Users/sam/src/api' }, { name: 'web', path: '/Users/sam/src/web' }, { name: '~', path: '/Users/sam' }])
  await p.type('we')
  expect(p.recent(recent)).toEqual([{ name: 'web', path: '/Users/sam/src/web' }])
  await p.type('')
  await p.go('/Users/sam/src')
  expect(p.recent(recent)).toEqual([])
})

test('up goes to the folder above; at home there is none', async () => {
  const p = new FolderPicker(disk(), HOME)
  await p.go('/Users/sam/src')
  expect(p.up()).toEqual({ label: '~', path: '/Users/sam' })
  await p.go(HOME)
  expect(p.up()).toBe(undefined)
})
