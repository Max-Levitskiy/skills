import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { arrowMove, editText, parseText, scrollBy, showValue } from './register'
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

const OWN = { name: 'agent-config', ready: true, actions: [], problems: [] }

type World = {
  env: Record<string, string>
  runs: string[][]
  commands: string[]
  prompts: string[]
  reloadAnswer: string
  banner: boolean
  layer: string | undefined
  writes: string[]
  layers: string[]
  apiKey: object
}

const SETTING = { layer: 'global', default: null, credential: false, group: null, required: true, problems: [] }

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// Everything beneath the plugin: the CLI, the environment, and the engine's own answers.
function world(on: On, loadExit = 0): World {
  const w: World = { env: { AGENT_CONFIG_ROOT: '/ac' }, runs: [], commands: [], prompts: [], reloadAnswer: 'Reloaded 4 plugins.', banner: true, layer: undefined, writes: [], layers: ['global', 'repo', 'user-repo', 'local'], apiKey: REF }
  on('env.get', ($, e) => ({ value: w.env[e.name] }))
  on('env.set', ($, e) => {
    if (e.value === undefined) delete w.env[e.name]
    else w.env[e.name] = e.value
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    // The CLI reads its harness from this; without it a machine with ~/.codex is read as Codex.
    if (e.init?.env?.CLAUDECODE !== '1') return ran(2, '', 'no CLAUDECODE')
    // As the CLI does: fd 3 holds one entry per requested key, spelled as requested.
    if (e.argv[0] === 'sh') {
      const keys = e.argv.slice(e.argv.indexOf('--secrets') + 1)
      return loadExit === 0
        ? ran(0, JSON.stringify(Object.fromEntries(keys.map(key => [key, 's3cret']))))
        : ran(3, '', 'op failed: authorization denied. Install the 1Password CLI and run \'op signin\'.')
    }
    if (e.argv[1] === '1password') {
      const what = e.argv[2]
      if (what === 'accounts') return ran(0, JSON.stringify({ accounts: [{ id: 'A1', label: 'me@home' }, { id: 'A2', label: 'me@work' }] }))
      if (what === 'vaults') return ran(0, JSON.stringify({ vaults: [{ id: 'V1', name: 'Private' }] }))
      if (what === 'items') {
        const items = Array.from({ length: 14 }, (_, n) => ({ id: `I${n}`, title: `Item ${n}`, category: 'LOGIN' }))
        return ran(0, JSON.stringify({ items: [...items, { id: 'IG', title: 'GitHub', category: 'API_CREDENTIAL' }] }))
      }
      return ran(0, JSON.stringify({ fields: [{ id: 'credential', label: 'credential', section: null, type: 'CONCEALED', reference: 'op://Private/GitHub/credential' }] }))
    }
    if (e.argv[1] === 'list') {
      return ran(0, JSON.stringify({ components: [{ name: 'demo', plugin: 'ml-demo@max-skills', version: '1.0.0', declaration: '/d' }] }))
    }
    if (e.argv[1] === 'describe') {
      const keys =
        e.argv[2] === 'agent-config'
          ? [{ ...SETTING, path: 'notices.cacheBanner', description: 'Show the band', default: true, value: w.banner, source: 'default' }]
          : [
              { ...SETTING, path: 'credentials.apiKey', description: 'API key', credential: true, value: w.apiKey, source: 'global' },
              { ...SETTING, path: 'workspace.subdomain', description: 'Subdomain', layer: 'repo', value: 'acme', source: 'repo' },
            ]
      return ran(0, JSON.stringify({ keys, layers: w.layers.map(layer => ({ layer, path: `/${layer}.json` })) }))
    }
    if (e.argv[1] === 'path') return ran(0, JSON.stringify({ layers: [{ path: '/home/.agents/config/agent-config/config.json' }] }))
    if (e.argv[1] === 'write') {
      w.writes.push(e.init?.stdin ?? '')
      return ran(0, '{}')
    }
    if (e.argv[2] === 'agent-config') return ran(0, JSON.stringify({ ...OWN, config: { notices: { cacheBanner: w.banner } } }))
    const plan = PLANS[e.argv[2] ?? '']
    return plan ? ran(0, JSON.stringify(plan)) : ran(2, '', 'no declaration')
  })
  on('fs.read', () => (w.layer === undefined ? { deny: 'no such file' } : { value: w.layer }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('ui.status', () => ({ value: undefined }))
  // The engine's own band: nothing.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine' }) as RenderElement
  })
  on('command.run', ($, e) => {
    w.commands.push(e.command)
    return { text: w.reloadAnswer }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
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

test('the reload tool runs /reload-plugins after the turn and resumes with its answer', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  const answer = await $.tool.call({ tool: 'mcp__ml-agent-config__reload_plugins', name: 'demo' })
  expect(answer.result).toContain('Reload queued')
  expect(w.commands).toEqual([])
  await clock.advance(1)
  expect(w.commands).toEqual(['reload-plugins'])
  expect(w.prompts[0]).toStartWith('Running /reload-plugins answered: Reloaded 4 plugins.')
  expect(w.prompts[0]).toContain('run `agent-config start demo` again and continue')
})

// Seen live in a remote session: the command refuses, and the resume prompt must say so.
test('a refused reload reaches the model as refused', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on)
  w.reloadAnswer = "/reload-plugins isn't available over a remote connection in this session."
  await $.tool.call({ tool: 'mcp__ml-agent-config__reload_plugins', name: 'demo' })
  await clock.advance(1)
  expect(w.prompts[0]).toContain("isn't available over a remote connection")
  expect(w.prompts[0]).toContain('ask the person to run /reload-plugins')
})

const BAND = {
  plugin: 'ml-agent-config',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
} as const

test('the cached-secrets band offers "Don\'t show again", which saves the choice in agent-config', async ($, on) => {
  const w = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    w.layer = '{"notices":{"other":1},"schemaVersion":1}'
    await $.command.run({ command: 'agent-config', args: 'forget', ...COMMAND })
    await $.skill.prompt({ skill: 'demo', text: 'A' })
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'never' })).toBeDefined()
    await ui.press({ key: 'never' })
    expect(JSON.parse(w.writes.at(-1)!)).toEqual({ notices: { other: 1, cacheBanner: false }, schemaVersion: 1 })
    expect(await ui.find({ key: 'never' })).toBeUndefined()
    await ui.unmount()
  }
})

test('with the choice saved, a later session caches the secret and shows no band', async ($, on) => {
  const w = world(on)
  w.banner = false
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  expect(loads(w)).toHaveLength(1)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'never' })).toBeUndefined()
})

test('Close hides the band and keeps the cache; Forget drops both', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'close' })
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  expect(w.env[SECRET_CACHE_VAR]).toBeDefined()
  expect(w.writes).toHaveLength(0)

  await $.command.run({ command: 'agent-config', args: 'unlock demo', ...COMMAND })
  expect(await ui.find({ key: 'close' })).toBeUndefined()

  await $.command.run({ command: 'agent-config', args: 'forget', ...COMMAND })
  await $.skill.prompt({ skill: 'demo', text: 'B' })
  expect(await ui.find({ key: 'forget' })).toBeDefined()
  await ui.press({ key: 'forget' })
  expect(w.env[SECRET_CACHE_VAR]).toBeUndefined()
  expect(await ui.find({ key: 'forget' })).toBeUndefined()
  await ui.unmount()
})

const PANE = {
  plugin: 'ml-agent-config',
  component: 'Pane',
  requestId: 'agent-config',
  props: { bodyColumns: 80 } as never,
} as const

test('/agent-config alone opens a pane listing every component, agent-config included', async ($, on) => {
  const w = world(on)
  const opened = await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  expect(opened.text).toBe('Opened the agent-config pane.')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'component:agent-config' })).toBeDefined()
  expect(await ui.find({ key: 'component:demo' })).toBeDefined()
  // The installed component is shown first; its credential shows the reference, never a secret.
  expect(await ui.find({ key: 'edit:credentials.apiKey' })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'setting:credentials.apiKey' }))).toContain('1Password: op://Private/Demo/key')
  expect(w.runs.some(argv => argv[0] === 'sh')).toBe(false)
  await ui.unmount()
})

test("agent-config's own flag toggles from the pane, merged into its global layer", async ($, on) => {
  const w = world(on)
  w.layer = '{"notices":{"other":1}}'
  await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'component:agent-config' })
  await ui.press({ key: 'toggle:notices.cacheBanner' })
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ notices: { other: 1, cacheBanner: false } })
  const write = w.runs.find(argv => argv[1] === 'write')!
  expect(write).toEqual(['/ac/bin/agent-config', 'write', 'agent-config', '--layer', 'global', '--from', expect.stringContaining('/claude-code')])
  await ui.unmount()
})

test('an edit writes to the chosen layer; an empty value removes the key from it', async ($, on) => {
  const w = world(on)
  w.layer = '{"workspace":{"subdomain":"acme","team":"x"}}'
  await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'edit:workspace.subdomain' })
  // Set now in the repo layer, so the edit lands there unless another layer is picked.
  await ui.press({ key: 'layer:local' })
  await ui.input({ key: 'value', text: 'beta' })
  expect(w.runs.find(argv => argv[1] === 'write')).toEqual(['/ac/bin/agent-config', 'write', 'demo', '--layer', 'local'])
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ workspace: { subdomain: 'beta', team: 'x' } })
  expect(await ui.find({ key: 'value' })).toBeUndefined()

  await ui.press({ key: 'edit:workspace.subdomain' })
  await ui.input({ key: 'value', text: '' })
  expect(w.runs.filter(argv => argv[1] === 'write').at(-1)).toContain('repo')
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ workspace: { team: 'x' } })
  await ui.unmount()
})

test('the mobile pane draws no edit field and keeps the toggles', async ($, on) => {
  world(on)
  await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(await ui.find({ key: 'edit:workspace.subdomain' })).toBeUndefined()
  await ui.press({ key: 'component:agent-config' })
  expect(await ui.find({ key: 'toggle:notices.cacheBanner' })).toBeDefined()
  await ui.unmount()
})

test('a credential is edited as a source and its fields, never as JSON', async ($, on) => {
  const w = world(on)
  w.apiKey = { ...REF, account: 'me' }
  w.layer = JSON.stringify({ credentials: { apiKey: w.apiKey } })
  await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'edit:credentials.apiKey' })
  expect(await ui.find({ key: 'value' })).toBeUndefined()

  // Same source: the other fields of the reference are kept.
  await ui.input({ key: 'field:ref', text: 'op://Private/Demo/other' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey).toEqual({ source: '1password', ref: 'op://Private/Demo/other', account: 'me' })

  // Another source: a fresh reference, saved only once every field is filled in.
  await ui.press({ key: 'edit:credentials.apiKey' })
  await ui.press({ key: 'source:dotenv' })
  await ui.input({ key: 'field:path', text: '~/.env', kind: 'change' })
  await ui.press({ key: 'save' })
  expect(w.writes).toHaveLength(1)
  await ui.input({ key: 'field:var', text: 'DEMO_KEY' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey).toEqual({ source: 'dotenv', path: '~/.env', var: 'DEMO_KEY' })
  await ui.unmount()
})

test('values read and write as plain text, typed by the current value', () => {
  expect(showValue({ source: 'keychain', service: 'app', account: 'me' })).toBe('Keychain: app / me')
  expect(showValue(['a', 'b'])).toBe('a, b')
  expect(showValue(false)).toBe('off')
  expect(showValue({ subdomain: 'acme', port: 8080 })).toBe('subdomain: acme, port: 8080')
  expect(editText(['a', 'b'])).toBe('a, b')
  expect(parseText(' 42 ', 7)).toEqual({ value: 42 })
  expect(parseText('many', 7).error).toBe('many is not a number')
  expect(parseText('off', true)).toEqual({ value: false })
  expect(parseText('a, b,, c', [])).toEqual({ value: ['a', 'b', 'c'] })
  expect(parseText('true', 'text')).toEqual({ value: 'true' })
  expect(parseText('  ', 'text')).toEqual({})
})

test('Browse 1Password picks account, vault, item and field into the reference', async ($, on) => {
  const w = world(on)
  w.layer = '{}'
  await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'edit:credentials.apiKey' })
  await ui.press({ key: 'browse' })
  await ui.press({ key: 'pick:A2' })
  await ui.press({ key: 'pick:V1' })
  // Fifteen items: all drawn, and the filter narrows them; Enter picks the first match.
  expect(await ui.find({ key: 'pick:I13' })).toBeDefined()
  await ui.input({ key: 'filter', text: 'git', kind: 'change' })
  expect(await ui.find({ key: 'pick:I13' })).toBeUndefined()
  await ui.input({ key: 'filter', text: 'git' })
  await ui.press({ key: 'pick:op://Private/GitHub/credential' })
  expect(await ui.find({ key: 'pick:op://Private/GitHub/credential' })).toBeUndefined()
  await ui.press({ key: 'save' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey).toEqual({ source: '1password', ref: 'op://Private/GitHub/credential', account: 'A2' })
  const browsed = w.runs.filter(argv => argv[1] === '1password')
  expect(browsed.map(argv => argv.slice(2))).toEqual([
    ['accounts'],
    ['vaults', '--account', 'A2'],
    ['items', '--vault', 'V1', '--account', 'A2'],
    ['fields', '--vault', 'V1', '--item', 'IG', '--account', 'A2'],
  ])
  await ui.unmount()
})

test('an arrow off the list box edge scrolls the box, not the pane', () => {
  const options = Array.from({ length: 40 }, (_, n) => ({ value: `I${n}`, label: `Item ${n}` }))
  const at = (offset: number) => ({ step: 'item', account: null, vault: null, item: null, options, filter: '', offset, isLoading: false, error: null }) as const
  // Down off the last shown row (row 14) scrolls; down inside the box moves the ring as usual.
  expect(scrollBy(at(0), 'pick:I14', 'browse-back')).toBe(1)
  expect(scrollBy(at(0), 'pick:I3', 'pick:I4')).toBe(0)
  // Up off the first shown row scrolls back while rows are hidden above, then reaches the filter.
  expect(scrollBy(at(5), 'pick:I5', 'filter')).toBe(-1)
  expect(scrollBy(at(0), 'pick:I0', 'filter')).toBe(0)
  // At the end of the list the ring leaves for the buttons below.
  expect(scrollBy(at(25), 'pick:I39', 'browse-back')).toBe(0)
})

test('in an overflowing pane the arrows walk the 1Password list instead of scrolling the pane', () => {
  const options = Array.from({ length: 40 }, (_, n) => ({ value: `I${n}`, label: `Item ${n}` }))
  const at = (offset: number, filter = '') =>
    ({ step: 'item', account: null, vault: null, item: null, options, filter, offset, isLoading: false, error: null }) as const
  expect(arrowMove(at(0), 'filter', 1)).toEqual({ offset: 0, focus: 'pick:I0' })
  expect(arrowMove(at(0), 'pick:I0', 1)).toEqual({ offset: 0, focus: 'pick:I1' })
  expect(arrowMove(at(0), 'pick:I14', 1)).toEqual({ offset: 1, focus: 'pick:I15' })
  expect(arrowMove(at(25), 'pick:I39', 1)).toEqual({ offset: 25, focus: 'browse-back' })
  expect(arrowMove(at(3), 'pick:I3', -1)).toEqual({ offset: 2, focus: 'pick:I2' })
  expect(arrowMove(at(0), 'pick:I0', -1)).toEqual({ offset: 0, focus: 'filter' })
  expect(arrowMove(at(25), 'browse-back', -1)).toEqual({ offset: 25, focus: 'pick:I39' })
  // Outside the list, or up from the filter, the engine keeps the key.
  expect(arrowMove(at(0), 'filter', -1)).toBeUndefined()
  expect(arrowMove(at(0), 'save', 1)).toBeUndefined()
  // Five vaults: no filter, so up from the first row is the engine's.
  expect(arrowMove({ ...at(0), options: options.slice(0, 5) }, 'pick:I0', -1)).toBeUndefined()
  expect(arrowMove({ ...at(0), options: options.slice(0, 5) }, 'pick:I0', 1)).toEqual({ offset: 0, focus: 'pick:I1' })
})
