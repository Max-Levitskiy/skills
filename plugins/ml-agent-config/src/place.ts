// Where am I: the directories and normalised git remotes that describe the current place.
// A context's filters match against these (paths by glob, remotes by exact value).

import { realpathSync } from "fs";
import { git, normaliseRemote, repoContext } from "./repo";

export interface Place {
  cwd: string;
  /** checkout root, main root, cwd — deduped, each in both symlinked and real form, trailing "/" appended. */
  paths: string[];
  /** normalised URLs of every remote of the checkout and of each enclosing git superproject. */
  remotes: string[];
}

const unique = <T>(items: T[]): T[] => [...new Set(items)];

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Every remote URL configured in `checkout`, raw. Empty when git is missing or this is not a repo. */
export function remoteUrls(checkout: string): string[] {
  const out = git(["config", "--get-regexp", "^remote\\..*\\.url$"], checkout);
  if (!out) return [];
  return out.split("\n").map((line) => line.replace(/^\S+\s+/, "").trim()).filter(Boolean);
}

/** The working trees of each enclosing superproject, nearest first. */
export function superprojects(checkout: string): string[] {
  const found: string[] = [];
  let current = checkout;
  for (;;) {
    const parent = git(["rev-parse", "--show-superproject-working-tree"], current);
    if (!parent || parent === current || found.includes(parent)) return found;
    found.push(parent);
    current = parent;
  }
}

export function placeOf(cwd: string): Place {
  const { checkout, root } = repoContext(cwd);
  const roots = [checkout, root, cwd].filter((p): p is string => !!p);
  const paths = unique(roots.flatMap((p) => [p, realOrSelf(p)])).map((p) => (p.endsWith("/") ? p : `${p}/`));

  const remotes = checkout
    ? unique(
        [checkout, ...superprojects(checkout)]
          .flatMap(remoteUrls)
          .map(normaliseRemote)
          .filter((r): r is string => !!r),
      )
    : [];

  return { cwd, paths, remotes };
}
