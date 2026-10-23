import { expect, test } from "bun:test";
import { canHold, chainLine, chainRows, chainState, effect, levelInfo, levelStack, pathLine } from "./levels";
import { savedAt } from "../panel";

test("context levels are labelled by context and audience", () => {
  expect(levelInfo("context:acme").label).toBe("Context acme");
  expect(levelInfo("context:acme:me").label).toBe("Context acme, just me");
});
test("the stack follows describe's order, top first", () => {
  const layers = ["global", "context:acme", "context:acme:me", "repo", "user-repo", "local"];
  const setting = { levels: { global: 1, "context:acme:me": 2 }, source: "context:acme:me" } as any;
  expect(levelStack(setting, layers).map(r => r.layer)).toEqual([...layers].reverse());
  expect(levelStack(setting, layers).find(r => r.isWinner)!.layer).toBe("context:acme:me");
});
test("a credential or a personal key cannot be held by a team context level, and a credential by no repo level", () => {
  const layers = ["global", "context:acme", "context:acme:me", "repo", "user-repo", "local"];
  const plain = { levels: {}, source: null, credential: false, personal: false } as any;
  const personal = { ...plain, personal: true };
  const credential = { ...plain, credential: true };
  expect(layers.filter(l => canHold(plain, l))).toEqual(layers);
  expect(layers.filter(l => canHold(personal, l))).toEqual(layers.filter(l => l !== "context:acme"));
  expect(canHold(credential, "context:acme")).toBe(false);
  expect(canHold(credential, "context:acme:me")).toBe(true);
  expect(canHold(credential, "repo")).toBe(false);
  expect(canHold(personal, "repo")).toBe(true);
  expect(canHold(credential, "local")).toBe(true);
  expect(layers.filter(l => canHold(credential, l))).toEqual(["global", "context:acme:me", "user-repo", "local"]);
});
test("the context chain reads outermost first, each with why it applies", () => {
  expect(chainLine([{ name: "acme", via: "remote" }, { name: "acme-web", via: "parent" }])).toBe("acme (remote) › acme-web (parent)");
  expect(chainLine([])).toBe("none apply here");
});
test("a level the pane does not know reads without a dangling separator", () => {
  expect(levelInfo("workspace")).toMatchObject({ hint: "another level", audience: "at this level" });
  const setting = { levels: {}, source: null, default: null, credential: false, personal: false, schema: null } as any;
  expect(effect(setting, "workspace", ["global", "workspace"], {}, {})).toBe("Saving here sets it at this level.");
});

const LAYERS = ["global", "repo", "user-repo", "local"];
const plainKey = (levels: Record<string, unknown>, source: string | null, value: unknown, extra: object = {}) =>
  ({ path: "site.url", levels, source, value, default: null, credential: false, personal: false, schema: null, ...extra }) as any;

test("each step of the chain says what became of its value", () => {
  const setting = plainKey({ global: "beta", "user-repo": "acme" }, "user-repo", "acme");
  const rows = chainRows(setting, LAYERS);
  expect(rows.map(r => r.layer)).toEqual(["local", "user-repo", "repo", "global"]);
  expect(rows.map(chainState)).toEqual(["", "wins", "", "overridden by Repo, just me"]);
});
test("a block hides the steps under it, and a team level for a credential is shown but not offered", () => {
  const setting = plainKey({ global: "beta", repo: null }, "default", "gamma", { default: "gamma" });
  expect(chainRows(setting, LAYERS).map(chainState)).toEqual(["", "", "hides the levels under it", "hidden by the block at Repo, shared"]);
  const credential = plainKey({}, null, null, { credential: true });
  expect(chainRows(credential, LAYERS).filter(r => !r.canHold).map(r => r.layer)).toEqual(["repo"]);
});
test("the path line lists the value in effect and every value it overrides, top first", () => {
  expect(pathLine(plainKey({ global: "beta", "user-repo": "acme" }, "user-repo", "acme"), LAYERS, {}, {})).toBe(
    "acme · Repo, just me ← beta (Everywhere)",
  );
  expect(pathLine(plainKey({ global: "beta" }, "global", "beta", { default: "gamma" }), LAYERS, {}, {})).toBe("beta · Everywhere ← gamma (default)");
  expect(pathLine(plainKey({}, "default", "gamma", { default: "gamma" }), LAYERS, {}, {})).toBe("gamma · default");
  expect(pathLine(plainKey({ global: "beta", repo: null, local: "acme" }, "local", "acme", { default: "gamma" }), LAYERS, {}, {})).toBe("acme · This checkout");
});
test("the saved message says what the save does to the value in effect", () => {
  const setting = plainKey({ global: "beta", local: "delta" }, "local", "delta");
  expect(savedAt(setting, "user-repo", "acme", LAYERS, {}, {})).toBe("Saved site.url in Repo, just me, but This checkout overrides it.");
  const open = plainKey({ global: "beta" }, "global", "beta");
  expect(savedAt(open, "user-repo", "acme", LAYERS, {}, {})).toBe("Saved site.url in Repo, just me: it overrides beta from Everywhere.");
  expect(savedAt(plainKey({ global: "beta", "user-repo": "acme" }, "user-repo", "acme"), "user-repo", undefined, LAYERS, {}, {})).toBe(
    "Removed site.url from Repo, just me: beta from Everywhere applies now.",
  );
});
