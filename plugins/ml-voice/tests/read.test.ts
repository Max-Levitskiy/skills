import { expect, mock, test } from 'claude-code/testing'


test('/ml-voice:read with no voice chosen hands setup to Claude', async ($, on) => {
  const submitted: string[] = []
  mock.env(on, { TMPDIR: '/tmp' })
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
        : { exitCode: 0, stdout: JSON.stringify({ ready: false, guide: '/guide.md', actions: [] }), stderr: '' },
  }) as never)
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const out = await $.prompt.submit({ text: '/ml-voice:read', command: { name: 'ml-voice:read', args: '' } } as never)
  expect((out as { drop?: string }).drop).toContain('no voice chosen')
  await clock.advance(1)
  expect(submitted[0]).toContain('Set up voice-reader')
})
