import { describe, expect, test } from 'claude-code/testing'

import { parseSpoken, replies, split } from '../hooks/register'

const REPLY = `## Plan

First paragraph explains the idea.

\`\`\`ts
const x = 1
\`\`\`

| a | b |
|---|---|
| 1 | 2 |

- one item
  continues here
- two`

describe('split', () => {
  test('gives each heading, paragraph, code fence, table and list item a part', async () => {
    const kinds = split(REPLY).map(b => b.kind)
    expect(kinds).toEqual(['heading', 'prose', 'code', 'table', 'list', 'list'])
    expect(split(REPLY)[4]?.source).toBe('- one item continues here')
  })

  test('cuts a run-on stretch with no sentence end between words', async () => {
    const runOn = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ')
    const parts = split(runOn)
    expect(parts.length).toBeGreaterThan(10)
    expect(parts.every(p => p.source.length <= 240)).toBe(true)
    expect(parts.map(p => p.source).join(' ')).toBe(runOn)
  })

  test('cuts a long paragraph at sentence ends', async () => {
    const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} is here and runs on a while.`).join(' ')
    const parts = split(long)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every(p => p.source.length <= 260)).toBe(true)
  })
})

test('the latest reply joins the texts written since the last prompt', async () => {
  const text = replies([
    { role: 'user', text: 'old' },
    { role: 'assistant', text: 'old answer' },
    { role: 'user', text: 'new question' },
    { role: 'assistant', text: 'Looking.' },
    { role: 'user', text: '', toolResults: [{}] },
    { role: 'assistant', text: 'Found it.' },
  ]).at(-1)?.text
  expect(text).toBe('Looking.\n\nFound it.')
})

test('a narration must give one string per part', async () => {
  const blocks = split('a\n\nb')
  expect(parseSpoken('Sure: ["A.", "B."]', blocks)).toEqual(['A.', 'B.'])
  expect(parseSpoken('["only one"]', blocks)).toBeUndefined()
})

test('the pane says what to do before anything is loaded', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ml-voice', surface, component: 'Pane', requestId: 'ml-voice',
      props: { title: 'Voice', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 30 } as never, view: {} },
    })
    expect(await ui.find({ type: 'Text', text: /Run \/ml-voice:read/ })).toBeDefined()
    await ui.unmount()
  }
})

test('replies group the texts between prompts, oldest first', async () => {
  const all = replies([
    { role: 'user', text: 'first question' },
    { role: 'assistant', text: 'First answer.' },
    { role: 'user', text: 'second question' },
    { role: 'assistant', text: 'Looking.' },
    { role: 'user', text: '', toolResults: [{}] },
    { role: 'assistant', text: 'Found it.' },
    { role: 'user', text: '/ml-voice:read' },
  ])
  expect(all).toEqual([
    { prompt: 'first question', text: 'First answer.' },
    { prompt: 'second question', text: 'Looking.\n\nFound it.' },
  ])
})
