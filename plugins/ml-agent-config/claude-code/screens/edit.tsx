// One setting at one level. The level sits on the title line; the value is typed (or for a
// credential, its source picked and filled in). Save, Remove and Block act on that level alone;
// Save to… writes the value at another.

import type { RenderElement } from 'claude-code'

import { editing, layerNames, selected } from '../panel'
import { canHold, effect, levelInfo, openAbove, under } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { display, isTreeSetting } from '../tree'
import { kindOf } from '../../src/key-schema'
import { SOURCES, rootChoices } from '../values'
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
  const isTree = isTreeSetting(setting, now.defs)
  const isPlain = !setting.credential && !isTree
  // A plain value is picked when its schema says on/off or names the values it takes.
  const choices = isPlain ? rootChoices(setting, now.defs, draft.like) : null
  const isText = setting.schema !== null && kindOf(setting.schema, now.defs) === 'string'

  const said = effect(setting, draft.layer, layers, now.names, now.defs)
  // The level sits on the title line, at the right; a press opens the level list. With no other
  // level that can hold the key there is nothing to pick, so it is only named.
  const others = layers.filter(layer => layer !== draft.layer)
  const saveTargets = others.filter(layer => canHold(setting, layer))
  // An edit at a level that cannot hold the key (one set there by hand) has no pickable row of its
  // own in the level list, so the list opens on the first row that can.
  const focusRow = canHold(setting, draft.layer) ? draft.layer : [...layers].reverse().find(layer => canHold(setting, layer))
  const tools =
    saveTargets.length > 0
      ? [<Button key="level" label={` ${levelInfo(draft.layer).short} ›`} plain onPress={() => act.go({ kind: 'levels' }, 'level', `level:${focusRow}`)} />]
      : [
          <Box key="level">
            <Text dimColor> {levelInfo(draft.layer).short}</Text>
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
        placeholder={Array.isArray(setting.value ?? setting.default) ? 'a, b, c' : isText ? 'empty saves empty text; Remove here removes it' : 'empty removes it from this level'}
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
        {saveTargets.length > 0 && <Text> </Text>}
        {saveTargets.length > 0 && <Button key="saveto" label="Save to…" onPress={() => act.go({ kind: 'saveto' }, 'saveto', `saveto:${saveTargets.at(-1)}`)} />}
      </Box>
    ),
    here !== undefined &&
      row(ui, {
        key: 'remove',
        label: below ? `› Remove here (back to ${display(setting, below.value, now.names, now.defs)})` : '› Remove here',
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
        label: `+ ${levelInfo(layer).offer}`,
        onPress: () => act.overrideAt(layer),
      }),
    ),
  ])
}
