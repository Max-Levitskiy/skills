import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { placeOf } from "./place";

const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd });

function repoWith(remotes: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "acs-place-"));
  git(dir, "init", "-q");
  for (const [name, url] of Object.entries(remotes)) git(dir, "remote", "add", name, url);
  return dir;
}

describe("the current place", () => {
  test("every remote is normalised to host/path", () => {
    const dir = repoWith({ origin: "git@github.com:me/web-app.git", upstream: "https://user@GitHub.com:443/acme/web-app" });
    expect(placeOf(dir).remotes.sort()).toEqual(["github.com/acme/web-app", "github.com/me/web-app"]);
  });
  test("paths carry the checkout root with a trailing slash, in symlinked and real form", () => {
    const real = repoWith({});
    const link = join(mkdtempSync(join(tmpdir(), "acs-link-")), "acme");
    symlinkSync(real, link);
    const { paths } = placeOf(link);
    expect(paths).toContain(`${link}/`);
    expect(paths).toContain(`${realpathSync(real)}/`);
  });
  test("a linked worktree reports the main root too", () => {
    const main = repoWith({});
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(mkdtempSync(join(tmpdir(), "acs-wt-")), "fix");
    git(main, "worktree", "add", "-q", wt);
    expect(placeOf(wt).paths).toContain(`${realpathSync(main)}/`);
  });
  test("outside git: cwd only, no remotes", () => {
    const dir = mkdtempSync(join(tmpdir(), "acs-plain-"));
    mkdirSync(join(dir, "docs"));
    const place = placeOf(join(dir, "docs"));
    expect(place.remotes).toEqual([]);
    expect(place.paths).toContain(`${join(dir, "docs")}/`);
  });
});
