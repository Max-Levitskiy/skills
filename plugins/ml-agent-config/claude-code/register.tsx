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
import type { Component, Json, Panel, Setting, Unlock } from '../types'

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

// Text in the edit field is JSON when it parses and a plain string otherwise, so `acme` and
// `"acme"` both mean the string; empty removes the key from the layer.
export function parseValue(text: string): Json | undefined {
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as Json
  } catch {
    return text
  }
}

export function showValue(value: Json): string {
  if (typeof value === 'string') return parseValue(value) === value ? value : JSON.stringify(value)
  if (value !== null && typeof value === 'object' && 'source' in value && typeof value.source === 'string') {
    const where = 'ref' in value ? value.ref : 'var' in value ? value.var : 'path' in value ? value.path : undefined
    return where === undefined ? value.source : `${value.source} ${String(where)}`
  }
  return JSON.stringify(value)
}

// The person's arrows walk the pane's ring past its last element onto the engine's own stops: the
// close mark and the tab of another open pane, such as the agents view, which then takes over.
// Their own moves stay inside this pane's elements; Esc still closes it.
export function keepsRing(move: { element?: string; origin: { kind: string } }): boolean {
  return move.origin.kind === 'person' && move.element === undefined
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
                      onPress={() =>
                        update($, panel, latest => ({ ...latest, editing: setting.path, layer: targetLayer(setting, latest.layers), message: null }))
                      }
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
                <Input
                  key="value"
                  label={`${editing.path} = `}
                  value={editing.value === null ? '' : editing.credential ? JSON.stringify(editing.value) : showValue(editing.value)}
                  placeholder="JSON or text; empty removes it from this layer"
                  submitLabel="save"
                  autoFocus
                  onSubmit={text => save($, now.layer, editing.path, parseValue(text))}
                />
                {editing.credential && <Text dimColor>A reference, never the secret: {'{"source":"1password","ref":"op://…"}'}</Text>}
              </Box>
            )}
            {now.message && <Text>{now.message}</Text>}
          </Box>
        )}
      </Box>
    )
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => (keepsRing(e) ? {} : next(e)))

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
