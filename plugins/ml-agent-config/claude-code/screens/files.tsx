// Where each level of the selected component is kept, and how many of its keys each sets.

import type { RenderElement } from 'claude-code'

import { selected } from '../panel'
import { chainLine, levelLabel } from '../ui/levels'
import { note, row, screen } from '../ui/screen'
import type { Ctx } from './context'

export function files({ now, ui, act }: Ctx): RenderElement {
  const { Box, Text } = ui
  const shown = now.layers
  return screen(ui, { path: [selected(now)?.name ?? '', 'Files'], onBack: () => act.back(), message: now.message }, [
    <Box key="contexts">
      <Text>Contexts  </Text>
      <Text dimColor={now.contexts.length === 0}>{chainLine(now.contexts)}</Text>
    </Box>,
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
    shown.length === 1 && note(ui, 'No repo or context applies here, so only Everywhere.'),
    now.here && row(ui, { key: 'newcontext', label: '+ New context…', detail: 'values for a set of repos and folders', onPress: () => act.openNewContext() }),
    note(ui, 'Merged lowest first: a higher level overrides a lower one, key by key.'),
  ])
}
