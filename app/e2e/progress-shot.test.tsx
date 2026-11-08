// Screenshots of the progress page (experimental), light and dark: `nsh test --target web e2e/progress-shot.test.tsx`.
// Version one is view only: the page, a task, and the one choice, the agent that sorts (Settings).
import { open, test } from 'nsh/test'

for (const scheme of ['light', 'dark'] as const) {
  test(`progress page, ${scheme}`, async () => {
    const app = await open('../fixtures/fake.tsx', { host: { params: { scene: 'progress', appearance: scheme } }, colorScheme: scheme, locale: 'en' })
    await app.waitFor('id:progress-body')
    await app.wait(400)
    await app.screenshot(`e2e/progress/home-${scheme}.png`)
    await app.press('id:task-T1')
    await app.waitFor('id:sub-T3')
    await app.wait(400)
    await app.screenshot(`e2e/progress/task-${scheme}.png`)
    await app.press('id:progress-back')
    await app.press('id:view-agents')
    await app.waitFor('id:status-line')
    await app.wait(400)
    await app.screenshot(`e2e/progress/agent-list-${scheme}.png`)
    await app.press('id:settings')
    await app.press('id:progress-first')
    await app.press('id:progress-first')
    await app.waitFor('id:agent-pi')
    await app.wait(400)
    await app.screenshot(`e2e/progress/agents-${scheme}.png`)
  }, 60000)
}

// The switch at the top at the narrowest phone width, in the language with the longest labels.
test('the switch fits at 360 points', async () => {
  const app = await open('../fixtures/fake.tsx', { host: { params: { scene: 'progress' } }, locale: 'ja', width: 360 })
  await app.waitFor('id:view-switch')
  await app.wait(400)
  await app.screenshot('e2e/progress/switch-ja-360.png')
  await app.press('id:view-agents')
  await app.waitFor('id:status-line')
  await app.wait(400)
  await app.screenshot('e2e/progress/switch-agents-ja-360.png')
}, 60000)
