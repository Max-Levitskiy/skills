// What the settings screen shows: the value in effect, or one level's own values.

import type { RenderElement } from 'claude-code'

import { layerNames, selected } from '../panel'
import { levelInfo } from '../ui/levels'
import { row, screen } from '../ui/screen'
import type { Ctx } from './context'

export function show({ now, ui, act }: Ctx): RenderElement {
  const layers = layerNames(now)
  const choices = [
    { value: 'effective', label: 'Effective', detail: 'the value in effect, and the level it comes from' },
    ...[...layers].reverse().map(layer => {
      const { label, hint } = levelInfo(layer)
      return { value: layer, label, detail: ['what this level sets', hint].filter(Boolean).join(' · ') }
    }),
  ]
  return screen(ui, { path: [selected(now)?.name ?? '', 'Show'], onBack: () => act.back() }, [
    ...choices.map(choice =>
      row(ui, {
        key: `show:${choice.value}`,
        label: `${choice.value === now.show ? '◉' : '○'} ${choice.label}`,
        detail: choice.detail,
        onPress: async () => {
          await act.setShow(choice.value)
          await act.back()
        },
      }),
    ),
  ])
}
