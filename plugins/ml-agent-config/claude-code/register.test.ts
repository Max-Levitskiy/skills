import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { editText, parseText, showValue } from './register'
import { fuzzy, ranked } from './ui/fuzzy'
import { under } from './ui/levels'
import { readableReference } from './screens/onepassword'
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
  subdomain: { value: string | boolean | object; source: string; levels: Record<string, string | boolean | number[] | object | null> }
  store: Record<string, unknown>
  /** Layers whose file is behind the declaration's schema, so `start` plans their migration. */
  behind: string[]
  /** The layer file is there but cannot be read. */
  unreadable: boolean
  /** 1Password lists one account instead of two. */
  oneAccount: boolean
  /** What every `start` prints instead of a plan: exit 2 for a broken layer file, or not JSON at all. */
  broken: 'invalid' | 'garbled' | null
}

const SETTING = { layer: 'global', default: null, credential: false, group: null, required: true, problems: [] }

const ran = (exitCode: number, stdout: string, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

// Everything beneath the plugin: the CLI, the environment, and the engine's own answers.
function world(on: On, loadExit = 0): World {
  const w: World = { env: { AGENT_CONFIG_ROOT: '/ac', HOME: '/home/me' }, runs: [], commands: [], prompts: [], reloadAnswer: 'Reloaded 4 plugins.', banner: true, layer: undefined, writes: [], layers: ['global', 'repo', 'user-repo', 'local'], apiKey: REF, subdomain: { value: 'acme', source: 'repo', levels: { repo: 'acme' } }, store: {}, behind: [], unreadable: false, oneAccount: false, broken: null }
  on('store.get', ($, e) => ({ value: w.store[e.key] }))
  on('store.set', ($, e) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
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
      if (loadExit === -1) throw new Error('timed out after 120000ms')
      return loadExit === 0
        ? ran(0, JSON.stringify(Object.fromEntries(keys.map(key => [key, 's3cret']))))
        : ran(3, '', 'op failed: authorization denied. Install the 1Password CLI and run \'op signin\'.')
    }
    if (e.argv[1] === '1password') {
      if (e.argv[2] === 'items') {
        const items = Array.from({ length: 14 }, (_, n) => ({ id: `I${n}`, title: `Item ${n}`, category: 'LOGIN', vault: { id: 'V1', name: 'Private' }, account: 'A1' }))
        const github = [
          { id: 'IG', title: 'GitHub Actions', category: 'API_CREDENTIAL', vault: { id: 'V2', name: 'Work' }, account: 'A2' },
          { id: 'IH', title: 'Goohost activity', category: 'PASSWORD', vault: { id: 'V1', name: 'Private' }, account: 'A1' },
        ]
        const accounts = [{ id: 'A1', label: 'me@home', short: 'home' }, { id: 'A2', label: 'me@work', short: 'work' }]
        if (w.oneAccount) return ran(0, JSON.stringify({ accounts: accounts.slice(0, 1), items, problems: [] }))
        return ran(0, JSON.stringify({ accounts, items: [...items, ...github], problems: [] }))
      }
      return ran(0, JSON.stringify({ fields: [{ id: 'credential', label: 'credential', section: null, type: 'CONCEALED', reference: 'op://V2/IG/credential' }] }))
    }
    if (w.broken === 'garbled') return ran(0, 'Segmentation fault')
    if (e.argv[1] === 'list') {
      return ran(0, JSON.stringify({ components: [{ name: 'demo', plugin: 'ml-demo@max-skills', version: '1.0.0', declaration: '/d' }] }))
    }
    if (e.argv[1] === 'describe') {
      const keys =
        e.argv[2] === 'agent-config'
          ? [{ ...SETTING, path: 'notices.cacheBanner', description: 'Show the band', default: true, value: w.banner, source: 'default' }]
          : [
              { ...SETTING, path: 'credentials.apiKey', description: 'API key', credential: true, value: w.apiKey, source: 'global', levels: { global: w.apiKey } },
              { ...SETTING, path: 'workspace.subdomain', description: 'Subdomain', layer: 'repo', value: w.subdomain.value, source: w.subdomain.source, levels: w.subdomain.levels },
            ]
      return ran(0, JSON.stringify({ keys, layers: w.layers.map(layer => ({ layer, path: `/home/me/${layer}.json`, exists: true })), repo: { checkout: null } }))
    }
    if (e.argv[1] === 'path') return ran(0, JSON.stringify({ layers: [{ path: '/home/.agents/config/agent-config/config.json', exists: w.layer !== undefined || w.unreadable }] }))
    if (e.argv[1] === 'write') {
      w.writes.push(e.init?.stdin ?? '')
      const banner = (JSON.parse(e.init?.stdin ?? '{}') as { notices?: { cacheBanner?: boolean } }).notices?.cacheBanner
      if (e.argv[2] === 'agent-config' && banner !== undefined) w.banner = banner
      return ran(0, '{}')
    }
    if (w.broken === 'invalid') return ran(2, '', '/home/me/global.json is not valid JSON: Unexpected token')
    if (e.argv[2] === 'agent-config') return ran(0, JSON.stringify({ ...OWN, config: { notices: { cacheBanner: w.banner } } }))
    const listed = PLANS[e.argv[2] ?? ''] as { actions: object[]; config: object } | undefined
    const plan = listed && e.argv[2] === 'demo' ? { ...listed, config: { ...listed.config, credentials: { apiKey: w.apiKey } } } : listed
    const migrations = w.behind.map(layer => ({ id: `agent-config:migrate:${layer}`, type: 'builtin', keys: [] }))
    return plan ? ran(0, JSON.stringify({ ...plan, actions: [...plan.actions, ...migrations] })) : ran(2, '', `No installed plugin declares the agent-config name "${e.argv[2]}".`)
  })
  on('fs.read', () => (w.unreadable ? { deny: 'permission denied' } : w.layer === undefined ? { deny: 'no such file' } : { value: w.layer }))
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

test('a component whose layer file is broken is looked up again, so a fix takes effect', async ($, on) => {
  const w = world(on)
  w.broken = 'invalid'
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  w.broken = null
  const { text } = await $.skill.prompt({ skill: 'demo', text: 'B' })
  expect(text).toContain('B')
  expect(w.runs.filter(argv => argv[1] === 'start' && argv[2] === 'demo')).toHaveLength(2)
  expect(loads(w)).toHaveLength(1)
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

  // A reference changed since: asked for once, and not again.
  w.apiKey = { source: '1password', ref: 'op://Private/Other/key' }
  await $.skill.prompt({ skill: 'demo', text: 'C' })
  await $.skill.prompt({ skill: 'demo', text: 'D' })
  expect(loads(w)).toHaveLength(2)
})

test('a reference added after a cached unlock is asked for on the next skill', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  w.apiKey = { source: '1password', ref: 'op://Private/Other/key' }
  await $.skill.prompt({ skill: 'demo', text: 'B' })
  await $.skill.prompt({ skill: 'demo', text: 'C' })
  expect(loads(w)).toHaveLength(2)
  expect(parseCache(w.env[SECRET_CACHE_VAR])[cacheKey(w.apiKey as typeof REF)]).toBe('s3cret')
})

test('a load that times out is a declined unlock, and the skill still expands', async ($, on) => {
  const w = world(on, -1)
  const { text } = await $.skill.prompt({ skill: 'demo', text: 'A' })
  expect(text).toEndWith('A')
  expect(w.env[SECRET_CACHE_VAR]).toBeUndefined()
  const shown = await $.command.run({ command: 'agent-config', args: 'demo', ...COMMAND })
  expect(shown.text).toContain('1Password: not cached (')
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
    w.banner = true
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

test('Close hides the band for the session and keeps the cache', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'close' })
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  expect(w.env[SECRET_CACHE_VAR]).toBeDefined()
  expect(w.writes).toHaveLength(0)

  await $.command.run({ command: 'agent-config', args: 'unlock demo', ...COMMAND })
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  // Closed for the session: a reference unlocked later does not open it again.
  w.apiKey = { source: '1password', ref: 'op://Private/Other/key' }
  await $.skill.prompt({ skill: 'demo', text: 'B' })
  expect(loads(w)).toHaveLength(2)
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  await ui.unmount()
})

test('Forget on the band drops the cache and the band', async ($, on) => {
  const w = world(on)
  await $.skill.prompt({ skill: 'demo', text: 'A' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
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

const open = async ($: Engine) => {
  await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  return $.ui.mount({ ...PANE, surface: 'terminal' })
}

const text = async (ui: Awaited<ReturnType<typeof open>>, key: string) => JSON.stringify(await ui.find({ key }))

test('/agent-config opens on the components; one opens its settings, and Back returns', async ($, on) => {
  const w = world(on)
  const ui = await open($)
  expect(await ui.find({ key: 'component:agent-config' })).toBeDefined()
  expect(await ui.find({ key: 'component:demo' })).toBeDefined()
  expect(await ui.find({ key: 'back' })).toBeUndefined()

  await ui.press({ key: 'component:demo' })
  expect(await ui.find({ key: 'component:demo' })).toBeUndefined()
  // A credential shows where it lives and its level, never a secret.
  expect(await text(ui, 'row:setting:credentials.apiKey')).toContain('1Password: op://Private/Demo/key · Everywhere')
  expect(await text(ui, 'row:setting:workspace.subdomain')).toContain('acme · Project, shared')
  expect(w.runs.some(argv => argv[0] === 'sh')).toBe(false)

  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'component:demo' })).toBeDefined()
  await ui.unmount()
})

test("agent-config's own on/off flag is picked on its edit screen and saved there, merged into its global layer", async ($, on) => {
  const w = world(on)
  w.layer = '{"notices":{"other":1}}'
  const ui = await open($)
  await ui.press({ key: 'component:agent-config' })
  expect(await text(ui, 'row:setting:notices.cacheBanner')).toContain('on · default')
  await ui.press({ key: 'setting:notices.cacheBanner' })
  // Picking off saves nothing yet.
  await ui.press({ key: 'value:off' })
  expect(w.writes).toEqual([])
  expect(await text(ui, 'value:off')).toContain('primary')
  await ui.press({ key: 'save' })
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ notices: { other: 1, cacheBanner: false } })
  const write = w.runs.find(argv => argv[1] === 'write')!
  expect(write).toEqual(['/ac/bin/agent-config', 'write', 'agent-config', '--layer', 'global', '--from', expect.stringContaining('/claude-code')])
  expect(await text(ui, 'row:setting:notices.cacheBanner')).toContain('› notices.cacheBanner  off')
  await ui.unmount()
})

test('outside a repository the one level is said, not offered as a switch', async ($, on) => {
  const w = world(on)
  w.layers = ['global']
  w.subdomain = { value: 'acme', source: 'global', levels: { global: 'acme' } }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  // Named on the title line, not a button; no level list and no Save to.
  expect(await text(ui, 'level')).toContain('Everywhere')
  expect(await text(ui, 'level')).not.toContain('›')
  expect(await ui.find({ key: 'levels' })).toBeUndefined()
  expect(await ui.find({ key: 'saveto' })).toBeUndefined()
  expect(await text(ui, 'where')).toContain('The only level outside a git repo')
  await ui.unmount()
})

test('an edit writes at the level switched to on top, and goes back with a message', async ($, on) => {
  const w = world(on)
  w.layer = '{"workspace":{"subdomain":"acme","team":"x"}}'
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  // Set now in the repo layer, so the edit starts there; the plain case adds no line under the title.
  expect(await ui.find({ key: 'where' })).toBeUndefined()
  // The level on the title line opens the level list: typed text stays when the level changes.
  expect(await text(ui, 'level')).toContain('Project ›')
  await ui.input({ key: 'value', text: 'beta', kind: 'change' })
  await ui.press({ key: 'level' })
  await ui.press({ key: 'level:local' })
  expect(await text(ui, 'level')).toContain('Checkout ›')
  expect(await text(ui, 'where')).toContain('Saving here overrides Project, shared (acme) in this checkout only.')
  await ui.input({ key: 'value', text: 'beta' })
  expect(w.runs.find(argv => argv[1] === 'write')).toEqual(['/ac/bin/agent-config', 'write', 'demo', '--layer', 'local'])
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ workspace: { subdomain: 'beta', team: 'x' } })
  // Saved: back on the settings, saying where.
  expect(await ui.find({ key: 'value' })).toBeUndefined()
  expect(await text(ui, 'row:setting:workspace.subdomain')).toBeDefined()
  expect(JSON.stringify(await ui.find({}))).toContain('Saved workspace.subdomain in This checkout.')
  await ui.unmount()
})

test('a level whose file is behind the schema, cannot be read, or cannot be checked, is not written over', async ($, on) => {
  const w = world(on)
  w.layer = '{"workspace":{"subdomain":"acme","team":"x"}}'
  w.behind = ['repo']
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  await ui.input({ key: 'value', text: 'beta' })
  expect(w.writes).toEqual([])
  expect(JSON.stringify(await ui.find({}))).toContain("Not saved: this level's file is on an older schema; Set up with Claude migrates it first")

  w.behind = []
  w.unreadable = true
  await ui.input({ key: 'value', text: 'beta' })
  expect(w.writes).toEqual([])
  expect(JSON.stringify(await ui.find({}))).toContain('Not saved: could not read')

  // A schema check that cannot run is no answer: the save stops rather than guess.
  w.unreadable = false
  w.broken = 'invalid'
  await ui.input({ key: 'value', text: 'beta' })
  expect(w.writes).toEqual([])
  expect(JSON.stringify(await ui.find({}))).toContain("Not saved: could not check this level's schema")
  await ui.unmount()
})

test('a CLI that prints garbage leaves the pane usable, never loading forever', async ($, on) => {
  const w = world(on)
  w.broken = 'garbled'
  const ui = await open($)
  expect(await ui.find({ key: 'component:agent-config' })).toBeDefined()
  expect(JSON.stringify(await ui.find({}))).not.toContain('Loading')
  await ui.press({ key: 'component:agent-config' })
  expect(JSON.stringify(await ui.find({}))).toContain('describe failed')
  expect(JSON.stringify(await ui.find({}))).not.toContain('Loading')
  await ui.unmount()
})

test('Save to writes the typed value at another level and leaves the edit level as it was', async ($, on) => {
  const w = world(on)
  w.layer = '{"workspace":{"subdomain":"acme"}}'
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  await ui.input({ key: 'value', text: 'mine', kind: 'change' })
  await ui.press({ key: 'saveto' })
  // Top first, the edit's own level left out, each with its file and what it would replace.
  expect(await ui.find({ key: 'saveto:repo' })).toBeUndefined()
  expect(await text(ui, 'row:saveto:user-repo')).toContain('~/user-repo.json · not set there now')
  await ui.press({ key: 'saveto:user-repo' })
  expect(w.runs.find(argv => argv[1] === 'write')).toEqual(['/ac/bin/agent-config', 'write', 'demo', '--layer', 'user-repo'])
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ workspace: { subdomain: 'mine' } })
  // Both screens close: back on the settings, saying where.
  expect(await text(ui, 'row:setting:workspace.subdomain')).toBeDefined()
  expect(JSON.stringify(await ui.find({}))).toContain('Saved workspace.subdomain in Project, just me.')
  await ui.unmount()
})

test('a value set Everywhere offers overrides for the team, for me, and for this checkout', async ($, on) => {
  const w = world(on)
  w.layer = '{}'
  w.subdomain = { value: 'acme', source: 'global', levels: { global: 'acme' } }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  expect(await text(ui, 'row:override:repo')).toContain('For the team in this repo')
  expect(await ui.find({ key: 'override:user-repo' })).toBeDefined()
  expect(await ui.find({ key: 'override:local' })).toBeDefined()

  // For the team: the edit moves to the shared project level, starting from the value now.
  await ui.press({ key: 'override:repo' })
  expect(await text(ui, 'where')).toContain('Saving here overrides Everywhere (acme) for the whole team in this repo.')
  expect(await ui.find({ key: 'override:repo' })).toBeUndefined()
  expect(await text(ui, 'value')).toContain('acme')
  await ui.input({ key: 'value', text: 'team' })
  expect(w.runs.filter(argv => argv[1] === 'write').at(-1)).toEqual(['/ac/bin/agent-config', 'write', 'demo', '--layer', 'repo'])
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ workspace: { subdomain: 'team' } })
  await ui.unmount()
})

test('Remove here drops the key from one level; Block inherited writes null there', async ($, on) => {
  const w = world(on)
  w.layer = '{"workspace":{"subdomain":"beta"}}'
  w.subdomain = { value: 'beta', source: 'local', levels: { repo: 'acme', local: 'beta' } }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  expect(await text(ui, 'row:setting:workspace.subdomain')).toContain('beta · This checkout, overrides acme')
  await ui.press({ key: 'setting:workspace.subdomain' })
  // The level button opens every level, compared, and a pick there points the edit at it.
  await ui.press({ key: 'level' })
  expect(await text(ui, 'row:level:local')).toContain('beta  wins')
  expect(await text(ui, 'row:level:repo')).toContain('acme')
  await ui.press({ key: 'level:repo' })
  expect(await text(ui, 'where')).toContain('Holds acme, but This checkout overrides it.')
  await ui.press({ key: 'level' })
  await ui.press({ key: 'level:local' })
  expect(await text(ui, 'row:remove')).toContain('Remove here (back to acme)')
  await ui.press({ key: 'remove' })
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ workspace: {} })

  await ui.press({ key: 'setting:workspace.subdomain' })
  await ui.press({ key: 'block' })
  expect(JSON.parse(w.writes.at(-1)!)).toEqual({ workspace: { subdomain: null } })
  expect(w.runs.filter(argv => argv[1] === 'write').at(-1)).toContain('local')
  await ui.unmount()
})

test('Show switches the settings to one level’s own values', async ($, on) => {
  const w = world(on)
  w.subdomain = { value: 'beta', source: 'local', levels: { repo: 'acme', local: 'beta' } }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  expect(await text(ui, 'show')).toContain('Show: Effective ›')
  await ui.press({ key: 'show' })
  await ui.press({ key: 'show:repo' })
  expect(await text(ui, 'show')).toContain('Show: Project ›')
  expect(await text(ui, 'row:setting:workspace.subdomain')).toContain('acme')
  await ui.press({ key: 'show' })
  await ui.press({ key: 'show:user-repo' })
  expect(await text(ui, 'row:setting:workspace.subdomain')).toContain('not set here')
  // An edit opened while one level shows writes to that level.
  await ui.press({ key: 'setting:workspace.subdomain' })
  expect(await text(ui, 'where')).toContain('This checkout overrides this level')
  await ui.unmount()
})

test('a level is typed as its own value, not as the one that overrides it', async ($, on) => {
  const w = world(on)
  w.layer = '{}'
  w.subdomain = { value: 'beta', source: 'local', levels: { repo: [1], local: 'beta' } }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'show' })
  await ui.press({ key: 'show:repo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  await ui.input({ key: 'value', text: '[1]' })
  expect(JSON.parse(w.writes.at(-1)!).workspace.subdomain).toEqual([1])
  await ui.unmount()
})

test('a plain object with a source key is edited as JSON, not as a credential', async ($, on) => {
  const w = world(on)
  w.layer = '{}'
  w.subdomain = { value: { source: 'replica', host: 'db' }, source: 'repo', levels: { repo: { source: 'replica', host: 'db' } } }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  // Opened and saved as it is: the object, not a blank that removes it.
  await ui.press({ key: 'save' })
  expect(JSON.parse(w.writes.at(-1)!).workspace.subdomain).toEqual({ source: 'replica', host: 'db' })
  await ui.unmount()
})

test('a level holding text under an on/off override is edited as text', async ($, on) => {
  const w = world(on)
  w.subdomain = { value: true, source: 'local', levels: { repo: 'acme', local: true } }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'show' })
  await ui.press({ key: 'show:repo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  expect(await ui.find({ key: 'value:on' })).toBeUndefined()
  expect(await ui.find({ key: 'value' })).toBeDefined()
  await ui.unmount()
})

test('the mobile pane has no fields, and still saves an on/off key', async ($, on) => {
  const w = world(on)
  await $.command.run({ command: 'agent-config', args: '', ...COMMAND })
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:workspace.subdomain' })
  expect(await ui.find({ key: 'value' })).toBeUndefined()
  expect(JSON.stringify(await ui.find({ key: 'level' }))).toContain('Project ›')
  await ui.press({ key: 'back' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'component:agent-config' })
  await ui.press({ key: 'setting:notices.cacheBanner' })
  await ui.press({ key: 'value:off' })
  await ui.press({ key: 'save' })
  expect(JSON.parse(w.writes.at(-1)!).notices.cacheBanner).toBe(false)
  await ui.unmount()
})

test('a credential is edited as a source and its fields, never as JSON', async ($, on) => {
  const w = world(on)
  w.apiKey = { ...REF, account: 'me' }
  w.layer = JSON.stringify({ credentials: { apiKey: w.apiKey } })
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:credentials.apiKey' })
  expect(await ui.find({ key: 'value' })).toBeUndefined()

  // Same source: the other fields of the reference are kept.
  await ui.input({ key: 'field:ref', text: 'op://Private/Demo/other' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey).toEqual({ source: '1password', ref: 'op://Private/Demo/other', account: 'me' })

  // The same source picked again keeps what was typed.
  await ui.press({ key: 'setting:credentials.apiKey' })
  await ui.input({ key: 'field:ref', text: 'op://Private/Demo/typed', kind: 'change' })
  await ui.press({ key: 'source' })
  await ui.press({ key: 'source:1password' })
  await ui.press({ key: 'save' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey.ref).toBe('op://Private/Demo/typed')

  // Another source, picked on its own screen: saved only once every field is filled in.
  await ui.press({ key: 'setting:credentials.apiKey' })
  await ui.press({ key: 'source' })
  await ui.press({ key: 'source:dotenv' })
  await ui.input({ key: 'field:path', text: '~/.env', kind: 'change' })
  await ui.press({ key: 'save' })
  expect(w.writes).toHaveLength(2)
  expect(JSON.stringify(await ui.find({}))).toContain('Not saved: fill in Variable')
  await ui.input({ key: 'field:var', text: 'DEMO_KEY' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey).toEqual({ source: 'dotenv', path: '~/.env', var: 'DEMO_KEY' })
  await ui.unmount()
})

test('Pick from 1Password lists every item once, filters and searches it, and fills in the reference', async ($, on) => {
  const w = world(on)
  w.layer = '{}'
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:credentials.apiKey' })
  await ui.press({ key: 'pick' })
  // A page of ten, and the rest a press away.
  expect(await ui.find({ key: 'item:I0' })).toBeDefined()
  expect(await ui.find({ key: 'item:IG' })).toBeUndefined()
  expect(await text(ui, 'page-down')).toContain('↓ 6 more')

  // Fuzzy: the letters in order, word starts first.
  await ui.input({ key: 'search', text: 'ghact', kind: 'change' })
  expect(await text(ui, 'row:item:IG')).toContain('Work · work · API credential')
  expect(await ui.find({ key: 'item:I0' })).toBeUndefined()
  await ui.input({ key: 'search', text: '', kind: 'change' })

  // A filter is its own screen; picking a vault narrows the list to it.
  await ui.press({ key: 'filter:vault' })
  await ui.press({ key: 'choice:V2' })
  expect(await text(ui, 'filter:vault')).toContain('Vault: Work')
  expect(await ui.find({ key: 'item:I0' })).toBeUndefined()

  await ui.press({ key: 'item:IG' })
  // op answers with ids; the names, unique and allowed, are what gets stored.
  await ui.press({ key: 'ref:op://V2/IG/credential' })
  // Back on the edit, waiting for Save.
  expect(await ui.find({ key: 'save' })).toBeDefined()
  await ui.press({ key: 'save' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey).toEqual({ source: '1password', ref: 'op://Work/GitHub Actions/credential', account: 'A2' })

  // The list is kept for the session: opening the picker again does not ask 1Password again.
  await ui.press({ key: 'setting:credentials.apiKey' })
  await ui.press({ key: 'pick' })
  const asked = w.runs.filter(argv => argv[1] === '1password').map(argv => argv.slice(2))
  expect(asked).toEqual([['items'], ['fields', '--vault', 'V2', '--item', 'IG', '--account', 'A2']])
  await ui.unmount()
})

test('with one 1Password account, a picked reference drops the account the old one named', async ($, on) => {
  const w = world(on)
  w.layer = '{}'
  w.oneAccount = true
  w.apiKey = { ...REF, account: 'A9' }
  const ui = await open($)
  await ui.press({ key: 'component:demo' })
  await ui.press({ key: 'setting:credentials.apiKey' })
  await ui.press({ key: 'pick' })
  await ui.press({ key: 'item:I0' })
  await ui.press({ key: 'ref:op://V2/IG/credential' })
  await ui.press({ key: 'save' })
  expect(JSON.parse(w.writes.at(-1)!).credentials.apiKey.account).toBeUndefined()
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
  expect(parseText('[]', ['a'])).toEqual({ value: [] })
  // A list of anything but text is typed as JSON, so a save keeps its types.
  for (const list of [[1, true], [{ host: 'a', port: 1 }], [], ['a,b'], ['a', ''], [' a'], ['[x]']]) {
    expect(parseText(editText(list), list)).toEqual({ value: list })
  }
  expect(parseText('true', 'text')).toEqual({ value: 'true' })
  expect(parseText('  ', 'text')).toEqual({})
  expect(parseText('  indented', 'text')).toEqual({ value: '  indented' })
  // JSON for an object or a list stays that kind: null is Block inherited's to write.
  for (const typed of ['null', '[]', '"text"']) expect(parseText(typed, { a: 1 }).error).toBeDefined()
  expect(parseText('{"a":2}', { a: 1 })).toEqual({ value: { a: 2 } })
  expect(parseText('null', [1]).error).toBeDefined()
})

test('an id-only 1Password reference reads by name once a listing has named it, across sessions', async ($, on) => {
  const w = world(on)
  w.apiKey = { source: '1password', ref: 'op://V2/IG/credential' }
  let ui = await open($)
  await ui.press({ key: 'component:demo' })
  expect(await text(ui, 'row:setting:credentials.apiKey')).toContain('op://V2/IG/credential')
  await ui.press({ key: 'setting:credentials.apiKey' })
  await ui.press({ key: 'pick' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'back' })
  expect(await text(ui, 'row:setting:credentials.apiKey')).toContain('1Password: op://Work/GitHub Actions/credential')
  await ui.unmount()
  // A new pane reads the names from the store: 1Password is not asked again.
  const listed = w.runs.filter(argv => argv[2] === 'items').length
  ui = await open($)
  await ui.press({ key: 'component:demo' })
  expect(await text(ui, 'row:setting:credentials.apiKey')).toContain('op://Work/GitHub Actions/credential')
  expect(w.runs.filter(argv => argv[2] === 'items').length).toBe(listed)
  await ui.unmount()
})

test('a 1Password reference reads by name only where op takes the name', () => {
  const item = { id: 'IG', title: 'GitHub Actions', category: 'LOGIN', vault: { id: 'V2', name: 'Work' }, account: 'A2' }
  expect(readableReference('op://V2/IG/sec/credential', item, [item])).toBe('op://Work/GitHub Actions/sec/credential')
  // Two items of that title in the vault: the item stays an id.
  const twin = { ...item, id: 'IG2' }
  expect(readableReference('op://V2/IG/credential', item, [item, twin])).toBe('op://Work/IG/credential')
  // A character op does not take in a name: the id stays.
  const odd = { ...item, title: 'GitHub (CI)' }
  expect(readableReference('op://V2/IG/credential', odd, [odd])).toBe('op://Work/IG/credential')
  expect(readableReference('op://V2/IG/credential', null, [])).toBe('op://V2/IG/credential')
})

test('fuzzy finds the letters in order and ranks word starts first', () => {
  const titles = ['Goohost activity', 'GitHub Auth Client', 'Grocery list', 'GitHub Actions']
  expect(ranked(titles, 'ghact', one => one)).toEqual(['GitHub Actions', 'GitHub Auth Client', 'Goohost activity'])
  expect(fuzzy('xyz', 'GitHub')).toBeUndefined()
  expect(fuzzy('', 'anything')).toBe(0)
  expect(ranked(titles, '  ', one => one)).toEqual(titles)
})

test('under a level shows the next level down that sets the key, a block stopping it', () => {
  const setting = { path: 'a', description: '', layer: null, default: 'eu', value: 'x', source: 'local', credential: false, required: false, levels: { global: 'g', repo: null, local: 'x' } }
  const all = ['global', 'repo', 'user-repo', 'local']
  // repo blocks global, so under local only the default shows.
  expect(under(setting, 'local', all)).toEqual({ label: 'the default', value: 'eu' })
  expect(under(setting, 'repo', all)).toEqual({ label: 'Everywhere', value: 'g' })
  expect(under({ ...setting, default: null }, 'global', all)).toBeUndefined()
})
