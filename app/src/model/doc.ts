// The `herdr-app` core document (one per machine) and this screen's private view (herdr-app/src/mirror.rs).
// Only identity and structure are shared; focus, zoom, settled tabs and "seen" stay on this screen.
import { type Node, find, mapIds, panes } from './layout.ts'
import { Model, type Recent, local, qualify } from './model.ts'

export type SharedTab = { id: string; name: string; root: Node }
export type SharedSpace = { id: string; name: string; folder: string; tabs: SharedTab[] }
export type Document = { spaces: SharedSpace[] }

export type View = {
  active?: string
  spaces: Record<string, string | undefined>
  tabs: Record<string, { focused?: string; before: string[]; zoomed?: string; settled?: number }>
  recent: Recent[]
  attention: Record<string, { word?: string; seen: boolean }>
}

const emptyRoot = (): Node => ({ id: '', type: 'row', children: [] })

export function parseDoc(value: unknown): Document {
  const v = (value ?? {}) as any
  const spaces = Array.isArray(v.spaces) ? v.spaces : []
  return {
    spaces: spaces.map((s: any) => ({
      id: String(s?.id ?? ''),
      name: String(s?.name ?? ''),
      folder: String(s?.folder ?? ''),
      tabs: (Array.isArray(s?.tabs) ? s.tabs : []).map((t: any) => ({
        id: String(t?.id ?? ''),
        name: String(t?.name ?? ''),
        root: t?.root && typeof t.root === 'object' ? (t.root as Node) : emptyRoot(),
      })),
    })),
  }
}

export function captureDoc(model: Model, machine: string | undefined): Document {
  const map = (s: string) => local(s, machine)
  return {
    spaces: model.spaces.filter((s) => s.machine === machine).map((s) => ({
      id: map(s.id),
      name: s.name,
      folder: s.folder,
      tabs: s.tabs.map((t) => ({ id: map(t.id), name: t.name, root: mapIds(t.root, map) })),
    })),
  }
}

/** Replaces one machine's spaces with a document, keeping this screen's choices that still apply. */
export function replaceDoc(value: unknown, model: Model, machine: string | undefined) {
  const doc = parseDoc(value)
  const view = captureView(model)
  let at = model.spaces.findIndex((s) => s.machine === machine)
  if (at < 0) at = model.spaces.length
  model.spaces = model.spaces.filter((s) => s.machine !== machine)
  const map = (s: string) => qualify(s, machine)
  const spaces = doc.spaces.map((s) => ({
    id: map(s.id),
    name: s.name,
    folder: s.folder,
    machine,
    active: undefined,
    tabs: s.tabs.map((t) => ({ id: map(t.id), name: t.name, root: mapIds(t.root, map), before: [] as string[] })),
  }))
  model.spaces.splice(at, 0, ...spaces)
  model.orderSpaces()
  applyView(view, model)
}

export function captureView(model: Model): View {
  const view: View = { active: model.active, spaces: {}, tabs: {}, recent: [...model.recent], attention: {} }
  for (const s of model.spaces) view.spaces[s.id] = s.active
  for (const t of model.tabs()) view.tabs[t.id] = { focused: t.focused, before: [...t.before], zoomed: t.zoomed, settled: t.settled }
  for (const [a, s] of model.agents) view.attention[a] = { word: s.word, seen: s.seen }
  return view
}

export function applyView(view: View, model: Model) {
  for (const s of model.spaces) {
    const active = view.spaces[s.id]
    s.active = active !== undefined && s.tabs.some((t) => t.id === active) ? active : undefined
    for (const t of s.tabs) {
      const v = view.tabs[t.id]
      if (v) {
        t.focused = v.focused && find(t.root, v.focused) ? v.focused : undefined
        t.zoomed = v.zoomed && find(t.root, v.zoomed) ? v.zoomed : undefined
        t.before = v.before.filter((id) => find(t.root, id))
        t.settled = v.settled
      }
      if (t.focused === undefined) t.focused = panes(t.root)[0]?.id
    }
  }
  model.active = view.active !== undefined && model.space(view.active) ? view.active : model.spaces[0]?.id
  model.recent = [...view.recent]
  for (const [a, s] of Object.entries(view.attention)) {
    if (!model.agents.has(a)) model.agents.set(a, { word: s.word, seen: s.seen, seq: 0, since: 0 })
  }
}
