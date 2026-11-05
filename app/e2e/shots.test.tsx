// Screenshots of the screens over the fake core, on a real platform: `nsh test --target web e2e/shots.test.tsx`.
import { open, test } from 'nsh/test'

for (const scheme of ['dark', 'light'] as const) {
  test(`home and a space, ${scheme}`, async () => {
    const app = await open('../fixtures/fake.tsx', { host: { params: { scene: 'busy' } }, colorScheme: scheme })
    await app.waitFor('text:Needs you')
    await app.screenshot(`e2e/shots/home-${scheme}.png`)
    await app.press('id:space-sp1')
    await app.waitFor('id:terminal-t1')
    await app.wait(1500)
    await app.screenshot(`e2e/shots/space-${scheme}.png`)
  }, 60000)
}

test('pairing', async () => {
  const app = await open('../fixtures/fake.tsx', { host: { params: { scene: 'unpaired' } } })
  await app.waitFor('id:pair-link')
  await app.screenshot('e2e/shots/pair.png')
}, 60000)
