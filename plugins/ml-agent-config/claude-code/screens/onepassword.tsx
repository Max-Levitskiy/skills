// Every 1Password item of every account, listed once a session: a fuzzy search over title, vault
// and account, and filter buttons that each open a screen of choices.

import type { RenderElement } from 'claude-code'

import type { Item, OnePassword } from '../../types'
import { editing } from '../panel'
import { pickList } from '../ui/pick-list'
import { note, screen } from '../ui/screen'
import { lastPart } from '../values'
import type { Ctx } from './context'

/** API_CREDENTIAL reads as API credential. */
export function typeLabel(category: string): string {
  const words = category.toLowerCase().replace(/_/g, ' ')
  const read = words.replace(/\b(api|ssh)\b/g, word => word.toUpperCase())
  return read.charAt(0).toUpperCase() + read.slice(1)
}

export function accountName(op: OnePassword, id: string | null): string {
  return op.accounts.find(one => one.id === id)?.short ?? ''
}

// A name `op` takes in a reference: letters, digits, -, _, . and spaces; anything else needs the id.
const NAMEABLE = /^[A-Za-z0-9 _.-]+$/

/**
 * `op` answers with ids (op://6egel…/rz6w…/username). Where the vault's name and the item's title
 * are allowed in a reference and the title is the only one in its vault, they replace the ids, so
 * the file and the screens read op://Private/GitHub Actions/username. Otherwise the ids stay.
 */
export function readableReference(reference: string, item: Item | null, items: readonly Item[]): string {
  const parts = reference.split('/')
  if (!item || parts[0] !== 'op:' || parts.length < 5) return reference
  const vault = items.filter(one => one.account === item.account && one.vault.id === item.vault.id)
  const vaultNames = new Set(items.filter(one => one.account === item.account && one.vault.name === item.vault.name).map(one => one.vault.id))
  const sameTitle = vault.filter(one => one.title === item.title).length
  if (parts[2] === item.vault.id && NAMEABLE.test(item.vault.name) && vaultNames.size === 1) parts[2] = item.vault.name
  if (parts[3] === item.id && NAMEABLE.test(item.title) && sameTitle === 1) parts[3] = item.title
  return parts.join('/')
}

/** The items the filters let through; the search ranks them after. */
export function filtered(op: OnePassword, skip?: 'account' | 'vault' | 'type'): Item[] {
  return op.items.filter(
    item =>
      (skip === 'account' || !op.account || item.account === op.account) &&
      (skip === 'vault' || !op.vault || item.vault.id === op.vault) &&
      (skip === 'type' || !op.type || item.category === op.type),
  )
}

export function onePassword({ now, ui, Input, act }: Ctx): RenderElement {
  const { Button } = ui
  const op = now.onePassword
  const items = filtered(op)
  const vault = op.items.find(item => item.vault.id === op.vault)?.vault.name
  const filters = [
    ...(op.accounts.length > 1 ? [{ key: 'filter:account', label: `Account: ${accountName(op, op.account) || 'all'}`, onPress: () => act.openFilter('account') }] : []),
    { key: 'filter:vault', label: `Vault: ${vault ?? 'all'}`, onPress: () => act.openFilter('vault') },
    { key: 'filter:type', label: `Type: ${op.type ? typeLabel(op.type) : 'all'}`, onPress: () => act.openFilter('type') },
  ]
  return screen(
    ui,
    {
      path: [lastPart(editing(now)?.path ?? ''), '1Password'],
      onBack: () => act.back(),
      tools: [<Button key="reload" label="↻" plain dimColor onPress={() => act.loadOnePassword()} />],
      message: now.message,
    },
    [
      op.isLoading && note(ui, 'Asking 1Password; approve it if it asks.'),
      op.error && note(ui, op.error, 'red'),
      ...op.problems.map(problem => note(ui, problem, 'yellow')),
      ...(op.isLoaded && !op.isLoading
        ? pickList(ui, Input, {
            name: 'item',
            choices: items.map(item => {
              const account = op.accounts.length > 1 ? accountName(op, item.account) : ''
              return {
                value: item.id,
                label: item.title,
                detail: [item.vault.name, account, typeLabel(item.category)].filter(Boolean).join(' · '),
                search: [item.title, item.vault.name, account].join(' '),
              }
            }),
            search: { value: op.search, placeholder: 'letters in order: ghact finds GitHub Actions', onInput: text => act.search(text) },
            filters,
            offset: now.pages.item ?? 0,
            onPage: (offset, focus) => act.turnPage('item', offset, focus),
            onPick: id => act.openItem(id),
            empty: op.items.length === 0 ? 'No items.' : 'Nothing matches.',
          })
        : []),
    ],
  )
}
