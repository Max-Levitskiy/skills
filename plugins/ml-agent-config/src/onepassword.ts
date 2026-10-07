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
  return listed.map((one) => ({ id: one.account_uuid, label: `${one.email} (${one.url})` }));
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
