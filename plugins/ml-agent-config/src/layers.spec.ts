// One layer's own value for a key, as `describe` reports it per level.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ConfigError, contextLayers, layerOrder, layerPath, ownValueAt, parseLayer, writeFileAtomic, type Layer } from "./layers";

describe("a layer's own value for a key", () => {
  test("a parent that is null or a plain value blocks the key, as the merge does", () => {
    expect(ownValueAt({ foo: null }, "foo.bar")).toBeNull();
    expect(ownValueAt({ foo: "x" }, "foo.bar")).toBeNull();
    expect(ownValueAt({ foo: [1] }, "foo.bar")).toBeNull();
  });

  test("a value, a null on the key, and nothing at all read as they are", () => {
    expect(ownValueAt({ foo: { bar: 1 } }, "foo.bar")).toBe(1);
    expect(ownValueAt({ foo: { bar: null } }, "foo.bar")).toBeNull();
    expect(ownValueAt({ foo: {} }, "foo.bar")).toBeUndefined();
    expect(ownValueAt({}, "foo.bar")).toBeUndefined();

  });
});

describe("context layers", () => {
  const chain = [{ name: "acme", via: "remote" as const }, { name: "acme-web", via: "parent" as const }];
  test("team then me, outer then inner, between global and repo", () => {
    expect(layerOrder(chain)).toEqual(["global", "context:acme", "context:acme:me", "context:acme-web", "context:acme-web:me", "repo", "user-repo", "local"]);
  });
  test("paths sit under ~/.agents/contexts/<ctx>/<component>/", () => {
    const repo = { checkout: null, root: null, identity: null, identitySource: null, registered: false, alias: null };
    expect(layerPath("atlassian", "context:acme", repo, "/h")).toBe("/h/.agents/contexts/acme/atlassian/config.json");
    expect(layerPath("atlassian", "context:acme:me", repo, "/h")).toBe("/h/.agents/contexts/acme/atlassian/config.me.json");
  });
  test("parseLayer accepts the fixed four and context:<name>[:me], nothing else", () => {
    expect(parseLayer("context:acme:me")).toBe("context:acme:me");
    expect(() => parseLayer("context:")).toThrow();
    expect(() => parseLayer("team")).toThrow();
  });
  test("a malformed context layer is an error, never another layer", () => {
    const repo = { checkout: "/r", root: "/r", identity: null, identitySource: null, registered: false, alias: null };
    for (const layer of ["context:a:b", "context:..", "context:foo:me:me", "context:", "context::me"]) {
      expect(() => layerPath("x", layer as Layer, repo, "/h")).toThrow(ConfigError);
    }
    expect(layerPath("x", "context:me", repo, "/h")).toBe("/h/.agents/contexts/me/x/config.json");
    expect(layerPath("x", "context:me:me", repo, "/h")).toBe("/h/.agents/contexts/me/x/config.me.json");
  });
  test("an atomic write leaves no temp file behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "acs-atomic-"));
    writeFileAtomic(join(dir, "a.json"), "{}\n");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });
});
