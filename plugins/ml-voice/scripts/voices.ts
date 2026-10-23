#!/usr/bin/env bun
// The voices and models a voice-reader key can take, for `agent-config choices voice-reader <key>`
// (agent-config.json names this script for each key). agent-config hands it, as JSON on stdin, the
// key, the search (for the Fish Audio voices, which Fish Audio searches) and the effective
// config, and reads `{ choices: [{ value, label, detail }], note }` from stdout. No key is needed:
// every list here is public or local.

import { matching, type Choice } from './matching'

type Listed = { choices: Choice[]; note?: string }
type Asked = {
  key: string
  search: string
  config: {
    openrouter?: { model?: string }
    kokoro?: { url?: string }
    selfHosted?: { url?: string }
  }
}

const FISH_MODELS = 'https://api.fish.audio/model'
const OPENROUTER_SPEECH = 'https://openrouter.ai/api/v1/models?output_modalities=speech'
const DEFAULT_OPENROUTER_MODEL = 'fish-audio/drama-3'
const DEFAULT_KOKORO_URL = 'http://127.0.0.1:3030/v1/audio/speech'

async function json(url: string, what: string): Promise<unknown> {
  let answer: Response
  try {
    answer = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw new Error(`${what} is not answering at ${url}: ${(error as Error).message}`)
  }
  if (!answer.ok) throw new Error(`${what} answered ${answer.status} at ${url}`)
  return answer.json()
}

const count = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** Fish Audio's public voice library, most used first, or its best matches for the search. */
export async function fishVoices(search: string): Promise<Listed> {
  // Searched by use, Fish Audio puts a popular voice that merely mentions the word above the ones named for it.
  const query = new URLSearchParams({ page_size: '50', sort_by: search ? 'score' : 'task_count', ...(search ? { title: search } : {}) })
  const got = (await json(`${FISH_MODELS}?${query}`, 'Fish Audio')) as { items?: FishModel[] }
  const choices = (got.items ?? [])
    .filter(one => one.type === 'tts' && one.state === 'trained')
    .map(one => ({
      value: one._id,
      label: one.title,
      detail: [one.languages?.join('/'), `${count(one.task_count ?? 0)} uses`, one.author?.nickname && `by ${one.author.nickname}`].filter(Boolean).join(' · '),
    }))
  return { choices, ...(search ? {} : { note: 'The 50 most used voices; type to search the whole library.' }) }
}

type FishModel = { _id: string; type: string; title: string; state: string; languages?: string[]; task_count?: number; author?: { nickname?: string } }
type SpeechModel = { id: string; name: string; pricing?: { prompt?: string }; supported_voices?: string[] | null }

async function speechModels(): Promise<SpeechModel[]> {
  return ((await json(OPENROUTER_SPEECH, 'OpenRouter')) as { data?: SpeechModel[] }).data ?? []
}

/** OpenRouter's speech models, each with its price and how many voices it lists. */
export function openrouterModels(models: SpeechModel[]): Listed {
  return {
    choices: models.map(one => {
      const perChar = Number(one.pricing?.prompt ?? 0)
      const voices = one.supported_voices?.length
      return {
        value: one.id,
        label: one.name,
        detail: [perChar > 0 && `$${+(perChar * 1_000_000).toFixed(2)} per million characters`, perChar === 0 && 'free', voices && `${voices} voices`]
          .filter(Boolean)
          .join(' · '),
      }
    }),
  }
}

/**
 * The voices the configured OpenRouter model lists, matched to the search here; a Fish Audio model
 * lists none, and takes Fish Audio's library, searched there.
 */
export async function openrouterVoices(models: SpeechModel[], model: string, search: string): Promise<Listed> {
  const found = models.find(one => one.id === model)
  if (!found) return { choices: [], note: `OpenRouter lists no speech model ${model}; pick openrouter.model first.` }
  if (found.supported_voices?.length) return { choices: matching(found.supported_voices.map(voice => ({ value: voice, label: voice })), search) }
  if (model.startsWith('fish-audio/')) return fishVoices(search)
  return { choices: [], note: `${found.name} lists no voices; type the one its provider names, or leave it empty for its default.` }
}

/** What an OpenAI-shaped server's /v1/audio/voices lists, beside its speech endpoint. */
export async function serverVoices(speechUrl: string, what: string): Promise<Listed> {
  const url = speechUrl.replace(/\/audio\/speech\/?$/, '/audio/voices')
  if (url === speechUrl) return { choices: [], note: `${speechUrl} does not end in /audio/speech, so its voice list cannot be found; type the voice.` }
  const got = (await json(url, what)) as unknown
  const listed = Array.isArray(got) ? got : ((got as { voices?: unknown; data?: unknown }).voices ?? (got as { data?: unknown }).data)
  if (!Array.isArray(listed)) throw new Error(`${what} answered ${url} with no voice list`)
  const choices = listed
    .map(one => (typeof one === 'string' ? one : ((one as { id?: unknown; name?: unknown }).id ?? (one as { name?: unknown }).name)))
    .filter((one): one is string => typeof one === 'string' && one !== '')
    .map(voice => ({ value: voice, label: voice }))
  return { choices }
}

// `say -v '?'`: a name (which may hold spaces and brackets), its locale, then `# ` and a sample.
const SAY_LINE = /^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#\s*(.*)$/

/** macOS's voices, as `say -v '?'` lists them. */
export function sayVoices(listing: string): Listed {
  const choices = listing
    .split('\n')
    .map(line => SAY_LINE.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, name, locale, sample]) => ({ value: name!, label: name!, detail: `${locale} · ${sample}` }))
  return { choices }
}

async function list(asked: Asked): Promise<Listed> {
  const { key, search, config } = asked
  switch (key) {
    case 'fishAudio.voice':
      return fishVoices(search)
    case 'openrouter.model':
      return openrouterModels(await speechModels())
    case 'openrouter.voice':
      return openrouterVoices(await speechModels(), config.openrouter?.model || DEFAULT_OPENROUTER_MODEL, search)
    case 'kokoro.voice':
      return serverVoices(config.kokoro?.url || DEFAULT_KOKORO_URL, 'Kokoro')
    case 'selfHosted.voice':
      if (!config.selfHosted?.url) return { choices: [], note: 'Set selfHosted.url first: the voices are asked of that server.' }
      return serverVoices(config.selfHosted.url, 'Your speech server')
    case 'say.voice': {
      const ran = Bun.spawnSync(['say', '-v', '?'])
      if (ran.exitCode !== 0) throw new Error(`say -v '?' failed: ${ran.stderr.toString().trim() || 'is this macOS?'}`)
      return sayVoices(ran.stdout.toString())
    }
    default:
      throw new Error(`no voice list for ${key}`)
  }
}

if (import.meta.main) {
  try {
    const asked = JSON.parse(await Bun.stdin.text()) as Asked
    console.log(JSON.stringify(await list({ ...asked, key: asked.key ?? process.argv[2] ?? '' })))
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
