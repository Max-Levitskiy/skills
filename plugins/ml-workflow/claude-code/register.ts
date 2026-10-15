// Claude Code only: the mod. It stays thin (docs/spec.md, p.7): the helper works out what the mod
// shows, and the mod calls it and renders the answer. It checks the host's version and runs the
// helper's `doctor` at session start and before every start; the start line, the menu, the run
// line and the live view join it later.

import type { EngineInterface, Register } from 'claude-code'

import { BUN_MINIMUM, CLAUDE_CODE_MINIMUM, isOlder, PLUGIN_VERSION } from '../src/version'

// The version this session loaded, fixed when the mod loads: the helper on disk may be newer.
const VERSION = PLUGIN_VERSION

type Ran = { exitCode: number; stdout: string; stderr: string }
type Doctor = { ran?: Ran; isGone?: boolean }

async function doctor($: EngineInterface): Promise<Doctor> {
  const helper = `${$.plugin.root}/bin/claude-spore`
  try {
    return { ran: await $.process.run([helper, 'doctor', '--json', '--plugin-version', VERSION], { timeoutMs: 8000 }) }
  } catch (error) {
    return { isGone: /ENOENT|no such file/i.test(String(error)) }
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const { version, base } = await $.session.version()
    if (isOlder(base ?? version, CLAUDE_CODE_MINIMUM)) {
      $.ui.log(`ml-workflow needs Claude Code ${CLAUDE_CODE_MINIMUM} or later; this is ${version}. Run: claude update`)
    } else {
      for (const line of lines(await doctor($))) $.ui.log(line)
    }
    return next(e)
  })

  // Before every start the skill gets the doctor's answer, so it checks nothing twice.
  on('skill.prompt', async ($, e, next) => {
    const computed = await next(e)
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
}
