// A tab's arrangement: herdr-app's layout node tree (herdr-app/src/layout.rs), kept as the JSON it is stored as,
// so fields this app doesn't know survive a round trip through the shared document.

export type Size = { weight: number } | { px: number }
export type Content =
  | { terminal: string }
  | { mod: string; props?: unknown }
  | { tab: string; pane?: unknown }
  | { agent: string }

export type Node = {
  id: string
  type: 'block' | 'row' | 'column' | 'stack'
  content?: Content
  children?: Node[]
  active?: string
  size?: Size
  hidden?: boolean
  [k: string]: unknown
}

export type Axis = 'row' | 'column'

export const block = (id: string, content: Content): Node => ({ id, type: 'block', content })
export const pane = (id: string, address: string): Node => block(id, { terminal: address })
export const modBlock = (id: string, name: string, props?: unknown): Node =>
  block(id, props === undefined ? { mod: name } : { mod: name, props })
export const container = (id: string, axis: Axis, children: Node[]): Node => ({ id, type: axis, children })

export const terminalOf = (n: Node): string | undefined =>
  n.type === 'block' && n.content && 'terminal' in n.content ? n.content.terminal : undefined
export const isPane = (n: Node) => n.type === 'block' && !!n.content && ('terminal' in n.content || 'mod' in n.content)
const isLine = (n: Node) => n.type === 'row' || n.type === 'column'

export function walk(n: Node): Node[] {
  return [n, ...(n.children ?? []).flatMap(walk)]
}
export const find = (root: Node, id: string) => walk(root).find((n) => n.id === id)
export const parentOf = (root: Node, id: string) => walk(root).find((n) => n.children?.some((c) => c.id === id))
export const panes = (root: Node) => walk(root).filter(isPane)
export const terminalBlocks = (root: Node) => walk(root).filter((n) => terminalOf(n) !== undefined)
export const addresses = (root: Node) => terminalBlocks(root).map((n) => terminalOf(n)!)

const weightOf = (s: Size | undefined): number | undefined => (s === undefined ? 1 : 'weight' in s ? s.weight : undefined)

/** Puts `node` beside `target` along `axis` (after it): reuses a parent on that axis, else wraps the target. */
export function split(root: Node, target: string, axis: Axis, node: Node, containerId: string): boolean {
  const parent = parentOf(root, target)
  if (parent && parent.type === axis) {
    const c = parent.children!
    const i = c.findIndex((n) => n.id === target)
    const share = c[i].size && 'weight' in c[i].size! ? (c[i].size as { weight: number }).weight : 1
    if (!(c[i].size && 'px' in c[i].size!)) c[i].size = { weight: share / 2 }
    c.splice(i + 1, 0, { ...node, size: { weight: share / 2 } })
    return true
  }
  const t = find(root, target)
  if (!t) return false
  const old: Node = { ...t }
  const slot = old.size
  delete old.size
  for (const k of Object.keys(t)) delete t[k]
  Object.assign(t, container(containerId, axis, [old, node]))
  if (slot !== undefined) t.size = slot
  return true
}

/** Removes `id`. A row/column left with one child gives way to it; empty ones vanish; stacks stay. */
export function remove(root: Node, id: string): Node | undefined {
  const gone = removeInner(root, id)
  if (gone) collapse(root)
  return gone
}

function removeInner(node: Node, id: string): Node | undefined {
  const c = node.children
  if (!c) return undefined
  const i = c.findIndex((n) => n.id === id)
  if (i >= 0) {
    const [removed] = c.splice(i, 1)
    if (isLine(node)) {
      // Its share goes back to the neighbor it was split from (the one before it, else the next).
      const gone = weightOf(removed.size)
      const n = c[Math.max(i - 1, 0)]
      const w = n && weightOf(n.size)
      if (gone !== undefined && n && w !== undefined) n.size = { weight: w + gone }
    }
    if (node.type === 'stack' && node.active === id) {
      const next = c[i] ?? c.at(-1)
      if (next) node.active = next.id
      else delete node.active
    }
    return removed
  }
  for (const n of c) {
    const r = removeInner(n, id)
    if (r) return r
  }
  return undefined
}

function collapse(node: Node) {
  if (!node.children) return
  for (const n of node.children) collapse(n)
  if (node.type === 'stack') return
  node.children = node.children.filter((n) => !(isLine(n) && n.children!.length === 0))
  node.children = node.children.map((n) => {
    if (isLine(n) && n.children!.length === 1) {
      const only = { ...n.children![0] }
      if (n.size === undefined) delete only.size
      else only.size = n.size
      return only
    }
    return n
  })
}

/** Swaps two nodes' places; each place keeps its size. */
export function swap(root: Node, a: string, b: string): boolean {
  const na = find(root, a)
  const nb = find(root, b)
  if (!na || !nb) return false
  if (walk(na).some((n) => n.id === b) || walk(nb).some((n) => n.id === a)) return false
  const ca = structuredCloneNode(na)
  const cb = structuredCloneNode(nb)
  const [sa, sb] = [na.size, nb.size]
  replaceInPlace(na, cb, sa)
  replaceInPlace(nb, ca, sb)
  return true
}

function replaceInPlace(target: Node, from: Node, size: Size | undefined) {
  for (const k of Object.keys(target)) delete target[k]
  Object.assign(target, from)
  if (size === undefined) delete target.size
  else target.size = size
}

export function structuredCloneNode(n: Node): Node {
  return JSON.parse(JSON.stringify(n))
}

/** Rewrites every id and terminal address (qualifying for another machine, or back). Mod props are left alone. */
export function mapIds(n: Node, map: (s: string) => string): Node {
  const out: Node = { ...n, id: map(n.id) }
  if (n.type === 'block' && n.content && 'terminal' in n.content) out.content = { ...n.content, terminal: map(n.content.terminal) }
  if (n.type === 'stack' && n.active) out.active = map(n.active)
  if (Array.isArray(n.floating)) {
    out.floating = (n.floating as any[]).map((f) => ({
      ...f, id: map(f.id),
      content: f.content && 'terminal' in f.content ? { ...f.content, terminal: map(f.content.terminal) } : f.content,
    }))
  }
  if (n.children) out.children = n.children.map((c) => mapIds(c, map))
  return out
}
