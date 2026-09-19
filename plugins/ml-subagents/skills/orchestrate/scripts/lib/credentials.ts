// Credential resolution comes from the vendored Agent Config Standard library.
// This re-export exists so callers never import the vendor path directly — see
// standards/agent-config.md. Do not add logic here; fix the canonical copy instead.

export { resolveCredential, describeCredential } from "./vendor/agent-config/credentials";
