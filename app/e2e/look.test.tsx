// Screenshots of every screen over the fake core, light and dark, on a real platform, saved in the current directory:
// `cd <out> && nsh test --target ios <app>/e2e/look.test.tsx`.
import { open, test } from 'nsh/test'

for (const scheme of ['light', 'dark'] as const) {
  test(`home, a space and a blocked agent, ${scheme}`, async () => {
    const app = await open('../fixtures/fake.tsx', { host: { params: { scene: 'busy' } }, colorScheme: scheme })
    await app.waitFor('text:Needs you')
    await app.wait(800)
    await app.screenshot(`home-${scheme}.png`)
    await app.press('id:space-sp1')
    await app.waitFor('id:terminal-t1')
    await app.wait(1500)
    await app.screenshot(`space-${scheme}.png`)
    await app.press('id:switcher')
    await app.wait(800)
    await app.screenshot(`switcher-${scheme}.png`)
  }, 90000)
}
