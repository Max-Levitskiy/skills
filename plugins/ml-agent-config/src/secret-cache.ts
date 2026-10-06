// The session secret cache: one environment variable holding resolved secrets as JSON, keyed by
// the reference that produced each one.
//
// Agent-run bash keeps no shell state, so a `cacheVar` an agent exports is gone by its next call
// and every `load --secrets` asks 1Password again. On Claude Code the plugin's hooks module sets
// this variable on the harness process after the person approves one 1Password read, and every
// later child process inherits it. One fixed name, because a hooks module may only set a variable
// it names literally.
//
// Pure on purpose: the CLI and the hooks module both import it, and the hooks module has no Node.

export const SECRET_CACHE_VAR = "AGENT_CONFIG_SECRETS";

interface Reference {
  source: string;
  ref?: string;
  account?: string;
  var?: string;
  path?: string;
  service?: string;
  command?: string;
}

/** Same reference, same key: everything that picks the secret, never `cacheVar`. */
export function cacheKey(reference: Reference): string {
  const { source, ref, account, var: name, path, service, command } = reference;
  return JSON.stringify([source, ref ?? null, account ?? null, name ?? null, path ?? null, service ?? null, command ?? null]);
}

/** A malformed or missing variable reads as an empty cache, so resolution falls through to the source. */
export function parseCache(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function cachedSecret(reference: Reference, raw: string | undefined): string | undefined {
  return parseCache(raw)[cacheKey(reference)];
}
