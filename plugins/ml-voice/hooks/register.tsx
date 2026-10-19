// ml-voice: /ml-voice:read reads Claude's replies aloud in a pane. Haiku first
// retells the reply as talk, the part being read is highlighted, a click on
// any part jumps there, and a band above the prompt keeps pause and stop in
// reach while the pane is out of sight. The voice is agent-config's
// voice-reader namespace; audio and narrations are cached on disk.
import { atom, read, update } from 'claude-code'
import type { FsEntry, Register } from 'claude-code'

import type { Billing, Block, Reader } from '../types'

const PANE = 'ml-voice'
// The skill the person types; the mod answers it before it is rendered.
const SKILL = 'ml-voice:read'
const EMPTY: Reader = {
  blocks: [],
  current: 0,
  status: 'idle',
  view: 'source',
  backend: '',
  usage: { chars: 0, cost: 0, total: 0, billing: 'free' },
  mode: 'reader',
  replyIndex: -1,
}
// Bump the shape when Reader changes: a value an older version wrote then reads as absent.
const reader = atom({ plugin: 'ml-voice', key: 'reader' } as const, EMPTY, { shape: 'reader-2' })

// ---------------------------------------------------------------- splitting

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/
const MARKS = /[#*_`>|]/g

// A run-on stretch with no sentence end is cut between words, so no part
// outgrows what a speech API takes in one request.
function pieces(part: string): string[] {
  if (part.length <= 240) return [part]
  const out: string[] = []
  let cur = ''
  // A token longer than a part (a URL, an encoded value) is cut wherever it must be.
  const words = part.split(/\s+/).flatMap(word => word.match(/.{1,220}/g) ?? [])
  for (const word of words) {
    if (cur && cur.length + word.length + 1 > 220) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur} ${word}` : word
  }
  if (cur) out.push(cur)
  return out
}

function sentences(body: string): string[] {
  if (body.length <= 240) return [body]
  const parts = body.split(/(?<=[.!?]["')\]]?)\s+(?=[A-Z`*"(\[])/).flatMap(pieces)
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
  const lineAt = (j: number) => lines[j] ?? ''
  let para: string[] = []
  const flush = () => {
    const body = para.join(' ').trim()
    para = []
    if (body) for (const s of sentences(body)) blocks.push({ kind: 'prose', source: s })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lineAt(i)
    if (/^\s*```/.test(line)) {
      flush()
      const start = i++
      while (i < lines.length && !/^\s*```/.test(lineAt(i))) i++
      blocks.push({ kind: 'code', source: lines.slice(start, i + 1).join('\n') })
    } else if (/^\s*\|/.test(line)) {
      flush()
      const start = i
      while (i + 1 < lines.length && /^\s*\|/.test(lineAt(i + 1))) i++
      blocks.push({ kind: 'table', source: lines.slice(start, i + 1).join('\n') })
    } else if (/^#{1,6}\s/.test(line)) {
      flush()
      blocks.push({ kind: 'heading', source: line.trim() })
    } else if (LIST_ITEM.test(line)) {
      flush()
      const item = [line.trimEnd()]
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lineAt(i + 1)) && !LIST_ITEM.test(lineAt(i + 1))) {
        item.push(lineAt(++i).trim())
      }
      for (const s of sentences(item.join(' '))) blocks.push({ kind: 'list', source: s })
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
type Reply = { prompt: string; text: string }

// A reply is every assistant text between two of the person's prompts: text
// written before tool calls belongs to the same reply. Oldest first.
export function replies(messages: Message[]): Reply[] {
  const all: Reply[] = []
  let last: Reply | undefined
  for (const m of messages) {
    if (m.role === 'user' && !m.toolResults?.length) {
      last = { prompt: m.text, text: '' }
      all.push(last)
    } else if (m.role === 'assistant' && m.text.trim()) {
      if (!last) all.push((last = { prompt: '', text: '' }))
      last.text = last.text ? `${last.text}\n\n${m.text}` : m.text
    }
  }
  return all.filter(r => r.text.trim())
}

const oneLine = (text: string, max: number) => {
  const line = text.replace(/<[^>]+>/g, ' ').replace(MARKS, '').replace(/\s+/g, ' ').trim()
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
    .replace(MARKS, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*([-+]|\d+[.)])\s/, '')
    .trim()
}

const spokenOf = (block: Block) => (block.spoken ?? plain(block)).trim()

function narration(blocks: Block[], s: Settings) {
  const parts = blocks.map(b => ({ kind: b.kind, text: b.source }))
  const chars = parts.reduce((n, p) => n + p.text.length, 0)
  return {
    model: s.narrator,
    system: s.style === 'compact' ? NARRATE + COMPACT : NARRATE,
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
      ext: 'mp3'
      mime: 'audio/mpeg'
    }
  | { kind: 'say'; name: string; model: string; billing: 'free'; ext: 'wav'; mime: 'audio/wav' }

const SAY: Voice = { kind: 'say', name: 'macOS say', model: 'say', billing: 'free', ext: 'wav', mime: 'audio/wav' }

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
  credentials?: Record<string, unknown>
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
  ext: 'mp3',
  mime: 'audio/mpeg',
})

// Each provider: the credentials key holding its secret, if any, and its voice.
const PROVIDERS: Record<Provider, { secret?: string; voice: (config: VoiceConfig, key?: string) => Voice }> = {
  'fish-audio': {
    secret: 'fishAudioKey',
    voice: ({ fishAudio: at = {} }, key) => ({
      kind: 'http',
      name: `Fish Audio ${at.model}`,
      model: at.model ?? '',
      billing: 'chars',
      url: 'https://api.fish.audio/v1/tts',
      key,
      headers: [`model: ${at.model}`],
      body: { format: 'mp3', latency: 'normal', ...(at.voice ? { reference_id: at.voice } : {}) },
      textField: 'text',
      ext: 'mp3',
      mime: 'audio/mpeg',
    }),
  },
  openrouter: {
    secret: 'openrouterKey',
    voice: ({ openrouter: at = {} }, key) =>
      openAiShaped(`OpenRouter ${at.model}`, 'https://openrouter.ai/api/v1/audio/speech', at, key, 'openrouter'),
  },
  kokoro: { voice: ({ kokoro: at = {} }) => openAiShaped('Kokoro', at.url ?? '', { model: 'kokoro', voice: at.voice }) },
  'self-hosted': { voice: ({ selfHosted: at = {} }) => openAiShaped(`${at.model} (self-hosted)`, at.url ?? '', at) },
  say: { voice: () => SAY },
}

// curl's config format reads a newline as the start of another directive, so
// a value holding one could add a URL that the key is then sent to.
function quote(s: string): string {
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error('a voice setting holds a control character')
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

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

// ---------------------------------------------------------------- cache

// Audio and narrations are kept on disk by a hash of what made them, so a
// reply read again, in this session or a later one, costs nothing.
const DAY = 86_400_000
const CACHED = /^[0-9a-f]{64}\.(mp3|wav|json)$/
const WORK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./

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

// ---------------------------------------------------------------- playback

// What one /ml-voice:read loaded from agent-config. Replaced whole on each
// read; work already under way keeps the settings it started with.
type Settings = {
  voice: Voice
  narrator: string
  style: 'full' | 'compact'
  autoStart: boolean
  usageLog: string
  cacheDir: string
}
let settings: Settings = { voice: SAY, narrator: 'haiku', style: 'full', autoStart: true, usageLog: '', cacheDir: '' }

// The agent-config binary, found once for the module's life.
let agentConfig = ''
const HARNESS = { CLAUDECODE: '1' }

let recording: Promise<void> = Promise.resolve()
// Paid requests from the moment they are sent until their usage line is
// written; the session's end waits on them.
const pending = new Set<Promise<void>>()
let doc = 0
let playing: AbortController | undefined
// The requests for one file that are in flight at once share one promise; it
// leaves the map when it settles, since the file on disk answers from then on.
const clips = new Map<string, Promise<string>>()
let isSwept = false
// Aborted when the session ends: cost polls stop and write the usage line at once.
let ending = new AbortController()
let sweeping: Promise<void> = Promise.resolve()

function stop() {
  playing?.abort()
  playing = undefined
}

// Made in session.start, the one place $ lives for the session's length.
let playFrom: (start: number) => Promise<void> = async () => {}
let playAt: (k: number) => void = () => {}
let narrateThenPlay: (mine: number) => Promise<void> = async () => {}
let pause: () => Promise<void> = async () => {}
let halt: () => Promise<void> = async () => {}
let openPane: () => Promise<void> = async () => {}
let readAloud: (reply: Reply, index: number) => Promise<{ isReading: boolean; text: string }> = async () => ({
  isReading: false,
  text: 'ml-voice is still starting.',
})

const dollars = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`
const partOf = (r: Reader) => `part ${r.current + 1} of ${r.blocks.length}`
const isActive = (r: Reader) => r.status === 'narrating' || r.status === 'ready' || r.status === 'playing' || r.status === 'paused'

function spent(u: Reader['usage']): string {
  const log = `log: ${settings.usageLog.replace(/^.*\/\.agents\//, '~/.agents/')}`
  const chars = `${u.chars.toLocaleString('en')} characters`
  if (u.billing === 'chars') return `Paid API: this reply ${chars}; Fish Audio states no price · ${log}`
  return `Paid API: this reply ${dollars(u.cost)} for ${chars} · all time ${dollars(u.total)} · ${log}`
}

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const remove = (paths: string[]) => $.process.run(['rm', '-f', '--', ...paths]).catch(() => undefined)

    // Made in work/ and moved into audio/ whole, so a failed or cut-off
    // request never leaves a file the cache would play.
    const synth = async (text: string, file: string, s: Settings, mine: number) => {
      const { voice } = s
      const work = `${s.cacheDir}/work/${crypto.randomUUID()}`
      const out = `${work}.${voice.ext}`
      // A move that fails leaves no file, so it fails the synthesis and the next try makes it again.
      const keep = async () => {
        const moved = await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$1")" && mv -f "$0" "$1"', out, file])
        if (moved.exitCode !== 0) throw new Error(`the audio could not be cached at ${file}: ${moved.stderr.trim()}`)
      }
      if (voice.kind === 'say') {
        await $.fs.write(`${work}.txt`, text)
        const ran = await $.process.run(['say', '-o', out, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', `${work}.txt`])
        await remove([`${work}.txt`])
        if (ran.exitCode !== 0) throw new Error(`say: ${ran.stderr.trim()}`)
        await keep()
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
      // Paid for either way: the usage line is written even when the move fails.
      const kept = keep()
      if (voice.billing === 'free') await remove([`${out}.headers`])
      else track(record(voice, text.length, `${out}.headers`, s.usageLog, mine))
      await kept
    }

    const track = (work: Promise<unknown>) => {
      const settled = work.then(
        () => {},
        () => {},
      )
      pending.add(settled)
      void settled.finally(() => pending.delete(settled))
    }

    // One line per paid request in the usage log, the reply's and the
    // all-time totals in the pane. OpenRouter states each generation's cost a
    // moment after it is made; Fish Audio states none. The polls run side by
    // side; only the log line and the totals wait their turn.
    const record = async (paid: Voice & { kind: 'http' }, chars: number, headers: string, usageLog: string, mine: number) => {
      const said = await $.fs.read(headers).catch(() => '')
      await remove([headers])
      const generation = /^x-generation-id:\s*(\S+)/im.exec(said)?.[1]
      let cost: number | null = null
      for (let tries = 0; generation && paid.billing === 'openrouter' && cost === null && tries < 6; tries++) {
        // At the session's end the line is written with no cost; its generation id still finds it.
        const isCut = await $.clock.sleep(1500, { signal: ending.signal }).then(
          () => false,
          () => true,
        )
        if (isCut) break
        const stats = await $.http
          .fetch(`https://openrouter.ai/api/v1/generation?id=${generation}`, { headers: { Authorization: `Bearer ${paid.key}` } })
          .catch(() => undefined)
        if (stats?.ok) cost = (JSON.parse(stats.text) as { data?: { total_cost?: number } }).data?.total_cost ?? null
      }
      const at = new Date(await $.clock.now()).toISOString()
      const line = JSON.stringify({ at, provider: paid.name, model: paid.model, chars, cost, generation })
      recording = recording
        .then(async () => {
          const logged = await $.process
            .run(['sh', '-c', 'mkdir -p "$(dirname "$0")" && cat >> "$0"', usageLog], { stdin: `${line}\n` })
            .catch((error: Error) => ({ exitCode: 1, stderr: error.message }))
          // The money is spent either way, so the totals still count it; the pane says the line is missing.
          const note = logged.exitCode === 0 ? undefined : `The usage log could not be written (${usageLog}): ${logged.stderr.trim()}`
          const total = Number((await $.store.get('totalCost')) ?? 0) + (cost ?? 0)
          await $.store.set('totalCost', total)
          // A prefetch of the reply before counts toward the all-time total only.
          await update($, reader, (r): Reader => ({
            ...r,
            note: note ?? r.note,
            usage: mine === doc ? { ...r.usage, chars: r.usage.chars + chars, cost: r.usage.cost + (cost ?? 0), total } : { ...r.usage, total },
          }))
        })
        .catch(() => {})
      await recording
    }

    // A file played again is touched, so the cleanup counts age from its last play.
    const clip = async (text: string, s: Settings): Promise<string> => {
      await sweeping
      const file = `${s.cacheDir}/audio/${await digest(soundOf(s.voice, text))}.${s.voice.ext}`
      let made = clips.get(file)
      if (!made) {
        const mine = doc
        made = $.fs.exists(file).then(async isKept => {
          if (isKept) await $.process.run(['touch', file])
          else await synth(text, file, s, mine)
          return file
        })
        clips.set(file, made)
        void made.then(
          () => clips.delete(file),
          () => clips.delete(file),
        )
        if (s.voice.billing !== 'free') track(made)
      }
      return made
    }

    // Deletes what the cache policy no longer keeps, once a session, before
    // anything is read from the cache. Only names the cache wrote are touched,
    // so a cache.dir shared with other files loses none of them. Files in
    // work/ are only ever half made, so a day is enough.
    const sweep = async (dir: string, policy: Policy) => {
      const now = await $.clock.now()
      const listed = async (sub: string, name: RegExp): Promise<Cached[]> =>
        ((await $.fs.list(`${dir}/${sub}`).catch(() => [])) as FsEntry[])
          .filter(f => f.kind === 'file' && name.test(f.name))
          .map(f => ({ path: `${dir}/${sub}/${f.name}`, size: f.size, mtimeMs: f.mtimeMs }))
      const [audio, narrations, work] = await Promise.all([listed('audio', CACHED), listed('narration', CACHED), listed('work', WORK)])
      const doomed = [...expired([...audio, ...narrations], policy, now), ...expired(work, { maxAgeDays: 1, maxSizeMB: 0 }, now)]
      for (let i = 0; i < doomed.length; i += 200) await remove(doomed.slice(i, i + 200))
    }

    playFrom = async start => {
      stop()
      const control = new AbortController()
      playing = control
      const s = settings
      for (let k = Math.max(0, start); ; k++) {
        const r = await read($, reader)
        if (control.signal.aborted) return
        if (k >= r.blocks.length) {
          await update($, reader, (r): Reader => ({ ...r, status: 'done' }))
          return
        }
        await update($, reader, (r): Reader => ({ ...r, current: k, status: 'playing' }))
        const block = r.blocks[k]
        const text = block ? spokenOf(block) : ''
        if (!text) continue
        let file: string
        let base64: string
        try {
          file = await clip(text, s)
          const following = r.blocks[k + 1]
          if (following && spokenOf(following)) clip(spokenOf(following), s).catch(() => {})
          if (control.signal.aborted) return
          base64 = (await $.fs.read(file, { as: 'bytes' })).base64
        } catch (err) {
          if (!control.signal.aborted) await update($, reader, (r): Reader => ({ ...r, status: 'error', note: String(err) }))
          return
        }
        if (control.signal.aborted) return
        try {
          await $.audio.play({ base64, mime: s.voice.mime }, { signal: control.signal })
        } catch (err) {
          if (control.signal.aborted) return
          // Audio that cannot be played leaves the cache, so the next try makes it again.
          clips.delete(file)
          await remove([file])
          await update($, reader, (r): Reader => ({ ...r, status: 'error', note: `The audio for this part did not play: ${String(err)}` }))
          return
        }
        if (control.signal.aborted) return
      }
    }

    // Each press plays from a timer, so the press answers before the reading ends.
    playAt = k => {
      $.clock.after(0, () => void playFrom(k))
    }

    narrateThenPlay = async mine => {
      const s = settings
      const { blocks } = await read($, reader)
      const asked = narration(blocks, s)
      await sweeping
      const file = `${s.cacheDir}/narration/${await digest(asked)}.json`
      let spoken = await $.fs.read(file).then(t => parseSpoken(t as string, blocks), () => undefined)
      if (spoken) await $.process.run(['touch', file]).catch(() => undefined)
      else {
        // A failed call falls back to the plain cleanup below, like an answer that does not parse.
        const reply = await $.model.complete(asked).catch(() => undefined)
        spoken = reply?.isAnswered ? parseSpoken(reply.text, blocks) : undefined
        if (spoken) await $.fs.write(file, JSON.stringify(spoken)).catch(() => undefined)
      }
      if (mine !== doc) return
      await update($, reader, (r): Reader => ({
        ...r,
        blocks: r.blocks.map((b, i) => ({ ...b, spoken: spoken?.[i] ?? plain(b) })),
        note: spoken ? undefined : 'Haiku narration failed; reading a plain cleanup.',
      }))
      // A click during narration already started playback; leave it be.
      if ((await read($, reader)).status !== 'narrating') return
      if (s.autoStart) await playFrom(0)
      else await update($, reader, (r): Reader => ({ ...r, status: 'ready' }))
    }

    // Stop ends the reading: the band above the prompt goes away with it.
    // Audio already made stays cached, so playing again costs nothing more.
    const end = (status: 'paused' | 'stopped') => async () => {
      stop()
      await update($, reader, (r): Reader => ({ ...r, status }))
    }
    pause = end('paused')
    halt = end('stopped')

    // The band draws itself from whether the pane is on screen, so it is drawn
    // again whenever that changes.
    openPane = async () => {
      await $.ui.open({ id: PANE, title: 'Voice', focus: true })
      $.ui.invalidate('ui.render')
    }

    // The agent-config CLI, found the way working-actions.md says: the
    // AGENT_CONFIG_ROOT override, then PATH, then the plugin caches.
    const findAgentConfig = async (): Promise<string> => {
      const root = await $.env.get('AGENT_CONFIG_ROOT')
      if (root) return `${root}/bin/agent-config`
      const found = await $.process
        .run(['sh', '-c', 'command -v agent-config || for c in $(ls -d "$HOME"/.claude/plugins/cache/*/ml-agent-config/*/bin/agent-config "${CODEX_HOME:-$HOME/.codex}"/plugins/cache/*/ml-agent-config/*/bin/agent-config 2>/dev/null | sort -rV); do [ -x "$c" ] && echo "$c" && break; done'])
        .catch(() => undefined)
      return found?.stdout.trim().split('\n')[0] ?? ''
    }

    // The provider's key, loaded through agent-config on every read (secrets
    // come back on fd 3) and kept nowhere: agent-config's own session cache,
    // filled by /agent-config unlock voice-reader and emptied by its forget, is
    // the one place a resolved key is cached.
    const keyOf = async (ac: string, config: VoiceConfig, secret: string): Promise<string> => {
      const path = `credentials.${secret}`
      const ran = await $.process
        .run(['sh', '-c', 'exec "$0" load voice-reader --from "$1" --secrets "$2" 3>&1 1>/dev/null', ac, $.plugin.root, path], {
          env: HARNESS,
          timeoutMs: 120_000,
        })
        .catch((error: Error) => ({ exitCode: 1, stdout: '', stderr: error.message }))
      if (ran.exitCode !== 0) throw new Error(`ml-voice could not read ${path}: ${ran.stderr.trim()}`)
      return (JSON.parse(ran.stdout) as Record<string, string>)[path] ?? ''
    }

    // Loads the voice from agent-config and starts reading `reply`: what
    // /ml-voice:read and the pane's list of earlier replies both run.
    readAloud = async (reply, index) => {
      // /clear ends a session and starts the next with no session.start.
      if (ending.signal.aborted) ending = new AbortController()
      agentConfig ||= await findAgentConfig()
      const ac = agentConfig
      if (!ac) return { isReading: false, text: 'ml-voice needs the ml-agent-config plugin to choose a voice; install it and run /ml-voice:read again.' }
      const started = await $.process
        .run([ac, 'start', 'voice-reader', '--from', $.plugin.root], { env: HARNESS, timeoutMs: 15_000 })
        .catch((error: Error) => ({ exitCode: 1, stdout: '', stderr: error.message }))
      const plan = JSON.parse(started.stdout || '{}') as { ready?: boolean; guide?: string; config?: VoiceConfig }
      if (started.exitCode !== 0 || !plan.ready || !plan.config) {
        // A command's own hook cannot queue a prompt (it would wait on this
        // turn); a timer submits it once the command has answered.
        const setup =
          "Set up ml-voice's voice (agent-config namespace voice-reader): `agent-config start voice-reader` below is not ready. " +
          `Read ${plan.guide ?? 'the agent-config guide'} and work its actions with \`${ac}\`, ` +
          `passing \`--from ${$.plugin.root}\`. Then tell me to run /ml-voice:read again.\n\n` +
          '```json\n' + (started.stdout || started.stderr).trim() + '\n```'
        $.clock.after(0, () => void $.prompt.submit({ text: setup }))
        return { isReading: false, text: 'ml-voice has no voice chosen yet; Claude will set it up with you now.' }
      }
      const config = plan.config
      // agent-config reports a value its enum refuses as a problem but still answers ready.
      const named = config.voice?.provider ?? 'say'
      if (!Object.hasOwn(PROVIDERS, named)) {
        return { isReading: false, text: `ml-voice does not know the voice provider "${named}"; pick one of ${Object.keys(PROVIDERS).join(', ')} in /agent-config voice-reader.` }
      }
      const provider = PROVIDERS[named]
      let key: string | undefined
      try {
        key = provider.secret ? await keyOf(ac, config, provider.secret) : undefined
      } catch (err) {
        return { isReading: false, text: (err as Error).message }
      }
      const home = (await $.env.get('HOME')) ?? ''
      const expand = (path: string) => path.replace(/^~(?=\/)/, home).replace(/\/$/, '')
      settings = {
        voice: provider.voice(config, key),
        narrator: config.narration?.model ?? 'haiku',
        style: config.narration?.style ?? 'full',
        autoStart: config.playback?.autoStart ?? true,
        usageLog: expand(config.usage?.log ?? '~/.agents/voice-reader/usage.jsonl'),
        cacheDir: expand(config.cache?.dir ?? '~/.cache/voice-reader'),
      }
      if (!isSwept) {
        isSwept = true
        const policy = { maxAgeDays: config.cache?.maxAgeDays ?? 30, maxSizeMB: config.cache?.maxSizeMB ?? 500 }
        sweeping = sweep(settings.cacheDir, policy).catch(() => {})
      }

      stop()
      doc++
      const { voice, style } = settings
      const blocks = split(reply.text)
      const total = Number((await $.store.get('totalCost')) ?? 0)
      await update($, reader, (): Reader => ({
        ...EMPTY,
        blocks,
        status: 'narrating',
        backend: style === 'compact' ? `${voice.name} · compact` : voice.name,
        usage: { ...EMPTY.usage, total, billing: voice.billing },
        replyIndex: index,
      }))
      const mine = doc
      $.clock.after(0, () => void narrateThenPlay(mine))
      return { isReading: true, text: `Reading reply ${index + 1} aloud (${blocks.length} parts, ${voice.name}).` }
    }

    return next(e)
  })

  // The whole session.end chain shares one short bound (1.5 s by default). Cost
  // polls stop at once and write their usage lines; a narration still waiting
  // on the model plays nothing. A request whose answer has not come back by the
  // bound has no generation id to log.
  on('session.end', async ($, e, next) => {
    stop()
    doc++
    isSwept = false
    ending.abort()
    const left = next.budget.remainingMs - 250
    if (pending.size > 0 && left > 0) await Promise.race([Promise.allSettled([...pending]), $.clock.sleep(left)])
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
    if (started.isReading) await openPane()
    return { drop: started.text }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) $.ui.invalidate('ui.render')
    return closed
  })

  // While anything is being read and the pane is not on screen (closed, a tab
  // behind another, or waiting for a wider terminal), a row above the prompt
  // keeps the controls in reach.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, reader)
    if (!isActive(r) || e.props.hasSurvey) return next(e)
    if ((await $.ui.panes()).some(p => p.id === PANE && p.isShown && p.isPlaced)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isPlaying = r.status === 'playing'
    const where = r.status === 'narrating' ? 'preparing' : r.status === 'ready' ? 'ready' : `${isPlaying ? 'reading' : 'paused at'} ${partOf(r)}`
    const reply = r.replyIndex >= 0 ? `reply ${r.replyIndex + 1}` : 'reply'
    const cost = r.usage.billing === 'openrouter' ? ` · ${dollars(r.usage.cost)}` : ''
    return (
      <Box flexDirection="row" gap={1}>
        <Text color="claude">♪</Text>
        <Text dimColor>
          {reply} · {where}{cost}
        </Text>
        <Button key="band-toggle" variant="primary" label={isPlaying ? 'pause' : 'play'}
          onPress={() => (isPlaying ? pause() : playAt(r.current))} />
        <Button key="band-stop" label="stop" onPress={() => halt()} />
        <Button key="band-open" label="open" onPress={() => openPane()} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, reader)
    const isPlaying = r.status === 'playing'
    const go = (k: number) => playAt(Math.min(k, r.blocks.length - 1))
    // Pause and stop stay on screen in the list too: the band hides while the pane shows.
    const controls = [
      <Button key="toggle" hotkey="p" variant="primary" label={isPlaying ? 'pause' : 'play'}
        onPress={() => (isPlaying ? pause() : go(r.status === 'done' ? 0 : r.current))} />,
      <Button key="stop" hotkey="s" label="stop" onPress={() => halt()} />,
    ]

    if (r.mode === 'picker') {
      const all = replies(await $.session.messages())
      // The reply's full text is read again at the pick: the list shows previews.
      const pick = (index: number) => {
        const chosen = all[index]
        if (!chosen) return
        $.clock.after(0, async () => {
          const started = await readAloud(chosen, index)
          if (!started.isReading) await update($, reader, (s): Reader => ({ ...s, mode: 'reader', note: started.text }))
        })
      }
      const newestFirst = all.map((one, index) => ({ ...one, index })).reverse().slice(0, 40)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="back" hotkey="b" label="back" onPress={() => update($, reader, (s): Reader => ({ ...s, mode: 'reader' }))} />
            {isActive(r) && controls}
          </Box>
          <Text dimColor>Pick a reply to read · {all.length} in this session, newest first</Text>
          {newestFirst.map(one => (
            <Box key={`reply-${one.index}`} flexDirection="column" marginTop={1}>
              <Button key={`pick-${one.index}`} plain onPress={() => pick(one.index)}>
                <Text weight="bold" color={one.index === r.replyIndex ? 'claude' : undefined} hover={{ underline: true }}>
                  {one.index === r.replyIndex ? '▶ ' : ''}{one.index + 1}. {oneLine(one.prompt, 90) || '(no prompt)'}
                </Text>
              </Button>
              <Text dimColor>{oneLine(one.text, 140)}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    const status = {
      idle: 'Nothing loaded. Run /ml-voice:read.',
      narrating: settings.style === 'compact' ? 'Haiku is picking out what matters…' : 'Haiku is rewriting the reply as talk…',
      ready: 'Ready. Press play.',
      playing: `Reading ${partOf(r)}`,
      paused: `Paused at ${partOf(r)}`,
      stopped: 'Stopped.',
      done: 'Finished.',
      error: 'Stopped on an error.',
    }[r.status]

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {controls}
          <Button key="prev" hotkey="k" label="prev" onPress={() => go(r.current - 1)} />
          <Button key="next" hotkey="j" label="next" onPress={() => go(r.current + 1)} />
          <Button key="view" hotkey="v" label={r.view === 'source' ? 'show spoken' : 'show original'}
            onPress={() => update($, reader, (s): Reader => ({ ...s, view: s.view === 'source' ? 'spoken' : 'source' }))} />
          <Button key="replies" hotkey="r" label="earlier replies" onPress={() => update($, reader, (s): Reader => ({ ...s, mode: 'picker' }))} />
        </Box>
        <Text dimColor>{status} · {r.backend}{r.replyIndex >= 0 ? ` · reply ${r.replyIndex + 1}` : ''}</Text>
        {r.usage.billing !== 'free' && <Text dimColor>{spent(r.usage)}</Text>}
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
