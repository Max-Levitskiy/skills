import { expect, test } from "bun:test";
import { readContextList, readDescribe, readExplainHere, suggestContext } from "./panel";

const HOME = "/Users/someone";

test("a repo suggests a context for the folder that holds it and for its owner on the remote", () => {
  const here = { cwd: `${HOME}/git/acme/web/src`, root: `${HOME}/git/acme/web`, remotes: ["github.com/acme/web"], home: HOME };
  expect(suggestContext(here)).toEqual({ name: "acme", parent: null, paths: ["~/git/acme/"], remotes: ["github.com/acme/**"] });
});
test("outside a repo the folder itself is suggested, with no remote", () => {
  const here = { cwd: `${HOME}/git/beta`, root: null, remotes: [], home: HOME };
  expect(suggestContext(here)).toEqual({ name: "beta", parent: null, paths: ["~/git/beta/"], remotes: [] });
});
test("a nested group keeps every level of its remote but the repo's own", () => {
  const here = { cwd: "/srv/x/infra", root: "/srv/x/infra", remotes: ["gitlab.example.com/acme/chain/infra"], home: HOME };
  expect(suggestContext(here)).toEqual({ name: "x", parent: null, paths: ["/srv/x/"], remotes: ["gitlab.example.com/acme/chain/**"] });
});
test("describe's place is read as where the pane runs; a CLI that sends none leaves it unknown", () => {
  const answer = { name: "demo", keys: [], layers: [], repo: { checkout: null, root: null }, place: { cwd: `${HOME}/git/beta`, paths: [], remotes: [] } };
  expect(readDescribe(JSON.stringify(answer), HOME, "demo").here).toEqual({ cwd: `${HOME}/git/beta`, root: null, remotes: [], home: HOME });
  const { place: _, ...older } = answer;
  expect(readDescribe(JSON.stringify(older), HOME, "demo").here).toBeNull();
});
test("context list is read as each context's globs, an ignore-case one included", () => {
  const listed = {
    contexts: [
      { name: "acme", parent: null, team: [{ remote: "github.com/acme/**" }, { remote: "gitlab.com/ACME/**", ignoreCase: true }], me: [{ path: "~/git/acme/" }], matched: true, components: ["demo"] },
      { name: "beta", parent: "acme", team: [], me: [], matched: false },
    ],
  };
  expect(readContextList(JSON.stringify(listed))).toEqual([
    { name: "acme", parent: null, remotes: ["github.com/acme/**", "gitlab.com/ACME/**"], paths: ["~/git/acme/"], matched: true, components: ["demo"] },
    { name: "beta", parent: "acme", remotes: [], paths: [], matched: false, components: [] },
  ]);
});
test("context explain gives the place and the repo's root, for a new context opened from the Contexts tab", () => {
  const explained = { place: { cwd: `${HOME}/git/acme/web`, paths: [], remotes: ["github.com/acme/web"] }, repo: { root: `${HOME}/git/acme/web` } };
  expect(suggestContext(readExplainHere(JSON.stringify(explained), HOME)!)).toEqual({ name: "acme", parent: null, paths: ["~/git/acme/"], remotes: ["github.com/acme/**"] });
});
