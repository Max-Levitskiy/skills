// Search, filter buttons and a list, for any kind of choice: 1Password items, the filters' own
// choices, and whatever picker comes next (Keychain, a .env file). The list shows a page at a time;
// ↑ more and ↓ more turn the page, and the search narrows and ranks it with fuzzy().

import type { RenderNode } from 'claude-code'

import { ranked } from './fuzzy'
import { row, type Field, type Ui } from './screen'

export type Choice = { value: string; label: string; detail?: string; color?: string; search?: string }

export const PAGE = 10

/** The list as it shows: the matches of the search, best first. */
export function shown(choices: readonly Choice[], search: string): Choice[] {
  return ranked(choices, search, one => one.search ?? one.label)
}

export function pickList(
  ui: Ui,
  Input: Field,
  list: {
    /** The rows' key prefix: a row's key is `${name}:${value}`. */
    name: string
    choices: Choice[]
    /** Absent: no search box, as for a short list. */
    search?: { value: string; placeholder: string; onInput: (text: string) => void }
    filters?: { key: string; label: string; onPress: () => void }[]
    offset: number
    onPage: (offset: number, focus: string) => void
    onPick: (value: string) => void
    empty: string
  },
): RenderNode[] {
  const { Box, Button, Text } = ui
  const matches = shown(list.choices, list.search?.value ?? '')
  const offset = Math.min(list.offset, Math.max(0, matches.length - 1))
  const page = matches.slice(offset, offset + PAGE)
  const turn = (to: number) => list.onPage(to, `${list.name}:${matches[to]!.value}`)
  const nodes: (RenderNode | false | undefined)[] = [
    list.search && Input && (
      <Input
        key="search"
        label="Search"
        value={list.search.value}
        placeholder={list.search.placeholder}
        submitLabel="open first"
        onInput={list.search.onInput}
        onSubmit={text => {
          const first = shown(list.choices, text)[0]
          if (first) list.onPick(first.value)
        }}
      />
    ),
    list.filters && list.filters.length > 0 && (
      <Box key="filters" flexWrap="wrap">
        {list.filters.map(filter => (
          <Button key={filter.key} label={filter.label} onPress={filter.onPress} />
        ))}
      </Box>
    ),
    offset > 0 && <Button key="page-up" label={`↑ ${offset} more`} plain dimColor onPress={() => turn(Math.max(0, offset - PAGE))} />,
    ...page.map(one => row(ui, { key: `${list.name}:${one.value}`, label: one.label, detail: one.detail, color: one.color, onPress: () => list.onPick(one.value) })),
    matches.length > offset + PAGE && (
      <Button key="page-down" label={`↓ ${matches.length - offset - PAGE} more`} plain dimColor onPress={() => turn(offset + PAGE)} />
    ),
    matches.length === 0 && <Text key="empty" dimColor>{list.empty}</Text>,
  ]
  return nodes.filter((node): node is RenderNode => Boolean(node))
}
