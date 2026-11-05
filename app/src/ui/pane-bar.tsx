// The row under a pane's terminal on a phone: the composer; for a blocked agent, its own choices as its screen shows
// them (model/menu.ts), or the keys when they can't be read; and, while the keyboard is up, the key row under them.
import { cleanup, effect, Keyboard, keyboardFrame, signal, Text, View } from 'nsh'
import { Input } from 'nsh/base'
import type { Store } from '../store.ts'
import { asks } from '../model/answers.ts'
import { shownOrder, type Option } from '../model/menu.ts'
import type { BarKey } from './terminal-page.ts'
import type { TerminalSession } from './terminal-session.ts'
import { ChoiceRow, Glyph, useRev, useSignal } from './kit.tsx'
import { t } from '../strings/index.ts'

const ROW_KEYS: { key: BarKey | 'ctrl'; label: string }[] = [
  { key: 'esc', label: 'esc' }, { key: 'btab', label: '⇧tab' }, { key: 'tab', label: 'tab' }, { key: 'ctrl', label: 'ctrl' },
  { key: 'ctrlc', label: '^C' }, { key: 'left', label: '←' }, { key: 'up', label: '↑' }, { key: 'down', label: '↓' }, { key: 'right', label: '→' },
]
const FALLBACK_KEYS: { key: string; label: string }[] = [
  { key: 'esc', label: 'esc' }, { key: 'up', label: '↑' }, { key: 'down', label: '↓' }, { key: 'left', label: '←' }, { key: 'right', label: '→' }, { key: 'enter', label: 'enter' },
]

/** How long Codex has to start and send its first report before its silence is worth a line. */
const CODEX_QUIET_MS = 5000

export function PaneBar(props: { store: Store; session: TerminalSession; program: string; agent: boolean }) {
  const s = props.store
  const rev = useRev(s)
  const addr = props.session.address
  const status = () => { rev(); return s.term(addr)?.status }
  const blocked = () => status()?.state === 'blocked'
  // Codex before 0.163 sends no status, so it never alerts and looks like one that has nothing to say.
  const waited = signal(false)
  const quietTimer = setTimeout(() => waited.set(true), CODEX_QUIET_MS)
  cleanup(() => clearTimeout(quietTimer))
  const codexQuiet = () => { rev(); return waited() && s.program(addr).key === 'codex' && !s.term(addr)?.reported }
  const menu = () => { rev(); return s.menuFor(addr) }
  const read = () => { rev(); return s.menuRead(addr) }
  // After a choice that wants text (here or on home), or "type instead": the composer, until the agent stops being blocked.
  const focusFirst = s.wantsComposerFocus(addr)
  const typing = signal(focusFirst)
  const composing = signal(false)
  effect(() => { if (!blocked()) typing.set(false) })
  const mode = () => {
    if (!blocked() || typing()) return 'compose'
    if (menu()) return 'choices'
    if (read() && status()?.kind !== 'question') return 'keys'
    return 'compose'
  }
  const pick = async (o: Option) => {
    try { await s.answer(addr, { keys: o.keys }) } catch {}
    if (o.typed) typing.set(true)
  }
  const hint = () => (blocked() && status()?.kind === 'question' && !menu() ? asks(status()) : '') || (props.agent ? t('tellProgram', { name: props.program }) : t('typeCommand'))
  return (
    <View class="bg-sidebar border-t border-border">
      <If when={codexQuiet()}><Text testID="codex-quiet" class="px-3 pt-1.5 text-[12px] text-sidebar-foreground">{t('codexQuiet')}</Text></If>
      <If when={mode() === 'choices' ? menu() : undefined}>{(m) => (
        <View testID="answers" class="flex-row items-center gap-1.5 pl-2 pr-1 py-1">
          <ChoiceRow testID="choices">
            {shownOrder(m()).map((o) => (
              <View role="button" testID={`choice-${o.n}`} accessibilityLabel={`${o.n}. ${o.full}`} onPress={() => void pick(o)}
                onLongPress={() => s.toast({ title: `${o.n}. ${o.full}`, level: 'info' })}
                class={`h-9 max-w-[230px] px-3.5 justify-center rounded-[8px] ${o.selected ? 'bg-primary active:opacity-80' : 'bg-secondary border border-border active:bg-accent'}`}>
                <Text class={`text-[14px] font-medium ${o.selected ? 'text-primary-foreground' : 'text-foreground'}`} numberOfLines={1}>{`${o.n}. ${o.label}`}</Text>
              </View>
            ))}
          </ChoiceRow>
          <BarButton glyph="keyboard" label={t('typeInstead')} testID="show-composer" onPress={() => typing.set(true)} />
        </View>
      )}</If>
      <If when={mode() === 'keys'}>
        <View testID="keys-fallback" class="px-2 py-1 gap-1">
          <Text class="text-[11.5px] text-sidebar-foreground px-0.5">{t('cantReadChoices', { name: props.program })}</Text>
          <View class="flex-row gap-1">
            {FALLBACK_KEYS.map((k) => <Key label={k.label} testID={`key-${k.key}`} onPress={() => void s.answer(addr, { keys: [k.key] }).catch(() => {})} />)}
          </View>
        </View>
      </If>
      <If when={mode() === 'compose'}>
        <Composer store={s} session={props.session} hint={hint()} focus={focusFirst || typing() || (blocked() && status()?.kind === 'question' && !menu())}
          focused={(f) => { composing.set(f); if (f) s.focusComposerOn(undefined) }} />
      </If>
      <If when={keyboardFrame().height > 0}><KeyRow session={props.session} keepTerminal={() => !composing()} /></If>
    </View>
  )
}

function Composer(props: { store: Store; session: TerminalSession; hint: string; focus: boolean; focused: (f: boolean) => void }) {
  const addr = props.session.address
  const text = signal('')
  const pending = useSignal(props.store.pending)
  const waiting = () => pending().filter((p) => p.address === addr).length
  const send = () => {
    const typed = text()
    if (!typed.trim()) return
    text.set('')
    void props.store.compose(addr, typed).catch((e) => props.store.toast({ title: t('couldntSend'), body: String(e?.message ?? e), level: 'error' }))
  }
  return (
    <View>
      <If when={waiting()}>
        <Text testID="pending" class="px-3 pt-1 text-[11.5px] text-sidebar-foreground">{t('pendingSend', { n: waiting() })}</Text>
      </If>
      <View testID="composer" class="flex-row items-center gap-1.5 px-2 py-1">
        <Key label="esc" testID="key-esc" onPress={() => props.session.key('esc')} grow={false} />
        <Input testID="compose-input" value={text()} onChange={(t) => text.set(t)} placeholder={props.hint} autoFocus={props.focus}
          submitBehavior="submit" onSubmit={send} onFocus={() => props.focused(true)} onBlur={() => props.focused(false)}
          class="flex-1 h-9 rounded-[8px] border border-input bg-background px-3 text-[14px] text-foreground placeholder:text-sidebar-foreground" />
        <If when={text().trim()} else={<BarButton glyph="keyboard" label={t('typeInTerminal')} testID="show-keyboard" onPress={() => props.session.focus()} />}>
          <BarButton glyph="send" label={t('send')} testID="compose-send" primary onPress={send} />
        </If>
      </View>
    </View>
  )
}

/** Directly above the keyboard: the keys a phone keyboard lacks, straight to the pane, and one to put it away. */
function KeyRow(props: { session: TerminalSession; keepTerminal: () => boolean }) {
  const ctrl = useSignal(props.session.ctrl)
  const press = (k: BarKey | 'ctrl') => {
    if (k === 'ctrl') props.session.toggleCtrl()
    else props.session.key(k)
    // Typing in the terminal goes on there after a key (Enter included); typing in the composer stays in it.
    if (props.keepTerminal()) props.session.focus()
  }
  return (
    <View testID="key-row" class="flex-row items-center gap-1 px-1.5 pb-1">
      {ROW_KEYS.map((k) => (
        <View role="button" focusable={false} testID={`row-${k.key}`} accessibilityLabel={k.label} onPress={() => press(k.key)}
          class={`flex-1 h-8 items-center justify-center rounded-[6px] ${k.key === 'ctrl' && ctrl() ? 'bg-primary' : 'bg-secondary active:bg-accent'}`}>
          <Text class={`text-[12px] font-mono ${k.key === 'ctrl' && ctrl() ? 'text-primary-foreground' : 'text-foreground'}`}>{k.label}</Text>
        </View>
      ))}
      <View role="button" focusable={false} testID="hide-keyboard" accessibilityLabel={t('hideKeyboard')} onPress={() => Keyboard.dismiss()}
        class="w-9 h-8 items-center justify-center rounded-[6px] bg-secondary active:bg-accent">
        <Glyph name="keyboard-down" size={15} class="tint-foreground" />
      </View>
    </View>
  )
}

function Key(props: { label: string; testID: string; onPress: () => void; grow?: boolean }) {
  return (
    <View role="button" focusable={false} testID={props.testID} accessibilityLabel={props.label} onPress={props.onPress}
      class={`${props.grow === false ? 'px-2.5' : 'flex-1'} h-9 items-center justify-center rounded-[8px] bg-secondary active:bg-accent`}>
      <Text class="text-[13px] font-mono text-foreground">{props.label}</Text>
    </View>
  )
}

function BarButton(props: { glyph: string; label: string; testID: string; onPress: () => void; primary?: boolean }) {
  return (
    <View role="button" focusable={false} testID={props.testID} accessibilityLabel={props.label} onPress={props.onPress}
      class={`w-10 h-9 items-center justify-center rounded-[8px] ${props.primary ? 'bg-primary active:opacity-80' : 'active:bg-accent'}`}>
      <Glyph name={props.glyph} size={18} class={props.primary ? 'tint-primary-foreground' : 'tint-muted-foreground'} />
    </View>
  )
}
