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
