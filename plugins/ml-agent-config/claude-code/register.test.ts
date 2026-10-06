import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SECRET_CACHE_VAR, cacheKey, parseCache } from '../src/secret-cache'

const REF = { source: '1password', ref: 'op://Private/Demo/key' }

// `agent-config start` output, trimmed to the fields the module reads.
const PLANS: Record<string, object> = {
  demo: {
    name: 'demo',
    ready: true,
    config: { credentials: { apiKey: REF }, workspace: { subdomain: 'acme' } },
    actions: [],
    problems: [],
  },
  fresh: {
    name: 'fresh',
    ready: false,
    config: {},
    actions: [{ id: 'onboard', type: 'prompt', keys: ['credentials.apiKey', 'workspace.subdomain'] }],
    problems: [],
  },
}

type World = { env: Record<string, string>; runs: string[][]; commands: string[]; prompts: string[] }

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// Everything beneath the plugin: the CLI, the environment, and the engine's own answers.
function world(on: On, loadExit = 0): World {
  const w: World = { env: { AGENT_CONFIG_ROOT: '/ac' }, runs: [], commands: [], prompts: [] }
  on('env.get', ($, e) => ({ value: w.env[e.name] }))
  on('env.set', ($, e) => {
    if (e.value === undefined) delete w.env[e.name]
    else w.env[e.name] = e.value
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    // As the CLI does: fd 3 holds one entry per requested key, spelled as requested.
    if (e.argv[0] === 'sh') {
      const keys = e.argv.slice(e.argv.indexOf('--secrets') + 1)
      return loadExit === 0
        ? ran(0, JSON.stringify(Object.fromEntries(keys.map(key => [key, 's3cret']))))
        : ran(3, '', 'op failed: authorization denied. Install the 1Password CLI and run \'op signin\'.')
    }
    const plan = PLANS[e.argv[2] ?? '']
    return plan ? ran(0, JSON.stringify(plan)) : ran(2, '', 'no declaration')
  })
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  on('command.run', ($, e) => {
    w.commands.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  return w
}

const loads = (w: World) => w.runs.filter(argv => argv[0] === 'sh')

const COMMAND = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as const

test('the module and the CLI agree on the variable name', () => {
  expect(SECRET_CACHE_VAR).toBe('AGENT_CONFIG_SECRETS')
})

test('a skill of a declared component gets the start output instead of running it', async ($, on) => {
  const w = world(on)
  const { text } = await $.skill.prompt({ skill: 'ml-demo:fresh', text: 'SKILL BODY' })
  expect(w.runs[0]).toEqual(['/ac/bin/agent-config', 'start', 'ml-demo'])
  expect(w.runs[1]).toEqual(['/ac/bin/agent-config', 'start', 'fresh'])
  expect(text).toStartWith('<agent-config>')
  expect(text).toContain('"ready": false')
  expect(text).toEndWith('SKILL BODY')
  expect(loads(w)).toHaveLength(0)
})

test('a skill with no declaration passes through, and is not looked up twice', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ skill: 'commit', text: 'COMMIT BODY' })
  const { text } = await $.skill.prompt({ skill: 'commit', text: 'COMMIT BODY' })
  expect(text).toBe('COMMIT BODY')
  expect(w.runs).toHaveLength(1)
})

test('one approved 1Password read is cached for the session and not asked again', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  await $.skill.prompt({ skill: 'demo', text: 'B' })
  expect(loads(w)).toEqual([
    ['sh', '-c', 'exec "$0" load "$@" 3>&1 1>/dev/null', '/ac/bin/agent-config', 'demo', '--secrets', 'credentials.apiKey'],
  ])
  expect(parseCache(w.env[SECRET_CACHE_VAR])[cacheKey(REF)]).toBe('s3cret')
})

test('a declined read caches nothing and is not asked again on the next skill', async ($, on) => {
  const w = world(on, 3)
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  await $.skill.prompt({ skill: 'demo', text: 'B' })
  expect(loads(w)).toHaveLength(1)
  expect(w.env[SECRET_CACHE_VAR]).toBeUndefined()
  const { text } = await $.command.run({ command: 'agent-config', args: 'demo', ...COMMAND })
  expect(text).toContain('1Password: not cached (op failed: authorization denied.')
})

test('/agent-config unlock retries, and forget clears the cache', async ($, on) => {
  const w = world(on)
  const unlocked = await $.command.run({ command: 'agent-config', args: 'unlock demo', ...COMMAND })
  expect(unlocked.text).toContain('1Password: cached for this session (apiKey).')
  expect(w.env[SECRET_CACHE_VAR]).toBeDefined()
  await $.command.run({ command: 'agent-config', args: 'forget', ...COMMAND })
  expect(w.env[SECRET_CACHE_VAR]).toBeUndefined()
})

test('the reload tool runs /reload-plugins after the turn and resumes the work', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  const answer = await $.tool.call({ tool: 'mcp__ml-agent-config__reload_plugins', name: 'demo' })
  expect(answer.result).toContain('Reload queued')
  expect(w.commands).toEqual([])
  await clock.advance(1)
  expect(w.commands).toEqual(['reload-plugins'])
  expect(w.prompts).toEqual(['Plugins reloaded. Run `agent-config start demo` again and continue.'])
})
