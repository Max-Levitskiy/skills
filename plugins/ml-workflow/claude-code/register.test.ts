import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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
}

const FINE = JSON.stringify({ ok: true, spore: { path: '/bin/spore', version: '0.2.1' }, problems: [], launcher: 'offer' })
const MISSING = 'ml-workflow needs spore 0.2.0 or later, and none is on PATH. Install it with: claude-spore install-spore'
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
  const w: World = { version, logs: [], runs: [], doctor, unfinished, menu: MENU, open: { value: { isPlaced: true } }, opens: [], closes: [], commands: [], tools: [] }
  on('session.version', () => ({ value: w.version }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    w.runs.push([...e.argv])
    const answer = e.argv[1] === 'unfinished' ? w.unfinished : e.argv[1] === 'menu' ? w.menu : w.doctor
    if ('deny' in answer) return { deny: answer.deny }
    return { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('ui.open', ($, e) => {
    w.opens.push(e.id)
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

const RUN = 'coding-loop-0238a2a3 at implement, attempt 2 of 3, paused 14 min ago; /ml-workflow:menu to pick it up'
const DECISION = 'coding-loop-11111111 at approve, waiting for your decision for 2 h; /ml-workflow:menu to pick it up'
const TWO: Ran = { exitCode: 0, stdout: JSON.stringify({ db: '/repo/.spore/runspore.db', lines: [RUN, DECISION] }), stderr: '' }

test('session start writes each unfinished run as one line', async ($, on) => {
  const w = world(on, NEW, undefined, TWO)
  expect(await $.session.start(START)).toEqual({ cwd: '/repo' })
  expect(w.logs).toEqual([RUN, DECISION])
})

test("the doctor's problems come before the runs", async ($, on) => {
  const w = world(on, NEW, { exitCode: 1, stdout: PROBLEMS, stderr: '' }, TWO)
  await $.session.start(START)
  expect(w.logs).toEqual([RELOAD, MISSING, RUN, DECISION])
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
const PANE = { plugin: 'ml-workflow', component: 'Pane', requestId: 'ml-workflow-menu', props: { bodyColumns: 80 } as never } as const

test("the menu skill runs the helper's menu and opens the pane in place of its text", async ($, on) => {
  const w = world(on, NEW)
  expect((await $.skill.prompt({ skill: 'ml-workflow:menu', text: 'MENU BODY' })).text).toBe(OPEN)
  expect(w.runs.map(argv => argv.slice(1))).toEqual([['menu', '--json']])
  expect(w.runs[0]![0]!.endsWith('/bin/claude-spore')).toBe(true)
  expect(w.opens).toEqual(['ml-workflow-menu'])
})

test('a pane that waits undrawn says why', async ($, on) => {
  const w = world(on, NEW)
  w.open = { value: { isPlaced: false, reason: 'the terminal is 90 columns wide' } }
  expect((await $.skill.prompt({ skill: 'ml-workflow:menu', text: 'MENU BODY' })).text).toBe('The workflow menu is open but not shown yet: the terminal is 90 columns wide')
})

test("an open the engine refuses leaves the skill's own text, which calls open_menu", async ($, on) => {
  const w = world(on, NEW)
  w.open = { deny: 'no pane from here' }
  expect((await $.skill.prompt({ skill: 'ml-workflow:menu', text: 'MENU BODY' })).text).toBe('MENU BODY')
})

test("on an older Claude Code the menu skill's own text runs, and nothing opens", async ($, on) => {
  const w = world(on, { version: '2.1.289', base: '2.1.289' })
  expect((await $.skill.prompt({ skill: 'ml-workflow:menu', text: 'MENU BODY' })).text).toBe('MENU BODY')
  expect(w.runs).toEqual([])
  expect(w.opens).toEqual([])
})

test('session start registers the open_menu tool', async ($, on) => {
  const w = world(on, NEW)
  await $.session.start(START)
  expect(w.tools).toEqual(['open_menu'])
})

test('the open_menu tool opens the same pane', async ($, on) => {
  const w = world(on, NEW)
  const answer = await $.tool.call({ tool: 'mcp__ml-workflow__open_menu' })
  expect(answer.result).toBe(OPEN)
  expect(w.runs.map(argv => argv.slice(1))).toEqual([['menu', '--json']])
  expect(w.opens).toEqual(['ml-workflow-menu'])
})

test("the pane draws one Select per row with the helper's labels; a pick closes it and runs the option's command", async ($, on) => {
  const w = world(on, NEW)
  await $.skill.prompt({ skill: 'ml-workflow:menu', text: 'MENU BODY' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Select' })).map(select => select.key)).toEqual(['run:run_a', 'author'])
  const run = await ui.find({ key: 'run:run_a' })
  expect(run?.props.label).toBe(ROWS[0]!.label)
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
  w.menu = { exitCode: 2, stdout: '', stderr: 'claude-spore: unknown command "menu"\n' }
  expect((await $.skill.prompt({ skill: 'ml-workflow:menu', text: 'MENU BODY' })).text).toBe(OPEN)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('The menu could not be built: claude-spore: unknown command "menu"')
  await ui.unmount()
})
