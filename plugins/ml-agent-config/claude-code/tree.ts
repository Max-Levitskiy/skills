// A value with a schema, edited a part at a time: an object's fields, a map's named entries, a
// list's items. The edit keeps the whole value as a draft, and the text typed into each field
// apart, read into the draft only on Save, so a half-typed number is never lost or saved.

import type { Json, Setting } from '../types'
import { check, childSchema, enumOf, has, kindOf, merge, resolveRef, same, type Defs, type Kind, type ValueSchema } from '../src/key-schema'
import { choiceLabels, editText, parseText, showValue, type Names } from './values'

/** Where a part sits in the value: property, entry name or item index, outermost first. */
export type At = string[]

/** A part's key in the edit's typed texts and in element keys. */
export function pointer(at: At): string {
  return JSON.stringify(at)
}

export function schemaAt(root: ValueSchema | null, defs: Defs, at: At): ValueSchema | null {
  let schema = root
  for (const part of at) schema = childSchema(schema, defs, part)
  return schema
}

export function kindAt(root: ValueSchema | null, defs: Defs, at: At): Kind {
  return kindOf(schemaAt(root, defs, at), defs)
}

/** One part's schema, walked to once: as declared, with its `$ref` followed, and how it is drawn. */
export function nodeAt(root: ValueSchema | null, defs: Defs, at: At): { schema: ValueSchema | null; resolved: ValueSchema; kind: Kind } {
  const schema = schemaAt(root, defs, at)
  return { schema, resolved: schema ? resolveRef(schema, defs) : {}, kind: kindOf(schema, defs) }
}

/** A kind drawn as fields on a screen of its own rather than typed. */
export function isStructuredKind(kind: Kind): boolean {
  return kind === 'fields' || kind === 'map' || kind === 'entries'
}

/** A key holding an object or a list of objects, drawn as fields rather than typed as JSON. */
export function isStructured(schema: ValueSchema | null, defs: Defs): boolean {
  return isStructuredKind(kindOf(schema, defs))
}

/** A setting edited a part at a time. A credential never is: it is a source and its fields. */
export function isTreeSetting(setting: Setting, defs: Defs): boolean {
  return !setting.credential && isStructured(setting.schema, defs)
}

export const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)

/** A map that already holds an entry of this name; a null there only removes one beneath. */
export function nameTaken(holder: Json | undefined, name: string): boolean {
  return isObject(holder) && holder[name] !== undefined && holder[name] !== null
}

/** An object that takes named entries: a map, or an object of fields whose schema allows more. */
export function takesEntries(node: { resolved: ValueSchema; kind: Kind }): boolean {
  // Unsaid, an object takes more members, as JSON Schema reads it; only false closes it.
  return node.kind === 'map' || (node.kind === 'fields' && node.resolved.additionalProperties !== false)
}

/** What a part is to its holder: an item of a list, a declared field, or a named entry. */
export function roleOf(root: ValueSchema | null, defs: Defs, at: At): 'item' | 'field' | 'entry' {
  const holder = nodeAt(root, defs, at.slice(0, -1))
  if (holder.kind === 'entries') return 'item'
  return has(holder.resolved.properties ?? {}, at.at(-1)!) ? 'field' : 'entry'
}

/** The element keys of a part, and of a map's or list's Add. */
export const atKey = (at: At) => `at:${at.join('.')}`
export const addKey = (at: At) => `add:${at.join('.')}`

/**
 * An on/off or enum part's choices, and the one in effect: its value, else its default, else the
 * first. Labels are as typed (`on`, `off`, the value as text), so a button's key and its focus agree.
 */
export function choicesAt(
  node: { resolved: ValueSchema; kind: Kind },
  value: Json | undefined,
  defs: Defs,
): { options: Json[]; labels: string[]; picked: number; focus: string; fallback: string | null } {
  const options: Json[] = node.kind === 'boolean' ? [true, false] : enumOf(node.resolved, defs)
  const labels = choiceLabels(options)
  // Only a value the draft holds is shown picked; an unset one says what applies instead.
  const picked = value === undefined ? -1 : options.findIndex(option => same(option, value))
  const fallback = node.resolved.default === undefined ? null : editText(node.resolved.default)
  const defaultAt = node.resolved.default === undefined ? -1 : options.findIndex(option => same(option, node.resolved.default!))
  const focus = labels[picked >= 0 ? picked : defaultAt >= 0 ? defaultAt : 0] ?? ''
  return { options, labels, picked, focus, fallback }
}

export function getAt(value: Json | undefined, at: At): Json | undefined {
  let cursor = value
  for (const part of at) {
    if (Array.isArray(cursor)) cursor = cursor[Number(part)]
    else if (isObject(cursor)) cursor = cursor[part]
    else return undefined
  }
  return cursor
}

/** The value with one part set, or removed with undefined; the parts on the way are copied, never changed. */
export function setAt(value: Json | undefined, at: At, part: Json | undefined): Json | undefined {
  if (at.length === 0) return part
  const [head, ...rest] = at as [string, ...string[]]
  if (Array.isArray(value)) {
    const copy = [...value]
    const child = setAt(copy[Number(head)], rest, part)
    if (child === undefined) copy.splice(Number(head), 1)
    else copy[Number(head)] = child
    return copy
  }
  const copy = isObject(value) ? { ...value } : {}
  const child = setAt(copy[head], rest, part)
  if (child === undefined) delete copy[head]
  else copy[head] = child
  return copy
}

/** A map entry under another name, in the same place among the others. */
export function renameAt(value: Json | undefined, at: At, name: string): Json | undefined {
  const parent = getAt(value, at.slice(0, -1))
  if (!isObject(parent)) return value
  const old = at.at(-1)!
  const renamed = Object.fromEntries(Object.entries(parent).map(([key, child]) => [key === old ? name : key, child]))
  return setAt(value, at.slice(0, -1), renamed)
}

/**
 * Typed texts with one part taken out: its own go, and when it is a list item, those of the items
 * after it move up one place, as the items do.
 */
export function withoutPart(texts: Record<string, string>, at: At, isItem: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  const parent = at.slice(0, -1)
  const index = Number(at.at(-1))
  for (const [key, text] of Object.entries(texts)) {
    const where = JSON.parse(key) as At
    if (at.every((part, place) => where[place] === part)) continue
    const isLater = isItem && where.length > parent.length && parent.every((part, place) => where[place] === part) && Number(where[parent.length]) > index
    out[isLater ? pointer([...parent, String(Number(where[parent.length]) - 1), ...where.slice(parent.length + 1)]) : key] = text
  }
  return out
}

/** The value the levels under one give a key, merged as the loader merges them. */
export function mergedBelow(levels: (Json | undefined)[]): Json | undefined {
  return levels.reduce<Json | undefined>((merged, level) => (level === undefined ? merged : merge(merged, level)), undefined)
}

/**
 * A draft as a level writes it over the levels under it. Objects merge, so a member the edit
 * started with, that a level below also gives, and that was taken out (removed or renamed) would
 * come back: it is written as null, which removes it in the merge. A member the edit never showed
 * is left to the levels below.
 */
export function withRemovals(draft: Json | undefined, start: Json | undefined, below: Json | undefined): Json | undefined {
  if (!isObject(draft) || !isObject(start) || !isObject(below)) return draft
  const out: { [key: string]: Json } = { ...draft }
  for (const key of Object.keys(start)) {
    if (below[key] === undefined || below[key] === null) continue
    out[key] = has(out, key) ? (withRemovals(out[key], start[key], below[key]) ?? null) : null
  }
  return out
}

/** Typed texts under a part, moved to another place or, with no place, dropped. */
export function moveTexts(texts: Record<string, string>, from: At, to: At | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, text] of Object.entries(texts)) {
    const at = JSON.parse(key) as At
    const isUnder = from.every((part, index) => at[index] === part)
    if (!isUnder) out[key] = text
    else if (to) out[pointer([...to, ...at.slice(from.length)])] = text
  }
  return out
}

/** Text typed for one part, read as what its schema says it holds, else as what it holds now. */
export function parseAs(text: string, schema: ValueSchema | null, like: Json, defs: Defs): { value?: Json; error?: string } {
  const kind = kindOf(schema, defs)
  const trimmed = text.trim()
  // An enum may name the empty text itself, so it is looked up before empty means removal.
  if (kind === 'enum') {
    const options = enumOf(schema, defs)
    const labels = choiceLabels(options)
    // A label may carry spaces of its own, so it is matched as typed before trimmed.
    const index = labels.includes(text) ? labels.indexOf(text) : labels.indexOf(trimmed)
    if (index >= 0) return { value: options[index]! }
    return trimmed === '' ? {} : { error: `pick one of ${labels.join(', ')}` }
  }
  if (trimmed === '') return {}
  if (kind === 'number' || kind === 'integer') {
    const parsed = parseText(text, 0)
    const isFraction = kind === 'integer' && typeof parsed.value === 'number' && !Number.isInteger(parsed.value)
    return isFraction ? { error: `${trimmed} is not a whole number` } : parsed
  }
  if (kind === 'string') return { value: text }
  if (kind === 'list') {
    // Text items, or JSON: as any list of text is typed.
    if (trimmed.startsWith('[') || kindOf(schemaAt(schema, defs, ['0']), defs) === 'string') return parseText(text, [])
    const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean)
    const numbers = parts.map(Number)
    const bad = parts.find((_, index) => !Number.isFinite(numbers[index]))
    return bad === undefined ? { value: numbers } : { error: `${bad} is not a number` }
  }
  // Nothing narrower to read it by: JSON when it is JSON, else the text, whatever it held before.
  if (kind === 'json') {
    try {
      return { value: JSON.parse(trimmed) as Json }
    } catch {
      return { value: text }
    }
  }
  return parseText(text, kind === 'boolean' ? false : like)
}

/**
 * The draft with every typed text read in, and checked against the key's schema as a layer is: what
 * the CLI would refuse is said here, at the field, before anything is written.
 */
export function fold(
  value: Json | undefined,
  texts: Record<string, string>,
  root: ValueSchema | null,
  defs: Defs,
  path: string,
): { value?: Json; error?: string } {
  let out = value
  for (const [key, text] of Object.entries(texts)) {
    const at = JSON.parse(key) as At
    // Removing or renaming a part moves or drops its texts, so each text left here has a place; one
    // under a declared field not set yet creates that field.
    const parsed = parseAs(text, schemaAt(root, defs, at), getAt(out, at) ?? '', defs)
    if (parsed.error) return { error: `${[path, ...at].join('.')}: ${parsed.error}` }
    out = setAt(out, at, parsed.value)
  }
  if (out === undefined) return {}
  const problems = root ? check(out, root, defs, path, true) : []
  return problems.length > 0 ? { error: problems.join('; ') } : { value: out }
}

/** A part as one short line: a map by its names, a list of entries by its count. */
export function summary(value: Json | undefined, schema: ValueSchema | null, defs: Defs): string {
  if (value === undefined || value === null) return 'not set'
  const kind = kindOf(schema, defs)
  if (kind === 'map' && isObject(value)) {
    const names = Object.keys(value).filter(name => value[name] !== null)
    return names.length === 0 ? 'none' : names.join(', ')
  }
  if (kind === 'entries' && Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`
  if (Array.isArray(value) && value.length === 0) return 'none'
  const line = showValue(value)
  return line.length > 72 ? `${line.slice(0, 71)}…` : line
}

/** A value of a setting as one line: a structured key by `summary`, any other as `showValue`. */
export function display(setting: Setting, value: Json, names: Names, defs: Defs): string {
  return isTreeSetting(setting, defs) ? summary(value, setting.schema, defs) : showValue(value, names, setting.credential)
}

/** What a list item is called: its label or name, else its place. */
export function itemName(value: Json | undefined, index: number): string {
  if (isObject(value)) {
    const named = [value.label, value.name, value.title].find(one => typeof one === 'string' && one !== '')
    if (typeof named === 'string') return named
  }
  return `#${index + 1}`
}
