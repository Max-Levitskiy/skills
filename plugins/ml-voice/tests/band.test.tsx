import { expect, mock, test } from 'claude-code/testing'

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { top: 0, bodyRows: 4 } } as never

test('while a reply is read with the pane closed, the band above the prompt keeps stop in reach', async ($, on) => {
  mock.env(on, { TMPDIR: '/tmp', HOME: '/home/test' })
  mock.store(on)
  mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }) as never)
  let isPlaced = true
  on('ui.open', () => ({ value: { isPlaced } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'a question', toolUses: [] },
      { role: 'assistant', text: 'An answer.', toolUses: [] },
    ],
  }))
  on('process.run', ($, e) => ({
    value:
      e.argv[0] === 'sh'
        ? { exitCode: 0, stdout: '/bin/agent-config\n', stderr: '' }
        : { exitCode: 0, stdout: JSON.stringify({ ready: true, config: { voice: { provider: 'say' } } }), stderr: '' },
  }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const out = await $.prompt.submit({ text: '/ml-voice:read', command: { name: 'ml-voice:read', args: '' } } as never)
  expect((out as { drop?: string }).drop).toContain('Reading reply 1')

  // The pane is open, so the band stands aside.
  const hidden = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await hidden.find({ key: 'band-stop' })).toBeUndefined()
  await hidden.unmount()

  // Read again where no surface places the pane: the band is the only control.
  isPlaced = false
  await $.prompt.submit({ text: '/ml-voice:read', command: { name: 'ml-voice:read', args: '' } } as never)

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
