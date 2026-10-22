export type BlockKind = 'prose' | 'heading' | 'list' | 'code' | 'table'

export type Block = { kind: BlockKind; source: string; spoken?: string }

/** How a provider states what a request cost: OpenRouter per generation, Fish Audio not at all. */
export type Billing = 'openrouter' | 'chars' | 'free'

export type Reader = {
  blocks: Block[]
  current: number
  status: 'idle' | 'narrating' | 'ready' | 'playing' | 'paused' | 'stopped' | 'done' | 'error'
  view: 'source' | 'spoken'
  backend: string
  note?: string
  /** A paid request's line that could not be written to the usage log: the session's, not the reply's. */
  logError?: string
  /** Paid API use while reading this reply, and the cost across every session. */
  usage: { chars: number; cost: number; total: number; billing: Billing }
  /** The pane shows the reply being read, the list of this session's replies to pick from, or the voices. */
  mode: 'reader' | 'picker' | 'voices'
  /** Which reply is being read, by its place among the session's replies; -1 before any. */
  replyIndex: number
}

/** One value `agent-config choices` listed: a voice or a model, its id and what to call it. */
export type Choice = { value: string; label: string; detail?: string }

/**
 * The voice picker: the key it lists (the provider's voice, or OpenRouter's model), what the
 * listing answered for the search, and the choice heard last, which "use" keeps.
 */
export type Picker = {
  key: string
  /** local: listed whole and matched here; server: listed again for each search. */
  search: 'local' | 'server'
  choices: Choice[]
  text: string
  note: string | null
  error: string | null
  isLoading: boolean
  /** The voice, or the model, the config holds now. */
  current: string
  /** OpenRouter's model, shown beside its voices so it can be changed first. */
  model: string | null
  picked: Choice | null
  isHearing: boolean
  /** What the last use or hearing came to. */
  message: string | null
}

declare module 'claude-code' {
  interface PluginState {
    // Shaped<Reader>, spelled out: a contract imports nothing.
    'ml-voice': { reader: { shape: string; value: Reader }; picker: Picker }
  }
}
