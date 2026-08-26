#!/usr/bin/env bun
// Jira + Confluence CLI. Zero dependencies: bun's fetch and nothing else.
//
//   bun atlassian.ts help
//   bun atlassian.ts config check
//   bun atlassian.ts jira search 'project = NEO AND status != Done'
//   bun atlassian.ts confluence get 123456

import { readFileSync } from "fs";
import { basename } from "path";
import {
  loadConfig,
  layerPath,
  resolveProduct,
  validate,
  ensureGitignored,
  expandPath,
  type AtlassianConfig,
  type Layer,
  type Product,
} from "./lib/config";
import { describeCredential } from "./lib/credentials";
import {
  checkSafety,
  isWriteCommand,
  listScopes,
  pickScope,
  resolveFieldId,
  resolvePerson,
  scopeCql,
  scopeForIssueKey,
  scopeJql,
  type NamedScope,
} from "./lib/scope";
import { HttpClient, AtlassianError } from "./lib/http";
import { JiraClient, DEFAULT_FIELDS } from "./lib/jira";
import { ConfluenceClient, buildTextCql } from "./lib/confluence";
import { adfToMarkdown, renderBody } from "./lib/adf";
import { markdownToStorage, storageToMarkdown } from "./lib/storage";
import { formatIssue, formatPage, hitDetails, issueRows, table, truncate } from "./lib/format";

// ---------------------------------------------------------------- arguments

interface Args {
  positional: string[];
  flags: Record<string, string[] | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string[] | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    let value: string | undefined = eq === -1 ? undefined : a.slice(eq + 1);
    if (value === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
      value = argv[++i];
    }
    if (value === undefined) {
      flags[key] = true;
    } else {
      const existing = flags[key];
      flags[key] = Array.isArray(existing) ? [...existing, value] : [value];
    }
  }
  return { positional, flags };
}

const A = {
  str(args: Args, name: string): string | undefined {
    const v = args.flags[name];
    return Array.isArray(v) ? v[v.length - 1] : undefined;
  },
  bool(args: Args, name: string): boolean {
    return args.flags[name] !== undefined;
  },
  num(args: Args, name: string): number | undefined {
    const v = A.str(args, name);
    return v === undefined ? undefined : Number(v);
  },
  list(args: Args, name: string): string[] {
    const v = args.flags[name];
    if (!Array.isArray(v)) return [];
    return v.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  },
  multi(args: Args, name: string): string[] {
    const v = args.flags[name];
    return Array.isArray(v) ? v : [];
  },
};

function readText(pathOrDash: string): string {
  if (pathOrDash === "-") return readFileSync(0, "utf8");
  return readFileSync(expandPath(pathOrDash), "utf8");
}

/** Body text from --body or --body-file (use "-" for stdin). */
function bodyText(args: Args, inline = "body", file = "body-file"): string | undefined {
  const f = A.str(args, file);
  if (f) return readText(f);
  return A.str(args, inline);
}

function out(text: string) {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

function json(value: unknown) {
  out(JSON.stringify(value, null, 2));
}

function fail(message: string, code = 1): never {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n");
  process.exit(code);
}

// ---------------------------------------------------------------- clients

function context(product: Product) {
  const loaded = loadConfig();
  const problems = validate(loaded.config, product);
  if (problems.length) {
    fail(
      `${product} is not configured yet:\n  - ${problems.join("\n  - ")}\n\n` +
        `This is the expected first-run state. Run 'config check' for the full picture, then follow the ` +
        `onboarding steps in SKILL.md.`,
      3,
    );
  }
  const site = resolveProduct(loaded.config, product);
  return { config: loaded.config, site, http: new HttpClient(site) };
}

/**
 * Refuse a mutating subcommand outright when the config says read-only. This
 * sits at the dispatcher rather than inside each write case so that a command
 * added later is refused until it is explicitly listed as a read — the failure
 * mode of forgetting should be "too strict", never "silently writable".
 *
 * Loads config directly: a read-only instance should refuse before any client
 * is constructed or any credential is resolved.
 */
function guardReadOnly(product: Product, sub: string | undefined) {
  if (!isWriteCommand(product, sub)) return;
  const verdict = checkSafety(loadConfig().config, "write");
  if (!verdict.allowed) fail(`Refusing to run '${product} ${sub}'. ${verdict.reason}`);
}

function jira(args?: Args) {
  const c = context("jira");
  return { ...c, client: new JiraClient(c.http, c.site.deployment), scope: scopeFrom(c.config, args) };
}

function confluence(args?: Args) {
  const c = context("confluence");
  return { ...c, client: new ConfluenceClient(c.http, c.site.deployment), scope: scopeFrom(c.config, args) };
}

/** `--scope x` picks one, `--no-scope` disables, otherwise the configured default. */
function scopeFrom(config: ReturnType<typeof loadConfig>["config"], args?: Args): NamedScope | null {
  if (args && A.bool(args, "no-scope")) return null;
  return pickScope(config, args ? A.str(args, "scope") : undefined);
}

/** Tell the user what a scope narrowed, so a filtered answer is never mistaken for the whole picture. */
function scopeNote(scope: NamedScope | null, applied: string[]): string | null {
  if (!scope || !applied.length) return null;
  return `[scope "${scope.name}" applied: ${applied.join(" AND ")} — use --no-scope to search everything]`;
}

// ---------------------------------------------------------------- config commands

async function cmdConfig(args: Args) {
  const sub = args.positional[0] ?? "check";

  if (sub === "path") {
    const layer = (A.str(args, "layer") ?? "global") as Layer;
    const p = layerPath(layer);
    if (!p) fail(`The ${layer} layer needs a git repository. Run inside one, or use --layer global.`);
    out(p);
    return;
  }

  if (sub === "gitignore") {
    const { path, added } = ensureGitignored();
    out(added ? `Added the local config pattern to ${path}` : `${path} already ignores the local config layer.`);
    return;
  }

  const loaded = loadConfig();

  if (sub === "scopes") {
    const scopes = listScopes(loaded.config);
    if (A.bool(args, "json")) return json({ defaultScope: loaded.config.defaultScope ?? null, scopes: loaded.config.scopes ?? {} });
    if (!scopes.length) {
      return out(
        "No scopes configured.\n\nScopes bind a stream of work to its Jira projects and Confluence space so you " +
          "don't repeat them on every command. To propose some, list what actually exists:\n" +
          "  jira projects\n  confluence spaces",
      );
    }
    // Fall back to the filters when projects/space are unset, so a scope that
    // narrows via jqlFilter or cqlFilter doesn't read as narrowing nothing.
    const rows = scopes.map(({ name, scope }) => [
      name === loaded.config.defaultScope ? `${name} *` : name,
      scope.label ?? "",
      (scope.jira?.projects ?? []).join(", ") || (scope.jira?.jqlFilter ?? ""),
      scope.confluence?.space ?? scope.confluence?.cqlFilter ?? "",
    ]);
    return out(
      [table([["SCOPE", "LABEL", "JIRA", "SPACE"], ...rows], [20, 30, 24, 24]), "", "* = default (used when --scope is omitted)"].join("\n"),
    );
  }

  if (sub === "scope") {
    // Answers "this ticket is NEO-123 — which space do its docs live in?"
    const key = args.positional[1];
    if (!key) fail("Usage: config scope <ISSUE-KEY>");
    const found = scopeForIssueKey(loaded.config, key);
    if (A.bool(args, "json")) return json(found);
    if (!found) return out(`No configured scope claims the prefix "${key.split("-")[0]}".`);
    const { name, scope } = found;
    return out(
      [
        `${key} belongs to scope "${name}"${scope.label ? ` (${scope.label})` : ""}.`,
        scope.confluence?.space ? `- Confluence space: ${scope.confluence.space}` : null,
        scope.confluence?.parentPage ? `- Pages are created under: ${scope.confluence.parentPage}` : null,
        scope.jira?.board ? `- Board: ${scope.jira.board}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (sub === "show") {
    if (A.bool(args, "json")) return json(loaded);
    const lines: string[] = ["## Config layers", ""];
    for (const { layer, path } of loaded.found) lines.push(`- ${layer}: ${path}`);
    for (const { layer, path } of loaded.missing) lines.push(`- ${layer}: (not present) ${path}`);
    if (!loaded.found.length) lines.push("- none found — the skill is unconfigured");

    for (const product of ["jira", "confluence"] as Product[]) {
      lines.push("", `## ${product}`, "");
      const problems = validate(loaded.config, product);
      if (problems.length) {
        lines.push(...problems.map((p) => `- missing: ${p}`));
        continue;
      }
      const site = resolveProduct(loaded.config, product);
      lines.push(`- base URL: ${site.baseUrl}`);
      lines.push(`- deployment: ${site.deployment}${loaded.config[product]?.deployment ? "" : " (inferred from URL)"}`);
      lines.push(`- auth: ${site.authMode}${site.authMode === "basic" ? ` as ${site.email}` : " (personal access token)"}`);
      lines.push(`- credential: ${site.credentialKey} → ${describeCredential(site.credential)} (not resolved)`);
    }
    const scopes = listScopes(loaded.config);
    if (scopes.length) {
      lines.push("", "## Scopes", "");
      for (const { name, scope } of scopes) {
        const bits = [
          scope.jira?.projects?.length ? `jira ${scope.jira.projects.join("/")}` : null,
          scope.confluence?.space ? `space ${scope.confluence.space}` : null,
          scope.jira?.jqlFilter ? `jql "${scope.jira.jqlFilter}"` : null,
        ].filter(Boolean);
        lines.push(`- ${name}${name === loaded.config.defaultScope ? " (default)" : ""}: ${bits.join(", ") || "(empty)"}`);
      }
    }
    if (loaded.config.fields) {
      lines.push("", "## Field aliases", "");
      for (const [alias, id] of Object.entries(loaded.config.fields)) lines.push(`- ${alias} → ${id}`);
    }
    if (loaded.config.people) {
      lines.push("", "## People aliases", "");
      for (const [alias, id] of Object.entries(loaded.config.people)) lines.push(`- ${alias} → ${id}`);
    }
    const safety = loaded.config.safety;
    if (safety && (safety.readOnly === true || safety.allowDelete === false || safety.allowPurge === false)) {
      lines.push("", "## Safety", "");
      if (safety.readOnly === true) {
        lines.push("- READ-ONLY (safety.readOnly: true) — no create, update, comment, transition, or delete");
      }
      if (safety.allowDelete === false) lines.push("- deletion is disabled (safety.allowDelete: false)");
      if (safety.allowPurge === false) lines.push("- permanent purge is disabled (safety.allowPurge: false)");
    }
    if (loaded.config.jira?.defaultProject || loaded.config.confluence?.defaultSpace || loaded.config.defaults?.issueType) {
      lines.push("", "## Defaults", "");
      if (loaded.config.jira?.defaultProject) lines.push(`- jira.defaultProject: ${loaded.config.jira.defaultProject}`);
      if (loaded.config.confluence?.defaultSpace) lines.push(`- confluence.defaultSpace: ${loaded.config.confluence.defaultSpace}`);
      if (loaded.config.defaults?.issueType) lines.push(`- defaults.issueType: ${loaded.config.defaults.issueType}`);
    }
    const exports = loaded.config.storage?.exports;
    lines.push("", "## Storage", "", exports?.enabled ? `- exports: ${expandPath(exports.path)}` : "- exports: (not configured)");
    out(lines.join("\n"));
    return;
  }

  if (sub !== "check") fail(`Unknown config command "${sub}". Try: check, show, scopes, scope, path, gitignore.`);

  // check: prove the credential works rather than just that a file exists.
  const results: string[] = [];
  let anyConfigured = false;
  let anyFailed = false;

  for (const product of ["jira", "confluence"] as Product[]) {
    const problems = validate(loaded.config, product);
    if (problems.length) {
      results.push(`${product}: not configured — ${problems.join("; ")}`);
      continue;
    }
    anyConfigured = true;
    const site = resolveProduct(loaded.config, product);
    try {
      const http = new HttpClient(site);
      if (product === "jira") {
        const me = await new JiraClient(http, site.deployment).myself();
        results.push(
          `jira: OK — ${site.baseUrl} (${site.deployment}) as ${me.displayName ?? me.name ?? "?"}` +
            `${me.emailAddress ? ` <${me.emailAddress}>` : ""}`,
        );
      } else {
        const me = await new ConfluenceClient(http, site.deployment).myself();
        results.push(
          `confluence: OK — ${site.baseUrl} (${site.deployment}) as ${me.displayName ?? me.username ?? me.publicName ?? "?"}`,
        );
      }
    } catch (e: any) {
      anyFailed = true;
      results.push(`${product}: FAILED — ${e.message}`);
    }
  }

  out(results.join("\n"));
  if (!anyConfigured) {
    process.stderr.write(
      "\nNothing is configured yet. Write a config layer (see config.example.json) and run this again.\n",
    );
    process.exit(3);
  }
  if (anyFailed) process.exit(1);
}

// ---------------------------------------------------------------- jira commands

function parseFieldFlags(args: Args, config: AtlassianConfig): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const raw of A.multi(args, "field")) {
    const eq = raw.indexOf("=");
    if (eq === -1) fail(`--field expects key=value, got "${raw}".`);
    // Aliases from config.fields let a team write `points` instead of customfield_10016.
    const key = resolveFieldId(config, raw.slice(0, eq).trim());
    const value = raw.slice(eq + 1);
    const looksJson = /^[[{"]/.test(value.trim()) || /^(true|false|null|-?\d+(\.\d+)?)$/.test(value.trim());
    fields[key] = looksJson ? JSON.parse(value) : value;
  }
  return fields;
}

async function cmdJira(args: Args) {
  const sub = args.positional[0];
  guardReadOnly("jira", sub);

  switch (sub) {
    case "whoami": {
      const { client, site } = jira();
      const me = await client.myself();
      if (A.bool(args, "json")) return json(me);
      return out(
        `${me.displayName ?? me.name} ${me.emailAddress ? `<${me.emailAddress}>` : ""}\n` +
          `${site.baseUrl} (${site.deployment})\n` +
          `${site.deployment === "cloud" ? `accountId: ${me.accountId}` : `username: ${me.name}`}`,
      );
    }

    case "search": {
      const { client, config, scope } = jira(args);
      let jql = args.positional[1] ?? "";
      // A bare project key is a common slip; make it work rather than erroring.
      if (/^[A-Z][A-Z0-9_]+$/.test(jql.trim())) jql = `project = ${jql.trim()} ORDER BY updated DESC`;
      const scoped = scopeJql(jql, scope?.scope ?? null);
      if (!scoped.query.trim()) {
        fail(`Usage: jira search "<jql>" [--scope name|--no-scope] [--limit N] [--all] [--count] [--json]`);
      }
      const note = scopeNote(scope, scoped.applied);

      if (A.bool(args, "count")) {
        const { count, approximate } = await client.count(scoped.query);
        if (A.bool(args, "json")) return json({ jql: scoped.query, count, approximate });
        return out(
          `${count} issue(s) match${approximate ? " (approximate — Cloud reports an index estimate)" : ""}.` +
            (note ? `\n${note}` : ""),
        );
      }

      const fields = A.list(args, "fields").map((f) => resolveFieldId(config, f));
      const res = await client.search(scoped.query, {
        fields: fields.length ? fields : undefined,
        limit: A.num(args, "limit"),
        all: A.bool(args, "all"),
      });
      if (A.bool(args, "json")) return json({ ...res, jql: scoped.query, scope: scope?.name ?? null });
      if (!res.issues.length) return out(["No issues match.", note].filter(Boolean).join("\n"));
      const lines = [issueRows(res.issues), "", `${res.issues.length} issue(s)${res.total !== null ? ` of ${res.total}` : ""}.`];
      if (res.more) {
        lines.push(`More match than were returned — pass --all (or raise --limit) for the complete set.`);
      }
      if (note) lines.push(note);
      const project = config.jira?.defaultProject;
      if (!scope && project && !/project\s*=/i.test(jql)) lines.push(`(searched all projects; default project is ${project})`);
      return out(lines.join("\n"));
    }

    case "get": {
      const { client } = jira();
      const key = args.positional[1];
      if (!key) fail("Usage: jira get <ISSUE-KEY> [--comments] [--json]");
      const wantComments = A.bool(args, "comments");
      const fields = A.list(args, "fields");
      const issue = await client.getIssue(key, {
        fields: fields.length ? fields : [...DEFAULT_FIELDS, "description", "subtasks", "issuelinks", "attachment"],
        expand: A.list(args, "expand"),
      });
      const comments = wantComments ? (await client.comments(key))?.comments ?? [] : undefined;
      if (A.bool(args, "json")) return json({ issue, comments });
      return out(formatIssue(issue, { comments, browseUrl: client.browseUrl(issue.key ?? key) }));
    }

    case "create": {
      const { client, config, site, scope } = jira(args);
      const js = scope?.scope.jira;
      // Precedence: explicit flag, then the scope, then the product-wide default.
      const project = A.str(args, "project") ?? js?.projects?.[0] ?? config.jira?.defaultProject;
      const type = A.str(args, "type") ?? js?.defaultIssueType ?? config.defaults?.issueType;
      const summary = A.str(args, "summary");
      if (!project) fail("Missing --project (no scope and no jira.defaultProject in config).");
      if (!type) fail(`Missing --type. Run 'jira meta ${project}' to list the issue types this project accepts.`);
      if (!summary) fail("Missing --summary.");

      const description = bodyText(args, "description", "description-file");
      const fields: Record<string, unknown> = {
        project: { key: project },
        issuetype: { name: type },
        summary,
        ...parseFieldFlags(args, config),
      };
      if (description) fields.description = renderBody(description, site.deployment);
      // Scope labels are additive: they mark the work stream, they don't replace
      // whatever the caller asked for.
      const labels = [...new Set([...A.list(args, "labels"), ...(js?.labels ?? [])])];
      if (labels.length) fields.labels = labels;
      const components = A.list(args, "components").length ? A.list(args, "components") : (js?.components ?? []);
      if (components.length) fields.components = components.map((name) => ({ name }));
      const priority = A.str(args, "priority");
      if (priority) fields.priority = { name: priority };
      const parent = A.str(args, "parent");
      if (parent) fields.parent = { key: parent };
      const due = A.str(args, "due");
      if (due) fields.duedate = due;
      const assignee = A.str(args, "assignee");
      if (assignee) {
        const aliased = resolvePerson(config, assignee);
        fields.assignee =
          aliased !== assignee ? (client.cloud ? { accountId: aliased } : { name: aliased }) : await resolveAssignee(client, assignee);
      }

      const created = await client.createIssue(fields);
      if (A.bool(args, "json")) return json(created);
      return out(
        `Created ${created.key} — ${client.browseUrl(created.key)}` +
          (scope ? `\n[scope "${scope.name}": project ${project}${labels.length ? `, labels ${labels.join(", ")}` : ""}]` : ""),
      );
    }

    case "update": {
      const { client, site, config } = jira();
      const key = args.positional[1];
      if (!key) fail("Usage: jira update <ISSUE-KEY> [--summary ...] [--description-file f] [--add-label x] ...");

      const fields: Record<string, unknown> = parseFieldFlags(args, config);
      const summary = A.str(args, "summary");
      if (summary) fields.summary = summary;
      const description = bodyText(args, "description", "description-file");
      if (description !== undefined) fields.description = renderBody(description, site.deployment);
      const priority = A.str(args, "priority");
      if (priority) fields.priority = { name: priority };
      const due = A.str(args, "due");
      if (due) fields.duedate = due;
      const labels = A.list(args, "labels");
      if (labels.length) fields.labels = labels;

      // add/remove go through `update` rather than `fields` so concurrent label
      // edits by other people survive; setting `fields.labels` replaces the lot.
      const update: Record<string, unknown> = {};
      const add = A.list(args, "add-label").map((l) => ({ add: l }));
      const remove = A.list(args, "remove-label").map((l) => ({ remove: l }));
      if (add.length || remove.length) update.labels = [...add, ...remove];

      if (!Object.keys(fields).length && !Object.keys(update).length) fail("Nothing to update — pass at least one field flag.");
      await client.updateIssue(key, fields, Object.keys(update).length ? update : undefined);
      return out(`Updated ${key} — ${client.browseUrl(key)}`);
    }

    case "comment": {
      const { client } = jira();
      const key = args.positional[1];
      const body = bodyText(args) ?? args.positional[2];
      if (!key || !body) fail("Usage: jira comment <ISSUE-KEY> --body '...'  (or --body-file f, '-' for stdin)");
      const res = await client.addComment(key, body);
      if (A.bool(args, "json")) return json(res);
      return out(`Commented on ${key} — ${client.browseUrl(key)}`);
    }

    case "comments": {
      const { client } = jira();
      const key = args.positional[1];
      if (!key) fail("Usage: jira comments <ISSUE-KEY>");
      const res = await client.comments(key);
      const comments = res?.comments ?? [];
      if (A.bool(args, "json")) return json(comments);
      if (!comments.length) return out(`No comments on ${key}.`);
      return out(
        comments
          .map((c: any) => {
            const who = c.author?.displayName ?? c.author?.name ?? "unknown";
            return `**${who}** — ${(c.created ?? "").slice(0, 16).replace("T", " ")}\n\n${adfToMarkdown(c.body)}`;
          })
          .join("\n\n---\n\n"),
      );
    }

    case "transition": {
      const { client } = jira();
      const key = args.positional[1];
      if (!key) fail("Usage: jira transition <ISSUE-KEY> [<status or transition name>] [--list]");
      const target = args.positional[2] ?? A.str(args, "to");

      if (!target || A.bool(args, "list")) {
        const available = await client.transitions(key);
        if (A.bool(args, "json")) return json(available);
        if (!available.length) return out(`No transitions available on ${key} for this account.`);
        return out(
          [`Transitions available from ${key}'s current status:`, "", table(available.map((t) => [t.name, `→ ${t.to?.name ?? "?"}`, `id ${t.id}`]))].join("\n"),
        );
      }

      const { id, label } = await client.transitionByName(key, target);
      const comment = A.str(args, "comment");
      // The comment rides along with the transition so it lands even when the
      // workflow forbids commenting on the resulting status.
      await client.doTransition(key, id, undefined, comment ? { comment: [{ add: { body: renderBody(comment, client.deployment) } }] } : undefined);
      return out(`${key}: ${label}`);
    }

    case "assign": {
      const { client, config } = jira();
      const key = args.positional[1];
      const rawWho = args.positional[2] ?? A.str(args, "to");
      if (!key || !rawWho) fail("Usage: jira assign <ISSUE-KEY> <me|none|alias|name-or-email>");
      if (rawWho === "none" || rawWho === "unassign") {
        await client.assign(key, null);
        return out(`${key} unassigned.`);
      }
      if (rawWho === "me") {
        const me = await client.myself();
        await client.assign(key, client.cloud ? me.accountId : me.name);
        return out(`${key} assigned to ${me.displayName ?? me.name}.`);
      }
      // A config alias resolves straight to an id, skipping the user search
      // entirely — which matters on Cloud, where GDPR settings can hide the
      // email that search would otherwise match on.
      const who = resolvePerson(config, rawWho);
      if (who !== rawWho) {
        await client.assign(key, who);
        return out(`${key} assigned to ${rawWho}.`);
      }
      const ref = await resolveAssignee(client, who);
      await client.assign(key, (ref.accountId ?? ref.name) as string);
      return out(`${key} assigned to ${rawWho}.`);
    }

    case "delete": {
      const { client, config } = jira();
      const key = args.positional[1];
      if (!key) fail("Usage: jira delete <ISSUE-KEY> --yes [--delete-subtasks]");
      const verdict = checkSafety(config, "delete");
      if (!verdict.allowed) fail(`${verdict.reason} Close the issue with a transition instead.`);
      if (!A.bool(args, "yes")) {
        fail(
          `Refusing to delete ${key} without --yes. Deleting a Jira issue is permanent — there is no trash and no undo, ` +
            `and any links, worklogs, and comments go with it. Consider transitioning it to a closed status instead.`,
        );
      }
      await client.deleteIssue(key, A.bool(args, "delete-subtasks"));
      return out(`Deleted ${key}.`);
    }

    case "projects": {
      const { client } = jira();
      const projects = await client.projects();
      if (A.bool(args, "json")) return json(projects);
      return out(table(projects.map((p: any) => [p.key, truncate(p.name ?? "", 50), p.projectTypeKey ?? ""])));
    }

    case "meta": {
      const { client, config } = jira();
      const project = args.positional[1] ?? config.jira?.defaultProject;
      if (!project) fail("Usage: jira meta <PROJECT-KEY> [--type 'Task']");
      const type = A.str(args, "type");
      const meta = await client.createMeta(project, type);
      if (A.bool(args, "json")) return json(meta);
      const lines = [`Issue types in ${project}:`, "", table(meta.issueTypes.map((t: any) => [t.name, t.subtask ? "(subtask)" : "", truncate(t.description ?? "", 60)]))];
      if (meta.fields) {
        const required = meta.fields.filter((f: any) => f.required);
        lines.push("", `Fields for "${type}" (required first):`, "");
        lines.push(
          table([
            ...required.map((f: any) => [f.fieldId ?? f.key, f.name, "REQUIRED", allowedSummary(f)]),
            ...meta.fields.filter((f: any) => !f.required).map((f: any) => [f.fieldId ?? f.key, f.name, "", allowedSummary(f)]),
          ], [26, 28, 10, 50]),
        );
      } else if (type) {
        lines.push("", `No issue type named "${type}" in ${project}.`);
      }
      return out(lines.join("\n"));
    }

    case "fields": {
      const { client } = jira();
      const all = await client.allFields();
      const q = (A.str(args, "search") ?? args.positional[1] ?? "").toLowerCase();
      const matched = q ? all.filter((f: any) => String(f.name).toLowerCase().includes(q) || String(f.id).includes(q)) : all;
      if (A.bool(args, "json")) return json(matched);
      if (!matched.length) return out(`No field matches "${q}".`);
      return out(table(matched.map((f: any) => [f.id, f.name, f.custom ? "custom" : "system", f.schema?.type ?? ""]), [26, 40, 8, 16]));
    }

    case "link": {
      const { client } = jira();
      const [, inward, type, outward] = args.positional;
      if (!inward || !type || !outward) {
        fail(`Usage: jira link <FROM-KEY> "<link type>" <TO-KEY>   (list types with 'jira link-types')`);
      }
      await client.linkIssues(inward, outward, type);
      return out(`Linked ${inward} → ${outward} as "${type}".`);
    }

    case "link-types": {
      const { client } = jira();
      const res = await client.linkTypes();
      if (A.bool(args, "json")) return json(res);
      return out(table((res?.issueLinkTypes ?? []).map((t: any) => [t.name, `inward: ${t.inward}`, `outward: ${t.outward}`])));
    }

    case "attach": {
      const { client } = jira();
      const key = args.positional[1];
      const file = args.positional[2];
      if (!key || !file) fail("Usage: jira attach <ISSUE-KEY> <file>");
      const path = expandPath(file);
      const res = await client.attach(key, basename(path), readFileSync(path));
      if (A.bool(args, "json")) return json(res);
      return out(`Attached ${basename(path)} to ${key}.`);
    }

    case "boards": {
      const { client, config, scope } = jira(args);
      const boards = await client.boards(
        A.str(args, "project") ?? scope?.scope.jira?.projects?.[0] ?? config.jira?.defaultProject,
      );
      if (A.bool(args, "json")) return json(boards);
      return out(table(boards.map((b: any) => [String(b.id), b.type ?? "", truncate(b.name ?? "", 50), b.location?.projectKey ?? ""])));
    }

    case "sprints": {
      const { client, scope } = jira(args);
      const board = args.positional[1] ?? A.str(args, "board") ?? scope?.scope.jira?.board;
      if (!board) fail("Usage: jira sprints <board-id> [--state active,future,closed]  (or set jira.board on a scope)");
      const sprints = await client.sprints(board, A.str(args, "state") ?? "active,future");
      if (A.bool(args, "json")) return json(sprints);
      return out(
        table(sprints.map((s: any) => [String(s.id), s.state ?? "", truncate(s.name ?? "", 40), (s.startDate ?? "").slice(0, 10), (s.endDate ?? "").slice(0, 10)])),
      );
    }

    default:
      fail(`Unknown jira command "${sub ?? ""}". Run 'help' for the list.`);
  }
}

function allowedSummary(field: any): string {
  const values = field.allowedValues ?? [];
  if (!values.length) return field.schema?.type ?? "";
  return truncate(values.map((v: any) => v.name ?? v.value ?? v.key ?? "").filter(Boolean).join(" | "), 50);
}

/** Turn a name/email into the assignee reference this deployment expects. */
async function resolveAssignee(client: JiraClient, query: string): Promise<Record<string, string>> {
  if (query === "me") {
    const me = await client.myself();
    return client.userRef(me);
  }
  const users = await client.findUser(query);
  if (!users.length) {
    throw new AtlassianError(
      `No user matches "${query}". ${client.cloud ? "Cloud user search only matches email or display name, and GDPR settings can hide emails entirely." : "Data Center matches username, name, or email."}`,
    );
  }
  const exact = users.find(
    (u: any) => u.emailAddress?.toLowerCase() === query.toLowerCase() || u.name?.toLowerCase() === query.toLowerCase(),
  );
  if (!exact && users.length > 1) {
    const list = users.slice(0, 8).map((u: any) => `  ${u.displayName}${u.emailAddress ? ` <${u.emailAddress}>` : ""} (${u.accountId ?? u.name})`).join("\n");
    throw new AtlassianError(`"${query}" matches ${users.length} users — be more specific:\n${list}`);
  }
  return client.userRef(exact ?? users[0]);
}

// ---------------------------------------------------------------- confluence commands

async function cmdConfluence(args: Args) {
  const sub = args.positional[0];
  guardReadOnly("confluence", sub);

  switch (sub) {
    case "whoami": {
      const { client, site } = confluence();
      const me = await client.myself();
      if (A.bool(args, "json")) return json(me);
      return out(`${me.displayName ?? me.username ?? me.publicName ?? "?"}\n${site.baseUrl} (${site.deployment})`);
    }

    case "spaces": {
      const { client } = confluence();
      const spaces = await client.spaces();
      if (A.bool(args, "json")) return json(spaces);
      return out(table(spaces.map((s) => [s.key, truncate(s.name, 50), `id ${s.id}`])));
    }

    case "search": {
      const { client, config, scope } = confluence(args);
      const query = args.positional[1];
      if (!query) fail(`Usage: confluence search "<text>" [--space KEY] [--scope name] [--limit N]   |   --cql '<cql>'`);
      const limit = A.num(args, "limit") ?? 25;

      // An explicit --space is a narrower statement than the scope, so it wins
      // and the scope's space clause is skipped rather than AND-ed on top.
      const explicitSpace = A.str(args, "space");
      const cql = A.bool(args, "cql") ? query : buildTextCql(query, explicitSpace ?? config.confluence?.defaultSpace, A.str(args, "type"));
      const scoped = explicitSpace && !A.bool(args, "cql") ? { query: cql, applied: [] } : scopeCql(cql, scope?.scope ?? null);
      const note = scopeNote(scope, scoped.applied);

      const hits = await client.search(scoped.query, limit);
      if (A.bool(args, "json")) return json({ hits, cql: scoped.query, scope: scope?.name ?? null });
      if (!hits.length) {
        return out(
          [
            `No results.${A.bool(args, "cql") ? "" : " Confluence text search is indexed, so a page created in the last few seconds may not appear yet."}`,
            note,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      return out([hitDetails(hits), "", `${hits.length} result(s).`, note].filter(Boolean).join("\n"));
    }

    case "get": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const page = await client.getPage(id);
      const comments = A.bool(args, "comments") ? await client.comments(id) : undefined;
      if (A.bool(args, "json")) return json({ ...page, markdown: storageToMarkdown(page.storage ?? ""), comments });
      if (A.bool(args, "storage")) return out(page.storage ?? "");
      return out(formatPage(page, { comments }));
    }

    case "children": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const kids = await client.childPages(id);
      if (A.bool(args, "json")) return json(kids);
      if (!kids.length) return out("No child pages.");
      return out(table(kids.map((k) => [k.id, k.title])));
    }

    case "pages": {
      const { client, config, scope } = confluence(args);
      const space =
        A.str(args, "space") ?? args.positional[1] ?? scope?.scope.confluence?.space ?? config.confluence?.defaultSpace;
      if (!space) fail("Usage: confluence pages --space KEY  (or set a scope, or confluence.defaultSpace)");
      const pages = await client.pagesInSpace(space, A.num(args, "limit") ?? 100);
      if (A.bool(args, "json")) return json(pages);
      return out(table(pages.map((p) => [p.id, p.title])));
    }

    case "create": {
      const { client, config, scope } = confluence(args);
      const cs = scope?.scope.confluence;
      const space = A.str(args, "space") ?? cs?.space ?? config.confluence?.defaultSpace;
      const title = A.str(args, "title");
      if (!space) fail("Missing --space (no scope and no confluence.defaultSpace in config).");
      if (!title) fail("Missing --title.");
      const body = bodyText(args) ?? "";
      const storage = A.bool(args, "storage") ? body : markdownToStorage(body);

      // A duplicate title in the same space is rejected with a bare 400; say why first.
      const existing = await client.findPage(space, title);
      if (existing && !A.bool(args, "allow-duplicate")) {
        fail(
          `A page titled "${title}" already exists in ${space} (id ${existing.id}, ${existing.url}). ` +
            `Confluence requires unique titles per space — update that page instead, or pass --allow-duplicate ` +
            `to attempt creation anyway.`,
        );
      }

      const parentRaw = A.str(args, "parent") ?? cs?.parentPage;
      const page = await client.createPage({
        spaceKey: space,
        title,
        storage,
        parentId: parentRaw ? ConfluenceClient.parsePageId(parentRaw) : undefined,
      });
      if (A.bool(args, "json")) return json(page);
      return out(
        `Created page ${page.id} — ${page.url}` +
          (scope ? `\n[scope "${scope.name}": space ${space}${parentRaw ? `, under page ${parentRaw}` : ""}]` : ""),
      );
    }

    case "update": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const body = bodyText(args);
      if (body === undefined) fail("Usage: confluence update <id|url> --body-file f [--title T] [--message 'why']");
      const storage = A.bool(args, "storage") ? body : markdownToStorage(body);
      const page = await client.updatePage(id, {
        title: A.str(args, "title"),
        storage,
        expectVersion: A.num(args, "expect-version"),
        message: A.str(args, "message"),
      });
      if (A.bool(args, "json")) return json(page);
      return out(`Updated page ${page.id} to version ${page.version} — ${page.url}`);
    }

    case "append": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const body = bodyText(args);
      if (body === undefined) fail("Usage: confluence append <id|url> --body-file f");
      const current = await client.getPage(id);
      const addition = A.bool(args, "storage") ? body : markdownToStorage(body);
      const page = await client.updatePage(id, {
        storage: `${current.storage ?? ""}\n${addition}`,
        expectVersion: current.version,
        message: A.str(args, "message") ?? "Appended content",
      });
      if (A.bool(args, "json")) return json(page);
      return out(`Appended to page ${page.id} (now version ${page.version}) — ${page.url}`);
    }

    case "delete": {
      const { client, config } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const purge = A.bool(args, "purge");
      const verdict = checkSafety(config, purge ? "purge" : "delete");
      if (!verdict.allowed) fail(verdict.reason!);
      if (!A.bool(args, "yes")) {
        const page = await client.getPage(id, false);
        fail(
          `Refusing to delete "${page.title}" (id ${id}) without --yes.` +
            (purge
              ? ` --purge deletes permanently, skipping the trash: there is no undo.`
              : ` It would go to the space trash, where a space admin can restore it.`),
        );
      }
      await client.deletePage(id, purge);
      return out(purge ? `Purged page ${id}.` : `Moved page ${id} to the trash.`);
    }

    case "comments": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const comments = await client.comments(id);
      if (A.bool(args, "json")) return json(comments);
      if (!comments.length) return out("No comments.");
      return out(
        comments
          .map((c) => `**${c.author ?? "unknown"}** — ${(c.when ?? "").slice(0, 16).replace("T", " ")}\n\n${storageToMarkdown(c.storage)}`)
          .join("\n\n---\n\n"),
      );
    }

    case "comment": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const body = bodyText(args) ?? args.positional[2];
      if (!body) fail("Usage: confluence comment <id|url> --body '...'");
      await client.addComment(id, A.bool(args, "storage") ? body : markdownToStorage(body));
      return out(`Commented on page ${id}.`);
    }

    case "attach": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const file = args.positional[2];
      if (!file) fail("Usage: confluence attach <id|url> <file>");
      const path = expandPath(file);
      const res = await client.attach(id, basename(path), readFileSync(path), A.str(args, "comment"));
      if (A.bool(args, "json")) return json(res);
      return out(`Attached ${basename(path)} to page ${id}.`);
    }

    case "attachments": {
      const { client } = confluence();
      const id = ConfluenceClient.parsePageId(args.positional[1] ?? "");
      const list = await client.attachments(id);
      if (A.bool(args, "json")) return json(list);
      if (!list.length) return out("No attachments.");
      return out(table(list.map((a) => [a.id, a.title, a.size ? `${Math.round(a.size / 1024)} KB` : ""])));
    }

    case "to-storage": {
      // Exposed for previewing a conversion before writing it to a live page.
      const body = bodyText(args) ?? readText(args.positional[1] ?? "-");
      return out(markdownToStorage(body));
    }

    default:
      fail(`Unknown confluence command "${sub ?? ""}". Run 'help' for the list.`);
  }
}

// ---------------------------------------------------------------- help

const HELP = `atlassian — Jira + Confluence over REST, for Cloud and Data Center.

  config check                       verify credentials with a real API call
  config show [--json]               resolved settings and where they came from
  config scopes                      configured work streams (jira projects + space)
  config scope <ISSUE-KEY>           which scope owns a ticket prefix
  config path [--layer global|repo|local]
  config gitignore                   ignore the local config layer

Scopes: commands that search or create accept --scope <name> to pick a work
stream, or --no-scope to ignore the configured default. The scope supplies the
Jira project, issue type, labels, Confluence space, and parent page, and every
command prints what it narrowed.

  jira whoami
  jira search "<jql>" [--limit N] [--all] [--count] [--fields a,b] [--json]
  jira get <KEY> [--comments] [--fields a,b] [--json]
  jira create --project P --type T --summary S [--description-file f] [--parent K]
              [--labels a,b] [--assignee me|email] [--priority P] [--due YYYY-MM-DD]
              [--field customfield_10001=value]...
  jira update <KEY> [--summary S] [--description-file f] [--labels a,b]
              [--add-label x] [--remove-label y] [--field k=v]...
  jira comment <KEY> --body '...' | --body-file f
  jira comments <KEY>
  jira transition <KEY> [<status>] [--list] [--comment '...']
  jira assign <KEY> <me|none|email>
  jira delete <KEY> --yes [--delete-subtasks]
  jira projects | link-types | fields [--search text]
  jira meta <PROJECT> [--type 'Task']    issue types and their required fields
  jira link <FROM> "<type>" <TO>
  jira attach <KEY> <file>
  jira boards [--project P] | jira sprints <board-id> [--state active,future]

  confluence whoami | spaces
  confluence search "<text>" [--space KEY] [--limit N] [--type page]
  confluence search --cql 'type = page AND label = "x"'
  confluence get <id|url> [--comments] [--storage] [--json]
  confluence children <id|url> | confluence pages --space KEY
  confluence create --space KEY --title T --body-file f [--parent id] [--storage]
  confluence update <id|url> --body-file f [--title T] [--expect-version N] [--message m]
  confluence append <id|url> --body-file f
  confluence delete <id|url> --yes [--purge]
  confluence comment <id|url> --body '...' | confluence comments <id|url>
  confluence attach <id|url> <file> | confluence attachments <id|url>
  confluence to-storage --body-file f    preview the markdown → storage conversion

Bodies: --body-file accepts "-" to read stdin. Markdown in, native format out
(ADF on Jira Cloud, wiki markup on Data Center, storage XHTML on Confluence).
Every command takes --json for structured output.`;

// ---------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const group = argv[0];
  const args = parseArgs(argv.slice(1));

  if (!group || group === "help" || group === "--help" || group === "-h") {
    out(HELP);
    return;
  }

  switch (group) {
    case "config":
      return cmdConfig(args);
    case "jira":
      return cmdJira(args);
    case "confluence":
    case "wiki":
      return cmdConfluence(args);
    default:
      fail(`Unknown command group "${group}". Expected: config, jira, confluence. Run 'help' for details.`);
  }
}

main().catch((e: any) => {
  // Stack traces are noise here: every error this CLI raises is either a config
  // problem or an API response, both of which are explained in the message.
  if (e instanceof AtlassianError || e instanceof Error) fail(e.message);
  fail(String(e));
});
