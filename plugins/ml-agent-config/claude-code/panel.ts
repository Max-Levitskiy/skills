// The pane's state, read: which screen is on top, which component and setting it is about, where an
// edit starts, and `describe` turned into settings. Nothing here calls the engine; the presses that
// do are in register.tsx, since the engine follows `$` only within the file that declares it.

import type { Component, Edit, Json, Level, Panel, Screen, Setting, ValueSchema } from '../types'
import { isObject } from './shapes'
import { addKey, atKey, choicesAt, getAt, isStructuredKind, isTreeSetting, nodeAt, takesEntries, type At } from './tree'
import { ORDER, levelLabel } from './ui/levels'
import { SOURCES, choiceLabels, editText, isReference, rootChoices, valueAt, type Stored } from './values'
import { enumOf, kindOf, same } from '../src/key-schema'

export const PANE = 'agent-config'

export function top(now: Panel): Screen {
  return now.stack.at(-1) ?? { kind: 'components' }
}

export function selected(now: Panel): Component | undefined {
  return now.components.find(one => one.name === now.selected)
}

export function editing(now: Panel): Setting | undefined {
  return now.settings.find(one => one.path === now.edit?.path)
}

export function layerNames(now: Panel): string[] {
  return now.layers.map(one => one.layer)
}

/** The file a level is kept in, as the screens show it. */
export function fileOf(now: Panel, layer: string): string {
  const file = now.layers.find(one => one.layer === layer)
  return file ? `${file.path}${file.exists ? '' : ' (new file)'}` : ''
}

/** `describe` as the screens read it: paths shortened to ~ and to the repository's root. */
export function readDescribe(stdout: string, home: string | undefined, name: string): Pick<Panel, 'settings' | 'layers' | 'defs'> {
  const answer: unknown = JSON.parse(stdout)
  // An answer in another shape is no answer: the pane says describe failed, and stays usable.
  if (!isObject(answer) || !Array.isArray(answer.keys) || !Array.isArray(answer.layers)) throw new Error('it answered in another shape')
  // Another component's keys, saved under this one, would write its values here.
  if (answer.name !== name) throw new Error(`it answered for ${String(answer.name)}, not ${name}`)
  const out = {
    keys: answer.keys.filter(
      (one): one is Omit<Setting, 'levels'> & { levels?: Setting['levels'] } =>
        isObject(one) && typeof one.path === 'string' && (one.levels === undefined || isObject(one.levels)),
    ),
    // Only the four layers the pane knows: another name has no label, no order and no file to write.
    layers: answer.layers.filter(
      (one): one is { layer: string; path: string | null; exists?: boolean } =>
        isObject(one) && ORDER.includes(one.layer as string) && (one.path === null || typeof one.path === 'string'),
    ),
    repo: isObject(answer.repo) ? (answer.repo as { checkout: string | null }) : undefined,
    // A CLI before schemas sends none: every key is then typed by its value, as it was.
    defs: isObject(answer.defs) ? (answer.defs as Panel['defs']) : {},
  }
  const checkout = out.repo?.checkout
  const short = (path: string) =>
    checkout && path.startsWith(`${checkout}/`)
      ? path.slice(checkout.length + 1)
      : home && path.startsWith(`${home}/`)
        ? `~${path.slice(home.length)}`
        : path
  return {
    // Each field as the screens read it, whatever an out-of-sync CLI left out.
    settings: out.keys.map(({ path, description, layer, default: fallback, value, source, credential, required, levels, schema }) => ({
      path,
      description: typeof description === 'string' ? description : '',
      layer: typeof layer === 'string' ? layer : null,
      default: fallback ?? null,
      value: value ?? null,
      source: typeof source === 'string' ? source : null,
      credential: credential === true,
      required: required === true,
      schema: isObject(schema) ? (schema as ValueSchema) : null,
      levels: Object.fromEntries(Object.entries(levels ?? {}).filter(([layer]) => ORDER.includes(layer))),
    })),
    defs: out.defs,
    layers: out.layers.filter(one => one.path).map(one => ({ layer: one.layer, path: short(one.path!), exists: one.exists ?? false }) satisfies Level),
  }
}

/** The settings screen's first row, where the focus starts. */
export function firstSetting(settings: readonly Setting[]): string {
  const first = settings[0]
  return first ? `setting:${first.path}` : 'files'
}

/**
 * A credential as an edit at this level sees it. The loader merges a reference key by key, so a
 * level may hold only the fields it overrides: the levels up to this one are merged, and the
 * reference in effect stands in when they hold none.
 */
export function referenceAt(setting: Setting, layer: string): Stored | undefined {
  let merged: Json | undefined
  for (const one of ORDER.slice(0, ORDER.indexOf(layer) + 1)) {
    const here = setting.levels[one]
    if (here === undefined) continue
    const isObject = (value: Json | undefined) => value !== null && typeof value === 'object' && !Array.isArray(value)
    merged = isObject(here) ? { ...(isObject(merged) ? (merged as Record<string, Json>) : {}), ...(here as Record<string, Json>) } : here
  }
  if (isReference(merged)) return merged
  return isReference(setting.value) ? setting.value : undefined
}

/**
 * The fields the levels under this one give a credential, merged key by key as the loader does, a
 * null dropping one. A reference saved here keeps any of them it does not set, unless it nulls them.
 */
export function inheritedFields(setting: Setting, layer: string): string[] {
  const fields = new Map<string, boolean>()
  for (const one of ORDER.slice(0, ORDER.indexOf(layer))) {
    const here = setting.levels[one]
    if (here === undefined) continue
    if (here === null || typeof here !== 'object' || Array.isArray(here)) {
      fields.clear()
      continue
    }
    for (const [field, value] of Object.entries(here)) fields.set(field, value !== null)
  }
  return [...fields].filter(([, isSet]) => isSet).map(([field]) => field)
}

/** A plain value as its edit field starts: an enum's value as its choice's label, else as typed. */
function textOf(setting: Setting, from: Json, defs: Panel['defs']): string {
  const options = setting.schema && kindOf(setting.schema, defs) === 'enum' ? enumOf(setting.schema, defs) : null
  const index = options ? options.findIndex(option => same(option, from)) : -1
  return options && index >= 0 ? choiceLabels(options)[index]! : editText(from)
}

/** An edit at one level starts from what that level sets, else from the value in effect. */
export function editAt(setting: Setting, layer: string, defs: Panel['defs']): Edit {
  const from = valueAt(setting, layer)
  // Only a credential holds a reference: a plain object with a `source` is a value like any other.
  const reference = setting.credential ? referenceAt(setting, layer) : undefined
  return {
    path: setting.path,
    layer,
    text: reference ? '' : textOf(setting, from, defs),
    source: reference && SOURCES[reference.source] ? reference.source : '1password',
    draft: Object.fromEntries(Object.entries(reference ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    isDirty: false,
    like: from,
    value: from,
    texts: {},
    names: {},
  }
}

/**
 * The edit pointed at another level. What was typed stays, so a value can be written wherever it
 * belongs; untouched, the edit shows what that level holds.
 */
export function switchLevel(edit: Edit, setting: Setting, layer: string, defs: Panel['defs']): Edit {
  return edit.isDirty ? { ...edit, layer } : editAt(setting, layer, defs)
}

/**
 * The parts a structured node lists: declared properties, then, in a map, whatever else it holds;
 * a list's items by index. A field the schema does not name stays in the value either way.
 */
export function parts(now: Panel, at: At): string[] {
  const setting = editing(now)!
  const value = getAt(now.edit?.value, at)
  const { resolved, kind } = nodeAt(setting.schema, now.defs, at)
  if (kind === 'entries') return (Array.isArray(value) ? value : []).map((_, index) => String(index))
  const declared = kind === 'fields' ? Object.keys(resolved.properties ?? {}) : []
  // Entries beyond the declared fields, where the schema allows them; a null only removes one beneath.
  const isOpen = kind === 'map' || (kind === 'fields' && resolved.additionalProperties !== false)
  const held = isOpen && isObject(value) ? Object.keys(value).filter(name => !declared.includes(name) && value[name] !== null) : []
  return [...declared, ...held]
}

/** Where the focus starts on a structured node: its first part, else its Add, else Save. */
export function firstKey(now: Panel, at: At, canType: boolean): string {
  const setting = editing(now)
  if (!setting) return 'save'
  for (const part of parts(now, at)) {
    const child = [...at, part]
    const node = nodeAt(setting.schema, now.defs, child)
    if (node.kind === 'boolean' || node.kind === 'enum') return `${atKey(child)}:${choicesAt(node, getAt(now.edit?.value, child), now.defs).currentLabel}`
    if (canType || isStructuredKind(node.kind)) return atKey(child)
  }
  const node = nodeAt(setting.schema, now.defs, at)
  return node.kind === 'entries' || (takesEntries(node) && canType) ? addKey(at) : 'save'
}

/** The edit screen's first element: a structured key's first part, the field to type in, or the first choice. */
export function firstEdit(now: Panel, canType: boolean): string | undefined {
  const setting = editing(now)
  const edit = now.edit
  if (!setting || !edit) return undefined
  if (isTreeSetting(setting, now.defs)) return firstKey(now, [], canType)
  const levels = now.layers.length
  const choices = setting.credential ? null : rootChoices(setting, now.defs, edit.like)
  if (choices) return `value:${choices.includes(edit.text) ? edit.text : choices[0]}`
  if (!canType) return levels > 1 ? 'level' : 'save'
  if (!setting.credential) return 'value'
  if (edit.source === '1password') return 'pick'
  return `field:${SOURCES[edit.source]!.fields[0]!.name}`
}

export function savedAt(path: string, layer: string, value: Json | undefined): string {
  if (value === undefined) return `Removed ${path} from ${levelLabel(layer)}.`
  if (value === null) return `Blocked ${path} in ${levelLabel(layer)}: the levels under it no longer apply.`
  return `Saved ${path} in ${levelLabel(layer)}.`
}
