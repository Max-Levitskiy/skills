// One screen per file; the pane draws the one on top of the stack.

import type { RenderElement } from 'claude-code'

import { top } from '../panel'
import type { Ctx } from './context'
import { choices } from './choices'
import { components } from './components'
import { edit } from './edit'
import { fields } from './fields'
import { files } from './files'
import { filter } from './filter'
import { context, parent } from './contexts'
import { node } from './node'
import { onePassword } from './onepassword'
import { settings } from './settings'
import { show } from './show'
import { source } from './source'
import type { Screen } from '../../types'

const SCREENS: Record<Screen['kind'], (ctx: Ctx) => RenderElement> = {
  components,
  settings,
  show,
  edit,
  node,
  files,
  context,
  parent,
  source,
  onepassword: onePassword,
  filter,
  fields,
  choices,
}

export function draw(ctx: Ctx): RenderElement {
  return SCREENS[top(ctx.now).kind](ctx)
}
