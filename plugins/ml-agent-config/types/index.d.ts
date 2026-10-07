// The session state the hooks module keeps. Never a secret: values live only in the
// AGENT_CONFIG_SECRETS environment variable of the harness process. A credential setting holds
// its reference ({ source, ref }), which is what the config file holds too.
export type Unlock = { name: string; keys: string[]; isCached: boolean; reason?: string }

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
}

export type Panel = {
  components: Component[]
  selected: string | null
  settings: Setting[]
  /** The layers a value can be written to here; repo layers are absent outside a repository. */
  layers: string[]
  /** The key whose edit field is open, and the layer the edit writes to. */
  editing: string | null
  layer: string
  message: string | null
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ml-agent-config': { unlocks: Unlock[]; notice: string | null; panel: Panel }
  }
}
