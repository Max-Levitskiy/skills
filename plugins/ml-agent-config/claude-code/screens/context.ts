import type { Json, Panel, Screen, Setting } from '../../types'
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
  openEdit: (setting: Setting) => Promise<void>
  /** Point the edit at another level, keeping what was typed. */
  setLevel: (layer: string) => Promise<void>
  /** Which list the first screen shows; Contexts lists them again. */
  setTab: (tab: 'components' | 'contexts') => Promise<void>
  /** A context for the repos and folders around this one, filled in from where the pane runs. */
  openNewContext: () => Promise<void>
  openContext: (name: string) => Promise<void>
  typeContextName: (text: string) => Promise<void>
  typeFilter: (kind: 'remote' | 'path', text: string) => Promise<void>
  /** On the screen creating a context, the draft changes; on a context's own, its files do. */
  addFilter: (kind: 'remote' | 'path', glob: string) => Promise<void>
  removeFilter: (kind: 'remote' | 'path', glob: string) => Promise<void>
  /** Null drops the parent. Picked on the parent screen, which then closes. */
  chooseParent: (parent: string | null) => Promise<void>
  createContext: () => Promise<void>
  /** The first press asks again; the second deletes the context and the values it holds. */
  deleteContext: (name: string) => Promise<void>
  chooseSource: (source: string) => Promise<void>
  typeText: (text: string) => Promise<void>
  typeField: (field: string, text: string) => Promise<void>
  saveEdit: () => Promise<void>
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
  /** A structured key's parts, each a place in the draft value: open one, pick or type its value. */
  openNode: (at: string[]) => Promise<void>
  /** No value takes the part out of the draft. */
  setPart: (at: string[], value: Json | undefined) => Promise<void>
  typePart: (at: string[], text: string) => Promise<void>
  /** The name typed for a new map entry, or for a rename of one. */
  typeName: (at: string[], text: string) => Promise<void>
  /** A new entry named so in a map, or a new item at the end of a list. */
  addPart: (at: string[], name: string) => Promise<void>
  renamePart: (at: string[], name: string) => Promise<void>
  removePart: (at: string[]) => Promise<void>
}

/** What every screen draws from: the pane's state, the surface's elements, and the presses. */
export type Ctx = { now: Panel; ui: Ui; Input: Field; act: Actions }
