// The progress page (experimental) over a fake herdr-core whose machine.exec answers `herdr-anywhere track …` and
// `progress …` (fixtures/fake.tsx scene "progress", fixtures/progress-tree.ts: the sample scene's tree).
// Version one is view only: the page shows, the computer decides; the one thing the user picks is the filing agent.
import { expect, open, test } from 'nsh/test'

// These run in Chinese with the Chinese scene; the page in every language is below.
const progress = (locale = 'zh-Hans') => open('./fixtures/fake.tsx', { host: { params: { scene: 'progress' } }, locale })
const ran = (app: any): string[] => JSON.parse(app.storage()['fake-exec'] ?? '[]')

test('the first screen: what needs the user, what just finished, then each task with the tasks under it', async () => {
  const app = await progress()
  await app.waitFor('text:要你处理')
  expect(app.shows('id:needs-task-T6')).toBe(true)
  expect(app.shows('text:价格取整，还是保留到分？')).toBe(true)
  expect(app.shows('id:needs-task-T6-open')).toBe(true)
  expect(app.shows('text:刚做完')).toBe(true)
  expect(app.shows('id:done-P2')).toBe(true)
  expect(app.shows('text:对比写好了，等你看')).toBe(true)
  expect(app.shows('text:进行中')).toBe(true)
  expect(app.shows('id:top-P1')).toBe(true)
  for (const id of ['id:task-T1', 'id:task-T5', 'id:task-T9']) expect(app.shows(id)).toBe(true)
  expect(app.shows('text:✓ 加上银行卡表单')).toBe(true)
  expect(app.shows('text:排队中')).toBe(true)
  expect(app.shows('id:task-T6')).toBe(false) // shown once, in 要你处理
  // Nothing to tick, accept, answer or type: the computer keeps the tasks.
  for (const id of ['id:needs-task-T6-accept', 'id:scan-offer', 'id:dock-input', 'text:待确认', 'text:验收']) expect(app.shows(id)).toBe(false)
}, 60000)

test('what needs the user opens the pane that asks', async () => {
  const app = await progress()
  await app.press('id:needs-task-T6-open')
  await app.waitFor('id:terminal-t4')
}, 60000)

test('a task opens with the titles above it, its own tasks and its pane, and nothing to change', async () => {
  const app = await progress()
  await app.press('id:task-T1')
  await app.waitFor('id:sub-T3')
  expect(app.shows('text:上线 Acme 商店的新结账流程')).toBe(true)
  expect(app.count('id:task-move') + app.count('id:task-accept') + app.count('id:dock-input')).toBe(0)
  await app.press('id:progress-back')
  await app.press('id:done-P2')
  await app.waitFor('id:task-pane-t3')
  expect(app.shows('text:payments · t3')).toBe(true)
}, 60000)

test('while the computer is still sorting, the page says how many are left', async () => {
  const app = await progress()
  await app.waitFor('text:要你处理')
  expect(app.count('id:queue-line')).toBe(0)
  await app.host.send('fake.progress', { queue: 2 })
  await app.waitFor('text:还有 2 条在整理')
}, 60000)

test('in the agent list, a pane on a task says 在做 and opens the task', async () => {
  const app = await progress()
  await app.waitFor('text:要你处理')
  await app.press('id:view-agents')
  await app.waitFor('id:doing-t2')
  expect(app.shows('text:在做：付款后发收据邮件')).toBe(true)
  expect(app.count('id:doing-t3')).toBe(0) // its task is done
  await app.press('id:doing-t2')
  await app.waitFor('id:task-pane-t2')
}, 60000)

test('turning the page on picks the agent that sorts what you say; off turns filing off', async () => {
  const app = await progress()
  await app.waitFor('text:要你处理')
  await app.press('id:view-agents')
  await app.press('id:settings')
  await app.press('id:progress-first')
  await app.waitUntil(() => ran(app).includes(`progress 'off'`))
  await app.press('id:progress-first')
  await app.waitFor('id:agent-pi')
  expect(app.shows('text:用哪个 agent 整理你说的话')).toBe(true)
  for (const id of ['id:agent-claude-code', 'id:agent-kimi-code', 'id:agent-codex']) expect(app.shows(id)).toBe(true)
  expect(app.shows('text:要 0.163 以上才看得到它在不在忙，这台是 0.150.0')).toBe(true)
  await expect(() => app.press('id:agent-codex')).rejects.toThrow('disabled') // can't be picked
  await app.press('id:agent-pi')
  await app.waitUntil(() => ran(app).includes(`progress 'organizer' '--agent' 'pi' '--lang' 'zh-Hans' && "$b" progress 'on'`))
  await app.waitUntil(() => app.count('id:agent-pi') === 0)
  expect(app.shows('text:首页按任务列出进度 · Pi 在整理')).toBe(true)
}, 60000)

test('a filing pane that has not started shows a card that opens it', async () => {
  const app = await progress()
  await app.waitFor('text:要你处理')
  expect(app.count('id:organizer-waits')).toBe(0)
  await app.host.send('fake.progress', { organizerWaits: 't2' })
  await app.waitFor('id:organizer-waits')
  await app.press('id:organizer-waits-open')
  await app.waitFor('id:terminal-t2')
}, 60000)

// Off (the default), the phone asks the computer nothing of the page: no tree, no 在做 line, nothing turned on.
test('while the page is off the phone runs nothing of it on the computer', async () => {
  const app = await open('./fixtures/fake.tsx', { host: { params: { scene: 'progress', prefs: '{"progressFirst":false}' } }, locale: 'zh-Hans' })
  await app.waitFor('id:status-line')
  await app.wait(5000) // longer than the page's 4 s reading
  expect(app.count('id:doing-t2')).toBe(0)
  await app.press('id:settings')
  await app.waitFor('text:首页按任务列出进度')
  expect(ran(app)).toEqual([])
}, 60000)

test('with the toggle off (the default) the first screen stays the agent list, with no switch', async () => {
  const app = await open('./fixtures/fake.tsx', { host: { params: { scene: 'lab' } } })
  await app.waitFor('id:status-line')
  expect(app.shows('text:要你处理')).toBe(false)
  expect(app.count('id:view-switch')).toBe(0)
}, 60000)

test('with the page on, one tap at the top switches between the agent list and the progress page', async () => {
  const app = await progress('en')
  await app.waitFor('text:Needs you')
  expect(app.shows('id:view-switch')).toBe(true)
  for (const label of ['Agents', 'Progress']) expect(app.texts()).toContain(label)
  await app.press('id:view-agents')
  await app.waitFor('id:status-line')
  expect(app.shows('id:view-switch')).toBe(true)
  expect(app.count('id:progress-body')).toBe(0)
  // A switch, not a page on top: back has nothing to go back to.
  expect(app.count('id:progress-back')).toBe(0)
  await app.press('id:view-progress')
  await app.waitFor('id:progress-body')
  expect(app.count('id:status-line')).toBe(0)
  await app.press('id:view-agents')
  await app.waitUntil(() => JSON.parse(app.storage()['fake-prefs'] ?? '{}').homeView === 'agents')
}, 60000)

test('turned off from the progress page, back goes to the agent list, with no switch', async () => {
  const app = await progress('en')
  await app.waitFor('text:Needs you')
  await app.press('id:settings')
  await app.press('id:progress-first')
  await app.waitUntil(() => ran(app).includes(`progress 'off'`))
  await app.back()
  await app.waitFor('id:status-line')
  expect(app.count('id:view-switch')).toBe(0)
  expect(app.count('id:progress-body')).toBe(0)
}, 60000)

test('the app opens on the view the user last switched to', async () => {
  const app = await open('./fixtures/fake.tsx', { host: { params: { scene: 'progress', prefs: '{"homeView":"agents"}' } }, locale: 'en' })
  await app.waitFor('id:status-line')
  expect(app.shows('id:view-switch')).toBe(true)
  expect(app.count('id:progress-body')).toBe(0)
}, 60000)

test('a task that newly needs the user rings once, saying where it sits and what it waits for', async () => {
  const app = await open('./fixtures/fake.tsx', { host: { params: { scene: 'progress' }, handlers: { 'page.front': true, 'page.notify': true, 'page.notifications': 'granted' } }, locale: 'zh-Hans' })
  await app.waitFor('text:要你处理')
  await app.host.send('page.front', { front: false })
  await app.host.send('fake.progress', { wait: 'T4', waiting: '删卡前要不要再问一次？' })
  const notified = () => app.host.calls().filter((c: any) => c.name === 'page.notify').map((c: any) => c.data)
  await app.waitUntil(() => notified().length > 0, { timeout: 10000 })
  await app.wait(5000) // one more reading of the tree: no second notification for the same change
  expect(notified().map((n: any) => [n.title, n.body])).toEqual([['上线 Acme 商店的新结账流程 › 让顾客能保存银行卡', '等你：删卡前要不要再问一次？']])
}, 60000)

// It ships as an experimental feature, off by default: the switch says so in every language.
const SWITCH: Record<string, [string, string]> = {
  en: ['Experimental', 'The first screen lists your tasks and how far each has got.'],
  'zh-Hans': ['实验功能', '首页按任务列出进度'], 'zh-Hant': ['實驗功能', '首頁按任務列出進度'],
  es: ['Experimental', 'La primera pantalla muestra tus tareas y cómo va cada una.'],
  ja: ['実験的な機能', '最初の画面にタスクごとの進み具合を表示します。'],
  ko: ['실험 기능', '첫 화면에 작업별 진행 상황을 보여 줘요.'],
  ru: ['Экспериментальное', 'На первом экране — ваши задачи и как продвигается каждая.'],
}
for (const [locale, [section, detail]] of Object.entries(SWITCH)) {
  test(`${locale}: Settings says the progress page is experimental, and it is off`, async () => {
    const app = await open('./fixtures/fake.tsx', { host: { params: { scene: 'lab' } }, locale })
    await app.press('id:settings')
    await app.waitFor(`text:${detail}`)
    expect(app.texts()).toContain(section)
    expect(app.storage()['fake-prefs'] ?? '').not.toContain('"progressFirst":true')
  }, 60000)
}

test('in English, picking the agent is in English, the too-old note too', async () => {
  const app = await progress('en')
  await app.waitFor('text:Needs you')
  await app.press('id:view-agents')
  await app.press('id:settings')
  await app.press('id:progress-first')
  await app.press('id:progress-first')
  await app.waitFor('id:agent-pi')
  expect(app.texts()).toContain('Which agent sorts what you say')
  expect(app.texts()).toContain('Needs 0.163 or later to report whether it is busy; this computer has 0.150.0')
  await app.press('id:agent-pi')
  await app.waitFor('text:The first screen lists your tasks and how far each has got. · Pi is sorting')
  // The sorting agent writes in the phone's language.
  expect(ran(app)).toContain(`progress 'organizer' '--agent' 'pi' '--lang' 'en' && "$b" progress 'on'`)
}, 60000)

// Every word of the page in the phone's language; titles and questions are the sorting agent's, written in it too
// (the English scene, fixtures/tree-en.json). Stages come as codes and are worded here.
const PAGE: Record<string, string[]> = {
  en: ['Progress', 'Agents', 'Needs you', 'Just done', 'In progress', 'Waiting on you', 'Doing', 'Open mobile'],
  'zh-Hans': ['进度', 'Agent', '要你处理', '刚做完', '进行中', '等你', '在做', '打开 mobile'],
  'zh-Hant': ['進度', 'Agent', '要你處理', '剛做完', '進行中', '等你', '在做', '打開 mobile'],
  es: ['Progreso', 'Agentes', 'Te necesita', 'Recién terminado', 'En curso', 'Te espera', 'En marcha', 'Abrir mobile'],
  ja: ['進捗', 'エージェント', '対応待ち', '完了したばかり', '進行中', 'あなた待ち', '作業中', 'mobile を開く'],
  ko: ['진행 상황', '에이전트', '내가 할 일', '방금 끝남', '진행 중', '내 차례', '하는 중', 'mobile 열기'],
  ru: ['Прогресс', 'Агенты', 'Ждёт вас', 'Только что готово', 'В работе', 'Ждёт вас', 'Делается', 'Открыть mobile'],
}
for (const [locale, words] of Object.entries(PAGE)) {
  test(`${locale}: the page is in the phone's language, and the computer is told it`, async () => {
    const app = await progress(locale)
    await app.waitFor(`text:${words[2]}`)
    for (const w of words) expect(`${w}: ${app.texts().includes(w)}`).toBe(`${w}: true`)
    await app.waitUntil(() => ran(app).includes(`progress 'lang' '${locale}'`))
  }, 60000)
}

test('in English, a task and its panes read in English', async () => {
  const app = await progress('en')
  await app.waitFor('text:Needs you')
  expect(app.texts()).toContain('Round prices to whole numbers, or keep the cents?')
  await app.press('id:task-T1')
  await app.waitFor('text:Tasks under it')
  expect(app.texts()).toContain('Add the card form')
  expect(app.texts()).toContain('Queued')
  expect(app.texts().some((x) => /[一-龥]/.test(x))).toBe(false)
}, 60000)

