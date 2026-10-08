// The frame every screen draws in, and the row most screens are made of. Short screens are the
// point: a pane that fits its room lets the arrows walk the rows, where an overflowing one spends
// them on scrolling.

import type { ElementConstructor, ElementTable, InputProps, RenderElement, RenderNode } from 'claude-code'

export type Ui = ElementTable
/** The mobile app draws no field yet, so a screen offers what it can without one. */
export type Field = ElementConstructor<InputProps> | undefined

/**
 * Back and where the screen sits, a tool or two on the right, the body, then the message the last
 * action left. Back is absent on the first screen.
 */
export function screen(
  ui: Ui,
  frame: { path: string[]; onBack?: () => void; tools?: RenderNode[]; message?: string | null },
  body: (RenderNode | false | null | undefined)[],
): RenderElement {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="column">
      <Box>
        {frame.onBack && <Button key="back" label="‹ Back" onPress={frame.onBack} />}
        <Text bold> {frame.path.join(' › ')} </Text>
        {frame.tools ?? []}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {body.filter((node): node is RenderNode => Boolean(node))}
      </Box>
      {frame.message && (
        <Box marginTop={1}>
          <Text>{frame.message}</Text>
        </Box>
      )}
    </Box>
  ) as RenderElement
}

/** A row that opens or picks something: its label, and a dim line under it. */
export function row(ui: Ui, one: { key: string; label: string; detail?: string; color?: string; onPress: () => void }): RenderElement {
  const { Box, Button, Text } = ui
  return (
    <Box key={`row:${one.key}`} flexDirection="column">
      <Button key={one.key} label={one.label} plain onPress={one.onPress} />
      {one.detail && (
        <Text dimColor color={one.color}>
          {'  '}
          {one.detail}
        </Text>
      )}
    </Box>
  ) as RenderElement
}

/** A line to read, not to press. */
export function note(ui: Ui, text: string, color?: string): RenderElement {
  const { Text } = ui
  return (
    <Text dimColor={color ? undefined : true} color={color}>
      {text}
    </Text>
  ) as RenderElement
}
