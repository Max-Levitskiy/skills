import { expect, test } from 'claude-code/testing'

import { BAND_PROPS, READ, boot } from './boot'

test('while a reply is read with the pane out of sight, the band above the prompt keeps stop in reach', async ($, on) => {
  let isPaneShown = true
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  await boot($, on, { isPaneShown: () => isPaneShown })
  const out = await $.prompt.submit(READ)
  expect((out as { drop?: string }).drop).toContain('Reading reply 1')

  // The pane is on screen, so the band stands aside.
  const hidden = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await hidden.find({ key: 'band-stop' })).toBeUndefined()
  await hidden.unmount()

  // Closed, a tab behind another, or waiting for a wider terminal: the band is the only control.
  isPaneShown = false
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'ml-voice', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: /reply 1 · preparing/ })).toBeDefined()
    expect(await band.find({ key: 'band-stop' })).toBeDefined()
    await band.unmount()
  }

  const band = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  await band.press({ key: 'band-stop' })
  const again = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await again.find({ key: 'band-stop' })).toBeUndefined()
})
