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
  /** Paid API use while reading this reply, and the cost across every session. */
  usage: { chars: number; cost: number; total: number; billing: Billing }
  /** The pane shows the reply being read, or the list of this session's replies to pick from. */
  mode: 'reader' | 'picker'
  /** Which reply is being read, by its place among the session's replies; -1 before any. */
  replyIndex: number
}

declare module 'claude-code' {
  interface PluginState {
    // Shaped<Reader>, spelled out: a contract imports nothing.
    'ml-voice': { reader: { shape: string; value: Reader } }
  }
}
