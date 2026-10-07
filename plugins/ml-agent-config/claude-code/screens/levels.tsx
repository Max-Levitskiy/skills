// One setting at every level, top first, the one in effect marked; a pick is where the edit writes.

import type { RenderElement } from 'claude-code'

import type { Json } from '../../types'
import { editing, layerNames, selected } from '../panel'
import { levelStack } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { lastPart, showValue, type Names } from '../values'
import type { Ctx } from './context'

function levelValue(value: Json | undefined, names: Names): string {
  return value === undefined ? 'not set' : value === null ? 'blocked' : showValue(value, names)
}

export function levels({ now, ui, act }: Ctx): RenderElement {
  const setting = editing(now)
  const path = [selected(now)?.name ?? '', lastPart(setting?.path ?? ''), 'Levels']
  if (!setting || !now.edit) return screen(ui, { path, onBack: () => act.back() }, [])
  const chosen = now.edit.layer
  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    note(ui, 'The top level that has a value wins. Pick the one to edit.'),
    ...levelStack(setting, layerNames(now)).map(level =>
      row(ui, {
        key: `level:${level.layer}`,
        label: `${level.layer === chosen ? '◉' : '○'} ${level.label}  ${levelValue(level.value, now.names)}${level.isWinner ? '  wins' : ''}`,
        detail: level.hint,
        onPress: () => act.chooseLevel(level.layer),
      }),
    ),
    note(ui, `  Default  ${setting.default === null ? 'none' : showValue(setting.default, now.names)}${setting.source === 'default' ? '  wins' : ''}`),
    layerNames(now).length === 1 && note(ui, 'Outside a repository only Everywhere is offered.'),
  ])
}
