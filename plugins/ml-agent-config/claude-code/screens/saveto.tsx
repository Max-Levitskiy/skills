// Save to…: the value as typed, written at another level, the edit's own level left as it is.

import type { RenderElement } from 'claude-code'

import type { Json, Setting } from '../../types'
import type { Defs } from '../../src/key-schema'
import { display } from '../tree'
import { editing, fileOf, layerNames, selected } from '../panel'
import { canHold, levelInfo, levelStack } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { lastPart, type Names } from '../values'
import type { Ctx } from './context'

function holds(setting: Setting, value: Json | undefined, names: Names, defs: Defs): string {
  return value === undefined ? 'not set there now' : value === null ? 'blocked there now' : `replaces ${display(setting, value, names, defs)}`
}

export function saveTo({ now, ui, act }: Ctx): RenderElement {
  const setting = editing(now)
  const path = [selected(now)?.name ?? '', lastPart(setting?.path ?? ''), 'Save to']
  if (!setting || !now.edit) return screen(ui, { path, onBack: () => act.back() }, [])
  const from = now.edit.layer
  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    note(ui, `Writes the value at the level you pick. ${levelInfo(from).label} stays as it is.`),
    ...levelStack(setting, layerNames(now))
      .filter(level => level.layer !== from && canHold(setting, level.layer))
      .map(level =>
        row(ui, {
          key: `saveto:${level.layer}`,
          label: `› ${levelInfo(level.layer).offer}`,
          detail: `${fileOf(now, level.layer)} · ${holds(setting, level.value, now.names, now.defs)}`,
          onPress: () => act.saveTo(level.layer),
        }),
      ),
  ])
}
