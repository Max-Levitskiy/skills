// What the CLI answers, checked before the module reads it. A CLI of another version, or one an
// `AGENT_CONFIG_ROOT` override points at, can answer valid JSON in another shape; an answer that
// does not fit is treated as no answer, never read field by field until something throws.

import type { Item, OnePassword } from '../types'
import type { Plan } from './cli'

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const isText = (value: unknown): value is string => typeof value === 'string'

/** `start`: every field the module reads, down to each action and problem. */
export function isPlan(value: unknown): value is Plan {
  const isAction = (one: unknown) =>
    isObject(one) && isText(one.id) && isText(one.type) && Array.isArray(one.keys) && one.keys.every(isText)
  const isProblem = (one: unknown) => isObject(one) && isText(one.code) && isText(one.message)
  return (
    isObject(value) &&
    isText(value.name) &&
    typeof value.ready === 'boolean' &&
    isObject(value.config) &&
    Array.isArray(value.actions) &&
    value.actions.every(isAction) &&
    Array.isArray(value.problems) &&
    value.problems.every(isProblem)
  )
}

/** `list`: the components that name themselves and their plugin; anything else is left out. */
export function listedComponents(value: unknown): { name: string; plugin: string }[] {
  const listed = isObject(value) && Array.isArray(value.components) ? value.components : []
  return listed.filter((one): one is { name: string; plugin: string } => isObject(one) && isText(one.name) && isText(one.plugin))
}

/** `path`: for the component asked about, the entry for the layer asked for, never the first one. */
export function pathLayer(value: unknown, name: string, layer: string): { path: string | null; exists: boolean } | undefined {
  if (!isObject(value) || value.name !== name) return undefined
  const layers = Array.isArray(value.layers) ? value.layers : []
  const found = layers.find(one => isObject(one) && one.layer === layer)
  if (!isObject(found) || !(found.path === null || isText(found.path))) return undefined
  return { path: found.path, exists: found.exists === true }
}

/** `1password items`: accounts and items with the fields the picker shows. */
export function onePasswordListing(value: unknown): { accounts: OnePassword['accounts']; items: Item[]; problems: string[] } {
  if (!isObject(value)) throw new Error('1Password listing answered in another shape')
  const accounts = (Array.isArray(value.accounts) ? value.accounts : []).filter(
    (one): one is OnePassword['accounts'][number] => isObject(one) && isText(one.id) && isText(one.short),
  )
  const items = (Array.isArray(value.items) ? value.items : []).filter(
    (one): one is Item =>
      isObject(one) &&
      isText(one.id) &&
      isText(one.title) &&
      isText(one.category) &&
      isObject(one.vault) &&
      isText(one.vault.id) &&
      isText(one.vault.name) &&
      (one.account === null || isText(one.account)),
  )
  const problems = (Array.isArray(value.problems) ? value.problems : []).filter(isText)
  return { accounts: accounts.map(({ id, short }) => ({ id, short })), items, problems }
}

/** `1password fields`: the fields with a label and an op:// reference. */
export function onePasswordFields(value: unknown): OnePassword['fields'] {
  if (!isObject(value)) throw new Error('1Password fields answered in another shape')
  return (Array.isArray(value.fields) ? value.fields : []).filter(
    (one): one is OnePassword['fields'][number] =>
      isObject(one) && isText(one.label) && isText(one.reference) && isText(one.type) && (one.section === null || isText(one.section)),
  )
}
