// What `describe` reports for one key: each layer's own value, and the one in effect.

import { describe, expect, test } from "bun:test";
import { withLevels } from "./cli";
import type { DescribedKey } from "./types";

const key = (source: DescribedKey["source"], value: DescribedKey["value"]): DescribedKey => ({
  path: "foo",
  description: "Foo",
  layer: null,
  default: null,
  credential: false,
  group: null,
  required: false,
  value,
  source,
  levels: {},
  problems: [],
});

describe("a key's levels and source", () => {
  test("an object a higher layer sets wins over a lower layer's scalar, whatever stale provenance says", () => {
    const own = [
      { layer: "global" as const, config: { foo: "old" } },
      { layer: "local" as const, config: { foo: { bar: "new" } } },
    ];
    const described = withLevels(key("global", { bar: "new" }), own);
    expect(described.source).toBe("local");
    expect(described.levels).toEqual({ global: "old", local: { bar: "new" } });
  });

  test("a top layer that blocks leaves the default in effect, or nothing", () => {
    const own = [
      { layer: "global" as const, config: { foo: "x" } },
      { layer: "repo" as const, config: { foo: null } },
    ];
    expect(withLevels(key("default", "d"), own).source).toBe("default");
    expect(withLevels(key("global", null), own).source).toBeNull();
  });

  test("no layer sets it: the source stays what the merge said", () => {
    expect(withLevels(key("default", "d"), [{ layer: "global" as const, config: {} }]).source).toBe("default");
  });
});
