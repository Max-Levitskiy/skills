// The pane's state, read: which screen is on top, which component and setting it is about, where an
// edit starts, and `describe` turned into settings. Nothing here calls the engine; the presses that
// do are in register.tsx, since the engine follows `$` only within the file that declares it.

import type { Component, ContextEntry, Edit, Here, Json, Level, NewContext, Panel, Screen, Setting, ValueSchema } from '../types'
import { isObject } from './shapes'
import { addKey, atKey, choicesAt, display, getAt, isStructuredKind, isTreeSetting, nodeAt, takesEntries, type At } from './tree'
import { levelLabel, over, under } from './ui/levels'
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
export function readDescribe(stdout: string, home: string | undefined, name: string): Pick<Panel, 'settings' | 'layers' | 'contexts' | 'defs' | 'here'> {
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
    // In describe's order, which is the merge order: global, any context's levels, then the repo's.
    layers: answer.layers.filter(
      (one): one is { layer: string; path: string | null; exists?: boolean } =>
        isObject(one) && typeof one.layer === 'string' && (one.path === null || typeof one.path === 'string'),
    ),
    repo: isObject(answer.repo) ? (answer.repo as { checkout: string | null; root?: string | null }) : undefined,
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
  const known = out.layers.map(one => one.layer)
  return {
    // Each field as the screens read it, whatever an out-of-sync CLI left out.
    settings: out.keys.map(({ path, description, layer, default: fallback, value, source, credential, personal, required, levels, schema, choices }) => ({
      path,
      description: typeof description === 'string' ? description : '',
      layer: typeof layer === 'string' ? layer : null,
      default: fallback ?? null,
      value: value ?? null,
      source: typeof source === 'string' ? source : null,
      credential: credential === true,
      personal: personal === true,
      required: required === true,
      schema: isObject(schema) ? (schema as ValueSchema) : null,
      choices: isObject(choices) ? { search: choices.search === 'server' ? ('server' as const) : ('local' as const) } : null,
      levels: Object.fromEntries(Object.entries(levels ?? {}).filter(([layer]) => known.includes(layer))),
    })),
    defs: out.defs,
    layers: out.layers.filter(one => one.path).map(one => ({ layer: one.layer, path: short(one.path!), exists: one.exists ?? false }) satisfies Level),
    contexts: readContexts(answer.contexts),
    here: readHere(answer.place, out.repo?.root ?? null, home ?? null),
  }
}

/** Where `context explain` ran, read as describe's place is: for a new context opened outside a component. */
export function readExplainHere(stdout: string, home: string | null): Here | null {
  const answer: unknown = JSON.parse(stdout)
  if (!isObject(answer)) return null
  const root = isObject(answer.repo) && typeof answer.repo.root === 'string' ? answer.repo.root : null
  return readHere(answer.place, root, home)
}

/** Where describe ran; a CLI before it said so sends no place. */
function readHere(place: unknown, root: string | null, home: string | null): Here | null {
  if (!isObject(place) || typeof place.cwd !== 'string' || !Array.isArray(place.remotes)) return null
  const remotes = place.remotes.filter((one): one is string => typeof one === 'string')
  return { cwd: place.cwd, root: typeof root === 'string' ? root : null, remotes, home }
}

/**
 * A new context as first offered: named for the folder that holds this repo (or for this folder,
 * outside one), matching every folder under it, and every repo beside this one on its remote.
 */
export function suggestContext(here: Here): NewContext {
  const dir = (here.root ? here.root.replace(/\/[^/]+\/?$/, '') : here.cwd.replace(/\/$/, '')) || '/'
  const shown = here.home && (dir === here.home || dir.startsWith(`${here.home}/`)) ? `~${dir.slice(here.home.length)}` : dir
  const folder = dir.split('/').filter(Boolean).at(-1) ?? ''
  // A context name holds no `:`, `/` or `\`, and does not start with a dot.
  const name = folder.replace(/[:\\]/g, '-').replace(/^\.+/, '')
  const owner = here.remotes[0]?.split('/').slice(0, -1) ?? []
  return { name, parent: null, paths: [shown.endsWith('/') ? shown : `${shown}/`], remotes: owner.length >= 2 ? [`${owner.join('/')}/**`] : [] }
}

/** `context list` as the screens read it: each context's filters as globs, a `/i` one marked. */
export function readContextList(stdout: string): ContextEntry[] {
  const answer: unknown = JSON.parse(stdout)
  if (!isObject(answer) || !Array.isArray(answer.contexts)) throw new Error('it answered in another shape')
  const globs = (entries: unknown, kind: 'remote' | 'path') =>
    (Array.isArray(entries) ? entries : []).filter(isObject).flatMap(entry => (typeof entry[kind] === 'string' ? [entry[kind] as string] : []))
  return answer.contexts.filter(isObject).flatMap(one =>
    typeof one.name === 'string'
      ? [
          {
            name: one.name,
            parent: typeof one.parent === 'string' ? one.parent : null,
            remotes: globs(one.team, 'remote'),
            paths: globs(one.me, 'path'),
            matched: one.matched === true,
            components: Array.isArray(one.components) ? one.components.filter((name): name is string => typeof name === 'string') : [],
          },
        ]
      : [],
  )
}

const VIAS: readonly string[] = ['remote', 'path', 'parent', 'explicit']

/** The contexts describe says apply here, outermost first; a CLI before contexts sends none. */
function readContexts(contexts: unknown): Panel['contexts'] {
  if (!Array.isArray(contexts)) return []
  return contexts
    .filter((one): one is Panel['contexts'][number] => isObject(one) && typeof one.name === 'string' && typeof one.via === 'string' && VIAS.includes(one.via))
    .map(({ name, via }) => ({ name, via }))
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
export function referenceAt(setting: Setting, layer: string, layers: readonly string[]): Stored | undefined {
  let merged: Json | undefined
  for (const one of layers.slice(0, layers.indexOf(layer) + 1)) {
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
export function inheritedFields(setting: Setting, layer: string, layers: readonly string[]): string[] {
  const fields = new Map<string, boolean>()
  for (const one of layers.slice(0, layers.indexOf(layer))) {
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
  // A value the enum does not name reads as its JSON, so no choice shows picked and an untouched
  // save is refused rather than turned into the choice it reads like.
  if (options && index < 0 && from !== null) return JSON.stringify(from)
  return options && index >= 0 ? choiceLabels(options)[index]! : editText(from)
}

/** An edit at one level starts from what that level sets, else from the value in effect. */
export function editAt(setting: Setting, layer: string, layers: readonly string[], defs: Panel['defs']): Edit {
  const from = valueAt(setting, layer)
  // Only a credential holds a reference: a plain object with a `source` is a value like any other.
  const reference = setting.credential ? referenceAt(setting, layer, layers) : undefined
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
export function switchLevel(edit: Edit, setting: Setting, layer: string, layers: readonly string[], defs: Panel['defs']): Edit {
  return edit.isDirty ? { ...edit, layer } : editAt(setting, layer, layers, defs)
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
    if (node.kind === 'boolean' || node.kind === 'enum') return `${atKey(child)}:${choicesAt(node, getAt(now.edit?.value, child), now.defs).focus}`
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
  const choices = setting.credential ? null : rootChoices(setting, now.defs, edit.like)
  if (choices) return `value:${choices.includes(edit.text) ? edit.text : choices[0]}`
  if (!canType) return 'save'
  if (!setting.credential) return 'value'
  if (edit.source === '1password') return 'pick'
  return `field:${SOURCES[edit.source]!.fields[0]!.name}`
}

/**
 * What a save did, and what it does to the value in effect: overrides a lower value, sits under a
 * higher one, or, removed, lets the next one down show through. Read off the setting as it was
 * before the save; only the saved level changed.
 */
export function savedAt(setting: Setting, layer: string, value: Json | undefined, layers: readonly string[], names: Panel['names'], defs: Panel['defs']): string {
  const path = setting.path
  const where = levelLabel(layer)
  if (value === null) return `Blocked ${path} in ${where}: the levels under it no longer apply.`
  const show = (one: Json) => display(setting, one, names, defs)
  const above = over(setting, layer, layers)
  const below = under(setting, layer, layers)
  if (value === undefined) {
    if (above) return `Removed ${path} from ${where}. ${above} still sets it.`
    return below ? `Removed ${path} from ${where}: ${show(below.value)} from ${below.label} applies now.` : `Removed ${path} from ${where}.`
  }
  if (above) return `Saved ${path} in ${where}, but ${above} overrides it.`
  return below && show(below.value) !== show(value) ? `Saved ${path} in ${where}: it overrides ${show(below.value)} from ${below.label}.` : `Saved ${path} in ${where}.`
}
