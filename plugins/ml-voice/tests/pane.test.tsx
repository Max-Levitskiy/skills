import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = { title: 'Voice', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 30 } as never, view: {} } as never
const REPLY = '## Plan\n\nFirst paragraph.\n\n```ts\nconst x = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two'

test('the pane draws the reply being read', async ($, on) => {
  mock.env(on, { TMPDIR: '/tmp', HOME: '/home/test' })
  mock.store(on)
  mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'a question', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  }))
  on('process.run', ($, e) => ({
    value:
      e.argv[0] === 'sh'
        ? { exitCode: 0, stdout: '/bin/agent-config\n', stderr: '' }
        : { exitCode: 0, stdout: JSON.stringify({ ready: true, config: { voice: { provider: 'say' } } }), stderr: '' },
  }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: '/ml-voice:read', command: { name: 'ml-voice:read', args: '' } } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'ml-voice', surface, component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /First paragraph/ })).toBeDefined()
    expect(await pane.find({ key: 'block-0' })).toBeDefined()
    await pane.press({ key: 'replies' })
    expect(await pane.find({ type: 'Text', text: /a question/ })).toBeDefined()
    await pane.press({ key: 'back' })
    await pane.unmount()
  }
})
