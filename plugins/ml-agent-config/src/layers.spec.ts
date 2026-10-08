// One layer's own value for a key, as `describe` reports it per level.

import { describe, expect, test } from "bun:test";
import { ownValueAt } from "./layers";

describe("a layer's own value for a key", () => {
  test("a null on a parent blocks the key, as the merge does", () => {
    expect(ownValueAt({ foo: null }, "foo.bar")).toBeNull();
  });

  test("a value, a null on the key, and nothing at all read as they are", () => {
    expect(ownValueAt({ foo: { bar: 1 } }, "foo.bar")).toBe(1);
    expect(ownValueAt({ foo: { bar: null } }, "foo.bar")).toBeNull();
    expect(ownValueAt({ foo: {} }, "foo.bar")).toBeUndefined();
    expect(ownValueAt({}, "foo.bar")).toBeUndefined();
    expect(ownValueAt({ foo: 3 }, "foo.bar")).toBeUndefined();
  });
});
