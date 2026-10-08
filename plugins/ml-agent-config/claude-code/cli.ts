// The agent-config CLI's shapes and the pure part of a write. The calls themselves are in
// register.tsx, since the engine follows `$` only within the file that declares it.

import type { Json } from '../types'

export type Reference = { source: string; ref?: string }

export type Plan = {
  name: string
  ready: boolean
  config: { credentials?: Record<string, Reference> }
  actions: { id: string; type: string; keys: string[] }[]
  problems: { code: string; message: string }[]
}

// The CLI picks its harness from CLAUDECODE, which Claude Code sets for the model's shell and not
// for a hooks module's children; without it a machine with ~/.codex is read as Codex.
export const HARNESS = { CLAUDECODE: '1' }

// The namespace of this module's own setting. Its declaration sits beside register.tsx, outside
// every plugin registry, so each call names the folder with --from.
export const OWN = 'agent-config'

export function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

/**
 * One layer's file with one key changed, since `write` replaces the whole layer. No value removes
 * the key, so a lower level or the default shows through again; null blocks the lower levels.
 */
/** The first parent of a dotted key that this layer blocks with null, which blocks the key too. */
export function blockedParent(config: Record<string, unknown>, dotPath: string): string | undefined {
  const segments = dotPath.split('.')
  let cursor: unknown = config
  for (const [index, segment] of segments.slice(0, -1).entries()) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
    if (cursor === null) return segments.slice(0, index + 1).join('.')
  }
  return undefined
}

export function withValue(config: Record<string, unknown>, dotPath: string, value: Json | undefined): Record<string, unknown> {
  const segments = dotPath.split('.')
  let cursor = config
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      if (value === undefined) return config
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, unknown>
  }
  if (value === undefined) delete cursor[segments.at(-1)!]
  else cursor[segments.at(-1)!] = value
  return config
}
