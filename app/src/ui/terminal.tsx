// A pane's terminal: xterm.js in a WebView, and "↓ latest" while it is scrolled back. The row under it (composer,
// choices, keys) is ui/pane-bar.tsx.
import { cleanup, Clipboard, colorScheme, effect, openUrl, platform, Text, untracked, View, WebView } from 'nsh'
import type { Store } from '../store.ts'
import { terminalPage, webViewScrollable } from './terminal-page.ts'
import { TerminalSession } from './terminal-session.ts'
import { useSignal } from './kit.tsx'
import { t } from '../strings/index.ts'

export type TerminalGestures = { zoom?: (size: number) => void; swipe?: (dir: 'next' | 'prev') => void }

export function TerminalView(props: { store: Store; address: string; fontSize?: number; keys?: boolean; observe?: boolean; onSession?: (s: TerminalSession) => void } & TerminalGestures) {
  let web: any
  const session = new TerminalSession(props.store, props.address, (m) => web?.postMessage(m), undefined, { observe: props.observe, on: {
    zoom: (n) => props.zoom?.(n),
    swipe: (d) => props.swipe?.(d),
    link: (url) => { void openUrl(url).catch(() => {}) },
    selected: (text) => { void Clipboard.writeText(text).then(() => props.store.toast({ title: t('copied'), level: 'info' })) },
  } })
  props.onSession?.(session)
  cleanup(() => session.dispose())
  const state = useSignal(session.state)
  const why = useSignal(session.why)
  const away = useSignal(session.away)
  const html = untracked(() => terminalPage({ dark: colorScheme() === 'dark', fontSize: props.fontSize ?? 13, scrollback: 5000 }))
  effect(() => session.setTheme(colorScheme() === 'dark'))
  effect(() => { if (props.fontSize) session.setFontSize(props.fontSize) })
  return (
    <View class="flex-1 bg-background">
      <View class="flex-1">
        <WebView ref={(r: any) => { web = r }} html={html} testID={`terminal-${props.address}`} class="flex-1" scrollable={webViewScrollable(platform.os)}
          onLoadStart={() => session.pageLost()} onMessage={(e) => session.page(e.data)} />
        <If when={away() && state() === 'live'}>
          <View role="button" testID="latest" accessibilityLabel={t('backToLatest')} onPress={() => session.bottom()}
            class="absolute right-3 bottom-3 h-8 px-3 flex-row items-center rounded-full bg-secondary border border-border active:bg-accent">
            <Text class="text-[12.5px] font-medium text-foreground">{t('latest')}</Text>
          </View>
        </If>
        <If when={state() !== 'live'}>
          <View class="absolute left-0 right-0 bottom-0 px-3 py-2 bg-popover border-t border-border">
            <Text testID="terminal-state" class="text-[13px] text-muted-foreground">
              {state() === 'waiting' ? t('connecting') : state() === 'lost' ? t('reconnecting') : why()}
            </Text>
          </View>
        </If>
      </View>
    </View>
  )
}
