import { expect, test } from 'claude-code/testing'

import { READ, boot } from './boot'

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
