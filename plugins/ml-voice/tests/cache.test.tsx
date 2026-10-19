import { expect, test } from 'claude-code/testing'

import { expired } from '../hooks/register'
import { READ, boot, memoryDisk, settles, sleep } from './boot'

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
  const disk = memoryDisk(on)
  const settled = settles(on)
  let narrations = 0
  let syntheses = 0
  let plays = 0
  on('audio.play', () => {
    plays++
    return { value: undefined }
  })
  on('model.complete', () => {
    narrations++
    return { value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } } as never
  })
  const clock = await boot($, on, {
    run: e => {
      if (e.argv[0] === 'say') syntheses++
      return disk.run(e)
    },
  })

  for (let i = 0; i < 2; i++) {
    const done = settled('done')
    await $.prompt.submit(READ)
    await clock.advance(1)
    await done
  }

  expect(plays).toBe(2)
  expect(narrations).toBe(1)
  expect(syntheses).toBe(1)
  expect([...disk.files.keys()].some(f => f.startsWith('/home/test/.cache/voice-reader/audio/'))).toBe(true)
  expect([...disk.files.keys()].some(f => f.startsWith('/home/test/.cache/voice-reader/narration/'))).toBe(true)
})

test('reading again while a part is still being made joins that request instead of paying twice', async ($, on) => {
  const disk = memoryDisk(on)
  const settled = settles(on)
  let syntheses = 0
  let finishSay = () => {}
  on('audio.play', () => ({ value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } }) as never)
  const clock = await boot($, on, {
    run: e => {
      if (e.argv[0] !== 'say') return disk.run(e)
      syntheses++
      disk.run(e)
      return new Promise(resolve => (finishSay = () => resolve({ exitCode: 0, stdout: '', stderr: '' })))
    },
  })
  await $.prompt.submit(READ)
  await clock.advance(1)
  for (let i = 0; i < 100 && syntheses === 0; i++) await sleep(5)
  expect(syntheses).toBe(1)

  // The first part is still being made when the same reply is read again.
  await $.prompt.submit(READ)
  await clock.advance(1)
  await sleep(100)
  const done = settled('done')
  finishSay()
  await done
  expect(syntheses).toBe(1)
})
