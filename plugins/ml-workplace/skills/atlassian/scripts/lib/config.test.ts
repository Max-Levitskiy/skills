// bun test scripts/lib/config.test.ts
//
// Config comes from the agent-config CLI (ACS v2), so these tests run the real one from this
// checkout against a sandboxed HOME and a throwaway git repo: what the declaration requires, how
// layers merge, the declared defaults reading as unset, adopting a v1 file, and a secret arriving
// on fd 3. The inference that turns a few keys into a usable site is plain functions, tested as such.

import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { spawnSync } from "child_process";

const AGENT_CONFIG_ROOT = resolve(import.meta.dir, "../../../../../ml-agent-config");
const SKILL_DIR = resolve(import.meta.dir, "../..");

let home: string;
let repo: string;
let saved: Record<string, string | undefined>;
let originalCwd: string;

/** Fresh HOME and a fresh git repo per test, so layers never leak between them. */
beforeEach(() => {
  saved = { HOME: process.env.HOME, AGENT_CONFIG_ROOT: process.env.AGENT_CONFIG_ROOT };
  originalCwd = process.cwd();
  home = mkdtempSync(join(tmpdir(), "acs-home-"));
  repo = mkdtempSync(join(tmpdir(), "acs-repo-"));
  process.env.HOME = home;
  process.env.AGENT_CONFIG_ROOT = AGENT_CONFIG_ROOT;
  spawnSync("git", ["init", "-q"], { cwd: repo });
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

/** Writes go through `agent-config write`, the only path the skill itself uses. */
function write(layer: "global" | "repo" | "local", body: unknown) {
  const result = spawnSync(
    join(AGENT_CONFIG_ROOT, "bin", "agent-config"),
    ["write", "atlassian", "--layer", layer, "--from", SKILL_DIR],
    { input: JSON.stringify(body), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`write ${layer} failed: ${result.stderr}`);
}

const SERVER = {
  jira: { baseUrl: "https://jira.corp.local", deployment: "server" },
  credentials: { token: { source: "env", var: "ATL_TEST_TOKEN" } },
};

describe("the declaration", () => {
  test("an empty HOME asks for the site, its deployment and the token, and nothing else", async () => {
    const { startPlan } = await import("./config");
    const plan = startPlan();
    expect(plan.ready).toBe(false);
    expect(plan.actions.map((action) => action.id)).toEqual(["onboard"]);
    expect(plan.actions[0].keys).toEqual(["jira.baseUrl", "jira.deployment", "credentials.token"]);
  });

  test("a Cloud site also needs the account email", async () => {
    write("global", { ...SERVER, jira: { baseUrl: "https://acme.atlassian.net", deployment: "cloud" } });
    const { startPlan } = await import("./config");
    const plan = startPlan();
    expect(plan.ready).toBe(false);
    expect(plan.actions[0].keys).toEqual(["auth.email"]);
  });

  test("a Data Center site with a token is ready", async () => {
    write("global", SERVER);
    const { startPlan } = await import("./config");
    expect(startPlan().ready).toBe(true);
  });

  test("a v1 file at the old path is adopted before anything is asked", async () => {
    mkdirSync(join(home, ".agents/skill-config/atlassian"), { recursive: true });
    writeFileSync(join(home, ".agents/skill-config/atlassian/config.json"), JSON.stringify(SERVER));
    const { startPlan } = await import("./config");
    const plan = startPlan();
    expect(plan.actions[0].id).toBe("agent-config:adopt");
  });
});

describe("layering", () => {
  test("repo overrides global, local overrides repo", async () => {
    write("global", { ...SERVER, jira: { ...SERVER.jira, defaultProject: "GLB" } });
    write("repo", { jira: { defaultProject: "REPO" } });
    write("local", { jira: { defaultProject: "LOCAL" } });
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config.jira?.defaultProject).toBe("LOCAL");
    // Objects merge key by key: the URL from global survives.
    expect(config.jira?.baseUrl).toBe("https://jira.corp.local");
  });

  test("explicit null deletes an inherited key", async () => {
    write("global", { ...SERVER, jira: { ...SERVER.jira, defaultProject: "GLB" } });
    write("local", { jira: { defaultProject: null } });
    const { loadConfig } = await import("./config");
    expect(loadConfig().jira?.defaultProject).toBeUndefined();
  });

  test("declared defaults of empty and auto read as unset, so inference still runs", async () => {
    write("global", SERVER);
    const { loadConfig } = await import("./config");
    const config = loadConfig();
    expect(config.confluence?.baseUrl).toBeUndefined();
    expect(config.confluence?.deployment).toBeUndefined();
    expect(config.auth?.mode).toBeUndefined();
    expect(config.defaultScope).toBeUndefined();
    expect(config.safety).toEqual({ readOnly: false, allowDelete: true, allowPurge: true });
  });

  test("a value the declaration refuses is not written", () => {
    expect(() => write("global", { jira: { deployment: "bogus" } })).toThrow(/should be one of/);
  });
});

describe("secrets", () => {
  test("a token arrives through fd 3 of agent-config load", async () => {
    write("global", SERVER);
    process.env.ATL_TEST_TOKEN = "fake-test-token";
    try {
      const { loadConfig, resolveProduct } = await import("./config");
      const site = resolveProduct(loadConfig(), "jira");
      expect(await site.secret()).toBe("fake-test-token");
    } finally {
      delete process.env.ATL_TEST_TOKEN;
    }
  });

  test("an unresolvable reference fails with exit 3, naming it", async () => {
    // A per-product override: undeclared, so it rides through `load` untouched. (A key other than
    // credentials.token, because loadSecret caches each key for the life of the process.)
    write("global", { ...SERVER, credentials: { ...SERVER.credentials, confluenceToken: { source: "env", var: "ATL_TEST_UNSET" } } });
    const { loadSecret } = await import("./config");
    await expect(loadSecret("credentials.confluenceToken")).rejects.toMatchObject({
      exitCode: 3,
      message: expect.stringContaining("ATL_TEST_UNSET"),
    });
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
