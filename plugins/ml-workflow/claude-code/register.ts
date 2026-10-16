// Claude Code only: the mod. It stays thin (docs/spec.md, p.7): the helper works out what the mod
// shows, and the mod calls it and renders the answer. It checks the host's version and runs the
// helper's `doctor` at session start and before every start, at session start prints the helper's
// line for each unfinished run, and draws the helper's menu rows in a pane; the run line and the
// live view join it later.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, UiOpenResult } from 'claude-code'

import { BUN_MINIMUM, CLAUDE_CODE_MINIMUM, isOlder, PLUGIN_VERSION } from '../src/version'
import type { Menu, MenuOption } from '../types'

// The version this session loaded, fixed when the mod loads: the helper on disk may be newer.
const VERSION = PLUGIN_VERSION

const PANE = 'ml-workflow-menu'
const OPEN = 'The workflow menu is open.'
const menuRows = atom({ plugin: 'ml-workflow', key: 'menu' } as const, { rows: [], problem: null } as Menu)

type Ran = { exitCode: number; stdout: string; stderr: string }
type Doctor = { ran?: Ran; isGone?: boolean }

function helper($: EngineInterface): string {
  return `${$.plugin.root}/bin/claude-spore`
}

async function doctor($: EngineInterface): Promise<Doctor> {
  try {
    return { ran: await $.process.run([helper($), 'doctor', '--json', '--plugin-version', VERSION], { timeoutMs: 8000 }) }
  } catch (error) {
    return { isGone: /ENOENT|no such file/i.test(String(error)) }
  }
}

// The session-start line (docs/spec.md, p.9): the helper's line for each unfinished run, none on any error.
async function unfinished($: EngineInterface): Promise<string[]> {
  try {
    const { stdout } = await $.process.run([helper($), 'unfinished', '--json'], { timeoutMs: 9000 })
    const lines: unknown = (JSON.parse(stdout) as { lines?: unknown })?.lines
    return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : []
  } catch {
    return []
  }
}

// The doctor's lines, or what a helper that did not start means (docs/spec.md, p.3, p.5).
function lines({ ran, isGone }: Doctor): string[] {
  if (isGone) return ['ml-workflow changed since this session loaded it. Run /reload-plugins, then try again.']
  if (!ran) return []
  const report = parsed(ran)
  if (report) return report.problems.map(problem => problem.message)
  if (ran.exitCode === 127) return [`ml-workflow needs Bun ${BUN_MINIMUM} or later, and none is on PATH. Install it with: curl -fsSL https://bun.sh/install | bash`]
  if (ran.exitCode === 2 && ran.stderr) return [ran.stderr.split('\n')[0]!]
  return []
}

function parsed(ran: Ran): { problems: { message: string }[] } | undefined {
  try {
    const report: unknown = JSON.parse(ran.stdout)
    const problems = (report as { problems?: unknown })?.problems
    return Array.isArray(problems) ? (report as { problems: { message: string }[] }) : undefined
  } catch {
    return undefined
  }
}

// The menu (docs/spec.md, p.11): the helper's rows go into the session's state, then the pane opens.
// It rejects when the engine refuses the open.
async function openMenu($: EngineInterface): Promise<UiOpenResult> {
  let menu: Menu
  try {
    const ran = await $.process.run([helper($), 'menu', '--json'], { timeoutMs: 9000 })
    menu = rowsOf(ran)
  } catch (error) {
    menu = { rows: [], problem: String(error) }
  }
  await update($, menuRows, () => menu)
  return $.ui.open({ id: PANE, title: 'Workflows', focus: true, closeOnEscape: true })
}

function rowsOf(ran: Ran): Menu {
  try {
    const rows: unknown = (JSON.parse(ran.stdout) as { rows?: unknown })?.rows
    if (Array.isArray(rows) && rows.length) return { rows, problem: null }
  } catch {}
  return { rows: [], problem: ran.stderr.split('\n')[0] || null }
}

function opened(result: UiOpenResult): string {
  return result.isPlaced ? OPEN : `The workflow menu is open but not shown yet: ${result.reason}`
}

// A pick hands off to the option's sub-skill, as if the person typed it.
function pick($: EngineInterface, option: MenuOption | undefined): void {
  if (!option) return
  void (async () => {
    await $.ui.close({ id: PANE })
    await $.command.run({ command: option.command, args: option.args })
  })().catch(error => $.ui.log(`ml-workflow: /${option.command} did not run: ${String(error)}`))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A tool the engine does not take costs the menu's fallback alone, never the lines below.
    await $.tool
      .register({
        name: 'open_menu',
        description:
          'Opens the ml-workflow menu pane: the unfinished Runspore runs with what each needs, the workflows to start, and writing or changing one. ' +
          '/ml-workflow:menu calls it when the pane could not open by itself.',
      })
      .catch(error => $.ui.log(`ml-workflow: the open_menu tool was not registered: ${String(error)}`))
    const { version, base } = await $.session.version()
    if (isOlder(base ?? version, CLAUDE_CODE_MINIMUM)) {
      $.ui.log(`ml-workflow needs Claude Code ${CLAUDE_CODE_MINIMUM} or later; this is ${version}. Run: claude update`)
    } else {
      // Side by side: both wait on spore, and the person waits for both.
      const [checked, runs] = await Promise.all([doctor($), e.isInteractive ? unfinished($) : []])
      for (const line of [...lines(checked), ...runs]) $.ui.log(line)
    }
    return next(e)
  })

  // `/ml-workflow:menu` opens the pane instead of its text. On an older Claude Code, or an open the
  // engine refuses, the skill's own text runs: it says so, or calls `open_menu`.
  // Before every start the skill gets the doctor's answer, so it checks nothing twice.
  on('skill.prompt', async ($, e, next) => {
    const computed = await next(e)
    if (e.skill === 'ml-workflow:menu') {
      const { version, base } = await $.session.version()
      if (isOlder(base ?? version, CLAUDE_CODE_MINIMUM)) return computed
      try {
        return { text: opened(await openMenu($)) }
      } catch {
        return computed
      }
    }
    if (e.skill !== 'ml-workflow:start') return computed
    const { ran } = await doctor($)
    if (!ran || !parsed(ran)) return computed
    const block = [
      '<claude-spore-doctor>',
      '`claude-spore doctor --json` already ran for this start. Use this output instead of running it; run it again only after a fix.',
      ran.stdout.trim(),
      '</claude-spore-doctor>',
    ].join('\n')
    return { text: `${block}\n\n${computed.text}` }
  })

  on('tool.call', { tool: 'mcp__ml-workflow__open_menu' }, async $ => {
    try {
      return { result: opened(await openMenu($)) }
    } catch (error) {
      return { result: `The workflow menu could not open: ${String(error)}` }
    }
  })

  // One Select per row, the helper's labels as they came.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { rows, problem } = await read($, menuRows)
    if (!rows.length || !('Select' in ui)) return h(ui.Text, { dimColor: true }, `The menu could not be built${problem ? `: ${problem}` : '.'}`) as RenderElement
    const selects = rows.map((row, i) =>
      h(ui.Select, {
        key: row.key,
        label: row.label,
        options: row.options.map((option, n) => ({ value: String(n), label: option.label })),
        ...(i === 0 ? { autoFocus: true } : {}),
        onSelect: (value: string) => pick($, row.options[Number(value)]),
      }),
    )
    return h(ui.Box, { flexDirection: 'column' }, ...selects) as RenderElement
  })
}
