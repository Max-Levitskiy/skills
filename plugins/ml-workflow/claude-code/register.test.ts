import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Seam 2 (docs/spec.md, Testing): the mod registers and passes through; no logic is tested here.

type World = { version: { version: string; base?: string }; logs: string[] }

// Everything beneath the plugin: the engine's own answers.
function world(on: On, version: World['version']): World {
  const w: World = { version, logs: [] }
  on('session.version', () => ({ value: w.version }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  return w
}

const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

test('on a new enough Claude Code the session starts with nothing shown', async ($, on) => {
  const w = world(on, { version: '2.1.296', base: '2.1.296' })
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
