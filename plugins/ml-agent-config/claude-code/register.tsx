// Claude Code only. A harness without hooks modules (Codex) never loads this file, and every
// consumer keeps working through the CLI and docs/working-actions.md exactly as before.
//
// Four things the CLI cannot do from inside agent-run bash:
//   - run `start` when a skill expands, so the model skips locating the binary and the call;
//   - hold 1Password secrets for the session after the person approves one read, so later
//     `load --secrets` calls do not ask for Touch ID again (src/secret-cache.ts);
//   - run /reload-plugins after an install, which only the person could type before;
//   - show every component's settings in a pane, `/agent-config` with no name, and edit them there,
//     one short screen at a time (screens/), each level of a setting on its own.
//
// Its one setting, whether the cached-secrets band shows, is agent-config's own: declared in
// agent-config.json beside this file, kept in ~/.agents/config/agent-config/, edited like any other.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { cacheKey, parseCache } from '../src/secret-cache'
import type { Component, Item, Json, OnePassword, Panel, Screen, Setting, Unlock } from '../types'
import { HARNESS, OWN, firstLine, withValue, type Plan } from './cli'
import { PANE, editAt, editing, firstEdit, firstSetting, layerNames, readDescribe, savedAt, selected } from './panel'
import { draw } from './screens'
import type { Actions } from './screens/context'
import { EMPTY_PANEL, NO_ONE_PASSWORD } from './state'
import { SOURCES, isReference, parseText, targetLayer, type Stored } from './values'

export type { Plan } from './cli'
export { editText, parseText, showValue } from './values'

const unlocks = atom({ plugin: 'ml-agent-config', key: 'unlocks' } as const, [] as Unlock[])
const notice = atom({ plugin: 'ml-agent-config', key: 'notice' } as const, null as string | null)
const panel = atom({ plugin: 'ml-agent-config', key: 'panel' } as const, EMPTY_PANEL)

async function bin($: EngineInterface): Promise<string> {
  return `${(await $.env.get('AGENT_CONFIG_ROOT')) ?? $.plugin.root}/bin/agent-config`
}

// agent-config's own settings, read from the declaration beside this file.
function own($: EngineInterface): { name: string; from: string } {
  return { name: OWN, from: `${$.plugin.root}/claude-code` }
}

// Exit 2 means no declaration under this name.
export async function start($: EngineInterface, name: string, from?: string): Promise<Plan | undefined> {
  const argv = [await bin($), 'start', name, ...(from ? ['--from', from] : [])]
  const ran = await $.process.run(argv, { env: HARNESS, timeoutMs: 15000 })
  return ran.exitCode === 0 ? (JSON.parse(ran.stdout) as Plan) : undefined
}

// `write` replaces the whole layer, so the current file is read and only this key changes. The CLI
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
  const wrote = await $.process.run([await bin($), 'write', component.name, '--layer', layer, ...from], {
    env: HARNESS,
    stdin: JSON.stringify(withValue(config, dotPath, value)),
  })
  return wrote.exitCode === 0 ? undefined : firstLine(wrote.stderr) || 'the write failed'
}

// A v2 declaration may be named for the plugin or for the skill, so both are tried.
export function candidates(skill: string): string[] {
  const colon = skill.indexOf(':')
  return colon > 0 ? [skill.slice(0, colon), skill.slice(colon + 1)] : [skill]
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

async function showsBanner($: EngineInterface): Promise<boolean> {
  const plan = await start($, OWN, own($).from)
  const notices = (plan?.config as { notices?: { cacheBanner?: boolean } } | undefined)?.notices
  return notices?.cacheBanner !== false
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

// The pane. Each press updates the state and the drawing follows; a drawing cannot write state.

// When the focused element leaves the drawing, the keys go back to the message box; this puts the
// ring on an element of the new screen (awaited until it is drawn).
async function refocus($: EngineInterface, key: string | undefined): Promise<void> {
  if (!key) return
  try {
    await $.ui.focus({ requestId: PANE, key })
  } catch {
    // The pane does not hold the keys; nothing to move.
  }
}

/** Open a screen on top, remembering what was pressed to open it. */
async function go($: EngineInterface, screen: Screen, from: string, focus?: string): Promise<void> {
  await update($, panel, now => ({
    ...now,
    message: null,
    stack: [...now.stack.slice(0, -1), { ...now.stack.at(-1)!, focus: from }, screen],
  }))
  await refocus($, focus)
}

/** Close screens, back to the one under them, its focus where it was. */
async function back($: EngineInterface, close = 1, after: { message?: string; focus?: string } = {}): Promise<void> {
  const now = await read($, panel)
  const stack = now.stack.slice(0, Math.max(1, now.stack.length - close))
  await update($, panel, latest => ({ ...latest, stack, message: after.message ?? null }))
  await refocus($, after.focus ?? stack.at(-1)?.focus)
}

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
  return { ...readDescribe(ran.stdout, await $.env.get('HOME')), message: null }
}

async function openPanel($: EngineInterface): Promise<void> {
  const kept = (await read($, panel)).onePassword ?? NO_ONE_PASSWORD
  // The 1Password list stays for the session; everything else starts over.
  await update($, panel, () => ({ ...EMPTY_PANEL, onePassword: { ...kept, isLoading: false }, isLoading: true }))
  await $.ui.open({ id: PANE, title: 'agent-config', focus: true, closeOnEscape: true, rows: 40 })
  const list = await components($)
  await update($, panel, now => ({ ...now, components: list, isLoading: false }))
  await refocus($, list[0] && `component:${list[0].name}`)
}

async function openComponent($: EngineInterface, name: string): Promise<void> {
  const component = (await read($, panel)).components.find(one => one.name === name)
  if (!component) return
  await update($, panel, now => ({ ...now, selected: name, settings: [], layers: [], show: 'effective', isLoading: true }))
  await go($, { kind: 'settings' }, `component:${name}`)
  const detail = await describe($, component)
  await update($, panel, now => ({ ...now, ...detail, isLoading: false }))
  await refocus($, firstSetting(detail.settings))
}

// Write one key at one level and read the component again. The error, if any, comes back.
async function save($: EngineInterface, layer: string, path: string, value: Json | undefined): Promise<string | undefined> {
  const component = selected(await read($, panel))
  if (!component) return 'no component selected'
  const failed = await writeKey($, component, layer, path, value)
  if (!failed && component.name === OWN && path === 'notices.cacheBanner' && value === false) {
    await update($, notice, () => null)
  }
  const detail = await describe($, component)
  const ready = (await start($, component.name, component.from))?.ready ?? null
  await update($, panel, latest => ({
    ...latest,
    ...detail,
    components: latest.components.map(one => (one.name === component.name ? { ...one, ready } : one)),
    message: failed ? `Not saved: ${failed}` : detail.message,
  }))
  return failed
}

/** An on/off key flips in place: at the level shown, or where it lives now. */
async function toggle($: EngineInterface, setting: Setting): Promise<void> {
  const now = await read($, panel)
  const layer = now.show !== 'effective' ? now.show : targetLayer(setting, layerNames(now))
  const here = setting.levels[layer]
  const value = !(typeof here === 'boolean' ? here : (setting.value ?? setting.default))
  if (!(await save($, layer, setting.path, value))) {
    await update($, panel, latest => ({ ...latest, message: savedAt(setting.path, layer, value) }))
  }
}

async function openEdit($: EngineInterface, setting: Setting, canType: boolean): Promise<void> {
  const now = await read($, panel)
  const layers = layerNames(now)
  const layer = layers.includes(now.show) ? now.show : targetLayer(setting, layers)
  const edit = editAt(setting, layer)
  await update($, panel, latest => ({ ...latest, edit }))
  await go($, { kind: 'edit' }, `setting:${setting.path}`, firstEdit(setting, edit, canType))
}

async function chooseLevel($: EngineInterface, layer: string): Promise<void> {
  const setting = editing(await read($, panel))
  if (!setting) return
  await update($, panel, now => ({ ...now, edit: editAt(setting, layer) }))
  await back($)
}

async function chooseSource($: EngineInterface, source: string): Promise<void> {
  const now = await read($, panel)
  const setting = editing(now)
  if (!setting || !now.edit) return
  // The source it had: its fields as stored. Another: empty fields.
  const stored = editAt(setting, now.edit.layer)
  const draft = stored.source === source ? stored.draft : {}
  await update($, panel, latest => ({ ...latest, edit: latest.edit && { ...latest.edit, source, draft } }))
  await back($)
}

async function saveHere($: EngineInterface, value: Json | undefined): Promise<void> {
  const edit = (await read($, panel)).edit
  if (!edit) return
  if (!(await save($, edit.layer, edit.path, value))) await back($, 1, { message: savedAt(edit.path, edit.layer, value) })
}

// A plain value is read as its type; a credential keeps its other fields (an account, a cacheVar)
// while its source stays the same, and is saved once every field of its source is filled in.
async function saveEdit($: EngineInterface): Promise<void> {
  const now = await read($, panel)
  const setting = editing(now)
  const edit = now.edit
  if (!setting || !edit) return
  const refuse = async (why: string) => {
    await update($, panel, latest => ({ ...latest, message: `Not saved: ${why}` }))
  }
  if (!setting.credential) {
    const parsed = parseText(edit.text, setting.value ?? setting.default)
    if (parsed.error) return refuse(parsed.error)
    return saveHere($, parsed.value)
  }
  const fields = SOURCES[edit.source]?.fields ?? []
  const missing = fields.filter(field => !edit.draft[field.name]?.trim())
  if (missing.length > 0) return refuse(`fill in ${missing.map(field => field.label).join(' and ')}`)
  const before = setting.levels[edit.layer] ?? setting.value
  const base = isReference(before) && before.source === edit.source ? before : { source: edit.source }
  const value: Stored = { ...base, source: edit.source }
  for (const field of fields) value[field.name] = edit.draft[field.name]!.trim()
  if (edit.source === '1password' && edit.draft.account) value.account = edit.draft.account
  return saveHere($, value)
}

// 1Password, through `agent-config 1password`, which prints names and op:// addresses only.
async function onePassword($: EngineInterface, args: string[]): Promise<unknown> {
  const ran = await $.process.run([await bin($), '1password', ...args], { env: HARNESS, timeoutMs: 180000 })
  if (ran.exitCode !== 0) throw new Error(firstLine(ran.stderr) || `op ${args[0]} failed`)
  return JSON.parse(ran.stdout)
}

async function setOnePassword($: EngineInterface, change: Partial<OnePassword>, pages: Record<string, number> = {}): Promise<void> {
  await update($, panel, now => ({ ...now, onePassword: { ...now.onePassword, ...change }, pages: { ...now.pages, ...pages } }))
}

/** Every item of every account, once a session; ↻ lists them again. */
async function loadOnePassword($: EngineInterface): Promise<void> {
  await setOnePassword($, { isLoading: true, error: null })
  try {
    const got = (await onePassword($, ['items'])) as { accounts: { id: string; short: string }[]; items: Item[]; problems?: string[] }
    await setOnePassword($, {
      accounts: got.accounts.map(({ id, short }) => ({ id, short })),
      items: got.items,
      problems: got.problems ?? [],
      isLoaded: true,
      isLoading: false,
    })
  } catch (error) {
    await setOnePassword($, { isLoading: false, error: (error as Error).message })
  }
}

async function openOnePassword($: EngineInterface, canType: boolean): Promise<void> {
  const isLoaded = (await read($, panel)).onePassword.isLoaded
  await setOnePassword($, {}, { item: 0 })
  await go($, { kind: 'onepassword' }, 'pick', canType ? 'search' : undefined)
  if (!isLoaded) await loadOnePassword($)
}

async function openFilter($: EngineInterface, by: 'account' | 'vault' | 'type'): Promise<void> {
  const current = (await read($, panel)).onePassword[by]
  await setOnePassword($, {}, { choice: 0 })
  await go($, { kind: 'filter', by }, `filter:${by}`, `choice:${current ?? '*'}`)
}

async function openItem($: EngineInterface, id: string): Promise<void> {
  const item = (await read($, panel)).onePassword.items.find(one => one.id === id)
  if (!item) return
  await setOnePassword($, { item, fields: [], isLoading: true, error: null }, { ref: 0 })
  await go($, { kind: 'fields' }, `item:${id}`)
  try {
    const flags = ['--vault', item.vault.id, '--item', item.id, ...(item.account ? ['--account', item.account] : [])]
    const got = (await onePassword($, ['fields', ...flags])) as { fields: OnePassword['fields'] }
    await setOnePassword($, { fields: got.fields, isLoading: false })
    await refocus($, got.fields[0] && `ref:${got.fields[0].reference}`)
  } catch (error) {
    await setOnePassword($, { isLoading: false, error: (error as Error).message })
  }
}

// A field's op:// address becomes the reference, with its account when there are several. The
// picker closes, and the edit waits for Save.
async function pickField($: EngineInterface, reference: string): Promise<void> {
  const op = (await read($, panel)).onePassword
  const account = op.accounts.length > 1 ? op.item?.account : undefined
  await update($, panel, latest => ({
    ...latest,
    edit: latest.edit && { ...latest.edit, source: '1password', draft: { ...latest.edit.draft, ref: reference, ...(account ? { account } : {}) } },
  }))
  await back($, 2, { message: `Picked ${reference}. Press Save here to keep it.`, focus: 'save' })
}

/** The presses, bound to this engine, for the screens to call. */
function actions($: EngineInterface, canType: boolean): Actions {
  return {
    go: (screen, from, focus) => go($, screen, from, focus),
    back: () => back($),
    openComponent: name => openComponent($, name),
    setup: async name => {
      await $.prompt.submit({ text: `Run \`agent-config start ${name}\` and finish its onboarding.` })
    },
    setShow: async show => {
      await update($, panel, now => ({ ...now, show }))
    },
    toggle: setting => toggle($, setting),
    openEdit: setting => openEdit($, setting, canType),
    chooseLevel: layer => chooseLevel($, layer),
    chooseSource: source => chooseSource($, source),
    typeText: async text => {
      await update($, panel, now => ({ ...now, edit: now.edit && { ...now.edit, text } }))
    },
    typeField: async (field, text) => {
      await update($, panel, now => ({ ...now, edit: now.edit && { ...now.edit, draft: { ...now.edit.draft, [field]: text } } }))
    },
    saveEdit: () => saveEdit($),
    saveBoolean: value => saveHere($, value),
    removeHere: () => saveHere($, undefined),
    blockHere: () => saveHere($, null),
    turnPage: async (list, offset, focus) => {
      await update($, panel, now => ({ ...now, pages: { ...now.pages, [list]: offset } }))
      await refocus($, focus)
    },
    loadOnePassword: () => loadOnePassword($),
    openOnePassword: () => openOnePassword($, canType),
    search: text => setOnePassword($, { search: text }, { item: 0 }),
    openFilter: by => openFilter($, by),
    setFilter: async (by, value) => {
      await setOnePassword($, { [by]: value }, { item: 0 })
      await back($)
    },
    openItem: id => openItem($, id),
    pickField: reference => pickField($, reference),
  }
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
    const ui = $.ui.resolve(e)
    // The mobile app draws no field yet, so there each screen offers what it can without one.
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    // State a version before the screens kept: open the pane again to start it over.
    if (!Array.isArray(now.stack)) return <ui.Text dimColor>Run /agent-config again.</ui.Text>
    return draw({ now, ui, Input, act: actions($, Boolean(Input)) })
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
