import { expect, test } from 'claude-code/testing'

import { PANE_PROPS, READ, boot, memoryDisk, settles, sleep } from './boot'

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

test('a usage line that could not be written stays on screen through narration and the next read', async ($, on) => {
  const disk = memoryDisk(on)
  const settled = settles(on)
  on('audio.play', () => ({ value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } }) as never)
  const clock = await boot($, on, {
    plan: {
      ready: true,
      config: { voice: { provider: 'fish-audio' }, fishAudio: { model: 's2-pro' }, credentials: { fishAudioKey: { source: 'env', var: 'FISH' } } },
    },
    run: e => {
      const [cmd, , script] = e.argv
      if (cmd === 'sh' && script?.includes(' load ')) return { exitCode: 0, stdout: JSON.stringify({ 'credentials.fishAudioKey': 'test-key' }), stderr: '' }
      // Fish Audio bills by characters; the log cannot be appended to.
      if (cmd === 'sh' && script?.includes('cat >>')) return { exitCode: 1, stdout: '', stderr: 'Read-only file system' }
      if (cmd === 'curl') {
        const out = /output = "([^"]+)"/.exec(String((e as { stdin?: string }).stdin))?.[1] ?? ''
        disk.files.set(out, 'mp3')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      return disk.run(e)
    },
  })
  const done = settled('done')
  await $.prompt.submit(READ)
  await clock.advance(1)
  await done
  for (let i = 0; i < 100; i++) {
    const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
    const isShown = (await pane.find({ type: 'Text', text: /usage log could not be written/ })) !== undefined
    await pane.unmount()
    if (isShown) break
    await sleep(5)
  }

  // The next read starts a new reply; the failure belongs to the session and stays.
  await $.prompt.submit(READ)
  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /usage log could not be written/ })).toBeDefined()
  await pane.unmount()
})
