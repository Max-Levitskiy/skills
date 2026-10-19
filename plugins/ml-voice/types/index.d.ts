export type BlockKind = 'prose' | 'heading' | 'list' | 'code' | 'table'

export type Block = { kind: BlockKind; source: string; spoken?: string }

export type Reader = {
  blocks: Block[]
  current: number
  status: 'idle' | 'narrating' | 'ready' | 'playing' | 'paused' | 'stopped' | 'done' | 'error'
  view: 'source' | 'spoken'
  backend: string
  note?: string
  /** Paid API use while reading this reply, and the cost across every session. */
  usage: { requests: number; chars: number; cost: number; total: number; isPaid: boolean }
  /** The pane shows the reply being read, or the list of this session's replies to pick from. */
  mode: 'reader' | 'picker'
  /** The session's replies as the list shows them, oldest first; the full text is read again on a pick. */
  replies: { prompt: string; preview: string }[]
  /** Which reply is being read, by its place in that list; -1 before any. */
  replyIndex: number
  /** The full pane is open; the band above the prompt hides meanwhile. */
  isPaneOpen: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'ml-voice': { reader: Reader }
  }
}
