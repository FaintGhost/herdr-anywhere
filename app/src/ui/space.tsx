// A space. Wide screens draw it as the desktop does: the tab bar, the panes on the canvas, the status bar (herdr-app
// defaults/mods/tabs, mods/pane, mods/workspace-status). A phone gives the screen to the focused pane: a two-line
// header (the agent, where it is, Needs you), its terminal edge to edge, and one row under it (ui/pane-bar.tsx); the
// title opens the switcher, and a flick across the terminal goes to the next or previous tab.
import { cleanup, computed, keyboardFrame, safeAreaInsets, Scroll, signal, Text, View, windowSize } from 'nsh'
import { AlertDialog, Sheet } from 'nsh/base'
import type { Store } from '../store.ts'
import { layoutRects } from '../store.ts'
import { addresses, find, panes, terminalOf, type Node } from '../model/layout.ts'
import { focusedPaneOf, shownNode, spaceActiveTab, type Tab } from '../model/model.ts'
import { gitTail } from '../model/marks.ts'
import { ConnBanner, Glyph, IconButton, ProgramIcon, SpaceBadge, StatusDot, StatusMark, shortPath, useRev } from './kit.tsx'
import { t } from '../strings/index.ts'
import { TerminalView } from './terminal.tsx'
import { PaneBar } from './pane-bar.tsx'
import { startable } from '../model/programs.ts'
import type { TerminalSession } from './terminal-session.ts'

export type SpaceActions = {
  back: () => void
  newTab: (spaceId: string) => void
  rename: (kind: 'space' | 'tab', id: string, current: string) => void
  fontSize: () => number
  setFontSize: (size: number) => void
  /** Opens a terminal wherever it is (another space included). */
  open: (address: string) => void
  settings: () => void
}

const WIDE = 720

/** The program a tab is shown with: its agent's, else its first terminal's (defaults/mods/tabs). */
function tabIcon(s: Store, c: Tab) {
  const all = addresses(c.root)
  return s.program(all.find((a) => s.program(a).agent) ?? all[0]).icon
}

function TabBar(props: { store: Store; spaceId: string; actions: SpaceActions }) {
  const s = props.store
  const rev = useRev(s)
  const space = () => { rev(); return s.model.space(props.spaceId) }
  const active = () => { rev(); const sp = space(); return sp && spaceActiveTab(sp)?.id }
  const menu = async (c: Tab) => {
    const r = await AlertDialog.show({ title: s.tabLabel(space()!, c), presentation: 'actionSheet', actions: [
      { id: 'rename', label: t('rename') }, { id: 'close', label: t('closeTab'), role: 'destructive' }, { id: 'cancel', label: t('cancel'), role: 'cancel' }] })
    if (r === 'rename') props.actions.rename('tab', c.id, c.name)
    else if (r === 'close') s.closeTab(c.id)
  }
  return (
    <Scroll horizontal class="grow-0 bg-sidebar border-b border-border" contentClass="flex-row items-center gap-[3px] px-2 py-[5px]" scrollbar={false}>
      <Each of={space()?.tabs ?? []} key={(c) => c.id}>{(c) => {
        const on = () => active() === c().id
        const st = () => { rev(); return s.tabStatus(c()) }
        return (
          <View role="button" testID={`tab-${c().id}`} accessibilityLabel={s.tabLabel(space()!, c())} onPress={() => s.selectTab(c().id)} onLongPress={() => void menu(c())}
            class={`flex-row items-center gap-[7px] h-[29px] px-2.5 rounded-[7px] border ${on() ? 'bg-secondary border-border' : 'border-transparent active:bg-sidebar-accent'}`}>
            <ProgramIcon icon={(rev(), tabIcon(s, c()))} size={14} />
            <Text class={`text-[13px] max-w-[170px] ${on() ? 'text-foreground' : 'text-muted-foreground'}`} numberOfLines={1}>{(rev(), s.tabLabel(space()!, c()))}</Text>
            <If when={st() === 'working'}><StatusMark status="working" size={6} /></If>
            <If when={st() === 'blocked' || st() === 'done'}><StatusDot status={st()} size={6} /></If>
            <If when={on()}>
              <View role="button" testID={`close-tab-${c().id}`} accessibilityLabel={t('closeTab')} onPress={() => s.closeTab(c().id)} class="-mr-1 w-5 h-5 items-center justify-center rounded-[4px] active:bg-sidebar-accent">
                <Glyph name="close" size={12} class="tint-sidebar-foreground" />
              </View>
            </If>
          </View>
        )
      }}</Each>
      <View role="button" testID="new-tab" accessibilityLabel={t('newTab')} onPress={() => props.actions.newTab(props.spaceId)} class="w-[29px] h-[29px] items-center justify-center rounded-[7px] active:bg-sidebar-accent">
        <Glyph name="plus" size={14} />
      </View>
    </Scroll>
  )
}

function PaneHeader(props: { store: Store; node: Node; tab: Tab; focused: boolean }) {
  const s = props.store
  const rev = useRev(s)
  const addr = () => terminalOf(props.node)
  const name = () => { rev(); const a = addr(); return a ? s.paneName(a) : (() => { const c = props.node.content; return c && 'mod' in c ? c.mod : t('panel') })() }
  const cwd = () => { rev(); const t = s.term(addr()); return t?.cwd ? shortPath(t.cwd, s.home) : '' }
  const zoomed = () => { rev(); return props.tab.zoomed === props.node.id }
  const many = () => { rev(); return panes(props.tab.root).length > 1 }
  return (
    <View class="flex-row items-center h-[34px] pl-2.5 pr-0.5 gap-2 border-b border-border bg-background">
      <ProgramIcon icon={(rev(), s.program(addr()).icon)} size={14} />
      <Text class="text-[12.5px] font-medium text-foreground shrink-0 max-w-[45%]" numberOfLines={1}>{name()}</Text>
      <Text testID={`cwd-${props.node.id}`} class="flex-1 text-[12.5px] text-sidebar-foreground" numberOfLines={1} ellipsizeMode="head" accessibilityLabel={cwd()}>{cwd()}</Text>
      <If when={(rev(), s.statusOf(addr()))}>{(st) => <StatusMark status={st()} size={7} />}</If>
      <SmallButton name="split-right" label={t('splitRight')} testID={`split-right-${props.node.id}`} onPress={() => void s.splitPane(props.node.id, 'right')} />
      <SmallButton name="split-down" label={t('splitDown')} testID={`split-down-${props.node.id}`} onPress={() => void s.splitPane(props.node.id, 'down')} />
      <If when={many()}><SmallButton name={zoomed() ? 'unzoom' : 'zoom'} label={zoomed() ? t('unzoom') : t('zoom')} testID={`zoom-${props.node.id}`} onPress={() => s.zoom(props.node.id)} /></If>
      <SmallButton name="close" label={t('closePane')} testID={`close-${props.node.id}`} onPress={() => s.closePane(props.node.id)} />
    </View>
  )
}

function SmallButton(props: { name: Parameters<typeof Glyph>[0]['name']; label: string; testID: string; onPress: () => void }) {
  return (
    <View role="button" accessibilityLabel={props.label} testID={props.testID} onPress={props.onPress} class="w-8 h-8 items-center justify-center rounded-[6px] active:bg-accent">
      <Glyph name={props.name} size={14} class="tint-sidebar-foreground" />
    </View>
  )
}

function PaneBody(props: { store: Store; spaceId: string; node: Node; actions: SpaceActions; keys: boolean; onSession?: (s: TerminalSession) => void }) {
  const addr = terminalOf(props.node)
  return addr
    ? <TerminalView store={props.store} address={addr} fontSize={props.actions.fontSize()} keys={props.keys} onSession={props.onSession}
        zoom={(n) => props.actions.setFontSize(n)} swipe={(d) => props.store.stepTab(props.spaceId, d)} />
    : <View class="flex-1 items-center justify-center p-6"><Text class="text-[13px] text-sidebar-foreground text-center">{t('panelMod')}</Text></View>
}

/** A pane's frame on the canvas: rounded, its border the accent while it has focus (defaults/frame). */
const frame = (focused: boolean) => `rounded-[10px] overflow-hidden border ${focused ? 'border-chart-5' : 'border-border'} bg-background`

/** A phone: the focused pane, its header above it and its row under it. */
function PhoneSpace(props: { store: Store; spaceId: string; tab: Tab; actions: SpaceActions; back: () => void; menu: () => void }) {
  const s = props.store
  const rev = useRev(s)
  const node = () => { rev(); const f = focusedPaneOf(props.tab); return f ? find(props.tab.root, f) : undefined }
  const session = signal<TerminalSession | undefined>(undefined)
  const switching = signal(false)
  return (
    <View class="flex-1 bg-background">
      <PhoneHeader store={s} spaceId={props.spaceId} tab={props.tab} node={node()} actions={props.actions} back={props.back} menu={props.menu}
        openSwitcher={() => switching.set(true)} />
      <ConnBanner store={s} />
      {/* keyed by pane: another pane is another terminal */}
      <Each of={node() ? [node()!] : []} key={(n) => n.id}>{(n) => (
        <PaneBody store={s} spaceId={props.spaceId} node={n()} actions={props.actions} keys={false}
          onSession={(t) => { session.set(t); cleanup(() => { if (session() === t) session.set(undefined) }) }} />
      )}</Each>
      <Each of={session() ? [session()!] : []}>{(t) => {
        const p = () => { rev(); return s.program(t().address) }
        return <PaneBar store={s} session={t()} program={p().name} agent={!!p().agent} />
      }}</Each>
      <Switcher store={s} spaceId={props.spaceId} open={switching} actions={props.actions} />
    </View>
  )
}

/** Two short lines: the agent and its status (the title opens the switcher), then where it is; +N waiting and ⋯. */
function PhoneHeader(props: { store: Store; spaceId: string; tab: Tab; node: Node | undefined; actions: SpaceActions; back: () => void; menu: () => void; openSwitcher: () => void }) {
  const s = props.store
  const rev = useRev(s)
  const addr = () => (props.node ? terminalOf(props.node) : undefined)
  const name = () => { rev(); const a = addr(); return a ? s.paneName(a) : t('panel') }
  const status = () => { rev(); return s.statusOf(addr()) }
  const place = () => { rev(); const sp = s.model.space(props.spaceId); return sp ? `${s.spaceName(sp)} › ${s.tabLabel(sp, props.tab)}` : '' }
  // The others waiting on you, the longest wait first.
  const waiting = () => { rev(); return s.queue().filter((a) => a.address !== addr()) }
  return (
    <View testID="pane-header" class="flex-row items-center h-[46px] pl-0.5 pr-1 gap-0.5 bg-sidebar border-b border-border">
      <IconButton name="chevron-left" label={t('back')} testID="back" onPress={props.back} />
      <View role="button" testID="switcher" accessibilityLabel={t('switchPane', { name: name(), place: place() })} onPress={props.openSwitcher} class="flex-1 min-w-0 justify-center gap-[1px] active:opacity-70">
        <View class="flex-row items-center gap-1.5">
          <ProgramIcon icon={(rev(), s.program(addr()).icon)} size={15} />
          <Text class="text-[14.5px] font-semibold text-foreground shrink" numberOfLines={1}>{name()}</Text>
          <Glyph name="chevron-down" size={13} />
          <If when={status() === 'blocked'} else={<If when={status()}>{(st) => <StatusMark status={st()} size={7} />}</If>}>
            <View testID="header-needs-you" class="px-1.5 h-[18px] justify-center rounded-[5px] bg-chart-2/15">
              <Text class="text-[11px] font-medium text-chart-2">{t('needsYou')}</Text>
            </View>
          </If>
        </View>
        <Text class="text-[11.5px] text-sidebar-foreground" numberOfLines={1}>{place()}</Text>
      </View>
      <If when={waiting().length}>
        <View role="button" testID="next-waiting" accessibilityLabel={t('moreWaitingOpen', { n: waiting().length })} onPress={() => props.actions.open(waiting()[0].address)}
          class="px-2 h-7 justify-center rounded-[6px] bg-chart-2/15 active:opacity-70">
          <Text class="text-[11.5px] font-medium text-chart-2">{t('plusWaiting', { n: waiting().length })}</Text>
        </View>
      </If>
      <IconButton name="more" label={t('paneActions')} testID="space-more" onPress={props.menu} />
    </View>
  )
}

/** This space's tabs (and the panes of a split one), the agents of the other spaces, and new agents. */
function Switcher(props: { store: Store; spaceId: string; open: { (): boolean; set: (v: boolean) => void }; actions: SpaceActions }) {
  const s = props.store
  const rev = useRev(s)
  const space = () => { rev(); return s.model.space(props.spaceId) }
  const active = () => { rev(); const sp = space(); return sp && spaceActiveTab(sp)?.id }
  const others = () => { rev(); return s.agents().filter((a) => a.space !== props.spaceId) }
  const fresh = () => {
    rev()
    const have = s.installed.get('')
    return [...startable().filter((p) => p.agent && (!have || have.includes(p.run![0]))).map((p) => ({ key: p.key, name: p.name, icon: p.icon, argv: p.run })),
      { key: 'shell', name: t('shell'), icon: 'terminal', argv: undefined as string[] | undefined }]
  }
  const close = () => props.open.set(false)
  const row = 'flex-row items-center gap-2.5 h-11 px-2 rounded-[8px] active:bg-sidebar-accent'
  return (
    <Sheet open={props.open()} side="bottom" onOpenChange={(o) => props.open.set(o)} popupClass="bg-popover rounded-t-[14px] px-3 pt-3 pb-[env(safe-area-inset-bottom)]">
      <Scroll class="max-h-[520px]" contentClass="pb-2">
        <Text class="px-2 pb-1 text-[11.5px] font-medium text-sidebar-foreground">{(rev(), space() ? s.spaceName(space()!) : '')}</Text>
        <Each of={space()?.tabs ?? []} key={(c) => c.id}>{(c) => (
          <View>
            <View role="button" testID={`switch-tab-${c().id}`} onPress={() => { s.selectTab(c().id); close() }} class={`${row} ${active() === c().id ? 'bg-accent' : ''}`}>
              <ProgramIcon icon={(rev(), tabIcon(s, c()))} size={16} />
              <Text class="flex-1 text-[14px] text-foreground" numberOfLines={1}>{(rev(), s.tabLabel(space()!, c()))}</Text>
              <If when={(rev(), s.tabStatus(c()))}>{(st) => <StatusMark status={st()} size={7} />}</If>
            </View>
            <If when={panes(c().root).length > 1}>
              <Each of={panes(c().root)} key={(n) => n.id}>{(n) => (
                <View role="button" testID={`switch-pane-${n().id}`} onPress={() => { s.selectTab(c().id); s.focusPane(n().id); close() }} class={`${row} pl-8 h-9`}>
                  <ProgramIcon icon={(rev(), s.program(terminalOf(n())).icon)} size={14} />
                  <Text class="flex-1 text-[13px] text-muted-foreground" numberOfLines={1}>{(rev(), terminalOf(n()) ? s.paneName(terminalOf(n())) : t('panel'))}</Text>
                  <If when={(rev(), s.statusOf(terminalOf(n())))}>{(st) => <StatusMark status={st()} compact size={6} />}</If>
                </View>
              )}</Each>
            </If>
          </View>
        )}</Each>
        <If when={others().length}>
          <Text class="px-2 pt-3 pb-1 text-[11.5px] font-medium text-sidebar-foreground">{t('otherSpaces')}</Text>
          <Each of={others()} key={(a) => a.address}>{(a) => (
            <View role="button" testID={`switch-agent-${a().address}`} onPress={() => { close(); props.actions.open(a().address) }} class={row}>
              <ProgramIcon icon={(rev(), s.program(a().address).icon)} size={16} />
              <View class="flex-1 min-w-0">
                <Text class="text-[14px] text-foreground" numberOfLines={1}>{a().programName}</Text>
                <Text class="text-[11.5px] text-sidebar-foreground" numberOfLines={1}>{`${a().space_name} › ${a().tab_name}`}</Text>
              </View>
              <StatusMark status={a().status} size={7} />
            </View>
          )}</Each>
        </If>
        <Text class="px-2 pt-3 pb-1 text-[11.5px] font-medium text-sidebar-foreground">{t('newTab')}</Text>
        <View class="flex-row flex-wrap gap-1.5 px-1">
          <Each of={fresh()} key={(p) => p.key}>{(p) => (
            <View role="button" testID={`switch-new-${p().key}`} onPress={() => { close(); void s.newTab({ space: props.spaceId, argv: p().argv }).catch((e) => s.toast({ title: t('couldntStart'), body: String(e?.message ?? e), level: 'error' })) }}
              class="flex-row items-center gap-2 h-10 px-3 rounded-[8px] bg-secondary border border-border active:bg-accent">
              <ProgramIcon icon={p().icon} size={15} />
              <Text class="text-[13.5px] text-foreground">{p().name}</Text>
            </View>
          )}</Each>
        </View>
        <View role="button" testID="switch-new-folder" onPress={() => { close(); props.actions.newTab(props.spaceId) }} class={`${row} mt-1`}>
          <Glyph name="folder" size={16} />
          <Text class="flex-1 text-[13.5px] text-muted-foreground">{t('anotherFolder')}</Text>
        </View>
      </Scroll>
    </Sheet>
  )
}

/** A tablet or a wide window: the split tree, every pane on screen, one key bar for the focused one. */
function WidePanes(props: { store: Store; spaceId: string; tab: Tab; actions: SpaceActions }) {
  const s = props.store
  const rev = useRev(s)
  const box = signal({ w: 0, h: 0 })
  const sessions = new Map<string, TerminalSession>()
  const rects = computed(() => { rev(); const b = box(); return [...layoutRects(shownNode(props.tab), 0, 0, b.w, b.h)] })
  const focused = () => { rev(); return focusedPaneOf(props.tab) }
  const focusedSession = () => { rev(); const f = focused(); const a = f ? props.store.model.addressOf(f) : undefined; return a ? sessions.get(a) : undefined }
  const GAP = 8
  return (
    <View class="flex-1 bg-sidebar-primary">
      <View class="flex-1 m-1" onLayout={(b) => box.set({ w: b.size.width, h: b.size.height })}>
        <Each of={rects()} key={(r) => r[0]}>{(r) => {
          const n = () => find(props.tab.root, r()[0])
          return (
            <If when={n()}>{(node) => (
              <View onPress={() => s.focusPane(node().id)} class={`absolute ${frame(focused() === node().id)}`}
                style={{ left: r()[1].x + GAP / 2, top: r()[1].y + GAP / 2, width: Math.max(0, r()[1].w - GAP), height: Math.max(0, r()[1].h - GAP) }}>
                <PaneHeader store={s} node={node()} tab={props.tab} focused={focused() === node().id} />
                <PaneBody store={s} spaceId={props.spaceId} node={node()} actions={props.actions} keys={false}
                  onSession={(t) => { sessions.set(t.address, t); cleanup(() => sessions.delete(t.address)) }} />
              </View>
            )}</If>
          )
        }}</Each>
      </View>
      <Each of={focusedSession() ? [focusedSession()!] : []}>{(t) => <PaneBar store={s} session={t()} program={s.program(t().address).name} agent={!!s.program(t().address).agent} />}</Each>
    </View>
  )
}

/** The desktop's workspace-status bar for this space: its computer, its branch, the agents. */
function SpaceStatus(props: { store: Store; spaceId: string }) {
  const s = props.store
  const rev = useRev(s)
  const space = () => { rev(); return s.model.space(props.spaceId) }
  const branch = () => {
    rev()
    const sp = space()
    for (const c of sp?.tabs ?? []) for (const a of addresses(c.root)) { const f = s.model.folderInfo.get(a); if (f?.branch) return f.branch }
    return ''
  }
  const counts = () => { rev(); return s.counts() }
  return (
    <View class="flex-row items-center gap-4 h-7 px-3.5 bg-sidebar border-t border-border">
      <View class="flex-row items-center gap-1.5 shrink">
        <Glyph name={space()?.machine ? 'server' : 'monitor'} size={13} />
        <Text class="text-[11.8px] text-muted-foreground" numberOfLines={1}>{space()?.machine ?? t('thisComputer')}</Text>
      </View>
      <If when={branch()}>
        <View class="flex-row items-center gap-1.5 shrink">
          <Glyph name="branch" size={13} />
          <Text class="text-[11.8px] text-muted-foreground" numberOfLines={1}>{branch()}</Text>
        </View>
      </If>
      <View class="flex-row items-center gap-1.5">
        <View class="w-1.5 h-1.5 rounded-full bg-sidebar-foreground" />
        <Text class="text-[11.8px] text-muted-foreground" numberOfLines={1}>
          {`${counts().agents} ${counts().agents === 1 ? 'agent' : 'agents'}`}
          <If when={counts().needsYou}><Text class="text-chart-2">{` · ${t('needYou', { n: counts().needsYou })}`}</Text></If>
        </Text>
      </View>
    </View>
  )
}

export function SpaceScreen(props: { store: Store; spaceId: string; actions: SpaceActions }) {
  const s = props.store
  const rev = useRev(s)
  s.viewingTab = true
  cleanup(() => { s.viewingTab = false })
  const space = () => { rev(); return s.model.space(props.spaceId) }
  const tab = () => { rev(); const sp = space(); return sp && spaceActiveTab(sp) }
  const name = () => { rev(); const sp = space(); return sp ? s.spaceName(sp) : '' }
  const tail = () => {
    rev()
    for (const c of space()?.tabs ?? []) for (const a of addresses(c.root)) { const f = s.model.folderInfo.get(a); if (f?.branch) return gitTail(name(), f) }
    return ''
  }
  const color = () => { rev(); return s.spaceMarks()[props.spaceId] ?? '#22a99a' }
  const wide = () => windowSize().width >= WIDE
  const insets = safeAreaInsets()
  const typing = () => keyboardFrame().height > 0
  const menu = async () => {
    const current = tab()
    const pane = current ? focusedPaneOf(current) : undefined
    const phone = !wide()
    const r = await AlertDialog.show({ title: name(), presentation: 'actionSheet', actions: [
      ...(phone && pane ? [{ id: 'split-right', label: t('splitRight') }, { id: 'split-down', label: t('splitDown') }, { id: 'close-pane', label: t('closePane'), role: 'destructive' as const }] : []),
      ...(phone && current ? [{ id: 'rename-tab', label: t('renameTab') }] : []),
      { id: 'rename', label: t('renameSpace') }, { id: 'close', label: t('closeSpace'), role: 'destructive' },
      ...(phone ? [{ id: 'settings', label: t('settings') }] : []), { id: 'cancel', label: t('cancel'), role: 'cancel' }] })
    if (r === 'split-right' || r === 'split-down') void s.splitPane(pane, r === 'split-right' ? 'right' : 'down')
    else if (r === 'close-pane' && pane) s.closePane(pane)
    else if (r === 'rename-tab' && current) props.actions.rename('tab', current.id, current.name)
    else if (r === 'settings') props.actions.settings()
    else if (r === 'rename') props.actions.rename('space', props.spaceId, space()?.name ?? '')
    else if (r === 'close') {
      const ok = await AlertDialog.show({ title: t('closeTitle', { name: name() }), description: t('closeDetail'), actions: [
        { id: 'cancel', label: t('cancel'), role: 'cancel' }, { id: 'close', label: t('close'), role: 'destructive' }] })
      if (ok === 'close') { s.closeSpace(props.spaceId); props.actions.back() }
    }
  }
  return (
    // The key bar sits at the bottom: above the keyboard while it is up (NSH moves only scroll views clear of it).
    <View class="flex-1 bg-sidebar pt-[env(safe-area-inset-top)]" style={{ paddingBottom: typing() ? keyboardFrame().height : insets().bottom }}>
      <If when={wide() || !space()}><View class="flex-row items-center h-11 pl-1 pr-1 gap-2">
        <IconButton name="chevron-left" label={t('back')} testID="back" onPress={props.actions.back} />
        <SpaceBadge name={name()} color={color()} size={20} />
        <Text class="text-[15px] font-semibold text-foreground shrink" numberOfLines={1}>{name()}</Text>
        <Text class="flex-1 text-[12px] text-sidebar-foreground" numberOfLines={1}>{tail()}</Text>
        <IconButton name="settings" label={t('spaceActions')} testID="space-more" onPress={() => void menu()} />
      </View></If>
      <If when={space()} else={<View class="flex-1 items-center justify-center"><Text class="text-sidebar-foreground">{t('spaceClosed')}</Text></View>}>
        <If when={wide()}><TabBar store={s} spaceId={props.spaceId} actions={props.actions} /></If>
        <Each of={tab() ? [tab()!] : []} key={(t) => t.id}>{(t) => (
          <If when={wide()} else={<PhoneSpace store={s} spaceId={props.spaceId} tab={t()} actions={props.actions} back={props.actions.back} menu={() => void menu()} />}>
            <WidePanes store={s} spaceId={props.spaceId} tab={t()} actions={props.actions} />
          </If>
        )}</Each>
        <If when={wide() && !typing()}><SpaceStatus store={s} spaceId={props.spaceId} /></If>
      </If>
    </View>
  )
}
