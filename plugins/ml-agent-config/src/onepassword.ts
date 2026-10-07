// Browsing 1Password for a reference, so a person picks vault, item and field instead of typing an
// `op://` address. Every call goes through `op`, which asks the person to approve as `op read` does.
//
// A field's value never leaves this process: `op item get` returns values, and only the field's
// name, type and `op://` reference are printed. The same rule as `load`: no secret on stdout.

import { spawnSync } from "child_process";
import { CredentialError } from "./credentials";

const HINT = "Install the 1Password CLI and turn on its app integration, or run 'op signin'.";

function op(args: string[], account?: string): unknown {
  const full = [...args, "--format", "json", ...(account ? ["--account", account] : [])];
  const result = spawnSync("op", full, { encoding: "utf8" });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    throw new CredentialError(`op is not installed or not on PATH. ${HINT}`);
  }
  if (result.status !== 0) {
    throw new CredentialError(`op ${args[0]} ${args[1]} failed: ${(result.stderr || "").trim() || `exit ${result.status}`}. ${HINT}`);
  }
  return JSON.parse(result.stdout || "[]");
}

export interface OnePasswordAccount {
  id: string;
  label: string;
  /** A short name for lists: the sign-in address's first part, or the email on my.1password.com. */
  short: string;
}

export interface OnePasswordVault {
  id: string;
  name: string;
}

export interface OnePasswordItem {
  id: string;
  title: string;
  category: string;
}

/** One item of every vault, with the vault and account it sits in, so a picker can filter by them. */
export interface OnePasswordListed extends OnePasswordItem {
  vault: OnePasswordVault;
  account: string | null;
}

export interface OnePasswordField {
  id: string;
  label: string;
  section: string | null;
  type: string;
  /** The `op://` address `op read` takes: what a credential reference stores as `ref`. */
  reference: string;
}

export function accounts(): OnePasswordAccount[] {
  const listed = op(["account", "list"]) as { account_uuid: string; email: string; url: string }[];
  return listed.map((one) => {
    const host = one.url.replace(/^https?:\/\//, "").split(".")[0] ?? "";
    return { id: one.account_uuid, label: `${one.email} (${one.url})`, short: host && host !== "my" ? host : one.email };
  });
}

export function vaults(account?: string): OnePasswordVault[] {
  const listed = op(["vault", "list"], account) as { id: string; name: string }[];
  return listed.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// `additional_information` (a login's username) is left out with the rest: only what names the item.
export function items(vault: string, account?: string): OnePasswordItem[] {
  const listed = op(["item", "list", "--vault", vault], account) as { id: string; title: string; category: string }[];
  return listed
    .map(({ id, title, category }) => ({ id, title, category }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Every item of every vault, one `op item list` per account, so the person approves each account
 * once. An account that refuses is reported and the others are still listed; only when every
 * account refuses is it an error.
 */
export function everything(account?: string): {
  accounts: OnePasswordAccount[];
  items: OnePasswordListed[];
  problems: string[];
} {
  const known = accounts();
  const wanted = account ? known.filter((one) => one.id === account) : known;
  const asked = wanted.length > 0 ? wanted.map((one) => one.id) : [account];
  const listed: OnePasswordListed[] = [];
  const problems: string[] = [];
  for (const id of asked) {
    try {
      const got = op(["item", "list"], id) as { id: string; title: string; category: string; vault: OnePasswordVault }[];
      for (const { id: item, title, category, vault } of got) {
        listed.push({ id: item, title, category, vault: { id: vault.id, name: vault.name }, account: id ?? null });
      }
    } catch (error) {
      if (asked.length === 1) throw error;
      problems.push((error as Error).message);
    }
  }
  if (problems.length === asked.length) throw new CredentialError(problems[0]!);
  listed.sort((a, b) => a.title.localeCompare(b.title));
  return { accounts: known, items: listed, problems };
}

export function fields(vault: string, item: string, account?: string): OnePasswordField[] {
  const got = op(["item", "get", item, "--vault", vault], account) as {
    fields?: { id: string; label?: string; type: string; reference?: string; section?: { label?: string } }[];
  };
  return (got.fields ?? [])
    .filter((field) => field.reference)
    .map((field) => ({
      id: field.id,
      label: field.label || field.id,
      section: field.section?.label || null,
      type: field.type,
      reference: field.reference!,
    }));
}
