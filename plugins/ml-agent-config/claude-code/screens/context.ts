import type { Panel, Screen, Setting } from '../../types'
import type { Field, Ui } from '../ui/screen'

/**
 * What a press can do, bound to the engine in register.tsx: the engine follows `$` only within the
 * file that declares it, so a screen gets these instead of `$`.
 */
export type Actions = {
  go: (screen: Screen, from: string, focus?: string) => Promise<void>
  back: () => Promise<void>
  openComponent: (name: string) => Promise<void>
  setup: (name: string) => Promise<void>
  setShow: (show: string) => Promise<void>
  toggle: (setting: Setting) => Promise<void>
  openEdit: (setting: Setting) => Promise<void>
  /** Point the edit at another level, staying on the edit screen. */
  setLevel: (layer: string) => Promise<void>
  /** Point the edit at an empty level above the one in effect, focused on the value. */
  overrideAt: (layer: string) => Promise<void>
  /** The same from the levels screen, which then closes. */
  chooseLevel: (layer: string) => Promise<void>
  chooseSource: (source: string) => Promise<void>
  typeText: (text: string) => Promise<void>
  typeField: (field: string, text: string) => Promise<void>
  saveEdit: () => Promise<void>
  saveBoolean: (value: boolean) => Promise<void>
  removeHere: () => Promise<void>
  blockHere: () => Promise<void>
  turnPage: (list: string, offset: number, focus: string) => Promise<void>
  loadOnePassword: () => Promise<void>
  openOnePassword: () => Promise<void>
  search: (text: string) => Promise<void>
  openFilter: (by: 'account' | 'vault' | 'type') => Promise<void>
  setFilter: (by: 'account' | 'vault' | 'type', value: string | null) => Promise<void>
  openItem: (id: string) => Promise<void>
  pickField: (reference: string) => Promise<void>
}

/** What every screen draws from: the pane's state, the surface's elements, and the presses. */
export type Ctx = { now: Panel; ui: Ui; Input: Field; act: Actions }
