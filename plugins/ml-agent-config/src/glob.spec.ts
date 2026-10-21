import { describe, expect, test } from "bun:test";
import { compileGlob } from "./glob";

describe("git-style globs", () => {
  test("* stays inside one segment, ** crosses", () => {
    const org = compileGlob("github.com/acme/*", { anchored: "remote" });
    expect(org("github.com/acme/web-app")).toBe(true);
    expect(org("github.com/acme/platform/web")).toBe(false);
    expect(compileGlob("gitlab.example.com/acme/**", { anchored: "remote" })("gitlab.example.com/acme/platform/web")).toBe(true);
  });
  test("a path pattern without ~/, ./ or / is prefixed with **/", () => {
    expect(compileGlob("acme/", { anchored: "path", home: "/h" })("/x/y/acme/sub/")).toBe(true);
  });
  test("a trailing slash means everything under it, including the directory itself", () => {
    const g = compileGlob("~/git/acme/", { anchored: "path", home: "/h" });
    expect(g("/h/git/acme/")).toBe(true);
    expect(g("/h/git/acme/web/")).toBe(true);
    expect(g("/h/git/acme-other/")).toBe(false);
  });
  test("/i makes it case-insensitive", () => {
    expect(compileGlob("GitHub.com/ACME/**", { anchored: "remote", ignoreCase: true })("github.com/acme/x")).toBe(true);
    expect(compileGlob("GitHub.com/ACME/**", { anchored: "remote" })("github.com/acme/x")).toBe(false);
  });
});
