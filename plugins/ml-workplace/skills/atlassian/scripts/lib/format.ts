// Human-readable rendering. The CLI's default output is meant to be read by a
// person or summarised by an agent, so it stays compact: raw Jira JSON for a
// single issue is tens of kilobytes, almost all of it schema noise.

import { adfToMarkdown } from "./adf";
import { storageToMarkdown } from "./storage";
import type { Page, SearchHit } from "./confluence";

export function truncate(s: string, n: number): string {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

/** Column-aligned table. Widths are capped so one long summary can't wreck it. */
export function table(rows: string[][], caps: number[] = []): string {
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const clipped = rows.map((r) =>
    Array.from({ length: cols }, (_, i) => {
      const cell = r[i] ?? "";
      const cap = caps[i];
      return cap ? truncate(cell, cap) : cell;
    }),
  );
  const widths = Array.from({ length: cols }, (_, i) => Math.max(...clipped.map((r) => [...r[i]].length)));
  return clipped
    .map((r) => r.map((c, i) => (i === cols - 1 ? c : c + " ".repeat(widths[i] - [...c].length))).join("  ").trimEnd())
    .join("\n");
}

function name(v: any): string {
  if (!v) return "";
  return v.displayName ?? v.name ?? v.value ?? String(v);
}

export function issueRows(issues: any[]): string {
  const rows = issues.map((i) => {
    const f = i.fields ?? {};
    return [
      i.key ?? "",
      `[${name(f.status) || "?"}]`,
      name(f.issuetype),
      name(f.assignee) || "unassigned",
      truncate(f.summary ?? "", 70),
    ];
  });
  return table(rows, [12, 20, 14, 22, 70]);
}

export function formatIssue(issue: any, opts: { comments?: any[]; browseUrl?: string } = {}): string {
  const f = issue.fields ?? {};
  const out: string[] = [];
  out.push(`# ${issue.key} — ${f.summary ?? "(no summary)"}`);
  out.push("");

  const meta: [string, string][] = [
    ["Type", name(f.issuetype)],
    ["Status", name(f.status)],
    ["Priority", name(f.priority)],
    ["Assignee", name(f.assignee) || "unassigned"],
    ["Reporter", name(f.reporter)],
    ["Project", f.project ? `${f.project.key} (${f.project.name ?? ""})`.trim() : ""],
    ["Parent", f.parent ? `${f.parent.key} — ${f.parent.fields?.summary ?? ""}`.trim() : ""],
    ["Labels", (f.labels ?? []).join(", ")],
    ["Resolution", name(f.resolution)],
    ["Due", f.duedate ?? ""],
    ["Created", (f.created ?? "").slice(0, 10)],
    ["Updated", (f.updated ?? "").slice(0, 10)],
    ["URL", opts.browseUrl ?? ""],
  ];
  for (const [k, v] of meta) if (v) out.push(`- **${k}:** ${v}`);

  // Custom fields carry the interesting project-specific data (story points,
  // epic link, team) and are invisible unless surfaced deliberately.
  const custom = Object.entries(f)
    .filter(([k, v]) => k.startsWith("customfield_") && v !== null && v !== undefined && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `- **${k}:** ${truncate(typeof v === "object" ? name(v) || JSON.stringify(v) : String(v), 120)}`);
  if (custom.length) out.push(...custom);

  const description = adfToMarkdown(f.description);
  if (description) out.push("", "## Description", "", description);

  const subtasks = f.subtasks ?? [];
  if (subtasks.length) {
    out.push("", "## Subtasks", "");
    for (const s of subtasks) out.push(`- ${s.key} [${name(s.fields?.status)}] ${s.fields?.summary ?? ""}`);
  }

  const links = f.issuelinks ?? [];
  if (links.length) {
    out.push("", "## Links", "");
    for (const l of links) {
      const other = l.outwardIssue ?? l.inwardIssue;
      const label = l.outwardIssue ? l.type?.outward : l.type?.inward;
      if (other) out.push(`- ${label}: ${other.key} — ${truncate(other.fields?.summary ?? "", 60)}`);
    }
  }

  if (opts.comments?.length) {
    out.push("", `## Comments (${opts.comments.length})`, "");
    for (const c of opts.comments) {
      const who = name(c.author) || "unknown";
      const when = (c.created ?? "").slice(0, 16).replace("T", " ");
      out.push(`**${who}** — ${when}`, "", adfToMarkdown(c.body) || "_(empty)_", "");
    }
  }

  return out.join("\n").trim();
}

export function formatPage(page: Page, opts: { comments?: { author?: string; when?: string; storage: string }[] } = {}): string {
  const out: string[] = [
    `# ${page.title}`,
    "",
    `- **Page id:** ${page.id}`,
    ...(page.spaceKey ? [`- **Space:** ${page.spaceKey}`] : []),
    `- **Version:** ${page.version}`,
    ...(page.parentId ? [`- **Parent:** ${page.parentId}`] : []),
    `- **URL:** ${page.url}`,
  ];
  if (page.storage !== undefined) out.push("", "---", "", storageToMarkdown(page.storage));
  if (opts.comments?.length) {
    out.push("", `## Comments (${opts.comments.length})`, "");
    for (const c of opts.comments) {
      out.push(`**${c.author ?? "unknown"}** — ${(c.when ?? "").slice(0, 16).replace("T", " ")}`, "");
      out.push(storageToMarkdown(c.storage) || "_(empty)_", "");
    }
  }
  return out.join("\n").trim();
}

export function hitRows(hits: SearchHit[]): string {
  const rows = hits.map((h) => [h.id, h.spaceKey ?? "", h.type, truncate(h.title, 60)]);
  return table(rows, [14, 12, 10, 60]);
}

export function hitDetails(hits: SearchHit[]): string {
  return hits
    .map((h) => {
      const bits = [`**${h.title}** (${h.type} ${h.id}${h.spaceKey ? `, space ${h.spaceKey}` : ""})`, h.url];
      if (h.excerpt) bits.push(truncate(h.excerpt, 220));
      return bits.join("\n  ");
    })
    .join("\n\n");
}
