import { expect, test } from 'claude-code/testing'

import { expired } from '../hooks/register'
import { READ, boot } from './boot'

const DAY = 86_400_000
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
  let finished = () => {}
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
    return { value: undefined }
  })
  on('model.complete', () => {
    narrations++
    return { value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } } as never
  })
  // The reader's last write of a reading is its status turning done.
  on('state.set', async ($, e, next) => {
    const answered = await next(e)
    if (JSON.stringify(e.value).includes('"status":"done"')) finished()
    return answered
  })
  const clock = await boot($, on, {
    run: e => {
      const [cmd, script, , from, to] = e.argv
      if (cmd === 'sh' && script === '-c' && e.argv[2]?.includes('mv -f') && from && to) {
        files.set(to, files.get(from) ?? '')
        files.delete(from)
      }
      if (cmd === 'say') {
        syntheses++
        files.set(e.argv[2] ?? '', 'wav')
      }
      return undefined
    },
  })

  for (let i = 0; i < 2; i++) {
    const done = new Promise<void>(resolve => (finished = resolve))
    await $.prompt.submit(READ)
    await clock.advance(1)
    await done
  }

  expect(plays).toBe(2)
  expect(narrations).toBe(1)
  expect(syntheses).toBe(1)
  expect([...files.keys()].some(f => f.startsWith('/home/test/.cache/voice-reader/audio/'))).toBe(true)
  expect([...files.keys()].some(f => f.startsWith('/home/test/.cache/voice-reader/narration/'))).toBe(true)
})
