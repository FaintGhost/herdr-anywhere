// The progress page (experimental, Settings turns it on), as the sample scene shows it: what needs the
// user on top, then what just finished, then each task with the tasks under it.
// Version one is view only: the computer files what was said and decides when a
// task is done or asks something; the page shows it and opens the pane that asks.
// Everything comes from `herdr-anywhere track tree --json` on the computer (model/progress.ts); nothing is kept here.
import { cleanup, colorScheme, Scroll, signal, Text, View } from 'nsh'
import type { Store } from '../store.ts'
import { explain } from '../store.ts'
import { closed, findTask, flagsOf, flat, items, langLine, paneOf, parseTree, pathOf, stageText, subLine, taskOn, trackLine, type Task, type Tree, type View as PView } from '../model/progress.ts'
import { lang, t as w } from '../strings/index.ts'
import { Glyph, IconButton, statusLabel } from './kit.tsx'
import { ViewSwitch, type ViewSwitchProps } from './view-switch.tsx'
import { alertsFor, Outcomes, type Alert } from '../model/progress-alerts.ts'

export type ProgressActions = {
  open: (v: PView) => void
  back: () => void
  /** The pane's own screen. */
  openPane: (addr: string) => void
  /** The switch at the top, to the agent list and back. */
  view: () => ViewSwitchProps
  settings: () => void
}

/** One reading of the tree for every progress screen, read again every few seconds while one is open. */
export class ProgressData {
  tree = signal<Tree | null>(null)
  error = signal('')
  private users = 0
  private timer: ReturnType<typeof setInterval> | undefined
  /** Rings for each task that newly needs the user (model/progress-alerts.ts); root.tsx sets it. */
  onAlert?: (a: Alert) => void
  private outcomes = new Outcomes()
  /** The language the computer was last told, so the sorting agent writes in the phone's (root.tsx keeps it in prefs). */
  told?: { get: () => string; set: (l: string) => void }
  constructor(private store: Store, private every = 4000, private keep?: { load: () => Promise<string | null>; save: (v: string) => void }) {
    void keep?.load().then((v) => { if (v) this.outcomes = Outcomes.from(v) }).catch(() => {})
  }

  /** The user opened a task: a notification for it counts as seen. */
  opened(task: string) {
    this.outcomes.opened(task, Date.now())
    this.keep?.save(this.outcomes.save(Date.now()))
  }

  paneFor(task: string): string | undefined {
    const t = this.tree()
    const x = t ? findTask(t, task) : undefined
    return x ? paneOf(x)?.addr : undefined
  }

  /** The open task a pane works on, for the agent list's 在做 line. */
  taskOn(addr: string): Task | undefined {
    const t = this.tree()
    return t ? taskOn(t, addr) : undefined
  }

  /** Whether a pane works on an open task: its own "needs you" alert is then left to the task's. */
  covers(addr: string | undefined): boolean {
    const t = this.tree()
    if (!t || !addr) return false
    return flat(t).some(({ task: x }) => x.pane_rows.some((p) => p.id === addr && !p.handed_on))
  }

  async refresh() {
    try {
      if (this.told && this.told.get() !== lang()) {
        const r = await this.store.exec(langLine(lang()), { timeout: 15 })
        if (r.code === 0) this.told.set(lang())
      }
      const r = await this.store.exec(trackLine(['tree', '--json']), { timeout: 15 })
      if (r.code !== 0) throw new Error(r.stderr.trim() || `exit ${r.code}`)
      const next = parseTree(r.stdout)
      const rang = alertsFor(this.tree(), next, this.outcomes, Date.now())
      this.tree.set(next)
      this.error.set('')
      if (rang.length) {
        this.keep?.save(this.outcomes.save(Date.now()))
        for (const a of rang) this.onAlert?.(a)
      }
    } catch (e) {
      this.error.set(explain(e))
    }
  }

  use() {
    if (this.users++ === 0) { void this.refresh(); this.timer = setInterval(() => void this.refresh(), this.every) }
    cleanup(() => { if (--this.users === 0 && this.timer) { clearInterval(this.timer); this.timer = undefined } })
  }
}

// Badge colours per stage: yellow for done-and-waiting, blue for doing, orange when it
// waits on you or is stuck, grey for the rest; a darker shade of each in dark mode.
const BADGE: Record<string, [string, string]> = {
  waiting: ['#fde2c8', '#5a3418'], stuck: ['#fde2c8', '#5a3418'], review: ['#fdf0b8', '#4d4113'], doing: ['#dceafe', '#1d3557'],
}
const GROUP_DOT: Record<string, string> = {
  waiting: 'bg-chart-2', stuck: 'bg-chart-2', review: 'bg-chart-5', doing: 'bg-chart-1', parked: 'bg-border', done: 'bg-chart-3', dropped: 'bg-border',
}

function Badge(props: { group: string }) {
  const bg = () => { const c = BADGE[props.group]; return c ? c[colorScheme() === 'dark' ? 1 : 0] : undefined }
  return (
    <View class={`px-2 h-[22px] justify-center rounded-[6px] ${bg() ? '' : 'bg-secondary'}`} style={bg() ? { backgroundColor: bg() } : undefined}>
      <Text class={`text-[12px] ${props.group === 'dropped' ? 'text-sidebar-foreground' : 'text-foreground'}`}>{stageText(props.group)}</Text>
    </View>
  )
}

function Section(props: { label: string; right?: string }) {
  return (
    <View class="flex-row items-center px-4 pt-3 pb-1.5">
      <Text class="text-[12.5px] text-muted-foreground">{props.label}</Text>
      <View class="flex-1" />
      <If when={props.right}><Text class="text-[11.5px] text-sidebar-foreground">{props.right}</Text></If>
    </View>
  )
}

function SmallButton(props: { label: string; testID: string; onPress: () => void; primary?: boolean }) {
  return (
    <View role="button" testID={props.testID} onPress={props.onPress}
      class={`h-8 px-3 justify-center rounded-[7px] ${props.primary ? 'bg-primary active:opacity-80' : 'bg-secondary border border-border active:bg-accent'}`}>
      <Text class={`text-[13px] font-medium ${props.primary ? 'text-primary-foreground' : 'text-foreground'}`}>{props.label}</Text>
    </View>
  )
}

function TopBar(props: { title: string; back?: () => void; right?: any }) {
  return (
    // A task's page is where its whole title is read, so a long one wraps.
    <View class="flex-row items-center min-h-11 py-1 px-2 gap-1">
      <If when={props.back}>
        <IconButton name="chevron-left" label={w('back')} testID="progress-back" onPress={() => props.back!()} />
      </If>
      <Text class={`flex-1 text-[17px] leading-[22px] font-semibold text-foreground ${props.back ? '' : 'pl-2'}`} numberOfLines={3}>{props.title}</Text>
      {props.right}
    </View>
  )
}

const CARD = 'mx-3 mb-2 px-3.5 py-3 rounded-[12px] bg-background border border-border'

/** A task as a card: its name and stage, then its own tasks as ✓/· lines, or one line on where it is. */
function TaskCard(props: { task: Task; actions: ProgressActions; testID: string; children?: any }) {
  const t = () => props.task
  return (
    <View class={CARD}>
      <View role="button" testID={props.testID} onPress={() => props.actions.open({ name: 'task', id: t().id })} class="active:opacity-70 gap-1">
        <View class="flex-row items-start gap-2">
          <Text class="flex-1 text-[15px] font-semibold text-foreground">{t().outcome}</Text>
          <Badge group={t().group} />
        </View>
        <If when={items(t()).length}>
          <View class="h-px bg-border my-1.5" />
          <Each of={items(t())}>{(i) => <Text class={`text-[13.5px] ${i().done ? 'text-foreground' : 'text-muted-foreground'}`}>{`${i().done ? '✓' : '·'} ${i().text}`}</Text>}</Each>
        </If>
        <If when={!items(t()).length && subLine(t())}>
          <Text class={`text-[13px] ${t().waiting || flagsOf(t()).length ? 'text-chart-2' : 'text-muted-foreground'}`} numberOfLines={2}>{subLine(t())}</Text>
        </If>
      </View>
      {props.children}
    </View>
  )
}

/** What needs the user: an agent asking something, or stuck. The pane that asks opens from here. */
function NeedsCard(props: { task: Task; actions: ProgressActions }) {
  const t = () => props.task
  const p = () => paneOf(t())
  return (
    <View>
      <If when={t().path?.length}><Text class="mx-4 mb-1 text-[11.5px] text-sidebar-foreground" numberOfLines={1}>{(t().path ?? []).join(' › ')}</Text></If>
      <TaskCard task={t()} actions={props.actions} testID={`needs-task-${t().id}`}>
        <If when={p()}>
          <View class="flex-row items-center gap-1.5 mt-2">
            <SmallButton testID={`needs-task-${t().id}-open`} label={w('openNamed', { name: p()?.name ?? p()?.addr ?? '' })} onPress={() => props.actions.openPane(p()!.addr)} />
          </View>
        </If>
      </TaskCard>
    </View>
  )
}

/** Something that finished in the last day: where it sits, its name, and what the agent said at the end. */
function DoneRow(props: { task: Task; actions: ProgressActions }) {
  const t = () => props.task
  return (
    <View role="button" testID={`done-${t().id}`} onPress={() => props.actions.open({ name: 'task', id: t().id })} class={`${CARD} active:opacity-70 gap-0.5`}>
      <If when={t().path?.length}><Text class="text-[11.5px] text-sidebar-foreground" numberOfLines={1}>{(t().path ?? []).join(' › ')}</Text></If>
      <View class="flex-row items-start gap-2">
        <Text class="flex-1 text-[15px] font-semibold text-foreground">{`✓ ${t().outcome}`}</Text>
      </View>
      <If when={t().said}><Text class="text-[13px] text-muted-foreground" numberOfLines={2}>{t().said}</Text></If>
    </View>
  )
}

/** A top-level task in 进行中: its name, then a card per task under it; one with nothing under it is a card itself. */
function TopTask(props: { task: Task; actions: ProgressActions; needs: Set<string> }) {
  const t = () => props.task
  // A task in 要你处理 shows there only.
  const kids = () => t().children.filter((c) => !closed(c.group) && !props.needs.has(c.id))
  return (
    <If when={t().children.length} else={<TaskCard task={t()} actions={props.actions} testID={`task-${t().id}`} />}>
      <View>
        <View role="button" testID={`top-${t().id}`} onPress={() => props.actions.open({ name: 'task', id: t().id })} class="flex-row items-center px-4 pt-1 pb-2 gap-2 active:opacity-70">
          <Text class="flex-1 text-[15px] font-semibold text-foreground">{t().outcome}</Text>
          <Text class="text-[12px] text-sidebar-foreground">{`${t().done}/${t().total}`}</Text>
        </View>
        <Each of={kids()} key={(c) => c.id}>{(c) => <TaskCard task={c()} actions={props.actions} testID={`task-${c().id}`} />}</Each>
      </View>
    </If>
  )
}

function Status(props: { data: ProgressData }) {
  const err = props.data.error
  return (
    <If when={err()}>
      <View testID="progress-error" class="mx-4 my-2 p-3 rounded-[10px] border border-border bg-background">
        <Text class="text-[13px] text-foreground">{w('cantReadProgress')}</Text>
        <Text class="text-[12px] text-muted-foreground" numberOfLines={4}>{err()}</Text>
      </View>
    </If>
  )
}

export function ProgressHome(props: { data: ProgressData; actions: ProgressActions }) {
  props.data.use()
  const tree = props.data.tree
  const showDone = signal(false)
  const needs = () => new Set((tree()?.needsYou ?? []).map((t) => t.id))
  // A top-level task waiting on the user shows only in 要你处理.
  const open = () => (tree()?.tasks ?? []).filter((t) => !closed(t.group) && !(needs().has(t.id) && !t.children.length))
  const done = () => [...(tree()?.tasks ?? []).filter((t) => closed(t.group)), ...(tree()?.closed ?? [])]
  return (
    <View class="flex-1">
      <View class="flex-row items-center h-12 pl-3 pr-1.5 gap-2">
        <View class="flex-1"><ViewSwitch {...props.actions.view()} /></View>
        <IconButton name="settings" label={w('settings')} testID="settings" onPress={props.actions.settings} />
      </View>
      <Status data={props.data} />
      <Scroll class="flex-1" testID="progress-body">
        <If when={tree()?.organizerWaits}>
          <View testID="organizer-waits" class={CARD}>
            <Text class="text-[15px] font-semibold text-foreground">{w('organizerWaitsTitle')}</Text>
            <Text class="text-[13px] text-muted-foreground mt-1">{w('organizerWaitsBody')}</Text>
            <View class="flex-row mt-2">
              <SmallButton testID="organizer-waits-open" primary label={w('openPaneBtn')} onPress={() => props.actions.openPane(tree()!.organizerWaits!.addr)} />
            </View>
          </View>
        </If>
        <If when={tree()?.needsYou.length}>
          <Section label={w('secNeedsYou')} />
          <Each of={tree()!.needsYou} key={(t) => t.id}>{(t) => <NeedsCard task={t()} actions={props.actions} />}</Each>
        </If>
        <If when={tree()?.justDone.length}>
          <Section label={w('secJustDone')} />
          <Each of={tree()!.justDone} key={(t) => t.id}>{(t) => <DoneRow task={t()} actions={props.actions} />}</Each>
        </If>
        <Section label={w('secInProgress')} />
        <If when={tree()?.queue}>
          <Text testID="queue-line" class="mx-4 mb-2 text-[13px] text-muted-foreground">{w('queueLeft', { n: tree()!.queue })}</Text>
        </If>
        <Each of={open()} key={(t) => t.id}>{(t) => <TopTask task={t()} actions={props.actions} needs={needs()} />}</Each>
        <If when={tree() && !open().length}>
          <Text testID="progress-empty" class="mx-4 my-2 text-[13px] text-muted-foreground">{w('progressEmpty')}</Text>
        </If>
        <If when={done().length}>
          <View role="button" testID="progress-done-toggle" onPress={() => showDone.set(!showDone())} class="h-9 px-4 justify-center">
            <Text class="text-[13px] text-muted-foreground">{`${w('doneCount', { n: done().length })} ${showDone() ? '▾' : '›'}`}</Text>
          </View>
          <If when={showDone()}><Each of={done()} key={(t) => t.id}>{(t) => <TaskCard task={t()} actions={props.actions} testID={`task-${t().id}`} />}</Each></If>
        </If>
        <View class="h-24" />
      </Scroll>
    </View>
  )
}

export function TaskScreen(props: { data: ProgressData; id: string; actions: ProgressActions }) {
  props.data.use()
  props.data.opened(props.id)
  const task = () => { const t = props.data.tree(); return t ? findTask(t, props.id) : undefined }
  const path = () => { const t = props.data.tree(); return t ? pathOf(t, props.id) : [] }
  return (
    <View class="flex-1">
      <TopBar title={task()?.outcome ?? ''} back={props.actions.back} />
      <Status data={props.data} />
      <Scroll class="flex-1">
        <If when={task()}>{(t) => (
          <View class="px-4 gap-2">
            <If when={path().length}><Text class="text-[12px] text-sidebar-foreground">{path().join(' › ')}</Text></If>
            <View class="flex-row items-center gap-2"><Badge group={t().group} /></View>
            <If when={t().std}><Text class="text-[13px] text-muted-foreground">{w('doneWhen', { std: t().std ?? '' })}</Text></If>
            <If when={subLine(t())}><Text class="text-[14px] text-foreground">{subLine(t())}</Text></If>
            <Each of={flagsOf(t()).slice(subLine(t()) === flagsOf(t())[0] ? 1 : 0)}>{(f) => <Text class="text-[13px] text-chart-2">{f()}</Text>}</Each>
            <If when={t().children.length}>
              <Text class="text-[12.5px] text-muted-foreground mt-1">{w('tasksUnder')}</Text>
              <Each of={t().children} key={(c) => c.id}>{(c) => (
                <View role="button" testID={`sub-${c().id}`} onPress={() => props.actions.open({ name: 'task', id: c().id })}
                  class="flex-row items-center gap-2 py-1.5 active:opacity-70">
                  <View class={`w-2 h-2 rounded-full ${GROUP_DOT[c().group] ?? 'bg-border'}`} />
                  <Text class="flex-1 text-[14px] text-foreground" numberOfLines={1}>{c().outcome}</Text>
                  <Text class="text-[12px] text-sidebar-foreground">{stageText(c().group)}</Text>
                </View>
              )}</Each>
            </If>
            <Each of={t().pane_rows}>{(p) => (
              <View role="button" testID={`task-pane-${p().id}`} onPress={() => { if (p().found && p().state === 'live' && p().id) props.actions.openPane(p().id!) }}
                class="flex-row items-center gap-2 py-1.5 active:opacity-70">
                <Glyph name="terminal" size={13} />
                <Text class="flex-1 text-[13.5px] text-foreground" numberOfLines={1}>{[p().name, p().id].filter(Boolean).join(' · ')}</Text>
                <Text class="text-[12px] text-sidebar-foreground">{p().handed_on ? w('paneMovedOn') : p().found ? w('paneTurns', { status: statusLabel(p().status), n: p().turns_since ?? 0 }) : w('paneMissing')}</Text>
              </View>
            )}</Each>
            <Each of={t().evidence}>{(e) => <Text class="text-[12.5px] text-muted-foreground font-mono" numberOfLines={1}>{e()}</Text>}</Each>
          </View>
        )}</If>
        <View class="h-24" />
      </Scroll>
    </View>
  )
}
