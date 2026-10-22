// The config layers as a person reads them, in the order `describe` lists them: global, any
// context's team and me files, then repo, user-repo and local. A higher level overrides a lower one
// key by key, and the default sits under all.

import type { Json, Panel, Setting } from '../../types'
import type { Names } from '../values'
import type { Defs } from '../../src/key-schema'
import { display } from '../tree'

/** A level's name, its chip, a hint, who a value there reaches, and how an override there is offered. */
export type LevelInfo = { label: string; short: string; hint: string; audience: string; offer: string }

const FIXED: Record<string, LevelInfo> = {
  global: { label: 'Everywhere', short: 'Everywhere', hint: '~/.agents, every project', audience: 'in every project, for you', offer: 'Everywhere, in all my projects' },
  repo: { label: 'Repo, shared', short: 'Repo', hint: 'committed, the whole team', audience: 'for the whole team in this repo', offer: 'For the team in this repo' },
  'user-repo': { label: 'Repo, just me', short: 'Repo (me)', hint: '~/.agents, this repo, only you', audience: 'for you in this repo', offer: 'Just for me in this repo' },
  local: { label: 'This checkout', short: 'Checkout', hint: 'gitignored, this folder only', audience: 'in this checkout only', offer: 'In this checkout only' },
}

/** A context's team level: `context:<name>`, without the `:me` of its personal file. */
function teamContext(layer: string): string | undefined {
  return /^context:([^:]+)$/.exec(layer)?.[1]
}

export function levelInfo(layer: string): LevelInfo {
  const fixed = FIXED[layer]
  if (fixed) return fixed
  const team = teamContext(layer)
  if (team) {
    return { label: `Context ${team}, shared`, short: team, hint: `~/.agents/contexts/${team}, shared with the team`, audience: `for the whole team in ${team}`, offer: `For the team in ${team}` }
  }
  const me = /^context:([^:]+):me$/.exec(layer)?.[1]
  if (me) {
    return { label: `Context ${me}, just me`, short: `${me} (me)`, hint: `~/.agents/contexts/${me}, only you`, audience: `for you in ${me}`, offer: `Just for me in ${me}` }
  }
  return { label: layer, short: layer, hint: 'another level', audience: 'at this level', offer: layer }
}

/** The contexts that apply, outermost first, each with why: `acme (remote) › acme-web (parent)`. */
export function chainLine(contexts: Panel['contexts']): string {
  return contexts.length > 0 ? contexts.map(one => `${one.name} (${one.via})`).join(' › ') : 'none apply here'
}

export function levelLabel(layer: string | null): string {
  if (layer === 'default') return 'default'
  return layer ? levelInfo(layer).label : 'not set'
}

/**
 * Whether a value of this setting may be written at this level. A context's team file is shared
 * with everyone the context matches, so a credential or a key declared personal goes to its me file.
 * The repo layer is committed for the team, so it never holds a credential either.
 */
export function canHold(setting: Setting, layer: string): boolean {
  if (layer === 'repo' && setting.credential) return false
  return !(teamContext(layer) && (setting.credential || setting.personal))
}

/** One level of one setting: what it sets, and whether that is the value in effect. */
export type LevelRow = { layer: string; label: string; hint: string; value: Json | undefined; isWinner: boolean }

/** A setting across the levels this checkout has, top first, the one in effect marked. */
export function levelStack(setting: Setting, layers: readonly string[]): LevelRow[] {
  return [...layers].reverse().map(layer => {
    const { label, hint } = levelInfo(layer)
    return { layer, label, hint, value: setting.levels[layer], isWinner: setting.source === layer }
  })
}

/** Why a level cannot hold this key: the repo's file is committed, a context's team file is shared. */
export function refusal(layer: string): string {
  return layer === 'repo' ? 'committed: not for a credential' : 'team file: not for a credential or personal key'
}

/** One step of a setting's path, top first: what the level sets, and what that does to the value in effect. */
export type ChainRow = LevelRow & { canHold: boolean; state: 'wins' | 'overridden' | 'hidden' | 'blocks' | 'unset'; by?: string }

/**
 * A setting across the levels, top first, each step saying what became of its value: in effect,
 * overridden by a level above, hidden under a block, or blocking the levels under it.
 */
export function chainRows(setting: Setting, layers: readonly string[]): ChainRow[] {
  let block: string | undefined
  return levelStack(setting, layers).map(level => {
    const base = { ...level, canHold: canHold(setting, level.layer) }
    if (level.value === undefined) return { ...base, state: 'unset' as const }
    if (level.value === null) {
      const row = block ? { ...base, state: 'hidden' as const, by: block } : { ...base, state: 'blocks' as const }
      block ??= level.label
      return row
    }
    if (level.isWinner) return { ...base, state: 'wins' as const }
    if (block) return { ...base, state: 'hidden' as const, by: block }
    return { ...base, state: 'overridden' as const, by: levelLabel(setting.source) }
  })
}

/** What a step's value came to, for its line: `wins`, `overridden by Everywhere`. Empty where nothing is set. */
export function chainState(row: ChainRow): string {
  if (row.state === 'wins') return 'wins'
  if (row.state === 'overridden') return `overridden by ${row.by}`
  if (row.state === 'hidden') return `hidden by the block at ${row.by}`
  if (row.state === 'blocks') return 'hides the levels under it'
  return ''
}

/**
 * The value in effect and every value it overrides, top first: `acme · Repo, just me ← beta
 * (Everywhere) ← gamma (default)`. A block ends the path; the default shows when it differs.
 */
export function pathLine(setting: Setting, layers: readonly string[], names: Names, defs: Defs): string {
  const show = (value: Json) => display(setting, value, names, defs)
  if (setting.value === null) return ''
  const steps = [`${show(setting.value)} · ${levelLabel(setting.source)}`]
  if (!setting.source || setting.source === 'default') return steps[0]!
  let isBlocked = false
  for (const layer of layers.slice(0, layers.indexOf(setting.source)).reverse()) {
    const value = setting.levels[layer]
    if (value === undefined) continue
    if (value === null) {
      isBlocked = true
      break
    }
    steps.push(`${show(value)} (${levelLabel(layer)})`)
  }
  if (!isBlocked && setting.default !== null && show(setting.default) !== show(setting.value)) steps.push(`${show(setting.default)} (default)`)
  return steps.join(' ← ')
}

/** What shows through under a level: the next level down that sets the key, else the default. */
export function under(setting: Setting, layer: string, layers: readonly string[]): { label: string; value: Json } | undefined {
  const below = layers.slice(0, layers.indexOf(layer)).reverse()
  for (const one of below) {
    const value = setting.levels[one]
    if (value === undefined) continue
    // A block down there hides everything under it, the default excepted.
    if (value === null) break
    return { label: levelLabel(one), value }
  }
  return setting.default === null ? undefined : { label: 'the default', value: setting.default }
}

/** The level above this one that sets the key, so what is saved here does not show. */
export function over(setting: Setting, layer: string, layers: readonly string[]): string | undefined {
  const top = layers
    .slice(layers.indexOf(layer) + 1)
    .reverse()
    .find(one => setting.levels[one] !== undefined)
  return top && levelLabel(top)
}

/**
 * What a value at this level does, in one sentence: who it reaches and what it overrides. Empty
 * when it would only repeat the level: the value in effect here, over nothing different.
 */
export function effect(setting: Setting, layer: string, layers: readonly string[], names: Names, defs: Defs): string {
  const show = (value: Json) => display(setting, value, names, defs)
  const here = setting.levels[layer]
  // Each sentence ends on the audience; one left empty would read `sets it .`.
  const audience = levelInfo(layer).audience || 'here'
  const above = over(setting, layer, layers)
  if (here === null) return `Blocks the levels under it ${audience}.`
  if (above) {
    return here === undefined
      ? `${above} overrides this level, so a value saved here does not apply.`
      : `Holds ${show(here)}, but ${above} overrides it.`
  }
  const below = under(setting, layer, layers)
  if (here === undefined) {
    return below ? `Saving here overrides ${below.label} (${show(below.value)}) ${audience}.` : `Saving here sets it ${audience}.`
  }
  // Over a lower value only when it differs: "on, over on from the default" says nothing.
  const differs = below && show(below.value) !== show(here)
  return differs ? `Holds ${show(here)}, in effect ${audience}, over ${show(below.value)} from ${below.label}.` : ''
}
