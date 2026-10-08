// Where each level of the selected component is kept, and how many of its keys each sets.

import type { RenderElement } from 'claude-code'

import { selected } from '../panel'
import { ORDER, levelLabel } from '../ui/levels'
import { note, screen } from '../ui/screen'
import type { Ctx } from './context'

export function files({ now, ui, act }: Ctx): RenderElement {
  const { Box, Text } = ui
  const shown = ORDER.map(layer => now.layers.find(one => one.layer === layer)).filter(one => one !== undefined)
  return screen(ui, { path: [selected(now)?.name ?? '', 'Files'], onBack: () => act.back(), message: now.message }, [
    ...shown.map(level => {
      const count = now.settings.filter(setting => setting.levels[level.layer] !== undefined).length
      return (
        <Box key={`file:${level.layer}`} flexDirection="column">
          <Box>
            <Text>{levelLabel(level.layer)} </Text>
            <Text dimColor>{level.exists ? `${count} ${count === 1 ? 'key' : 'keys'}` : 'no file'}</Text>
          </Box>
          <Text dimColor>
            {'  '}
            {level.path}
          </Text>
        </Box>
      )
    }),
    shown.length === 1 && note(ui, 'Outside a repository only Everywhere is offered.'),
    note(ui, 'Merged lowest first: a higher level overrides a lower one, key by key.'),
  ])
}
