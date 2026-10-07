// The four config layers as a person reads them. The CLI's global, repo, user-repo and local, merged
// in that order: a higher level overrides a lower one key by key, and the default sits under all.

import type { Json, Setting } from '../../types'

export const LEVELS: Record<string, { label: string; short: string; hint: string }> = {
  global: { label: 'Everywhere', short: 'Everywhere', hint: '~/.agents, every project' },
  repo: { label: 'Project, shared', short: 'Project', hint: 'committed, the whole team' },
  'user-repo': { label: 'Project, just me', short: 'Me', hint: '~/.agents, this repo, only you' },
  local: { label: 'This checkout', short: 'Checkout', hint: 'gitignored, this folder only' },
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
