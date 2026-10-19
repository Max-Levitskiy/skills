import { expect, test } from 'claude-code/testing'

import { READ, boot, sleep } from './boot'

test('/ml-voice:read with no voice chosen hands setup to Claude', async ($, on) => {
  const submitted: string[] = []
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const clock = await boot($, on, { plan: { ready: false, guide: '/guide.md', actions: [] } })
  const out = await $.prompt.submit(READ)
  expect((out as { drop?: string }).drop).toContain('no voice chosen')
  await clock.advance(1)
  expect(submitted[0]).toContain("Set up ml-voice's voice")
})

test('a provider ml-voice does not know is named, not crashed on', async ($, on) => {
  await boot($, on, { plan: { ready: true, config: { voice: { provider: 'elevenlabs' } } } })
  const out = await $.prompt.submit(READ)
  expect((out as { drop?: string }).drop).toContain('does not know the voice provider "elevenlabs"')
})

test('a read overtaken by a later one while loading its settings gives way', async ($, on) => {
  let starts = 0
  let release = () => {}
  const ready = { exitCode: 0, stdout: JSON.stringify({ ready: true, config: { voice: { provider: 'say' } } }), stderr: '' }
  await boot($, on, {
    run: e => {
      if (e.argv[0] !== '/bin/agent-config') return undefined
      starts++
      // The first read's settings come back last.
      return starts === 1 ? new Promise(resolve => (release = () => resolve(ready))) : ready
    },
  })
  const first = $.prompt.submit(READ)
  for (let i = 0; i < 100 && starts === 0; i++) await sleep(5)
  const second = await $.prompt.submit(READ)
  release()
  expect((second as { drop?: string }).drop).toContain('Reading reply 1')
  expect(((await first) as { drop?: string }).drop).toBe('A later read took over.')
})
