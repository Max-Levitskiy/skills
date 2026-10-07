// The CLI's tests run under `bun test src`. They are `.spec.ts` because `claude plugin test` loads
// every `*.test.ts` in the plugin as a hooks module test, where `bun:test` and Node are not there.

import { describe, expect, test } from "bun:test";
import { cacheKey, cachedSecret, parseCache } from "./secret-cache";

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

  test("blank and non-string values are dropped, so resolution falls through to the source", () => {
    expect(parseCache(JSON.stringify({ a: "  ", b: 1, c: "ok" }))).toEqual({ c: "ok" });
  });
});
