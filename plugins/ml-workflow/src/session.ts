import { createHash } from "node:crypto";

// Fixed for good (docs/spec.md, p.18): a new namespace would cut every unfinished run off from its
// conversations.
const NAMESPACE = "40c82ef1-afd2-4dda-b095-47327517b1dc";

/** The Claude session of one node in one run: every visit and try of it shares this conversation. */
export function sessionId(runId: string, nodeId: string): string {
  return uuidV5(NAMESPACE, `${runId}/${nodeId}`);
}

// RFC 9562 §5.5: SHA-1 over the namespace's bytes and the name, with the version and variant set.
function uuidV5(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name, "utf8")
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
