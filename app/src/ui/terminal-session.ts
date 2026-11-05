// One pane's terminal on the phone: the web page (terminal-page.ts) says when it is laid out and what was typed;
// this attaches to herdr-core at that size, sends output to the page, and attaches again (resumed) after the
// line comes back, as herdr-app's terminal view does.
import type { Store } from '../store.ts'
import type { CloseReason, Stream } from '../hc/client.ts'
import { Signal } from '../store.ts'
import { PageChannel, ctrlKey, readPageMessage, type BarKey } from './terminal-page.ts'
import { findSince, sinceLabel, tailOf } from '../model/seen.ts'
import { t, type Key } from '../strings/index.ts'

export type SessionState = 'waiting' | 'live' | 'ended' | 'lost'
/** What fingers did on the page that the app acts on. */
export type Gestures = { zoom?: (size: number) => void; swipe?: (dir: 'next' | 'prev') => void; link?: (url: string) => void
  selected?: (text: string) => void; tap?: () => void }

const WHY: Record<string, Key> = {
  exited: 'programExited',
  killed: 'terminalClosed',
  lost: 'terminalLost',
  finished: 'terminalFinished',
}

export class TerminalSession {
  readonly state = new Signal<SessionState>('waiting')
  readonly why = new Signal('')
  readonly ctrl = new Signal(false)
  /** Scrolled back from the live bottom. */
  readonly away = new Signal(false)
  private channel: PageChannel
  private stream?: Stream
  private size?: { cols: number; rows: number }
  private attaching = false
  private attachedOnce = false
  private copying?: (text: string) => void
  private off: () => unknown
  private disposed = false
  // What you saw when you last looked (before this opening), the screen's last lines now, and whether this opening
  // has asked for its mark.
  private before?: { at: number; tail: string[] }
  private lines?: string[]
  private marking = false

  constructor(private store: Store, readonly address: string, post: (m: string) => void, later?: (f: () => void, ms: number) => number,
    private opts: { observe?: boolean; on?: Gestures } = {}) {
    this.channel = new PageChannel(post, later)
    this.off = store.conn.sub((c) => {
      if (c === 'ready' && this.state.get() === 'lost') void this.attach()
    })
  }

  /** A message from the page. */
  page(data: string) {
    const m = readPageMessage(data)
    if (!m) return
    if (m.t === 'ready') {
      this.size = { cols: m.cols, rows: m.rows }
      this.channel.ready()
      if (!this.stream) void this.attach()
      else if (!this.opts.observe) this.stream.resize(m.cols, m.rows)
    } else if (m.t === 'size') {
      this.size = { cols: m.cols, rows: m.rows }
      if (!this.opts.observe) this.stream?.resize(m.cols, m.rows)
    } else if (m.t === 'input') {
      let d = m.data
      if (this.ctrl.get()) {
        d = ctrlKey(d)
        this.ctrl.set(false)
      }
      this.stream?.write(d)
    } else if (m.t === 'copied') {
      this.copying?.(m.text)
      this.copying = undefined
    } else if (m.t === 'zoom') this.opts.on?.zoom?.(m.size)
    else if (m.t === 'swipe') this.opts.on?.swipe?.(m.dir)
    else if (m.t === 'link') this.opts.on?.link?.(m.url)
    else if (m.t === 'selected') this.opts.on?.selected?.(m.text)
    else if (m.t === 'tap') this.opts.on?.tap?.()
    else if (m.t === 'away') this.away.set(m.away)
    else if (m.t === 'tail') {
      // The page settled after output: the first time after the history replayed, find where the new output starts.
      this.lines = m.lines
      if (this.before && !this.marking && this.stream) { this.marking = true; this.channel.send({ t: 'text' }) }
    } else if (m.t === 'text' && this.before) {
      const i = findSince(m.lines, this.before.tail)
      if (i !== undefined) this.channel.send({ t: 'mark', line: m.base + i, label: sinceLabel(this.before.at, Date.now()) })
    }
  }

  /** Back to the live bottom. */
  bottom() { this.channel.send({ t: 'bottom' }) }

  /** The page was torn down or reloads: output waits until it is ready again. */
  pageLost() {
    this.channel.lost()
  }

  key(name: BarKey) { this.channel.send({ t: 'key', name }) }
  toggleCtrl() { this.ctrl.set(!this.ctrl.get()) }
  paste(text: string) { this.channel.send({ t: 'paste', data: text }) }
  focus() { this.channel.send({ t: 'focus' }); this.stream?.focus(true) }
  setTheme(dark: boolean) { this.channel.send({ t: 'theme', dark }) }
  setFontSize(size: number) { this.channel.send({ t: 'fontSize', size }) }

  /** The selection, or the screen's text without one. */
  copy(): Promise<string> {
    return new Promise((resolve) => {
      this.copying = resolve
      this.channel.send({ t: 'copy' })
    })
  }

  dispose() {
    this.disposed = true
    if (this.lines && !this.opts.observe) this.store.saw(this.address, tailOf(this.lines))
    this.off()
    this.stream?.detach()
    this.stream = undefined
  }

  private async attach() {
    if (this.attaching || this.disposed || !this.size || !this.store.connected) return
    this.attaching = true
    try {
      const resumed = this.attachedOnce
      this.channel.reset()
      const s = await this.store.attach(this.address, this.size, {
        data: (b) => this.channel.write(b),
        close: (r) => this.closed(r),
      }, { ...(resumed ? { resumed: true } : {}), ...(this.opts.observe ? { observe: true } : {}) })
      if (this.disposed) return s.detach()
      this.stream = s
      if (!resumed && !this.opts.observe) this.before = this.store.lastSeen(this.address)
      this.attachedOnce = true
      this.state.set('live')
      this.why.set('')
    } catch (e: any) {
      const kind = e?.kind ?? ''
      if (kind === 'disconnected') this.state.set('lost')
      else {
        this.state.set('ended')
        this.why.set(kind === 'not_found' ? t('terminalLost') : kind === 'finished' ? t('terminalFinished') : String(e?.message ?? e))
      }
    } finally {
      this.attaching = false
    }
  }

  private closed(r: CloseReason) {
    this.stream = undefined
    if (this.disposed || r.reason === 'detached') return
    if (r.reason === 'disconnected') {
      this.state.set('lost')
      this.why.set(t('reconnecting'))
      return
    }
    this.state.set('ended')
    this.why.set(WHY[r.reason] ? t(WHY[r.reason]) : t('terminalEnded', { reason: r.reason }))
  }
}
