// What a spore release is, by runspore's `spec/release.md`: the asset for this machine, the
// signature on `SHA256SUMS`, the archive's line in it, and the binary inside the archive
// (docs/spec.md, p.3). Every check here refuses by throwing a `ReleaseError`.
import { createHash, createPublicKey, verify } from "node:crypto";

/** The release key, as release.md §4 pins it. A rotation in runspore needs a plugin release. */
export const RELEASE_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGy3mjvtp10UZgB9Y8u3KNBOh66DHPo3bdbZEszh9b1k runspore-release";

const NAMESPACE = "runspore-release";

export class ReleaseError extends Error {}

/** The archive for a platform and architecture (release.md §1), or null for any other pair. */
export function assetName(platform: string, arch: string): string | null {
  const os = { darwin: "apple-darwin", linux: "unknown-linux-musl" }[platform];
  const cpu = { arm64: "aarch64", x64: "x86_64" }[arch];
  return os && cpu ? `spore-${cpu}-${os}.tar.gz` : null;
}

/** Refuses unless `sig` is an SSHSIG over `sums` by `keyLine` (release.md §3). */
export function verifySignature(sums: Uint8Array, sig: string, keyLine: string = RELEASE_KEY): void {
  const [type, base64] = keyLine.trim().split(/\s+/);
  if (type !== "ssh-ed25519" || !base64) throw new ReleaseError("the pinned release key is not an ssh-ed25519 key");
  const pinned = Buffer.from(base64, "base64");

  const armored = /-----BEGIN SSH SIGNATURE-----([\s\S]*?)-----END SSH SIGNATURE-----/.exec(sig);
  if (!armored) throw new ReleaseError("SHA256SUMS.sig is not an SSH signature");
  const blob = new Reader(Buffer.from(armored[1]!.replace(/\s+/g, ""), "base64"));
  if (blob.bytes(6).toString("latin1") !== "SSHSIG" || blob.uint32() !== 1) {
    throw new ReleaseError("SHA256SUMS.sig is not an SSHSIG version 1 signature");
  }
  const publicKey = blob.string();
  const namespace = blob.string().toString("latin1");
  const reserved = blob.string();
  const hash = blob.string().toString("latin1");
  const signature = new Reader(blob.string());
  blob.end();

  if (!publicKey.equals(pinned)) throw new ReleaseError("SHA256SUMS is signed by another key than the pinned release key");
  if (namespace !== NAMESPACE || reserved.length !== 0 || hash !== "sha512") {
    throw new ReleaseError(`SHA256SUMS.sig has namespace "${namespace}" and hash "${hash}", not "${NAMESPACE}" and "sha512"`);
  }
  if (signature.string().toString("latin1") !== "ssh-ed25519") throw new ReleaseError("SHA256SUMS.sig is not an Ed25519 signature");
  const raw = signature.string();
  signature.end();
  if (raw.length !== 64) throw new ReleaseError("SHA256SUMS.sig holds no 64-byte Ed25519 signature");

  const key = new Reader(pinned);
  key.string();
  const x = key.string();
  const message = Buffer.concat([
    Buffer.from("SSHSIG", "latin1"),
    sshString(Buffer.from(NAMESPACE, "latin1")),
    sshString(Buffer.alloc(0)),
    sshString(Buffer.from("sha512", "latin1")),
    sshString(createHash("sha512").update(sums).digest()),
  ]);
  const jwk = { kty: "OKP", crv: "Ed25519", x: x.toString("base64url") };
  if (!verify(null, message, createPublicKey({ key: jwk, format: "jwk" }), raw)) {
    throw new ReleaseError("the signature of SHA256SUMS does not match: SHA256SUMS or its signature was changed");
  }
}

/** Refuses unless the archive's SHA-256 is its one line in `sums` (release.md §2). */
export function verifyChecksum(sums: string, asset: string, archive: Uint8Array): void {
  const lines = sums.split("\n").filter((line) => line.slice(66) === asset && line.slice(64, 66) === "  ");
  if (lines.length !== 1) throw new ReleaseError(`SHA256SUMS has ${lines.length} lines for ${asset}, not one`);
  const actual = createHash("sha256").update(archive).digest("hex");
  if (lines[0]!.slice(0, 64) !== actual) throw new ReleaseError(`the SHA-256 of ${asset} is not the one in SHA256SUMS: the archive was changed`);
}

/** The `spore` entry of a release archive, a gzip-compressed tar with `spore` at its root (§1). */
export function extractSpore(archive: Uint8Array): Uint8Array {
  const tar = Bun.gunzipSync(archive);
  const text = (from: number, length: number) => {
    const field = tar.subarray(from, from + length);
    const end = field.indexOf(0);
    return Buffer.from(end < 0 ? field : field.subarray(0, end)).toString("utf8");
  };
  for (let at = 0; at + 512 <= tar.length; ) {
    if (tar[at] === 0) break;
    const prefix = text(at + 257, 5) === "ustar" ? text(at + 345, 155) : "";
    const name = prefix ? `${prefix}/${text(at, 100)}` : text(at, 100);
    const size = parseInt(text(at + 124, 12).trim() || "0", 8);
    const type = text(at + 156, 1);
    const body = at + 512;
    if ((name === "spore" || name === "./spore") && (type === "" || type === "0")) {
      return tar.slice(body, body + size);
    }
    at = body + Math.ceil(size / 512) * 512;
  }
  throw new ReleaseError("the archive holds no spore at its root");
}

function sshString(bytes: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

// Reads SSH wire fields, refusing a short or overlong blob.
class Reader {
  private at = 0;
  constructor(private readonly buffer: Buffer) {}

  bytes(length: number): Buffer {
    if (this.at + length > this.buffer.length) throw new ReleaseError("SHA256SUMS.sig is cut short");
    const out = this.buffer.subarray(this.at, this.at + length);
    this.at += length;
    return out;
  }

  uint32(): number {
    return this.bytes(4).readUInt32BE(0);
  }

  string(): Buffer {
    return this.bytes(this.uint32());
  }

  end() {
    if (this.at !== this.buffer.length) throw new ReleaseError("SHA256SUMS.sig has bytes after its signature");
  }
}
