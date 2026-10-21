// One setting at every level, top first, the one in effect marked; a pick is where the edit writes.

import type { RenderElement } from 'claude-code'

import type { Json, Setting } from '../../types'
import type { Defs } from '../../src/key-schema'
import { display } from '../tree'
import { editing, layerNames, selected } from '../panel'
import { canHold, levelStack } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { lastPart, type Names } from '../values'
import type { Ctx } from './context'

function levelValue(setting: Setting, value: Json | undefined, names: Names, defs: Defs): string {
  return value === undefined ? 'not set' : value === null ? 'blocked' : display(setting, value, names, defs)
}

/** Why a level cannot hold this key: a context's team file is shared, the repo's is committed. */
function refusal(layer: string): string {
  return layer === 'repo' ? 'committed: not for a credential' : 'team file: not for a credential or personal key'
}

export function levels({ now, ui, act }: Ctx): RenderElement {
  const { Box } = ui
  const setting = editing(now)
  const path = [selected(now)?.name ?? '', lastPart(setting?.path ?? ''), 'Levels']
  if (!setting || !now.edit) return screen(ui, { path, onBack: () => act.back() }, [])
  const chosen = now.edit.layer
  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    note(ui, 'The top level that has a value wins. Pick the one to edit.'),
    ...levelStack(setting, layerNames(now)).map(level => {
      const label = `${level.layer === chosen ? '◉' : '○'} ${level.label}  ${levelValue(setting, level.value, now.names, now.defs)}${level.isWinner ? '  wins' : ''}`
      // A level that cannot hold the key still shows what it holds, but is not picked.
      if (!canHold(setting, level.layer)) {
        return (
          <Box key={`level:${level.layer}`} flexDirection="column">
            {note(ui, label)}
            {note(ui, `  ${refusal(level.layer)}`)}
          </Box>
        )
      }
      return row(ui, { key: `level:${level.layer}`, label, detail: level.hint, onPress: () => act.chooseLevel(level.layer) })
    }),
    note(ui, `  Default  ${setting.default === null ? 'none' : display(setting, setting.default, now.names, now.defs)}${setting.source === 'default' ? '  wins' : ''}`),
    layerNames(now).length === 1 && note(ui, 'Outside a repository only Everywhere is offered.'),
  ])
}
