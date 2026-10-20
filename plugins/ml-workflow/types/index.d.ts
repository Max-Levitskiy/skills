// The session state the mod keeps: the menu's rows as `claude-spore menu --json` gave them
// (docs/spec.md, p.11), and the run lines and live views as `claude-spore line` and `view` give
// them (p.24), restated here because the contract stands alone.

/** One pick of a row: the sub-skill it hands to, without its slash, and its arguments. */
export type MenuOption = { label: string; command: string; args: string }

/** One row of the menu, drawn as one Select. */
export type MenuRow = { key: string; label: string; options: MenuOption[] }

/** The rows, or why there are none: the helper's first stderr line, or that it gave no rows; `isReading` while the open pane waits for them. */
export type Menu = { rows: MenuRow[]; problem: string | null; isReading?: boolean }

/** `claude-spore line --json`: one run line, and the shorter forms of its text for a narrow band. */
export type RunLine = { runId: string; db: string | null; name: string; text: string; shorter?: string[]; needsYou: boolean; ended: boolean; herdrAgent?: string | null }

/** A run the session follows, newest first, with its line once the helper gave one. */
export type Followed = { runId: string; db: string | null; line: RunLine | null }

/** One run of the dot drawing, drawn in its style. */
export type Span = { text: string; style: 'node' | 'here' | 'edge' | 'taken' | 'label' | 'taken-label' }

/** One line of a file beside the drawing, and whether it is the current node's or the arrow's. */
export type FileLine = { n: number; text: string; mark: 'here' | 'taken' | null }

/** `claude-spore view --json`, or the error it gave in place of the view. */
export type LiveView = {
  runId: string
  db: string | null
  line?: RunLine
  facts?: string
  picture?: { file: string; width: number; height: number } | null
  /** The dot drawing, its roomiest layout. */
  dots?: Span[][]
  /** The same drawing laid out ever narrower, for a pane too narrow for `dots`. */
  narrower?: Span[][][]
  /**
   * Asked for a depth: the depth drawn, the least that shows every node, and how many nodes are
   * folded; `depth` equals `whole` when nothing is.
   */
  fold?: { depth: number; whole: number; folded: number } | null
  /** The compact tree, drawn when no dot drawing fits the pane's width. */
  tree?: Span[][]
  dot?: FileLine[]
  settings?: FileLine[]
  instructions?: { file: string; head: string[]; text: string } | null
  error?: { code: string; message: string }
}

declare module 'claude-code' {
  interface PluginState {
    'ml-workflow': {
      menu: Menu
      followed: Followed[]
      views: Record<string, LiveView>
      /** Whether this terminal draws pictures: null until the picture check ran. */
      pictures: boolean | null
      /** The runs whose view shows the whole instructions. */
      full: string[]
      /** What each run's view draws, the person's pick: the graph, or the compact tree as text. */
      drawn: Record<string, 'graph' | 'text'>
      /** How many arrows around the current node each run's graph shows, the person's pick. */
      depths: Record<string, number>
      /** Whether the once-a-second poll runs: a run line or a view shows. */
      polling: boolean
    }
  }
}
