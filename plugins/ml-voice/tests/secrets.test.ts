import { expect, test } from 'claude-code/testing'

import { READ, boot } from './boot'

const REFERENCE = { source: '1password', ref: 'op://Vault/OpenRouter/credential', account: 'ACME' }

test('the key is loaded through agent-config on fd 3 and cached nowhere by ml-voice', async ($, on) => {
  const loads: string[][] = []
  const written = new Map<string, string | undefined>()
  on('env.set', ($, e) => {
    written.set(e.name, e.value)
    return { value: undefined } as never
  })
  await boot($, on, {
    plan: { ready: true, config: { voice: { provider: 'openrouter' }, openrouter: { model: 'fish-audio/drama-3' }, credentials: { openrouterKey: REFERENCE } } },
    run: e => {
      if (e.argv[0] !== 'sh' || !e.argv[2]?.includes(' load ')) return undefined
      loads.push([...e.argv])
      return { exitCode: 0, stdout: JSON.stringify({ 'credentials.openrouterKey': 'test-key' }), stderr: '' }
    },
  })
  const out = await $.prompt.submit(READ)
  expect((out as { drop?: string }).drop).toContain('OpenRouter fish-audio/drama-3')
  // The key reaches the CLI through fd 3, never argv.
  expect(loads[0]?.some(arg => arg.includes('test-key'))).toBe(false)
  // Only agent-config's own unlock and forget change its session cache.
  expect(written.has('AGENT_CONFIG_SECRETS')).toBe(false)
  await $.prompt.submit(READ)
  expect(loads).toHaveLength(2)
})
