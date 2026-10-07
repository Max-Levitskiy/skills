// Fuzzy search: the query's letters in order, anywhere in the text, case ignored. A letter at the
// start of a word, or right after the letter before it, scores higher, so "ghact" ranks
// "GitHub Actions" above "GitHub Auth Client" above "Goohost activity".

function startsWord(text: string, at: number): boolean {
  if (at === 0) return true
  const before = text[at - 1]!
  const here = text[at]!
  if (!/[\p{L}\p{N}]/u.test(before)) return true
  // The hump of camelCase: GitHub's H.
  return before === before.toLowerCase() && here !== here.toLowerCase()
}

/** The match's score, higher is better; undefined when the letters are not all there in order. */
export function fuzzy(query: string, text: string): number | undefined {
  const wanted = query.toLowerCase().replace(/\s+/g, '')
  if (!wanted) return 0
  const lower = text.toLowerCase()
  let best: number | undefined
  // Greedy from each place the first letter appears, keeping the best: a later start can only
  // drop letters, so the first start that fails ends the search.
  for (let from = lower.indexOf(wanted[0]!); from >= 0; from = lower.indexOf(wanted[0]!, from + 1)) {
    let score = -from * 0.1
    let at = from
    let last = -2
    for (const letter of wanted) {
      const found = lower.indexOf(letter, at)
      if (found < 0) return best
      score += 1 + (startsWord(text, found) ? 8 : 0) + (found === last + 1 ? 5 : 0)
      last = found
      at = found + 1
    }
    best = best === undefined ? score : Math.max(best, score)
  }
  return best
}

/** The items that match, best first; an empty query keeps them all, in their order. */
export function ranked<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return [...items]
  return items
    .map((item, index) => ({ item, index, score: fuzzy(query, text(item)) }))
    .filter((one): one is { item: T; index: number; score: number } => one.score !== undefined)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(one => one.item)
}
