// Subtracting the config from the declaration: defaults, conditional groups, and what is missing.
//
// D2 forced the order. Defaults live in the declaration and are applied to the merged config
// *before* `when` is evaluated, because a condition needs something well-defined to evaluate
// against — evaluating it against only what the user literally wrote is accidentally correct for
// a default of `file` and silently wrong for any default that selects a branch needing a
// credential. A key with a default is therefore not required and never emits an action.
//
// When a discriminant is itself unset, the groups reading it are not evaluated this turn: the
// action for the discriminant is emitted and that is where it stops. The agent re-runs `start`
// after the answer and gets the branch. Emitting every branch pessimistically would mean four
// interviews with three thrown away.

import {
  declaredKeys,
  DEFAULT_ONBOARD_ACTION,
  valueProblems,
  type Declaration,
  type KeyEntry,
  type KeyGroup,
  type WhenMatcher,
} from "./declaration";
import { setValueAt, valueAt, type ConfigObject, type ConfigValue, type Layer } from "./layers";
import { referenceProblems } from "./credentials";
import { keySchema } from "./key-schema";
import { layerOwner, resolveFileKey, type FileOwner } from "./file-keys";
import type { DescribedKey, Problem } from "./types";

export type GroupStatus = "active" | "inactive" | "unevaluated";

export interface Effective {
  config: ConfigObject;
  provenance: Record<string, Layer | "default">;
  keys: DescribedKey[];
  /** Missing or malformed keys, collapsed onto the action that fixes them (D2 dedupes by id). */
  gaps: { action: string; keys: string[] }[];
  problems: Problem[];
}

function evaluateWhen(when: WhenMatcher, config: ConfigObject): GroupStatus {
  if (typeof when === "string") {
    const value = valueAt(config, when);
    if (value === undefined) return "unevaluated";
    return value ? "active" : "inactive";
  }
  let status: GroupStatus = "active";
  for (const [path, matcher] of Object.entries(when)) {
    const value = valueAt(config, path);
    if (value === undefined) return "unevaluated";
    const matches = Array.isArray(matcher) ? matcher.some((option) => option === value) : matcher === value;
    if (!matches) status = "inactive";
  }
  return status;
}

/** Fill in a declared default where the merged config has nothing, recording it as provenance. */
function applyDefault(
  path: string,
  entry: KeyEntry,
  config: ConfigObject,
  provenance: Record<string, Layer | "default">,
): void {
  if (entry.default === undefined || valueAt(config, path) !== undefined) return;
  setValueAt(config, path, entry.default);
  provenance[path] = "default";
}

export function effectiveConfig(
  declaration: Declaration,
  loaded: { config: ConfigObject; provenance: Record<string, Layer>; files?: { layer: Layer; path: string | null; trusted: boolean }[] },
  /** The declaration's folder, which a `file` key's default resolves against. */
  declarationDir?: string,
): Effective {
  const config = structuredClone(loaded.config);
  const provenance: Record<string, Layer | "default"> = { ...loaded.provenance };
  const problems: Problem[] = [];

  const unconditional = Object.entries(declaration.schema?.keys ?? {});
  for (const [path, entry] of unconditional) applyDefault(path, entry, config, provenance);

  const groupStatus = new Map<KeyGroup, GroupStatus>();
  for (const group of declaration.schema?.groups ?? []) {
    const status = evaluateWhen(group.when, config);
    groupStatus.set(group, status);
    if (status !== "active") continue;
    for (const [path, entry] of Object.entries(group.keys ?? {})) applyDefault(path, entry, config, provenance);
  }

  const keys: DescribedKey[] = [];
  const gaps = new Map<string, string[]>();

  for (const { path, entry, group } of declaredKeys(declaration)) {
    const status = group ? (groupStatus.get(group) ?? "unevaluated") : "active";
    const required = status === "active";
    let value = valueAt(config, path);
    const credential = path.startsWith("credentials.");
    const keyProblems = credential && value !== undefined ? referenceProblems(path.slice("credentials.".length), value) : [];

    // A file key reaches the consumer as an absolute path, or as a problem that keeps it from running.
    if (entry.file === true && value !== undefined && status === "active") {
      const owner = fileOwner(provenance[path], loaded.files ?? [], declarationDir);
      const resolved = owner ? resolveFileKey(path, value, owner) : { problem: `${path}: nothing says what it is relative to` };
      if ("path" in resolved) {
        value = resolved.path;
        setValueAt(config, path, value);
      } else {
        keyProblems.push(resolved.problem);
      }
    }

    keys.push({
      path,
      description: entry.description,
      layer: entry.layer ?? null,
      default: entry.default ?? null,
      schema: keySchema(entry),
      credential,
      personal: entry.personal === true,
      file: entry.file === true,
      choices: entry.choices ? { search: entry.choices.search ?? "local" } : null,
      group: group ? { when: group.when, action: group.action ?? DEFAULT_ONBOARD_ACTION, status } : null,
      required,
      value: value === undefined ? null : value,
      source: provenance[path] ?? null,
      levels: {},
      problems: keyProblems,
    });

    if (!required) continue;
    const action = group?.action ?? DEFAULT_ONBOARD_ACTION;
    const absent = value === undefined;
    if (!absent && keyProblems.length === 0) continue;

    // A present-but-malformed reference emits an action *and* a problem: "your reference is
    // broken" and "you have nothing configured" are different conversations (D4).
    if (!absent) {
      problems.push({
        code: entry.file === true ? "invalid-value" : "credential-malformed",
        message: keyProblems.join("; "),
        keys: [path],
      });
    }
    gaps.set(action, [...(gaps.get(action) ?? []), path]);
  }

  // A value its schema refuses is said, not planned for: the config may still work, and only the
  // person knows which value was meant.
  for (const { path, problems: wrong } of valueProblems(declaration, config, false)) {
    problems.push({ code: "invalid-value", message: wrong.join("; "), keys: [path] });
  }

  return {
    config,
    provenance,
    keys,
    gaps: [...gaps].map(([action, actionKeys]) => ({ action, keys: actionKeys })),
    problems,
  };
}

function fileOwner(
  source: Layer | "default" | undefined,
  files: { layer: Layer; path: string | null; trusted: boolean }[],
  declarationDir: string | undefined,
): FileOwner | null {
  if (source === "default") return declarationDir ? { base: declarationDir, trusted: true } : null;
  const file = files.find((one) => one.layer === source);
  return file?.path ? layerOwner({ path: file.path, trusted: file.trusted }) : null;
}

/** The keys `load` refuses to run without: required, and neither set nor defaulted. */
export function unmetKeys(effective: Effective): string[] {
  return effective.keys
    .filter((key) => key.required && (key.value === null || key.problems.length > 0))
    .map((key) => key.path);
}
