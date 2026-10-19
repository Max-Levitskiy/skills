// PROTOTYPE, throwaway. The question it answers: does a read-aloud pane over
// Claude's latest reply feel right, with the part being read highlighted, a
// click on any part jumping there, Haiku rewriting the reply as talk, and
// Fish Audio drama-3 as the voice?
import { atom, read, update } from 'claude-code'
import type { FsEntry, Register } from 'claude-code'

import type { Block, Reader } from '../types'

const PANE = 'ml-voice'
const READER = { plugin: 'ml-voice', key: 'reader' } as const
// The skill the person types; the mod answers it before it is rendered.
const SKILL = 'ml-voice:read'
const EMPTY: Reader = {
  blocks: [],
  current: 0,
  status: 'idle',
  view: 'source',
  backend: '',
  usage: { requests: 0, chars: 0, cost: 0, total: 0, isPaid: false },
  mode: 'reader',
  replies: [],
  replyIndex: -1,
  isPaneOpen: false,
}
const reader = atom(READER, EMPTY)

// The state outlives reloads of this module, so a value an older version
// wrote can lack fields this one reads: every field gets its default back.
const settled = (r: Partial<Reader> | undefined): Reader => ({
  ...EMPTY,
  ...r,
  usage: { ...EMPTY.usage, ...r?.usage },
  replies: r?.replies ?? [],
})

// ---------------------------------------------------------------- splitting

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/

function sentences(body: string): string[] {
  if (body.length <= 240) return [body]
  const parts = body.split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z`*"(\[])/)
  const out: string[] = []
  let cur = ''
  for (const part of parts) {
    if (cur && cur.length + part.length > 220) {
      out.push(cur.trim())
      cur = ''
    }
    cur += part + ' '
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function split(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  const at = (j: number) => lines[j] ?? ''
  let para: string[] = []
  const flush = () => {
    const body = para.join(' ').trim()
    para = []
    if (body) for (const s of sentences(body)) blocks.push({ kind: 'prose', source: s })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = at(i)
    if (/^\s*```/.test(line)) {
      flush()
      const start = i++
      while (i < lines.length && !/^\s*```/.test(at(i))) i++
      blocks.push({ kind: 'code', source: lines.slice(start, i + 1).join('\n') })
    } else if (/^\s*\|/.test(line)) {
      flush()
      const start = i
      while (i + 1 < lines.length && /^\s*\|/.test(at(i + 1))) i++
      blocks.push({ kind: 'table', source: lines.slice(start, i + 1).join('\n') })
    } else if (/^#{1,6}\s/.test(line)) {
      flush()
      blocks.push({ kind: 'heading', source: line.trim() })
    } else if (LIST_ITEM.test(line)) {
      flush()
      const item = [line.trimEnd()]
      while (i + 1 < lines.length && /^\s{2,}\S/.test(at(i + 1)) && !LIST_ITEM.test(at(i + 1))) {
        item.push(at(++i).trim())
      }
      blocks.push({ kind: 'list', source: item.join(' ') })
    } else if (!line.trim() || /^\s*(---|\*\*\*)\s*$/.test(line)) {
      flush()
    } else {
      para.push(line.trim())
    }
  }
  flush()
  return blocks
}

type Message = { role: string; text: string; toolResults?: unknown[] }
export type Reply = { prompt: string; text: string }

// A reply is every assistant text between two of the person's prompts: text
// written before tool calls belongs to the same reply. Oldest first.
export function replies(messages: Message[]): Reply[] {
  const all: Reply[] = []
  let at: Reply | undefined
  for (const m of messages) {
    if (m.role === 'user' && !m.toolResults?.length) {
      at = { prompt: m.text, text: '' }
      all.push(at)
    } else if (m.role === 'assistant' && m.text.trim()) {
      if (!at) all.push((at = { prompt: '', text: '' }))
      at.text = at.text ? `${at.text}\n\n${m.text}` : m.text
    }
  }
  return all.filter(r => r.text.trim())
}

export const latestReply = (messages: Message[]) => replies(messages).at(-1)?.text ?? ''

const oneLine = (text: string, max: number) => {
  const line = text.replace(/<[^>]+>/g, ' ').replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// ---------------------------------------------------------------- narration

const NARRATE = `You turn a written chat reply into a script that is read aloud by a text-to-speech voice.
The input is a JSON array of the reply's parts, in order. Answer with ONLY a JSON array of strings: exactly one string per part, same order, same length.

How each string should sound:
- Like a colleague talking you through it across the desk: natural spoken English, contractions, short sentences. Keep the meaning and every fact; don't summarise prose away and don't add facts.
- No markdown, emoji, bullets or symbols that a voice would read literally. Say "and", "to", "about" instead of &, →, ~.
- File paths: say just the file or folder name the way a person would ("the register dot tsx file"). URLs: name the site. Long ids and hashes: describe them ("a commit hash").
- code: never read the code. In one to three sentences say what it is and what it does; for a shell command, what running it does.
- table: say what it compares and the takeaway, naming the rows that matter. Never read it cell by cell.
- diagram (ASCII art or mermaid in a code block): walk through the flow in words.
- heading: a short spoken transition ("Now, the risks."), or "" if the next part already says it.
- list: say the item as a sentence; a light connector ("Also,", "Then") is fine.
- An empty string for a part that carries nothing when heard.`

const COMPACT = `
Compact mode: the listener wants only what matters, not the whole reply.
- Keep decisions, results, conclusions, numbers, risks, and anything the listener must do or answer.
- Give "" for a part that is background, a restatement, an example, a minor caveat, or detail they can read later.
- Cut every kept part to its essence: one or two short sentences.
- A code, table or diagram part gets one sentence at most, or "" when it only backs a point made elsewhere.
- Read in order, the parts you keep must still make sense on their own.`

function plain(block: Block): string {
  if (block.kind === 'code') return 'There is a code block here.'
  if (block.kind === 'table') return 'There is a table here.'
  return block.source
    .replace(/[#*_`>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*([-+]|\d+[.)])\s/, '')
    .trim()
}

const spokenOf = (block: Block) => (block.spoken ?? plain(block)).trim()

let narrator = 'haiku'
let style: 'full' | 'compact' = 'full'
let autoStart = true

function narration(blocks: Block[]) {
  const parts = blocks.map(b => ({ kind: b.kind, text: b.source }))
  const chars = parts.reduce((n, p) => n + p.text.length, 0)
  return {
    model: narrator,
    system: style === 'compact' ? NARRATE + COMPACT : NARRATE,
    prompt: JSON.stringify(parts),
    maxTokens: Math.min(32000, 1024 + Math.ceil(chars / 2)),
    effort: 'low',
  } as const
}

export function parseSpoken(text: string, blocks: Block[]): string[] | undefined {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  try {
    const spoken: unknown = JSON.parse(text.slice(start, end + 1))
    if (Array.isArray(spoken) && spoken.length === blocks.length && spoken.every(s => typeof s === 'string')) {
      return spoken
    }
  } catch {}
  return undefined
}

// ---------------------------------------------------------------- voices

// Every provider but macOS say is one HTTP POST answered with MP3 bytes; they
// differ in URL, headers and the body's field names.
// `billing` says how a paid provider reports cost: OpenRouter per generation,
// Fish Audio not at all (its characters are logged instead).
type Billing = 'openrouter' | 'chars' | 'free'
type Voice =
  | {
      kind: 'http'
      name: string
      model: string
      url: string
      key?: string
      headers: string[]
      body: Record<string, string>
      textField: string
      billing: Billing
    }
  | { kind: 'say'; name: string; model: string; billing: 'free' }

const SAY: Voice = { kind: 'say', name: 'macOS say', model: 'say', billing: 'free' }
const AC_FIND =
  'command -v agent-config || ls -d "$HOME"/.claude/plugins/cache/*/ml-agent-config/*/bin/agent-config 2>/dev/null | sort -V | tail -1'

type Provider = 'fish-audio' | 'openrouter' | 'kokoro' | 'self-hosted' | 'say'
type Endpoint = { model?: string; voice?: string; url?: string }

// What agent-config's voice-reader namespace holds (agent-config.json declares it).
type VoiceConfig = {
  voice?: { provider?: Provider }
  narration?: { model?: string; style?: 'full' | 'compact' }
  playback?: { autoStart?: boolean }
  fishAudio?: Endpoint
  openrouter?: Endpoint
  kokoro?: Endpoint
  selfHosted?: Endpoint
  usage?: { log?: string }
  cache?: { dir?: string; maxAgeDays?: number; maxSizeMB?: number }
}

// The provider's secret, by its credentials key; the rest of the voice is config.
const KEYED: Partial<Record<Provider, string>> = {
  'fish-audio': 'credentials.fishAudioKey',
  openrouter: 'credentials.openrouterKey',
}

const openAiShaped = (name: string, url: string, at: Endpoint, key?: string, billing: Billing = 'free'): Voice => ({
  kind: 'http',
  name,
  model: at.model ?? '',
  billing,
  url,
  key,
  headers: [],
  body: { model: at.model ?? '', response_format: 'mp3', ...(at.voice ? { voice: at.voice } : {}) },
  textField: 'input',
})

function voiceOf(config: VoiceConfig, key?: string): Voice {
  const provider = config.voice?.provider
  if (provider === 'fish-audio') {
    const at = config.fishAudio ?? {}
    return {
      kind: 'http',
      name: `Fish Audio ${at.model}`,
      model: at.model ?? '',
      billing: 'chars',
      url: 'https://api.fish.audio/v1/tts',
      key,
      headers: [`model: ${at.model}`],
      body: { format: 'mp3', latency: 'normal', ...(at.voice ? { reference_id: at.voice } : {}) },
      textField: 'text',
    }
  }
  if (provider === 'openrouter') {
    const at = config.openrouter ?? {}
    return openAiShaped(`OpenRouter ${at.model}`, 'https://openrouter.ai/api/v1/audio/speech', at, key, 'openrouter')
  }
  if (provider === 'kokoro') {
    const at = config.kokoro ?? {}
    return openAiShaped('Kokoro', at.url ?? '', { model: 'kokoro', voice: at.voice })
  }
  if (provider === 'self-hosted') {
    const at = config.selfHosted ?? {}
    return openAiShaped(`${at.model} (self-hosted)`, at.url ?? '', at)
  }
  return SAY
}

const mimeOf = (v: Voice) => (v.kind === 'say' ? 'audio/wav' : 'audio/mpeg')
const extOf = (v: Voice) => (v.kind === 'say' ? 'wav' : 'mp3')
const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

// The key goes in curl's config on stdin, never in argv.
function curlConfig(v: Voice & { kind: 'http' }, body: string, out: string): string {
  return [
    `url = ${quote(v.url)}`,
    `header = "Content-Type: application/json"`,
    ...v.headers.map(h => `header = ${quote(h)}`),
    v.key ? `header = ${quote(`Authorization: Bearer ${v.key}`)}` : '',
    `data-binary = ${quote(`@${body}`)}`,
    `output = ${quote(out)}`,
    `dump-header = ${quote(`${out}.headers`)}`,
  ].join('\n')
}

// ---------------------------------------------------------------- playback

// Module state; the engine-facing functions are made in session.start, where
// $ is in scope (a hooks module never passes $ around).
let voice: Voice = SAY
let usageLog = ''
let recording: Promise<void> = Promise.resolve()
let doc = 0
let run = 0
let playing: AbortController | undefined
// Audio and narrations are kept on disk by a hash of what made them, so a
// reply read again, in this session or a later one, costs nothing; `clips`
// joins the requests for one file that are in flight at once.
let cacheDir = ''
let isSwept = false
const clips = new Map<string, Promise<string>>()
const DAY = 86_400_000

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// Everything that changes the sound, and nothing secret: the key is left out.
const soundOf = (v: Voice, text: string) =>
  v.kind === 'say' ? ['say', text] : [v.url, v.model, v.headers, v.body, v.textField, text]

type Policy = { maxAgeDays: number; maxSizeMB: number }
type Cached = { path: string; size: number; mtimeMs: number }

// Which cached files the policy deletes: those unplayed for maxAgeDays, then
// the least recently played until the rest fit in maxSizeMB. 0 turns a limit off.
export function expired(files: Cached[], policy: Policy, now: number): string[] {
  const doomed = new Set<string>()
  if (policy.maxAgeDays > 0) {
    for (const f of files) if (f.mtimeMs < now - policy.maxAgeDays * DAY) doomed.add(f.path)
  }
  if (policy.maxSizeMB > 0) {
    let kept = 0
    for (const f of [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
      if (doomed.has(f.path)) continue
      kept += f.size
      if (kept > policy.maxSizeMB * 1024 * 1024) doomed.add(f.path)
    }
  }
  return [...doomed]
}

function stop() {
  run++
  playing?.abort()
  playing = undefined
}

// Made in session.start, the one place $ lives for the session's length.
let playFrom: (start: number) => Promise<void> = async () => {}
let narrateThenPlay: (mine: number) => Promise<void> = async () => {}
let pause: () => Promise<void> = async () => {}
let halt: () => Promise<void> = async () => {}
let readAloud: (reply: Reply, index: number) => Promise<{ isReading: boolean; text: string }> = async () => ({
  isReading: false,
  text: 'voice-reader is still starting.',
})

const dollars = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`

function spent(u: Reader['usage']): string {
  const reply = `this reply ${dollars(u.cost)} for ${u.chars.toLocaleString('en')} characters`
  return `Paid API: ${reply} · all time ${dollars(u.total)} · log: ${usageLog.replace(/^.*\/\.agents\//, '~/.agents/')}`
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, reader, settled)
    const remove = (paths: string[]) => $.process.run(['rm', '-f', '--', ...paths]).catch(() => undefined)

    // Made in work/ and moved into audio/ whole, so a failed or cut-off
    // request never leaves a file the cache would play.
    const synth = async (text: string, file: string) => {
      const work = `${cacheDir}/work/${crypto.randomUUID()}`
      const out = `${work}.${extOf(voice)}`
      const done = ['sh', '-c', 'mkdir -p "$(dirname "$1")" && mv -f "$0" "$1"', out, file]
      if (voice.kind === 'say') {
        await $.fs.write(`${work}.txt`, text)
        const ran = await $.process.run(['say', '-o', out, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', `${work}.txt`])
        await remove([`${work}.txt`])
        if (ran.exitCode !== 0) throw new Error(`say: ${ran.stderr.trim()}`)
        await $.process.run(done)
        return
      }
      const body = `${work}.json`
      await $.fs.write(body, JSON.stringify({ ...voice.body, [voice.textField]: text }))
      const ran = await $.process.run(['curl', '-sS', '--fail-with-body', '-K', '-'], {
        stdin: curlConfig(voice, body, out),
        timeoutMs: 120_000,
      })
      await remove([body])
      if (ran.exitCode !== 0) {
        const said = await $.fs.read(out).catch(() => '')
        await remove([out, `${out}.headers`])
        throw new Error(`${voice.name}: ${ran.stderr.trim()} ${said.slice(0, 300)}`)
      }
      await $.process.run(done)
      if (voice.billing === 'free') {
        await remove([`${out}.headers`])
        return
      }
      const paid = voice
      recording = recording.then(() => record(paid, text.length, `${out}.headers`)).catch(() => {})
    }

    // One line per paid request in the usage log, the reply's and the
    // all-time totals in the pane. OpenRouter states each generation's cost a
    // moment after it is made; Fish Audio states none.
    const record = async (paid: Voice & { kind: 'http' }, chars: number, headers: string) => {
      const said = await $.fs.read(headers).catch(() => '')
      const generation = /^x-generation-id:\s*(\S+)/im.exec(said)?.[1]
      let cost: number | null = null
      for (let tries = 0; generation && paid.billing === 'openrouter' && cost === null && tries < 6; tries++) {
        await $.clock.sleep(1500)
        const stats = await $.http
          .fetch(`https://openrouter.ai/api/v1/generation?id=${generation}`, { headers: { Authorization: `Bearer ${paid.key}` } })
          .catch(() => undefined)
        if (stats?.ok) cost = (JSON.parse(stats.text) as { data?: { total_cost?: number } }).data?.total_cost ?? null
      }
      await remove([headers])
      const at = new Date(await $.clock.now()).toISOString()
      const line = JSON.stringify({ at, provider: paid.name, model: paid.model, chars, cost, generation })
      await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$0")" && cat >> "$0"', usageLog], { stdin: `${line}\n` })
      const total = Number((await $.store.get('totalCost')) ?? 0) + (cost ?? 0)
      await $.store.set('totalCost', total)
      await update($, reader, (s): Reader => ({
        ...s,
        usage: { ...s.usage, requests: s.usage.requests + 1, chars: s.usage.chars + chars, cost: s.usage.cost + (cost ?? 0), total },
      }))
    }

    // A file played again is touched, so the cleanup counts age from its last play.
    const clip = async (text: string): Promise<string> => {
      const file = `${cacheDir}/audio/${await digest(soundOf(voice, text))}.${extOf(voice)}`
      let made = clips.get(file)
      if (!made) {
        made = $.fs.exists(file).then(async isKept => {
          if (isKept) await $.process.run(['touch', file])
          else await synth(text, file)
          return file
        })
        made.catch(() => clips.delete(file))
        clips.set(file, made)
      }
      return made
    }

    // Deletes what the cache policy no longer keeps; once a session, in the
    // background. Files in work/ are only ever half made, so a day is enough.
    const sweep = async (policy: Policy) => {
      // Before the cache, clips lived a session at a time under TMPDIR.
      const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/$/, '')
      await $.process.run(['rm', '-rf', '--', `${tmp}/voice-reader`])
      const now = await $.clock.now()
      const listed = async (dir: string): Promise<Cached[]> =>
        ((await $.fs.list(`${cacheDir}/${dir}`).catch(() => [])) as FsEntry[])
          .filter(f => f.kind === 'file')
          .map(f => ({ path: `${cacheDir}/${dir}/${f.name}`, size: f.size, mtimeMs: f.mtimeMs }))
      const doomed = [
        ...expired([...(await listed('audio')), ...(await listed('narration'))], policy, now),
        ...expired(await listed('work'), { maxAgeDays: 1, maxSizeMB: 0 }, now),
      ]
      for (let i = 0; i < doomed.length; i += 200) await remove(doomed.slice(i, i + 200))
    }

    playFrom = async start => {
      stop()
      const mine = run
      const control = new AbortController()
      playing = control
      for (let k = Math.max(0, start); ; k++) {
        const r = await read($, reader)
        if (mine !== run) return
        if (k >= r.blocks.length) {
          await update($, reader, (s): Reader => ({ ...s, status: 'done' }))
          return
        }
        await update($, reader, (s): Reader => ({ ...s, current: k, status: 'playing' }))
        const block = r.blocks[k]
        const text = block ? spokenOf(block) : ''
        if (!text) continue
        let file: string
        try {
          file = await clip(text)
        } catch (err) {
          if (mine === run) await update($, reader, (s): Reader => ({ ...s, status: 'error', note: String(err) }))
          return
        }
        const following = r.blocks[k + 1]
        if (following && spokenOf(following)) clip(spokenOf(following)).catch(() => {})
        if (mine !== run) return
        const { base64 } = await $.fs.read(file, { as: 'bytes' })
        if (mine !== run) return
        await $.audio.play({ base64, mime: mimeOf(voice) }, { signal: control.signal })
        if (mine !== run) return
      }
    }

    narrateThenPlay = async mine => {
      const { blocks } = await read($, reader)
      const asked = narration(blocks)
      const file = `${cacheDir}/narration/${await digest(asked)}.json`
      let spoken = await $.fs.read(file).then(t => parseSpoken(t as string, blocks), () => undefined)
      if (spoken) await $.process.run(['touch', file])
      else {
        const reply = await $.model.complete(asked)
        spoken = reply.isAnswered ? parseSpoken(reply.text, blocks) : undefined
        if (spoken) await $.fs.write(file, JSON.stringify(spoken))
      }
      if (mine !== doc) return
      await update($, reader, (s): Reader => ({
        ...s,
        blocks: s.blocks.map((b, i) => ({ ...b, spoken: spoken?.[i] ?? plain(b) })),
        note: spoken ? undefined : 'Haiku narration failed; reading a plain cleanup.',
      }))
      // A click during narration already started playback; leave it be.
      if ((await read($, reader)).status !== 'narrating') return
      if (autoStart) await playFrom(0)
      else await update($, reader, (s): Reader => ({ ...s, status: 'ready' }))
    }

    pause = async () => {
      stop()
      await update($, reader, (s): Reader => ({ ...s, status: 'paused' }))
    }

    // Stop ends the reading: the band above the prompt goes away with it.
    // Audio already made stays cached, so playing again costs nothing more.
    halt = async () => {
      stop()
      await update($, reader, (s): Reader => ({ ...s, status: 'stopped' }))
    }

    // Loads the voice from agent-config and starts reading `reply`: what
    // /ml-voice:read and the pane's list of earlier replies both run.
    readAloud = async (reply, index) => {
      // The voice is agent-config's voice-reader namespace; the first /ml-voice:read onboards.
      const found = await $.process.run(['sh', '-c', AC_FIND])
      const ac = found.stdout.trim().split('\n').at(-1) ?? ''
      if (!ac) return { isReading: false, text: 'voice-reader needs the ml-agent-config plugin to choose a voice; install it and run /ml-voice:read again.' }
      const started = await $.process.run([ac, 'start', 'voice-reader', '--from', $.plugin.root])
      const plan = JSON.parse(started.stdout || '{}') as { ready?: boolean; guide?: string; config?: VoiceConfig }
      if (started.exitCode !== 0 || !plan.ready || !plan.config) {
        // A command's own hook cannot queue a prompt (it would wait on this
        // turn); a timer submits it once the command has answered.
        const setup =
          'Set up voice-reader, the /ml-voice:read read-aloud pane: `agent-config start voice-reader` below is not ready. ' +
          `Read ${plan.guide ?? 'the agent-config guide'} and work its actions with \`${ac}\`, ` +
          `passing \`--from ${$.plugin.root}\`. Then tell me to run /ml-voice:read again.\n\n` +
          '```json\n' + (started.stdout || started.stderr).trim() + '\n```'
        $.clock.after(0, () => void $.prompt.submit({ text: setup }))
        return { isReading: false, text: 'voice-reader has no voice chosen yet; Claude will set it up with you now.' }
      }
      const config = plan.config
      narrator = config.narration?.model ?? 'haiku'
      style = config.narration?.style ?? 'full'
      autoStart = config.playback?.autoStart ?? true
      const secretKey = KEYED[config.voice?.provider ?? 'say']
      let key: string | undefined
      if (secretKey) {
        const secret = await $.process.run(['sh', '-c', `"$0" load voice-reader --from "$1" --secrets ${secretKey} 3>&1 1>/dev/null`, ac, $.plugin.root])
        if (secret.exitCode !== 0) return { isReading: false, text: `voice-reader could not read ${secretKey}: ${secret.stderr.trim()}` }
        key = (JSON.parse(secret.stdout) as Record<string, string>)[secretKey]
      }
      voice = voiceOf(config, key)
      const home = (await $.env.get('HOME')) ?? ''
      const expand = (path: string) => path.replace(/^~(?=\/)/, home).replace(/\/$/, '')
      usageLog = expand(config.usage?.log ?? '~/.agents/voice-reader/usage.jsonl')
      cacheDir = expand(config.cache?.dir ?? '~/.cache/voice-reader')
      if (!isSwept) {
        isSwept = true
        const policy = { maxAgeDays: config.cache?.maxAgeDays ?? 30, maxSizeMB: config.cache?.maxSizeMB ?? 500 }
        $.clock.after(0, () => void sweep(policy).catch(() => {}))
      }

      stop()
      doc++
      clips.clear()
      const blocks = split(reply.text)
      const total = Number((await $.store.get('totalCost')) ?? 0)
      await $.state.set(READER, {
        blocks,
        current: 0,
        status: 'narrating',
        view: 'source',
        backend: style === 'compact' ? `${voice.name} · compact` : voice.name,
        usage: { requests: 0, chars: 0, cost: 0, total, isPaid: voice.billing !== 'free' },
        mode: 'reader',
        replies: (await read($, reader)).replies,
        replyIndex: index,
        isPaneOpen: (await read($, reader)).isPaneOpen ?? false,
      })
      const mine = doc
      $.clock.after(0, () => void narrateThenPlay(mine))
      return { isReading: true, text: `Reading reply ${index + 1} aloud (${blocks.length} parts, ${voice.name}).` }
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stop()
    return next(e)
  })

  // /ml-voice:read is a skill, so its name follows the marketplace's
  // /ml-<domain>:<skill>; the mod answers it here and drops it before it is
  // rendered, so no turn runs and the reply list gains no entry for it.
  on('prompt.submit', async ($, e, next) => {
    if (e.command?.name !== SKILL) return next(e)
    const all = replies(await $.session.messages())
    const latest = all.at(-1)
    if (!latest) return { drop: 'There is no reply to read yet.' }
    const started = await readAloud(latest, all.length - 1)
    if (started.isReading) {
      const opened = await $.ui.open({ id: PANE, title: 'Voice', focus: true })
      await update($, reader, (s): Reader => ({ ...s, isPaneOpen: opened.isPlaced }))
    }
    return { drop: started.text }
  })

  // The band stands in for the pane: it hides while the pane is open.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, reader, (s): Reader => ({ ...settled(s), isPaneOpen: false }))
    return next(e)
  })

  // While anything is being read, a row above the prompt keeps the controls in
  // reach whether the pane is open, docked away or closed.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = settled(await read($, reader))
    const isActive = r.status === 'narrating' || r.status === 'ready' || r.status === 'playing' || r.status === 'paused'
    if (!isActive || r.isPaneOpen || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isPlaying = r.status === 'playing'
    const where =
      r.status === 'narrating'
        ? 'preparing'
        : r.status === 'ready'
          ? 'ready'
          : `${isPlaying ? 'reading' : 'paused at'} part ${r.current + 1}/${r.blocks.length}`
    const reply = r.replyIndex >= 0 ? `reply ${r.replyIndex + 1}` : 'reply'
    const cost = r.usage.isPaid ? ` · ${dollars(r.usage.cost)}` : ''
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="claude">♪</Text>
        <Text dimColor>
          {reply} · {where}{cost}
        </Text>
        <Button key="band-toggle" variant="primary" label={isPlaying ? 'pause' : 'play'}
          onPress={() => (isPlaying ? pause() : $.clock.after(0, () => void playFrom(r.current)))} />
        <Button key="band-stop" label="stop" onPress={() => halt()} />
        <Button key="band-open" label="open" onPress={async () => {
          const opened = await $.ui.open({ id: PANE, title: 'Voice', focus: true })
          await update($, reader, (s): Reader => ({ ...s, isPaneOpen: opened.isPlaced }))
        }} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = settled(await read($, reader))
    const go = (k: number) => {
      $.clock.after(0, () => void playFrom(Math.min(k, r.blocks.length - 1)))
    }
    const openList = async () => {
      const all = replies(await $.session.messages())
      const shown = all.map(one => ({ prompt: oneLine(one.prompt, 90) || '(no prompt)', preview: oneLine(one.text, 140) }))
      await update($, reader, (s): Reader => ({ ...s, mode: 'picker', replies: shown }))
    }
    // The reply's full text is read again at the pick: the list holds previews.
    const pick = async (index: number) => {
      const chosen = replies(await $.session.messages())[index]
      if (!chosen) return
      $.clock.after(0, async () => {
        const started = await readAloud(chosen, index)
        if (!started.isReading) await update($, reader, (s): Reader => ({ ...s, mode: 'reader', note: started.text }))
      })
    }

    if (r.mode === 'picker') {
      const newestFirst = r.replies.map((one, index) => ({ ...one, index })).reverse().slice(0, 40)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" hotkey="b" label="back" onPress={() => update($, reader, (s): Reader => ({ ...s, mode: 'reader' }))} />
          </Box>
          <Text dimColor>Pick a reply to read · {r.replies.length} in this session, newest first</Text>
          {newestFirst.map(one => (
            <Box key={`reply-${one.index}`} flexDirection="column" marginTop={1}>
              <Button key={`pick-${one.index}`} plain onPress={() => pick(one.index)}>
                <Text weight="bold" color={one.index === r.replyIndex ? 'claude' : undefined} hover={{ underline: true }}>
                  {one.index === r.replyIndex ? '▶ ' : ''}{one.index + 1}. {one.prompt}
                </Text>
              </Button>
              <Text dimColor>{one.preview}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    const isPlaying = r.status === 'playing'
    const status = {
      idle: 'Nothing loaded. Run /ml-voice:read.',
      narrating: style === 'compact' ? 'Haiku is picking out what matters…' : 'Haiku is rewriting the reply as talk…',
      ready: 'Ready. Press play.',
      playing: `Reading part ${r.current + 1} of ${r.blocks.length}`,
      paused: `Paused at part ${r.current + 1} of ${r.blocks.length}`,
      stopped: 'Stopped.',
      done: 'Finished.',
      error: 'Stopped on an error.',
    }[r.status]

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="toggle" hotkey="p" variant="primary" label={isPlaying ? 'pause' : 'play'}
            onPress={() => (isPlaying ? pause() : go(r.status === 'done' ? 0 : r.current))} />
          <Button key="stop" hotkey="s" label="stop" onPress={() => halt()} />
          <Button key="prev" hotkey="k" label="prev" onPress={() => go(r.current - 1)} />
          <Button key="next" hotkey="j" label="next" onPress={() => go(r.current + 1)} />
          <Button key="view" hotkey="v" label={r.view === 'source' ? 'show spoken' : 'show original'}
            onPress={() => update($, reader, (s): Reader => ({ ...s, view: s.view === 'source' ? 'spoken' : 'source' }))} />
          <Button key="replies" hotkey="r" label="earlier replies" onPress={openList} />
        </Box>
        <Text dimColor>{status} · {r.backend}{r.replyIndex >= 0 ? ` · reply ${r.replyIndex + 1} of ${Math.max(r.replies.length, r.replyIndex + 1)}` : ''}</Text>
        {r.usage.isPaid && <Text dimColor>{spent(r.usage)}</Text>}
        {r.note && <Text color="error">{r.note}</Text>}
        {r.blocks.map((b, k) => {
          const isCurrent = k === r.current && r.status !== 'idle' && r.status !== 'narrating'
          const shown = r.view === 'spoken' && b.spoken !== undefined ? b.spoken || '(skipped)' : b.source
          return (
            <Box key={`part-${k}`} marginTop={b.kind === 'heading' ? 1 : 0}>
              <Button key={`block-${k}`} plain onPress={() => go(k)}>
                <Text
                  color={isCurrent ? 'claude' : undefined}
                  inverse={isCurrent}
                  weight={b.kind === 'heading' ? 'bold' : undefined}
                  dimColor={!isCurrent && (b.kind === 'code' || b.spoken === '')}
                  hover={{ underline: true }}
                >
                  {shown}
                </Text>
              </Button>
            </Box>
          )
        })}
      </Box>
    )
  })
}
