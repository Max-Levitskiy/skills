import { expect, test } from "bun:test";
import { canHold, levelInfo, levelStack, openAbove } from "./levels";

test("context levels are labelled by context and audience", () => {
  expect(levelInfo("context:acme").label).toBe("Project acme, shared");
  expect(levelInfo("context:acme:me").label).toBe("Project acme, just me");
});
test("the stack follows describe's order, top first", () => {
  const layers = ["global", "context:acme", "context:acme:me", "repo", "user-repo", "local"];
  const setting = { levels: { global: 1, "context:acme:me": 2 }, source: "context:acme:me" } as any;
  expect(levelStack(setting, layers).map(r => r.layer)).toEqual([...layers].reverse());
  expect(levelStack(setting, layers).find(r => r.isWinner)!.layer).toBe("context:acme:me");
});
test("a credential or a personal key is offered no team context level, and a credential no repo level", () => {
  const layers = ["global", "context:acme", "context:acme:me", "repo", "user-repo", "local"];
  const plain = { levels: {}, source: null, credential: false, personal: false } as any;
  const personal = { ...plain, personal: true };
  const credential = { ...plain, credential: true };
  expect(openAbove(plain, layers)).toEqual(layers);
  expect(openAbove(personal, layers)).toEqual(layers.filter(l => l !== "context:acme"));
  expect(canHold(credential, "context:acme")).toBe(false);
  expect(canHold(credential, "context:acme:me")).toBe(true);
  expect(canHold(credential, "repo")).toBe(false);
  expect(canHold(personal, "repo")).toBe(true);
  expect(canHold(credential, "local")).toBe(true);
  expect(openAbove(credential, layers)).toEqual(["global", "context:acme:me", "user-repo", "local"]);
});
