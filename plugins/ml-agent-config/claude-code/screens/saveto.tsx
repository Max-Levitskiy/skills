// Save to…: the value as typed, written at another level, the edit's own level left as it is.

import type { RenderElement } from 'claude-code'

import type { Json } from '../../types'
import { editing, fileOf, layerNames, selected } from '../panel'
import { LEVELS, levelStack } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import { lastPart, showValue, type Names } from '../values'
import type { Ctx } from './context'

function holds(value: Json | undefined, names: Names, isCredential: boolean): string {
  return value === undefined ? 'not set there now' : value === null ? 'blocked there now' : `replaces ${showValue(value, names, isCredential)}`
}

export function saveTo({ now, ui, act }: Ctx): RenderElement {
  const setting = editing(now)
  const path = [selected(now)?.name ?? '', lastPart(setting?.path ?? ''), 'Save to']
  if (!setting || !now.edit) return screen(ui, { path, onBack: () => act.back() }, [])
  const from = now.edit.layer
  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    note(ui, `Writes the value at the level you pick. ${LEVELS[from]?.label ?? from} stays as it is.`),
    ...levelStack(setting, layerNames(now))
      .filter(level => level.layer !== from)
      .map(level =>
        row(ui, {
          key: `saveto:${level.layer}`,
          label: `› ${LEVELS[level.layer]!.offer}`,
          detail: `${fileOf(now, level.layer)} · ${holds(level.value, now.names, setting.credential)}`,
          onPress: () => act.saveTo(level.layer),
        }),
      ),
  ])
}
