// The four config layers as a person reads them. The CLI's global, repo, user-repo and local, merged
// in that order: a higher level overrides a lower one key by key, and the default sits under all.

import type { Json, Setting } from '../../types'
import { showValue } from '../values'

/** Each level's name, its chip, a hint, who a value there reaches, and how an override there is offered. */
export const LEVELS: Record<string, { label: string; short: string; hint: string; audience: string; offer: string }> = {
  global: { label: 'Everywhere', short: 'Everywhere', hint: '~/.agents, every project', audience: 'in every project, for you', offer: 'Everywhere, in all my projects' },
  repo: { label: 'Project, shared', short: 'Project', hint: 'committed, the whole team', audience: 'for the whole team in this repo', offer: 'For the team in this repo' },
  'user-repo': { label: 'Project, just me', short: 'Me', hint: '~/.agents, this repo, only you', audience: 'for you in this repo', offer: 'Just for me in this repo' },
  local: { label: 'This checkout', short: 'Checkout', hint: 'gitignored, this folder only', audience: 'in this checkout only', offer: 'In this checkout only' },
}

export const ORDER = ['global', 'repo', 'user-repo', 'local']

export function levelLabel(layer: string | null): string {
  if (layer === 'default') return 'default'
  return layer ? (LEVELS[layer]?.label ?? layer) : 'not set'
}

/** One level of one setting: what it sets, and whether that is the value in effect. */
export type LevelRow = { layer: string; label: string; hint: string; value: Json | undefined; isWinner: boolean }

/** A setting across the levels this checkout has, top first, the one in effect marked. */
export function levelStack(setting: Setting, layers: readonly string[]): LevelRow[] {
  return ORDER.filter(layer => layers.includes(layer))
    .reverse()
    .map(layer => ({
      layer,
      label: LEVELS[layer]!.label,
      hint: LEVELS[layer]!.hint,
      value: setting.levels[layer],
      isWinner: setting.source === layer,
    }))
}

/** What shows through under a level: the next level down that sets the key, else the default. */
export function under(setting: Setting, layer: string, layers: readonly string[]): { label: string; value: Json } | undefined {
  const below = ORDER.slice(0, ORDER.indexOf(layer)).filter(one => layers.includes(one)).reverse()
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
  const above = ORDER.slice(ORDER.indexOf(layer) + 1).filter(one => layers.includes(one))
  const top = above.reverse().find(one => setting.levels[one] !== undefined)
  return top && levelLabel(top)
}

/** What a value at this level does, in one sentence: who it reaches and what it overrides. */
export function effect(setting: Setting, layer: string, layers: readonly string[]): string {
  const here = setting.levels[layer]
  const audience = LEVELS[layer]?.audience ?? ''
  const above = over(setting, layer, layers)
  if (here === null) return `Blocks the levels under it ${audience}.`
  if (above) {
    return here === undefined
      ? `${above} overrides this level, so a value saved here does not apply.`
      : `Holds ${showValue(here)}, but ${above} overrides it.`
  }
  const below = under(setting, layer, layers)
  if (here === undefined) {
    return below ? `Saving here overrides ${below.label} (${showValue(below.value)}) ${audience}.` : `Saving here sets it ${audience}.`
  }
  return `Holds ${showValue(here)}, in effect ${audience}${below ? `, over ${showValue(below.value)} from ${below.label}` : ''}.`
}

/** The levels above the one in effect that set nothing yet: where an override can be added. */
export function openAbove(setting: Setting, layers: readonly string[]): string[] {
  const from = setting.source && setting.source !== 'default' ? ORDER.indexOf(setting.source) : -1
  return ORDER.filter((layer, index) => index > from && layers.includes(layer) && setting.levels[layer] === undefined)
}
