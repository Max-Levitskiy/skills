// Values as a person reads and types them: no quotes or braces, and a credential as where the
// secret lives.

import type { Json, Setting } from '../types'

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

export type Stored = { source: string; [field: string]: Json }

export function isReference(value: Json | undefined): value is Stored {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.source === 'string'
}

/** 1Password ids to the vault and item names last listed, kept across sessions: display only. */
export type Names = Record<string, string>

/** op://6egel…/rz6w…/username as op://Private/GitHub Actions/username, where the names are known. */
export function namedReference(reference: string, names: Names): string {
  const parts = reference.split('/')
  if (parts[0] !== 'op:' || parts.length < 5) return reference
  return parts.map((part, index) => (index === 2 || index === 3 ? (names[part] ?? part) : part)).join('/')
}

export function showValue(value: Json, names: Names = {}): string {
  if (value === null) return 'not set'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(one => showValue(one, names)).join(', ')
  if (isReference(value)) {
    const kind = SOURCES[value.source]
    const where = (kind?.fields ?? []).map(field => value[field.name]).filter((part): part is string => typeof part === 'string' && part !== '')
    const shown = value.source === '1password' ? where.map(part => namedReference(part, names)) : where
    return `${kind?.label ?? value.source}: ${shown.join(' / ')}`
  }
  return Object.entries(value)
    .map(([key, child]) => `${key}: ${showValue(child, names)}`)
    .join(', ')
}

/**
 * A list of text that `a, b, c` reads back unchanged: no item blank, padded or holding a comma, and
 * not starting with `[`. Any other list is typed as JSON, so it survives a save; an empty one is
 * `[]`, since empty text removes the key.
 */
function isTextList(value: Json): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(one => typeof one === 'string' && one !== '' && one === one.trim() && !one.includes(',')) &&
    !(value[0] as string).startsWith('[')
  )
}

// The edit field's starting text, in the form parseText reads back.
export function editText(value: Json): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (isTextList(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// The text typed for a plain key, read as the type of its current value or default: a number, on
// or off, a comma-separated list, or text. Empty removes the key from the level.
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
  // A list of text may be typed as `a, b` or, starting with `[`, as JSON; any other list as JSON.
  const isTextKind = Array.isArray(like) && like.every(one => typeof one === 'string')
  if (isTextKind && !trimmed.startsWith('[')) return { value: trimmed.split(',').map(part => part.trim()).filter(Boolean) }
  if (like !== null && typeof like === 'object') {
    const kind = Array.isArray(like) ? 'a list' : 'an object'
    let parsed: Json
    try {
      parsed = JSON.parse(trimmed) as Json
    } catch {
      return { error: `this key holds ${kind}: type it as JSON` }
    }
    // Still the same kind: null would block the levels under it, which Block inherited is for.
    const isSameKind = Array.isArray(like) ? Array.isArray(parsed) : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    return isSameKind ? { value: parsed } : { error: `this key holds ${kind}: type ${Array.isArray(like) ? '[…]' : '{…}'}` }
  }
  // Text is kept as typed: its spaces may mean something.
  return { value: text }
}

/** What an edit at this level starts from, and is typed as: its own value, else the one in effect. */
export function valueAt(setting: Setting, layer: string): Json {
  const here = setting.levels[layer]
  return here !== undefined && here !== null ? here : (setting.value ?? setting.default)
}

/** An on/off key at this level, or, with no level, as it is in effect. */
export function isBoolean(setting: Setting, layer?: string): boolean {
  return typeof (layer ? valueAt(setting, layer) : (setting.value ?? setting.default)) === 'boolean'
}

// Where an edit lands unless the person picks another level: where the value is set now, else
// where the declaration recommends, else global.
export function targetLayer(setting: Setting, layers: readonly string[]): string {
  const wanted = [setting.source, setting.layer, 'global'].find(one => one && layers.includes(one))
  return wanted ?? layers[0] ?? 'global'
}

/** A dotted key's last part, for a breadcrumb: credentials.apiKey is apiKey. */
export function lastPart(path: string): string {
  return path.split('.').at(-1) ?? path
}
