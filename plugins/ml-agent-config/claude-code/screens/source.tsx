// Where a credential lives: one of the five sources.

import type { RenderElement } from 'claude-code'

import { editing } from '../panel'
import { row, screen } from '../ui/screen'
import { SOURCES, lastPart } from '../values'
import type { Ctx } from './context'

export function source({ now, ui, act }: Ctx): RenderElement {
  const chosen = now.edit?.source
  return screen(ui, { path: [lastPart(editing(now)?.path ?? ''), 'Source'], onBack: () => act.back() }, [
    ...Object.entries(SOURCES).map(([name, kind]) =>
      row(ui, {
        key: `source:${name}`,
        label: `${name === chosen ? '◉' : '○'} ${kind.label}`,
        detail: kind.fields.map(field => field.hint).join(' · '),
        onPress: () => act.chooseSource(name),
      }),
    ),
  ])
}
