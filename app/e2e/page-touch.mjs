// The terminal page in a real browser with real touch events (Chromium over CDP, so a tap makes the same mouse events
// a phone's WebView makes, which is what xterm focuses on). Run with `e2e/page-touch.sh`.
import { createRequire } from 'node:module'
import { terminalPage } from '../src/ui/terminal-page.ts'

const require = createRequire(process.env.PLAYWRIGHT_DIR + '/')
const { chromium } = require('./index.js')

const browser = await chromium.launch()
const failures = []
const check = (name, ok, seen) => { console.log(`${ok ? 'ok' : 'FAIL'}: ${name}${seen === undefined ? '' : ` (${JSON.stringify(seen)})`}`); if (!ok) failures.push(name) }

async function open(opts) {
  const context = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
  const page = await context.newPage()
  await page.addInitScript(() => { window.posts = []; window.nsh = { postMessage: (m) => window.posts.push(JSON.parse(m)) }; window.addEventListener('error', (e) => { window.pageError = e.message }) })
  await page.route('http://terminal.test/', (r) => r.fulfill({ contentType: 'text/html', body: terminalPage({ dark: true, fontSize: 13, scrollback: 2000, ...opts }) }))
  await page.goto('http://terminal.test/')
  await page.waitForFunction(() => window.posts.some((m) => m.t === 'ready'))
  const cdp = await context.newCDPSession(page)
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  return {
    page,
    touch,
    tap: async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); await page.waitForTimeout(400) },
    drag: async (x, y, dy) => {
      await touch('touchStart', x, y)
      for (let i = 1; i <= 6; i++) await touch('touchMove', x, y + (dy * i) / 6)
      await touch('touchEnd')
      await page.waitForTimeout(400)
    },
    send: (m) => page.evaluate((m) => window.postMessage(JSON.stringify(m), '*'), m),
    asks: () => page.evaluate(() => {
      const ta = document.querySelector('.xterm-helper-textarea')
      return document.activeElement === ta && ta.getAttribute('inputmode') !== 'none'
    }),
    size: () => page.evaluate(() => {
      const s = document.querySelector('.xterm-screen').getBoundingClientRect()
      return { left: s.left, right: innerWidth - s.right, cols: [...window.posts].reverse().find((m) => m.cols).cols }
    }),
    away: () => page.evaluate(() => window.posts.filter((m) => m.t === 'away').at(-1)?.away ?? false),
  }
}

// Scrolling keeps going after the finger lifts, slower and slower. The scrollbar's position is the page's only
// visible record of where the view is: it must change while nothing touches the screen.
{
  const t = await open({ phone: true })
  await t.send({ t: 'write', data: Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\r\n') })
  await t.page.waitForTimeout(300)
  const y = () => t.page.evaluate(() => parseFloat(document.querySelector('.scrollbar.vertical .slider').style.top))
  const stroke = async (from, step, gap = 16, n = 8) => {
    await t.touch('touchStart', 195, from)
    for (let i = 1; i <= n; i++) { await t.touch('touchMove', 195, from + i * step); await t.page.waitForTimeout(gap) }
  }
  const watch = async (ms, every = 100) => {
    const out = [await y()]
    for (let at = 0; at < ms; at += every) { await t.page.waitForTimeout(every); out.push(await y()) }
    return out
  }

  await stroke(150, 40)
  await t.touch('touchEnd')
  const flick = await watch(3000)
  const steps = flick.slice(1).map((v, i) => Math.abs(v - flick[i]))
  const moving = steps.filter((s) => s > 0)
  check('a flick keeps scrolling after the finger lifts', flick[0] !== flick[flick.length - 1], flick.join(' '))
  check('it slows down as it goes', moving.length >= 4 && moving[0] > moving[moving.length - 1], steps.join(' '))
  check('and comes to rest', steps.slice(-5).every((s) => s === 0), steps.join(' '))

  await stroke(150, 20)
  await t.page.waitForTimeout(250)
  await t.touch('touchEnd')
  const held = await watch(500)
  check('a finger that stopped before lifting leaves the view where it is', new Set(held).size === 1, held.join(' '))

  await stroke(150, -40)
  await t.touch('touchEnd')
  await t.page.waitForTimeout(100)
  const posts = await t.page.evaluate(() => window.posts.length)
  await t.touch('touchStart', 195, 300)
  await t.page.waitForTimeout(50)
  const stopped = await watch(300)
  await t.touch('touchEnd')
  await t.page.waitForTimeout(100)
  check('a touch stops it where it is', new Set(stopped).size === 1, stopped.join(' '))
  check('and that touch is no tap', !(await t.page.evaluate((n) => window.posts.slice(n).some((m) => m.t === 'tap'), posts)))

  await stroke(150, 40)
  await t.touch('touchEnd')
  await t.send({ t: 'bottom' })
  await t.page.waitForTimeout(600)
  check('going to the bottom ends it there', !(await t.away()))

  await t.touch('touchStart', 195, 300)
  await t.touch('touchEnd')
  await t.page.waitForTimeout(100)
  await t.send({ t: 'write', data: '\x1b[?1049h\x1b[2J\x1b[Halt screen' })
  await t.page.waitForTimeout(100)
  await stroke(150, 40)
  await t.touch('touchEnd')
  await t.page.waitForTimeout(300)
  check('nothing to scroll: no error', !(await t.page.evaluate(() => window.pageError)))
}

// A pane that loses height to a split takes its rows from the new height; the keyboard's height never does this.
{
  const t = await open({ phone: true })
  const rows = () => t.page.evaluate(() => [...window.posts].reverse().find((m) => m.rows).rows)
  const before = await rows()
  await t.page.setViewportSize({ width: 390, height: 400 })
  await t.page.waitForTimeout(200)
  check('less height alone keeps the rows', (await rows()) === before, await rows())
  await t.send({ t: 'refit' })
  await t.page.waitForTimeout(400)
  check('asked to refit, the rows follow the new height', (await rows()) < before, await rows())
}

{
  const t = await open({ phone: true })
  await t.send({ t: 'write', data: Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\r\n') })
  await t.page.waitForTimeout(200)

  await t.tap(195, 300)
  check('a tap on the terminal asks for no keyboard', !(await t.asks()))
  await t.drag(195, 200, 200)
  check('a drag scrolls back', await t.away())
  check('a drag asks for no keyboard', !(await t.asks()))
  await t.drag(195, 300, 4)
  check('a small drag asks for no keyboard', !(await t.asks()))

  await t.send({ t: 'focus' })
  await t.page.waitForTimeout(100)
  check('the app can still ask for the keyboard', await t.asks())
  await t.page.evaluate(() => document.querySelector('.xterm-helper-textarea').blur())
  await t.tap(195, 300)
  check('after the keyboard went away a tap does not bring it back', !(await t.asks()))

  const s = await t.size()
  check('a phone has no gap at the left', s.left === 0, s)
  check('a phone leaves less than a cell at the right', s.right < 8.5, s)
  await t.page.context().close()
}
{
  // The keyboard takes height from the page. A TUI asked to redraw for it prints what it shows again.
  const t = await open({ phone: true })
  const sizes = () => t.page.evaluate(() => window.posts.filter((m) => m.t === 'size').length)
  const bottomOf = (word) => t.page.evaluate((word) => {
    const screen = document.querySelector('.xterm-screen').getBoundingClientRect()
    const rows = [...document.querySelectorAll('.xterm-rows > div')]
    window.term0 = rows.length
    return { top: screen.top, height: screen.height, inner: innerHeight }
  }, word)
  const before = await sizes()
  await t.send({ t: 'write', data: Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\r\n') })
  await t.page.waitForTimeout(150)
  await t.page.setViewportSize({ width: 390, height: 400 })
  await t.page.waitForTimeout(250)
  check('the keyboard going up does not resize the terminal', (await sizes()) === before, await sizes())
  let r = await bottomOf()
  check('with the screen full its last rows stay on screen', Math.abs(r.top + r.height - r.inner) < 30, r)
  await t.page.setViewportSize({ width: 390, height: 700 })
  await t.page.waitForTimeout(250)
  check('the keyboard going down does not resize the terminal', (await sizes()) === before, await sizes())
  r = await bottomOf()
  check('the keyboard gone, the screen is back at the top', r.top === 12, r)
  await t.page.setViewportSize({ width: 500, height: 700 })
  await t.page.waitForTimeout(250)
  check('a new width does resize', (await sizes()) === before + 1, await sizes())
  await t.page.context().close()
}
{
  // A short screen: what it shows sits at the top, so the keyboard must not move it away.
  const t = await open({ phone: true })
  await t.send({ t: 'write', data: 'one\r\ntwo\r\n' })
  await t.page.waitForTimeout(150)
  await t.page.setViewportSize({ width: 390, height: 400 })
  await t.page.waitForTimeout(250)
  const top = await t.page.evaluate(() => document.querySelector('.xterm-screen').getBoundingClientRect().top)
  check('a short screen stays where it is under the keyboard', top === 12, top)
  await t.page.context().close()
}
{
  const t = await open({ phone: true })
  const pressed = async (m) => {
    await t.page.evaluate(() => { window.posts = [] })
    await t.send({ t: 'key', ...m })
    await t.page.waitForTimeout(60)
    return t.page.evaluate(() => window.posts.filter((p) => p.t === 'input').map((p) => p.data).join(''))
  }
  check('enter', (await pressed({ name: 'enter' })) === '\r')
  check('ctrl+enter for a program that asked for nothing', (await pressed({ name: 'enter', ctrl: true })) === '\x1b[27;5;13~', await pressed({ name: 'enter', ctrl: true }))
  check('ctrl+left', (await pressed({ name: 'left', ctrl: true })) === '\x1b[1;5D')
  check('ctrl+tab', (await pressed({ name: 'tab', ctrl: true })) === '\x1b[27;5;9~')
  await t.send({ t: 'write', data: '\x1b[>5u' })
  await t.page.waitForTimeout(60)
  check('ctrl+enter for a program that asked for kitty keys', (await pressed({ name: 'enter', ctrl: true })) === '\x1b[13;5u')
  check('plain enter stays plain under kitty keys', (await pressed({ name: 'enter' })) === '\r')
  await t.send({ t: 'write', data: '\x1b[<u' })
  await t.page.waitForTimeout(60)
  check('and back after it pops them', (await pressed({ name: 'enter', ctrl: true })) === '\x1b[27;5;13~')
  await t.send({ t: 'write', data: '\x1b[=5;1u' })
  await t.page.waitForTimeout(60)
  check('set directly as well', (await pressed({ name: 'enter', ctrl: true })) === '\x1b[13;5u')
  await t.send({ t: 'reset' })
  await t.page.waitForTimeout(60)
  check('a reset forgets them', (await pressed({ name: 'enter', ctrl: true })) === '\x1b[27;5;13~')
  await t.page.evaluate(() => { window.posts = [] })
  await t.tap(195, 300)
  check('a touch on the page says so', await t.page.evaluate(() => window.posts.some((m) => m.t === 'touched')))
  await t.page.context().close()
}
{
  // Wide characters take the widths Claude Code and herdr-core count, or everything after them on the line lands in
  // the wrong column. The page itself says where the cursor is (DSR).
  const t = await open({ phone: true })
  const column = async (text) => {
    await t.send({ t: 'reset' })
    await t.page.evaluate(() => { window.posts = [] })
    await t.send({ t: 'write', data: text + '\x1b[6n' })
    await t.page.waitForTimeout(80)
    const r = await t.page.evaluate(() => window.posts.filter((p) => p.t === 'input').map((p) => p.data).join(''))
    return Number(/;(\d+)R/.exec(r)?.[1])
  }
  for (const [name, text, col] of [['ascii', 'ab', 3], ['Chinese', '中', 3], ['check mark', '✅', 3], ['thumbs up', '👍', 3],
    ['warning with its selector', '⚠️', 3], ['flag', '🇯🇵', 3], ['joined emoji', '👨‍💻', 3], ['rocket', '🚀', 3], ['plain warning', '⚠', 2], ['Claude Code record dot', '⏺', 2]]) {
    const got = await column(text)
    check(`${name} ends at column ${col}`, got === col, got)
  }
  await t.page.context().close()
}
{
  // Two fingers change nothing: the text size is in Settings.
  const t = await open({ phone: true })
  const cdp = await t.page.context().newCDPSession(t.page)
  const fingers = (type, gap) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195 - gap, y: 300, id: 0 }, { x: 195 + gap, y: 300, id: 1 }] })
  const before = (await t.size()).cols
  await fingers('touchStart', 40)
  for (const g of [60, 90, 120, 150]) await fingers('touchMove', g)
  await fingers('touchEnd')
  await t.page.waitForTimeout(300)
  check('two fingers do not change the text size', (await t.size()).cols === before, (await t.size()).cols)
  check('and tell the app nothing', !(await t.page.evaluate(() => window.posts.some((m) => m.t === 'zoom'))))
  await t.page.context().close()
}
{
  // Links, as agents print them: on one line, wrapped by the terminal at a phone's width, wrapped by the TUI itself with
  // its indent, and hidden behind text (OSC 8).
  const t = await open({ phone: true })
  const cell = await t.page.evaluate(() => { const r = document.querySelector('.xterm-screen').getBoundingClientRect(); return { w: r.width / window.posts.find((m) => m.t === 'ready').cols, h: r.height / window.posts.find((m) => m.t === 'ready').rows, x: r.left, y: r.top } })
  const tapRow = async (text, row, col) => {
    await t.send({ t: 'reset' })
    await t.send({ t: 'write', data: text })
    await t.page.waitForTimeout(100)
    await t.page.evaluate(() => { window.posts = [] })
    await t.tap(cell.x + (col + 0.5) * cell.w, cell.y + (row + 0.5) * cell.h)
    return t.page.evaluate(() => window.posts.filter((m) => m.t === 'link').map((m) => m.url).join(' '))
  }
  const long = 'https://example.com/a/very/long/path/that/does/not/fit/on/one/row/of/a/phone/screen?x=1'
  check('a link on one line opens', (await tapRow('see https://example.com/a now', 0, 8)) === 'https://example.com/a')
  check('a tap beside a link opens nothing', (await tapRow('see https://example.com/a now', 0, 1)) === '')
  check('a link the terminal wrapped opens whole, from its first row', (await tapRow(long, 0, 5)) === long, await tapRow(long, 0, 5))
  check('and from its last row', (await tapRow(long, 1, 3)) === long, await tapRow(long, 1, 3))
  const a = long.slice(0, 45), b = long.slice(45)
  check('a link the TUI wrapped with its indent opens whole', (await tapRow(`  ${a}\r\n  ${b}\r\n`, 1, 5)) === long, await tapRow(`  ${a}\r\n  ${b}\r\n`, 1, 5))
  check('a link behind text opens its target', (await tapRow('\x1b]8;;https://example.com/hidden\x07click here\x1b]8;;\x07', 0, 3)) === 'https://example.com/hidden', await tapRow('\x1b]8;;https://example.com/hidden\x07click here\x1b]8;;\x07', 0, 3))
  check('a link after Chinese opens where it is shown', (await tapRow('看这里 https://example.com/zh。然后', 0, 12)) === 'https://example.com/zh', await tapRow('看这里 https://example.com/zh。然后', 0, 12))
  check('text after a wrapped link on the next line stays out of it', (await tapRow(`${'x'.repeat(10)} https://example.com/a\r\nnext line\r\n`, 0, 15)) === 'https://example.com/a')
  // Selecting: hold, drag; what is selected goes to the app when the finger lifts.
  await t.send({ t: 'reset' })
  await t.send({ t: 'write', data: 'hello world again\r\nsecond line here\r\n' })
  await t.page.waitForTimeout(100)
  await t.page.evaluate(() => { window.posts = [] })
  const cdp2 = await t.page.context().newCDPSession(t.page)
  const at = (r, c) => [{ x: cell.x + (c + 0.5) * cell.w, y: cell.y + (r + 0.5) * cell.h }]
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0, 7) })
  await t.page.waitForTimeout(600)
  const hold = await t.page.evaluate(() => document.querySelector('.xterm-selection')?.children.length ?? 0)
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(1, 5) })
  await cdp2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await t.page.waitForTimeout(200)
  const sel = await t.page.evaluate(() => window.posts.filter((m) => m.t === 'selected').map((m) => m.text).join('|'))
  check('holding and dragging across two rows gives their text', sel === 'world again\nsecond', sel)
  await t.page.context().close()
}
{
  const t = await open({})
  const s = await t.size()
  check('a wide pane keeps the desktop padding', s.left === 14, s)
  await t.page.context().close()
}
{
  // xterm's overview ruler outlines itself in white by default, and draws that once the terminal is resized.
  const t = await open({ phone: true })
  await t.page.setViewportSize({ width: 184, height: 560 })
  await t.page.waitForTimeout(300)
  const ruler = await t.page.evaluate(() => {
    const c = document.querySelector('.xterm-decoration-overview-ruler')
    if (!c || !c.width) return { none: true }
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let brightest = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) brightest = Math.max(brightest, d[i], d[i + 1], d[i + 2])
    return { brightest }
  })
  check('a resized dark terminal has no bright line at its edge', !ruler.none && ruler.brightest < 64, ruler)
  await t.page.context().close()
}

await browser.close()
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1) }
