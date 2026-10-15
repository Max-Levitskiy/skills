// `claude-spore launcher install | decline`: the launcher in ~/.local/bin, offered once
// (docs/spec.md, p.5). Both answers are remembered, so the offer is never made again.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dataDir, localBin } from "./doctor.ts";

const LAUNCHER = join(import.meta.dir, "..", "launcher", "claude-spore");
const MARK = "// The ml-workflow launcher";

export function launcher(argv: string[]): number {
  const [action, ...rest] = argv;
  if (rest.length > 0 || (action !== "install" && action !== "decline")) {
    console.error("usage: claude-spore launcher install | decline");
    return 2;
  }
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(join(dataDir(), "launcher-offered"), `${action}\n`);
  if (action === "decline") {
    console.log("The launcher will not be offered again; `claude-spore launcher install` installs it.");
    return 0;
  }

  const folder = localBin();
  const target = join(folder, "claude-spore");
  if (existsSync(target) && !readFileSync(target, "utf8").includes(MARK)) {
    console.error(`launcher: ${target} exists and is not the ml-workflow launcher; move it away, then try again`);
    return 1;
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
  console.log(`Installed the claude-spore launcher at ${target}.${onPath ? "" : ` ${folder} is not on PATH; add it there.`}`);
  return 0;
}
