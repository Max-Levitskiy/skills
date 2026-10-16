// The run line and the live view (docs/spec.md, p.24). The mod sees Claude follow a run, polls the
// helper's `line` and `view` once a second while either shows, and draws what they print; the
// helper works out every word and drawing.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, UiOpenResult } from 'claude-code'

import type { FileLine, Followed, LiveView, RunLine, Span } from '../types'

const HERE = '#ffd43b'
const TAKEN = '#e8590c'
const POLL_MS = 1000
// The run line's fixed parts: `needs you` with the two spaces after it, and ` [ view ]`.
const NEEDS_YOU = 'needs you'
const BUTTON_COLUMNS = 9

// `claude plugin validate` holds each `$.state` reference to the contract by its literal plugin and key.
const followed = atom({ plugin: 'ml-workflow', key: 'followed' } as const, [] as Followed[])
const views = atom({ plugin: 'ml-workflow', key: 'views' } as const, {} as Record<string, LiveView>)
const pictures = atom({ plugin: 'ml-workflow', key: 'pictures' } as const, null as boolean | null)
const full = atom({ plugin: 'ml-workflow', key: 'full' } as const, [] as string[])
const polling = atom({ plugin: 'ml-workflow', key: 'polling' } as const, false)

// The open views, by run, with the database each was opened with, and the ended runs whose open
// view already has its last picture. The module's own: a reload drops the panes too.
const open = new Map<string, string | null>()
const settled = new Set<string>()
let timer: { cancel: () => void } | null = null
let isTicking = false

const STYLE: Record<Span['style'], Record<string, unknown>> = {
  node: {},
  here: { bold: true, color: 'black', backgroundColor: HERE },
  edge: { dimColor: true },
  taken: { bold: true, color: TAKEN },
  label: { dimColor: true, italic: true },
  'taken-label': { bold: true, italic: true, color: TAKEN },
}

const paneOf = (runId: string) => `run-${runId}`

/** A run ID as spore gives it, `run_…`. */
export const RUN_ID = /^[A-Za-z0-9_-]{1,60}$/

/** What an open of the view says, and for one that waits undrawn the keys that show it. */
export function viewed(runId: string, result: UiOpenResult, show = `Type /ml-workflow:view ${runId} and press Enter to show it.`): string {
  if (result.isPlaced) return `The live view of ${runId} is open.`
  return `The live view of ${runId} is open but not shown yet: ${result.reason}. ${show}`
}

/** `spore continue <runId> --wait`, and the `--db` after it, in a Bash command: the run it follows. */
export function following(command: string): { runId: string; db: string | null } | null {
  const match = /\bspore\s+continue\s+(['"]?)([A-Za-z0-9_-]+)\1\s+--wait\b([^;&|\n]*)/.exec(command)
  if (!match) return null
  const db = /--db\s+(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(match[3] ?? '')
  return { runId: match[2]!, db: db ? (db[1] ?? db[2] ?? db[3])! : null }
}

async function helperJson($: EngineInterface, args: string[]): Promise<any> {
  try {
    const { stdout } = await $.process.run([`${$.plugin.root}/bin/claude-spore`, ...args, '--json'], { timeoutMs: 8000 })
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

const dbArgs = (db: string | null) => (db ? ['--db', db] : [])

async function follow($: EngineInterface, runId: string, db: string | null) {
  await update($, followed, list => {
    const known = list.find(run => run.runId === runId)
    return [{ runId, db, line: known?.line ?? null }, ...list.filter(run => run.runId !== runId)]
  })
  await tick($)
}

/**
 * Opens the run's live view; rejects when the engine refuses the open. The pane opens first, before
 * anything awaits, so a press or a typed command places it at any width; it reads the run after.
 */
export async function openView($: EngineInterface, runId: string, db: string | null, title = runId): Promise<UiOpenResult> {
  const opening = $.ui.open({ id: paneOf(runId), title, focus: true, closeOnEscape: true })
  open.set(runId, db)
  settled.delete(runId)
  let result: UiOpenResult
  try {
    result = await opening
  } catch (error) {
    open.delete(runId)
    throw error
  }
  const view: LiveView = (await helperJson($, ['view', runId, ...dbArgs(db)])) ?? { runId, db, error: { code: 'helper', message: 'claude-spore view gave no answer' } }
  await update($, views, all => ({ ...all, [runId]: view }))
  reveal($, runId)
  await poll($)
  if (view.picture && (await read($, pictures)) === null) $.clock.after(500, () => void checkPictures($, runId))
  return result
}

// The picture check: blit the drawn picture to itself. Claude Code refuses, saying the Image draws
// its alt, where the terminal shows no pictures; the session then draws dots.
async function checkPictures($: EngineInterface, runId: string) {
  const picture = (await read($, views))[runId]?.picture
  if (!picture || (await read($, pictures)) !== null) return
  try {
    const { deny } = await $.ui.blit({ requestId: paneOf(runId), key: 'picture', source: { file: picture.file, format: 'png', generation: 1 } })
    if (!deny) await update($, pictures, () => true)
    else if (/\balt\b/.test(deny)) await update($, pictures, () => false)
  } catch {}
}

// The timer runs while a run line or a view shows, and is cancelled when neither does. A reload
// cancels the module's timers and keeps the session's state, so either one missing starts it.
async function poll($: EngineInterface) {
  if (timer && (await read($, polling))) return
  timer?.cancel()
  timer = $.clock.every(POLL_MS, () => void tick($))
  await update($, polling, () => true)
}

async function tick($: EngineInterface) {
  if (isTicking) return
  isTicking = true
  try {
    const runs = new Map<string, string | null>()
    for (const run of await read($, followed)) runs.set(run.runId, run.db)
    for (const [runId, db] of open) if (!settled.has(runId) && !runs.has(runId)) runs.set(runId, db)
    for (const [runId, db] of runs) await refresh($, runId, db)
  } finally {
    isTicking = false
  }
  const shown = (await read($, followed)).length > 0 || [...open.keys()].some(runId => !settled.has(runId))
  if (shown) await poll($)
  else {
    timer?.cancel()
    timer = null
    await update($, polling, () => false)
  }
}

async function refresh($: EngineInterface, runId: string, db: string | null) {
  const answer = await helperJson($, ['line', runId, ...dbArgs(db)])
  if (!answer) return
  const gone = answer.error?.code === 'run.not-found'
  if (answer.error && !gone) return
  const line = gone ? null : (answer as RunLine)
  const before = (await read($, followed)).find(run => run.runId === runId)?.line
  const isChanged = JSON.stringify(before ?? null) !== JSON.stringify(line)
  if (gone || line?.ended) await update($, followed, list => list.filter(run => run.runId !== runId))
  else if (isChanged) await update($, followed, list => list.map(run => (run.runId === runId ? { ...run, line } : run)))
  if (!open.has(runId) || gone) return
  const shownLine = (await read($, views))[runId]?.line
  if (JSON.stringify(shownLine ?? null) !== JSON.stringify(line)) {
    const view = await helperJson($, ['view', runId, ...dbArgs(db)])
    if (view && !view.error) {
      await update($, views, all => ({ ...all, [runId]: view }))
      reveal($, runId)
    }
  }
  if (line?.ended) settled.add(runId)
}

// The keys that show a view that waits when its run line is the newest: a press is the person's ask,
// which places a pane at any width. ctrl+x tab gives the band the keys, and `v` is that line's view button.
async function keysOnBand($: EngineInterface, runId: string): Promise<string | undefined> {
  const newest = (await read($, followed)).find(run => run.line)
  return newest?.runId === runId ? 'Press ctrl+x tab, then v, to show it.' : undefined
}

// Keeps the current node in view once the pane drew the moment: the drawing's row of it, else the
// picture. A node already showing does not move the window.
function reveal($: EngineInterface, runId: string) {
  $.clock.after(0, async () => {
    for (const key of ['here', 'picture']) {
      try {
        if (!(await $.ui.scroll({ in: paneOf(runId), to: { key }, block: 'nearest' })).deny) return
      } catch {}
    }
  })
}

// Registered from the plugin's one session.start handler (register.ts): the engine takes one per event.
export async function registerViewTool($: EngineInterface): Promise<void> {
  await $.tool
    .register({
      name: 'open_view',
      description: "Opens a Runspore run's live view in a pane: its workflow drawn with the current node and the arrow just taken, and the lines of its files. /ml-workflow:view calls it.",
      inputSchema: {
        type: 'object',
        properties: { runId: { type: 'string', description: 'The run ID, run_…' }, db: { type: 'string', description: 'The database path spore gave as db' } },
        required: ['runId'],
      },
    })
    .catch(error => $.ui.log(`ml-workflow: the open_view tool was not registered: ${String(error)}`))
}

export function registerLive(on: On) {
  // Claude following a run shows its line; the call itself goes on unchanged.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const run = following(String((e as { command?: unknown }).command ?? ''))
    if (run) $.clock.after(0, () => void follow($, run.runId, run.db))
    return next(e)
  })

  on('tool.call', { tool: 'mcp__ml-workflow__open_view' }, async ($, e) => {
    const { runId, db } = e as { runId?: unknown; db?: unknown }
    if (typeof runId !== 'string' || !RUN_ID.test(runId)) return { result: 'open_view needs a runId, the run_… ID spore gave.' }
    try {
      const result = await openView($, runId, typeof db === 'string' && db ? db : null)
      return { result: viewed(runId, result, result.isPlaced ? undefined : await keysOnBand($, runId)) }
    } catch (error) {
      return { result: `The live view could not open: ${String(error)}` }
    }
  })

  on('ui.close', async ($, e, next) => {
    const runId = e.id.startsWith('run-') ? e.id.slice(4) : null
    const done = await next(e)
    if (runId && open.has(runId)) {
      open.delete(runId)
      settled.delete(runId)
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const runs = (await read($, followed)).filter(run => run.line)
    if (!runs.length) return next(e)
    const ui = $.ui.resolve(e)
    // `needs you` and the button keep their width; the line takes the rest, in the longest of the
    // helper's forms that fits, cut at its end only past the shortest.
    const rows = runs.map((run, i) => {
      const line = run.line!
      const room = e.props.bodyColumns - BUTTON_COLUMNS - (line.needsYou ? NEEDS_YOU.length + 2 : 0)
      const forms = [line.text, ...(line.shorter ?? [])]
      return h(
        ui.Box,
        { key: run.runId, flexDirection: 'row' },
        ...(line.needsYou ? [h(ui.Box, { flexShrink: 0 }, h(ui.Text, { bold: true, color: TAKEN }, NEEDS_YOU), h(ui.Text, {}, '  '))] : []),
        h(ui.Text, { wrap: 'truncate-end' }, forms.find(text => text.length <= room) ?? forms.at(-1)!),
        h(
          ui.Box,
          { flexShrink: 0 },
          h(ui.Text, {}, ' '),
          h(ui.Button, { key: `view:${run.runId}`, label: 'view', ...(i === 0 ? { hotkey: 'v' } : {}), onPress: () => void openView($, run.runId, run.db, line.name).catch(() => undefined) }),
        ),
      )
    })
    return h(ui.Box, { flexDirection: 'column' }, ...rows) as RenderElement
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (!e.requestId?.startsWith('run-')) return next(e)
    const runId = e.requestId.slice(4)
    const ui = $.ui.resolve(e) as Record<string, any>
    const view = (await read($, views))[runId]
    if (!view) return h(ui.Text, { dimColor: true }, 'Reading the run…') as RenderElement
    if (view.error) return h(ui.Text, { dimColor: true }, `The run could not be read: ${view.error.code}: ${view.error.message}`) as RenderElement
    const columns = e.props.bodyColumns
    const isWide = columns >= 150
    const facts = h(ui.Text, {}, h(ui.Text, { bold: true }, view.facts ?? ''), ...(view.line?.needsYou ? [h(ui.Text, { bold: true, color: TAKEN }, ', needs you')] : []))
    const width = Math.min(100, Math.max(10, (isWide ? Math.floor(columns / 2) : columns) - 2))
    // The drawing fits the pane's rows less the facts line and the one under it.
    const room = Math.max(3, e.props.scroll.bodyRows - 2)
    const usePicture = view.picture && 'Image' in ui && (await read($, pictures)) !== false
    let drawing: ReturnType<typeof h>
    if (usePicture) {
      // A cell is about twice as tall as wide; a picture taller than the room is drawn narrower.
      const rowsPerColumn = view.picture!.height / view.picture!.width / 2
      const size = Math.round(width * rowsPerColumn) <= room ? { columns: width, rows: Math.round(width * rowsPerColumn) } : { columns: Math.round(room / rowsPerColumn), rows: room }
      drawing = h(ui.Image, {
        key: 'picture',
        source: { file: view.picture!.file, format: 'png' },
        columns: Math.max(1, size.columns),
        rows: Math.min(255, Math.max(1, size.rows)),
        alt: `The workflow at ${view.line?.text ?? runId}`,
      })
    } else {
      // The dot drawing when it fits, else the compact tree, which wraps rather than cuts.
      const dots = view.dots ?? []
      const isFit = dots.length <= room && dots.every(row => row.reduce((n, span) => n + [...span.text].length, 0) <= width)
      const isTree = !isFit && Boolean(view.tree?.length)
      const rows = isTree ? view.tree! : dots
      // The row `reveal` scrolls to: the middle one of the current node's, its label's in a box.
      // A Text carries no key, so that row sits in a Box keyed `here`.
      const hereRows = rows.flatMap((row, i) => (row.some(span => span.style === 'here') ? [i] : []))
      const hereRow = hereRows[Math.floor(hereRows.length / 2)]
      drawing = h(
        ui.Box,
        { flexDirection: 'column', flexShrink: 0 },
        ...rows.map((row, i) => {
          const text = h(ui.Text, { wrap: isTree ? 'wrap' : 'truncate-end' }, ...row.map(span => h(ui.Text, STYLE[span.style], span.text)))
          return i === hereRow ? h(ui.Box, { key: 'here' }, text) : text
        }),
      )
    }
    const isFull = (await read($, full)).includes(runId)
    const instructions = view.instructions
      ? h(
          ui.Box,
          { flexDirection: 'column', marginTop: 1 },
          h(ui.Text, { underline: true }, view.instructions.file),
          ...(isFull ? view.instructions.text.split('\n') : view.instructions.head).map(text => h(ui.Text, { dimColor: !isFull }, text || ' ')),
          h(ui.Button, {
            key: 'more',
            label: isFull ? 'less' : 'more',
            hotkey: 'm',
            onPress: () => void update($, full, list => (list.includes(runId) ? list.filter(id => id !== runId) : [...list, runId])),
          }),
        )
      : null
    const files = h(
      ui.Box,
      { flexDirection: 'column', flexGrow: 1, flexShrink: 1 },
      fileBlock(ui, 'workflow.dot', view.dot ?? []),
      ...(view.settings?.length ? [fileBlock(ui, 'settings.json', view.settings)] : []),
      ...(instructions ? [instructions] : []),
    )
    const body = isWide ? h(ui.Box, { flexDirection: 'row', gap: 3 }, drawing, files) : h(ui.Box, { flexDirection: 'column' }, drawing, files)
    return h(ui.Box, { flexDirection: 'column' }, facts, h(ui.Box, { marginTop: 1 }, body)) as RenderElement
  })
}

function fileBlock(ui: Record<string, any>, file: string, lines: FileLine[]) {
  return h(
    ui.Box,
    { flexDirection: 'column', marginTop: 1 },
    h(ui.Text, { underline: true }, file),
    ...lines.map(({ n, text, mark }) =>
      h(ui.Text, { wrap: 'wrap', ...(mark === 'here' ? STYLE.here : mark === 'taken' ? STYLE.taken : {}) }, `${String(n).padStart(3)}  ${text || ' '}`),
    ),
  )
}
