// The CLI's tests run under `bun test src`. They are `.spec.ts` because `claude plugin test` loads
// every `*.test.ts` in the plugin as a hooks module test, where `bun:test` and Node are not there.

import { describe, expect, test } from "bun:test";
import { resolveCredential, type CredentialRef } from "./credentials";
import { SECRET_CACHE_VAR, cacheKey, cachedSecret, parseCache } from "./secret-cache";

describe("secret cache", () => {
  const reference = { source: "1password", ref: "op://Private/GitHub/token" };

  test("finds a secret by its reference, cacheVar aside", () => {
    const raw = JSON.stringify({ [cacheKey(reference)]: "s3cret" });
    expect(cachedSecret({ ...reference, cacheVar: "GH_TOKEN" } as typeof reference, raw)).toBe("s3cret");
  });

  test("another reference misses", () => {
    const raw = JSON.stringify({ [cacheKey(reference)]: "s3cret" });
    expect(cachedSecret({ source: "1password", ref: "op://Private/GitHub/other" }, raw)).toBeUndefined();
    expect(cachedSecret({ ...reference, account: "work" }, raw)).toBeUndefined();
  });

  test("a missing, malformed or non-object variable reads as empty", () => {
    for (const raw of [undefined, "", "not json", "[1]", "null", "42"]) expect(parseCache(raw)).toEqual({});
  });

  test("a reference's own cacheVar wins over the session cache", () => {
    const saved = { cache: process.env[SECRET_CACHE_VAR], own: process.env.AC_SPEC_TOKEN };
    try {
      process.env[SECRET_CACHE_VAR] = JSON.stringify({ [cacheKey(reference)]: "from-session" });
      process.env.AC_SPEC_TOKEN = "from-cachevar";
      const withVar = { ...reference, cacheVar: "AC_SPEC_TOKEN" } as CredentialRef;
      expect(resolveCredential(withVar, "token", null)).toBe("from-cachevar");
      delete process.env.AC_SPEC_TOKEN;
      expect(resolveCredential(withVar, "token", null)).toBe("from-session");
    } finally {
      for (const [name, value] of [[SECRET_CACHE_VAR, saved.cache], ["AC_SPEC_TOKEN", saved.own]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("blank and non-string values are dropped, so resolution falls through to the source", () => {
    expect(parseCache(JSON.stringify({ a: "  ", b: 1, c: "ok" }))).toEqual({ c: "ok" });
  });
});
