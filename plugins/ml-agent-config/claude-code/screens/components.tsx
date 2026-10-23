// The first screen, in two tabs: every component with a declaration, agent-config's own included,
// and every context.

import type { RenderElement } from 'claude-code'

import { note, row, screen } from '../ui/screen'
import type { Ctx } from './context'
import { contextsBody } from './contexts'

export function components(ctx: Ctx): RenderElement {
  const { now, ui, act } = ctx
  const { Button, Text } = ui
  const tab = (value: 'components' | 'contexts', label: string) => (
    <Button key={`tab:${value}`} label={label} variant={now.tab === value ? 'primary' : undefined} plain={now.tab !== value} onPress={() => act.setTab(value)} />
  )
  const tabs = [tab('components', 'Components'), <Text key="tab-gap"> </Text>, tab('contexts', 'Contexts')]
  if (now.tab === 'contexts') return screen(ui, { path: [], tools: tabs, message: now.message }, contextsBody(ctx))
  return screen(ui, { path: [], tools: tabs, message: now.message }, [
    now.isLoading && note(ui, 'Loading…'),
    ...now.components.map(one =>
      row(ui, {
        key: `component:${one.name}`,
        label: `› ${one.name}`,
        detail: `${one.plugin} · ${one.ready === null ? 'no answer' : one.ready ? 'ready' : 'needs setup'}`,
        color: one.ready === false ? 'red' : undefined,
        onPress: () => act.openComponent(one.name),
      }),
    ),
  ])
}
