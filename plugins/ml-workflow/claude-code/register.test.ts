import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { PLUGIN_VERSION } from '../src/version'

// Seam 2 (docs/spec.md, Testing): the mod registers and passes through; no logic is tested here.

type Ran = { exitCode: number; stdout: string; stderr: string }
// A helper that does not start is `{ deny }`: the engine's refusal, which rejects the mod's call with
// that reason. A hook that throws is skipped instead, so its message never reaches the mod.
type Answer = Ran | { deny: string }
type Opened = { value: { isPlaced: true } | { isPlaced: false; reason: string } } | { deny: string }
type World = {
  version: { version: string; base?: string }
  logs: string[]
  runs: string[][]
  doctor: Answer
  unfinished: Answer
  menu: Answer
  open: Opened
  opens: string[]
  closes: string[]
  commands: string[][]
  tools: string[]
  // `claude-spore line` and `view` by run ID, and what the picture check's blit is answered.
  line: Record<string, Answer>
  view: Record<string, Answer>
  blit: { deny?: string }
  blits: string[]
  // The opens and the helper's runs in the order they came: an open the person asked for comes first.
  order: string[]
}

const FINE = JSON.stringify({ ok: true, spore: { path: '/bin/spore', version: '0.4.0' }, problems: [], launcher: 'offer' })
const MISSING = 'ml-workflow needs spore 0.4.0 or later, and none is on PATH. Install it with: claude-spore install-spore'
const RELOAD = `ml-workflow changed since this session loaded it (helper 9.9.9, session ${PLUGIN_VERSION}). Run /reload-plugins, then try again.`
const PROBLEMS = JSON.stringify({
  ok: false,
  spore: null,
  problems: [
    { code: 'plugin.reload', message: RELOAD, fix: null },
    { code: 'spore.missing', message: MISSING, fix: 'claude-spore install-spore' },
  ],
  launcher: 'offer',
})

const NONE: Ran = { exitCode: 0, stdout: JSON.stringify({ db: '/repo/.spore/runspore.db', lines: [] }), stderr: '' }

// Everything beneath the plugin: the engine's own answers, and the helper.
function world(on: On, version: World['version'], doctor: Answer = { exitCode: 0, stdout: FINE, stderr: '' }, unfinished: Answer = NONE): World {
  const w: World = {
    version,
    logs: [],
    runs: [],
    doctor,
    unfinished,
    menu: MENU,
    open: { value: { isPlaced: true } },
    opens: [],
    closes: [],
    commands: [],
    tools: [],
    line: {},
    view: {},
    blit: {},
    blits: [],
    order: [],
  }
  on('session.version', () => ({ value: w.version }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    const [command, runId = ''] = e.argv.slice(1)
    w.order.push(`run ${command}`)
    const missing: Ran = { exitCode: 1, stdout: '', stderr: '' }
    const answer =
      command === 'unfinished' ? w.unfinished : command === 'menu' ? w.menu : command === 'line' ? (w.line[runId] ?? missing) : command === 'view' ? (w.view[runId] ?? missing) : w.doctor
    if ('deny' in answer) return { deny: answer.deny }
    return { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.blit', ($, e) => {
    w.blits.push(`${e.requestId}/${e.key}`)
    return { value: w.blit }
  })
  // The live view keeps its current node in view; no surface here moves a window.
  on('ui.scroll', () => ({}))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  // The engine's own band, empty: what the mod's band passes to when no run line shows.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
    w.order.push(`open ${e.id}`)
    return w.open
  })
  on('ui.close', ($, e) => {
    w.closes.push(e.id)
    return { value: undefined }
  })
  on('command.run', ($, e) => {
    w.commands.push([e.command, e.args])
    return { text: '' }
  })
  on('tool.register', ($, e) => {
    w.tools.push(e.name)
    return { value: { tool: `mcp__ml-workflow__${e.name}` } }
  })
  return w
}

const ROWS = [
  {
    key: 'run:run_a',
    label: 'coding-loop-11111111 at approve, waiting for your decision for 2 h',
    options: [
      { label: 'Decide', command: 'ml-workflow:act', args: 'run_a decide' },
      { label: 'View', command: 'ml-workflow:status', args: 'run_a' },
      { label: 'Cancel', command: 'ml-workflow:cancel', args: 'run_a' },
    ],
  },
  { key: 'author', label: 'Write or change a workflow', options: [{ label: 'Write a new workflow', command: 'ml-workflow:author', args: '' }] },
]
const MENU: Ran = { exitCode: 0, stdout: JSON.stringify({ db: '/repo/.spore/runspore.db', rows: ROWS }), stderr: '' }

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const
const NEW = { version: '2.1.296', base: '2.1.296' }

test('on a new enough Claude Code the session starts with nothing shown', async ($, on) => {
  const w = world(on, NEW)
  expect(await $.session.start(START)).toEqual({ cwd: '/repo' })
  expect(w.logs).toEqual([])
})

test('on Claude Code 2.1.290 itself nothing is shown', async ($, on) => {
  const w = world(on, { version: '2.1.290', base: '2.1.290' })
  await $.session.start(START)
  expect(w.logs).toEqual([])
})

test('on an older Claude Code one line names the minimum and claude update', async ($, on) => {
  const w = world(on, { version: '2.1.289', base: '2.1.289' })
  expect(await $.session.start(START)).toEqual({ cwd: '/repo' })
  expect(w.logs).toEqual(['ml-workflow needs Claude Code 2.1.290 or later; this is 2.1.289. Run: claude update'])
})

test('a development build is judged by its release', async ($, on) => {
  const w = world(on, { version: '2.1.280-dev.20260920.t101500.sha1a2b3c4', base: '2.1.280-dev' })
  await $.session.start(START)
  expect(w.logs).toEqual(['ml-workflow needs Claude Code 2.1.290 or later; this is 2.1.280-dev.20260920.t101500.sha1a2b3c4. Run: claude update'])
})

test('a version that is not spelled as a release is let through', async ($, on) => {
  const w = world(on, { version: 'local' })
  await $.session.start(START)
  expect(w.logs).toEqual([])
})

test('session start runs the doctor with the version the session loaded, and asks for the unfinished runs', async ($, on) => {
  const w = world(on, NEW)
  await $.session.start(START)
  expect(w.runs).toHaveLength(2)
  for (const argv of w.runs) expect(argv[0]!.endsWith('/bin/claude-spore')).toBe(true)
  expect(w.runs.map(argv => argv.slice(1))).toEqual([
    ['doctor', '--json', '--plugin-version', PLUGIN_VERSION],
    ['unfinished', '--json'],
  ])
})

test("session start writes each of the doctor's problems as one line", async ($, on) => {
  const w = world(on, NEW, { exitCode: 1, stdout: PROBLEMS, stderr: '' })
  await $.session.start(START)
  expect(w.logs).toEqual([RELOAD, MISSING])
})

test('a helper that cannot start for want of Bun shows the Bun line', async ($, on) => {
  const w = world(on, NEW, { exitCode: 127, stdout: '', stderr: 'env: bun: No such file or directory\n' })
  await $.session.start(START)
  expect(w.logs).toEqual(['ml-workflow needs Bun 1.2.0 or later, and none is on PATH. Install it with: curl -fsSL https://bun.sh/install | bash'])
})

test("an old Bun's refusal is passed through as its first line", async ($, on) => {
  const stderr = 'claude-spore needs Bun 1.2.0 or later; this is Bun 1.1.38. Update it with: bun upgrade\n'
  const w = world(on, NEW, { exitCode: 2, stdout: '', stderr })
  await $.session.start(START)
  expect(w.logs).toEqual(['claude-spore needs Bun 1.2.0 or later; this is Bun 1.1.38. Update it with: bun upgrade'])
})

test('a helper that is gone asks for /reload-plugins', async ($, on) => {
  const w = world(on, NEW, { deny: 'ENOENT: no such file or directory, posix_spawn' })
  await $.session.start(START)
  expect(w.logs).toEqual(['ml-workflow changed since this session loaded it. Run /reload-plugins, then try again.'])
})

test('a helper that times out shows nothing', async ($, on) => {
  const w = world(on, NEW, { deny: 'timed out after 8000ms' })
  await $.session.start(START)
  expect(w.logs).toEqual([])
})

const DECISION = 'coding-loop-11111111 at approve, waiting for your decision for 2 h'
const RUN = 'coding-loop-0238a2a3 at implement, attempt 2 of 3, paused 14 min ago'
const HINT = '/ml-workflow:menu to pick them up'
const TWO: Ran = { exitCode: 0, stdout: JSON.stringify({ db: '/repo/.spore/runspore.db', lines: [DECISION, RUN, HINT] }), stderr: '' }

test("session start writes the helper's lines as they came: one per unfinished run, then the hint", async ($, on) => {
  const w = world(on, NEW, undefined, TWO)
  expect(await $.session.start(START)).toEqual({ cwd: '/repo' })
  expect(w.logs).toEqual([DECISION, RUN, HINT])
})

test("the doctor's problems come before the runs", async ($, on) => {
  const w = world(on, NEW, { exitCode: 1, stdout: PROBLEMS, stderr: '' }, TWO)
  await $.session.start(START)
  expect(w.logs).toEqual([RELOAD, MISSING, DECISION, RUN, HINT])
})

test('runs that cannot be listed show nothing', async ($, on) => {
  const failed = world(on, NEW, undefined, { exitCode: 1, stdout: JSON.stringify({ db: null, lines: [] }), stderr: '' })
  await $.session.start(START)
  expect(failed.logs).toEqual([])
})

test('a helper that does not answer with JSON, or times out, shows no run', async ($, on) => {
  const garbled = world(on, NEW, undefined, { exitCode: 0, stdout: 'not json', stderr: '' })
  await $.session.start(START)
  garbled.unfinished = { deny: 'timed out after 9000ms' }
  await $.session.start(START)
  expect(garbled.logs).toEqual([])
})

test('a session with nobody at the prompt does not ask for the runs', async ($, on) => {
  const w = world(on, NEW, undefined, TWO)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect(w.logs).toEqual([])
  expect(w.runs.map(argv => argv[1])).toEqual(['doctor'])
})

test('on an older Claude Code the runs are not asked for', async ($, on) => {
  const w = world(on, { version: '2.1.289', base: '2.1.289' }, undefined, TWO)
  await $.session.start(START)
  expect(w.runs).toEqual([])
})

test("the start skill gets the doctor's JSON above its text", async ($, on) => {
  const w = world(on, NEW, { exitCode: 1, stdout: `${PROBLEMS}\n`, stderr: '' })
  const { text } = await $.skill.prompt({ skill: 'ml-workflow:start', text: 'START BODY' })
  expect(text).toBe(
    [
      '<claude-spore-doctor>',
      '`claude-spore doctor --json` already ran for this start. Use this output instead of running it; run it again only after a fix.',
      PROBLEMS,
      '</claude-spore-doctor>',
      '',
      'START BODY',
    ].join('\n'),
  )
  expect(w.runs).toHaveLength(1)
})

test('other skills go through untouched, and run nothing', async ($, on) => {
  const w = world(on, NEW)
  expect((await $.skill.prompt({ skill: 'ml-workflow:status', text: 'STATUS' })).text).toBe('STATUS')
  expect((await $.skill.prompt({ skill: 'start', text: 'OTHER' })).text).toBe('OTHER')
  expect(w.runs).toEqual([])
})

test('a start whose helper does not answer with JSON goes through for the skill to check', async ($, on) => {
  world(on, NEW, { exitCode: 127, stdout: '', stderr: 'env: bun: No such file or directory\n' })
  expect((await $.skill.prompt({ skill: 'ml-workflow:start', text: 'START BODY' })).text).toBe('START BODY')
})

// The menu (docs/spec.md, p.11).
const OPEN = 'The workflow menu is open.'
// A pane's props, whole, as the engine hands them to a pane seated above the prompt.
const paneProps = (title: string, bodyColumns: number) => ({ title, isFocused: true, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} }) as const
const PANE = { plugin: 'ml-workflow', component: 'Pane', requestId: 'ml-workflow-menu', props: paneProps('Workflows', 80) } as const

const MENU_COMMAND = { command: 'ml-workflow:menu', args: '' } as const

// A session starts before anything is typed, and the mod keeps what it found of the version; what
// the start ran is left out of the world.
async function started($: { session: { start: (e: typeof START) => Promise<unknown> } }, w: World) {
  await $.session.start(START)
  w.runs = []
  w.order = []
  w.logs = []
}

test('typed, the menu command opens the pane before it runs the helper, and the skill does not run', async ($, on) => {
  const w = world(on, NEW)
  await started($, w)
  expect((await $.command.run(MENU_COMMAND)).text).toBe(OPEN)
  expect(w.order).toEqual(['open ml-workflow-menu', 'run menu'])
  expect(w.runs.map(argv => argv.slice(1))).toEqual([['menu', '--json']])
  expect(w.runs[0]![0]!.endsWith('/bin/claude-spore')).toBe(true)
  expect(w.commands).toEqual([])
})

test('a pane that waits undrawn says why, and the keys that show it', async ($, on) => {
  const w = world(on, NEW)
  await started($, w)
  w.open = { value: { isPlaced: false, reason: 'the terminal is 90 columns wide' } }
  expect((await $.command.run(MENU_COMMAND)).text).toBe(
    'The workflow menu is open but not shown yet: the terminal is 90 columns wide. Type /ml-workflow:menu and press Enter to show it.',
  )
})

test('an open the engine refuses runs the skill, which calls open_menu', async ($, on) => {
  const w = world(on, NEW)
  await started($, w)
  w.open = { deny: 'no pane from here' }
  await $.command.run(MENU_COMMAND)
  expect(w.commands).toEqual([['ml-workflow:menu', '']])
})

test('on an older Claude Code the menu skill runs, and nothing opens', async ($, on) => {
  const w = world(on, { version: '2.1.289', base: '2.1.289' })
  await $.session.start(START)
  await $.command.run(MENU_COMMAND)
  expect(w.commands).toEqual([['ml-workflow:menu', '']])
  expect(w.opens).toEqual([])
})

test("the menu skill's text goes through untouched", async ($, on) => {
  const w = world(on, NEW)
  expect((await $.skill.prompt({ skill: 'ml-workflow:menu', text: 'MENU BODY' })).text).toBe('MENU BODY')
  expect(w.opens).toEqual([])
})

test('session start registers the open_menu and open_view tools', async ($, on) => {
  const w = world(on, NEW)
  await $.session.start(START)
  expect([...w.tools].sort()).toEqual(['open_menu', 'open_view'])
})

test('the open_menu tool opens the same pane', async ($, on) => {
  const w = world(on, NEW)
  const answer = await $.tool.call({ tool: 'mcp__ml-workflow__open_menu' })
  expect(answer.result).toBe(OPEN)
  expect(w.runs.map(argv => argv.slice(1))).toEqual([['menu', '--json']])
  expect(w.opens).toEqual(['ml-workflow-menu'])
})

test('an open_menu that waits undrawn names the command that shows the menu', async ($, on) => {
  const w = world(on, NEW)
  w.open = { value: { isPlaced: false, reason: 'unasked below 144 columns (120 now)' } }
  const answer = await $.tool.call({ tool: 'mcp__ml-workflow__open_menu' })
  expect(answer.result).toBe('The workflow menu is open but not shown yet: unasked below 144 columns (120 now). Type /ml-workflow:menu and press Enter to show it.')
})

test("the pane draws one Select per row with the helper's labels; a pick closes it and runs the option's command", async ($, on) => {
  const w = world(on, NEW)
  await started($, w)
  await $.command.run(MENU_COMMAND)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Select' })).map(select => select.key)).toEqual(['run:run_a', 'author'])
  const run = await ui.find({ key: 'run:run_a' })
  expect(run?.props.label).toBe(ROWS[0]!.label)
  // Each row shows its first option, so none ends in an empty value.
  expect((await ui.findAll({ type: 'Select' })).map(select => select.props.value)).toEqual(['0', '0'])
  expect(run?.props.options).toEqual([
    { value: '0', label: 'Decide' },
    { value: '1', label: 'View' },
    { value: '2', label: 'Cancel' },
  ])
  await ui.select({ key: 'run:run_a', value: '0' })
  expect(w.closes).toEqual(['ml-workflow-menu'])
  expect(w.commands).toEqual([['ml-workflow:act', 'run_a decide']])
  await ui.select({ key: 'author', value: '0' })
  expect(w.commands.at(-1)).toEqual(['ml-workflow:author', ''])
  await ui.unmount()
})

test('a helper that gives no rows leaves its first error line in the pane', async ($, on) => {
  const w = world(on, NEW)
  await started($, w)
  w.menu = { exitCode: 2, stdout: '', stderr: 'claude-spore: unknown command "menu"\n' }
  expect((await $.command.run(MENU_COMMAND)).text).toBe(OPEN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('The menu could not be built: claude-spore: unknown command "menu"')
  await ui.unmount()
})

// The run line and the live view (docs/spec.md, p.24).
const DB = '/repo/.spore/runspore.db'
const FOLLOW = `spore continue run_a --wait --json --db ${DB}`
const BAND = {
  plugin: 'ml-workflow',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const
const VIEW_PANE = { plugin: 'ml-workflow', component: 'Pane', requestId: 'run-run_a', props: paneProps('coding-loop-0238a2a3', 100) } as const

function lineOf(text: string, fields: { shorter?: string[]; needsYou?: boolean; ended?: boolean } = {}): Ran {
  const line = { runId: 'run_a', db: DB, name: 'coding-loop-0238a2a3', text, needsYou: false, ended: false, ...fields }
  return { exitCode: 0, stdout: JSON.stringify(line), stderr: '' }
}

const RUNNING = 'coding-loop-0238a2a3 at implement, visit 3, from test on red, try 1/3, red 2/3 in a row'
const LIVE = {
  runId: 'run_a',
  db: DB,
  line: JSON.parse(lineOf(RUNNING).stdout),
  facts: 'running, at implement, visit 3, try 1/3, red 2/3 in a row',
  picture: { file: '/data/artifacts/ab/implement@test.red.png', width: 760, height: 840 },
  dots: [[{ text: '╭─────────╮', style: 'here' }], [{ text: '│ implement │', style: 'here' }, { text: '  red ×3', style: 'taken-label' }]],
  tree: [
    [{ text: 'Run the tests', style: 'node' }],
    [{ text: '└─▶ ', style: 'edge' }, { text: 'Implement (Claude)', style: 'here' }],
  ],
  dot: [
    { n: 1, text: 'digraph "coding-loop" {', mark: null },
    { n: 2, text: '  implement [label="Implement (Claude)"];', mark: 'here' },
    { n: 3, text: '  test -> implement [on="red"];', mark: 'taken' },
  ],
  settings: [{ n: 24, text: '    "implement": {', mark: 'here' }],
  instructions: { file: 'steps/implement.md', head: ['You are the implement step.', 'Your input has three parts:', '- `task`'], text: 'You are the implement step.\n\nYour input has three parts:\n\n- `task`\n- `cameFrom`\n' },
}
const VIEWED: Ran = { exitCode: 0, stdout: JSON.stringify(LIVE), stderr: '' }

const lineCalls = (w: World) => w.runs.filter(argv => argv[1] === 'line')

test('a Bash call following a run shows its line above the prompt, with the view button', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  w.line.run_a = lineOf(RUNNING)
  await $.tool.call({ tool: 'Bash', command: FOLLOW })
  await clock.settle()
  expect(lineCalls(w).map(argv => argv.slice(1))).toEqual([['line', 'run_a', '--db', DB, '--json']])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: RUNNING })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'needs you' })).toBeUndefined()
  expect((await ui.find({ key: 'view:run_a' }))?.props.hotkey).toBe('v')
  await ui.unmount()
})

test('a run that waits for a person says "needs you"', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  w.line.run_a = lineOf('coding-loop-0238a2a3 at approve, visit 1, from test on ok', { needsYou: true })
  await $.tool.call({ tool: 'Bash', command: 'spore continue run_a --wait --json' })
  await clock.settle()
  expect(lineCalls(w).map(argv => argv.slice(1))).toEqual([['line', 'run_a', '--json']])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: 'needs you' }))?.props.color).toBe('#e8590c')
  await ui.unmount()
})

test('the band leads with "needs you" and shows the longest form of the line that fits', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  const forms = ['nightly-mon at publish for 2 min, visit 2, from check on ok', 'nightly-mon at publish for 2 min, visit 2, from check:ok', 'nightly-mon at publish for 2 min, visit 2']
  w.line.run_a = lineOf(forms[0]!, { shorter: forms.slice(1), needsYou: true })
  await $.tool.call({ tool: 'Bash', command: FOLLOW })
  await clock.settle()
  // `needs you` and its two spaces take 11 columns and ` [ view ]` 9: at 76 the arrow cut down fits.
  let ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 76 }, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
  expect(texts).toContain(forms[1])
  expect(texts.slice(0, texts.indexOf(forms[1]!))).toContain('needs you')
  expect(texts).not.toContain(forms[0])
  await ui.unmount()
  // At 60 only the line without its arrow fits; at 100 the whole line does.
  ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: 60 }, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: forms[2] })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: forms[0] })).toBeDefined()
  await ui.unmount()
})

test('other commands follow nothing, and nothing is polled', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'spore status run_a --json' })
  await clock.advance(5000)
  expect(lineCalls(w)).toEqual([])
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ key: 'view:run_a' })).toBeUndefined()
  await ui.unmount()
})

test('the line is polled once a second while it shows; an ended run leaves the band and the poll stops', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  w.line.run_a = lineOf(RUNNING)
  await $.tool.call({ tool: 'Bash', command: FOLLOW })
  await clock.settle()
  await clock.advance(1000)
  await clock.advance(1000)
  expect(lineCalls(w)).toHaveLength(3)
  const next = 'coding-loop-0238a2a3 at test, visit 4, from implement on ok, try 1/3, red 2/3 in a row'
  w.line.run_a = lineOf(next)
  await clock.advance(1000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: next })).toBeDefined()
  w.line.run_a = lineOf('coding-loop-0238a2a3 completed at done, from approve on approved', { ended: true })
  await clock.advance(1000)
  await ui.redraw()
  expect(await ui.find({ key: 'view:run_a' })).toBeUndefined()
  const polled = lineCalls(w).length
  await clock.advance(5000)
  expect(lineCalls(w)).toHaveLength(polled)
  await ui.unmount()
})

test("the view button opens the pane run-<runId> drawing the helper's view", async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  w.line.run_a = lineOf(RUNNING)
  w.view.run_a = VIEWED
  await $.tool.call({ tool: 'Bash', command: FOLLOW })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  w.order = []
  await band.press({ key: 'view:run_a' })
  expect(w.opens).toEqual(['run-run_a'])
  expect(w.order.slice(0, 2)).toEqual(['open run-run_a', 'run view'])
  expect(w.runs.filter(argv => argv[1] === 'view').map(argv => argv.slice(1))).toEqual([['view', 'run_a', '--db', DB, '--json']])
  const pane = await $.ui.mount({ ...VIEW_PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: LIVE.facts })).toBeDefined()
  expect((await pane.find({ key: 'picture' }))?.props.source).toEqual({ file: LIVE.picture.file, format: 'png' })
  expect(await pane.find({ type: 'Text', text: '  2    implement [label="Implement (Claude)"];' })).toMatchObject({ props: { backgroundColor: '#ffd43b' } })
  expect(await pane.find({ type: 'Text', text: '  3    test -> implement [on="red"];' })).toMatchObject({ props: { color: '#e8590c' } })
  expect(await pane.find({ type: 'Text', text: '- `cameFrom`' })).toBeUndefined()
  await pane.press({ key: 'more' })
  expect(await pane.find({ type: 'Text', text: '- `cameFrom`' })).toBeDefined()
  await pane.unmount()
  await band.unmount()
})

test('a picture check the terminal denies switches the session to the dot drawing', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  w.view.run_a = VIEWED
  w.line.run_a = lineOf(RUNNING)
  w.blit = { deny: 'the Image draws its alt here: the terminal draws no placeholder images' }
  const answer = await $.tool.call({ tool: 'mcp__ml-workflow__open_view', runId: 'run_a', db: DB })
  expect(answer.result).toBe('The live view of run_a is open.')
  const pane = await $.ui.mount({ ...VIEW_PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'picture' })).toBeDefined()
  await clock.advance(500)
  expect(w.blits).toEqual(['run-run_a/picture'])
  await pane.redraw()
  expect(await pane.find({ key: 'picture' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^│ implement │$/ })).toMatchObject({ props: { backgroundColor: '#ffd43b' } })
  await pane.unmount()
})

test('a dot drawing taller than the pane gives way to the compact tree; the current node is keyed and file lines wrap', async ($, on) => {
  mock.clock(on)
  const w = world(on, NEW)
  const dots = Array.from({ length: 30 }, (_, i) => [{ text: `row ${i}`, style: i === 20 ? 'here' : 'edge' }])
  w.view.run_a = { exitCode: 0, stdout: JSON.stringify({ ...LIVE, picture: null, dots }), stderr: '' }
  await $.tool.call({ tool: 'mcp__ml-workflow__open_view', runId: 'run_a', db: DB })
  const short = await $.ui.mount({ ...VIEW_PANE, props: { ...VIEW_PANE.props, scroll: { offset: 0, bodyRows: 20 } }, surface: 'terminal' })
  expect(await short.find({ type: 'Text', text: 'row 0' })).toBeUndefined()
  expect(await short.find({ type: 'Text', text: 'Run the tests' })).toBeDefined()
  expect(await short.find({ key: 'here' })).toBeDefined()
  expect(await short.find({ type: 'Text', text: /^Implement \(Claude\)$/ })).toMatchObject({ props: { backgroundColor: '#ffd43b' } })
  expect(await short.find({ type: 'Text', text: '  2    implement [label="Implement (Claude)"];' })).toMatchObject({ props: { wrap: 'wrap' } })
  await short.unmount()
  const tall = await $.ui.mount({ ...VIEW_PANE, surface: 'terminal' })
  expect(await tall.find({ type: 'Text', text: 'row 0' })).toBeDefined()
  expect(await tall.find({ type: 'Text', text: 'Run the tests' })).toBeUndefined()
  await tall.unmount()
})

test('a picture taller than the pane is drawn narrower, to fit its rows', async ($, on) => {
  mock.clock(on)
  const w = world(on, NEW)
  w.view.run_a = VIEWED
  await $.tool.call({ tool: 'mcp__ml-workflow__open_view', runId: 'run_a', db: DB })
  const pane = await $.ui.mount({ ...VIEW_PANE, props: { ...VIEW_PANE.props, scroll: { offset: 0, bodyRows: 22 } }, surface: 'terminal' })
  // 760×840 is 0.55 rows a column: 20 rows, the room under the facts, take 36 columns.
  expect((await pane.find({ key: 'picture' }))?.props).toMatchObject({ columns: 36, rows: 20 })
  await pane.unmount()
})

test('an open view polls its run; once the run ended it gets its last view and the poll stops', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  w.view.run_a = VIEWED
  w.line.run_a = lineOf(RUNNING)
  await $.tool.call({ tool: 'mcp__ml-workflow__open_view', runId: 'run_a' })
  await clock.advance(1000)
  expect(lineCalls(w)).toHaveLength(1)
  const ended = lineOf('coding-loop-0238a2a3 completed at done, from approve on approved', { ended: true })
  w.line.run_a = ended
  w.view.run_a = { ...VIEWED, stdout: JSON.stringify({ ...LIVE, line: JSON.parse(ended.stdout), facts: 'completed, at done' }) }
  await clock.advance(1000)
  const views = w.runs.filter(argv => argv[1] === 'view').length
  expect(views).toBe(2)
  const pane = await $.ui.mount({ ...VIEW_PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: 'completed, at done' })).toBeDefined()
  await clock.advance(5000)
  expect(lineCalls(w)).toHaveLength(2)
  expect(w.runs.filter(argv => argv[1] === 'view')).toHaveLength(views)
  await pane.unmount()
})

test('a view that waits undrawn names the keys that show it: v on the newest run line, else its command', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, NEW)
  w.view.run_a = VIEWED
  w.line.run_a = lineOf(RUNNING)
  w.open = { value: { isPlaced: false, reason: 'the terminal is 90 columns wide' } }
  const waits = 'The live view of run_a is open but not shown yet: the terminal is 90 columns wide.'
  expect((await $.tool.call({ tool: 'mcp__ml-workflow__open_view', runId: 'run_a', db: DB })).result).toBe(`${waits} Type /ml-workflow:view run_a and press Enter to show it.`)
  await $.tool.call({ tool: 'Bash', command: FOLLOW })
  await clock.settle()
  expect((await $.tool.call({ tool: 'mcp__ml-workflow__open_view', runId: 'run_a', db: DB })).result).toBe(`${waits} Press ctrl+x tab, then v, to show it.`)
})

test("the menu's View opens the live view, and runs no command", async ($, on) => {
  mock.clock(on)
  const w = world(on, NEW)
  await started($, w)
  w.view.run_a = VIEWED
  w.menu = {
    exitCode: 0,
    stdout: JSON.stringify({ db: DB, rows: [{ key: 'run:run_a', label: 'coding-loop-0238a2a3 at implement', options: [{ label: 'View', command: 'ml-workflow:view', args: 'run_a' }] }] }),
    stderr: '',
  }
  await $.command.run(MENU_COMMAND)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.select({ key: 'run:run_a', value: '0' })
  expect(w.commands).toEqual([])
  expect(w.opens).toEqual(['ml-workflow-menu', 'run-run_a'])
  expect(w.closes).toEqual(['ml-workflow-menu'])
  expect(w.order.slice(2, 4)).toEqual(['open run-run_a', 'run view'])
  await ui.unmount()
})

test('typed with a run ID, the view command opens the pane before it reads the run, and the skill does not run', async ($, on) => {
  mock.clock(on)
  const w = world(on, NEW)
  await started($, w)
  w.view.run_a = VIEWED
  expect((await $.command.run({ command: 'ml-workflow:view', args: 'run_a' })).text).toBe('The live view of run_a is open.')
  expect(w.order.slice(0, 2)).toEqual(['open run-run_a', 'run view'])
  expect(w.runs.filter(argv => argv[1] === 'view').map(argv => argv.slice(1))).toEqual([['view', 'run_a', '--json']])
  expect(w.commands).toEqual([])
})

test('typed without a run ID, the view command runs the skill, which finds the run', async ($, on) => {
  const w = world(on, NEW)
  await started($, w)
  await $.command.run({ command: 'ml-workflow:view', args: '' })
  expect(w.commands).toEqual([['ml-workflow:view', '']])
  expect(w.opens).toEqual([])
})

test('a view that waits undrawn names the command that shows it', async ($, on) => {
  mock.clock(on)
  const w = world(on, NEW)
  w.view.run_a = VIEWED
  w.open = { value: { isPlaced: false, reason: 'unasked below 144 columns (120 now)' } }
  const answer = await $.tool.call({ tool: 'mcp__ml-workflow__open_view', runId: 'run_a', db: DB })
  expect(answer.result).toBe('The live view of run_a is open but not shown yet: unasked below 144 columns (120 now). Type /ml-workflow:view run_a and press Enter to show it.')
})
