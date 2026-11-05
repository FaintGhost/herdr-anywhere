// The first step of New space and New tab: a search that filters Recent and the folders as one types and also takes a typed `~/…` or `/…`
// path, crumbs, an up row, the folders one level at a time, "Show hidden", and Use this folder. A typed folder that
// doesn't exist gets a card with close names, Create folder and Cancel (model/folders.ts).
import { Scroll, signal, Text, View } from 'nsh'
import { Input } from 'nsh/base'
import { crumbs, FolderPicker, tilde, type FolderApi } from '../model/folders.ts'
import { Glyph, useSignal } from './kit.tsx'
import { listOf, t } from '../strings/index.ts'

const row = 'flex-row items-center gap-3 px-1 py-[9px] min-h-[46px] rounded-(--radius) active:bg-sidebar-accent'

export function FolderPickerView(props: { title: string; api: FolderApi; home: string; start: string; recent: string[]; onPick: (path: string) => void }) {
  const p = new FolderPicker(props.api, props.home)
  const listing = useSignal(p.listing)
  const text = useSignal(p.text)
  const error = useSignal(p.error)
  const hidden = signal(false)
  const busy = signal(false)
  const createError = signal('')
  void p.go(props.start)
  const show = (path: string) => tilde(path, props.home)
  // What follows the listing and the search, which the signals above stand for.
  const at = <T,>(f: () => T) => () => { listing(); text(); return f() }
  const shown = at(() => p.shown())
  const missing = at(() => p.missing())
  const typedFolder = at(() => p.typedFolder())
  const here = at(() => p.here())
  const up = at(() => p.up())
  const recent = at(() => p.recent(props.recent))
  const path = at(() => crumbs(listing()?.path ?? props.start, props.home))
  const search = (t: string) => { createError.set(''); void p.type(t) }
  const browse = (to: string) => { createError.set(''); void p.type('').then(() => p.go(to)) }
  const create = async () => {
    if (busy()) return
    busy.set(true)
    createError.set('')
    try {
      props.onPick(await p.create())
    } catch (e) {
      createError.set(e instanceof Error ? e.message : String(e))
    } finally {
      busy.set(false)
    }
  }
  return (
    <View class="gap-1.5" style={{ flexShrink: 1 }}>
      <View class="flex-row items-center">
        <Text class="flex-1 text-[15px] font-semibold text-foreground">{props.title}</Text>
        <View role="button" testID="show-hidden" accessibilityState={{ checked: hidden() }} onPress={() => { hidden.set(!hidden()); void p.showHidden(hidden()) }}
          class="px-2 py-1.5 rounded-[8px] active:bg-sidebar-accent">
          <Text class={`text-[13px] ${hidden() ? 'text-foreground' : 'text-muted-foreground'}`}>{hidden() ? t('hideHidden') : t('showHidden')}</Text>
        </View>
      </View>
      <View class="flex-row items-center gap-2 rounded-[10px] bg-secondary px-2.5">
        <Glyph name="search" size={16} />
        <Input testID="folder-search" placeholder={t('searchOrPath')} value={text()} onChange={search} autoCapitalize="none" autoCorrect={false}
          returnKeyType="go" onSubmit={() => { const f = p.typedFolder(); if (f) props.onPick(f) }}
          class="flex-1 bg-transparent py-2 text-[15px] text-foreground placeholder:text-muted-foreground" />
        <If when={text()}>
          <View role="button" testID="folder-clear" accessibilityLabel={t('clear')} onPress={() => search('')} class="w-7 h-7 items-center justify-center rounded-full active:bg-accent">
            <Glyph name="close" size={15} />
          </View>
        </If>
      </View>
      <If when={typedFolder()}>{(f) => (
        <View role="button" testID="folder-use-typed" onPress={() => props.onPick(f())} class={row}>
          <Glyph name="plus" size={18} class="tint-foreground" />
          <Text class="flex-1 text-[14px] font-mono text-foreground" numberOfLines={2}>{t('usePath', { path: show(f()) })}</Text>
        </View>
      )}</If>
      <View testID="crumbs" class="flex-row flex-wrap items-center">
        <Each of={path()} key={(c) => c.path}>{(c, i) => (
          <View class="flex-row items-center">
            <If when={i() > 0}><Glyph name="chevron-right" size={12} /></If>
            <View role="button" testID={`crumb-${i()}`} onPress={() => browse(c().path)} class="px-1.5 py-1.5 rounded-[6px] active:bg-sidebar-accent">
              <Text class={`text-[13px] ${i() === path().length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{c().label}</Text>
            </View>
          </View>
        )}</Each>
      </View>
      {/* "handled": a row answers the first tap while the search has the keyboard up (e2e/android.sh) */}
      <Scroll class="max-h-[420px]" style={{ flexShrink: 1 }} contentClass="pb-1" keyboardShouldPersistTaps="handled">
        <If when={recent().length}>
          <Text class="px-1 pt-1 pb-0.5 text-[12px] text-muted-foreground">{t('recentProjects')}</Text>
          <Each of={recent().slice(0, 5)} key={(f) => f.path}>{(f, i) => (
            <View role="button" testID={`recent-${i()}`} accessibilityLabel={listOf(f().name, show(f().path))} onPress={() => browse(f().path)} class={row}>
              <Glyph name="folder" size={18} />
              <View class="flex-1 min-w-0">
                <Text class="text-[15px] text-foreground" numberOfLines={1}>{f().name}</Text>
                <Text class="text-[12px] font-mono text-muted-foreground" numberOfLines={1}>{show(f().path)}</Text>
              </View>
              <Glyph name="chevron-right" size={14} />
            </View>
          )}</Each>
        </If>
        <If when={up()}>{(u) => (
          <View role="button" testID="folder-up" accessibilityLabel={t('upTo', { name: u().label })} onPress={() => browse(u().path)} class={row}>
            <Glyph name="chevron-left" size={16} />
            <Text class="flex-1 text-[15px] text-muted-foreground" numberOfLines={1}>{u().label}</Text>
          </View>
        )}</If>
        <If when={recent().length && shown().length}>
          <Text class="px-1 pt-2 pb-0.5 text-[12px] text-muted-foreground">{t('foldersIn', { name: path().at(-1)?.label ?? '~' })}</Text>
        </If>
        <Each of={shown()} key={(f) => f.name}>{(f) => (
          <View role="button" testID={`folder-${f().name}`} accessibilityLabel={t('folderRow', { name: f().name })}
            onPress={() => browse(listing()!.path === '/' ? `/${f().name}` : `${listing()!.path}/${f().name}`)} class={row}>
            <Glyph name="folder" size={18} />
            <Text class={`flex-1 text-[15px] ${f().hidden ? 'text-muted-foreground' : 'text-foreground'}`} numberOfLines={2}>{f().name}</Text>
            <If when={f().git}><Text class="text-[11px] text-sidebar-foreground">git</Text></If>
            <Glyph name="chevron-right" size={14} />
          </View>
        )}</Each>
        <If when={listing()?.truncated}><Text class="px-1 pt-2 text-[12px] text-muted-foreground">{t('tooManyFolders')}</Text></If>
        <If when={listing() && !shown().length && !missing() && !typedFolder()}>
          <Text class="px-1 py-3 text-[14px] text-muted-foreground">{text().trim() ? t('noFoldersMatch') : t('noFoldersHere')}</Text>
        </If>
      </Scroll>
      <If when={missing()}>{(m) => (
        <View testID="folder-missing" class="rounded-[12px] bg-secondary px-4 py-3 gap-1.5">
          <Text class="text-[15px] font-medium text-foreground">{m().text}</Text>
          <Each of={m().suggestions} key={(s) => s}>{(s, i) => (
            <View role="button" testID={`folder-suggest-${i()}`} onPress={() => search(show(s()))} class="py-0.5 active:opacity-60">
              <Text class="text-[14px] text-primary">{t('didYouMean', { path: show(s()) })}</Text>
            </View>
          )}</Each>
          <If when={m().create} else={<Text class="text-[13px] text-muted-foreground">{t('parentMissing')}</Text>}>{(c) => (
            <View class="gap-2">
              <Text class="text-[13px] text-muted-foreground">{t('createIn', { name: c().name, path: show(c().parent) })}</Text>
              <View class="flex-row gap-2">
                <View role="button" testID="folder-create" disabled={busy()} onPress={() => void create()} class="flex-1 rounded-[10px] bg-primary py-2.5 items-center active:opacity-80">
                  <Text class="text-[15px] font-medium text-primary-foreground">{busy() ? t('creating') : t('createFolder')}</Text>
                </View>
                <View role="button" testID="folder-cancel" onPress={() => search('')} class="flex-1 rounded-[10px] border border-border py-2.5 items-center active:opacity-70">
                  <Text class="text-[15px] text-foreground">{t('cancel')}</Text>
                </View>
              </View>
            </View>
          )}</If>
          <If when={createError()}><Text class="text-[12px] text-destructive">{createError()}</Text></If>
        </View>
      )}</If>
      <If when={error()}><Text testID="folder-error" class="text-[13px] text-destructive">{error()}</Text></If>
      <If when={here() && !missing()}>
        <View role="button" testID="folder-use" accessibilityLabel={t('useThisFolderPath', { path: show(here() ?? '') })} onPress={() => { const h = here(); if (h) props.onPick(h) }}
          class="mt-1 rounded-[10px] bg-primary py-3 items-center active:opacity-80">
          <Text class="text-[15px] font-medium text-primary-foreground">{t('useThisFolder')}</Text>
        </View>
      </If>
    </View>
  )
}
