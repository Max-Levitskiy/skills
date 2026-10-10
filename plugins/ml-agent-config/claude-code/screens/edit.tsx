// One setting at one level. The level sits on the title line; the value is typed (or for a
// credential, its source picked and filled in). Save, Remove and Block act on that level alone;
// Save to… writes the value at another.

import type { RenderElement } from 'claude-code'

import { editing, layerNames, selected } from '../panel'
import { LEVELS, ORDER, effect, openAbove, under } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { isStructured } from '../tree'
import { SOURCES, rootChoices, showValue } from '../values'
import type { Ctx } from './context'
import { nodeBody } from './node'

export function edit(ctx: Ctx): RenderElement {
  const { now, ui, Input, act } = ctx
  const { Box, Button, Text } = ui
  const setting = editing(now)
  const draft = now.edit
  const path = [selected(now)?.name ?? '', setting?.path ?? '']
  if (!setting || !draft) return screen(ui, { path, onBack: () => act.back() }, [note(ui, 'Nothing to edit.')])

  const layers = layerNames(now)
  const here = setting.levels[draft.layer]
  const below = under(setting, draft.layer, layers)
  const overrides = openAbove(setting, layers).filter(layer => layer !== draft.layer)
  const kind = SOURCES[draft.source]
  // An object or a list of objects, with a schema saying so: its fields, not a line of JSON.
  const isTree = !setting.credential && isStructured(setting.schema, now.defs)
  const isPlain = !setting.credential && !isTree
  // A plain value is picked when its schema says on/off or names the values it takes.
  const choices = isPlain ? rootChoices(setting, now.defs, draft.like) : null

  const said = effect(setting, draft.layer, layers, now.names)
  // The level sits on the title line, at the right; a press opens the level list. With one level
  // there is nothing to pick, so it is only named.
  const others = ORDER.filter(layer => layers.includes(layer) && layer !== draft.layer)
  const tools =
    others.length > 0
      ? [<Button key="level" label={` ${LEVELS[draft.layer]!.short} ›`} plain onPress={() => act.go({ kind: 'levels' }, 'level', `level:${draft.layer}`)} />]
      : [
          <Box key="level">
            <Text dimColor> {LEVELS[draft.layer]?.short ?? draft.layer}</Text>
          </Box>,
        ]

  return screen(ui, { path, onBack: () => act.back(), tools, message: now.message }, [
    // A line only when it says something: an override, a block, what saving would hide, or why
    // there is only one level.
    (said || others.length === 0) && (
      <Box key="where" flexDirection="column" marginBottom={1}>
        {said ? <Text dimColor>{said}</Text> : null}
        {others.length === 0 && <Text dimColor>The only level outside a git repo. Open Claude Code in one for the project levels.</Text>}
      </Box>
    ),
    ...(isTree ? nodeBody(ctx, []) : []),
    choices && (
      <Box key="choices">
        <Text>Value </Text>
        {choices.flatMap((choice, index) => [
          index > 0 && <Text key={`gap:${choice}`}> </Text>,
          <Button key={`value:${choice}`} label={choice} variant={draft.text === choice ? 'primary' : undefined} onPress={() => act.typeText(choice)} />,
        ])}
      </Box>
    ),
    isPlain && !choices && Input && (
      <Input
        key="value"
        label="Value"
        value={draft.text}
        placeholder={Array.isArray(setting.value ?? setting.default) ? 'a, b, c' : 'empty removes it from this level'}
        submitLabel="save"
        onInput={text => act.typeText(text)}
        onSubmit={text => act.typeText(text).then(() => act.saveEdit())}
      />
    ),
    isPlain && !choices && !Input && note(ui, `Value  ${draft.text || 'not set'}`),
    setting.credential &&
      row(ui, {
        key: 'source',
        label: `› Source  ${kind?.label ?? draft.source}`,
        onPress: () => act.go({ kind: 'source' }, 'source', `source:${draft.source}`),
      }),
    ...(setting.credential
      ? (kind?.fields ?? []).map(field =>
          Input ? (
            <Input
              key={`field:${field.name}`}
              label={field.label}
              value={draft.draft[field.name] ?? ''}
              placeholder={field.hint}
              submitLabel="save"
              onInput={text => act.typeField(field.name, text)}
              onSubmit={text => act.typeField(field.name, text).then(() => act.saveEdit())}
            />
          ) : (
            note(ui, `${field.label}  ${draft.draft[field.name] || 'not set'}`)
          ),
        )
      : []),
    setting.credential &&
      draft.source === '1password' &&
      row(ui, { key: 'pick', label: '› Pick from 1Password', onPress: () => act.openOnePassword() }),
    (choices || Input || setting.credential || isTree) && (
      <Box key="actions" marginTop={1}>
        <Button key="save" label="Save here" variant="primary" onPress={() => act.saveEdit()} />
        {others.length > 0 && <Text> </Text>}
        {others.length > 0 && <Button key="saveto" label="Save to…" onPress={() => act.go({ kind: 'saveto' }, 'saveto', `saveto:${others.at(-1)}`)} />}
      </Box>
    ),
    here !== undefined &&
      row(ui, {
        key: 'remove',
        label: below ? `› Remove here (back to ${showValue(below.value, now.names, setting.credential)})` : '› Remove here',
        onPress: () => act.removeHere(),
      }),
    here !== null &&
      below &&
      below.label !== 'the default' &&
      row(ui, {
        key: 'block',
        label: '› Block inherited',
        onPress: () => act.blockHere(),
      }),
    // The common wish, spelled out: keep the value where it is, and add one above it for a team,
    // for yourself, or for this checkout. A press points the edit there, starting from the value now.
    overrides.length > 0 && (
      <Box key="override" marginTop={1}>
        <Text bold>{setting.source ? 'Override it' : 'Or set it'}</Text>
      </Box>
    ),
    ...overrides.map(layer =>
      row(ui, {
        key: `override:${layer}`,
        label: `+ ${LEVELS[layer]!.offer}`,
        onPress: () => act.overrideAt(layer),
      }),
    ),
  ])
}
