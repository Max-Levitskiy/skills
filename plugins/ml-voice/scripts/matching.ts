// The search the voice lists share, in the read pane and in scripts/voices.ts: a choice matches
// when it holds the search's letters in order, as agent-config's pane matches them. Plain
// TypeScript, so the hooks module imports it too.

export type Choice = { value: string; label: string; detail?: string }

export function matching<T extends Choice>(choices: T[], search: string): T[] {
  const letters = [...search.toLowerCase().replace(/\s+/g, '')]
  return choices.filter(one => {
    const text = `${one.label} ${one.value}`.toLowerCase()
    let at = 0
    return letters.every(letter => (at = text.indexOf(letter, at) + 1) > 0)
  })
}
