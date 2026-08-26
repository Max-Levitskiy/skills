// bun test scripts/lib/client.test.ts
//
// Runs both clients against a stub server and asserts the exact requests that
// leave the process. Cloud and Data Center differ in path, payload and auth
// header, and every one of those differences is invisible until a real instance
// rejects it — which is the worst place to find out.

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { HttpClient } from "./http";
import { JiraClient } from "./jira";
import { ConfluenceClient } from "./confluence";
import type { ResolvedProduct } from "./config";

interface Captured {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | null;
  body: any;
}

let server: ReturnType<typeof Bun.serve>;
let captured: Captured[] = [];
let respond: (req: Captured) => { status?: number; body?: unknown; headers?: Record<string, string> } = () => ({ body: {} });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      const entry: Captured = {
        method: req.method,
        path: url.pathname,
        query: url.searchParams,
        auth: req.headers.get("authorization"),
        body: text ? safeJson(text) : undefined,
      };
      captured.push(entry);
      const res = respond(entry);
      return new Response(JSON.stringify(res.body ?? {}), {
        status: res.status ?? 200,
        headers: { "content-type": "application/json", ...(res.headers ?? {}) },
      });
    },
  });
});

afterAll(() => server.stop(true));

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function site(deployment: "cloud" | "server"): ResolvedProduct {
  return {
    product: "jira",
    baseUrl: `http://localhost:${server.port}`,
    deployment,
    authMode: deployment === "cloud" ? "basic" : "bearer",
    email: "me@acme.com",
    credential: { source: "env", var: "TEST_TOKEN" },
    credentialKey: "credentials.token",
  };
}

function jira(deployment: "cloud" | "server") {
  captured = [];
  process.env.TEST_TOKEN = "s3cret";
  return new JiraClient(new HttpClient(site(deployment)), deployment);
}

function confluence(deployment: "cloud" | "server") {
  captured = [];
  process.env.TEST_TOKEN = "s3cret";
  return new ConfluenceClient(new HttpClient({ ...site(deployment), product: "confluence" }), deployment);
}

describe("authentication", () => {
  test("cloud sends basic auth built from email:token", async () => {
    respond = () => ({ body: { displayName: "Me" } });
    await jira("cloud").myself();
    expect(captured[0].auth).toBe(`Basic ${Buffer.from("me@acme.com:s3cret").toString("base64")}`);
  });

  test("server sends the PAT as a bearer token", async () => {
    respond = () => ({ body: { name: "me" } });
    await jira("server").myself();
    expect(captured[0].auth).toBe("Bearer s3cret");
  });

  test("the secret never appears in the URL", async () => {
    respond = () => ({ body: {} });
    await jira("cloud").myself();
    expect(captured[0].path + captured[0].query.toString()).not.toContain("s3cret");
  });
});

describe("jira search", () => {
  test("cloud posts to /search/jql and pages by nextPageToken", async () => {
    let call = 0;
    respond = () => {
      call++;
      return call === 1
        ? { body: { issues: [{ key: "A-1" }], nextPageToken: "tok2" } }
        : { body: { issues: [{ key: "A-2" }] } };
    };
    const client = jira("cloud");
    const res = await client.search("project = A", { all: true, limit: 100 });

    expect(captured[0].method).toBe("POST");
    expect(captured[0].path).toBe("/rest/api/3/search/jql");
    expect(captured[0].body.jql).toBe("project = A");
    expect(captured[0].body.fields).toContain("summary");
    expect(captured[0].body.nextPageToken).toBeUndefined();
    expect(captured[1].body.nextPageToken).toBe("tok2");
    expect(res.issues.map((i: any) => i.key)).toEqual(["A-1", "A-2"]);
    // Cloud's search reports no total; claiming one would be a fabrication.
    expect(res.total).toBeNull();
  });

  test("server posts to /rest/api/2/search and pages by startAt", async () => {
    respond = (req) =>
      req.body.startAt === 0
        ? { body: { issues: [{ key: "B-1" }], total: 2, startAt: 0 } }
        : { body: { issues: [{ key: "B-2" }], total: 2, startAt: 1 } };
    const res = await jira("server").search("project = B", { all: true });

    expect(captured[0].path).toBe("/rest/api/2/search");
    expect(captured[0].body.startAt).toBe(0);
    expect(captured[1].body.startAt).toBe(1);
    expect(res.total).toBe(2);
    expect(res.issues).toHaveLength(2);
  });

  test("a single page reports that more results exist", async () => {
    respond = () => ({ body: { issues: [{ key: "C-1" }], total: 40 } });
    const res = await jira("server").search("project = C", { limit: 1 });
    expect(res.more).toBe(true);
  });

  test("count uses approximate-count on cloud and total on server", async () => {
    respond = () => ({ body: { count: 17 } });
    expect(await jira("cloud").count("x")).toEqual({ count: 17, approximate: true });
    expect(captured[0].path).toBe("/rest/api/3/search/approximate-count");

    respond = () => ({ body: { total: 9, issues: [] } });
    expect(await jira("server").count("x")).toEqual({ count: 9, approximate: false });
    expect(captured[0].body.maxResults).toBe(0);
  });
});

describe("jira writes", () => {
  test("cloud sends an ADF description, server sends wiki markup", async () => {
    respond = () => ({ body: { key: "A-9" } });
    await jira("cloud").createIssue({ summary: "s" });
    // createIssue takes pre-rendered fields, so check the comment path where the
    // client itself does the conversion.
    await jira("cloud").addComment("A-1", "Hello **world**");
    expect(captured[0].body.body.type).toBe("doc");
    expect(captured[0].body.body.content[0].content[1].marks[0].type).toBe("strong");

    await jira("server").addComment("A-1", "Hello **world**");
    expect(typeof captured[0].body.body).toBe("string");
    expect(captured[0].body.body).toBe("Hello *world*");
  });

  test("assignee uses accountId on cloud and name on server", async () => {
    respond = () => ({ body: {} });
    await jira("cloud").assign("A-1", "acc-123");
    expect(captured[0].body).toEqual({ accountId: "acc-123" });

    await jira("server").assign("A-1", "jdoe");
    expect(captured[0].body).toEqual({ name: "jdoe" });
  });

  test("transitions resolve a status name to an id", async () => {
    respond = (req) =>
      req.method === "GET"
        ? { body: { transitions: [{ id: "31", name: "Resolve", to: { name: "Done" } }] } }
        : { body: {} };
    const client = jira("cloud");
    // "Done" is the destination status, not the transition name — the common case.
    const { id, label } = await client.transitionByName("A-1", "Done");
    expect(id).toBe("31");
    expect(label).toBe("Resolve → Done");

    await client.doTransition("A-1", id);
    expect(captured[1].body).toEqual({ transition: { id: "31" } });
  });

  test("an unreachable status lists what is actually available", async () => {
    respond = () => ({ body: { transitions: [{ id: "11", name: "Start", to: { name: "In Progress" } }] } });
    await expect(jira("cloud").transitionByName("A-1", "Released")).rejects.toThrow(/Start.*In Progress/s);
  });

  test("delete passes deleteSubtasks explicitly", async () => {
    respond = () => ({ body: {} });
    await jira("server").deleteIssue("A-1", true);
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].query.get("deleteSubtasks")).toBe("true");
  });
});

describe("confluence", () => {
  test("cloud reads pages from v2 with body-format=storage", async () => {
    respond = () => ({ body: { id: 123, title: "T", spaceId: 9, version: { number: 4 }, body: { storage: { value: "<p>x</p>" } } } });
    const page = await confluence("cloud").getPage("123");
    expect(captured[0].path).toBe("/api/v2/pages/123");
    expect(captured[0].query.get("body-format")).toBe("storage");
    expect(page.version).toBe(4);
    expect(page.storage).toBe("<p>x</p>");
  });

  test("server reads pages from v1 with expand", async () => {
    respond = () => ({ body: { id: 123, title: "T", version: { number: 2 }, space: { key: "SP" }, body: { storage: { value: "<p>x</p>" } } } });
    const page = await confluence("server").getPage("123");
    expect(captured[0].path).toBe("/rest/api/content/123");
    expect(captured[0].query.get("expand")).toContain("body.storage");
    expect(page.spaceKey).toBe("SP");
  });

  test("cloud create resolves the space key to a numeric id", async () => {
    respond = (req) =>
      req.path === "/api/v2/spaces"
        ? { body: { results: [{ id: 555, key: "NEO" }] } }
        : { body: { id: 900, title: "New", spaceId: 555, version: { number: 1 } } };
    await confluence("cloud").createPage({ spaceKey: "NEO", title: "New", storage: "<p>hi</p>" });

    expect(captured[0].path).toBe("/api/v2/spaces");
    expect(captured[0].query.get("keys")).toBe("NEO");
    expect(captured[1].path).toBe("/api/v2/pages");
    expect(captured[1].body.spaceId).toBe("555");
    expect(captured[1].body.body).toEqual({ representation: "storage", value: "<p>hi</p>" });
  });

  test("update reads the current version and increments it", async () => {
    respond = (req) =>
      req.method === "GET"
        ? { body: { id: 123, title: "Old", spaceId: 9, version: { number: 7 } } }
        : { body: { id: 123, title: "Old", version: { number: 8 } } };
    const page = await confluence("cloud").updatePage("123", { storage: "<p>new</p>" });

    const put = captured.find((c) => c.method === "PUT")!;
    expect(put.body.version.number).toBe(8);
    // Title must be resent: Confluence replaces the page, it does not patch it.
    expect(put.body.title).toBe("Old");
    expect(page.version).toBe(8);
  });

  test("a stale expect-version refuses to overwrite someone else's edit", async () => {
    respond = () => ({ body: { id: 123, title: "Old", version: { number: 9 } } });
    await expect(confluence("cloud").updatePage("123", { storage: "<p>x</p>", expectVersion: 7 })).rejects.toThrow(
      /version 9, not the expected 7/,
    );
    expect(captured.some((c) => c.method === "PUT")).toBe(false);
  });

  test("CQL search uses the v1 endpoint on both deployments", async () => {
    respond = () => ({ body: { results: [] } });
    await confluence("cloud").search('type = page AND text ~ "x"');
    expect(captured[0].path).toBe("/rest/api/search");

    await confluence("server").search('type = page AND text ~ "x"');
    expect(captured[0].path).toBe("/rest/api/search");
  });

  test("text search quotes the user's words into valid CQL", async () => {
    respond = () => ({ body: { results: [] } });
    await confluence("cloud").textSearch('release "notes"', { spaceKey: "NEO" });
    const cql = captured[0].query.get("cql")!;
    expect(cql).toContain('text ~ "release \\"notes\\""');
    expect(cql).toContain('space = "NEO"');
  });

  test("page ids are extracted from URLs", () => {
    expect(ConfluenceClient.parsePageId("https://x.atlassian.net/wiki/spaces/NEO/pages/98765/Title")).toBe("98765");
    expect(ConfluenceClient.parsePageId("https://wiki.corp/pages/viewpage.action?pageId=4242")).toBe("4242");
    expect(ConfluenceClient.parsePageId("4242")).toBe("4242");
    expect(() => ConfluenceClient.parsePageId("not-an-id")).toThrow(/not a page id/);
  });
});

describe("error handling", () => {
  test("a Jira validation error surfaces the field that failed", async () => {
    respond = () => ({ status: 400, body: { errorMessages: [], errors: { summary: "Summary is required." } } });
    await expect(jira("cloud").createIssue({})).rejects.toThrow(/summary: Summary is required/);
  });

  test("a 401 explains which credential and which email were used", async () => {
    respond = () => ({ status: 401, body: { message: "no" } });
    await expect(jira("cloud").myself()).rejects.toThrow(/credentials\.token.*me@acme\.com/s);
  });

  test("an HTML body is reported as a login page or wrong URL, not as JSON garbage", async () => {
    respond = () => ({ status: 200, body: undefined, headers: {} });
    // Serve raw HTML by bypassing the JSON wrapper.
    const html = Bun.serve({
      port: 0,
      fetch: () => new Response("<html><body>Log in</body></html>", { headers: { "content-type": "text/html" } }),
    });
    const client = new JiraClient(
      new HttpClient({ ...site("server"), baseUrl: `http://localhost:${html.port}` }),
      "server",
    );
    await expect(client.myself()).rejects.toThrow(/SSO|login page|base URL is wrong/);
    html.stop(true);
  });

  test("a 429 is retried after the server's Retry-After", async () => {
    let calls = 0;
    respond = () => {
      calls++;
      return calls === 1 ? { status: 429, body: { message: "slow down" }, headers: { "retry-after": "1" } } : { body: { name: "me" } };
    };
    const me = await jira("server").myself();
    expect(me.name).toBe("me");
    expect(calls).toBe(2);
  });

  test("a 400 is not retried — retrying a rejected payload just repeats it", async () => {
    let calls = 0;
    respond = () => {
      calls++;
      return { status: 400, body: { errorMessages: ["bad jql"] } };
    };
    await expect(jira("server").search("nonsense")).rejects.toThrow(/bad jql/);
    expect(calls).toBe(1);
  });
});
