// A structured key, a part at a time, drawn from its JSON Schema: an object's fields, a map's named
// entries, or a list's items. A field holding text, a number or a list of them is typed; on/off and
// a fixed set of values are picked; an object or a list of objects opens its own screen. Every part
// is changed in the edit's draft, and Save here writes the whole value at the edit's level.

import type { RenderElement, RenderNode } from 'claude-code'

import type { Json, Panel } from '../../types'
import { editing, selected, top } from '../panel'
import { type Defs, resolveRef, type ValueSchema } from '../../src/key-schema'
import { type At, getAt, itemName, kindAt, pointer, schemaAt, summary } from '../tree'
import { editText } from '../values'
import { note, row, screen } from '../ui/screen'
import type { Ctx } from './context'

/** An element's key: the part's place, dotted. */
export const atKey = (at: At) => `at:${at.join('.')}`

/** The draft's value as a node screen sees it: nothing yet reads as empty. */
function draftValue(now: Panel): Json | undefined {
  return now.edit?.value ?? undefined
}

/** A part's name as shown: the schema's title, else the property, entry name or item. */
function label(schema: ValueSchema | null, defs: Defs, part: string, value: Json | undefined, isItem: boolean): string {
  if (isItem) return itemName(value, Number(part))
  const title = schema ? resolveRef(schema, defs).title : undefined
  return title && !/^\d+$/.test(part) ? title : part
}

/** The part the parts of a node are listed in: declared properties, then whatever else it holds. */
function parts(now: Panel, at: At): { part: string; isItem: boolean }[] {
  const setting = editing(now)!
  const value = getAt(draftValue(now), at)
  const kind = kindAt(setting.schema, now.defs, at)
  if (kind === 'entries') return (Array.isArray(value) ? value : []).map((_, index) => ({ part: String(index), isItem: true }))
  const declared = kind === 'fields' ? Object.keys(resolveRef(schemaAt(setting.schema, now.defs, at)!, now.defs).properties ?? {}) : []
  const held = value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []
  // A field the schema does not name stays in the value, and is only shown in a map.
  return [...declared, ...(kind === 'map' ? held.filter(name => !declared.includes(name)) : [])].map(part => ({ part, isItem: false }))
}

/** Where the focus starts on a node: its first part, else its Add, else Save. */
export function firstKey(now: Panel, at: At, canType: boolean): string {
  const setting = editing(now)
  if (!setting) return 'save'
  for (const { part } of parts(now, at)) {
    const child = [...at, part]
    const kind = kindAt(setting.schema, now.defs, child)
    if (kind === 'boolean') return `${atKey(child)}:${getAt(draftValue(now), child) === true ? 'on' : 'off'}`
    if (kind === 'enum') {
      const options = resolveRef(schemaAt(setting.schema, now.defs, child)!, now.defs).enum ?? []
      const current = getAt(draftValue(now), child) ?? options[0] ?? null
      return `${atKey(child)}:${String(current)}`
    }
    if (canType || kind === 'fields' || kind === 'map' || kind === 'entries') return atKey(child)
  }
  const kind = kindAt(setting.schema, now.defs, at)
  if (kind === 'entries' || (kind === 'map' && canType)) return `add:${at.join('.')}`
  return 'save'
}

/** One part: picked, typed, or opened. */
function field({ now, ui, Input, act }: Ctx, at: At, isItem: boolean): RenderNode {
  const { Box, Button, Text } = ui
  const setting = editing(now)!
  const schema = schemaAt(setting.schema, now.defs, at)
  const kind = kindAt(setting.schema, now.defs, at)
  const value = getAt(draftValue(now), at)
  const name = label(schema, now.defs, at.at(-1)!, value, isItem)
  const key = atKey(at)
  const description = schema ? resolveRef(schema, now.defs).description : undefined

  if (kind === 'boolean' || kind === 'enum') {
    const options: Json[] = kind === 'boolean' ? [true, false] : (resolveRef(schema!, now.defs).enum ?? [])
    const current = value ?? (kind === 'enum' ? (resolveRef(schema!, now.defs).default ?? null) : false)
    return (
      <Box key={key} flexDirection="column">
        <Box>
          <Text>{name} </Text>
          {options.map(option => {
            const shown = option === true ? 'on' : option === false ? 'off' : String(option)
            return (
              <Button
                key={`${key}:${shown}`}
                label={shown}
                variant={JSON.stringify(option) === JSON.stringify(current) ? 'primary' : undefined}
                onPress={() => act.setPart(at, option)}
              />
            )
          })}
        </Box>
        {description && <Text dimColor>{`  ${description}`}</Text>}
      </Box>
    ) as RenderElement
  }
  if (kind === 'fields' || kind === 'map' || kind === 'entries') {
    return row(ui, { key, label: `› ${name}`, detail: summary(value, schema, now.defs), onPress: () => act.openNode(at) })
  }
  const text = setting && now.edit ? (now.edit.texts[pointer(at)] ?? editText(value ?? null)) : ''
  if (!Input) return note(ui, `${name}  ${text || 'not set'}`)
  return (
    <Input
      key={key}
      label={name}
      value={text}
      placeholder={kind === 'list' ? `a, b, c${description ? `: ${description}` : ''}` : (description ?? 'empty removes it')}
      submitLabel="save"
      onInput={typed => act.typePart(at, typed)}
      onSubmit={typed => act.typePart(at, typed).then(() => act.saveEdit())}
    />
  ) as RenderElement
}

/** A node's parts, and the way to add one: what the edit screen and each node screen draw. */
export function nodeBody(ctx: Ctx, at: At): RenderNode[] {
  const { now, ui, Input, act } = ctx
  const setting = editing(now)!
  const kind = kindAt(setting.schema, now.defs, at)
  const listed = parts(now, at).map(({ part, isItem }) => field(ctx, [...at, part], isItem))
  const where = at.join('.')
  const noun = (() => {
    const entry = schemaAt(setting.schema, now.defs, [...at, kind === 'entries' ? '0' : '*'])
    return (entry && resolveRef(entry, now.defs).title) || (kind === 'entries' ? 'item' : 'entry')
  })()
  const adding: RenderNode[] = []
  if (kind === 'map' && Input) {
    adding.push(
      <Input
        key={`add:${where}`}
        label={`Add ${noun}`}
        value={now.edit?.names[pointer(at)] ?? ''}
        placeholder={`a name for the new ${noun}`}
        submitLabel="add"
        onInput={typed => act.typeName(at, typed)}
        onSubmit={typed => act.addPart(at, typed)}
      /> as RenderElement,
    )
  }
  if (kind === 'entries') adding.push(row(ui, { key: `add:${where}`, label: `+ Add ${noun}`, onPress: () => act.addPart(at, '') }))
  const isEmpty = listed.length === 0
  return [...listed, isEmpty && kind !== 'fields' ? note(ui, `No ${noun === 'entry' ? 'entries' : `${noun}s`} yet.`) : null, ...adding].filter(
    (one): one is RenderNode => Boolean(one),
  )
}

/** One part of the value on its own screen: its fields, its name when it is a map entry, Save and Remove. */
export function node(ctx: Ctx): RenderElement {
  const { now, ui, Input, act } = ctx
  const { Box, Button } = ui
  const setting = editing(now)
  const at = top(now).at ?? []
  const path = [selected(now)?.name ?? '', setting?.path ?? '', ...at]
  if (!setting || !now.edit || getAt(draftValue(now), at) === undefined) {
    return screen(ui, { path, onBack: () => act.back() }, [note(ui, 'Nothing to edit.')])
  }
  const parentKind = kindAt(setting.schema, now.defs, at.slice(0, -1))
  const isEntry = parentKind === 'map'
  const isItem = parentKind === 'entries'
  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    isEntry && Input && (
      <Input
        key="name"
        label="Name"
        value={now.edit.names[pointer(at)] ?? at.at(-1)!}
        submitLabel="rename"
        onInput={typed => act.typeName(at, typed)}
        onSubmit={typed => act.renamePart(at, typed)}
      /> as RenderElement
    ),
    ...nodeBody(ctx, at),
    <Box key="actions" marginTop={1}>
      <Button key="save" label="Save here" variant="primary" onPress={() => act.saveEdit()} />
    </Box>,
    (isEntry || isItem) && row(ui, { key: 'remove', label: `› Remove ${isEntry ? at.at(-1) : itemName(getAt(draftValue(now), at), Number(at.at(-1)))}`, onPress: () => act.removePart(at) }),
  ])
}
