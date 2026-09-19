// bun test scripts/lib/config.test.ts
//
// Covers the Skill Config Standard contract: layer precedence, deep-merge
// semantics, and the inference that lets a user write three keys instead of ten.

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

let home: string;
let repo: string;
let originalHome: string | undefined;
let originalCwd: string;

/** Fresh HOME and a fresh git repo per test, so layers never leak between them. */
beforeEach(() => {
  originalHome = process.env.HOME;
  originalCwd = process.cwd();
  home = mkdtempSync(join(tmpdir(), "scs-home-"));
  repo = mkdtempSync(join(tmpdir(), "scs-repo-"));
  process.env.HOME = home;
  spawnSync("git", ["init", "-q"], { cwd: repo });
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome) process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function writeConfig(layer: "global" | "repo" | "local", body: unknown) {
  const dir = layer === "global" ? join(home, ".agents/skill-config/atlassian") : join(repo, ".agents/skill-config/atlassian");
  mkdirSync(dir, { recursive: true });
  const file = layer === "local" ? "config.local.json" : "config.json";
  writeFileSync(join(dir, file), JSON.stringify(body, null, 2));
}

/** Imported fresh each time: the module reads HOME at call time, not import time. */
async function load() {
  const mod = await import("./config");
  return mod.loadConfig();
}

describe("layering", () => {
  test("works with only the global layer", async () => {
    writeConfig("global", { version: 1, jira: { baseUrl: "https://acme.atlassian.net" } });
    const { config, found } = await load();
    expect(config.jira?.baseUrl).toBe("https://acme.atlassian.net");
    expect(found.map((f) => f.layer)).toEqual(["global"]);
  });

  test("repo overrides global, local overrides repo", async () => {
    writeConfig("global", { jira: { baseUrl: "https://global.atlassian.net", defaultProject: "GLB" } });
    writeConfig("repo", { jira: { defaultProject: "REPO" } });
    writeConfig("local", { jira: { defaultProject: "LOCAL" } });
    const { config, found } = await load();
    expect(config.jira?.defaultProject).toBe("LOCAL");
    // Objects merge key by key: the URL from global survives.
    expect(config.jira?.baseUrl).toBe("https://global.atlassian.net");
    expect(found.map((f) => f.layer)).toEqual(["global", "repo", "local"]);
  });

  test("explicit null deletes an inherited key", async () => {
    writeConfig("global", { jira: { baseUrl: "https://acme.atlassian.net", defaultProject: "GLB" } });
    writeConfig("local", { jira: { defaultProject: null } });
    const { config } = await load();
    expect(config.jira?.defaultProject).toBeUndefined();
    expect("defaultProject" in (config.jira ?? {})).toBe(false);
  });

  test("credentials replace rather than blend when a layer redefines them", async () => {
    writeConfig("global", { credentials: { token: { source: "1password", ref: "op://a/b/c" } } });
    writeConfig("local", { credentials: { token: { source: "env", var: "JIRA_TOKEN" } } });
    const { config } = await load();
    // Deep merge is key-by-key, so a source swap must not leave the old `ref`
    // behind — validate() would then pass on a reference that can't resolve.
    expect(config.credentials?.token?.source).toBe("env");
    expect(config.credentials?.token?.var).toBe("JIRA_TOKEN");
  });

  test("a malformed layer names the file rather than throwing a parse error", async () => {
    mkdirSync(join(home, ".agents/skill-config/atlassian"), { recursive: true });
    writeFileSync(join(home, ".agents/skill-config/atlassian/config.json"), "{ nope");
    await expect(load()).rejects.toThrow(/config\.json is not valid JSON/);
  });
});

describe("inference", () => {
  test("atlassian.net is cloud, anything else is server", async () => {
    const { inferDeployment } = await import("./config");
    expect(inferDeployment("https://acme.atlassian.net")).toBe("cloud");
    expect(inferDeployment("https://jira.internal.bank.ae")).toBe("server");
    expect(inferDeployment("not a url")).toBe("server");
  });

  test("cloud defaults to basic auth, server to bearer", async () => {
    const { resolveProduct } = await import("./config");
    const cloud = resolveProduct(
      {
        jira: { baseUrl: "https://acme.atlassian.net" },
        auth: { email: "me@acme.com" },
        credentials: { token: { source: "env", var: "T" } },
      },
      "jira",
    );
    expect(cloud.deployment).toBe("cloud");
    expect(cloud.authMode).toBe("basic");

    const server = resolveProduct(
      { jira: { baseUrl: "https://jira.corp.local" }, credentials: { token: { source: "env", var: "T" } } },
      "jira",
    );
    expect(server.deployment).toBe("server");
    expect(server.authMode).toBe("bearer");
  });

  test("confluence cloud inherits the jira host and gains /wiki", async () => {
    const { resolveProduct } = await import("./config");
    const site = resolveProduct(
      {
        jira: { baseUrl: "https://acme.atlassian.net" },
        auth: { email: "me@acme.com" },
        credentials: { token: { source: "env", var: "T" } },
      },
      "confluence",
    );
    expect(site.baseUrl).toBe("https://acme.atlassian.net/wiki");
  });

  test("an explicit confluence URL already ending in /wiki is not doubled", async () => {
    const { resolveProduct } = await import("./config");
    const site = resolveProduct(
      {
        confluence: { baseUrl: "https://acme.atlassian.net/wiki/" },
        auth: { email: "me@acme.com" },
        credentials: { token: { source: "env", var: "T" } },
      },
      "confluence",
    );
    expect(site.baseUrl).toBe("https://acme.atlassian.net/wiki");
  });

  test("a product-specific token wins over the shared one", async () => {
    const { resolveProduct } = await import("./config");
    const site = resolveProduct(
      {
        confluence: { baseUrl: "https://wiki.corp.local" },
        credentials: {
          token: { source: "env", var: "SHARED" },
          confluenceToken: { source: "env", var: "CONF" },
        },
      },
      "confluence",
    );
    expect(site.credential.var).toBe("CONF");
    expect(site.credentialKey).toBe("credentials.confluenceToken");
  });
});

describe("validate", () => {
  test("reports every missing piece at once", async () => {
    const { validate } = await import("./config");
    expect(validate({}, "jira")).toEqual(["jira.baseUrl is not set", "credentials.token is not set"]);
  });

  test("basic auth without an email is caught before the 401", async () => {
    const { validate } = await import("./config");
    const problems = validate(
      { jira: { baseUrl: "https://acme.atlassian.net" }, credentials: { token: { source: "env", var: "T" } } },
      "jira",
    );
    expect(problems.join(" ")).toContain("auth.email is required");
  });

  test("bearer auth on a server host needs no email", async () => {
    const { validate } = await import("./config");
    expect(
      validate({ jira: { baseUrl: "https://jira.corp.local" }, credentials: { token: { source: "env", var: "T" } } }, "jira"),
    ).toEqual([]);
  });

  test("an incomplete credential reference names the missing field", async () => {
    const { validate } = await import("./config");
    const problems = validate(
      { jira: { baseUrl: "https://jira.corp.local" }, credentials: { token: { source: "1password" } as any } },
      "jira",
    );
    expect(problems).toEqual(['credentials.token.ref is required for source "1password"']);
  });

  test("confluence cannot silently inherit an on-prem jira host", async () => {
    const { validate } = await import("./config");
    const problems = validate(
      { jira: { baseUrl: "https://jira.corp.local" }, credentials: { token: { source: "env", var: "T" } } },
      "confluence",
    );
    // On-prem Jira and Confluence are separate systems on separate hosts.
    expect(problems.join(" ")).toContain("confluence.baseUrl is not set");
  });
});

describe("gitignore", () => {
  test("adds the local pattern once and is idempotent", async () => {
    const { ensureGitignored, LOCAL_GITIGNORE_PATTERN } = await import("./config");
    const first = ensureGitignored();
    expect(first.added).toBe(true);
    const second = ensureGitignored();
    expect(second.added).toBe(false);
    const contents = await Bun.file(join(repo, ".gitignore")).text();
    expect(contents.split("\n").filter((l) => l.trim() === LOCAL_GITIGNORE_PATTERN)).toHaveLength(1);
  });
});
