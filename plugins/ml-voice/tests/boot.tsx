import { mock } from 'claude-code/testing'

type On = Parameters<typeof mock.env>[0]
type ProcessRun = { argv: readonly string[] }
type Ran = { exitCode: number; stdout: string; stderr: string }

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { top: 0, bodyRows: 4 } } as never
export const PANE_PROPS = { title: 'Voice', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 30 } as never, view: {} } as never
export const READ = { text: '/ml-voice:read', command: { name: 'ml-voice:read', args: '' } } as never

const ok = (stdout = ''): Ran => ({ exitCode: 0, stdout, stderr: '' })

// A session with one question and its reply, agent-config found at /bin/agent-config and
// answering `start` with `plan`, and the pane shown while `isPaneShown()` says so. `run`
// answers every other process first; whatever it leaves undefined exits 0.
export async function boot(
  $: { session: { start: (e: never) => Promise<unknown> } },
  on: On,
  options: {
    reply?: string
    plan?: unknown
    isPaneShown?: () => boolean
    run?: (e: ProcessRun) => Ran | undefined
  } = {},
) {
  const { reply = 'An answer.', plan = { ready: true, config: { voice: { provider: 'say' } } }, isPaneShown = () => true } = options
  mock.env(on, { HOME: '/home/test' })
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }) as never)
  on('ui.open', () => ({ value: { isPlaced: isPaneShown() } }) as never)
  on('ui.panes', () => ({
    value: isPaneShown() ? [{ id: 'ml-voice', title: 'Voice', isShown: true, isFocused: true, isPlaced: true }] : [],
  }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'a question', toolUses: [] },
      { role: 'assistant', text: reply, toolUses: [] },
    ],
  }))
  on('process.run', ($, e) => {
    const answered = options.run?.(e)
    if (answered) return { value: answered } as never
    if (e.argv[0] === 'sh' && e.argv[2]?.includes('command -v agent-config')) return { value: ok('/bin/agent-config\n') } as never
    if (e.argv[0] === '/bin/agent-config') return { value: ok(JSON.stringify(plan)) } as never
    return { value: ok() } as never
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true } as never)
  return clock
}
