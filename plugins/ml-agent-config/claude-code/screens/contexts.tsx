// Contexts: the first screen's second tab, a context's own screen (also the one creating a context)
// and its parent picker. A context's remotes are kept in its context.json, which carries no secret
// and can be handed to a team; its folders in context.me.json, which stays yours.

import type { RenderElement, RenderNode } from 'claude-code'

import type { ContextEntry } from '../../types'
import { top } from '../panel'
import { note, row, screen } from '../ui/screen'
import type { Ctx } from './context'

/** Whether `name` is `ancestor` or under it, by the parents listed; a loop ends the walk. */
function isUnder(list: readonly ContextEntry[], name: string, ancestor: string): boolean {
  const seen = new Set<string>()
  for (let at: string | null | undefined = name; at && !seen.has(at); at = list.find(one => one.name === at)?.parent) {
    if (at === ancestor) return true
    seen.add(at)
  }
  return false
}

/** One context's line in the list: where it applies, its parent, its filters, what it holds. */
function summary(one: ContextEntry): string {
  const filters = [...one.remotes, ...one.paths]
  return [
    one.matched ? 'applies here' : '',
    one.parent ? `under ${one.parent}` : '',
    filters.length > 0 ? filters.join(', ') : 'matches nothing of its own',
    one.components.length > 0 ? `values for ${one.components.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The Contexts tab: every context, the ones that apply here first. */
export function contextsBody({ now, ui, act }: Ctx): RenderNode[] {
  const list = now.contextList
  const sorted = [...(list ?? [])].sort((a, b) => Number(b.matched) - Number(a.matched))
  return [
    note(ui, 'A context holds values for every repo and folder it matches, between Everywhere and the repo.'),
    list === null && note(ui, 'Loading…'),
    list?.length === 0 && note(ui, 'No contexts yet.'),
    ...sorted.map(one =>
      row(ui, { key: `context:${one.name}`, label: `${one.matched ? '●' : '○'} ${one.name}`, detail: summary(one), onPress: () => act.openContext(one.name) }),
    ),
    row(ui, { key: 'newcontext', label: '+ New context…', detail: 'filled in from where Claude Code runs', onPress: () => act.openNewContext() }),
  ].filter((node): node is RenderNode => Boolean(node))
}

/** A filter list: each glob removed on press, and a field that adds one. */
function filters(ctx: Ctx, kind: 'remote' | 'path', globs: string[]): RenderNode[] {
  const { now, ui, Input, act } = ctx
  const { Box, Text } = ui
  const [title, where, hint] =
    kind === 'remote'
      ? ['Remotes', 'context.json: no secrets, can be handed to a team', 'github.com/acme/**']
      : ['Folders', 'context.me.json: yours alone', '~/git/acme/']
  return [
    <Box key={`title:${kind}`} marginTop={1}>
      <Text bold>{title} </Text>
      <Text dimColor>{where}</Text>
    </Box>,
    ...globs.map(glob => row(ui, { key: `${kind}:${glob}`, label: `✕ ${glob}`, onPress: () => act.removeFilter(kind, glob) })),
    globs.length === 0 && note(ui, '  none'),
    Input && (
      <Input
        key={`add-${kind}`}
        label={kind === 'remote' ? 'Add remote' : 'Add folder'}
        value={now.typed[kind]}
        placeholder={hint}
        submitLabel="add"
        onInput={text => act.typeFilter(kind, text)}
        onSubmit={text => act.addFilter(kind, text)}
      />
    ),
  ].filter((node): node is RenderNode => Boolean(node))
}

/** One context, or the one being created: its parent, remotes and folders, and Delete or Create. */
export function context(ctx: Ctx): RenderElement {
  const { now, ui, Input, act } = ctx
  const { Box, Button } = ui
  const name = top(now).context
  const entry = name ? now.contextList?.find(one => one.name === name) : undefined
  const draft = name ? null : now.newContext
  const path = ['Contexts', name ?? 'New context']
  if (!entry && !draft) return screen(ui, { path, onBack: () => act.back(), message: now.message }, [note(ui, 'This context is gone.')])
  const shown = entry ?? draft!
  const isConfirming = name !== undefined && now.confirmDelete === name
  const held = entry?.components ?? []
  return screen(ui, { path, onBack: () => act.back(), message: now.message }, [
    draft &&
      (Input ? (
        <Input key="name" label="Name" value={draft.name} placeholder="acme" submitLabel="create" onInput={text => act.typeContextName(text)} onSubmit={text => act.typeContextName(text).then(() => act.createContext())} />
      ) : (
        note(ui, `Name  ${draft.name || 'none'}`)
      )),
    entry && note(ui, entry.matched ? 'Applies here.' : 'Does not apply here.'),
    row(ui, {
      key: 'parent',
      label: `› Parent  ${shown.parent ?? 'none'}`,
      detail: 'a context applies wherever any of its children does, under their values',
      onPress: () => act.go({ kind: 'parent' }, 'parent', `parent:${shown.parent ?? ''}`),
    }),
    ...filters(ctx, 'remote', shown.remotes),
    ...filters(ctx, 'path', shown.paths),
    held.length > 0 && <Box key="held" marginTop={1}>{note(ui, `Holds values for ${held.join(', ')}.`)}</Box>,
    draft && (
      <Box key="actions" marginTop={1}>
        <Button key="create" label={`Create context ${draft.name.trim() || '…'}`} variant="primary" onPress={() => act.createContext()} />
      </Box>
    ),
    entry &&
      row(ui, {
        key: 'delete',
        label: isConfirming ? `› Press again to delete ${entry.name}${held.length > 0 ? `, and its values for ${held.join(', ')}` : ''}` : `› Delete context ${entry.name}`,
        color: isConfirming ? 'red' : undefined,
        onPress: () => act.deleteContext(entry.name),
      }),
  ])
}

/** The parent picker: none, or any context that is not this one or under it. */
export function parent({ now, ui, act }: Ctx): RenderElement {
  const name = now.stack.at(-2)?.context
  const list = now.contextList ?? []
  const current = name ? list.find(one => one.name === name)?.parent : now.newContext?.parent
  const choices = list.filter(one => !name || !isUnder(list, one.name, name))
  return screen(ui, { path: ['Contexts', name ?? 'New context', 'Parent'], onBack: () => act.back(), message: now.message }, [
    row(ui, { key: 'parent:', label: `${current ? '○' : '◉'} none`, onPress: () => act.chooseParent(null) }),
    ...choices.map(one =>
      row(ui, { key: `parent:${one.name}`, label: `${current === one.name ? '◉' : '○'} ${one.name}`, detail: summary(one), onPress: () => act.chooseParent(one.name) }),
    ),
  ])
}
