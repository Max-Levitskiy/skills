// A structured key, a part at a time, drawn from its JSON Schema: an object's fields, a map's named
// entries, or a list's items. A field holding text, a number or a list of them is typed; on/off and
// a fixed set of values are picked; an object or a list of objects opens its own screen. Every part
// is changed in the edit's draft, and Save here writes the whole value at the edit's level.

import type { RenderElement, RenderNode } from 'claude-code'

import { same } from '../../src/key-schema'
import { editing, parts, selected, top } from '../panel'
import { type At, addKey, atKey, choicesAt, getAt, isStructuredKind, itemName, nodeAt, pointer, roleOf, summary, takesEntries } from '../tree'
import { editText } from '../values'
import { note, row, screen } from '../ui/screen'
import type { Ctx } from './context'

/** One part: picked, typed, or opened. */
function field({ now, ui, Input, act }: Ctx, at: At): RenderNode {
  const { Box, Button, Text } = ui
  const setting = editing(now)!
  const node = nodeAt(setting.schema, now.defs, at)
  const { kind, resolved } = node
  const value = getAt(now.edit?.value, at)
  const part = at.at(-1)!
  // An item by its label, a declared field by its schema's title, a named entry by its own name.
  const role = roleOf(setting.schema, now.defs, at)
  const name = role === 'item' ? itemName(value, Number(part)) : role === 'field' ? (resolved.title ?? part) : part
  const key = atKey(at)
  const description = resolved.description

  if (kind === 'boolean' || kind === 'enum') {
    const { options, labels, current } = choicesAt(node, value, now.defs)
    return (
      <Box key={key} flexDirection="column">
        <Box>
          <Text>{name} </Text>
          {options.map((option, index) => (
            <Button
              key={`${key}:${labels[index]}`}
              label={labels[index]!}
              variant={same(option, current) ? 'primary' : undefined}
              onPress={() => act.setPart(at, option)}
            />
          ))}
        </Box>
        {description && <Text dimColor>{`  ${description}`}</Text>}
      </Box>
    ) as RenderElement
  }
  if (isStructuredKind(kind)) {
    return row(ui, { key, label: `› ${name}`, detail: summary(value, node.schema, now.defs), onPress: () => act.openNode(at) })
  }
  const text = now.edit?.texts[pointer(at)] ?? editText(value ?? null)
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
export function nodeBody(ctx: Ctx, at: At): (RenderNode | false | null | undefined)[] {
  const { now, ui, Input, act } = ctx
  const setting = editing(now)!
  const holder = nodeAt(setting.schema, now.defs, at)
  const { kind } = holder
  const listed = parts(now, at).map(part => field(ctx, [...at, part]))
  const noun = nodeAt(setting.schema, now.defs, [...at, kind === 'entries' ? '0' : '*']).resolved.title ?? (kind === 'entries' ? 'item' : 'entry')
  return [
    ...listed,
    listed.length === 0 && kind !== 'fields' && note(ui, `No ${noun === 'entry' ? 'entries' : `${noun}s`} yet.`),
    takesEntries(holder) && Input && (
      <Input
        key={addKey(at)}
        label={`Add ${noun}`}
        value={now.edit?.names[pointer(at)] ?? ''}
        placeholder={`a name for the new ${noun}`}
        submitLabel="add"
        onInput={typed => act.typeName(at, typed)}
        onSubmit={typed => act.addPart(at, typed)}
      /> as RenderElement
    ),
    kind === 'entries' && row(ui, { key: addKey(at), label: `+ Add ${noun}`, onPress: () => act.addPart(at, '') }),
  ]
}

/** One part of the value on its own screen: its fields, its name when it is a map entry, Save and Remove. */
export function node(ctx: Ctx): RenderElement {
  const { now, ui, Input, act } = ctx
  const { Box, Button } = ui
  const setting = editing(now)
  const at = top(now).at ?? []
  const path = [selected(now)?.name ?? '', setting?.path ?? '', ...at]
  if (!setting || !now.edit || getAt(now.edit.value, at) === undefined) {
    return screen(ui, { path, onBack: () => act.back() }, [note(ui, 'Nothing to edit.')])
  }
  const role = roleOf(setting.schema, now.defs, at)
  const isEntry = role === 'entry'
  const isItem = role === 'item'
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
    (isEntry || isItem) && row(ui, { key: 'remove', label: `› Remove ${isEntry ? at.at(-1) : itemName(getAt(now.edit.value, at), Number(at.at(-1)))}`, onPress: () => act.removePart(at) }),
  ])
}
