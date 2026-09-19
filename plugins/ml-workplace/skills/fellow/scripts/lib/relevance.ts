// Project scoping: decide whether a meeting belongs to a project, cheapest check first.
//
// Tier 0  series map   — a remembered verdict for this calendar series. Free, exact.
// Tier 1  title rules  — keyword/regex on the meeting title. Free.
// Tier 2  participants — attendee emails or domains. Free, but the caller must
//                        have requested event_attendees from the API.
// Tier 3  semantic     — NOT done here. Anything still undecided is returned as
//                        such so the agent can read the summary, judge, and write
//                        the verdict back into Tier 0 — where it costs nothing
//                        forever after.

export type Verdict = "include" | "exclude" | "undecided";

export interface ProjectRules {
  label?: string;
  title?: { include?: string[]; exclude?: string[] };
  people?: { include?: string[]; exclude?: string[] };
  /** What to do when no rule matches. Default "undecided". */
  fallback?: Verdict;
}

export interface SeriesVerdict {
  /** Project name this series belongs to, or null for "belongs to no project". */
  project: string | null;
  why?: string;
  at?: string;
}

export interface Decision {
  verdict: Verdict;
  tier: 0 | 1 | 2 | 3;
  why: string;
  seriesKey: string | null;
}

/**
 * A calendar id that is stable across occurrences of a recurring meeting.
 *
 * event_guid is per-occurrence, so caching on it caches nothing. Two formats
 * appear in practice:
 *   Google Calendar  "<seriesId>_20240115T090000Z"  -> seriesId
 *   Outlook          112 hex GlobalObjectId          -> trailing 32 hex (the data GUID;
 *                                                      earlier bytes encode the date)
 * Anything else is treated as a one-off event and keyed on itself.
 *
 * Note a recreated/rescheduled series legitimately yields a new key — that is a
 * different calendar series, and re-judging it once is correct behaviour.
 */
export function seriesKey(guid?: string | null): string | null {
  if (!guid) return null;
  const g = String(guid).trim();
  if (!g) return null;

  const gcal = g.match(/^(.+)_\d{8}T\d{6}Z$/);
  if (gcal) return `gcal:${gcal[1]}`;

  if (/^[0-9A-Fa-f]{112}$/.test(g)) return `ol:${g.slice(-32).toLowerCase()}`;

  return `id:${g}`;
}

/**
 * The cache key for a meeting. Some meetings carry no event_guid at all, so fall
 * back to the note id — such a meeting is a one-off and will never recur anyway.
 *
 * Every caller must use THIS, not seriesKey() directly: if the key used to
 * display a verdict differs from the key used to look one up, recorded verdicts
 * are silently never found and the meeting stays undecided forever.
 */
export function meetingKey(meeting: any): string | null {
  return seriesKey(meeting?.event_guid) ?? (meeting?.id ? `id:${meeting.id}` : null);
}

const norm = (s: string) => s.toLowerCase();

/** Match a needle against a haystack; /regex/ syntax is honoured, else substring. */
function matches(needle: string, hay: string): boolean {
  const re = needle.match(/^\/(.*)\/([a-z]*)$/);
  if (re) {
    try {
      return new RegExp(re[1], re[2] || "i").test(hay);
    } catch {
      return false; // a broken pattern should not take the whole run down
    }
  }
  return norm(hay).includes(norm(needle));
}

function attendeeStrings(meeting: any): string[] {
  const out: string[] = [];
  for (const a of meeting?.event_attendees ?? []) {
    for (const v of [a?.email, a?.name, a?.full_name]) if (v) out.push(String(v));
  }
  return out;
}

/**
 * Classify one meeting against one project's rules.
 * `series` is the remembered Tier-0 map, keyed by seriesKey().
 */
export function classify(
  meeting: any,
  projectName: string,
  rules: ProjectRules,
  series: Record<string, SeriesVerdict> = {},
): Decision {
  const key = meetingKey(meeting);

  // Tier 0 — remembered verdict.
  if (key && series[key]) {
    const s = series[key];
    return {
      verdict: s.project === projectName ? "include" : "exclude",
      tier: 0,
      why: s.why ? `remembered: ${s.why}` : `remembered as ${s.project ?? "unrelated"}`,
      seriesKey: key,
    };
  }

  const title = String(meeting?.title ?? "");

  // Tier 1 — title. Exclusions win over inclusions so a narrow "not this one"
  // can carve an exception out of a broad include.
  for (const p of rules.title?.exclude ?? []) {
    if (matches(p, title)) return { verdict: "exclude", tier: 1, why: `title matches exclude "${p}"`, seriesKey: key };
  }
  for (const p of rules.title?.include ?? []) {
    if (matches(p, title)) return { verdict: "include", tier: 1, why: `title matches "${p}"`, seriesKey: key };
  }

  // Tier 2 — participants. Only meaningful if attendees were fetched.
  const people = attendeeStrings(meeting);
  if (people.length) {
    for (const p of rules.people?.exclude ?? []) {
      const hit = people.find((a) => matches(p, a));
      if (hit) return { verdict: "exclude", tier: 2, why: `attendee ${hit} matches exclude "${p}"`, seriesKey: key };
    }
    for (const p of rules.people?.include ?? []) {
      const hit = people.find((a) => matches(p, a));
      if (hit) return { verdict: "include", tier: 2, why: `attendee ${hit} matches "${p}"`, seriesKey: key };
    }
  }

  const fallback = rules.fallback ?? "undecided";
  return {
    verdict: fallback,
    tier: 3,
    why:
      fallback === "undecided"
        ? people.length
          ? "no title or attendee rule matched — needs a judgement call"
          : "no title rule matched (attendees not fetched)"
        : `no rule matched; project fallback is "${fallback}"`,
    seriesKey: key,
  };
}

/**
 * Split meetings into in-scope / out-of-scope / undecided.
 *
 * `allProjects` enables cross-project disambiguation: a meeting that no rule of
 * *this* project matches, but which clearly belongs to another configured
 * project, is excluded rather than left undecided. Without this, every standup
 * for project B queues up as a judgement call while scoped to project A —
 * paying Tier-3 cost for something the config already answers.
 */
export function partition(
  meetings: any[],
  projectName: string,
  rules: ProjectRules,
  series: Record<string, SeriesVerdict> = {},
  allProjects: Record<string, ProjectRules> = {},
) {
  const others = Object.entries(allProjects).filter(([n]) => n !== projectName);
  const included: any[] = [], excluded: any[] = [], undecided: any[] = [];

  for (const m of meetings) {
    let d = classify(m, projectName, rules, series);

    if (d.verdict === "undecided") {
      for (const [otherName, otherRules] of others) {
        // Only a positive match on the other project counts — its own fallback
        // must not decide anything on this project's behalf.
        const alt = classify(m, otherName, { ...otherRules, fallback: "undecided" }, series);
        if (alt.verdict === "include") {
          d = { verdict: "exclude", tier: alt.tier, why: `belongs to project "${otherName}" (${alt.why})`, seriesKey: d.seriesKey };
          break;
        }
      }
    }

    m._relevance = d;
    (d.verdict === "include" ? included : d.verdict === "exclude" ? excluded : undecided).push(m);
  }
  return { included, excluded, undecided };
}

/** True when the project's rules can only be evaluated with attendee data. */
export function needsAttendees(rules: ProjectRules): boolean {
  return Boolean((rules.people?.include?.length ?? 0) || (rules.people?.exclude?.length ?? 0));
}
