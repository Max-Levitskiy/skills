// bun test scripts/lib/scope.test.ts
//
// Scoping narrows what the user sees. A bug here doesn't throw — it quietly
// returns a subset and looks like a complete answer, so the composition rules
// get tested directly.

import { expect, test, describe } from "bun:test";
import {
  andJql,
  checkSafety,
  isWriteCommand,
  listScopes,
  pickScope,
  resolveFieldId,
  resolvePerson,
  scopeCql,
  scopeForIssueKey,
  scopeJql,
} from "./scope";
import type { AtlassianConfig } from "./config";

const cfg: AtlassianConfig = {
  defaultScope: "neochain",
  scopes: {
    neochain: {
      label: "NeoChain",
      jira: { projects: ["NEO", "NEOINF"], defaultIssueType: "Task", labels: ["neochain"], board: 42 },
      confluence: { space: "NEO", parentPage: "98765" },
    },
    adi: {
      label: "ADI Chain",
      jira: { projects: ["ADI"], jqlFilter: "labels = adi" },
      confluence: { space: "ADI", cqlFilter: 'label = "adi"' },
    },
  },
  fields: { points: "customfield_10016", epic: "customfield_10014" },
  people: { dana: "acc-dana-1" },
};

describe("picking a scope", () => {
  test("falls back to defaultScope", () => {
    expect(pickScope(cfg)?.name).toBe("neochain");
  });

  test("an explicit name wins", () => {
    expect(pickScope(cfg, "adi")?.name).toBe("adi");
  });

  test('"none" disables scoping for one call', () => {
    expect(pickScope(cfg, "none")).toBeNull();
  });

  test("no scopes configured means no scoping, not an error", () => {
    expect(pickScope({})).toBeNull();
  });

  test("an unknown name lists the ones that exist", () => {
    expect(() => pickScope(cfg, "typo")).toThrow(/Configured scopes: neochain, adi/);
  });

  test("listScopes returns every configured stream", () => {
    expect(listScopes(cfg).map((s) => s.name)).toEqual(["neochain", "adi"]);
  });
});

describe("JQL composition", () => {
  test("adds the project clause when the query doesn't constrain one", () => {
    const { query, applied } = scopeJql("status != Done", cfg.scopes!.neochain);
    expect(query).toBe("status != Done AND project IN (NEO, NEOINF)");
    expect(applied).toEqual(["project IN (NEO, NEOINF)"]);
  });

  test("a single-project scope uses = rather than IN", () => {
    const { query } = scopeJql("status != Done", cfg.scopes!.adi);
    expect(query).toContain("project = ADI");
  });

  test("leaves an explicit project alone — the user was specific", () => {
    const { query, applied } = scopeJql("project = OTHER AND status = Open", cfg.scopes!.neochain);
    expect(query).toBe("project = OTHER AND status = Open");
    expect(applied).toEqual([]);
  });

  test("recognises project IN (...) as already constrained", () => {
    const { applied } = scopeJql("project in (A, B)", cfg.scopes!.neochain);
    expect(applied).toEqual([]);
  });

  test("inserts before ORDER BY rather than after it", () => {
    // Appending after ORDER BY is a syntax error, and the obvious way to break this.
    const { query } = scopeJql("status != Done ORDER BY updated DESC", cfg.scopes!.neochain);
    expect(query).toBe("status != Done AND project IN (NEO, NEOINF) ORDER BY updated DESC");
  });

  test("an empty query becomes just the scope clause", () => {
    expect(scopeJql("", cfg.scopes!.adi).query).toBe("project = ADI AND (labels = adi)");
  });

  test("applies a jqlFilter for a scope that is a slice of a shared project", () => {
    const { query, applied } = scopeJql("status = Open", cfg.scopes!.adi);
    expect(query).toBe("status = Open AND project = ADI AND (labels = adi)");
    expect(applied).toHaveLength(2);
  });

  test("does not double-apply a filter the query already contains", () => {
    const { applied } = scopeJql("project = ADI AND labels = adi", cfg.scopes!.adi);
    expect(applied).toEqual([]);
  });

  test("no scope leaves the query untouched", () => {
    expect(scopeJql("project = X", null).query).toBe("project = X");
  });

  test("andJql is ORDER BY aware on its own", () => {
    expect(andJql("a = 1 order by created", "b = 2")).toBe("a = 1 AND b = 2 order by created");
    expect(andJql("", "b = 2")).toBe("b = 2");
  });
});

describe("CQL composition", () => {
  test("adds the space clause ahead of ORDER BY", () => {
    const { query, applied } = scopeCql('text ~ "x" AND type = "page" ORDER BY lastmodified DESC', cfg.scopes!.neochain);
    expect(query).toBe('text ~ "x" AND type = "page" AND space = "NEO" ORDER BY lastmodified DESC');
    expect(applied).toEqual(['space = "NEO"']);
  });

  test("leaves an explicit space alone", () => {
    const { applied } = scopeCql('space = "OTHER" AND text ~ "x"', cfg.scopes!.neochain);
    expect(applied).toEqual([]);
  });

  test("applies a cqlFilter as well as the space", () => {
    const { query } = scopeCql('text ~ "x"', cfg.scopes!.adi);
    expect(query).toBe('text ~ "x" AND space = "ADI" AND (label = "adi")');
  });
});

describe("issue key → scope", () => {
  test("maps a prefix to the scope that owns it", () => {
    expect(scopeForIssueKey(cfg, "NEOINF-12")?.name).toBe("neochain");
    expect(scopeForIssueKey(cfg, "ADI-4")?.name).toBe("adi");
  });

  test("is case-insensitive and tolerates an unknown prefix", () => {
    expect(scopeForIssueKey(cfg, "neo-1")?.name).toBe("neochain");
    expect(scopeForIssueKey(cfg, "XYZ-1")).toBeNull();
  });
});

describe("aliases", () => {
  test("field aliases resolve, unknown names pass through", () => {
    expect(resolveFieldId(cfg, "points")).toBe("customfield_10016");
    expect(resolveFieldId(cfg, "Points")).toBe("customfield_10016"); // case-insensitive fallback
    expect(resolveFieldId(cfg, "customfield_99")).toBe("customfield_99");
    expect(resolveFieldId(cfg, "summary")).toBe("summary");
  });

  test("people aliases resolve to an id", () => {
    expect(resolvePerson(cfg, "dana")).toBe("acc-dana-1");
    expect(resolvePerson(cfg, "someone@else.com")).toBe("someone@else.com");
  });
});

describe("safety", () => {
  test("allows by default", () => {
    expect(checkSafety({}, "delete").allowed).toBe(true);
    expect(checkSafety({}, "purge").allowed).toBe(true);
  });

  test("allowDelete false blocks deletion and says why", () => {
    const verdict = checkSafety({ safety: { allowDelete: false } }, "delete");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("safety.allowDelete");
  });

  test("allowPurge false still permits a recoverable trash delete", () => {
    const config = { safety: { allowPurge: false } };
    expect(checkSafety(config, "purge").allowed).toBe(false);
    expect(checkSafety(config, "delete").allowed).toBe(true);
  });

  test("writes are allowed unless readOnly says otherwise", () => {
    expect(checkSafety({}, "write").allowed).toBe(true);
    expect(checkSafety({ safety: { allowDelete: false } }, "write").allowed).toBe(true);
  });

  test("readOnly blocks every action, not just destruction", () => {
    const config = { safety: { readOnly: true } };
    for (const action of ["write", "delete", "purge"] as const) {
      const verdict = checkSafety(config, action);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain("safety.readOnly");
    }
  });
});

describe("isWriteCommand", () => {
  test("classifies known reads as reads", () => {
    for (const sub of ["whoami", "search", "get", "comments", "projects", "fields", "meta", "boards", "sprints"]) {
      expect(isWriteCommand("jira", sub)).toBe(false);
    }
    for (const sub of ["whoami", "spaces", "search", "get", "children", "pages", "attachments", "to-storage"]) {
      expect(isWriteCommand("confluence", sub)).toBe(false);
    }
  });

  test("classifies mutating subcommands as writes", () => {
    for (const sub of ["create", "update", "comment", "transition", "assign", "delete", "link", "attach"]) {
      expect(isWriteCommand("jira", sub)).toBe(true);
    }
    for (const sub of ["create", "update", "append", "delete", "comment", "attach"]) {
      expect(isWriteCommand("confluence", sub)).toBe(true);
    }
  });

  test("an unrecognised subcommand counts as a write, so read-only fails closed", () => {
    expect(isWriteCommand("jira", "some-command-added-later")).toBe(true);
    expect(isWriteCommand("confluence", "some-command-added-later")).toBe(true);
  });

  test("the read lists are per product and do not leak into each other", () => {
    // 'spaces' reads on Confluence but is not a Jira command at all.
    expect(isWriteCommand("jira", "spaces")).toBe(true);
    // 'projects' likewise, in the other direction.
    expect(isWriteCommand("confluence", "projects")).toBe(true);
  });

  test("no subcommand is not a write — bare 'jira' should print usage, not be refused", () => {
    expect(isWriteCommand("jira", undefined)).toBe(false);
  });
});
