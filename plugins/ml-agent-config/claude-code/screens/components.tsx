// The first screen: every component with a declaration, agent-config's own included.

import type { RenderElement } from 'claude-code'

import { note, row, screen } from '../ui/screen'
import type { Ctx } from './context'

export function components({ now, ui, act }: Ctx): RenderElement {
  return screen(ui, { path: ['Components'], message: now.message }, [
    now.isLoading && note(ui, 'Loading…'),
    ...now.components.map(one =>
      row(ui, {
        key: `component:${one.name}`,
        label: `› ${one.name}`,
        detail: `${one.plugin} · ${one.ready === null ? 'no answer' : one.ready ? 'ready' : 'needs setup'}`,
        color: one.ready === false ? 'yellow' : undefined,
        onPress: () => act.openComponent(one.name),
      }),
    ),
  ])
}
