// `atlassian launcher install`: the plugin's launcher, copied to ~/.local/bin, so a workflow hook or
// a plain terminal runs `atlassian` by that name instead of a versioned plugin cache path.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

/** The plugin's launcher file: scripts/lib → the plugin root → launcher/. */
const LAUNCHER = resolve(import.meta.dir, "..", "..", "..", "..", "launcher", "atlassian");
const MARK = "// The ml-workplace atlassian launcher";

export function installLauncher(): { ok: boolean; message: string } {
  if (!existsSync(LAUNCHER)) {
    return { ok: false, message: `launcher: ${LAUNCHER} is missing; it ships with the ml-workplace plugin` };
  }
  const folder = join(process.env.HOME || homedir(), ".local", "bin");
  const target = join(folder, "atlassian");
  if (existsSync(target) && !readFileSync(target, "utf8").includes(MARK)) {
    return { ok: false, message: `launcher: ${target} exists and is not the ml-workplace launcher; move it away, then try again` };
  }
  mkdirSync(folder, { recursive: true });
  const partial = `${target}.${process.pid}.partial`;
  try {
    writeFileSync(partial, readFileSync(LAUNCHER));
    chmodSync(partial, 0o755);
    renameSync(partial, target);
  } finally {
    rmSync(partial, { force: true });
  }
  const onPath = (process.env.PATH ?? "").split(":").includes(folder);
  return { ok: true, message: `Installed the atlassian launcher at ${target}.${onPath ? "" : ` ${folder} is not on PATH; add it there.`}` };
}
