import { expect, test } from 'claude-code/testing'

import { PANE_PROPS, READ, boot, memoryDisk, settles } from './boot'

test('a narration call that fails reads the plain cleanup instead of hanging', async ($, on) => {
  const disk = memoryDisk(on)
  const settled = settles(on)
  on('audio.play', () => ({ value: undefined }))
  on('model.complete', () => {
    throw new Error('overloaded')
  })
  const clock = await boot($, on, { run: disk.run })
  const done = settled('done', 'error')
  await $.prompt.submit(READ)
  await clock.advance(1)
  await done

  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /Finished/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Haiku narration failed/ })).toBeDefined()
  await pane.unmount()
})

test('audio that will not play stops on an error and leaves the cache', async ($, on) => {
  const disk = memoryDisk(on)
  const settled = settles(on)
  on('audio.play', () => {
    throw new Error('not audio')
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } }) as never)
  const clock = await boot($, on, { run: disk.run })
  const stopped = settled('error', 'done')
  await $.prompt.submit(READ)
  await clock.advance(1)
  await stopped

  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /did not play/ })).toBeDefined()
  await pane.unmount()
  expect([...disk.files.keys()].some(f => f.includes('/audio/'))).toBe(false)
})

test('audio that cannot be moved into the cache fails the part, and play makes it again', async ($, on) => {
  const disk = memoryDisk(on)
  const settled = settles(on)
  let syntheses = 0
  let isMoveBroken = true
  on('audio.play', () => ({ value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } }) as never)
  const clock = await boot($, on, {
    run: e => {
      if (e.argv[0] === 'say') syntheses++
      if (isMoveBroken && e.argv[0] === 'sh' && e.argv[2]?.includes('mv -f')) return { exitCode: 1, stdout: '', stderr: 'Permission denied' }
      return disk.run(e)
    },
  })
  const stopped = settled('error', 'done')
  await $.prompt.submit(READ)
  await clock.advance(1)
  await stopped

  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /could not be cached/ })).toBeDefined()
  isMoveBroken = false
  const finished = settled('done')
  await pane.press({ key: 'toggle' })
  await clock.advance(1)
  await finished
  await pane.unmount()
  expect(syntheses).toBe(2)
})

test('a narration that answers after the session ended plays nothing', async ($, on) => {
  const disk = memoryDisk(on)
  let plays = 0
  let syntheses = 0
  let answer = (_: unknown) => {}
  on('audio.play', () => {
    plays++
    return { value: undefined }
  })
  on('model.complete', () => new Promise(resolve => (answer = resolve)) as never)
  on('session.end', () => ({ sessionId: 'test-session' }) as never)
  const clock = await boot($, on, {
    run: e => {
      if (e.argv[0] === 'say') syntheses++
      return disk.run(e)
    },
  })
  await $.prompt.submit(READ)
  await clock.advance(1)
  await $.session.end({ reason: 'clear' } as never)
  answer({ value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } })
  await clock.advance(1)
  for (let i = 0; i < 20; i++) await Promise.resolve()
  expect(syntheses).toBe(0)
  expect(plays).toBe(0)
})
