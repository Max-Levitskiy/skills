import { expect, test } from 'claude-code/testing'

import { withValue } from '../hooks/register'
import { matching } from '../scripts/matching'
import { PANE_PROPS, READ, boot, memoryDisk } from './boot'

type Ran = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: object): Ran => ({ exitCode: 0, stdout: JSON.stringify(stdout), stderr: '' })

const SAY_VOICES = [
  { value: 'Albert', label: 'Albert', detail: 'en_US · Hello! My name is Albert.' },
  { value: 'Alva', label: 'Alva', detail: 'sv_SE · Hej! Jag heter Alva.' },
  { value: 'Bad News', label: 'Bad News', detail: 'en_US · The light you see at the end of the tunnel.' },
]

// agent-config answering `choices`, `path` and `write` as the CLI does, the global layer kept in `global`.
function agentConfig(listed: (argv: readonly string[]) => object) {
  const calls: string[][] = []
  const written: { layer: string; config: Record<string, unknown> }[] = []
  const run = (e: { argv: readonly string[]; init?: { stdin?: string } }): Ran | undefined => {
    if (e.argv[0] !== '/bin/agent-config') return undefined
    calls.push([...e.argv])
    const layer = e.argv[e.argv.indexOf('--layer') + 1] ?? ''
    if (e.argv[1] === 'choices') return ok(listed(e.argv))
    if (e.argv[1] === 'path') return ok({ layers: [{ layer, path: `/home/test/.agents/config/voice-reader/${layer}.json`, exists: false }] })
    if (e.argv[1] === 'write') {
      written.push({ layer, config: JSON.parse(e.init?.stdin ?? '{}') })
      return ok({})
    }
    return undefined
  }
  return { calls, written, run }
}

test('the voice button lists the provider’s voices; one is heard in its own voice, then kept', async ($, on) => {
  const disk = memoryDisk(on)
  let plays = 0
  on('audio.play', () => {
    plays++
    return { value: undefined }
  })
  const ac = agentConfig(() => ({ search: 'local', choices: SAY_VOICES }))
  const says: string[][] = []
  await boot($, on, {
    plan: { ready: true, config: { voice: { provider: 'say' }, say: { voice: '' } }, provenance: {} },
    run: e => {
      if (e.argv[0] === 'say') says.push([...e.argv])
      return ac.run(e as never) ?? disk.run(e)
    },
  })
  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  await pane.press({ key: 'voices' })
  expect(ac.calls.find(argv => argv[1] === 'choices')?.slice(1, 4)).toEqual(['choices', 'voice-reader', 'say.voice'])
  expect(await pane.find({ type: 'Text', text: /now the default voice/ })).toBeDefined()

  // Matched here, letters in order: the list came whole.
  await pane.input({ key: 'search', text: 'bdnw', kind: 'change' })
  expect(await pane.find({ key: 'hear-Albert' })).toBeUndefined()
  await pane.press({ key: 'hear-Bad News' })
  expect(says.at(-1)).toContain('Bad News')
  expect(says.at(-1)?.slice(says.at(-1)!.indexOf('-v'), says.at(-1)!.indexOf('-v') + 2)).toEqual(['-v', 'Bad News'])
  expect(plays).toBe(1)
  expect(ac.written).toHaveLength(0)

  await pane.press({ key: 'use' })
  expect(ac.written).toEqual([{ layer: 'global', config: { say: { voice: 'Bad News' } } }])
  expect(await pane.find({ type: 'Text', text: /Bad News is the voice now, saved in global/ })).toBeDefined()
  await pane.press({ key: 'back' })
  expect(await pane.find({ key: 'voices' })).toBeDefined()
  await pane.unmount()
})

test('an OpenRouter model is picked first, and its voices are listed once it is kept', async ($, on) => {
  const ac = agentConfig(argv =>
    argv[3] === 'openrouter.model'
      ? { search: 'local', choices: [{ value: 'google/gemini-tts', label: 'Gemini TTS', detail: '30 voices' }] }
      : { search: 'server', choices: [{ value: 'Kore', label: 'Kore' }] },
  )
  await boot($, on, {
    plan: {
      ready: true,
      config: { voice: { provider: 'openrouter' }, openrouter: { model: 'fish-audio/drama-3', voice: '' } },
      provenance: { 'openrouter.model': 'local' },
    },
    run: e => ac.run(e as never),
  })
  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  await pane.press({ key: 'voices' })
  await pane.press({ key: 'model' })
  await pane.press({ key: 'hear-google/gemini-tts' })
  await pane.press({ key: 'use' })
  // Written where the model's value came from.
  expect(ac.written.at(-1)).toEqual({ layer: 'local', config: { openrouter: { model: 'google/gemini-tts' } } })
  expect(ac.calls.filter(argv => argv[1] === 'choices').map(argv => argv[3])).toEqual(['openrouter.voice', 'openrouter.model', 'openrouter.voice'])
  expect(await pane.find({ key: 'hear-Kore' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Gemini TTS is the model now/ })).toBeDefined()
  await pane.unmount()
})

test('a library the script searches is asked again once typing pauses', async ($, on) => {
  const ac = agentConfig(argv => {
    const search = argv.includes('--search') ? argv[argv.indexOf('--search') + 1] : ''
    return { search: 'server', choices: [{ value: `id-${search || 'top'}`, label: search ? `Voice ${search}` : 'Most used' }] }
  })
  const clock = await boot($, on, {
    plan: { ready: true, config: { voice: { provider: 'fish-audio' }, fishAudio: { model: 'drama-3', voice: '' } } },
    run: e => ac.run(e as never),
  })
  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  await pane.press({ key: 'voices' })
  await pane.input({ key: 'search', text: 'nar', kind: 'change' })
  await pane.input({ key: 'search', text: 'narrator', kind: 'change' })
  await clock.advance(400)
  const searches = ac.calls.filter(argv => argv[1] === 'choices').map(argv => (argv.includes('--search') ? argv[argv.indexOf('--search') + 1] : null))
  // The first listing has no search yet: whether the script searches is learned from its answer.
  expect(searches).toEqual([null, 'narrator'])
  // Shown as the library ranked it, though its id holds none of the letters.
  expect(await pane.find({ key: 'hear-id-narrator' })).toBeDefined()
  await pane.unmount()
})

test('with no provider set up, the voice button says how to set one up', async ($, on) => {
  await boot($, on, { plan: { ready: false, config: {} } })
  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  await pane.press({ key: 'voices' })
  expect(await pane.find({ type: 'Text', text: /run \/ml-voice:read/ })).toBeDefined()
  await pane.unmount()
})

// A say voice no layer sets, as `start` answers until one is written; then the written one.
function unchosen(ac: ReturnType<typeof agentConfig>, disk: ReturnType<typeof memoryDisk>, says: string[][]) {
  return (e: { argv: readonly string[]; init?: { stdin?: string } }) => {
    if (e.argv[0] === 'say') says.push([...e.argv])
    if (e.argv[0] === '/bin/agent-config' && e.argv[1] === 'start') {
      const voice = ac.written.at(-1)?.config.say as { voice?: string } | undefined
      const provenance = { 'voice.provider': 'global', 'say.voice': voice ? 'global' : 'default' }
      return ok({ ready: true, config: { voice: { provider: 'say' }, say: { voice: voice?.voice ?? '' } }, provenance })
    }
    return ac.run(e) ?? disk.run(e)
  }
}

test('a read whose voice no layer sets asks for one, then reads the reply in the voice used', async ($, on) => {
  const disk = memoryDisk(on)
  on('audio.play', () => ({ value: undefined }))
  const ac = agentConfig(() => ({ search: 'local', choices: SAY_VOICES }))
  const says: string[][] = []
  const clock = await boot($, on, { run: unchosen(ac, disk, says) as never })
  const out = await $.prompt.submit(READ)
  expect((out as { drop?: string }).drop).toContain('No voice is chosen yet')
  expect(says).toHaveLength(0)
  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /keep default saves the default voice/ })).toBeDefined()
  expect(await pane.find({ key: 'back' })).toBeUndefined()

  await pane.press({ key: 'hear-Alva' })
  await pane.press({ key: 'use' })
  expect(ac.written).toEqual([{ layer: 'global', config: { say: { voice: 'Alva' } } }])
  await clock.advance(1)
  expect(await pane.find({ type: 'Text', text: /macOS say Alva · reply 1/ })).toBeDefined()
  // The next read takes the voice saved, without asking.
  expect(((await $.prompt.submit(READ)) as { drop?: string }).drop).toContain('Reading reply 1')
  await pane.unmount()
})

test('keep default saves the default voice, so the read is not asked about again; not now asks again', async ($, on) => {
  const disk = memoryDisk(on)
  const ac = agentConfig(() => ({ search: 'local', choices: SAY_VOICES }))
  const says: string[][] = []
  const clock = await boot($, on, { run: unchosen(ac, disk, says) as never })
  const pane = await $.ui.mount({ plugin: 'ml-voice', surface: 'terminal', component: 'Pane', requestId: 'ml-voice', props: PANE_PROPS })

  await $.prompt.submit(READ)
  await pane.press({ key: 'later' })
  expect(ac.written).toHaveLength(0)
  await clock.advance(1)
  expect(await pane.find({ type: 'Text', text: /macOS say · reply 1/ })).toBeDefined()

  expect(((await $.prompt.submit(READ)) as { drop?: string }).drop).toContain('No voice is chosen yet')
  await pane.press({ key: 'keep' })
  expect(ac.written).toEqual([{ layer: 'global', config: { say: { voice: '' } } }])
  expect(((await $.prompt.submit(READ)) as { drop?: string }).drop).toContain('Reading reply 1')
  await pane.unmount()
})

test('a key is set inside a copy of the config; matching takes letters in order', () => {
  const config = { say: { voice: 'Albert' }, cache: { dir: '/c' } }
  expect(withValue(config, 'say.voice', 'Alva')).toEqual({ say: { voice: 'Alva' }, cache: { dir: '/c' } })
  expect(config.say.voice).toBe('Albert')
  expect(withValue({}, 'openrouter.model', 'x')).toEqual({ openrouter: { model: 'x' } })
  expect(matching(SAY_VOICES, 'alv').map(one => one.value)).toEqual(['Alva'])
  expect(matching(SAY_VOICES, '')).toHaveLength(3)
})
