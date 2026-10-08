// The session state the hooks module keeps. Never a secret: values live only in the
// AGENT_CONFIG_SECRETS environment variable of the harness process. A credential setting holds
// its reference ({ source, ref }), which is what the config file holds too.
/** One unlock of a component: its keys, and the cache keys of the references asked for. */
export type Unlock = { name: string; keys: string[]; refs: string[]; isCached: boolean; reason?: string }

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** One component in the pane: an installed plugin's declaration, or agent-config's own. */
export type Component = { name: string; plugin: string; from?: string; ready: boolean | null }

/** One declared key of the selected component, as `agent-config describe` reports it. */
export type Setting = {
  path: string
  description: string
  layer: string | null
  default: Json
  value: Json
  source: string | null
  credential: boolean
  required: boolean
  /** What each level itself sets: absent where it sets nothing, null where it blocks the levels under it. */
  levels: { [layer: string]: Json }
}

/** A level this checkout has: its file, shortened for reading, and whether the file exists. */
export type Level = { layer: string; path: string; exists: boolean }

/** One screen of the pane. The pane draws the top of the stack; Back pops it. */
export type Screen = {
  kind: 'components' | 'settings' | 'show' | 'edit' | 'levels' | 'saveto' | 'files' | 'source' | 'onepassword' | 'filter' | 'fields'
  /** A filter screen's subject. */
  by?: 'account' | 'vault' | 'type'
  /** The element pressed to open the next screen, focused again when it closes. */
  focus?: string
}

/** The setting being edited, the level the edit writes to, and what has been typed or picked. */
export type Edit = {
  path: string
  layer: string
  /** A plain value's text, in the form parseText reads. */
  text: string
  /** A credential's source, and the text of each of that source's fields. */
  source: string
  draft: Record<string, string>
  /** Something was typed or picked: switching the level keeps it instead of loading that level's value. */
  isDirty: boolean
  /** What the text is read as: the value the edit started from, kept while what was typed moves levels. */
  like: Json
}

/** A 1Password item as listed: names only, never a value. */
export type Item = { id: string; title: string; category: string; vault: { id: string; name: string }; account: string | null }

/** Every 1Password item, listed once a session and filtered here; ↻ lists them again. */
export type OnePassword = {
  accounts: { id: string; short: string }[]
  items: Item[]
  isLoaded: boolean
  isLoading: boolean
  error: string | null
  /** Accounts that refused while others listed. */
  problems: string[]
  search: string
  account: string | null
  vault: string | null
  type: string | null
  /** The item whose fields are listed, and those fields: names and op:// addresses. */
  item: Item | null
  fields: { label: string; section: string | null; type: string; reference: string }[]
  /** The item's fields are being asked for: apart from the listing, so Back finds the list usable. */
  isLoadingFields: boolean
}

export type Panel = {
  stack: Screen[]
  components: Component[]
  selected: string | null
  settings: Setting[]
  /** The levels a value can be written to here, lowest first; the project levels need a repository. */
  layers: Level[]
  /** What the settings screen shows: the merged value, or one level's own. */
  show: string
  edit: Edit | null
  onePassword: OnePassword
  /** The first row each list shows, by the list's name; ↑ more and ↓ more move it a page. */
  pages: Record<string, number>
  /** 1Password vault and item names by id, from the last listing, so a reference reads by name. */
  names: Record<string, string>
  message: string | null
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ml-agent-config': { unlocks: Unlock[]; notice: string | null; isBandClosed: boolean; panel: Panel }
  }
}
