// One layer's own value for a key, as `describe` reports it per level.

import { describe, expect, test } from "bun:test";
import { ownValueAt } from "./layers";

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
