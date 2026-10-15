// `claude-spore install-spore`: installs or updates the spore PATH selects, from a signed release,
// after the person said yes (docs/spec.md, p.3). Nothing is written before both checks pass.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { checkSpore, sporeTarget } from "./doctor.ts";
import { ReleaseError, assetName, extractSpore, verifyChecksum, verifySignature } from "./release.ts";

const RELEASES = "https://github.com/Web-tree/runspore/releases";

export async function installSpore(argv: string[]): Promise<number> {
  if (argv.length > 0) {
    console.error("usage: claude-spore install-spore\n\nSPORE_VERSION picks a release, SPORE_DOWNLOAD_URL a folder holding its assets.");
    return 2;
  }
  const fail = (message: string) => {
    console.error(`install-spore: ${message}`);
    return 1;
  };

  const where = sporeTarget();
  if (!where.writable) return fail(`${where.target} is not writable here; update it with: ${where.fix}`);

  const asset = assetName(process.platform, machine());
  if (!asset) return fail(`no spore release is built for ${process.platform} ${process.arch}`);

  let binary: Uint8Array;
  try {
    const base = source();
    const [sums, sig, archive] = await Promise.all([download(base, "SHA256SUMS"), download(base, "SHA256SUMS.sig"), download(base, asset)]);
    verifySignature(sums, Buffer.from(sig).toString("utf8"));
    verifyChecksum(Buffer.from(sums).toString("utf8"), asset, archive);
    binary = extractSpore(archive);
  } catch (error) {
    if (error instanceof ReleaseError) return fail(`${error.message}; nothing was installed`);
    throw error;
  }

  // One rename over the target, so it never holds a partial file.
  const folder = dirname(where.target);
  const partial = join(folder, `.${basename(where.target)}.${process.pid}.partial`);
  mkdirSync(folder, { recursive: true });
  try {
    writeFileSync(partial, binary);
    chmodSync(partial, 0o755);
    renameSync(partial, where.target);
  } finally {
    rmSync(partial, { force: true });
  }

  const selected = Bun.which("spore");
  if (!selected || realpathSync(selected) !== where.target) {
    const instead = selected ? `PATH selects ${selected} first` : `${folder} is not on PATH`;
    return fail(`installed ${where.target}, but ${instead}; put ${folder} first on PATH`);
  }
  const checked = checkSpore();
  if (checked.problems.length > 0) return fail(`installed ${where.target}, but it does not fit: ${checked.problems[0]!.message}`);
  console.log(`Installed spore ${checked.spore!.version} at ${where.target}.`);
  return 0;
}

// The architecture of the machine: the arm64 asset under Rosetta, as release.md §6 picks it.
function machine(): string {
  if (process.platform === "darwin" && process.arch === "x64") {
    const translated = Bun.spawnSync(["sysctl", "-n", "sysctl.proc_translated"], { stderr: "ignore" });
    if (translated.stdout.toString().trim() === "1") return "arm64";
  }
  return process.arch;
}

// The folder the assets are read from: a mirror, a given release, or the newest one.
function source(): string {
  const mirror = process.env.SPORE_DOWNLOAD_URL;
  if (mirror) return mirror.replace(/\/+$/, "");
  const version = process.env.SPORE_VERSION;
  return version ? `${RELEASES}/download/v${version.replace(/^v/, "")}` : `${RELEASES}/latest/download`;
}

async function download(base: string, name: string): Promise<Uint8Array> {
  if (/^https?:\/\//.test(base)) {
    const response = await fetch(`${base}/${name}`).catch((error: Error) => {
      throw new ReleaseError(`could not download ${base}/${name}: ${error.message}`);
    });
    if (!response.ok) throw new ReleaseError(`could not download ${base}/${name}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  const path = join(base.replace(/^file:\/\//, ""), name);
  if (!existsSync(path)) throw new ReleaseError(`${path} is missing`);
  return readFileSync(path);
}
