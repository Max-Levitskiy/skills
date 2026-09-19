// Credential references: shape checking, and resolution.
//
// D2 fixed that a credential key is checked at three different moments, and that this is what
// makes a defaulted `op://` reference safe rather than a trap:
//   start      — presence and shape only. Resolving on the hot path means a Touch ID prompt per
//                invocation, which ACS forbids outright.
//   onboarding — real resolution, because a human is present.
//   runtime    — a resolution failure is an error naming the reference and the fix, never an
//                onboarding trigger.
//
// A resolved secret never reaches stdout, argv, a log, or disk. `load` writes it to fd 3.

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { dirname } from "path";
import { expandPath } from "./repo";
import type { ConfigValue } from "./layers";

export interface CredentialRef {
  source: "1password" | "env" | "dotenv" | "keychain" | "command";
  ref?: string;
  account?: string;
  var?: string;
  path?: string;
  service?: string;
  command?: string;
  /**
   * ACS v1's session cache: when this environment variable holds a non-empty value the resolver
   * uses it and never touches `source`. Inert for an agent — agent-run bash keeps no shell state
   * between calls (D4) — but it still works for a human at a terminal, so it is still honoured.
   */
  cacheVar?: string;
}

const REQUIRED_FIELDS: Record<CredentialRef["source"], (keyof CredentialRef)[]> = {
  "1password": ["ref"],
  env: ["var"],
  dotenv: ["path", "var"],
  keychain: ["service", "account"],
  command: ["command"],
};

/** Raised when a reference is present and well-formed but the secret cannot be fetched — exit 3. */
export class CredentialError extends Error {}

/**
 * Problems with one reference's shape; empty means usable *as a reference*, which is all `start`
 * ever checks. A present-but-malformed reference is a different conversation from an absent one,
 * so this reports rather than throwing.
 */
export function referenceProblems(key: string, value: ConfigValue | undefined): string[] {
  if (value === undefined) return [`credentials.${key} is not set`];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`credentials.${key} must be a credential reference object, not ${typeof value}`];
  }
  const reference = value as unknown as CredentialRef;
  const required = REQUIRED_FIELDS[reference.source];
  if (!required) {
    return [
      `credentials.${key}.source ${JSON.stringify(reference.source ?? null)} is not a known source ` +
        `(${Object.keys(REQUIRED_FIELDS).join(", ")})`,
    ];
  }
  return required
    .filter((field) => !reference[field])
    .map((field) => `credentials.${key}.${field} is required for source "${reference.source}"`);
}

function run(command: string, args: string[], hint: string, key: string): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new CredentialError(
      `${command} is not installed or not on PATH. ${hint} (referenced by credentials.${key}).`,
    );
  }
  if (result.status !== 0) {
    throw new CredentialError(
      `${command} failed: ${(result.stderr || "").trim() || `exit ${result.status}`}. ${hint} ` +
        `(referenced by credentials.${key}).`,
    );
  }
  return result.stdout.replace(/\n+$/, "");
}

/**
 * A dotenv file only keeps its secret out of git if it is gitignored. Outside a repo there is
 * nothing to leak into, so the check is skipped there rather than failing.
 */
function assertGitignored(path: string, key: string): void {
  const root = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(path), encoding: "utf8" });
  if (root.error || root.status !== 0) return;
  if (spawnSync("git", ["check-ignore", "-q", path], { cwd: root.stdout.trim() }).status === 0) return;
  throw new CredentialError(
    `${path} is not gitignored (referenced by credentials.${key}.path). A committed dotenv file leaks its ` +
      `secret — add it to .gitignore, or point credentials.${key} at a source outside the working tree.`,
  );
}

export function resolveCredential(reference: CredentialRef, key: string, checkout: string | null): string {
  // Whitespace-only counts as unseeded: a stray `export X=` must fall through to the real source
  // rather than resolve to an empty secret.
  if (reference.cacheVar) {
    const cached = process.env[reference.cacheVar];
    if (cached && cached.trim()) return cached;
  }

  let value: string;
  switch (reference.source) {
    case "1password": {
      const args = ["read", reference.ref!];
      if (reference.account) args.push("--account", reference.account);
      value = run("op", args, "Install the 1Password CLI and run 'op signin'.", key);
      break;
    }
    case "env": {
      const found = process.env[reference.var!];
      if (!found) {
        throw new CredentialError(
          `Environment variable ${reference.var} is not set (referenced by credentials.${key}).`,
        );
      }
      value = found;
      break;
    }
    case "dotenv": {
      const path = expandPath(reference.path!, checkout);
      assertGitignored(path, key);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        throw new CredentialError(`Cannot read ${path} (referenced by credentials.${key}.path).`);
      }
      const line = text.split("\n").find((candidate) => candidate.trim().startsWith(`${reference.var}=`));
      if (!line) throw new CredentialError(`${reference.var} not found in ${path}.`);
      value = line
        .slice(line.indexOf("=") + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      break;
    }
    case "keychain": {
      value = run(
        "security",
        ["find-generic-password", "-s", reference.service!, "-a", reference.account!, "-w"],
        "Check the service and account names match a Keychain entry.",
        key,
      );
      break;
    }
    case "command": {
      const result = spawnSync("sh", ["-c", reference.command!], { encoding: "utf8" });
      if (result.status !== 0) {
        throw new CredentialError(
          `Credential command failed: ${(result.stderr || "").trim() || `exit ${result.status}`} ` +
            `(referenced by credentials.${key}).`,
        );
      }
      value = result.stdout.replace(/\n+$/, "");
      break;
    }
    default:
      throw new CredentialError(`Unknown credential source ${JSON.stringify(reference.source)}.`);
  }

  if (!value) throw new CredentialError(`credentials.${key} resolved to an empty value.`);
  return value;
}
