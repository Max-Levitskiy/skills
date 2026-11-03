// A key declared `file: true` holds a path to a file, so a whole file can be swapped by config.
//
// A relative path resolves against the file that set it, the way an include does: the layer's own
// folder, or the declaration's folder for a default. A consumer gets an absolute path and reads the
// file itself. A layer someone else wrote is confined to its own folder, so a committed config
// cannot point a component at `~/.ssh/id_rsa`.

import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { realpathSync, statSync } from "fs";

export interface FileOwner {
  /** The folder a relative path resolves against. */
  base: string;
  /** Whether the path may leave that folder: true only for a file the user wrote here. */
  trusted: boolean;
}

/** Where `value` points, or the problem with it. */
export function resolveFileKey(
  key: string,
  value: unknown,
  owner: FileOwner,
  home: string = homedir(),
): { path: string } | { problem: string } {
  if (typeof value !== "string" || value === "") return { problem: `${key}: must be a path to a file` };
  const expanded = value === "~" || value.startsWith("~/") ? join(home, value.slice(1)) : value;
  const path = isAbsolute(expanded) ? expanded : resolve(owner.base, expanded);
  let real: string;
  try {
    real = realpathSync(path);
    if (!statSync(real).isFile()) return { problem: `${key}: ${path} is not a file` };
  } catch {
    return { problem: `${key}: ${path} does not exist` };
  }
  if (!owner.trusted) {
    let root: string;
    try {
      root = realpathSync(owner.base);
    } catch {
      return { problem: `${key}: ${owner.base} does not exist` };
    }
    const inside = relative(root, real);
    if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      return { problem: `${key}: ${value} leaves ${owner.base}, and this layer is not a file you wrote here` };
    }
  }
  return { path };
}

/** The owner of a value a layer set, from that layer's config file. */
export function layerOwner(file: { path: string; trusted: boolean }): FileOwner {
  return { base: dirname(file.path), trusted: file.trusted };
}
