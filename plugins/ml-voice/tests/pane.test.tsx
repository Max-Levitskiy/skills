import { expect, test } from 'claude-code/testing'

import { PANE_PROPS, READ, boot } from './boot'

const REPLY = '## Plan\n\nFirst paragraph.\n\n```ts\nconst x = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two'

test('the pane draws the reply being read', async ($, on) => {
  await boot($, on, { reply: REPLY })
  await $.prompt.submit(READ)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'ml-voice', surface, component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /First paragraph/ })).toBeDefined()
    expect(await pane.find({ key: 'block-0' })).toBeDefined()
    await pane.press({ key: 'replies' })
    expect(await pane.find({ type: 'Text', text: /a question/ })).toBeDefined()
    // The list keeps pause and stop on screen while a reply is being read.
    expect(await pane.find({ key: 'stop' })).toBeDefined()
    await pane.press({ key: 'back' })
    await pane.unmount()
  }
})
