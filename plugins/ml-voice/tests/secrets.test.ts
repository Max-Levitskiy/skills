import { expect, test } from 'claude-code/testing'

import { READ, boot } from './boot'

const REFERENCE = { source: '1password', ref: 'op://Vault/OpenRouter/credential', account: 'ACME' }

test("a 1Password key joins agent-config's session cache, where /agent-config forget drops it", async ($, on) => {
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
  const cached = JSON.parse(written.get('AGENT_CONFIG_SECRETS') ?? '{}') as Record<string, string>
  expect(cached[JSON.stringify(['1password', REFERENCE.ref, 'ACME', null, null, null, null])]).toBe('test-key')
})
