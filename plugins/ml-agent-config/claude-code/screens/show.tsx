// What the settings screen shows: the value in effect, or one level's own values.

import type { RenderElement } from 'claude-code'

import { layerNames, selected } from '../panel'
import { LEVELS, ORDER } from '../ui/levels'
import { row, screen } from '../ui/screen'
import type { Ctx } from './context'

export function show({ now, ui, act }: Ctx): RenderElement {
  const layers = layerNames(now)
  const choices = [
    { value: 'effective', label: 'Effective', detail: 'the value in effect, and the level it comes from' },
    ...ORDER.filter(layer => layers.includes(layer))
      .reverse()
      .map(layer => ({ value: layer, label: LEVELS[layer]!.label, detail: `what this level sets · ${LEVELS[layer]!.hint}` })),
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
