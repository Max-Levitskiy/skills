// The command surface. JSON on stdout, diagnostics on stderr, secrets on fd 3 (D4).
//
// The exit code is read by scripts; the JSON is read by agents. They are different audiences, and
// conflating them is what makes "not configured" look like a failure — so needing onboarding is
// exit 0, and a caller that genuinely wants it fatal passes --require-ready.

import { existsSync, readFileSync, statSync, writeSync } from "fs";
import { join, resolve as absolute } from "path";
import { detectHarness } from "./harness";
import { repoContext, registerRepo, type RepoContext } from "./repo";
import { placeOf, type Place } from "./place";
import { addContext, isAncestor, readContexts, resolveChain, type ContextStore, type MatchedContext } from "./contexts";
import {
  ConfigError,
  LAYERS,
  layerFiles,
  layerOrder,
  legacyFiles,
  adoptLegacy,
  contextOf,
  credentialLeaves,
  honoured,
  layerPath,
  loadLayers,
  parseLayer,
  readJournal,
  readLayer,
  writeLayer,
  ownValueAt,
  untrackedIn,
  type ConfigObject,
  type ConfigValue,
  type Layer,
  type LoadedLayers,
} from "./layers";
import { declaredKeys, findDeclaration, isPersonalKey, listDeclarations, valueProblems, type FoundDeclaration } from "./declaration";
import { effectiveConfig, unmetKeys, type Effective } from "./effective";
import { buildPlan, guidePath } from "./actions";
import { CredentialError, cacheVarValue, resolveCredential, type CredentialRef } from "./credentials";
import { cacheKey } from "./secret-cache";
import * as onePassword from "./onepassword";
import {
  ACS_VERSION,
  type ContextListOutput,
  type ContextExplainOutput,
  type DescribedKey,
  type DescribeOutput,
  type ListOutput,
  type LoadOutput,
  type PathOutput,
  type Problem,
  type RepoReport,
  type StartOutput,
} from "./types";

export const EXIT = {
  /** A plan was produced — ready or not. */
  ok: 0,
  /** Unexpected or internal. */
  internal: 1,
  /** The declaration is missing or invalid, the name is ambiguous, or config is incomplete. */
  config: 2,
  /** A credential reference is present but unresolvable (`load` only). */
  credential: 3,
  /** A config file's schema version is behind the declaration's (`load` only). */
  staleSchema: 4,
} as const;

// Every command ends in an explicit exit code, and an async stdout write can still be in flight
// when the process leaves. Both streams are written synchronously so the caller always sees them.
function out(text: string): void {
  writeSync(1, text);
}

function report(text: string): void {
  writeSync(2, text);
}

const USAGE = `agent-config <command>

  start <name> [--from <dir>] [--require-ready]   what this component still needs, as JSON
  adopt <name> [--from <dir>]                     copy v1 .agents/skill-config/ files into the
                                                  v2 layers that have no file yet
  load <name> [--secrets <key>...] [--with-references] [--from <dir>]
                                                  config on stdout, secrets on fd 3; with
                                                  --with-references, each secret beside the
                                                  reference it was resolved from
  write <name> --layer <layer> [--from <dir>]     replace one layer from JSON on stdin
  describe <name> [--from <dir>]                  the full questionnaire, with current answers
  path <name> [--layer <layer>] [--from <dir>]    where the layers live
  list                                            every installed component that declares a name
  1password accounts | vaults | items | fields    browse for a reference: --account, --vault, --item;
                                                  names and op:// addresses only, never a value;
                                                  items with no --vault lists every vault, and with
                                                  no --account every account
  repos register [--alias <alias>]                add this repository to the repo registry
  context list                                    every context, and whether it applies here
  context explain                                 the place, the contexts that apply and why,
                                                  and the layers they make
  context add <name> [--parent <p>] [--remote <glob>]... [--path <glob>]...
                                                  create a context: remotes in its team file,
                                                  paths in your own

Where:  --cwd <dir>        the place to resolve for, instead of the current directory
        --context <name>   apply this context too (and its parents), matched or not
        --no-context       apply no matched context
Every command that reads config takes them.

Layers: global, context:<name>, context:<name>:me, repo, user-repo, local — one context:<name>
pair per context that applies, outermost first. Output is JSON only — rendering for a human is the
agent's job.`;

interface ParsedArgs {
  command: string;
  positionals: string[];
  from?: string;
  layer?: string;
  alias?: string;
  account?: string;
  vault?: string;
  item?: string;
  cwd?: string;
  context?: string;
  noContext: boolean;
  parent?: string;
  remotes: string[];
  paths: string[];
  secrets: string[];
  requireReady: boolean;
  withReferences: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: argv[0] ?? "",
    positionals: [],
    secrets: [],
    remotes: [],
    paths: [],
    requireReady: false,
    withReferences: false,
    noContext: false,
  };
  let collecting: "secrets" | null = null;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-ready") {
      collecting = null;
      parsed.requireReady = true;
    } else if (argument === "--with-references") {
      collecting = null;
      parsed.withReferences = true;
    } else if (argument === "--no-context") {
      collecting = null;
      parsed.noContext = true;
    } else if (["--from", "--layer", "--alias", "--account", "--vault", "--item", "--cwd", "--context", "--parent", "--remote", "--path"].includes(argument)) {
      collecting = null;
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ConfigError(`${argument} needs a value`);
      index += 1;
      if (argument === "--from") parsed.from = value;
      if (argument === "--layer") parsed.layer = value;
      if (argument === "--alias") parsed.alias = value;
      if (argument === "--account") parsed.account = value;
      if (argument === "--vault") parsed.vault = value;
      if (argument === "--item") parsed.item = value;
      if (argument === "--cwd") parsed.cwd = value;
      if (argument === "--context") parsed.context = value;
      if (argument === "--parent") parsed.parent = value;
      if (argument === "--remote") parsed.remotes.push(value);
      if (argument === "--path") parsed.paths.push(value);
    } else if (argument === "--secrets") {
      // Several keys in one call, so a script needing two secrets does not trigger two prompts.
      collecting = "secrets";
    } else if (argument.startsWith("--")) {
      throw new ConfigError(`Unknown flag ${argument}\n\n${USAGE}`);
    } else if (collecting === "secrets") {
      parsed.secrets.push(argument);
    } else {
      parsed.positionals.push(argument);
    }
  }
  if (parsed.context !== undefined && parsed.noContext) {
    throw new ConfigError("--context and --no-context cannot be combined: one adds a context, the other drops them all");
  }
  return parsed;
}

function requireName(parsed: ParsedArgs): string {
  const name = parsed.positionals[0];
  if (!name) throw new ConfigError(`${parsed.command} needs a component name\n\n${USAGE}`);
  return name;
}

function requireLayer(value: string | undefined): Layer {
  if (!value) throw new ConfigError(`--layer is required (${LAYERS.join(", ")}, context:<name>, context:<name>:me)`);
  return parseLayer(value);
}

function repoReport(repo: RepoContext): RepoReport {
  return {
    checkout: repo.checkout,
    root: repo.root,
    identity: repo.identity,
    registered: repo.registered,
    alias: repo.alias,
  };
}

/**
 * v2 reads only `.agents/config/`. A v1 file whose layer has no v2 file yet is adopted by the
 * `agent-config:adopt` action; one whose layer already has a v2 file is reported here, because the
 * two are never merged and which answers the person meant is theirs to say.
 */
function legacyProblems(name: string, repo: RepoContext): Problem[] {
  return legacyFiles(name, repo)
    .filter((file) => !file.adoptable)
    .map((file) => ({
      code: "legacy-config-path" as const,
      layer: file.layer,
      message:
        `${file.path} is a v1 config at the pre-rename path, and ${file.current} already holds this layer. ` +
        `Only the second is read. Compare them, keep what you meant in ${file.current}, and delete the first.`,
      path: file.path,
    }));
}

/** Where the command runs, and the contexts that apply there: the one place the chain is resolved. */
interface Located {
  repo: RepoContext;
  place: Place;
  store: ContextStore;
  chain: MatchedContext[];
}

/**
 * The directory the command runs for: `--cwd`, made absolute so path filters can match it, else the
 * current one. A `--cwd` that is not a directory is refused: git would resolve it as no repo and no
 * remotes, and `load` would answer confidently with neither repo nor context layers.
 */
function cwdOf(parsed: ParsedArgs): string {
  if (!parsed.cwd) return process.cwd();
  const dir = absolute(parsed.cwd);
  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    /* missing or unreadable: not a directory we can resolve */
  }
  if (!isDirectory) throw new ConfigError(`--cwd ${dir} is not a directory`);
  return dir;
}

function locate(parsed: ParsedArgs): Located {
  const cwd = cwdOf(parsed);
  const place = placeOf(cwd);
  const store = readContexts();
  const chain = resolveChain(store, place, { explicit: parsed.context, none: parsed.noContext });
  return { repo: repoContext(cwd), place, store, chain };
}

interface Resolved extends Located {
  found: FoundDeclaration;
  loaded: LoadedLayers;
  effective: Effective;
  /**
   * The store's problems, every declared key two unrelated matched contexts both set, and every
   * untrusted file whose credential references were ignored.
   */
  layerProblems: Problem[];
}

function resolve(name: string, parsed: ParsedArgs): Resolved {
  const located = locate(parsed);
  const found = findDeclaration(name, detectHarness(), parsed.from);
  const loaded = loadLayers(name, located.repo, located.chain);
  const layerProblems = [
    ...located.store.problems,
    ...siblingProblems(name, found, loaded, located),
    ...untrustedProblems(loaded),
  ];
  return { ...located, found, loaded, effective: effectiveConfig(found.declaration, loaded), layerProblems };
}

/** One problem per untrusted file whose credential references the merge dropped. */
function untrustedProblems(loaded: LoadedLayers): Problem[] {
  return loaded.untrusted.map(({ layer, path, keys }) => ({
    code: "untrusted-layer-key" as const,
    layer,
    path,
    keys,
    message:
      `${path} sets ${keys.join(", ")}, and these credential references were ignored: the ${layer} layer is ` +
      `not a file you wrote here, and a reference in it could run someone else's command. Set the credential ` +
      `in your global, user-repo, context me or untracked local layer instead.`,
  }));
}

/**
 * A declared key set by two matched contexts where neither is nested in the other: the chain puts
 * one after the other by `order.json` and name, so the winner is an accident of ordering, not of
 * nesting. Reported once per pair and key; a context's team and me files count as its own.
 */
function siblingProblems(name: string, found: FoundDeclaration, loaded: LoadedLayers, located: Located): Problem[] {
  const keys = declaredKeys(found.declaration).map((key) => key.path);
  const setBy = located.chain.map((context) => {
    const own = loaded.files
      .filter((file) => file.exists && contextOf(file.layer)?.context === context.name)
      .map((file) => readLayer(name, file.layer, located.repo) ?? {});
    return { name: context.name, keys: new Set(keys.filter((key) => own.some((config) => ownValueAt(config, key) !== undefined))) };
  });

  const problems: Problem[] = [];
  for (const [at, a] of setBy.entries()) {
    for (const b of setBy.slice(at + 1)) {
      if (isAncestor(located.store, a.name, b.name) || isAncestor(located.store, b.name, a.name)) continue;
      for (const key of keys.filter((one) => a.keys.has(one) && b.keys.has(one))) {
        problems.push({
          code: "sibling-contexts",
          keys: [key],
          message: `contexts "${a.name}" and "${b.name}" both set ${key}; neither is nested in the other, so the one later in the order wins`,
        });
      }
    }
  }
  return problems;
}

function start(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const harness = detectHarness();
  const { found, repo, loaded, effective, layerProblems, chain, place } = resolve(name, parsed);
  const plan = buildPlan({
    found,
    harness,
    repo: repoReport(repo),
    effective,
    layers: loaded.files,
    userRepoLayer: readLayer(name, "user-repo", repo),
    legacy: legacyFiles(name, repo),
    from: parsed.from,
    chain,
    place,
    noContext: parsed.noContext,
  });

  const output: StartOutput = {
    acs: ACS_VERSION,
    name,
    harness,
    repo: repoReport(repo),
    ready: plan.actions.length === 0,
    guide: guidePath(),
    config: effective.config,
    provenance: effective.provenance,
    actions: plan.actions,
    contexts: chain,
    problems: [...effective.problems, ...plan.problems, ...legacyProblems(name, repo), ...layerProblems],
  };
  out(`${JSON.stringify(output, null, 2)}\n`);

  if (parsed.requireReady && !output.ready) {
    report(`${name} is not ready: ${output.actions.length} action(s) outstanding. ` +
      `Drop --require-ready to get the plan as a normal result.\n`);
    return EXIT.config;
  }
  return EXIT.ok;
}

/**
 * Every `cacheVar` two different references claim among the trusted layers' own files. Whichever
 * reference wins the merge, the variable may have been seeded from the other one, so a value in it
 * cannot be taken as this reference's. One problem per variable, naming the first two claimants.
 */
function sharedCacheVars(name: string, loaded: LoadedLayers, repo: RepoContext): { vars: Set<string>; problems: Problem[] } {
  const claims = new Map<string, { layer: Layer; key: string; reference: string }[]>();
  for (const file of loaded.files.filter((one) => one.exists && one.trusted)) {
    const credentials = readLayer(name, file.layer, repo)?.credentials;
    if (typeof credentials !== "object" || credentials === null || Array.isArray(credentials)) continue;
    for (const [key, value] of Object.entries(credentials)) {
      const reference = value as unknown as CredentialRef | null;
      if (typeof reference?.cacheVar !== "string" || !reference.cacheVar) continue;
      const claim = { layer: file.layer, key: `credentials.${key}`, reference: cacheKey(reference) };
      claims.set(reference.cacheVar, [...(claims.get(reference.cacheVar) ?? []), claim]);
    }
  }

  const vars = new Set<string>();
  const problems: Problem[] = [];
  for (const [variable, [first, ...rest]] of claims) {
    const other = rest.find((claim) => claim.reference !== first.reference);
    if (!other) continue;
    vars.add(variable);
    problems.push({
      code: "cachevar-shared",
      keys: [...new Set([first.key, other.key])],
      message:
        `${first.key} in the ${first.layer} layer and ${other.key} in the ${other.layer} layer are different ` +
        `references that both name cacheVar ${variable}, so its value could belong to either. It is skipped, and ` +
        `the reference's source answers; give each reference a cacheVar of its own.`,
    });
  }
  return { vars, problems };
}

/**
 * `load` is the consumer script's surface, and the mirror image of `start`: not-ready is a normal
 * answer there and a refusal here, because a script must not run on half-configured settings.
 * It never returns an action list, which is what makes "a subagent cannot onboard" structural
 * rather than prose (D6).
 */
function load(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const { found, repo, loaded, effective, layerProblems, chain } = resolve(name, parsed);
  const sharedVars = sharedCacheVars(name, loaded, repo);
  const problems: Problem[] = [
    ...effective.problems,
    ...legacyProblems(name, repo),
    ...layerProblems,
    ...sharedVars.problems,
  ];

  for (const file of loaded.files) {
    if (!file.exists || file.schemaVersion === null) continue;
    if (file.schemaVersion < found.schemaVersion) {
      report(`${file.path} was written against ${name} schema version ${file.schemaVersion}, but the installed ` +
        `component declares ${found.schemaVersion}. Its answers may mean something else now, and handing ` +
        `them over unchanged is silent corruption. Run: agent-config start ${name}\n`);
      return EXIT.staleSchema;
    }
    if (file.schemaVersion > found.schemaVersion) {
      problems.push({
        code: "schema-rolled-back",
        layer: file.layer,
        path: file.path ?? undefined,
        message:
          `${file.path} is stamped schema version ${file.schemaVersion}, ahead of the declared ` +
          `${found.schemaVersion}. Proceeding: a rollback has no repair path.`,
      });
    }
  }

  const unmet = unmetKeys(effective);
  if (unmet.length > 0) {
    const adoptable = legacyFiles(name, repo).some((file) => file.adoptable);
    report(
      `${name} is not configured. Missing or malformed: ${unmet.join(", ")}. Run: agent-config start ${name}\n` +
        (adoptable ? `A v1 config at .agents/skill-config/${name}/ may hold them: agent-config adopt ${name}\n` : ""),
    );
    return EXIT.config;
  }

  const output: LoadOutput = {
    acs: ACS_VERSION,
    name,
    config: effective.config,
    provenance: effective.provenance,
    contexts: chain,
    problems,
  };
  out(`${JSON.stringify(output, null, 2)}\n`);

  if (parsed.secrets.length === 0) return EXIT.ok;

  const secrets: Record<string, string> = {};
  // Which reference each secret came from, as the session cache keys it; null when its cacheVar
  // answered instead, so the caller does not keep that value as the reference's own. An unseeded
  // cacheVar, as in a fresh terminal pane, leaves the answer to the source, which may be cached.
  const references: Record<string, string | null> = {};
  for (const key of parsed.secrets) {
    const logical = key.startsWith("credentials.") ? key.slice("credentials.".length) : key;
    const reference = effective.config.credentials;
    const entry =
      typeof reference === "object" && reference !== null && !Array.isArray(reference)
        ? reference[logical]
        : undefined;
    if (entry === undefined) {
      report(`credentials.${logical} is not configured, so it cannot be resolved.\n`);
      return EXIT.config;
    }
    let credential = entry as unknown as CredentialRef;
    if (credential.cacheVar && sharedVars.vars.has(credential.cacheVar)) {
      const { cacheVar, ...rest } = credential;
      void cacheVar;
      credential = rest;
    }
    references[key] = cacheVarValue(credential) ? null : cacheKey(credential);
    secrets[key] = resolveCredential(credential, logical, repo.checkout);
  }

  // fd 3, never stdout: a script opens the third descriptor deliberately, while a naive
  // `bash -c "agent-config load … --secrets …"` run by an agent gets nothing on it.
  try {
    writeSync(3, `${JSON.stringify(parsed.withReferences ? { secrets, references } : secrets)}\n`);
  } catch {
    report(`--secrets writes to file descriptor 3, which is not open. Open it in the caller, e.g.\n` +
      `  secrets=$(agent-config load ${name} --secrets ${parsed.secrets.join(" ")} 3>&1 1>/dev/null)\n`);
    return EXIT.internal;
  }
  return EXIT.ok;
}

/**
 * Copy every adoptable v1 file into its v2 layer. A layer that already has a v2 file is left alone
 * and listed, so running it twice does nothing the second time. One failing file (an inline secret,
 * a file that is not an object) does not stop the others; the exit code says one failed.
 */
function adopt(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const repo = repoContext(cwdOf(parsed));
  const found = findDeclaration(name, detectHarness(), parsed.from);
  const schema = { version: found.schemaVersion, declared: found.declaration.schema ?? {} };

  const adopted: Record<string, ConfigValue>[] = [];
  const kept: Record<string, ConfigValue>[] = [];
  const failed: Record<string, ConfigValue>[] = [];
  const problems: Problem[] = [];
  for (const file of legacyFiles(name, repo)) {
    if (!file.adoptable) {
      kept.push({ layer: file.layer, from: file.path, current: file.current });
      continue;
    }
    try {
      const result = adoptLegacy(name, file, schema, repo);
      adopted.push({ layer: file.layer, from: file.path, path: result.path, schemaVersion: result.schemaVersion });
      if (result.stripped.length > 0) {
        problems.push({
          code: "untrusted-layer-key",
          layer: file.layer,
          path: file.path,
          keys: result.stripped,
          message:
            `${file.path} sets ${result.stripped.join(", ")}, and these credential references were not adopted: git ` +
            `tracks the file, so it is not one you wrote here. Set the credential in your own layer instead.`,
        });
      }
    } catch (error) {
      failed.push({ layer: file.layer, from: file.path, error: (error as Error).message });
    }
  }
  out(`${JSON.stringify({ acs: ACS_VERSION, name, adopted, kept, failed, problems }, null, 2)}\n`);
  for (const one of failed) report(`${one.from}: ${one.error}\n`);
  for (const one of problems) report(`${one.message}\n`);
  return failed.length > 0 ? EXIT.config : EXIT.ok;
}

function write(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const layer = requireLayer(parsed.layer);
  const repo = repoContext(cwdOf(parsed));
  const found = findDeclaration(name, detectHarness(), parsed.from);
  // A context layer is written only for a context that exists, so a typo cannot start a stray one.
  const target = contextOf(layer);
  const named = target?.context;
  if (named !== undefined && !readContexts().defs.has(named)) {
    throw new ConfigError(`--layer ${layer} names context "${named}", which does not exist; create it with: agent-config context add ${named}`);
  }

  const raw = readFileSync(0, "utf8").trim();
  if (!raw) throw new ConfigError("write expects the whole layer as JSON on stdin");
  let config: ConfigObject;
  try {
    config = JSON.parse(raw) as ConfigObject;
  } catch (error) {
    throw new ConfigError(`stdin is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new ConfigError("write expects a JSON object — one layer, whole, not a fragment");
  }

  // A context's team file is shared with everyone the context matches, so the person's own answers
  // and their credential references belong in its me file.
  if (target && !target.me) {
    const own =
      declaredKeys(found.declaration).find(
        ({ path, entry }) => isPersonalKey(path, entry) && ownValueAt(config, path) !== undefined,
      )?.path ?? ("credentials" in config ? credentialLeaves(config)[0] : undefined);
    if (own) {
      throw new ConfigError(
        `not written: ${own} is ${own.split(".")[0] === "credentials" ? "a credential" : "declared personal"}, and ${layer} is ` +
          `the team file every place in context "${named}" shares; write it with --layer context:${named}:me`,
      );
    }
  }

  // A credential reference is honoured only from a layer the user wrote here, so one written to the
  // repo layer or to a config.local.json git tracks would be stored and then ignored by `load`.
  const credential = "credentials" in config ? credentialLeaves(config)[0] : undefined;
  if (credential !== undefined && (layer === "repo" || layer === "local")) {
    const path = layerPath(name, layer, repo);
    const tracked = layer === "local" && path !== null && existsSync(path) && !untrackedIn(path, repo.checkout!);
    if (layer === "repo" || tracked) {
      throw new ConfigError(
        `not written: ${credential} is a credential, and ${layer === "repo" ? "the repo layer is committed for the team" : `git tracks ${path}`}, ` +
          `so load would not honour it; write it to a trusted layer: global, user-repo, context:<name>:me, or an untracked local`,
      );
    }
  }

  // Checked against the schemas the keys declare, so a value no consumer could read is never written.
  const wrong = valueProblems(found.declaration, config, true);
  if (wrong.length > 0) {
    throw new ConfigError(`not written: ${wrong.flatMap((one) => one.problems).join("; ")}`);
  }

  const result = writeLayer(
    name,
    layer,
    config,
    { version: found.schemaVersion, declared: found.declaration.schema ?? {} },
    repo,
  );
  out(`${JSON.stringify({ acs: ACS_VERSION, name, ...result }, null, 2)}\n`);
  return EXIT.ok;
}

/**
 * `describe` is what makes onboarding stop being a special case: every declared key with its
 * description, recommended layer, default and condition, plus the current answers and the layer
 * each came from. Onboarding is the case where the answers are empty; editing is the same
 * questionnaire, filled in (D6).
 */
function describe(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const harness = detectHarness();
  const { found, repo, loaded, effective, layerProblems, chain, place } = resolve(name, parsed);
  // An untrusted file's credentials are left out here too, so no level or source names a reference
  // the merge ignored.
  const own = loaded.files
    .filter((file) => file.exists)
    .map((file) => ({ layer: file.layer, config: honoured(readLayer(name, file.layer, repo) ?? {}, file) }));

  const output: DescribeOutput = {
    acs: ACS_VERSION,
    name,
    harness,
    schemaVersion: found.schemaVersion,
    repo: repoReport(repo),
    keys: effective.keys.map((key) => withLevels(key, own)),
    defs: found.declaration.schema?.$defs ?? {},
    layers: loaded.files.map((file) => ({ ...file, journal: readJournal(name, file.layer, repo) })),
    contexts: chain,
    place,
    problems: [...effective.problems, ...legacyProblems(name, repo), ...layerProblems],
  };
  out(`${JSON.stringify(output, null, 2)}\n`);
  return EXIT.ok;
}

/**
 * Each layer's own value for one key, so an editor can show what every level sets and which one
 * wins. The source is the top layer that sets it: provenance is kept per leaf, so for a key whose
 * value is an object it can be missing, or stale, a lower layer's scalar that a higher object
 * replaced. A top layer that blocks it leaves the default, if any, in effect.
 */
export function withLevels(key: DescribedKey, own: { layer: Layer; config: ConfigObject }[]): DescribedKey {
  const levels: DescribedKey["levels"] = {};
  for (const { layer, config } of own) {
    const value = ownValueAt(config, key.path);
    if (value !== undefined) levels[layer] = value;
  }
  // `own` is in merge order, so the last layer that sets the key is the one that wins.
  const top = own.map(({ layer }) => layer).reverse().find((layer) => layer in levels);
  const source = top === undefined ? (key.source ?? null) : levels[top] !== null ? top : key.source === "default" ? "default" : null;
  return { ...key, levels, source };
}

function path(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const { repo, chain } = locate(parsed);
  const found = findDeclaration(name, detectHarness(), parsed.from);
  const files = layerFiles(name, repo, chain);
  const wanted = parsed.layer ? requireLayer(parsed.layer) : null;

  const output: PathOutput = {
    acs: ACS_VERSION,
    name,
    declaration: found.path,
    agentConfig: { root: join(import.meta.dir, ".."), bin: join(import.meta.dir, "..", "bin", "agent-config") },
    layers: wanted ? files.filter((file) => file.layer === wanted) : files,
    contexts: chain,
  };
  out(`${JSON.stringify(output, null, 2)}\n`);
  return EXIT.ok;
}

const CONTEXT_USAGE =
  `context list | explain [--cwd <dir>] [--context <name>] [--no-context] | add <name> [--parent <p>] [--remote <glob>]... [--path <glob>]...`;

/**
 * `list`: every context and whether it applies here. `explain`: the place, the chain and its layers.
 * `add`: create a context.
 */
function context(parsed: ParsedArgs): number {
  const subcommand = parsed.positionals[0];
  if (subcommand === "add") {
    const name = parsed.positionals[1];
    if (!name) throw new ConfigError(`context add needs a context name: ${CONTEXT_USAGE}`);
    const { id, dir, team, me } = addContext({ name, parent: parsed.parent, remote: parsed.remotes, path: parsed.paths });
    out(`${JSON.stringify({ acs: ACS_VERSION, name, id, dir, team, me }, null, 2)}\n`);
    return EXIT.ok;
  }
  if (subcommand !== "list" && subcommand !== "explain") {
    throw new ConfigError(`Unknown context subcommand ${JSON.stringify(subcommand ?? "")}: ${CONTEXT_USAGE}\n\n${USAGE}`);
  }
  const { place, store, chain } = locate(parsed);
  let output: ContextListOutput | ContextExplainOutput;
  if (subcommand === "list") {
    const applied = new Set(chain.map((one) => one.name));
    const contexts = [...store.defs.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ name, id, parent, abstract, team, me }) => ({ name, id, parent, abstract, team, me, matched: applied.has(name) }));
    output = { acs: ACS_VERSION, contexts, problems: store.problems };
  } else {
    output = { acs: ACS_VERSION, place, chain, layers: layerOrder(chain) };
  }
  out(`${JSON.stringify(output, null, 2)}\n`);
  return EXIT.ok;
}

function list(): number {
  const output: ListOutput = { acs: ACS_VERSION, components: listDeclarations(detectHarness()) };
  out(`${JSON.stringify(output, null, 2)}\n`);
  return EXIT.ok;
}

function browseOnePassword(parsed: ParsedArgs): number {
  const what = parsed.positionals[0];
  const need = (value: string | undefined, flag: string): string => {
    if (!value) throw new ConfigError(`1password ${what} needs ${flag}`);
    return value;
  };
  let found: object;
  if (what === "accounts") found = { accounts: onePassword.accounts() };
  else if (what === "vaults") found = { vaults: onePassword.vaults(parsed.account) };
  else if (what === "items" && !parsed.vault) found = onePassword.everything(parsed.account);
  else if (what === "items") found = onePassword.vaultItems(parsed.vault, parsed.account);
  else if (what === "fields") {
    found = { fields: onePassword.fields(need(parsed.vault, "--vault"), need(parsed.item, "--item"), parsed.account) };
  } else throw new ConfigError(`Unknown 1password subcommand ${JSON.stringify(what ?? "")}: accounts, vaults, items, fields`);
  out(`${JSON.stringify({ acs: ACS_VERSION, ...found }, null, 2)}\n`);
  return EXIT.ok;
}

function repos(parsed: ParsedArgs): number {
  const subcommand = parsed.positionals[0];
  if (subcommand !== "register") {
    throw new ConfigError(
      `Unknown repos subcommand ${JSON.stringify(subcommand ?? "")}. Only "register" exists so far.`,
    );
  }
  const result = registerRepo(cwdOf(parsed), parsed.alias ?? null);
  out(`${JSON.stringify({ acs: ACS_VERSION, ...result }, null, 2)}\n`);
  return EXIT.ok;
}

export function main(argv: string[]): number {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    report(`${(error as Error).message}\n`);
    return EXIT.config;
  }

  try {
    switch (parsed.command) {
      case "start":
        return start(parsed);
      case "load":
        return load(parsed);
      case "write":
        return write(parsed);
      case "adopt":
        return adopt(parsed);
      case "describe":
        return describe(parsed);
      case "path":
        return path(parsed);
      case "list":
        return list();
      case "1password":
        return browseOnePassword(parsed);
      case "repos":
        return repos(parsed);
      case "context":
        return context(parsed);
      case "":
      case "help":
      case "--help":
      case "-h":
        out(`${USAGE}\n`);
        return EXIT.ok;
      default:
        report(`Unknown command "${parsed.command}"\n\n${USAGE}\n`);
        return EXIT.config;
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      report(`${error.message}\n`);
      return EXIT.config;
    }
    if (error instanceof CredentialError) {
      report(`${error.message}\n`);
      return EXIT.credential;
    }
    report(`agent-config failed unexpectedly: ${(error as Error).stack ?? String(error)}\n`);
    return EXIT.internal;
  }
}
