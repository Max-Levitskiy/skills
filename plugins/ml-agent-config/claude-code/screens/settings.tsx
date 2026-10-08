// One component's settings: each key's value and the level it comes from, or one level's own
// values. Every key, on/off ones included, opens its edit screen and is saved from there.

import type { RenderElement } from 'claude-code'

import type { Setting } from '../../types'
import { layerNames, selected } from '../panel'
import { LEVELS, levelLabel, under } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { showValue, type Names } from '../values'
import type { Ctx } from './context'

/** The value line: in effect and from where, or what one level sets. */
export function valueLine(setting: Setting, show: string, layers: readonly string[], names: Names = {}): string {
  if (show !== 'effective') {
    const here = setting.levels[show]
    return here === undefined ? 'not set here' : here === null ? 'blocked here' : showValue(here, names, setting.credential)
  }
  if (setting.value === null) return setting.required ? 'missing' : 'not set'
  const below = setting.source && setting.source !== 'default' ? under(setting, setting.source, layers) : undefined
  const overrides = below && showValue(below.value, names, setting.credential) !== showValue(setting.value, names, setting.credential) ? `, overrides ${showValue(below.value, names, setting.credential)}` : ''
  return `${showValue(setting.value, names, setting.credential)} · ${levelLabel(setting.source)}${overrides}`
}

export function settings({ now, ui, Input, act }: Ctx): RenderElement {
  const { Box, Button, Text } = ui
  const component = selected(now)
  const layers = layerNames(now)
  const settingRow = (setting: Setting) =>
    row(ui, {
      key: `setting:${setting.path}`,
      label: `› ${setting.path}`,
      detail: valueLine(setting, now.show, layers, now.names),
      color: setting.value === null && setting.required && now.show === 'effective' ? 'red' : undefined,
      onPress: () => act.openEdit(setting),
    })
  // What the rows show sits beside the path, and opens its own screen: it is rarely changed, so it
  // takes no row of its own.
  const tools =
    !now.isLoading && layers.length > 1
      ? [<Button key="show" label={` Show: ${now.show === 'effective' ? 'Effective' : LEVELS[now.show]!.short} ›`} plain dimColor onPress={() => act.go({ kind: 'show' }, 'show', `show:${now.show}`)} />]
      : []
  return screen(ui, { path: ['Components', component?.name ?? ''], onBack: () => act.back(), tools, message: now.message }, [
    now.isLoading && note(ui, 'Loading…'),
    !now.isLoading && component?.ready === false && note(ui, `${component.plugin} · needs setup`, 'yellow'),
    ...(now.isLoading ? [] : now.settings.map(settingRow)),
    !now.isLoading && now.settings.length === 0 && note(ui, 'No declared settings.'),
    !now.isLoading &&
      row(ui, { key: 'files', label: '› Files', detail: 'where each level is kept', onPress: () => act.go({ kind: 'files' }, 'files', 'back') }),
    !now.isLoading && component?.ready === false && (
      <Button
        key="setup"
        label="Set up with Claude"
        onPress={() => act.setup(component.name)}
      />
    ),
  ])
}
