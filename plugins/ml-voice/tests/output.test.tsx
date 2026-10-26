import { expect, test } from 'claude-code/testing'

import { REMOTE_PORT, machineOf, outputOf } from '../hooks/register'
import { PANE_PROPS, READ, boot, memoryDisk, settles } from './boot'

const probed = (stdout: string) => (e: { argv: readonly string[] }) =>
  e.argv[0] === 'sh' && e.argv[3] === String(REMOTE_PORT) ? { exitCode: 0, stdout, stderr: '' } : undefined

test('the laptop is chosen when its listener answers, unless the person picked this machine', () => {
  const both = machineOf('linux\nmpv\nbox\nlaptop\n')
  expect(outputOf(both, undefined)).toEqual({ at: 'laptop', here: 'this PC (box)', canSwitch: true })
  expect(outputOf(both, 'here').at).toBe('here')
  // A pick of this machine that no longer plays gives way to the laptop.
  expect(outputOf(machineOf('wsl\n\nbox\nlaptop\n'), 'here')).toEqual({ at: 'laptop', here: 'this PC (box)', canSwitch: false })
  expect(outputOf(machineOf('macos\n\nmac\n'), undefined)).toEqual({ at: 'here', here: 'this Mac', canSwitch: false })
  // A probe that did not run leaves the sound to Claude Code, as before.
  expect(outputOf(machineOf(''), undefined).at).toBe('here')
  // A player the mod does not know is no player.
  expect(machineOf('linux\nvlc\nbox\n').player).toBe('')
})

test('with nothing to play on, the pane says why and what to do, and plays nothing', async ($, on) => {
  const disk = memoryDisk(on)
  const settled = settles(on)
  let plays = 0
  on('audio.play', () => {
    plays++
    return { value: undefined }
  })
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } }) as never)
  const clock = await boot($, on, { run: e => probed('wsl\n\nbox\n')(e) ?? disk.run(e) })
  const ready = settled('ready')
  await $.prompt.submit(READ)
  await clock.advance(1)
  await ready

  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /No speaker reachable from this WSL box.*\/ml-voice:remote-audio/ })).toBeDefined()
  expect(await pane.find({ key: 'output' })).toBeUndefined()
  expect(plays).toBe(0)
  await pane.unmount()
})

test('with the laptop listening, parts go to it over the forward, and o switches to this machine', async ($, on) => {
  const disk = memoryDisk(on)
  const settled = settles(on)
  const sent: string[][] = []
  on('process.spawn', async function* ($, e) {
    sent.push([...e.argv])
    yield { stream: 'stdout', text: '4242\n' }
    return { value: { code: 0, signal: null } }
  } as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: '["Here is the answer."]', usage: {} } }) as never)
  const clock = await boot($, on, { run: e => probed('linux\nmpv\nbox\nlaptop\n')(e) ?? disk.run(e) })
  const done = settled('done')
  await $.prompt.submit(READ)
  await clock.advance(1)
  await done

  expect(sent[0]?.[0]).toBe('bash')
  expect(sent[0]?.slice(-2)).toEqual(['wav', String(REMOTE_PORT)])

  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /♪ laptop \(SSH\) ⇄/ })).toBeDefined()
  await pane.press({ key: 'output' })
  expect(await pane.find({ type: 'Text', text: /♪ this PC \(box\) ⇄/ })).toBeDefined()

  // Played again, the part goes to this machine's player.
  const again = settled('done')
  await pane.press({ key: 'toggle' })
  await clock.advance(1)
  await again
  expect(sent.at(-1)?.slice(0, 5)).toEqual(['sh', '-c', 'echo $$; exec "$@"', 'sh', 'mpv'])
  await pane.unmount()

  // The pick is kept: the next read plays on this machine though the laptop still answers.
  const next = settled('done')
  await $.prompt.submit(READ)
  await clock.advance(1)
  await next
  expect(sent.at(-1)?.[4]).toBe('mpv')
})
