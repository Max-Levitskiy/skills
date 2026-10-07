// The session state the hooks module keeps. Never a secret: values live only in the
// AGENT_CONFIG_SECRETS environment variable of the harness process.
export type Unlock = { name: string; keys: string[]; isCached: boolean; reason?: string }

declare module 'claude-code' {
  interface PluginState {
    'ml-agent-config': { unlocks: Unlock[]; notice: string | null }
  }
}
