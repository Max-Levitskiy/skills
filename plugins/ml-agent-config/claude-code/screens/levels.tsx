// One setting at every level, top first, the one in effect marked; a pick is where the edit writes.

import type { RenderElement } from 'claude-code'

import type { Json, Setting } from '../../types'
import type { Defs } from '../../src/key-schema'
import { display } from '../tree'
import { editing, layerNames, selected } from '../panel'
import { levelStack } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { lastPart, type Names } from '../values'
import type { Ctx } from './context'

function levelValue(setting: Setting, value: Json | undefined, names: Names, defs: Defs): string {
  return value === undefined ? 'not set' : value === null ? 'blocked' : display(setting, value, names, defs)
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
        label: `${level.layer === chosen ? '◉' : '○'} ${level.label}  ${levelValue(setting, level.value, now.names, now.defs)}${level.isWinner ? '  wins' : ''}`,
        detail: level.hint,
        onPress: () => act.chooseLevel(level.layer),
      }),
    ),
    note(ui, `  Default  ${setting.default === null ? 'none' : display(setting, setting.default, now.names, now.defs)}${setting.source === 'default' ? '  wins' : ''}`),
    layerNames(now).length === 1 && note(ui, 'Outside a repository only Everywhere is offered.'),
  ])
}
