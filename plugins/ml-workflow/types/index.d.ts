// The session state the mod keeps: the menu's rows as `claude-spore menu --json` gave them
// (docs/spec.md, p.11), restated here because the contract stands alone.

/** One pick of a row: the sub-skill it hands to, without its slash, and its arguments. */
export type MenuOption = { label: string; command: string; args: string }

/** One row of the menu, drawn as one Select. */
export type MenuRow = { key: string; label: string; options: MenuOption[] }

/** The rows, or why there are none: the helper's first stderr line, or that it gave no rows. */
export type Menu = { rows: MenuRow[]; problem: string | null }

declare module 'claude-code' {
  interface PluginState {
    'ml-workflow': { menu: Menu }
  }
}
