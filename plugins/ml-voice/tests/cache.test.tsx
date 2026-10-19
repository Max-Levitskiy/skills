import { expect, mock, test } from 'claude-code/testing'
import { expired } from '../hooks/register'

const DAY = 86_400_000
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100, scroll: { top: 0, bodyRows: 4 } } as never
const MB = 1024 * 1024

test('the cleanup drops files unplayed past the age limit, then the least recently played past the size cap', () => {
  const now = 100 * DAY
  const files = [
    { path: 'old', size: MB, mtimeMs: now - 40 * DAY },
    { path: 'newest', size: 2 * MB, mtimeMs: now - DAY },
    { path: 'middle', size: 2 * MB, mtimeMs: now - 5 * DAY },
    { path: 'oldest-kept', size: 2 * MB, mtimeMs: now - 10 * DAY },
  ]
  expect(expired(files, { maxAgeDays: 30, maxSizeMB: 4 }, now).sort()).toEqual(['old', 'oldest-kept'])
  expect(expired(files, { maxAgeDays: 0, maxSizeMB: 0 }, now)).toEqual([])
})

test('a reply read twice is narrated and synthesized once', async ($, on) => {
  const files = new Map<string, string>()
  let narrations = 0
  let syntheses = 0
  let plays = 0
  let played = () => {}
  mock.env(on, { TMPDIR: '/tmp', HOME: '/home/test' })
  mock.store(on)
  const clock = mock.clock(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'a question', toolUses: [] },
      { role: 'assistant', text: 'An answer.', toolUses: [] },
    ],
  }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: e.as === 'bytes' ? { base64: '' } : text } as never
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', () => ({ value: [] }))
  on('audio.play', () => {
    plays++
    played()
    return { value: undefined }
  })
  on('model.complete', () => {
    narrations++
    return { value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } } as never
  })
  on('process.run', ($, e) => {
    const [cmd, , , from, to] = e.argv
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (cmd === 'sh' && e.argv[2]?.includes('agent-config')) return ok('/bin/agent-config\n')
    if (cmd === 'sh' && e.argv[2]?.includes('mv -f') && from && to) {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
      return ok()
    }
    if (cmd === '/bin/agent-config') return ok(JSON.stringify({ ready: true, config: { voice: { provider: 'say' } } }))
    if (cmd === 'say') {
      syntheses++
      files.set(e.argv[2] ?? '', 'wav')
    }
    return ok()
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  // Narration and playback run off a timer; each read is heard before the next starts.
  for (let i = 0; i < 2; i++) {
    const heard = new Promise<void>(resolve => (played = resolve))
    await $.prompt.submit({ text: '/ml-voice:read', command: { name: 'ml-voice:read', args: '' } } as never)
    await clock.advance(1)
    await heard
    // The band goes away once the reading is done, which is the reader's last write.
    for (let t = 0; t < 200; t++) {
      const band = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
      const isDone = (await band.find({ key: 'band-stop' })) === undefined
      await band.unmount()
      if (isDone) break
    }
  }

  expect(plays).toBe(2)
  expect(narrations).toBe(1)
  expect(syntheses).toBe(1)
  expect([...files.keys()].some(f => f.startsWith('/home/test/.cache/voice-reader/audio/'))).toBe(true)
  expect([...files.keys()].some(f => f.startsWith('/home/test/.cache/voice-reader/narration/'))).toBe(true)
})
