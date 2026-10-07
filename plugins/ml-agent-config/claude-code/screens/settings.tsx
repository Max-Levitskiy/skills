// One component's settings: each key's value and the level it comes from, or one level's own
// values. An on/off key flips in place; every other key opens its edit screen.

import type { RenderElement } from 'claude-code'

import type { Setting } from '../../types'
import { layerNames, selected } from '../panel'
import { LEVELS, ORDER, levelLabel, under } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { isBoolean, showValue } from '../values'
import type { Ctx } from './context'

/** The value line: in effect and from where, or what one level sets. */
export function valueLine(setting: Setting, show: string, layers: readonly string[]): string {
  if (show !== 'effective') {
    const here = setting.levels[show]
    return here === undefined ? 'not set here' : here === null ? 'blocked here' : showValue(here)
  }
  if (setting.value === null) return setting.required ? 'missing' : 'not set'
  const below = setting.source && setting.source !== 'default' ? under(setting, setting.source, layers) : undefined
  const overrides = below && showValue(below.value) !== showValue(setting.value) ? `, overrides ${showValue(below.value)}` : ''
  return `${showValue(setting.value)} · ${levelLabel(setting.source)}${overrides}`
}

export function settings({ now, ui, Input, act }: Ctx): RenderElement {
  const { Box, Button, Text } = ui
  const component = selected(now)
  const layers = layerNames(now)
  const shows = ['effective', ...ORDER.filter(layer => layers.includes(layer))]
  const settingRow = (setting: Setting) => {
    if (!isBoolean(setting)) {
      return row(ui, {
        key: `setting:${setting.path}`,
        label: `› ${setting.path}`,
        detail: valueLine(setting, now.show, layers),
        color: setting.value === null && setting.required && now.show === 'effective' ? 'red' : undefined,
        onPress: () => act.openEdit(setting),
      })
    }
    const here = now.show === 'effective' ? (setting.value ?? setting.default) : setting.levels[now.show]
    const state = here === undefined ? '·' : here === null ? 'blocked' : here ? 'on' : 'off'
    return (
      <Box key={`row:setting:${setting.path}`} flexDirection="column">
        <Box>
          <Button key={`toggle:${setting.path}`} label={`${setting.path}  [ ${state} ]`} plain onPress={() => act.toggle(setting)} />
          <Button key={`setting:${setting.path}`} label="  levels ›" plain dimColor onPress={() => act.openEdit(setting)} />
        </Box>
        <Text dimColor>
          {'  '}
          {setting.description}
        </Text>
      </Box>
    )
  }
  return screen(ui, { path: ['Components', component?.name ?? ''], onBack: () => act.back(), message: now.message }, [
    now.isLoading && note(ui, 'Loading…'),
    !now.isLoading && component?.ready === false && note(ui, `${component.plugin} · needs setup`, 'yellow'),
    !now.isLoading && shows.length > 2 && (
      <Box key="show" flexWrap="wrap">
        <Text>Show </Text>
        {shows.map(show => (
          <Button
            key={`show:${show}`}
            label={show === 'effective' ? 'Effective' : LEVELS[show]!.short}
            variant={now.show === show ? 'primary' : undefined}
            dimColor={now.show === show ? undefined : true}
            onPress={() => act.setShow(show)}
          />
        ))}
      </Box>
    ),
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
