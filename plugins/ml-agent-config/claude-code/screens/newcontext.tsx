// A new context, made from the pane: a name, the folders it matches (kept in its me file, for you
// alone) and the remote it matches (kept in its team file, which a team can share). A field left
// empty is not matched by.

import type { RenderElement } from 'claude-code'

import { selected } from '../panel'
import { note, screen } from '../ui/screen'
import type { Ctx } from './context'

export function newContext({ now, ui, Input, act }: Ctx): RenderElement {
  const { Box, Button } = ui
  const draft = now.newContext
  const path = [selected(now)?.name ?? '', 'New context']
  if (!draft) return screen(ui, { path, onBack: () => act.back() }, [note(ui, 'Nothing to create.')])
  const field = (name: 'name' | 'path' | 'remote', label: string, hint: string) =>
    Input ? (
      <Input
        key={name}
        label={label}
        value={draft[name]}
        placeholder={hint}
        submitLabel="create"
        onInput={text => act.typeNewContext(name, text)}
        onSubmit={text => act.typeNewContext(name, text).then(() => act.createContext())}
      />
    ) : (
      note(ui, `${label}  ${draft[name] || 'none'}`)
    )
  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    note(ui, 'A context holds values for every repo and folder it matches, between Everywhere and the repo.'),
    <Box key="fields" flexDirection="column" marginTop={1}>
      {field('name', 'Name', 'webtree')}
      {field('path', 'Folders', '~/git/acme/  (just you: its context.me.json)')}
      {field('remote', 'Remote', 'github.com/acme/**  (shared: its context.json)')}
    </Box>,
    note(ui, 'Folders: every folder under this one, kept for you alone. Remote: every repo whose remote matches, in a file a team can share. Leave one empty to match by the other only.'),
    <Box key="actions" marginTop={1}>
      <Button key="create" label={`Create context ${draft.name.trim() || '…'}`} variant="primary" onPress={() => act.createContext()} />
    </Box>,
  ])
}
