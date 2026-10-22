import { expect, test } from "bun:test";
import { readDescribe, suggestContext } from "./panel";

const HOME = "/Users/someone";

test("a repo suggests a context for the folder that holds it and for its owner on the remote", () => {
  const here = { cwd: `${HOME}/git/acme/web/src`, root: `${HOME}/git/acme/web`, remotes: ["github.com/acme/web"], home: HOME };
  expect(suggestContext(here)).toEqual({ name: "acme", path: "~/git/acme/", remote: "github.com/acme/**" });
});
test("outside a repo the folder itself is suggested, with no remote", () => {
  const here = { cwd: `${HOME}/git/beta`, root: null, remotes: [], home: HOME };
  expect(suggestContext(here)).toEqual({ name: "beta", path: "~/git/beta/", remote: "" });
});
test("a nested group keeps every level of its remote but the repo's own", () => {
  const here = { cwd: "/srv/x/infra", root: "/srv/x/infra", remotes: ["gitlab.example.com/acme/chain/infra"], home: HOME };
  expect(suggestContext(here)).toEqual({ name: "x", path: "/srv/x/", remote: "gitlab.example.com/acme/chain/**" });
});
test("describe's place is read as where the pane runs; a CLI that sends none leaves it unknown", () => {
  const answer = { name: "demo", keys: [], layers: [], repo: { checkout: null, root: null }, place: { cwd: `${HOME}/git/beta`, paths: [], remotes: [] } };
  expect(readDescribe(JSON.stringify(answer), HOME, "demo").here).toEqual({ cwd: `${HOME}/git/beta`, root: null, remotes: [], home: HOME });
  const { place: _, ...older } = answer;
  expect(readDescribe(JSON.stringify(older), HOME, "demo").here).toBeNull();
});
