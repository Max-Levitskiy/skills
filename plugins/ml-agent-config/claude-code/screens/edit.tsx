// One setting at one level: the level row opens the levels, the value is typed (or for a
// credential, its source picked and filled in), and Save, Remove and Block act on that level alone.

import type { RenderElement } from 'claude-code'

import { editing, layerNames, selected } from '../panel'
import { levelLabel, over, under } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { SOURCES, isBoolean, showValue } from '../values'
import type { Ctx } from './context'

export function edit({ now, ui, Input, act }: Ctx): RenderElement {
  const { Box, Button, Text } = ui
  const setting = editing(now)
  const draft = now.edit
  const path = [selected(now)?.name ?? '', setting?.path ?? '']
  if (!setting || !draft) return screen(ui, { path, onBack: () => act.back() }, [note(ui, 'Nothing to edit.')])

  const layers = layerNames(now)
  const here = setting.levels[draft.layer]
  const above = over(setting, draft.layer, layers)
  const below = under(setting, draft.layer, layers)
  const file = now.layers.find(one => one.layer === draft.layer)?.path
  const status =
    here === null
      ? 'blocks the levels under it'
      : setting.source === draft.layer
        ? 'wins'
        : above
          ? `${above} overrides it`
          : here === undefined
            ? 'not set here'
            : 'set here'
  const kind = SOURCES[draft.source]
  const isOn = typeof here === 'boolean' ? here : (setting.value ?? setting.default) === true

  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    note(ui, setting.description),
    row(ui, {
      key: 'level',
      label: `› Level  ${levelLabel(draft.layer)}`,
      detail: [status, file].filter(Boolean).join(' · '),
      onPress: () => act.go({ kind: 'levels' }, 'level', `level:${draft.layer}`),
    }),
    isBoolean(setting) && (
      <Box key="booleans">
        <Text>Value </Text>
        <Button key="value:on" label="on" variant={here !== undefined && isOn ? 'primary' : undefined} onPress={() => act.saveBoolean(true)} />
        <Button key="value:off" label="off" variant={here !== undefined && !isOn ? 'primary' : undefined} onPress={() => act.saveBoolean(false)} />
      </Box>
    ),
    !isBoolean(setting) && !setting.credential && Input && (
      <Input
        key="value"
        label="Value "
        value={draft.text}
        placeholder={Array.isArray(setting.value ?? setting.default) ? 'a, b, c' : 'empty removes it from this level'}
        submitLabel="save"
        onInput={text => act.typeText(text)}
        onSubmit={text => act.typeText(text).then(() => act.saveEdit())}
      />
    ),
    !isBoolean(setting) && !setting.credential && !Input && note(ui, `Value  ${draft.text || 'not set'}`),
    setting.credential &&
      row(ui, {
        key: 'source',
        label: `› Source  ${kind?.label ?? draft.source}`,
        detail: 'where the secret lives, never the secret',
        onPress: () => act.go({ kind: 'source' }, 'source', `source:${draft.source}`),
      }),
    ...(setting.credential
      ? (kind?.fields ?? []).map(field =>
          Input ? (
            <Input
              key={`field:${field.name}`}
              label={`${field.label} `}
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
      row(ui, { key: 'pick', label: '› Pick from 1Password', detail: 'every item, every account', onPress: () => act.openOnePassword() }),
    !isBoolean(setting) && (Input || setting.credential) && (
      <Box key="actions" marginTop={1}>
        <Button key="save" label="Save here" variant="primary" onPress={() => act.saveEdit()} />
      </Box>
    ),
    here !== undefined &&
      row(ui, {
        key: 'remove',
        label: '› Remove here',
        detail: below ? `falls back to ${showValue(below.value)} (${below.label})` : 'leaves it not set',
        onPress: () => act.removeHere(),
      }),
    here !== null &&
      below &&
      below.label !== 'the default' &&
      row(ui, {
        key: 'block',
        label: '› Block inherited',
        detail: `no value here, even though ${below.label} has one`,
        onPress: () => act.blockHere(),
      }),
  ])
}
