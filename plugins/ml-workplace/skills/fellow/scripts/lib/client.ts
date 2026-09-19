// Fellow Developer API client. Read-only surface.
//
// Two things about this API bite every time, so they are handled here once:
//  1. List endpoints are POST, not GET. A GET returns 405.
//  2. page_size must be nested under `pagination`. Putting it at the top level
//     returns HTTP 200 with an EMPTY list rather than a validation error, which
//     looks exactly like "the workspace has no data".

export interface ListOptions {
  pageSize?: number;
  /** Fetch every page up to this many items. Omit for a single page. */
  all?: boolean;
  max?: number;
  filters?: Record<string, unknown>;
  include?: Record<string, boolean>;
}

export class FellowError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FellowClient {
  private base: string;

  constructor(private subdomain: string, private apiKey: string) {
    this.base = `https://${subdomain}.fellow.app/api/v1`;
  }

  private async request(path: string, method: "GET" | "POST", body?: unknown): Promise<any> {
    // The API returns an occasional 500 on otherwise-valid requests, and a
    // long `--all` pagination walk is many chances to hit one. Retry transient
    // failures rather than losing a multi-page fetch to a single blip.
    let res!: Response;
    let text!: string;
    const maxAttempts = 3;

    for (let attempt = 1; ; attempt++) {
      try {
        res = await fetch(`${this.base}${path}`, {
          method,
          headers: {
            "X-API-KEY": this.apiKey,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        text = await res.text();
      } catch (e: any) {
        if (attempt >= maxAttempts) throw new FellowError(`Network error calling ${path}: ${e.message}`);
        await sleep(attempt * 700);
        continue;
      }

      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable || attempt >= maxAttempts) break;
      await sleep(attempt * 700);
    }

    if (!res.ok) {
      // Fellow returns an HTML error page for a bad subdomain, which is a far more
      // common mistake than a genuine API error — say so rather than dumping HTML.
      if (text.trimStart().startsWith("<")) {
        if (res.status === 404) {
          throw new FellowError(
            `404 from https://${this.subdomain}.fellow.app${path} — the workspace subdomain "${this.subdomain}" ` +
              `looks wrong, or this endpoint does not exist. Check workspace.subdomain in your config.`,
            404,
          );
        }
        throw new FellowError(`HTTP ${res.status} from ${path} (HTML error page returned).`, res.status);
      }
      if (res.status === 401 || res.status === 403) {
        throw new FellowError(
          `HTTP ${res.status} — the API key was rejected. It may be revoked, or belong to a different ` +
            `workspace than "${this.subdomain}". Response: ${text.slice(0, 200)}`,
          res.status,
        );
      }
      throw new FellowError(`HTTP ${res.status} from ${path}: ${text.slice(0, 400)}`, res.status);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new FellowError(`Expected JSON from ${path} but got: ${text.slice(0, 200)}`);
    }
  }

  async me() {
    return this.request("/me", "GET");
  }

  /** POST a list endpoint, following cursors when `all` is set. */
  private async list(path: string, key: string, opts: ListOptions = {}): Promise<any[]> {
    const pageSize = Math.min(opts.pageSize ?? 50, 50); // API caps at 50
    const max = opts.max ?? (opts.all ? 5000 : pageSize);
    const out: any[] = [];
    let cursor: string | undefined;

    while (out.length < max) {
      const body: Record<string, unknown> = { pagination: { page_size: pageSize, ...(cursor ? { cursor } : {}) } };
      if (opts.filters && Object.keys(opts.filters).length) body.filters = opts.filters;
      if (opts.include && Object.keys(opts.include).length) body.include = opts.include;

      const res = await this.request(path, "POST", body);
      const page = res?.[key];
      const data: any[] = page?.data ?? [];
      out.push(...data);

      cursor = page?.page_info?.cursor;
      // Stop on a short page: the cursor keeps being returned past the end.
      if (!opts.all || !cursor || data.length < pageSize) break;
    }

    return out.slice(0, max);
  }

  listNotes(opts: ListOptions = {}) {
    return this.list("/notes", "notes", opts);
  }

  listRecordings(opts: ListOptions = {}) {
    return this.list("/recordings", "recordings", opts);
  }

  listActionItems(opts: ListOptions = {}) {
    return this.list("/action_items", "action_items", opts);
  }

  async getNote(id: string) {
    const r = await this.request(`/note/${encodeURIComponent(id)}`, "GET");
    return r.note ?? r;
  }

  /**
   * Singular path `/recording/{id}` (not `/recordings/{id}`). Takes no query
   * parameters: unlike the list endpoint, it returns transcript and ai_notes
   * in full by default. `media_url` is the exception — see mediaUrlFor().
   */
  async getRecording(id: string) {
    const r = await this.request(`/recording/${encodeURIComponent(id)}`, "GET");
    return r.recording ?? r;
  }

  /**
   * Signed media URLs are only issued by the *list* endpoint, so fetching one for
   * a single recording means listing with an event_guid filter. expireIn is
   * clamped by the API to 1h–24h.
   */
  async mediaUrlFor(eventGuid: string, expireIn = 43200): Promise<string | null> {
    const body = {
      pagination: { page_size: 50 },
      filters: { event_guid: eventGuid },
      media_url: { expire_in: expireIn },
    };
    const res = await this.request("/recordings", "POST", body);
    const first = res?.recordings?.data?.[0];
    return first?.media_url ?? null;
  }

  async getActionItem(id: string) {
    const r = await this.request(`/action_item/${encodeURIComponent(id)}`, "GET");
    return r.action_item ?? r;
  }
}

/** Render a transcript's speech_segments as readable text. */
export function transcriptToText(transcript: any): string {
  const segs = transcript?.speech_segments ?? [];
  if (!segs.length) return "";
  const lines: string[] = [];
  let last: string | null = null;
  for (const s of segs) {
    const speaker = s.speaker ?? "Unknown";
    const stamp = formatTimestamp(s.start);
    if (speaker !== last) {
      lines.push("", `**${speaker}** [${stamp}]`);
      last = speaker;
    }
    lines.push(s.text);
  }
  return lines.join("\n").trim();
}

function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Render Fellow's AI notes as markdown.
 *
 * Each block has sections whose `content` is either a markdown string
 * ("Summary") or an array. Array items come in two shapes and mixing them up
 * silently prints "undefined":
 *   - {timestamp, text, …}      — "Decisions", "Action items" (plus assignees/due date)
 *   - {title, bullet_points[]}  — "Topics", where each bullet is {timestamp, text}
 */
export function aiNotesToMarkdown(aiNotes: any): string {
  const blocks = Array.isArray(aiNotes) ? aiNotes : [];
  const out: string[] = [];

  const stamp = (t: unknown) => (typeof t === "number" ? ` _(${formatTimestamp(t)})_` : "");

  for (const block of blocks) {
    for (const section of block.sections ?? []) {
      const content = section.content;
      if (!content || (Array.isArray(content) && !content.length)) continue;
      out.push(`### ${section.title}`, "");

      if (typeof content === "string") {
        out.push(content, "");
        continue;
      }
      if (!Array.isArray(content)) continue;

      for (const item of content) {
        if (Array.isArray(item?.bullet_points)) {
          // Topic: a heading with its own nested bullets.
          out.push(`**${item.title ?? "(untitled topic)"}**`, "");
          for (const b of item.bullet_points) out.push(`- ${b.text ?? ""}${stamp(b.timestamp)}`);
          out.push("");
        } else if (item?.text != null) {
          const who = (item.assignees ?? []).map((a: any) => a.full_name ?? a.name ?? a.email).filter(Boolean);
          const due = item.due_date ? `, due ${String(item.due_date).slice(0, 10)}` : "";
          const meta = who.length || due ? ` — ${who.join(", ")}${due}` : "";
          out.push(`- ${item.text}${meta}${stamp(item.timestamp)}`);
        }
      }
      out.push("");
    }
  }
  return out.join("\n").trim();
}

/** ISO date for `n` days ago — the API wants ISO strings in its date filters. */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString();
}
