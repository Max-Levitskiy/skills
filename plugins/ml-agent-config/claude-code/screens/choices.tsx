// The values a key can take, as its component's script lists them (`agent-config choices`): a
// fuzzy search over the list, or, for a key whose script searches, the script's answer to what was
// typed. A pick fills the edit, which waits for Save.

import type { RenderElement } from 'claude-code'

import { editing } from '../panel'
import { pickList } from '../ui/pick-list'
import { note, screen } from '../ui/screen'
import { lastPart } from '../values'
import type { Ctx } from './context'

export function choices({ now, ui, Input, act }: Ctx): RenderElement {
  const { Button } = ui
  const listing = now.listing
  const isServer = listing.search === 'server'
  const current = now.edit?.text
  return screen(
    ui,
    {
      path: [lastPart(editing(now)?.path ?? ''), 'Pick'],
      onBack: () => act.back(),
      tools: [<Button key="reload" label="↻" plain dimColor onPress={() => act.loadChoices()} />],
      message: now.message,
    },
    [
      listing.isLoading && isServer && listing.text && note(ui, `Searching for ${listing.text}…`),
      listing.error && note(ui, listing.error, 'red'),
      listing.note && note(ui, listing.note, 'yellow'),
      ...pickList(ui, Input, {
        name: 'choice',
        choices: listing.choices.map(one => ({ ...one, label: one.value === current ? `${one.label}  ✓` : one.label, search: `${one.label} ${one.value}` })),
        search: {
          value: listing.text,
          placeholder: isServer ? 'type to search; Enter picks the first' : 'letters in order: afbl finds af_bella',
          onInput: text => act.searchChoices(text),
        },
        isRanked: isServer,
        offset: now.pages.choice ?? 0,
        onPage: (offset, focus) => act.turnPage('choice', offset, focus),
        onPick: value => act.pickChoice(value),
        empty: listing.isLoading ? 'Listing…' : listing.choices.length === 0 ? 'Nothing listed; type the value instead.' : 'Nothing matches.',
      }),
    ],
  )
}
