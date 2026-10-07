// One filter's choices: the accounts, the vaults, or the item types, each with how many items it
// holds under the other filters.

import type { RenderElement } from 'claude-code'

import { pickList } from '../ui/pick-list'
import { screen } from '../ui/screen'
import type { Ctx } from './context'
import { filtered, typeLabel } from './onepassword'

const TITLES = { account: ['Account', 'All accounts'], vault: ['Vault', 'All vaults'], type: ['Type', 'All types'] } as const

export function filter({ now, ui, Input, act }: Ctx): RenderElement {
  const by = now.stack.at(-1)?.by ?? 'vault'
  const op = now.onePassword
  const items = filtered(op, by)
  const counts = new Map<string, { label: string; count: number }>()
  for (const item of items) {
    const [value, label] =
      by === 'account'
        ? [item.account ?? '', op.accounts.find(one => one.id === item.account)?.short ?? 'default']
        : by === 'vault'
          ? [item.vault.id, item.vault.name]
          : [item.category, typeLabel(item.category)]
    counts.set(value, { label, count: (counts.get(value)?.count ?? 0) + 1 })
  }
  const current = op[by]
  const choices = [
    { value: '*', label: `${current === null ? '◉' : '○'} ${TITLES[by][1]}  ${items.length}` },
    ...[...counts]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([value, one]) => ({ value, label: `${value === current ? '◉' : '○'} ${one.label}  ${one.count}` })),
  ]
  return screen(ui, { path: ['1Password', TITLES[by][0]], onBack: () => act.back() }, [
    ...pickList(ui, Input, {
      name: 'choice',
      choices,
      offset: now.pages.choice ?? 0,
      onPage: (offset, focus) => act.turnPage('choice', offset, focus),
      onPick: value => act.setFilter(by, value === '*' ? null : value),
      empty: 'Nothing to filter by.',
    }),
  ])
}
