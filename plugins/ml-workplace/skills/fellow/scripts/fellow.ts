#!/usr/bin/env bun
// Fellow Developer API CLI — read-only.
// Run `bun fellow.ts help` for usage.

import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import {
  loadConfig, validate, layerPath, repoRoot, expandPath, recordSeriesVerdict,
  ensureGitignored, LOCAL_GITIGNORE_PATTERN, type Layer, type FellowConfig,
} from "./lib/config";
import { resolveCredential, describeCredential } from "./lib/credentials";
import { FellowClient, transcriptToText, aiNotesToMarkdown, daysAgo } from "./lib/client";
import { partition, needsAttendees, meetingKey, type ProjectRules } from "./lib/relevance";

// ---------------------------------------------------------------- arg parsing

const argv = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  } else positional.push(a);
}
const has = (k: string) => k in flags;
const str = (k: string, d?: string) => (typeof flags[k] === "string" ? (flags[k] as string) : d);
const num = (k: string, d?: number) => (has(k) ? Number(flags[k]) : d);
const asJson = has("json");

/** `--since 30` means 30 days ago; `--since 2026-07-01` is a date. */
function sinceToIso(v?: string): string | undefined {
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return daysAgo(Number(v));
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`Cannot parse date "${v}". Use a number of days or YYYY-MM-DD.`);
  return d.toISOString();
}

function out(data: unknown, human: () => void) {
  if (asJson) console.log(JSON.stringify(data, null, 2));
  else human();
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/**
 * A full page of results usually means there are more behind it. Saying so is
 * the difference between "you have 50 open items" and "you have 112" — silent
 * truncation reads as a complete answer, which is the worst way to be wrong.
 */
function truncationHint(count: number, pageSize: number): string {
  if (has("all") || count < pageSize) return "";
  return `\n[showing the first ${count} — this is a full page, so there are probably more. Pass --all to fetch every page.]`;
}

// ------------------------------------------------------------------ bootstrap

/**
 * Resolve which project scope applies: --all-meetings disables filtering,
 * --project picks one, otherwise defaultProject. Returns null when no scoping
 * should happen, so every call site can stay unconditional.
 */
function activeProject(config: FellowConfig): { name: string; rules: ProjectRules } | null {
  if (has("all-meetings") || has("no-filter")) return null;
  const name = str("project") ?? config.defaultProject;
  if (!name) return null;
  const rules = config.projects?.[name];
  if (!rules) {
    fail(
      `No project named "${name}" is configured.\n` +
        `Known projects: ${Object.keys(config.projects ?? {}).join(", ") || "(none)"}\n` +
        `Use --all-meetings to skip project filtering.`,
    );
  }
  return { name, rules };
}

/** Apply project scoping to a fetched list, and report what was held back. */
function scope(meetings: any[], config: FellowConfig) {
  const proj = activeProject(config);
  if (!proj) return { meetings, note: "", undecided: [] as any[] };
  const { included, excluded, undecided } = partition(meetings, proj.name, proj.rules, config.series ?? {}, config.projects ?? {});
  const bits: string[] = [];
  if (excluded.length) bits.push(`${excluded.length} out of scope`);
  if (undecided.length) bits.push(`${undecided.length} undecided`);
  return {
    meetings: included,
    undecided,
    note: bits.length ? `\n[project "${proj.name}": ${bits.join(", ")}${undecided.length ? " — run `project undecided` to classify" : ""}]` : "",
  };
}

function getClient(): FellowClient {
  const { config, found } = loadConfig();
  const problems = validate(config);
  if (problems.length) {
    const where = found.length
      ? `Loaded config from:\n${found.map((f) => `  - ${f.layer}: ${f.path}`).join("\n")}`
      : "No config file was found in any layer.";
    fail(
      `Fellow is not configured yet.\n\n${where}\n\nMissing:\n${problems.map((p) => `  - ${p}`).join("\n")}\n\n` +
        `Run \`bun fellow.ts config path --layer global\` to see where to write it, ` +
        `or ask Claude to walk you through setup.`,
    );
  }
  const key = resolveCredential(config.credentials!.apiKey!);
  return new FellowClient(config.workspace!.subdomain!, key);
}

// ------------------------------------------------------------------- commands

async function cmdWhoami() {
  const me = await getClient().me();
  out(me, () => {
    console.log(`${me.user.full_name} <${me.user.email}>`);
    console.log(`Workspace: ${me.workspace.name} (subdomain: ${me.workspace.subdomain})`);
  });
}

function noteFilters() {
  const f: Record<string, unknown> = {};
  const since = sinceToIso(str("since"));
  const until = sinceToIso(str("until"));
  if (since) f.created_at_start = since;
  if (until) f.created_at_end = until;
  if (str("title")) f.title = str("title");
  return f;
}

async function cmdNotesList() {
  const { config } = loadConfig();
  const proj = activeProject(config);
  const all = await getClient().listNotes({
    filters: noteFilters(),
    include: {
      content_markdown: has("content"),
      // Attendee data is needed for Tier-2 rules, so fetch it when scoping asks for it.
      event_attendees: has("attendees") || (proj ? needsAttendees(proj.rules) : false),
    },
    pageSize: num("limit", 50),
    all: has("all"),
    max: num("limit"),
  });
  const { meetings: items, note } = scope(all, config);
  out(items, () => {
    if (!items.length) return console.log(`No notes matched.${note}`);
    for (const n of items) {
      console.log(`${(n.event_start ?? n.created_at ?? "").slice(0, 10)}  ${n.id}  ${n.title ?? "(untitled)"}`);
    }
    console.log(`\n${items.length} note(s).${note}${truncationHint(items.length, num("limit", 50)!)}`);
  });
}

async function cmdNotesGet(id: string) {
  const n = await getClient().getNote(id);
  out(n, () => {
    console.log(`# ${n.title ?? "(untitled)"}\n`);
    console.log(`Date: ${n.event_start ?? n.created_at}`);
    if (n.event_attendees?.length) {
      console.log(`Attendees: ${n.event_attendees.map((a: any) => a.name ?? a.email).join(", ")}`);
    }
    if (n.recording_ids?.length) console.log(`Recordings: ${n.recording_ids.join(", ")}`);
    console.log(`\n${n.content_markdown ?? "(no content)"}`);
  });
}

async function cmdRecordingsList() {
  const { config } = loadConfig();
  const all = await getClient().listRecordings({
    filters: noteFilters(),
    pageSize: num("limit", 50),
    all: has("all"),
    max: num("limit"),
  });
  // Recordings carry no attendee list, so only Tier 0 and Tier 1 can apply here.
  const { meetings: items, note } = scope(all, config);
  out(items, () => {
    if (!items.length) return console.log(`No recordings matched.${note}`);
    for (const r of items) {
      const mins = r.started_at && r.ended_at
        ? Math.round((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 60000)
        : null;
      console.log(`${(r.started_at ?? "").slice(0, 10)}  ${r.id}  ${mins ? `${mins}m`.padStart(5) : "    -"}  ${r.title ?? ""}`);
    }
    console.log(`\n${items.length} recording(s).${note}${truncationHint(items.length, num("limit", 50)!)}`);
  });
}

async function cmdRecordingsGet(id: string) {
  const client = getClient();
  const r = await client.getRecording(id);
  if (asJson) return console.log(JSON.stringify(r, null, 2));

  console.log(`# ${r.title ?? "(untitled)"}\n`);
  console.log(`Started: ${r.started_at}`);
  if (r.event_call_url) console.log(`Call: ${r.event_call_url}`);
  if (r.note_id) console.log(`Note: ${r.note_id}`);

  const ai = aiNotesToMarkdown(r.ai_notes);
  if (ai && !has("transcript-only")) console.log(`\n## AI notes\n\n${ai}`);

  if (has("transcript") || has("transcript-only")) {
    const text = transcriptToText(r.transcript);
    console.log(`\n## Transcript\n\n${text || "(no transcript)"}`);
  } else if (r.transcript?.speech_segments?.length) {
    console.log(`\n(${r.transcript.speech_segments.length} transcript segments — pass --transcript to print them)`);
  }

  if (has("media")) {
    const url = r.event_guid ? await client.mediaUrlFor(r.event_guid, num("expire", 43200)) : null;
    console.log(`\nMedia URL: ${url ?? "(none available)"}`);
  }
}

async function cmdActionItems() {
  const f: Record<string, unknown> = {};
  // Default scope is assigned_to_me — the API's own default, and the one users
  // mean by "my action items". Pass --scope all for the whole workspace.
  f.scope = str("scope", "assigned_to_me");
  if (has("open")) f.completed = false;
  if (has("completed")) f.completed = true;
  if (!has("archived")) f.archived = false;

  const pageSize = num("limit", 50);
  const items = await getClient().listActionItems({
    filters: f,
    pageSize,
    all: has("all"),
    max: num("limit"),
  });
  out(items, () => {
    if (!items.length) return console.log("No action items matched.");
    for (const a of items) {
      // status is one of Done | Archived | Incomplete — compare exactly, since
      // "Incomplete".includes("complete") is true and silently inverts this.
      const mark = a.status === "Done" ? "x" : a.status === "Archived" ? "-" : " ";
      const who = (a.assignees ?? []).map((x: any) => x.full_name ?? x.email).filter(Boolean).join(", ");
      const due = a.due_date ? ` (due ${String(a.due_date).slice(0, 10)})` : "";
      const when = (a.created_at ?? "").slice(0, 10);
      console.log(`[${mark}] ${when}  ${a.text}${due}${who ? `  — ${who}` : ""}`);
      console.log(`         ${a.id}${a.note_id ? `  from note ${a.note_id}` : ""}`);
    }
    console.log(`\n${items.length} action item(s), scope=${f.scope}.${truncationHint(items.length, pageSize)}`);
  });
}

/**
 * The API has no full-text search — filters are limited to dates, exact title,
 * channel and event_guid. So search means pulling a window of content and
 * matching locally. Notes are cheap; transcripts are opt-in because they are
 * an order of magnitude more data.
 */
async function cmdSearch(query: string) {
  if (!query) fail("Usage: bun fellow.ts search <query> [--since 90] [--transcripts]");
  const client = getClient();
  const since = sinceToIso(str("since", "90"))!;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (hay: string) => {
    const h = hay.toLowerCase();
    return terms.every((t) => h.includes(t));
  };

  const results: any[] = [];
  const { config } = loadConfig();
  const proj = activeProject(config);

  const allNotes = await client.listNotes({
    filters: { created_at_start: since },
    include: { content_markdown: true, event_attendees: proj ? needsAttendees(proj.rules) : false },
    all: true,
  });
  const { meetings: notes, note: scopeNote } = scope(allNotes, config);
  for (const n of notes) {
    const hay = `${n.title ?? ""}\n${n.content_markdown ?? ""}`;
    if (matches(hay)) {
      results.push({
        kind: "note", id: n.id, title: n.title,
        date: (n.event_start ?? n.created_at ?? "").slice(0, 10),
        snippet: snippet(n.content_markdown ?? n.title ?? "", terms[0]),
      });
    }
  }

  if (has("transcripts")) {
    const allRecs = await client.listRecordings({
      filters: { created_at_start: since },
      include: { transcript: true },
      all: true,
    });
    const { meetings: recs } = scope(allRecs, config);
    for (const r of recs) {
      for (const seg of r.transcript?.speech_segments ?? []) {
        if (matches(seg.text ?? "")) {
          results.push({
            kind: "transcript", id: r.id, title: r.title,
            date: (r.started_at ?? "").slice(0, 10),
            speaker: seg.speaker, at: Math.round(seg.start),
            snippet: seg.text,
          });
        }
      }
    }
  }

  out(results, () => {
    if (!results.length) {
      return console.log(`No matches for "${query}" since ${since.slice(0, 10)}.` +
        (has("transcripts") ? "" : " Add --transcripts to search spoken content too.") + scopeNote);
    }
    for (const r of results) {
      const who = r.speaker ? ` — ${r.speaker} @${r.at}s` : "";
      console.log(`\n[${r.kind}] ${r.date}  ${r.title ?? ""}  (${r.id})${who}`);
      console.log(`    ${r.snippet.replace(/\n/g, "\n    ")}`);
    }
    console.log(`\n${results.length} match(es).${scopeNote}`);
  });
}

function snippet(text: string, term: string, width = 200): string {
  const i = text.toLowerCase().indexOf(term);
  if (i === -1) return text.slice(0, width);
  const start = Math.max(0, i - width / 2);
  return (start ? "…" : "") + text.slice(start, start + width).trim() + (start + width < text.length ? "…" : "");
}

/**
 * A Fellow "note" is usually just the empty agenda template — the substance
 * (summary, decisions, AI-detected action items) lives on the linked *recording*
 * as ai_notes. A useful recap therefore joins the two, which is what this builds.
 */
function buildRecap(note: any, recording: any, opts: { transcript?: boolean } = {}): string {
  const title = note?.title ?? recording?.title ?? "(untitled)";
  const date = note?.event_start ?? recording?.started_at ?? note?.created_at ?? "";
  const attendees = (note?.event_attendees ?? []).map((a: any) => a.name ?? a.email).filter(Boolean);

  const parts: string[] = [`# ${title}`, ""];
  parts.push(`- Date: ${date}`);
  if (attendees.length) parts.push(`- Attendees: ${attendees.join(", ")}`);
  if (recording?.event_call_url) parts.push(`- Call: ${recording.event_call_url}`);
  const ids = [note?.id && `note ${note.id}`, recording?.id && `recording ${recording.id}`].filter(Boolean);
  if (ids.length) parts.push(`- Fellow: ${ids.join(", ")}`);
  parts.push("");

  const ai = aiNotesToMarkdown(recording?.ai_notes);
  if (ai) parts.push(ai, "");

  // Only include the hand-written note when it holds more than the blank template.
  const manual = (note?.content_markdown ?? "").trim();
  const stripped = manual.replace(/^#.*$/gm, "").replace(/^\(.*\)$/gm, "").trim();
  if (stripped.length > 40) parts.push("## Meeting notes", "", manual, "");

  if (opts.transcript && recording?.transcript) {
    parts.push("## Transcript", "", transcriptToText(recording.transcript), "");
  }
  return parts.join("\n").trim() + "\n";
}

/** Build a full recap for one meeting, given a note id or a recording id. */
async function cmdRecap(id: string) {
  if (!id) fail("Usage: bun fellow.ts recap <note-id|recording-id> [--transcript]");
  const client = getClient();

  let note: any = null;
  let recording: any = null;
  try {
    note = await client.getNote(id);
  } catch {
    recording = await client.getRecording(id);
  }
  if (note?.recording_ids?.length) {
    recording = await client.getRecording(note.recording_ids[0]);
  } else if (recording?.note_id && !note) {
    try { note = await client.getNote(recording.note_id); } catch { /* note may be inaccessible */ }
  }
  if (!note && !recording) fail(`No note or recording found with id ${id}.`);

  const md = buildRecap(note, recording, { transcript: has("transcript") });
  if (asJson) console.log(JSON.stringify({ note, recording, markdown: md }, null, 2));
  else console.log(md);
}

/** Bulk export to files. Honours storage.* config for default destinations. */
async function cmdExport() {
  const { config } = loadConfig();
  const client = getClient();
  const since = sinceToIso(str("since", "30"))!;

  const wantNotes = has("notes") || !has("transcripts");
  const wantTranscripts = has("transcripts");

  const outDir = str("out")
    ? expandPath(str("out")!)
    : expandPath(
        (wantTranscripts ? config.storage?.transcripts?.path : config.storage?.recaps?.path) ??
          ".agents/fellow/export",
      );
  mkdirSync(outDir, { recursive: true });

  const written: string[] = [];

  if (wantNotes) {
    const allNotes = await client.listNotes({
      filters: { created_at_start: since },
      include: { content_markdown: true, event_attendees: true },
      all: true,
    });
    const { meetings: notes, note: scopeNote } = scope(allNotes, config);
    if (scopeNote) console.error(scopeNote.trim());
    // Pull AI notes for the whole window in one paginated pass and join on note_id,
    // rather than issuing a GET per meeting.
    const recs = await client.listRecordings({
      filters: { created_at_start: since },
      include: { ai_notes: true },
      all: true,
    });
    const byNote = new Map<string, any>();
    for (const r of recs) if (r.note_id) byNote.set(r.note_id, r);

    for (const n of notes) {
      const file = uniquePath(join(outDir, `${(n.event_start ?? n.created_at ?? "").slice(0, 10)}_${slug(n.title)}.md`), n.id);
      writeFileSync(file, buildRecap(n, byNote.get(n.id) ?? null));
      written.push(file);
    }
  }

  if (wantTranscripts) {
    const allRecs = await client.listRecordings({
      filters: { created_at_start: since },
      include: { transcript: true },
      all: true,
    });
    const { meetings: recs } = scope(allRecs, config);
    for (const r of recs) {
      const text = transcriptToText(r.transcript);
      if (!text) continue;
      const file = uniquePath(join(outDir, `${(r.started_at ?? "").slice(0, 10)}_${slug(r.title)}_transcript.md`), r.id);
      writeFileSync(file, `# ${r.title ?? "(untitled)"} — transcript\n\n- Recording: ${r.id}\n- Started: ${r.started_at}\n\n${text}\n`);
      written.push(file);
    }
  }

  out({ outDir, files: written }, () => {
    console.log(`Wrote ${written.length} file(s) to ${outDir}`);
    for (const f of written.slice(0, 20)) console.log(`  ${f}`);
    if (written.length > 20) console.log(`  … and ${written.length - 20} more`);
  });
}

/**
 * Filename slug. Keeps any Unicode letter or digit rather than just [a-z0-9]:
 * an ASCII-only rule turns a fully non-Latin title into "untitled", so
 * every non-Latin meeting on a given day collapses to the same filename and
 * silently overwrites the last one.
 */
function slug(s?: string | null): string {
  return (
    (s ?? "untitled")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** Guard against two meetings mapping to the same filename within one export. */
const usedPaths = new Set<string>();
function uniquePath(path: string, id: string): string {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }
  const alt = path.replace(/\.md$/, `_${id}.md`);
  usedPaths.add(alt);
  return alt;
}

// -------------------------------------------------------------------- project

/**
 * Project scoping. `undecided` is the interesting one: it surfaces exactly the
 * meetings the free tiers could not settle, so the agent judges only those and
 * writes each verdict back via `classify` — turning a Tier-3 cost into a Tier-0
 * lookup for every future occurrence of that series.
 */
async function cmdProject(sub: string) {
  const { config } = loadConfig();
  const projects = config.projects ?? {};

  if (!sub || sub === "list") {
    if (!Object.keys(projects).length) {
      console.log("No projects configured. Ask Claude to set up project scoping, or add a `projects` block to your config.");
      return;
    }
    for (const [name, r] of Object.entries(projects)) {
      const dflt = name === config.defaultProject ? "  (default)" : "";
      console.log(`${name}${dflt}${r.label ? ` — ${r.label}` : ""}`);
      if (r.title?.include?.length) console.log(`   title include: ${r.title.include.join(", ")}`);
      if (r.title?.exclude?.length) console.log(`   title exclude: ${r.title.exclude.join(", ")}`);
      if (r.people?.include?.length) console.log(`   people include: ${r.people.include.join(", ")}`);
      if (r.people?.exclude?.length) console.log(`   people exclude: ${r.people.exclude.join(", ")}`);
      console.log(`   fallback: ${r.fallback ?? "undecided"}`);
    }
    const series = Object.entries(config.series ?? {});
    console.log(`\n${series.length} remembered series:`);
    for (const [k, v] of series) console.log(`   ${k.slice(0, 40).padEnd(42)} -> ${v.project ?? "(unrelated)"}${v.why ? `  — ${v.why}` : ""}`);
    return;
  }

  if (sub === "undecided") {
    const proj = activeProject(config);
    if (!proj) fail("No project selected. Pass --project <name> or set defaultProject.");
    const since = sinceToIso(str("since", "30"))!;
    const notes = await getClient().listNotes({
      filters: { created_at_start: since },
      include: { event_attendees: true },
      all: true,
    });
    const { undecided } = partition(notes, proj!.name, proj!.rules, config.series ?? {}, config.projects ?? {});

    // One row per series, not per occurrence — judging the series is the point.
    const bySeries = new Map<string, { title: string; count: number; dates: string[]; attendees: string[] }>();
    for (const n of undecided) {
      const k = meetingKey(n) ?? `id:${n.id}`;
      const e = bySeries.get(k) ?? { title: n.title ?? "(untitled)", count: 0, dates: [], attendees: [] };
      e.count++;
      e.dates.push((n.event_start ?? n.created_at ?? "").slice(0, 10));
      for (const a of n.event_attendees ?? []) { const v = a.email ?? a.name; if (v && !e.attendees.includes(v)) e.attendees.push(v); }
      bySeries.set(k, e);
    }

    const rows = [...bySeries].map(([key, e]) => ({ seriesKey: key, ...e, dates: e.dates.sort() }));
    out(rows, () => {
      if (!rows.length) return console.log(`Nothing undecided for project "${proj!.name}" since ${since.slice(0, 10)}.`);
      console.log(`${rows.length} undecided series for project "${proj!.name}" (${undecided.length} meetings):\n`);
      for (const r of rows) {
        console.log(`${r.title}`);
        console.log(`   series: ${r.seriesKey}`);
        console.log(`   ${r.count} occurrence(s), ${r.dates[0]}${r.count > 1 ? ` … ${r.dates.at(-1)}` : ""}`);
        if (r.attendees.length) console.log(`   attendees: ${r.attendees.slice(0, 6).join(", ")}${r.attendees.length > 6 ? ` +${r.attendees.length - 6}` : ""}`);
        console.log();
      }
      console.log(`Classify each with:\n  bun fellow.ts project classify <series-key> <project|none> --why "reason"`);
    });
    return;
  }

  if (sub === "classify") {
    const key = positional[2];
    const target = positional[3];
    if (!key || !target) fail(`Usage: bun fellow.ts project classify <series-key> <project-name|none> --why "reason"`);
    const project = target === "none" || target === "null" ? null : target;
    if (project && !projects[project]) {
      fail(`No project named "${project}". Known: ${Object.keys(projects).join(", ") || "(none)"}`);
    }
    const why = str("why") ?? "";
    if (!why) fail(`--why "reason" is required — a bare verdict is unreviewable six months from now.`);

    // Verify the key names a real meeting. A mistyped or invented key is written
    // happily and then never matches anything: the meeting stays undecided while
    // the config grows an entry that looks like a decision. Silent no-ops are the
    // worst failure mode for a cache, so check before writing.
    if (!has("force")) {
      const lookback = num("verify-days", 365)!;
      const notes = await getClient().listNotes({
        filters: { created_at_start: daysAgo(lookback) },
        all: true,
      });
      const known = new Map<string, string>();
      for (const n of notes) {
        const k = meetingKey(n);
        if (k && !known.has(k)) known.set(k, n.title ?? "(untitled)");
      }
      if (!known.has(key)) {
        const prefix = key.split(":")[1]?.slice(0, 8) ?? "";
        const near = [...known.keys()].filter((k) => prefix && k.includes(prefix)).slice(0, 3);
        fail(
          `No meeting in the last ${lookback} days has series key "${key}".\n` +
            (near.length ? `Did you mean:\n${near.map((k) => `  ${k}  (${known.get(k)})`).join("\n")}\n` : "") +
            `Run \`project undecided\` and copy the key from its output, or pass --force to record it anyway.`,
        );
      }
      console.log(`Verified: ${key} -> "${known.get(key)}"`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const { path, layer } = recordSeriesVerdict(key, project, why, today);
    console.log(`Recorded in ${layer} config (${path}):`);
    console.log(`  ${key} -> ${project ?? "(unrelated)"}  — ${why}`);
    return;
  }

  fail("Usage: bun fellow.ts project [list|undecided|classify] …");
}

// --------------------------------------------------------------------- config

async function cmdConfig(sub: string) {
  if (sub === "path") {
    const layer = (str("layer", "global") as Layer);
    const p = layerPath(layer);
    if (!p) fail(`The "${layer}" layer needs a git repository, and this directory is not inside one.`);
    console.log(p);
    return;
  }

  if (sub === "show") {
    const { config, found, missing, legacy } = loadConfig();
    if (asJson) return console.log(JSON.stringify({ config, found, missing, legacy }, null, 2));
    const isLegacy = (p: string) => legacy.some((l) => l.path === p);
    console.log("Config layers (later overrides earlier):");
    for (const f of found) console.log(`  ✓ ${f.layer.padEnd(6)} ${f.path}${isLegacy(f.path) ? "  (pre-rename path)" : ""}`);
    for (const m of missing) console.log(`  · ${m.layer.padEnd(6)} ${m.path} (absent)`);
    if (legacy.length) {
      console.log(
        `\n${legacy.length} file(s) sit at the pre-rename .agents/skill-config/ path. Both locations are read\n` +
          "and the new one wins, so nothing is broken — move them to .agents/config/ when convenient.",
      );
    }
    console.log(`\nWorkspace: ${config.workspace?.subdomain ?? "(not set)"}`);
    console.log(`Credential: ${config.credentials?.apiKey ? describeCredential(config.credentials.apiKey) : "(not set)"}`);
    const st = (config.storage ?? {}) as Record<string, any>;
    for (const k of ["recaps", "transcripts", "media"]) {
      const v = st[k];
      console.log(`Storage.${k}: ${!v ? "(not configured)" : v.enabled ? expandPath(v.path) : "disabled"}`);
    }
    const projects = Object.keys(config.projects ?? {});
    console.log(`Projects: ${projects.length ? projects.join(", ") : "(none)"}${config.defaultProject ? `  default=${config.defaultProject}` : ""}`);
    console.log(`Remembered series: ${Object.keys(config.series ?? {}).length}`);
    const problems = validate(config);
    console.log(problems.length ? `\nNot ready:\n${problems.map((p) => `  - ${p}`).join("\n")}` : "\nConfig looks complete.");
    return;
  }

  if (sub === "check") {
    const { config, found } = loadConfig();
    const problems = validate(config);
    if (problems.length) fail(`Config incomplete:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    console.log(`Config loaded from ${found.map((f) => f.layer).join(" → ")}`);
    process.stdout.write("Resolving credential… ");
    const key = resolveCredential(config.credentials!.apiKey!);
    console.log(`ok (${key.length} chars, not shown)`);
    process.stdout.write("Calling /me… ");
    const me = await new FellowClient(config.workspace!.subdomain!, key).me();
    console.log(`ok`);
    console.log(`\nAuthenticated as ${me.user.full_name} <${me.user.email}> in ${me.workspace.name}.`);
    return;
  }

  if (sub === "gitignore") {
    // The shared implementation tests with `git check-ignore`, so a pattern already covered
    // by a broader rule counts as ignored, and it carries the legacy pattern too.
    const { path, action } = ensureGitignored();
    if (action === "no-repo") fail("Not inside a git repository.");
    console.log(
      action === "already-ignored"
        ? `Already ignored: ${LOCAL_GITIGNORE_PATTERN}`
        : `Added to ${path}: ${LOCAL_GITIGNORE_PATTERN}`,
    );
    return;
  }

  fail("Usage: bun fellow.ts config <show|check|path|gitignore> [--layer global|repo|local]");
}

// ----------------------------------------------------------------------- main

const HELP = `Fellow API CLI (read-only)

  whoami                              Verify auth; print user + workspace
  notes list [opts]                   List notes
  notes get <id>                      Full note incl. markdown content
  recordings list [opts]              List recordings
  recordings get <id> [--transcript]  Recording + AI notes (+ transcript, --media for signed URL)
  action-items [--open] [--scope S]   List action items. --scope assigned_to_me (default)|assigned_to_others|all
  recap <id> [--transcript]           Meeting recap: joins a note with its recording's AI notes
  search <query> [--transcripts]      Local full-text search (the API has none)
  export [--transcripts] [--out DIR]  Bulk export to markdown files
  config show|check|path|gitignore    Inspect / verify configuration

Project scoping (filters meetings to one project)
  project list                        Show configured projects + remembered series
  project undecided [--since 30]      Series the cheap rules can't classify
  project classify <key> <proj|none> --why "…"   Remember a verdict (free thereafter)

Common options
  --since 30 | --since 2026-07-01     Window start (days ago, or a date)
  --until DATE                        Window end
  --title TEXT                        Exact title filter (server-side)
  --limit N                           Cap results (page max is 50)
  --all                               Follow pagination past the first page
  --project NAME                      Scope to a project (default: defaultProject).
                                      Applies to notes/recordings/search/export —
                                      NOT to action-items, which the API scopes by assignee.
  --all-meetings                      Disable project scoping for this call
  --json                              Machine-readable output
`;

const [cmd, sub] = positional;

try {
  switch (cmd) {
    case "whoami": await cmdWhoami(); break;
    case "notes":
      if (sub === "get") await cmdNotesGet(positional[2] ?? fail("Usage: notes get <id>"));
      else await cmdNotesList();
      break;
    case "recordings":
      if (sub === "get") await cmdRecordingsGet(positional[2] ?? fail("Usage: recordings get <id>"));
      else await cmdRecordingsList();
      break;
    case "action-items": case "action_items": await cmdActionItems(); break;
    case "recap": await cmdRecap(positional[1] ?? ""); break;
    case "project": await cmdProject(sub ?? "list"); break;
    case "search": await cmdSearch(positional.slice(1).join(" ")); break;
    case "export": await cmdExport(); break;
    case "config": await cmdConfig(sub ?? "show"); break;
    case "help": case undefined: console.log(HELP); break;
    default: fail(`Unknown command "${cmd}".\n\n${HELP}`);
  }
} catch (e: any) {
  fail(`Error: ${e.message}`);
}
