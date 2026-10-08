// The pane's state as it starts. The atoms holding it are declared in register.tsx, where the
// engine reads them.

import type { OnePassword, Panel } from '../types'

export const NO_ONE_PASSWORD: OnePassword = {
  accounts: [],
  items: [],
  isLoaded: false,
  isLoading: false,
  error: null,
  problems: [],
  search: '',
  account: null,
  vault: null,
  type: null,
  item: null,
  fields: [],
  isLoadingFields: false,
  fieldsError: null,
}

export const EMPTY_PANEL: Panel = {
  stack: [{ kind: 'components' }],
  components: [],
  selected: null,
  settings: [],
  layers: [],
  show: 'effective',
  edit: null,
  onePassword: NO_ONE_PASSWORD,
  pages: {},
  names: {},
  message: null,
  isLoading: false,
}
