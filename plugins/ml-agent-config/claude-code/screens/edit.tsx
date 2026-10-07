// One setting at one level. The level sits on the title line, the file it writes under it; the
// value is typed (or for a credential, its source picked and filled in). Save, Remove and Block act
// on that level alone; Save to… writes the value at another.

import type { RenderElement } from 'claude-code'

import { editing, fileOf, layerNames, selected } from '../panel'
import { LEVELS, ORDER, effect, openAbove, under } from '../ui/levels'
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
  const below = under(setting, draft.layer, layers)
  const overrides = openAbove(setting, layers).filter(layer => layer !== draft.layer)
  const kind = SOURCES[draft.source]
  const isOn = typeof here === 'boolean' ? here : (setting.value ?? setting.default) === true

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
    note(ui, setting.description),
    <Box key="where" flexDirection="column">
      <Text dimColor>{fileOf(now, draft.layer)}</Text>
      <Text dimColor>{effect(setting, draft.layer, layers)}</Text>
      {others.length === 0 && <Text dimColor>The only level here: open Claude Code in a git repo to set it for a project.</Text>}
    </Box>,
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
        {others.length > 0 && <Button key="saveto" label="Save to…" onPress={() => act.go({ kind: 'saveto' }, 'saveto', `saveto:${others.at(-1)}`)} />}
      </Box>
    ),
    !isBoolean(setting) &&
      (Input || setting.credential) &&
      others.length > 0 &&
      note(ui, `  another level: ${others.map(layer => LEVELS[layer]!.short).join(', ')}`),
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
        detail: fileOf(now, layer),
        onPress: () => act.overrideAt(layer),
      }),
    ),
    others.length > 0 &&
      row(ui, {
        key: 'levels',
        label: '› Every level',
        detail: 'what each level sets, and which wins',
        onPress: () => act.go({ kind: 'levels' }, 'levels', `level:${draft.layer}`),
      }),
  ])
}
