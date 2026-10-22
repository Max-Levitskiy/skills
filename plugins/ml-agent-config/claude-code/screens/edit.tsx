// One setting at one level. Its levels come first, top first, each with what it sets and what became
// of that: a press points the edit at another level, keeping what was typed. The value is typed (or
// for a credential, its source picked and filled in); Save, Remove and Block act on that level alone.

import type { RenderElement } from 'claude-code'

import type { Json } from '../../types'

import { editing, layerNames, selected, suggestContext } from '../panel'
import { chainRows, chainState, effect, levelInfo, refusal, under } from '../ui/levels'
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
  const kind = SOURCES[draft.source]
  // An object or a list of objects, with a schema saying so: its fields, not a line of JSON.
  const isTree = isTreeSetting(setting, now.defs)
  const isPlain = !setting.credential && !isTree
  // A plain value is picked when its schema says on/off or names the values it takes.
  const choices = isPlain ? rootChoices(setting, now.defs, draft.like) : null
  const isText = setting.schema !== null && kindOf(setting.schema, now.defs) === 'string'

  const said = effect(setting, draft.layer, layers, now.names, now.defs)
  const chain = layers.length > 1 ? chainRows(setting, layers) : []
  const shown = (value: Json | undefined) =>
    value === undefined ? 'not set' : value === null ? 'blocked' : display(setting, value, now.names, now.defs)

  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    // Every level, top first: a press edits there. One that cannot hold the key shows what it holds
    // and why it is not offered.
    chain.length > 0 && (
      <Box key="chain" flexDirection="column" marginBottom={1}>
        <Text dimColor>The top level with a value wins. Pick one to edit.</Text>
        {chain.map(level => {
          const label = `${level.layer === draft.layer ? '◉' : '○'} ${level.label}  ${shown(level.value)}${chainState(level) ? `  ${chainState(level)}` : ''}`
          return level.canHold ? (
            <Button key={`level:${level.layer}`} label={label} plain onPress={() => act.setLevel(level.layer)} />
          ) : (
            <Text key={`level:${level.layer}`} dimColor>
              {label} · {refusal(level.layer)}
            </Text>
          )
        })}
        <Text dimColor>
          {'  '}Default  {setting.default === null ? 'none' : display(setting, setting.default, now.names, now.defs)}
          {setting.source === 'default' ? '  wins' : ''}
        </Text>
      </Box>
    ),
    // What saving here does, when it says more than the level: an override, a block, what it would hide.
    (said || layers.length === 1) && (
      <Box key="where" flexDirection="column" marginBottom={1}>
        {said ? <Text dimColor>{said}</Text> : null}
        {layers.length === 1 && <Text dimColor>No repo or context applies here, so only Everywhere. A context sets values for every repo and folder it matches.</Text>}
      </Box>
    ),
    now.here &&
      row(ui, {
        key: 'newcontext',
        label: '+ New context…',
        detail: `values for a set of repos and folders, such as everything under ${suggestContext(now.here).paths[0]}`,
        onPress: () => act.openNewContext(),
      }),
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
    isPlain && !choices && setting.choices && row(ui, { key: 'pick-list', label: '› Pick from the list', onPress: () => act.openChoices() }),
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
        <Button key="save" label={`Save to ${levelInfo(draft.layer).label}`} variant="primary" onPress={() => act.saveEdit()} />
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
  ])
}
