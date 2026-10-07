// The pane's state, read: which screen is on top, which component and setting it is about, where an
// edit starts, and `describe` turned into settings. Nothing here calls the engine; the presses that
// do are in register.tsx, since the engine follows `$` only within the file that declares it.

import type { Component, Edit, Json, Level, Panel, Screen, Setting } from '../types'
import { levelLabel } from './ui/levels'
import { SOURCES, editText, isBoolean, isReference } from './values'

export const PANE = 'agent-config'

export function top(now: Panel): Screen {
  return now.stack.at(-1) ?? { kind: 'components' }
}

export function selected(now: Panel): Component | undefined {
  return now.components.find(one => one.name === now.selected)
}

export function editing(now: Panel): Setting | undefined {
  return now.settings.find(one => one.path === now.edit?.path)
}

export function layerNames(now: Panel): string[] {
  return now.layers.map(one => one.layer)
}

/** `describe` as the screens read it: paths shortened to ~ and to the repository's root. */
export function readDescribe(stdout: string, home: string | undefined): Pick<Panel, 'settings' | 'layers'> {
  const out = JSON.parse(stdout) as {
    keys: (Omit<Setting, 'levels'> & { levels?: Setting['levels'] })[]
    layers: { layer: string; path: string | null; exists?: boolean }[]
    repo?: { checkout: string | null }
  }
  const checkout = out.repo?.checkout
  const short = (path: string) =>
    checkout && path.startsWith(`${checkout}/`)
      ? path.slice(checkout.length + 1)
      : home && path.startsWith(`${home}/`)
        ? `~${path.slice(home.length)}`
        : path
  return {
    settings: out.keys.map(({ path, description, layer, default: fallback, value, source, credential, required, levels }) => ({
      path,
      description,
      layer,
      default: fallback,
      value,
      source,
      credential,
      required,
      levels: levels ?? {},
    })),
    layers: out.layers.filter(one => one.path).map(one => ({ layer: one.layer, path: short(one.path!), exists: one.exists ?? false }) satisfies Level),
  }
}

/** The settings screen's first row, where the focus starts. */
export function firstSetting(settings: readonly Setting[]): string {
  const first = settings[0]
  return first ? `${isBoolean(first) ? 'toggle' : 'setting'}:${first.path}` : 'files'
}

/** An edit at one level starts from what that level sets, else from the value in effect. */
export function editAt(setting: Setting, layer: string): Edit {
  const here = setting.levels[layer]
  const from = here !== undefined && here !== null ? here : (setting.value ?? setting.default)
  const reference = isReference(from) ? from : undefined
  return {
    path: setting.path,
    layer,
    text: reference ? '' : editText(from),
    source: reference && SOURCES[reference.source] ? reference.source : '1password',
    draft: Object.fromEntries(Object.entries(reference ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    isDirty: false,
  }
}

/**
 * The edit pointed at another level. What was typed stays, so a value can be written wherever it
 * belongs; untouched, the edit shows what that level holds.
 */
export function switchLevel(edit: Edit, setting: Setting, layer: string): Edit {
  return edit.isDirty ? { ...edit, layer } : editAt(setting, layer)
}

/** The edit screen's first element: the field to type in, or the first choice. */
export function firstEdit(setting: Setting, edit: Edit, canType: boolean, levels = 2): string {
  if (isBoolean(setting)) return 'value:on'
  if (!canType) return levels > 1 ? `at:${edit.layer}` : 'save'
  if (!setting.credential) return 'value'
  if (edit.source === '1password') return 'pick'
  return `field:${SOURCES[edit.source]!.fields[0]!.name}`
}

export function savedAt(path: string, layer: string, value: Json | undefined): string {
  if (value === undefined) return `Removed ${path} from ${levelLabel(layer)}.`
  if (value === null) return `Blocked ${path} in ${levelLabel(layer)}: the levels under it no longer apply.`
  return `Saved ${path} in ${levelLabel(layer)}.`
}
