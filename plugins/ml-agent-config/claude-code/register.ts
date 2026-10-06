// Claude Code only. A harness without hooks modules (Codex) never loads this file, and every
// consumer keeps working through the CLI and docs/working-actions.md exactly as before.
//
// Three things the CLI cannot do from inside agent-run bash:
//   - run `start` when a skill expands, so the model skips locating the binary and the call;
//   - hold 1Password secrets for the session after the person approves one read, so later
//     `load --secrets` calls do not ask for Touch ID again (src/secret-cache.ts);
//   - run /reload-plugins after an install, which only the person could type before.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { cacheKey, parseCache } from '../src/secret-cache'
import type { Unlock } from '../types'

type Reference = { source: string; ref?: string }

export type Plan = {
  name: string
  ready: boolean
  config: { credentials?: Record<string, Reference> }
  actions: { id: string; type: string; keys: string[] }[]
  problems: { code: string; message: string }[]
}

const unlocks = atom({ plugin: 'ml-agent-config', key: 'unlocks' } as const, [] as Unlock[])

async function bin($: EngineInterface): Promise<string> {
  return `${(await $.env.get('AGENT_CONFIG_ROOT')) ?? $.plugin.root}/bin/agent-config`
}

// A v2 declaration may be named for the plugin or for the skill, so both are tried.
export function candidates(skill: string): string[] {
  const colon = skill.indexOf(':')
  return colon > 0 ? [skill.slice(0, colon), skill.slice(colon + 1)] : [skill]
}

// Exit 2 means no declaration under this name.
export async function start($: EngineInterface, name: string): Promise<Plan | undefined> {
  const ran = await $.process.run([await bin($), 'start', name], { timeoutMs: 15000 })
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
    { timeoutMs: 120000 },
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-config',
      description: 'agent-config: readiness of a component, or unlock and forget its 1Password secrets',
      argumentHint: '<name> | unlock <name> | forget',
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
    else if (unlocked?.isCached) $.ui.status(`agent-config: 1Password cached for ${plan.name} (/agent-config forget)`)

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
      await $.env.set('AGENT_CONFIG_SECRETS', undefined)
      await update($, unlocks, () => [])
      $.ui.status(undefined)
      return { text: 'Forgot every cached 1Password secret for this session.' }
    }
    const name = first === 'unlock' ? second : first
    if (!name) return { text: 'Usage: /agent-config <name> | unlock <name> | forget' }
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
    await $.env.set('AGENT_CONFIG_SECRETS', undefined)
    await update($, unlocks, () => [])
    return next(e)
  })

  // A command cannot run inside the tool call the turn waits on, so a timer queues it for idle.
  on('tool.call', { tool: 'mcp__ml-agent-config__reload_plugins' }, async ($, e) => {
    const name = typeof e.name === 'string' && e.name ? e.name : undefined
    $.clock.after(0, async () => {
      await $.command.run({ command: 'reload-plugins' })
      await $.prompt.submit({
        text: name ? `Plugins reloaded. Run \`agent-config start ${name}\` again and continue.` : 'Plugins reloaded. Continue.',
      })
    })
    return { result: 'Reload queued. End this turn now; a prompt resumes the work after the reload.' }
  })
}
