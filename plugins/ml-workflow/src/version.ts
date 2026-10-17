// The two minimums (docs/spec.md, p.2), read by the helper and the mod. This file must load on any
// Bun the helper may start under, the ones it refuses included, so it uses no API newer than 1.0.

export const BUN_MINIMUM = "1.2.0";
export const CLAUDE_CODE_MINIMUM = "2.1.290";

// The plugin's version for the mod, which cannot import `.claude-plugin/plugin.json`: a hooks
// module loads only script files. test/claude-spore.spec.ts holds it equal to the manifest's.
export const PLUGIN_VERSION = "0.11.3";

// The oldest supported spore, and the contracts of `spore capabilities` the plugin drives
// (docs/spec.md, p.3). Below 1.0 a contract's range is its one minor version. 0.4.0 is the first
// release with `continue --wait`, `cancel` and the checkpoint E and F fixes the skills rely on.
export const SPORE_MINIMUM = "0.4.0";
export const SPORE_CONTRACTS: Record<string, string> = { cli: "0.2", host: "0.2", kernel: "0.2", store: "0.2" };

/** Whether a contract version `have` (`major.minor`) is in the range of the supported `need`. */
export function inRange(have: string, need: string): boolean {
  const parse = (version: string) => /^(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  const h = parse(have);
  const n = parse(need);
  if (!h || !n || h[0] !== n[0]) return false;
  return n[0] === 0 ? h[1] === n[1] : h[1]! >= n[1]!;
}

/**
 * Whether `version` is a release below `minimum`, compared as major.minor.patch numbers.
 * Anything after the patch number (`-dev…`, ` (Claude Code)`) is ignored, and a version that does
 * not start with three numbers is never older: what cannot be read is let through, not refused.
 */
export function isOlder(version: string, minimum: string): boolean {
  const have = release(version);
  const need = release(minimum);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i]! < need[i]!;
  }
  return false;
}

function release(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}
