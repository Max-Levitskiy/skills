// Local fixtures for getting and checking spore (docs/spec.md, p.3, p.5): a fake `spore` that
// answers `capabilities` as told, a copy of the plugin pinned to a throwaway release key, and
// release folders signed with it by the real `ssh-keygen`.
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { assetName } from "../src/release.ts";
import { scratch } from "./helpers.ts";

const PLUGIN = join(import.meta.dir, "..");

export const CAPABILITIES = {
  format: "runspore.cli/0.2",
  version: "0.4.0",
  contracts: { artifact: "0.1", cli: "0.2", dot: "0.2", host: "0.2", kernel: "0.2", schema: "0.2", store: "0.2" },
  actionKinds: ["command", "external", "native"],
  asyncKinds: ["command", "external"],
  resultChannels: ["store"],
};

/** A `spore` that prints `capabilities` as JSON, or fails as a spore from before the handshake. */
export function fakeSpore(path: string, capabilities: unknown | null) {
  mkdirSync(dirname(path), { recursive: true });
  const answer = capabilities === null ? `echo "error: unrecognized subcommand 'capabilities'" >&2; exit 2` : `printf '%s\\n' '${JSON.stringify(capabilities)}'; exit 0`;
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = capabilities ]; then ${answer}; fi\necho "spore 0.2.0"\n`);
  chmodSync(path, 0o755);
}

/** PATH for the helper: the given folders, then Bun, then the system's tools. Never a real spore. */
export function pathOf(...folders: string[]): string {
  return [...folders, dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
}

export function run(argv: string[], options: { env: Record<string, string>; cwd?: string; stdin?: string }) {
  const env: Record<string, string> = { ...process.env, ...options.env } as Record<string, string>;
  for (const key of ["CLAUDE_CONFIG_DIR", "CLAUDE_PLUGIN_DATA", "CARGO_HOME", "SPORE_VERSION", "SPORE_DOWNLOAD_URL"]) {
    if (!(key in options.env)) delete env[key];
  }
  const child = Bun.spawnSync(argv, { env, cwd: options.cwd, stdin: options.stdin ? Buffer.from(options.stdin) : "ignore" });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

function sh(argv: string[], cwd?: string) {
  const child = Bun.spawnSync(argv, { cwd, env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (child.exitCode !== 0) throw new Error(`${argv.join(" ")}: ${child.stderr.toString()}`);
}

/** A throwaway Ed25519 release key: its private file and its public line. */
export function releaseKey(dir: string): { file: string; line: string } {
  const file = join(dir, "release-key");
  sh(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "runspore-release", "-f", file]);
  return { file, line: readFileSync(`${file}.pub`, "utf8").trim() };
}

/** A copy of the plugin whose pinned release key is `line`; returns its helper. */
export function pluginPinnedTo(line: string): string {
  const root = scratch();
  for (const part of ["bin", "src", "launcher", ".claude-plugin"]) cpSync(join(PLUGIN, part), join(root, part), { recursive: true });
  const release = join(root, "src", "release.ts");
  const source = readFileSync(release, "utf8");
  const pinned = source.replace(/"ssh-ed25519 [A-Za-z0-9+/=]+ runspore-release"/, JSON.stringify(line));
  if (pinned === source) throw new Error("could not repin the release key");
  writeFileSync(release, pinned);
  return join(root, "bin", "claude-spore");
}

/** The asset name for this machine, as the helper picks it. */
export function thisAsset(): string {
  let arch = process.arch;
  if (process.platform === "darwin" && arch === "x64") {
    const translated = Bun.spawnSync(["sysctl", "-n", "sysctl.proc_translated"]).stdout.toString().trim();
    if (translated === "1") arch = "arm64";
  }
  return assetName(process.platform, arch)!;
}

/**
 * A release folder: the archive for this machine holding a `spore` that answers `capabilities`
 * with `capabilities`, `SHA256SUMS`, and `SHA256SUMS.sig` signed with `key`.
 */
export function release(dir: string, key: string, capabilities: unknown = CAPABILITIES): string {
  const build = join(dir, "build");
  const out = join(dir, "release");
  mkdirSync(out, { recursive: true });
  fakeSpore(join(build, "spore"), capabilities);
  writeFileSync(join(build, "LICENSE"), "MIT\n");
  const asset = thisAsset();
  sh(["tar", "-czf", join(out, asset), "spore", "LICENSE"], build);
  sums(out, asset);
  sign(out, key);
  return out;
}

/** Writes `SHA256SUMS` for the archive as it is now. */
export function sums(out: string, asset: string) {
  const digest = new Bun.CryptoHasher("sha256").update(readFileSync(join(out, asset))).digest("hex");
  writeFileSync(join(out, "SHA256SUMS"), `${digest}  ${asset}\n`);
}

export function sign(out: string, key: string) {
  rmSync(join(out, "SHA256SUMS.sig"), { force: true });
  sh(["ssh-keygen", "-q", "-Y", "sign", "-f", key, "-n", "runspore-release", "SHA256SUMS"], out);
}
