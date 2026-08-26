// Named work scopes, plus the alias and safety layers.
//
// A "scope" is one stream of work as a human thinks about it — a product, a
// client engagement, a squad — bound to the Jira projects and Confluence space
// that carry it. It's called a scope rather than a project because "project"
// already means something specific in Jira and reusing it would be ambiguous
// in every sentence that follows.
//
// Scopes are opt-in. With none configured the CLI behaves exactly as before, so
// nothing here can silently narrow a search the user meant to run wide.

import type { AtlassianConfig } from "./config";

export interface JiraScope {
  /** Project keys, which double as the issue-key prefixes (NEO → NEO-123). First is the default for create. */
  projects?: string[];
  defaultIssueType?: string;
  /** Applied to issues this scope creates, on top of anything passed with --labels. */
  labels?: string[];
  components?: string[];
  board?: number | string;
  /** AND-ed into searches — for a scope that is a slice of a shared project rather than a whole one. */
  jqlFilter?: string;
}

export interface ConfluenceScope {
  space?: string;
  /** New pages are created under this page unless --parent says otherwise. */
  parentPage?: string;
  cqlFilter?: string;
}

export interface Scope {
  /** Human name, for listings and for confirming to the user which scope is in play. */
  label?: string;
  jira?: JiraScope;
  confluence?: ConfluenceScope;
}

export interface NamedScope {
  name: string;
  scope: Scope;
}

export function listScopes(cfg: AtlassianConfig): NamedScope[] {
  return Object.entries(cfg.scopes ?? {}).map(([name, scope]) => ({ name, scope }));
}

/**
 * Which scope applies: an explicit request, else the configured default, else
 * none. `requested` of "none" disables scoping for one call.
 */
export function pickScope(cfg: AtlassianConfig, requested?: string): NamedScope | null {
  if (requested === "none") return null;
  const name = requested ?? cfg.defaultScope;
  if (!name) return null;
  const scope = cfg.scopes?.[name];
  if (!scope) {
    const known = Object.keys(cfg.scopes ?? {});
    throw new Error(
      `No scope named "${name}". ${known.length ? `Configured scopes: ${known.join(", ")}.` : "No scopes are configured."}`,
    );
  }
  return { name, scope };
}

/** The scope that owns an issue key, by its project prefix. Null when unknown. */
export function scopeForIssueKey(cfg: AtlassianConfig, issueKey: string): NamedScope | null {
  const prefix = issueKey.split("-")[0]?.toUpperCase();
  if (!prefix) return null;
  for (const { name, scope } of listScopes(cfg)) {
    if ((scope.jira?.projects ?? []).some((p) => p.toUpperCase() === prefix)) return { name, scope };
  }
  return null;
}

/**
 * AND a clause into a JQL query, ahead of any ORDER BY. Appending after the
 * ORDER BY produces a syntax error, which is the obvious way to get this wrong.
 */
export function andJql(jql: string, clause: string): string {
  const base = jql.trim();
  if (!base) return clause;
  const orderAt = base.search(/\border\s+by\b/i);
  if (orderAt === -1) return `${base} AND ${clause}`;
  return `${base.slice(0, orderAt).trim()} AND ${clause} ${base.slice(orderAt)}`;
}

export interface ScopedQuery {
  query: string;
  /** What the scope added, for printing back — silent narrowing is how wrong answers happen. */
  applied: string[];
}

/**
 * Narrow a JQL query to a scope. A query that already constrains `project` is
 * left alone on that axis: the user was specific, and overriding them would be
 * both surprising and impossible to work around.
 */
export function scopeJql(jql: string, scope: Scope | null): ScopedQuery {
  const applied: string[] = [];
  let query = jql;
  if (!scope?.jira) return { query, applied };

  const projects = scope.jira.projects ?? [];
  if (projects.length && !/\bproject\s*(=|!=|\bin\b|\bnot\b)/i.test(jql)) {
    const clause = projects.length === 1 ? `project = ${projects[0]}` : `project IN (${projects.join(", ")})`;
    query = andJql(query, clause);
    applied.push(clause);
  }
  const filter = scope.jira.jqlFilter?.trim();
  if (filter && !jql.includes(filter)) {
    query = andJql(query, `(${filter})`);
    applied.push(filter);
  }
  return { query, applied };
}

/** The CQL equivalent: add the scope's space and filter unless the query already says. */
export function scopeCql(cql: string, scope: Scope | null): ScopedQuery {
  const applied: string[] = [];
  let query = cql;
  if (!scope?.confluence) return { query, applied };

  const space = scope.confluence.space;
  if (space && !/\bspace\s*(=|!=|\bin\b)/i.test(cql)) {
    const clause = `space = "${space}"`;
    query = andCql(query, clause);
    applied.push(clause);
  }
  const filter = scope.confluence.cqlFilter?.trim();
  if (filter && !cql.includes(filter)) {
    query = andCql(query, `(${filter})`);
    applied.push(filter);
  }
  return { query, applied };
}

function andCql(cql: string, clause: string): string {
  const base = cql.trim();
  if (!base) return clause;
  const orderAt = base.search(/\border\s+by\b/i);
  if (orderAt === -1) return `${base} AND ${clause}`;
  return `${base.slice(0, orderAt).trim()} AND ${clause} ${base.slice(orderAt)}`;
}

/**
 * Friendly field name → Jira field id. Lets a team write `--field points=5`
 * once they've recorded that points is customfield_10016 on their instance,
 * instead of every caller looking the number up again.
 */
export function resolveFieldId(cfg: AtlassianConfig, nameOrId: string): string {
  const alias = cfg.fields?.[nameOrId] ?? cfg.fields?.[nameOrId.toLowerCase()];
  return alias ?? nameOrId;
}

/** Alias → accountId (Cloud) or username (Data Center). Passes through anything unaliased. */
export function resolvePerson(cfg: AtlassianConfig, nameOrId: string): string {
  return cfg.people?.[nameOrId] ?? cfg.people?.[nameOrId.toLowerCase()] ?? nameOrId;
}

export interface SafetyVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Commands that only read. Everything else counts as a write under
 * `safety.readOnly`, so a subcommand added later is refused until someone
 * deliberately lists it here — a safety flag has to fail closed to be worth
 * anything.
 */
const READ_ONLY_COMMANDS: Record<"jira" | "confluence", ReadonlySet<string>> = {
  jira: new Set([
    "whoami",
    "search",
    "get",
    "comments",
    "projects",
    "link-types",
    "fields",
    "meta",
    "boards",
    "sprints",
  ]),
  confluence: new Set([
    "whoami",
    "spaces",
    "search",
    "get",
    "children",
    "pages",
    "comments",
    "attachments",
    "to-storage",
  ]),
};

/**
 * Whether a subcommand mutates anything. `transition --list` and the like are
 * still classed as writes: the flag that makes them harmless is one typo away
 * from absent, and read-only should not depend on argument parsing.
 */
export function isWriteCommand(product: "jira" | "confluence", sub: string | undefined): boolean {
  if (!sub) return false;
  return !READ_ONLY_COMMANDS[product].has(sub);
}

/**
 * Config-level guards. `--yes` is a check against mistakes in the moment;
 * these are a standing decision, which is what you want on an instance where
 * an agent should never be able to destroy anything regardless of prompting.
 */
export function checkSafety(cfg: AtlassianConfig, action: "delete" | "purge" | "write"): SafetyVerdict {
  const safety = cfg.safety ?? {};
  if (safety.readOnly === true) {
    return {
      allowed: false,
      reason:
        "safety.readOnly is true in the Atlassian skill config — this instance is configured for reading only, so nothing can be created, edited, moved, or deleted.",
    };
  }
  if (action === "delete" && safety.allowDelete === false) {
    return {
      allowed: false,
      reason: "safety.allowDelete is false in the Atlassian skill config — deletion is disabled for this instance.",
    };
  }
  if (action === "purge" && safety.allowPurge === false) {
    return {
      allowed: false,
      reason: "safety.allowPurge is false in the Atlassian skill config — permanent deletion is disabled; the page can still be moved to the trash.",
    };
  }
  return { allowed: true };
}
