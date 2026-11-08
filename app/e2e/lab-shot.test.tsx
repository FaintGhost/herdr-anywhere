// A picture of the home screen over four agents in different states (fixtures/fake.tsx scene "lab"), to look at
// after a change to home: `nsh test --target web e2e/lab-shot.test.tsx` saves it as e2e/lab/home-lab.png.
import { open, test } from 'nsh/test'

test('home over the lab panes', async () => {
  const app = await open('../fixtures/fake.tsx', { host: { params: { scene: 'lab' } }, colorScheme: 'light' })
  await app.waitFor('text:Needs you')
  await app.wait(500)
  await app.screenshot('e2e/lab/home-lab.png')
}, 60000)
