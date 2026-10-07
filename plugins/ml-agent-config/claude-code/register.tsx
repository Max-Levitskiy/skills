// Claude Code only. A harness without hooks modules (Codex) never loads this file, and every
// consumer keeps working through the CLI and docs/working-actions.md exactly as before.
//
// Four things the CLI cannot do from inside agent-run bash:
//   - run `start` when a skill expands, so the model skips locating the binary and the call;
//   - hold 1Password secrets for the session after the person approves one read, so later
//     `load --secrets` calls do not ask for Touch ID again (src/secret-cache.ts);
//   - run /reload-plugins after an install, which only the person could type before;
//   - show every component's settings in a pane, `/agent-config` with no name, and edit them there.
//
// Its one setting, whether the cached-secrets band shows, is agent-config's own: declared in
// agent-config.json beside this file, kept in ~/.agents/config/agent-config/, edited like any other.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { cacheKey, parseCache } from '../src/secret-cache'
import type { Browse, Component, Json, Panel, Setting, Unlock } from '../types'

type Reference = { source: string; ref?: string }

export type Plan = {
  name: string
  ready: boolean
  config: { credentials?: Record<string, Reference> }
  actions: { id: string; type: string; keys: string[] }[]
  problems: { code: string; message: string }[]
}

const unlocks = atom({ plugin: 'ml-agent-config', key: 'unlocks' } as const, [] as Unlock[])
const notice = atom({ plugin: 'ml-agent-config', key: 'notice' } as const, null as string | null)
const panel = atom({ plugin: 'ml-agent-config', key: 'panel' } as const, {
  components: [],
  selected: null,
  settings: [],
  layers: [],
  editing: null,
  layer: 'global',
  source: '1password',
  draft: {},
  browse: null,
  message: null,
  isLoading: false,
} as Panel)

const PANE = 'agent-config'

// The namespace of this module's own setting. Its declaration sits beside this file, outside every
// plugin registry, so each call names the folder with --from.
const OWN = 'agent-config'

async function bin($: EngineInterface): Promise<string> {
  return `${(await $.env.get('AGENT_CONFIG_ROOT')) ?? $.plugin.root}/bin/agent-config`
}

// The CLI picks its harness from CLAUDECODE, which Claude Code sets for the model's shell and not
// for a hooks module's children; without it a machine with ~/.codex is read as Codex.
const HARNESS = { CLAUDECODE: '1' }

// A v2 declaration may be named for the plugin or for the skill, so both are tried.
export function candidates(skill: string): string[] {
  const colon = skill.indexOf(':')
  return colon > 0 ? [skill.slice(0, colon), skill.slice(colon + 1)] : [skill]
}

// Exit 2 means no declaration under this name.
export async function start($: EngineInterface, name: string, from?: string): Promise<Plan | undefined> {
  const argv = [await bin($), 'start', name, ...(from ? ['--from', from] : [])]
  const ran = await $.process.run(argv, { env: HARNESS, timeoutMs: 15000 })
  return ran.exitCode === 0 ? (JSON.parse(ran.stdout) as Plan) : undefined
}

// Names with no declaration, so a skill expanded again does not spawn the CLI again. A reload
// starts it over, which only costs one more spawn.
const undeclared = new Set<string>()

async function find($: EngineInterface, names: string[]): Promise<Plan | undefined> {
  for (const name of names) {
    if (undeclared.has(name)) continue
    const plan = await start($, name)
    if (plan) return plan
    undeclared.add(name)
  }
  return undefined
}

export function onePasswordKeys(plan: Plan, cache: Record<string, string>): string[] {
  return Object.entries(plan.config.credentials ?? {})
    .filter(([, reference]) => reference.source === '1password' && !cache[cacheKey(reference)])
    .map(([key]) => key)
}

// One `load` for every uncached 1Password key, so the person approves once. Secrets come back on
// fd 3, redirected to the stdout this module reads; they never reach the model.
export async function unlock($: EngineInterface, plan: Plan): Promise<Unlock | undefined> {
  const cache = parseCache(await $.env.get('AGENT_CONFIG_SECRETS'))
  const keys = onePasswordKeys(plan, cache)
  if (keys.length === 0) return undefined

  const ran = await $.process.run(
    ['sh', '-c', 'exec "$0" load "$@" 3>&1 1>/dev/null', await bin($), plan.name, '--secrets', ...keys.map(key => `credentials.${key}`)],
    { env: HARNESS, timeoutMs: 120000 },
  )
  const secrets = ran.exitCode === 0 ? (JSON.parse(ran.stdout) as Record<string, string>) : {}
  const missing = keys.filter(key => !secrets[`credentials.${key}`])
  const result: Unlock =
    missing.length === 0
      ? { name: plan.name, keys, isCached: true }
      : { name: plan.name, keys, isCached: false, reason: ran.stderr.trim().split('\n')[0] || `no value for ${missing.join(', ')}` }
  if (result.isCached) {
    for (const key of keys) cache[cacheKey(plan.config.credentials![key]!)] = secrets[`credentials.${key}`]!
    await $.env.set('AGENT_CONFIG_SECRETS', JSON.stringify(cache))
  }
  await update($, unlocks, list => [...list.filter(one => one.name !== plan.name), result])
  return result
}

// agent-config's own settings, read from the declaration beside this file.
function own($: EngineInterface): { name: string; from: string } {
  return { name: OWN, from: `${$.plugin.root}/claude-code` }
}

async function showsBanner($: EngineInterface): Promise<boolean> {
  const plan = await start($, OWN, own($).from)
  const notices = (plan?.config as { notices?: { cacheBanner?: boolean } } | undefined)?.notices
  return notices?.cacheBanner !== false
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

function withoutKey(config: Record<string, unknown>, dotPath: string): void {
  const segments = dotPath.split('.')
  let cursor: Record<string, unknown> | undefined = config
  for (const segment of segments.slice(0, -1)) {
    const next: unknown = cursor?.[segment]
    cursor = typeof next === 'object' && next !== null && !Array.isArray(next) ? (next as Record<string, unknown>) : undefined
  }
  if (cursor) delete cursor[segments.at(-1)!]
}

function withKey(config: Record<string, unknown>, dotPath: string, value: Json): void {
  const segments = dotPath.split('.')
  let cursor = config
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  }
  cursor[segments.at(-1)!] = value
}

// `write` replaces the whole layer, so the current file is read and only this key changes. No value
// removes the key from that layer, so a lower layer or the default shows through again. The CLI
// refuses a value that looks like an inline secret, and its reason comes back as the error.
export async function writeKey(
  $: EngineInterface,
  component: { name: string; from?: string },
  layer: string,
  dotPath: string,
  value: Json | undefined,
): Promise<string | undefined> {
  const from = component.from ? ['--from', component.from] : []
  const where = await $.process.run([await bin($), 'path', component.name, '--layer', layer, ...from], { env: HARNESS })
  if (where.exitCode !== 0) return firstLine(where.stderr) || `no ${layer} layer here`
  const file = (JSON.parse(where.stdout) as { layers: { path: string | null }[] }).layers[0]?.path
  if (!file) return `no ${layer} layer here; it needs a repository`
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(await $.fs.read(file)) as Record<string, unknown>
  } catch {
    // No file yet: the layer starts empty.
  }
  if (value === undefined) withoutKey(config, dotPath)
  else withKey(config, dotPath, value)
  const wrote = await $.process.run([await bin($), 'write', component.name, '--layer', layer, ...from], {
    env: HARNESS,
    stdin: JSON.stringify(config),
  })
  return wrote.exitCode === 0 ? undefined : firstLine(wrote.stderr) || 'the write failed'
}

async function hideBannerForGood($: EngineInterface): Promise<void> {
  const failed = await writeKey($, own($), 'global', 'notices.cacheBanner', false)
  await update($, notice, () => null)
  if (failed) $.ui.toast(`agent-config: could not save the choice: ${failed}`)
}

// Drops every cached secret and the band; the next skill of a ready component asks 1Password again.
async function forget($: EngineInterface): Promise<void> {
  await $.env.set('AGENT_CONFIG_SECRETS', undefined)
  await update($, unlocks, () => [])
  await update($, notice, () => null)
}

// The pane's data. A drawing cannot write state, so these run from the command and the presses.
async function components($: EngineInterface): Promise<Component[]> {
  const listed = await $.process.run([await bin($), 'list'], { env: HARNESS, timeoutMs: 15000 })
  const installed =
    listed.exitCode === 0 ? (JSON.parse(listed.stdout) as { components: { name: string; plugin: string }[] }).components : []
  const all: Component[] = [{ ...own($), plugin: 'ml-agent-config', ready: null }, ...installed.map(one => ({ ...one, ready: null }))]
  return Promise.all(all.map(async one => ({ ...one, ready: (await start($, one.name, one.from))?.ready ?? null })))
}

async function describe($: EngineInterface, component: Component): Promise<Pick<Panel, 'settings' | 'layers' | 'message'>> {
  const from = component.from ? ['--from', component.from] : []
  const ran = await $.process.run([await bin($), 'describe', component.name, ...from], { env: HARNESS, timeoutMs: 15000 })
  if (ran.exitCode !== 0) return { settings: [], layers: [], message: firstLine(ran.stderr) || 'describe failed' }
  const out = JSON.parse(ran.stdout) as { keys: Setting[]; layers: { layer: string; path: string | null }[] }
  return {
    settings: out.keys.map(({ path, description, layer, default: fallback, value, source, credential, required }) => ({
      path,
      description,
      layer,
      default: fallback,
      value,
      source,
      credential,
      required,
    })),
    layers: out.layers.filter(one => one.path).map(one => one.layer),
    message: null,
  }
}

async function openPanel($: EngineInterface): Promise<void> {
  await update($, panel, now => ({ ...now, isLoading: true, editing: null, message: null }))
  await $.ui.open({ id: PANE, title: 'agent-config', focus: true, closeOnEscape: true })
  const list = await components($)
  const kept = (await read($, panel)).selected
  const selected = list.find(one => one.name === kept) ?? list.find(one => one.name !== OWN) ?? list[0]!
  const detail = await describe($, selected)
  await update($, panel, now => ({ ...now, ...detail, components: list, selected: selected.name, isLoading: false }))
}

async function select($: EngineInterface, name: string): Promise<void> {
  const component = (await read($, panel)).components.find(one => one.name === name)
  if (!component) return
  await update($, panel, now => ({ ...now, selected: name, editing: null, message: null, isLoading: true }))
  const detail = await describe($, component)
  await update($, panel, now => ({ ...now, ...detail, isLoading: false }))
}

// Where an edit lands unless the person picks another layer: where the value is set now, else
// where the declaration recommends, else global.
export function targetLayer(setting: Setting, layers: readonly string[]): string {
  const wanted = [setting.source, setting.layer, 'global'].find(one => one && layers.includes(one))
  return wanted ?? layers[0] ?? 'global'
}

async function save($: EngineInterface, layer: string, dotPath: string, value: Json | undefined): Promise<void> {
  const now = await read($, panel)
  const component = now.components.find(one => one.name === now.selected)
  if (!component) return
  const failed = await writeKey($, component, layer, dotPath, value)
  if (!failed && component.name === OWN && dotPath === 'notices.cacheBanner' && value === false) {
    await update($, notice, () => null)
  }
  const detail = await describe($, component)
  const ready = (await start($, component.name, component.from))?.ready ?? null
  const done = value === undefined ? `Removed ${dotPath} from ${layer}.` : `Saved ${dotPath} in ${layer}.`
  await update($, panel, latest => ({
    ...latest,
    ...detail,
    components: latest.components.map(one => (one.name === component.name ? { ...one, ready } : one)),
    editing: failed ? latest.editing : null,
    message: failed ? `Not saved: ${failed}` : done,
  }))
}

// What each credential source needs, in the order asked. The same required fields as
// REQUIRED_FIELDS in src/credentials.ts, which this module cannot import (it needs Node).
export const SOURCES: Record<string, { label: string; fields: { name: string; label: string; hint: string }[] }> = {
  '1password': { label: '1Password', fields: [{ name: 'ref', label: 'Reference', hint: 'op://Vault/Item/field' }] },
  env: { label: 'Environment variable', fields: [{ name: 'var', label: 'Variable', hint: 'MY_API_KEY' }] },
  dotenv: {
    label: '.env file',
    fields: [
      { name: 'path', label: 'File', hint: '~/.config/my-app/.env' },
      { name: 'var', label: 'Variable', hint: 'MY_API_KEY' },
    ],
  },
  keychain: {
    label: 'Keychain',
    fields: [
      { name: 'service', label: 'Service', hint: 'my-app' },
      { name: 'account', label: 'Account', hint: 'me@example.com' },
    ],
  },
  command: { label: 'Command', fields: [{ name: 'command', label: 'Command', hint: 'pass show my-app/key' }] },
}

type Stored = { source: string; [field: string]: Json }

function isReference(value: Json): value is Stored {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.source === 'string'
}

// A value as a person reads it: no quotes or braces. A credential shows where the secret lives.
export function showValue(value: Json): string {
  if (value === null) return 'not set'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(showValue).join(', ')
  if (isReference(value)) {
    const kind = SOURCES[value.source]
    const where = (kind?.fields ?? []).map(field => value[field.name]).filter(part => typeof part === 'string' && part)
    return `${kind?.label ?? value.source}: ${where.join(' / ')}`
  }
  return Object.entries(value)
    .map(([key, child]) => `${key}: ${showValue(child)}`)
    .join(', ')
}

// The edit field's starting text, in the form parseText reads back.
export function editText(value: Json): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// The text typed for a plain key, read as the type of its current value or default: a number, on
// or off, a comma-separated list, or text. Empty removes the key from the layer.
export function parseText(text: string, like: Json): { value?: Json; error?: string } {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  if (typeof like === 'number') {
    const number = Number(trimmed)
    return Number.isFinite(number) ? { value: number } : { error: `${trimmed} is not a number` }
  }
  if (typeof like === 'boolean') {
    if (/^(on|true|yes)$/i.test(trimmed)) return { value: true }
    if (/^(off|false|no)$/i.test(trimmed)) return { value: false }
    return { error: 'type on or off' }
  }
  if (Array.isArray(like)) return { value: trimmed.split(',').map(part => part.trim()).filter(Boolean) }
  if (like !== null && typeof like === 'object') {
    try {
      return { value: JSON.parse(trimmed) as Json }
    } catch {
      return { error: 'this key holds an object: type it as JSON' }
    }
  }
  return { value: trimmed }
}

// Browsing 1Password through `agent-config 1password`, which prints names and op:// addresses only.
async function browseStep<T>($: EngineInterface, what: string, flags: string[]): Promise<T | string> {
  const ran = await $.process.run([await bin($), '1password', what, ...flags], { env: HARNESS, timeoutMs: 120000 })
  return ran.exitCode === 0 ? (JSON.parse(ran.stdout) as T) : firstLine(ran.stderr) || `op ${what} failed`
}

const BROWSE_START: Browse = { step: 'account', account: null, vault: null, item: null, options: [], filter: '', isLoading: true, error: null }

async function showStep($: EngineInterface, step: Browse['step'], options: Browse['options'] | string, at: Partial<Browse>): Promise<void> {
  await update($, panel, latest =>
    latest.browse === null
      ? latest
      : {
          ...latest,
          browse:
            typeof options === 'string'
              ? { ...latest.browse, ...at, isLoading: false, error: options }
              : { ...latest.browse, ...at, step, options, filter: '', isLoading: false, error: null },
        },
  )
}

async function browseVaults($: EngineInterface, account: string | null): Promise<void> {
  await update($, panel, latest => ({ ...latest, browse: latest.browse && { ...latest.browse, account, isLoading: true } }))
  const got = await browseStep<{ vaults: { id: string; name: string }[] }>($, 'vaults', account ? ['--account', account] : [])
  await showStep($, 'vault', typeof got === 'string' ? got : got.vaults.map(one => ({ value: one.id, label: one.name })), { account })
}

async function openBrowse($: EngineInterface): Promise<void> {
  await update($, panel, latest => ({ ...latest, browse: BROWSE_START, message: null }))
  const got = await browseStep<{ accounts: { id: string; label: string }[] }>($, 'accounts', [])
  if (typeof got === 'string') return showStep($, 'account', got, {})
  if (got.accounts.length > 1) return showStep($, 'account', got.accounts.map(one => ({ value: one.id, label: one.label })), {})
  return browseVaults($, null)
}

function accountFlag(browse: Browse): string[] {
  return browse.account ? ['--account', browse.account] : []
}

async function browseItems($: EngineInterface, browse: Browse, vault: { id: string; name: string }): Promise<void> {
  await update($, panel, latest => ({ ...latest, browse: latest.browse && { ...latest.browse, isLoading: true } }))
  const got = await browseStep<{ items: { id: string; title: string; category: string }[] }>($, 'items', [
    '--vault',
    vault.id,
    ...accountFlag(browse),
  ])
  const options = typeof got === 'string' ? got : got.items.map(one => ({ value: one.id, label: `${one.title} · ${one.category.toLowerCase()}` }))
  await showStep($, 'item', options, { vault })
}

async function browseFields($: EngineInterface, browse: Browse, item: { id: string; title: string }): Promise<void> {
  await update($, panel, latest => ({ ...latest, browse: latest.browse && { ...latest.browse, isLoading: true } }))
  const got = await browseStep<{ fields: { label: string; section: string | null; type: string; reference: string }[] }>($, 'fields', [
    '--vault',
    browse.vault!.id,
    '--item',
    item.id,
    ...accountFlag(browse),
  ])
  const options =
    typeof got === 'string'
      ? got
      : got.fields.map(one => ({ value: one.reference, label: `${one.section ? `${one.section} › ` : ''}${one.label} · ${one.type.toLowerCase()}` }))
  await showStep($, 'field', options, { item })
}

async function pickBrowse($: EngineInterface, value: string): Promise<void> {
  const browse = (await read($, panel)).browse
  if (!browse) return
  const label = browse.options.find(one => one.value === value)?.label ?? value
  if (browse.step === 'account') return browseVaults($, value)
  if (browse.step === 'vault') return browseItems($, browse, { id: value, name: label })
  if (browse.step === 'item') return browseFields($, browse, { id: value, title: label.split(' · ')[0]! })
  // A field: its op:// address becomes the reference, and the account with it when there are several.
  await update($, panel, latest => ({
    ...latest,
    draft: { ...latest.draft, ref: value, ...(browse.account ? { account: browse.account } : {}) },
    browse: null,
    message: `Picked ${value}. Press Save to keep it.`,
  }))
}

// One step up: the list it came from, listed again.
async function browseBack($: EngineInterface): Promise<void> {
  const browse = (await read($, panel)).browse
  if (!browse) return
  if (browse.step === 'field') return browseItems($, browse, browse.vault!)
  if (browse.step === 'item') return browseVaults($, browse.account)
  if (browse.step === 'vault' && browse.account) return openBrowse($)
  await update($, panel, latest => ({ ...latest, browse: null }))
}

// The choices drawn at once; past this the filter narrows them.
const SHOWN = 30

export function matching(options: Browse['options'], filter: string): Browse['options'] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  return options.filter(one => words.every(word => one.label.toLowerCase().includes(word)))
}

async function startEdit($: EngineInterface, setting: Setting): Promise<void> {
  const current = setting.value ?? setting.default
  const reference = isReference(current) ? current : undefined
  const draft = Object.fromEntries(
    Object.entries(reference ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  await update($, panel, latest => ({
    ...latest,
    editing: setting.path,
    layer: targetLayer(setting, latest.layers),
    source: reference && SOURCES[reference.source] ? reference.source : '1password',
    draft,
    browse: null,
    message: null,
  }))
}

async function savePlain($: EngineInterface, setting: Setting, text: string): Promise<void> {
  const parsed = parseText(text, setting.value ?? setting.default)
  if (parsed.error) {
    await update($, panel, latest => ({ ...latest, message: `Not saved: ${parsed.error}` }))
    return
  }
  await save($, (await read($, panel)).layer, setting.path, parsed.value)
}

// A reference keeps its other fields (an account, a cacheVar) while its source stays the same.
async function saveReference($: EngineInterface, setting: Setting): Promise<void> {
  const now = await read($, panel)
  const fields = SOURCES[now.source]?.fields ?? []
  const missing = fields.filter(field => !now.draft[field.name]?.trim())
  if (missing.length > 0) {
    await update($, panel, latest => ({ ...latest, message: `Not saved: fill in ${missing.map(field => field.label).join(' and ')}` }))
    return
  }
  const before = setting.value
  const base = isReference(before) && before.source === now.source ? before : { source: now.source }
  const value: Stored = { ...base, source: now.source }
  for (const field of fields) value[field.name] = now.draft[field.name]!.trim()
  if (now.source === '1password' && now.draft.account) value.account = now.draft.account
  await save($, now.layer, setting.path, value)
}

function isBoolean(setting: Setting): boolean {
  return typeof (setting.value ?? setting.default) === 'boolean'
}

export function summary(plan: Plan, cached: readonly Unlock[]): string {
  const lines = [plan.ready ? `${plan.name}: ready.` : `${plan.name}: needs setup.`]
  const missing = plan.actions.flatMap(action => action.keys)
  if (missing.length > 0) lines.push(`Missing: ${missing.join(', ')}.`)
  for (const action of plan.actions) lines.push(`- action ${action.id} (${action.type})`)
  for (const problem of plan.problems) lines.push(`- problem ${problem.code}: ${problem.message}`)
  const one = cached.find(entry => entry.name === plan.name)
  if (one?.isCached) lines.push(`1Password: cached for this session (${one.keys.join(', ')}).`)
  if (one && !one.isCached) lines.push(`1Password: not cached (${one.reason}). Retry: /agent-config unlock ${plan.name}`)
  return lines.join('\n')
}

export function resumeText(answer: string, name: string | undefined): string {
  const next = name ? `run \`agent-config start ${name}\` again and continue` : 'continue'
  return [
    `Running /reload-plugins answered: ${answer.trim() || '(no output)'}`,
    `If that says the plugins reloaded, ${next}.`,
    'If it says it could not, nothing was reloaded: ask the person to run /reload-plugins, or to restart the session where that command is not available.',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-config',
      description: 'agent-config: the settings pane, a component\'s readiness, or unlock and forget its 1Password secrets',
      argumentHint: '[<name> | unlock <name> | forget]',
    })
    await $.tool.register({
      name: 'reload_plugins',
      description:
        'Runs /reload-plugins for the agent-config:reload action, then sends a prompt that resumes the work. ' +
        'It runs once this turn ends, so end the turn right after calling it.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'The component to run `agent-config start` for after the reload' } },
      },
    })
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    const computed = await next(e)
    const plan = await find($, candidates(e.skill))
    if (!plan) return computed

    // A person who declined Touch ID once this session is not asked again on every skill.
    const earlier = (await read($, unlocks)).find(one => one.name === plan.name)
    const unlocked = plan.ready && !earlier ? await unlock($, plan) : undefined
    if (!plan.ready) $.ui.status(`agent-config: ${plan.name} needs setup`)
    if (unlocked?.isCached && (await showsBanner($))) {
      await update($, notice, () => `1Password cached for ${plan.name} for this session`)
    }

    const block = [
      '<agent-config>',
      `\`agent-config start ${plan.name}\` already ran for this skill. Use this output; do not run the start step again.`,
      '```json',
      JSON.stringify(plan, null, 2),
      '```',
      '</agent-config>',
    ].join('\n')
    return { text: `${block}\n\n${computed.text}` }
  })

  on('command.run', { command: 'agent-config' }, async ($, e) => {
    const [first = '', second = ''] = e.args.trim().split(/\s+/)
    if (first === 'forget') {
      await forget($)
      $.ui.status(undefined)
      return { text: 'Forgot every cached 1Password secret for this session.' }
    }
    const name = first === 'unlock' ? second : first
    if (!first) {
      await openPanel($)
      return { text: 'Opened the agent-config pane.' }
    }
    if (!name) return { text: 'Usage: /agent-config [<name> | unlock <name> | forget]' }
    const plan = await start($, name)
    if (!plan) return { text: `${name}: no agent-config declaration found.` }
    if (first === 'unlock') {
      if (!plan.ready) return { text: summary(plan, []) }
      const result = await unlock($, plan)
      if (!result) return { text: `${name}: nothing to unlock; its 1Password secrets are cached or it has none.` }
    }
    return { text: summary(plan, await read($, unlocks)) }
  })

  on('session.end', async ($, e, next) => {
    await forget($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, notice)
    if (text === null || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>agent-config: {text} </Text>
        <Button key="forget" label="Forget" onPress={() => forget($)} />
        <Button key="never" label="Don't show again" onPress={() => hideBannerForGood($)} />
        <Button key="close" label="×" role="dismiss" onPress={() => update($, notice, () => null)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const now = await read($, panel)
    const { Box, Button, Text } = $.ui.resolve(e)
    // The mobile app draws no field yet, so there the pane offers the toggles alone.
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const Select = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Select
    const browse = now.browse
    const shown = browse ? matching(browse.options, browse.filter) : []
    const component = now.components.find(one => one.name === now.selected)
    const editing = now.settings.find(one => one.path === now.editing)
    return (
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          {now.components.map(one => (
            <Button
              key={`component:${one.name}`}
              label={`${one.name} ${one.ready === null ? '?' : one.ready ? 'ready' : 'needs setup'}`}
              variant={one.name === now.selected ? 'primary' : undefined}
              onPress={() => select($, one.name)}
            />
          ))}
        </Box>
        {now.isLoading && <Text dimColor>Loading…</Text>}
        {component && !now.isLoading && (
          <Box flexDirection="column">
            <Text dimColor>
              {component.plugin}
              {component.ready === false ? ' · needs setup' : ''}
            </Text>
            {component.ready === false && (
              <Button
                key="setup"
                label="Set up with Claude"
                onPress={() => $.prompt.submit({ text: `Run \`agent-config start ${component.name}\` and finish its onboarding.` })}
              />
            )}
            {now.settings.length === 0 && <Text dimColor>No declared settings.</Text>}
            {now.settings.map(setting => (
              <Box key={`setting:${setting.path}`} flexDirection="column" marginTop={1}>
                <Box>
                  <Text bold>{setting.path} </Text>
                  <Text color={setting.value === null && setting.required ? 'red' : undefined}>
                    {setting.value === null ? (setting.required ? 'missing' : 'not set') : showValue(setting.value)}
                  </Text>
                  <Text dimColor> {setting.source ? `(${setting.source})` : ''} </Text>
                  {isBoolean(setting) && (
                    <Button
                      key={`toggle:${setting.path}`}
                      label={(setting.value ?? setting.default) === true ? 'Turn off' : 'Turn on'}
                      onPress={() => save($, targetLayer(setting, now.layers), setting.path, !(setting.value ?? setting.default))}
                    />
                  )}
                  {Input && (
                    <Button
                      key={`edit:${setting.path}`}
                      label="Edit"
                      dimColor
                      onPress={() => startEdit($, setting)}
                    />
                  )}
                </Box>
                <Text dimColor>{setting.description}</Text>
              </Box>
            ))}
            {editing && Input && (
              <Box flexDirection="column" marginTop={1}>
                <Box flexWrap="wrap">
                  <Text>Write to </Text>
                  {now.layers.map(layer => (
                    <Button
                      key={`layer:${layer}`}
                      label={layer}
                      variant={layer === now.layer ? 'primary' : undefined}
                      onPress={() => update($, panel, latest => ({ ...latest, layer }))}
                    />
                  ))}
                  <Button key="cancel" label="Cancel" dimColor onPress={() => update($, panel, latest => ({ ...latest, editing: null }))} />
                </Box>
                {editing.credential ? (
                  <Box flexDirection="column">
                    <Box flexWrap="wrap">
                      <Text>Source </Text>
                      {Object.entries(SOURCES).map(([source, kind]) => (
                        <Button
                          key={`source:${source}`}
                          label={kind.label}
                          variant={source === now.source ? 'primary' : undefined}
                          onPress={() => update($, panel, latest => ({ ...latest, source }))}
                        />
                      ))}
                    </Box>
                    {(SOURCES[now.source]?.fields ?? []).map((field, index) => (
                      <Input
                        key={`field:${field.name}`}
                        label={`${field.label} `}
                        value={now.draft[field.name] ?? ''}
                        placeholder={field.hint}
                        submitLabel="save"
                        autoFocus={index === 0 ? true : undefined}
                        onInput={text => update($, panel, latest => ({ ...latest, draft: { ...latest.draft, [field.name]: text } }))}
                        onSubmit={text =>
                          update($, panel, latest => ({ ...latest, draft: { ...latest.draft, [field.name]: text } })).then(() =>
                            saveReference($, editing),
                          )
                        }
                      />
                    ))}
                    {now.source === '1password' && !browse && (
                      <Button key="browse" label="Browse 1Password" onPress={() => openBrowse($)} />
                    )}
                    {browse && Select && (
                      <Box flexDirection="column" borderStyle="round" paddingX={1}>
                        <Text dimColor>
                          {['1Password', browse.vault?.name, browse.item?.title].filter(Boolean).join(' › ')}
                        </Text>
                        {browse.isLoading && <Text dimColor>Asking 1Password; approve it if it asks.</Text>}
                        {browse.error && <Text color="red">{browse.error}</Text>}
                        {!browse.isLoading && !browse.error && browse.options.length > 10 && (
                          <Input
                            key="filter"
                            label="Filter "
                            value={browse.filter}
                            placeholder="type to narrow the list"
                            onInput={text => update($, panel, latest => ({ ...latest, browse: latest.browse && { ...latest.browse, filter: text } }))}
                            onSubmit={text => update($, panel, latest => ({ ...latest, browse: latest.browse && { ...latest.browse, filter: text } }))}
                          />
                        )}
                        {!browse.isLoading && shown.length > 0 && (
                          <Select
                            key={`pick:${browse.step}`}
                            label={`${browse.step[0]!.toUpperCase()}${browse.step.slice(1)} `}
                            options={shown.slice(0, SHOWN)}
                            autoFocus
                            onSelect={value => pickBrowse($, value)}
                          />
                        )}
                        {shown.length > SHOWN && <Text dimColor>{shown.length - SHOWN} more; type to narrow the list.</Text>}
                        {!browse.isLoading && !browse.error && shown.length === 0 && <Text dimColor>Nothing matches.</Text>}
                        <Box>
                          <Button key="browse-back" label="Back" dimColor onPress={() => browseBack($)} />
                          <Button key="browse-close" label="Close" dimColor onPress={() => update($, panel, latest => ({ ...latest, browse: null }))} />
                        </Box>
                      </Box>
                    )}
                    <Box>
                      <Button key="save" label="Save" variant="primary" onPress={() => saveReference($, editing)} />
                      <Button key="remove" label={`Remove from ${now.layer}`} dimColor onPress={() => save($, now.layer, editing.path, undefined)} />
                    </Box>
                    <Text dimColor>Where the secret lives, never the secret itself.</Text>
                  </Box>
                ) : (
                  <Input
                    key="value"
                    label={`${editing.path} `}
                    value={editText(editing.value)}
                    placeholder={Array.isArray(editing.value ?? editing.default) ? 'a, b, c; empty removes it from this layer' : 'empty removes it from this layer'}
                    submitLabel="save"
                    autoFocus
                    onSubmit={text => savePlain($, editing, text)}
                  />
                )}
              </Box>
            )}
            {now.message && <Text>{now.message}</Text>}
          </Box>
        )}
      </Box>
    )
  })

  // A command cannot run inside the tool call the turn waits on, so a timer queues it for idle.
  // The command can refuse (a remote connection does), so its answer goes into the resume prompt.
  on('tool.call', { tool: 'mcp__ml-agent-config__reload_plugins' }, async ($, e) => {
    const name = typeof e.name === 'string' && e.name ? e.name : undefined
    $.clock.after(0, async () => {
      let answer: string
      try {
        answer = (await $.command.run({ command: 'reload-plugins' })).text ?? ''
      } catch (error) {
        answer = `it did not run: ${String(error)}`
      }
      await $.prompt.submit({ text: resumeText(answer, name) })
    })
    return { result: 'Reload queued. End this turn now; a prompt resumes the work after the reload.' }
  })
}
