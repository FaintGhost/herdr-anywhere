// The app: pairing on first launch, then home ⇄ space ⇄ settings over one live store, with alerts and sheets
// over every screen.
import { cleanup, computed, effect, platform, safeAreaInsets, setColorScheme, signal, Text, Video, View } from 'nsh'
import { createNavStack, NavPage, NavStack } from 'nsh/base'
import type { Store } from '../store.ts'
import { folderApi, parseInvite, type Link, type Linker, type Tunnel } from '../link.ts'
import type { PrefStore } from '../prefs.ts'
import { Alerts, type AlertKind } from '../alerts.ts'
import { followPage, notifyFromPage } from '../page.ts'
import { HomeScreen } from './home.tsx'
import { SpaceScreen } from './space.tsx'
import { SettingsScreen } from './settings.tsx'
import { PairScreen } from './pair.tsx'
import { NewSheet, RenameSheet, type NewTarget, type RenameTarget } from './sheets.tsx'
import { PeekSheet } from './peek.tsx'
import { useSignal } from './kit.tsx'
import { t } from '../strings/index.ts'

export type RootDeps = {
  linker: Linker
  prefs: PrefStore
  makeStore: (linker: Linker) => Store
  device: string
  fetcher?: typeof fetch
  /** The address of the web page the app was opened at (a `#pair=` link pairs by itself). */
  pairLink?: string
  /** The web page's origin: the computer that serves it, so the code alone pairs with it. */
  origin?: string
  /** After that link paired: it leaves the page's address. */
  pairLinkUsed?: () => void
  /** Opens on Settings: for the iOS e2e, since a script cannot tap the simulator. */
  opensSettings?: boolean
  /** TailPocket, in the phone apps: pairing by the invite `serve --tailcat` shows, and the tunnel the Linker uses. */
  tunnel?: Tunnel
}

type Route = { name: 'home' } | { name: 'space'; id: string } | { name: 'settings' }

function Toasts(props: { store: Store; open: (terminal: string) => void }) {
  const toasts = useSignal(props.store.toasts)
  const insets = safeAreaInsets()
  return (
    <View class="absolute left-3 right-3 gap-2" style={{ top: insets().top + 12 }} pointerEvents="box-none">
      <Each of={toasts()} key={(t) => t.id}>{(t) => (
        <View role="button" testID={`toast-${t().id}`} onPress={() => { props.store.dismiss(t().id); if (t().action?.terminal) props.open(t().action!.terminal!) }}
          class="flex-row items-center gap-2.5 rounded-[12px] bg-popover border border-border px-3.5 py-2.5 shadow-md">
          <View class={`w-2 h-2 rounded-full ${t().level === 'error' ? 'bg-chart-2' : 'bg-chart-3'}`} />
          <View class="flex-1">
            <Text class="text-[14px] font-medium text-foreground" numberOfLines={1}>{t().title}</Text>
            <If when={t().body}><Text class="text-[12px] text-muted-foreground" numberOfLines={2}>{t().body}</Text></If>
          </View>
        </View>
      )}</Each>
    </View>
  )
}

// Herdr's sounds (assets/sounds): the app's own files on a phone (android/build.sh ships them), and data: URIs in a
// browser, since a web package ships only imported files and a TSX bundle can't import an .mp3 (scripts/sounds-data.sh).
const SOUND_FILES: Record<AlertKind, string> = { blocked: 'asset:/assets/sounds/request.mp3', done: 'asset:/assets/sounds/done.mp3' }

/** Each sound playing now, as a player nobody sees; it goes when it ends. */
function AlertSounds(props: { alerts: Alerts }) {
  const sounds = useSignal(props.alerts.sounds)
  const src = signal<Record<AlertKind, string> | null>(platform.os === 'web' ? null : SOUND_FILES)
  if (platform.os === 'web') void import('./sounds-data.ts').then((m) => src.set({ blocked: m.BLOCKED, done: m.DONE }))
  return (
    <Each of={src() ? sounds() : []} key={(s) => s.id}>{(s) => (
      <Video testID={`sound-${s().kind}`} src={src()![s().kind]} pointerEvents="none" accessibilityElementsHidden
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
        onEnd={() => props.alerts.ended(s().id)} onError={() => props.alerts.ended(s().id)} />
    )}</Each>
  )
}

function Connected(props: { deps: RootDeps; store: Store; link: Link; unpaired: () => void }) {
  const { store, deps } = props
  const nav = createNavStack<Route>(props.deps.opensSettings ? [{ name: 'home' }, { name: 'settings' }] : [{ name: 'home' }])
  const newTarget = signal<NewTarget | null>(null)
  const renaming = signal<RenameTarget | null>(null)
  const peeking = signal<string | null>(null)
  const folders = folderApi(deps.linker, deps.fetcher)
  const prefs = useSignal(deps.prefs.prefs)
  store.wants = (k) => (k === 'blocked' ? deps.prefs.prefs.get().alertBlocked : deps.prefs.prefs.get().alertDone)
  // The page (web-host.js) or the Android activity says whether the app is in front; on iOS it is while it runs.
  const alerts = new Alerts({ notify: (t, kind) => notifyFromPage({ title: t.title, body: t.body, terminal: t.action?.terminal, kind }) })
  store.onAlert = (kind, toast) => alerts.ring(kind, toast, store.appActive)
  const offPage = followPage({ front: (f) => { store.appActive = f }, open: (a) => openTerminal(a) })
  const offConn = store.conn.sub((c) => { if (c === 'unpaired') props.unpaired() })
  cleanup(() => { offConn(); offPage(); store.disconnect() })
  void store.connect().catch(() => {})

  const openSpace = (id: string) => {
    store.selectSpace(id)
    const top = nav.routes().at(-1)
    if (top?.name === 'space' && top.id === id) return
    nav.popToRoot()
    nav.push({ name: 'space', id })
  }
  const openTerminal = (addr: string) => {
    if (!store.focusTerminal(addr)) return peeking.set(addr)
    const sp = store.model.activeSpace()
    if (sp) openSpace(sp.id)
  }
  const page = (r: Route) =>
    r.name === 'space'
      ? <NavPage headerVisible={false} class="bg-sidebar">
          <SpaceScreen store={store} spaceId={r.id} actions={{
            back: () => nav.pop(), newTab: (space) => newTarget.set({ kind: 'tab', space }),
            rename: (kind, id, current) => renaming.set({ kind, id, current }), fontSize: () => prefs().fontSize,
            setFontSize: (n) => deps.prefs.set({ fontSize: n }), open: (a) => openTerminal(a), settings: () => nav.push({ name: 'settings' }),
          }} />
        </NavPage>
      : r.name === 'settings'
      ? <NavPage headerVisible={false} class="bg-sidebar">
          <SettingsScreen store={store} prefs={deps.prefs} link={props.link} linker={deps.linker} fetcher={deps.fetcher} back={() => nav.pop()} forget={() => { deps.linker.forget() }} />
        </NavPage>
      : <NavPage headerVisible={false} class="bg-sidebar">
          <HomeScreen store={store} actions={{
            openSpace, openAgent: (a) => openTerminal(a.address), peek: (addr) => peeking.set(addr),
            newMenu: () => newTarget.set({ kind: 'space' }), settings: () => nav.push({ name: 'settings' }),
            rename: (kind, id, current) => renaming.set({ kind, id, current }),
          }} />
        </NavPage>
  return (
    <View class="flex-1 bg-sidebar">
      <NavStack state={nav} class="flex-1">{(r) => page(r)}</NavStack>
      <NewSheet store={store} target={newTarget} folders={folders} onStarted={(r) => openSpace(r.space)} />
      <RenameSheet store={store} target={renaming} />
      <PeekSheet store={store} address={peeking} fontSize={() => prefs().fontSize} />
      <Toasts store={store} open={openTerminal} />
      <AlertSounds alerts={alerts} />
    </View>
  )
}

export function Root(props: { deps: RootDeps }) {
  const { deps } = props
  const loaded = signal(false)
  const link = useSignal(deps.linker.link)
  const prefs = useSignal(deps.prefs.prefs)
  const unpairedMessage = signal('')
  effect(() => setColorScheme(prefs().appearance))
  Promise.all([deps.linker.load(), deps.prefs.load()]).finally(() => loaded.set(true))
  // A store per link: pairing again with another computer starts over.
  let made: { key: string; store: Store } | undefined
  const store = computed(() => {
    const l = link()
    if (!l) return (made = undefined)
    const key = `${l.url} ${l.token}`
    if (made?.key !== key) made = { key, store: deps.makeStore(deps.linker) }
    return made.store
  })
  const opened = deps.pairLink
  // A link pairs once: after that, pairing again starts from an empty field.
  const pairInitial = signal(opened && (opened.includes('#pair=') || parseInvite(opened)) ? opened : undefined)
  return (
    <If when={loaded()} else={<View class="flex-1 bg-background" />}>
      <If when={link() && !unpairedMessage()} else={
        <PairScreen device={deps.device} fetcher={deps.fetcher} origin={deps.origin} tunnel={deps.tunnel} message={unpairedMessage()} initial={pairInitial()}
          onPaired={(l) => {
            if (pairInitial()) { pairInitial.set(undefined); deps.pairLinkUsed?.() }
            unpairedMessage.set('')
            deps.linker.set(l)
          }} />
      }>
        <Each of={store() ? [store()!] : []}>{(s) => (
          <Connected deps={deps} store={s()} link={link()!} unpaired={() => unpairedMessage.set(t('forgotten'))} />
        )}</Each>
      </If>
    </If>
  )
}
