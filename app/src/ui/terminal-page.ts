// The terminal's web page: xterm.js draws the screen and reads the keyboard; the stream stays in the app.
// It draws as Herdr's terminal does (herdr-app src/settings.rs, src/terminal.rs): JetBrains Mono at medium weight with
// Symbols Nerd Font for prompt icons, cells 1.15 times the font's height, 14 by 12 px of padding, the theme's palette,
// and box drawing joined across rows (the WebGL renderer draws those characters itself, as the desktop's sprites do).
// ⏺ ⏸ ✔ ⚠ and other symbols that are text by default come from Noto Sans Symbols 2, in the terminal's colours;
// Android would otherwise draw them from its colour emoji font.
// A phone has no mouse, so the page reads fingers: a tap brings the keyboard up (opening the page never does), a drag
// scrolls back, two fingers change the text size, a flick sideways goes to the next or previous tab, a long press
// selects a word (dragging extends it), and a tap on a link opens it.
// Page → app (window.nsh.postMessage, JSON): ready / size {cols, rows} once laid out and on each change,
// input {data}, copied {text}, selected {text}, zoom {size}, swipe {dir}, link {url}, tap, away {away} (scrolled back
// or at the bottom again), tail {lines} (the last lines up to the cursor, once output settles), text {base, lines} (the
// whole buffer, asked for).
// App → page (WebViewRef.postMessage, JSON): reset, write {data}, key {name} (the key bar, encoded by xterm's own
// cursor-key mode), paste {data} (bracketed when the program asked), theme {dark}, fontSize {size}, copy, focus,
// bottom, text, mark {line, label} (a rule above the buffer's line `line`: "New since you looked").
import { FIT_JS, WEBGL_JS, XTERM_CSS, XTERM_JS } from '../vendor/xterm.ts'
import { MONO_WOFF, NOTO_MONO_WOFF, SYMBOLS1_WOFF, SYMBOLS2_WOFF, SYMBOLS_WOFF } from '../vendor/fonts.ts'

export type PageMessage = { t: 'ready' | 'size'; cols: number; rows: number } | { t: 'input'; data: string } | { t: 'copied'; text: string }
  | { t: 'selected'; text: string } | { t: 'zoom'; size: number } | { t: 'swipe'; dir: 'next' | 'prev' } | { t: 'link'; url: string } | { t: 'tap' }
  | { t: 'away'; away: boolean } | { t: 'tail'; lines: string[] } | { t: 'text'; base: number; lines: string[] }
export type BarKey = 'esc' | 'tab' | 'btab' | 'enter' | 'ctrlc' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pgup' | 'pgdn'

/** Whether the terminal's WebView is left scrollable. On Android NSH 0.3.0's WebView (WebBox) swallows every finger
 *  move while it is not, and the page saw only touchstart and touchend: no drag, pinch or selection (measured
 *  2026-10-31 on the API 35 emulator over DevTools). The page never scrolls itself: touch-action is none. iOS keeps
 *  it off, as before; whether moves reach the page there was not checked. */
export const webViewScrollable = (os: string) => os === 'android'

/** The text sizes a pinch can reach (prefs keeps the same range). */
/** The terminal's fonts, in the order a character is looked for. */
export const TERMINAL_FONTS = "'JetBrains Mono', 'Symbols Nerd Font', 'Noto Sans Symbols 2', 'Noto Sans Symbols', 'Noto Sans Mono', ui-monospace, Menlo, monospace"
export const FONT_MIN = 9
export const FONT_MAX = 22
// herdr-app settings.rs DEFAULT_FONT (weight MEDIUM, bold BOLD), terminal.rs cell height (ascent + descent) × 1.15,
// layouts terminal_padding [14, 12].
const LOOK = { fontWeight: 500, fontWeightBold: 700, lineHeight: 1.15 }

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const NAMES = [...ANSI, ...ANSI.map((n) => 'bright' + n[0].toUpperCase() + n.slice(1))]
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

// herdr-app src/settings.rs: GRAPHITE (the default dark) and PAPER (the default light).
const GRAPHITE = { background: 0x17191d, foreground: 0xd2d4d9, selection: 0x394454, cursor: 0xd2d4d9,
  ansi: [0x45484f, 0xdc8c95, 0xa6bd91, 0xd8be87, 0x96b2d7, 0xb5a2ce, 0x8cbdc3, 0xd2d4d9, 0x818793, 0xf0a5ad, 0xbad5a2, 0xead2a1, 0xb0cbef, 0xcbb7e6, 0xa4d5db, 0xf0f0f2] }
const PAPER = { background: 0xffffff, foreground: 0x25272c, selection: 0xcfdcf5, cursor: 0x25272c,
  ansi: [0x25272c, 0xc62a2a, 0x1a7f37, 0x8f5d00, 0x1f62d0, 0x7a45c8, 0x0f6f74, 0x5f6068, 0x7b7e87, 0xd1242f, 0x1f883d, 0x9a6700, 0x0969da, 0x8250df, 0x1b7c83, 0x111214] }

export function xtermTheme(dark: boolean): Record<string, string> {
  const p = dark ? GRAPHITE : PAPER
  const t: Record<string, string> = { background: hex(p.background), foreground: hex(p.foreground), cursor: hex(p.cursor), cursorAccent: hex(p.background), selectionBackground: hex(p.selection) }
  p.ansi.forEach((c, i) => { t[NAMES[i]] = hex(c) })
  return t
}

/** Ctrl held from the key bar: a letter or one of @[\]^_ (and space) becomes its control character. */
export function ctrlKey(data: string): string {
  if (data.length !== 1) return data
  if (data === ' ') return '\x00'
  const c = data.toUpperCase().charCodeAt(0)
  return c >= 0x40 && c <= 0x5f ? String.fromCharCode(c & 0x1f) : data
}

const BOOT = `(function () {
  var cfg = window.__terminal;
  var box = document.getElementById('t');
  var term, fit, last = '';
  function post(m) { window.nsh.postMessage(JSON.stringify(m)); }
  function size() {
    try { fit.fit(); } catch (e) {}
    var now = term.cols + 'x' + term.rows;
    if (now !== last && term.cols > 0 && term.rows > 0) { var first = !last; last = now; post({ t: first ? 'ready' : 'size', cols: term.cols, rows: term.rows }); }
  }
  function setFont(n) { if (n !== term.options.fontSize) { term.options.fontSize = n; size(); } }
  function screenText() {
    var sel = term.getSelection(); if (sel) return sel;
    var b = term.buffer.active, out = [];
    for (var i = b.viewportY; i < b.viewportY + term.rows; i++) { var l = b.getLine(i); out.push(l ? l.translateToString(true) : ''); }
    return out.join('\\n').replace(/\\s+$/, '');
  }
  // The keyboard: none while the page opens; a tap (or the app, after a key-bar press) asks for it.
  function keyboard() { var ta = term.textarea; if (ta && ta.getAttribute('inputmode') !== 'text') { ta.setAttribute('inputmode', 'text'); ta.blur(); } term.focus(); }
  // Where a finger is, in cells of the whole buffer.
  function cell(x, y) {
    var r = term.element.querySelector('.xterm-screen').getBoundingClientRect();
    var w = r.width / term.cols, h = r.height / term.rows;
    var col = Math.max(0, Math.min(term.cols - 1, Math.floor((x - r.left) / w)));
    var row = Math.max(0, Math.min(term.rows - 1, Math.floor((y - r.top) / h)));
    return { col: col, row: row + term.buffer.active.viewportY, h: h };
  }
  function lineText(row) { var l = term.buffer.active.getLine(row); return l ? l.translateToString(false) : ''; }
  function linkAt(c) {
    var text = lineText(c.row), re = /https?:\\/\\/[^\\s"'<>]+/g, m;
    while ((m = re.exec(text))) { var url = m[0].replace(/[.,;:!?)\\]]+$/, ''); if (c.col >= m.index && c.col < m.index + url.length) return url; }
    return '';
  }
  function selectWord(c) {
    var text = lineText(c.row), a = c.col, b = c.col;
    if (/\\s/.test(text[c.col] || ' ')) { term.select(c.col, c.row, 1); return; }
    while (a > 0 && !/\\s/.test(text[a - 1])) a--;
    while (b < text.length - 1 && !/\\s/.test(text[b + 1])) b++;
    term.select(a, c.row, b - a + 1);
  }
  function selectSpan(from, to) {
    var s = from, e = to;
    if (to.row < from.row || (to.row === from.row && to.col < from.col)) { s = to; e = from; }
    term.select(s.col, s.row, (e.row - s.row) * term.cols + (e.col - s.col) + 1);
  }
  function touches() {
    var t0 = null, pinch = null, selecting = null, press = 0, scrolled = 0, moved = false, tapped = false;
    function dist(e) { var a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
    // touchstart keeps its default: it is what gives the WebView the system's focus, without which focusing the
    // textarea brings no keyboard up (Android, measured). touch-action:none already stops panning and zooming.
    box.addEventListener('touchstart', function (e) {
      clearTimeout(press);
      if (e.touches.length === 2) { pinch = { d: dist(e) || 1, size: term.options.fontSize }; t0 = null; selecting = null; return; }
      if (e.touches.length !== 1) return;
      var p = e.touches[0];
      t0 = { x: p.clientX, y: p.clientY, at: Date.now() }; moved = false; scrolled = 0; selecting = null;
      press = setTimeout(function () { if (!t0 || moved) return; selecting = cell(t0.x, t0.y); selectWord(selecting); }, 450);
    }, { passive: true });
    box.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    box.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (pinch) { if (e.touches.length === 2) setFont(Math.max(cfg.min, Math.min(cfg.max, Math.round(pinch.size * dist(e) / pinch.d)))); return; }
      if (!t0 || e.touches.length !== 1) return;
      var p = e.touches[0], dx = p.clientX - t0.x, dy = p.clientY - t0.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { moved = true; clearTimeout(press); }
      if (selecting) { selectSpan(selecting, cell(p.clientX, p.clientY)); return; }
      if (moved && Math.abs(dy) > Math.abs(dx)) {
        var h = cell(p.clientX, p.clientY).h, lines = Math.trunc((dy - scrolled) / h);
        if (lines) { term.scrollLines(-lines); scrolled += lines * h; }
      }
    }, { passive: false });
    box.addEventListener('touchend', function (e) {
      clearTimeout(press);
      // A plain tap keeps its default (the tap gesture gives the WebView the system's focus); the rest is ours.
      var plain = t0 && !moved && !pinch && !selecting && Date.now() - t0.at < 450;
      if (!plain) e.preventDefault();
      if (pinch) { if (e.touches.length === 0) { pinch = null; post({ t: 'zoom', size: term.options.fontSize }); } return; }
      if (!t0 || e.touches.length) return;
      var p = e.changedTouches[0], dx = p.clientX - t0.x, dy = p.clientY - t0.y, ms = Date.now() - t0.at, start = t0;
      t0 = null;
      if (selecting) { selecting = null; var text = term.getSelection(); if (text) post({ t: 'selected', text: text }); return; }
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy) && ms < 600 && scrolled === 0) { post({ t: 'swipe', dir: dx < 0 ? 'next' : 'prev' }); return; }
      if (!moved && ms < 450) {
        term.clearSelection();
        var url = linkAt(cell(start.x, start.y));
        if (url) { post({ t: 'link', url: url }); return; }
        keyboard();
        tapped = true;
        post({ t: 'tap' });
      }
    }, { passive: false });
    // After the tap's default ran, the page has the focus the keyboard needs: focus the terminal again.
    box.addEventListener('click', function () { if (tapped) { tapped = false; keyboard(); } });
  }
  function boot() {
    term = new Terminal({ fontFamily: cfg.fonts, fontSize: cfg.fontSize,
      fontWeight: cfg.fontWeight, fontWeightBold: cfg.fontWeightBold, lineHeight: cfg.lineHeight,
      scrollback: cfg.scrollback, cursorBlink: true, allowProposedApi: true, customGlyphs: true,
      theme: cfg.themes[cfg.dark ? 'dark' : 'light'] });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(box);
    // Opening the page must not bring the keyboard up.
    if (term.textarea) { term.textarea.setAttribute('inputmode','none'); term.textarea.blur(); }
    // WebGL draws box drawing as joined shapes; without it (or when the context is lost) the DOM renderer draws on.
    try { var gl = new WebglAddon.WebglAddon(); gl.onContextLoss(function () { gl.dispose(); }); term.loadAddon(gl); } catch (e) {}
    new ResizeObserver(size).observe(box);
    term.onData(function (d) { post({ t: 'input', data: d }); });
    // Scrolled back or at the bottom again; and, once output settles, the last lines up to the cursor.
    var away = false, settle = null;
    function where() {
      var b = term.buffer.active, a = b.viewportY < b.baseY;
      if (a !== away) { away = a; post({ t: 'away', away: a }); }
    }
    function lines(from, to) { var b = term.buffer.active, out = []; for (var i = from; i < to; i++) { var l = b.getLine(i); out.push(l ? l.translateToString(true) : ''); } return out; }
    function settled() {
      clearTimeout(settle);
      settle = setTimeout(function () { var b = term.buffer.active, end = b.baseY + b.cursorY + 1; post({ t: 'tail', lines: lines(Math.max(0, end - 20), end) }); }, 600);
    }
    term.onScroll(where);
    term.onWriteParsed(function () { where(); settled(); });
    var marked = null;
    function mark(line, label) {
      if (marked) marked.dispose();
      var b = term.buffer.active, m = term.registerMarker(line - (b.baseY + b.cursorY));
      if (!m) return;
      marked = term.registerDecoration({ marker: m, x: 0, width: term.cols, layer: 'top' });
      if (!marked) return;
      marked.onRender(function (el) {
        if (el.firstChild) return;
        el.style.pointerEvents = 'none';
        var c = term.options.theme.blue || '#6ea8fe';
        el.style.borderTop = '1px solid ' + c;
        var t = document.createElement('span');
        t.textContent = label;
        t.style.cssText = 'position:absolute;right:0;top:-0.75em;padding:0 6px;font:500 10px/1.5 system-ui,sans-serif;border-radius:4px;color:' + c + ';background:' + term.options.theme.background;
        el.appendChild(t);
      });
    }
    var CSI = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F' };
    window.addEventListener('message', function (e) {
      if (typeof e.data !== 'string') return;
      var m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'reset') term.reset();
      else if (m.t === 'write') term.write(m.data);
      else if (m.t === 'paste') term.paste(m.data);
      else if (m.t === 'theme') { term.options.theme = cfg.themes[m.dark ? 'dark' : 'light']; document.body.style.background = term.options.theme.background; }
      else if (m.t === 'fontSize') setFont(m.size);
      else if (m.t === 'focus') keyboard();
      else if (m.t === 'copy') post({ t: 'copied', text: screenText() });
      else if (m.t === 'bottom') { term.scrollToBottom(); where(); }
      else if (m.t === 'text') post({ t: 'text', base: 0, lines: lines(0, term.buffer.active.length) });
      else if (m.t === 'mark') mark(m.line, m.label);
      else if (m.t === 'key') {
        var seq = m.name === 'esc' ? '\\x1b' : m.name === 'tab' ? '\\t' : m.name === 'btab' ? '\\x1b[Z' : m.name === 'enter' ? '\\r' : m.name === 'ctrlc' ? '\\x03' : m.name === 'pgup' ? '\\x1b[5~' : m.name === 'pgdn' ? '\\x1b[6~'
          : CSI[m.name] ? (term.modes.applicationCursorKeysMode ? '\\x1bO' : '\\x1b[') + CSI[m.name] : '';
        if (seq) post({ t: 'input', data: seq });
      }
    });
    touches();
    size();
  }
  // Cells are measured from the font, so wait for it (a moment at most).
  var booted = false;
  function once() { if (!booted) { booted = true; boot(); } }
  try { Promise.all([document.fonts.load(cfg.fontSize + "px 'JetBrains Mono'"), document.fonts.load(cfg.fontSize + "px 'Symbols Nerd Font'", '\\ue0b0'), document.fonts.load(cfg.fontSize + "px 'Noto Sans Symbols 2'", '\\u23fa'), document.fonts.load(cfg.fontSize + "px 'Noto Sans Symbols'", '\\u23bf'), document.fonts.load(cfg.fontSize + "px 'Noto Sans Mono'", '\\u23ba')]).then(once, once); } catch (e) { once(); }
  setTimeout(once, 1500);
})();`

/** The whole page, scripts and fonts inline: it loads nothing from anywhere. */
export function terminalPage(opts: { dark: boolean; fontSize: number; scrollback: number }): string {
  const themes = { dark: xtermTheme(true), light: xtermTheme(false) }
  const bg = themes[opts.dark ? 'dark' : 'light'].background
  const cfg = JSON.stringify({ dark: opts.dark, fontSize: opts.fontSize, scrollback: opts.scrollback, themes, fonts: TERMINAL_FONTS, min: FONT_MIN, max: FONT_MAX, ...LOOK })
  const fonts = `@font-face{font-family:'JetBrains Mono';src:url(data:font/woff;base64,${MONO_WOFF}) format('woff');font-weight:100 800}`
    + `@font-face{font-family:'Symbols Nerd Font';src:url(data:font/woff;base64,${SYMBOLS_WOFF}) format('woff')}`
    + `@font-face{font-family:'Noto Sans Symbols 2';src:url(data:font/woff;base64,${SYMBOLS2_WOFF}) format('woff')}`
    + `@font-face{font-family:'Noto Sans Symbols';src:url(data:font/woff;base64,${SYMBOLS1_WOFF}) format('woff')}`
    + `@font-face{font-family:'Noto Sans Mono';src:url(data:font/woff;base64,${NOTO_MONO_WOFF}) format('woff')}`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">`
    + `<style>${fonts}\n${XTERM_CSS}\nhtml,body{margin:0;height:100%;background:${bg};overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}#t{position:absolute;inset:12px 14px}</style></head>`
    + `<body><div id="t"></div><script>${XTERM_JS}</script><script>${FIT_JS}</script><script>${WEBGL_JS}</script><script>window.__terminal=${cfg};${BOOT}</script></body></html>`
}

/** A page message, or undefined for anything else. */
export function readPageMessage(data: string): PageMessage | undefined {
  let m: any
  try { m = JSON.parse(data) } catch { return undefined }
  if ((m?.t === 'ready' || m?.t === 'size') && Number.isInteger(m.cols) && Number.isInteger(m.rows) && m.cols > 0 && m.rows > 0) return { t: m.t, cols: m.cols, rows: m.rows }
  if (m?.t === 'input' && typeof m.data === 'string') return { t: 'input', data: m.data }
  if (m?.t === 'copied' && typeof m.text === 'string') return { t: 'copied', text: m.text }
  if (m?.t === 'selected' && typeof m.text === 'string') return { t: 'selected', text: m.text }
  if (m?.t === 'zoom' && Number.isInteger(m.size) && m.size >= FONT_MIN && m.size <= FONT_MAX) return { t: 'zoom', size: m.size }
  if (m?.t === 'swipe' && (m.dir === 'next' || m.dir === 'prev')) return { t: 'swipe', dir: m.dir }
  if (m?.t === 'link' && typeof m.url === 'string' && /^https?:\/\//.test(m.url)) return { t: 'link', url: m.url }
  if (m?.t === 'tap') return { t: 'tap' }
  if (m?.t === 'away' && typeof m.away === 'boolean') return { t: 'away', away: m.away }
  const strings = (v: any, max: number) => Array.isArray(v) && v.length <= max && v.every((l: any) => typeof l === 'string')
  if (m?.t === 'tail' && strings(m.lines, 100)) return { t: 'tail', lines: m.lines }
  if (m?.t === 'text' && strings(m.lines, 20000) && Number.isInteger(m.base) && m.base >= 0) return { t: 'text', base: m.base, lines: m.lines }
  return undefined
}

/** The app's side of the page: output waits until the page is ready, decoded as one UTF-8 stream, and writes
 * between two flushes go as one message. */
export class PageChannel {
  private open = false
  private queue: ({ t: 'write'; data: string } | { t: 'reset' })[] = []
  private timer: number | undefined
  private dec = new TextDecoder()
  constructor(private post: (message: string) => void, private later: (f: () => void, ms: number) => number = setTimeout) {}
  ready() { this.open = true; this.schedule() }
  /** The page went away (reloaded or torn down): nothing more is sent until it says ready again. */
  lost() { this.open = false; this.queue = []; this.timer = undefined }
  write(bytes: Uint8Array) {
    const data = this.dec.decode(bytes, { stream: true })
    if (!data) return
    const tail = this.queue.at(-1)
    if (tail?.t === 'write') tail.data += data
    else this.queue.push({ t: 'write', data })
    this.schedule()
  }
  /** A new attachment repaints from scratch. */
  reset() { this.dec = new TextDecoder(); this.queue = [{ t: 'reset' }]; this.schedule() }
  send(message: { t: 'key'; name: BarKey } | { t: 'paste'; data: string } | { t: 'theme'; dark: boolean } | { t: 'fontSize'; size: number } | { t: 'focus' } | { t: 'copy' }
    | { t: 'bottom' } | { t: 'text' } | { t: 'mark'; line: number; label: string }) {
    if (this.open) this.post(JSON.stringify(message))
  }
  private schedule() {
    if (!this.open || this.timer !== undefined) return
    this.timer = this.later(() => {
      this.timer = undefined
      if (!this.open) return
      const q = this.queue
      this.queue = []
      for (const m of q) this.post(JSON.stringify(m))
    }, 16)
  }
}
