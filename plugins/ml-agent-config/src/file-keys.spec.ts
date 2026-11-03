// A `file` key: config replaces a whole file the component ships.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { effectiveConfig, unmetKeys } from "./effective";
import { resolveFileKey } from "./file-keys";
import type { Declaration } from "./declaration";

let root: string;
const declaration: Declaration = {
  version: 2,
  name: "t",
  schema: { keys: { graph: { description: "The graph", default: "default.dot", type: "string", file: true } } },
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "file-key-")));
  mkdirSync(join(root, "component"));
  writeFileSync(join(root, "component", "default.dot"), "digraph d {}");
  mkdirSync(join(root, "layer"));
  writeFileSync(join(root, "layer", "mine.dot"), "digraph m {}");
  writeFileSync(join(root, "secret"), "s");
  symlinkSync(join(root, "secret"), join(root, "layer", "link.dot"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const fromLayer = (value: string, trusted: boolean) =>
  effectiveConfig(
    declaration,
    {
      config: { graph: value },
      provenance: { graph: "repo" },
      files: [{ layer: "repo", path: join(root, "layer", "config.json"), trusted }],
    },
    join(root, "component"),
  );

describe("a file key", () => {
  test("its default resolves against the declaration's folder", () => {
    const effective = effectiveConfig(declaration, { config: {}, provenance: {}, files: [] }, join(root, "component"));
    expect(effective.config.graph).toBe(join(root, "component", "default.dot"));
    expect(unmetKeys(effective)).toEqual([]);
  });

  test("a layer's relative path resolves against that layer's folder", () => {
    expect(fromLayer("mine.dot", false).config.graph).toBe(join(root, "layer", "mine.dot"));
  });

  test("a file that is not there leaves the key unmet, and no plain path reaches the consumer", () => {
    const effective = fromLayer("gone.dot", true);
    expect(unmetKeys(effective)).toEqual(["graph"]);
    expect(effective.problems[0]?.code).toBe("invalid-value");
    expect(effective.problems[0]?.message).toContain("does not exist");
  });

  test("a layer someone else wrote cannot leave its folder, by path, by symlink or absolutely", () => {
    for (const value of ["../secret", "link.dot", join(root, "secret")]) {
      expect(unmetKeys(fromLayer(value, false))).toEqual(["graph"]);
    }
  });

  test("a layer you wrote can point anywhere, and ~ is home", () => {
    expect(fromLayer("../secret", true).config.graph).toBe(join(root, "secret"));
    expect(resolveFileKey("graph", "~/secret", { base: "/nowhere", trusted: true }, root)).toEqual({ path: join(root, "secret") });
  });

  test("a folder is not a file", () => {
    expect(resolveFileKey("graph", root, { base: root, trusted: true })).toEqual({ problem: `graph: ${root} is not a file` });
  });
});
