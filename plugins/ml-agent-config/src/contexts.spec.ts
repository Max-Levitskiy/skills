import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readContexts, resolveChain } from "./contexts";
import type { Place } from "./place";

function home() {
  const h = mkdtempSync(join(tmpdir(), "acs-ctx-"));
  const put = (name: string, team: object | string, me?: object) => {
    const dir = join(h, ".agents", "contexts", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "context.json"), typeof team === "string" ? team : JSON.stringify(team));
    if (me) writeFileSync(join(dir, "context.me.json"), JSON.stringify(me));
  };
  return { h, put };
}
const place = (over: Partial<Place>): Place => ({ cwd: "/x", paths: ["/x/"], remotes: [], ...over });

describe("contexts", () => {
  test("remote match, parent forced first, child is innermost", () => {
    const { h, put } = home();
    put("acme", { match: [{ remote: "github.com/acme/**" }] });
    put("acme-web", { parent: "acme", match: [{ remote: "github.com/acme/web-*" }] });
    const chain = resolveChain(readContexts(h), place({ remotes: ["github.com/acme/web-app"] }), {});
    expect(chain.map(c => c.name)).toEqual(["acme", "acme-web"]);
  });
  test("a child matching alone still pulls its parent in, via parent", () => {
    const { h, put } = home();
    put("acme", { match: [{ remote: "gitlab.example.com/acme/**" }] });
    put("acme-web", { parent: "acme" }, { match: [{ path: "~/git/web/" }] });
    const chain = resolveChain(readContexts(h), place({ paths: [`${h}/git/web/`] }), {});
    expect(chain.map(c => [c.name, c.via])).toEqual([["acme", "parent"], ["acme-web", "path"]]);
  });
  test("an abstract context never matches but can be named", () => {
    const { h, put } = home();
    put("neo", {});
    expect(resolveChain(readContexts(h), place({}), {})).toEqual([]);
    expect(resolveChain(readContexts(h), place({}), { explicit: "neo" }).map(c => c.name)).toEqual(["neo"]);
  });
  test("a path in the team file is ignored and reported", () => {
    const { h, put } = home();
    put("acme", { match: [{ path: "/x/" }] });
    const store = readContexts(h);
    expect(store.problems.map(p => p.code)).toContain("context-stray-path");
    expect(resolveChain(store, place({}), {})).toEqual([]);
  });
  test("unknown parent and a cycle are config errors", () => {
    const { h, put } = home();
    put("a", { parent: "b", match: [{ remote: "x/**" }] });
    expect(() => resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {})).toThrow(/parent "b"/);
    put("b", { parent: "a" });
    expect(() => resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {})).toThrow(/cycle/);
  });
  test("a directory whose name cannot be a context name is reported and skipped", () => {
    const { h, put } = home();
    put("foo:me", { match: [{ remote: "x/**" }] });
    put("ok", { match: [{ remote: "x/**" }] });
    const store = readContexts(h);
    const problem = store.problems.find(p => p.path?.endsWith("foo:me"));
    expect(problem?.code).toBe("context-unparsable");
    expect(problem?.message).toMatch(/not a valid context name.*colon/);
    expect([...store.defs.keys()]).toEqual(["ok"]);
    expect(resolveChain(store, place({ remotes: ["x/y"] }), {}).map(c => c.name)).toEqual(["ok"]);
  });

  test("an unparsable context is skipped unless something names it", () => {
    const { h, put } = home();
    put("broken", "{ not json");
    put("ok", { match: [{ remote: "x/**" }] });
    const store = readContexts(h);
    expect(store.problems.map(p => p.code)).toContain("context-unparsable");
    expect(resolveChain(store, place({ remotes: ["x/y"] }), {}).map(c => c.name)).toEqual(["ok"]);
    expect(() => resolveChain(store, place({}), { explicit: "broken" })).toThrow(/broken/);
  });
  test("order.json orders roots; an unknown name there is an error", () => {
    const { h, put } = home();
    put("zed", { match: [{ remote: "x/**" }] });
    put("alpha", { match: [{ remote: "x/**" }] });
    writeFileSync(join(h, ".agents", "contexts", "order.json"), JSON.stringify(["zed", "alpha"]));
    expect(resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {}).map(c => c.name)).toEqual(["zed", "alpha"]);
    writeFileSync(join(h, ".agents", "contexts", "order.json"), JSON.stringify(["nope"]));
    expect(() => resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {})).toThrow(/nope/);
  });
});
