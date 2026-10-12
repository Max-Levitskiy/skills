// The two minimums (docs/spec.md, p.2), read by the helper and the mod. This file must load on any
// Bun the helper may start under, the ones it refuses included, so it uses no API newer than 1.0.

export const BUN_MINIMUM = "1.2.0";
export const CLAUDE_CODE_MINIMUM = "2.1.290";

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
