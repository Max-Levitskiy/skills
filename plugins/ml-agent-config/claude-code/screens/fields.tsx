// One 1Password item's fields, by name and type; a pick fills in its op:// address, never its value.

import type { RenderElement } from 'claude-code'

import { pickList } from '../ui/pick-list'
import { note, screen } from '../ui/screen'
import type { Ctx } from './context'
import { accountName } from './onepassword'

export function fields({ now, ui, Input, act }: Ctx): RenderElement {
  const op = now.onePassword
  const item = op.item
  const where = item ? [item.vault.name, op.accounts.length > 1 ? accountName(op, item.account) : ''].filter(Boolean).join(' · ') : ''
  return screen(ui, { path: ['1Password', item?.title ?? ''], onBack: () => act.back(), message: now.message }, [
    note(ui, where),
    op.isLoadingFields && note(ui, 'Asking 1Password; approve it if it asks.'),
    op.fieldsError && note(ui, op.fieldsError, 'red'),
    ...(op.isLoadingFields
      ? []
      : pickList(ui, Input, {
          name: 'ref',
          choices: op.fields.map(field => ({
            value: field.reference,
            label: `${field.section ? `${field.section} › ` : ''}${field.label}`,
            detail: field.type.toLowerCase(),
          })),
          offset: now.pages.ref ?? 0,
          onPage: (offset, focus) => act.turnPage('ref', offset, focus),
          onPick: reference => act.pickField(reference),
          empty: op.fieldsError ? '' : 'This item has no fields.',
        })),
  ])
}
