// The run line and the live view (docs/spec.md, p.24). The mod sees Claude follow a run, polls the
// helper's `line` and `view` once a second while either shows, and draws what they print; the
// helper works out every word and drawing.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, UiOpenResult } from 'claude-code'

import type { FileLine, Followed, LiveView, RunLine, Span } from '../types'

const HERE = '#ffd43b'
const TAKEN = '#e8590c'
const POLL_MS = 1000

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

/** Opens the run's live view; rejects when the engine refuses the open. */
export async function openView($: EngineInterface, runId: string, db: string | null): Promise<UiOpenResult> {
  open.set(runId, db)
  settled.delete(runId)
  const view: LiveView = (await helperJson($, ['view', runId, ...dbArgs(db)])) ?? { runId, db, error: { code: 'helper', message: 'claude-spore view gave no answer' } }
  await update($, views, all => ({ ...all, [runId]: view }))
  const result = await $.ui.open({ id: paneOf(runId), title: view.line?.name ?? runId, focus: true, closeOnEscape: true })
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
    if (view && !view.error) await update($, views, all => ({ ...all, [runId]: view }))
  }
  if (line?.ended) settled.add(runId)
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
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(runId)) return { result: 'open_view needs a runId, the run_… ID spore gave.' }
    try {
      const result = await openView($, runId, typeof db === 'string' && db ? db : null)
      return { result: result.isPlaced ? `The live view of ${runId} is open.` : `The live view of ${runId} is open but not shown yet: ${result.reason}` }
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
    const rows = runs.map((run, i) =>
      h(
        ui.Box,
        { key: run.runId, flexDirection: 'row' },
        h(ui.Text, { wrap: 'truncate-end' }, run.line!.text),
        ...(run.line!.needsYou ? [h(ui.Text, { bold: true, color: TAKEN }, ' needs you')] : []),
        h(ui.Text, {}, ' '),
        h(ui.Button, { key: `view:${run.runId}`, label: 'view', ...(i === 0 ? { hotkey: 'v' } : {}), onPress: () => void openView($, run.runId, run.db) }),
      ),
    )
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
    const usePicture = view.picture && 'Image' in ui && (await read($, pictures)) !== false
    const drawing = usePicture
      ? h(ui.Image, {
          key: 'picture',
          source: { file: view.picture!.file, format: 'png' },
          columns: width,
          rows: Math.min(255, Math.max(1, Math.round((width * view.picture!.height) / view.picture!.width / 2))),
          alt: `The workflow at ${view.line?.text ?? runId}`,
        })
      : h(ui.Box, { flexDirection: 'column' }, ...(view.dots ?? []).map(row => h(ui.Text, { wrap: 'truncate-end' }, ...row.map(span => h(ui.Text, STYLE[span.style], span.text)))))
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
      { flexDirection: 'column', flexGrow: 1 },
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
      h(ui.Text, { wrap: 'truncate-end', ...(mark === 'here' ? STYLE.here : mark === 'taken' ? STYLE.taken : {}) }, `${String(n).padStart(3)}  ${text || ' '}`),
    ),
  )
}
