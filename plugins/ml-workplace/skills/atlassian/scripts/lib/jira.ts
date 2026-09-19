// Jira REST client covering both deployments.
//
// The two are close enough to share a client and different enough that every
// difference below is a real bug someone hit:
//   - Cloud is /rest/api/3 with ADF bodies; Data Center is /rest/api/2 with wiki markup.
//   - Cloud search is POST /search/jql paged by opaque nextPageToken and returns
//     NO total. Data Center is POST /search paged by startAt and does.
//   - Cloud identifies users by accountId, Data Center by username. Sending the
//     wrong one is accepted as a *field value* and fails validation obscurely.

import type { Deployment } from "./config";
import type { HttpClient } from "./http";
import { AtlassianError } from "./http";
import { renderBody } from "./adf";

export const DEFAULT_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "priority",
  "assignee",
  "reporter",
  "project",
  "labels",
  "parent",
  "resolution",
  "duedate",
  "created",
  "updated",
];

export interface SearchOptions {
  fields?: string[];
  limit?: number;
  all?: boolean;
  expand?: string[];
}

export interface SearchResult {
  issues: any[];
  /** Data Center reports an exact total; Cloud's search endpoint reports none. */
  total: number | null;
  /** True when more issues match than were returned. */
  more: boolean;
}

export class JiraClient {
  constructor(
    private http: HttpClient,
    readonly deployment: Deployment,
  ) {}

  get api(): string {
    return this.deployment === "cloud" ? "/rest/api/3" : "/rest/api/2";
  }

  get cloud(): boolean {
    return this.deployment === "cloud";
  }

  myself() {
    return this.http.get(`${this.api}/myself`);
  }

  async search(jql: string, opts: SearchOptions = {}): Promise<SearchResult> {
    const fields = opts.fields?.length ? opts.fields : DEFAULT_FIELDS;
    const pageSize = Math.min(opts.limit ?? 50, 100);
    const max = opts.all ? (opts.limit ?? 5000) : pageSize;
    const issues: any[] = [];

    if (this.cloud) {
      // /rest/api/3/search replaced by /search/jql in 2025. The old path is gone,
      // and its 410 mentions neither the replacement nor the token pagination.
      let token: string | undefined;
      let sawToken = false;
      while (issues.length < max) {
        const body: Record<string, unknown> = {
          jql,
          maxResults: Math.min(pageSize, max - issues.length),
          fields,
          ...(opts.expand?.length ? { expand: opts.expand.join(",") } : {}),
          ...(token ? { nextPageToken: token } : {}),
        };
        const res = await this.http.post("/rest/api/3/search/jql", body);
        issues.push(...(res?.issues ?? []));
        token = res?.nextPageToken;
        sawToken = Boolean(token);
        if (!opts.all || !token || !(res?.issues ?? []).length) break;
      }
      return { issues: issues.slice(0, max), total: null, more: sawToken && issues.length >= max };
    }

    let startAt = 0;
    let total = 0;
    while (issues.length < max) {
      const res = await this.http.post(`${this.api}/search`, {
        jql,
        startAt,
        maxResults: Math.min(pageSize, max - issues.length),
        fields,
        ...(opts.expand?.length ? { expand: opts.expand } : {}),
      });
      const page = res?.issues ?? [];
      issues.push(...page);
      total = res?.total ?? issues.length;
      startAt += page.length;
      if (!opts.all || !page.length || issues.length >= total) break;
    }
    return { issues: issues.slice(0, max), total, more: total > issues.length };
  }

  /**
   * Cloud's count is deliberately approximate — it is an index estimate, so it
   * can differ slightly from a full walk. Worth saying out loud when reporting it.
   */
  async count(jql: string): Promise<{ count: number; approximate: boolean }> {
    if (this.cloud) {
      const res = await this.http.post("/rest/api/3/search/approximate-count", { jql });
      return { count: res?.count ?? 0, approximate: true };
    }
    const res = await this.http.post(`${this.api}/search`, { jql, maxResults: 0, fields: ["id"] });
    return { count: res?.total ?? 0, approximate: false };
  }

  getIssue(key: string, opts: { fields?: string[]; expand?: string[] } = {}) {
    return this.http.get(`${this.api}/issue/${encodeURIComponent(key)}`, {
      fields: opts.fields?.length ? opts.fields : undefined,
      expand: opts.expand?.length ? opts.expand : undefined,
    });
  }

  comments(key: string) {
    return this.http.get(`${this.api}/issue/${encodeURIComponent(key)}/comment`, { orderBy: "created" });
  }

  addComment(key: string, markdown: string) {
    return this.http.post(`${this.api}/issue/${encodeURIComponent(key)}/comment`, {
      body: renderBody(markdown, this.deployment),
    });
  }

  createIssue(fields: Record<string, unknown>) {
    return this.http.post(`${this.api}/issue`, { fields });
  }

  /** Returns null: Jira answers 204 with no body on a successful edit. */
  updateIssue(key: string, fields: Record<string, unknown>, update?: Record<string, unknown>) {
    return this.http.put(`${this.api}/issue/${encodeURIComponent(key)}`, {
      ...(Object.keys(fields).length ? { fields } : {}),
      ...(update ? { update } : {}),
    });
  }

  deleteIssue(key: string, deleteSubtasks = false) {
    return this.http.del(`${this.api}/issue/${encodeURIComponent(key)}`, {
      deleteSubtasks: deleteSubtasks ? "true" : "false",
    });
  }

  async transitions(key: string): Promise<any[]> {
    const res = await this.http.get(`${this.api}/issue/${encodeURIComponent(key)}/transitions`, {
      expand: "transitions.fields",
    });
    return res?.transitions ?? [];
  }

  /**
   * Resolves a human name to a transition id. Transitions are workflow-specific
   * and their names rarely match the target status exactly ("Done" may be reached
   * by a transition called "Resolve"), so match the target status too.
   */
  async transitionByName(key: string, name: string): Promise<{ id: string; label: string }> {
    const available = await this.transitions(key);
    const want = name.trim().toLowerCase();
    const hit =
      available.find((t) => String(t.name).toLowerCase() === want) ??
      available.find((t) => String(t.to?.name ?? "").toLowerCase() === want) ??
      available.find((t) => String(t.name).toLowerCase().includes(want)) ??
      available.find((t) => String(t.to?.name ?? "").toLowerCase().includes(want));

    if (!hit) {
      const list = available.map((t) => `"${t.name}" → ${t.to?.name}`).join(", ") || "(none)";
      throw new AtlassianError(
        `No transition on ${key} matches "${name}". Available from its current status: ${list}. ` +
          `Transitions depend on the current status, so a valid target may simply not be reachable in one step.`,
      );
    }
    return { id: String(hit.id), label: `${hit.name} → ${hit.to?.name}` };
  }

  doTransition(
    key: string,
    transitionId: string,
    fields?: Record<string, unknown>,
    update?: Record<string, unknown>,
  ) {
    return this.http.post(`${this.api}/issue/${encodeURIComponent(key)}/transitions`, {
      transition: { id: transitionId },
      ...(fields && Object.keys(fields).length ? { fields } : {}),
      ...(update && Object.keys(update).length ? { update } : {}),
    });
  }

  /** Pass null to unassign. Cloud wants accountId, Data Center wants name. */
  assign(key: string, user: string | null) {
    const body = this.cloud ? { accountId: user } : { name: user };
    return this.http.put(`${this.api}/issue/${encodeURIComponent(key)}/assignee`, body);
  }

  async findUser(query: string): Promise<any[]> {
    if (this.cloud) return (await this.http.get(`${this.api}/user/search`, { query })) ?? [];
    return (await this.http.get(`${this.api}/user/search`, { username: query })) ?? [];
  }

  /** The identifier to put in an assignee/reporter field for this deployment. */
  userRef(user: any): Record<string, string> {
    return this.cloud ? { accountId: user.accountId } : { name: user.name };
  }

  projects(): Promise<any[]> {
    // Cloud paginates /project/search; Data Center returns a plain array from /project.
    return this.cloud
      ? this.http.get(`${this.api}/project/search`, { maxResults: 100 }).then((r: any) => r?.values ?? [])
      : this.http.get(`${this.api}/project`);
  }

  /** Fields required (and allowed) when creating an issue of this type. */
  async createMeta(projectKey: string, issueType?: string) {
    if (this.cloud) {
      const types = await this.http.get(`${this.api}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`);
      const list = types?.values ?? types?.issueTypes ?? [];
      if (!issueType) return { issueTypes: list, fields: null };
      const match = list.find((t: any) => String(t.name).toLowerCase() === issueType.toLowerCase());
      if (!match) return { issueTypes: list, fields: null };
      const fields = await this.http.get(
        `${this.api}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${match.id}`,
        { maxResults: 200 },
      );
      return { issueTypes: list, fields: fields?.values ?? [] };
    }
    const res = await this.http.get(`${this.api}/issue/createmeta`, {
      projectKeys: projectKey,
      ...(issueType ? { issuetypeNames: issueType } : {}),
      expand: "projects.issuetypes.fields",
    });
    const project = res?.projects?.[0];
    const list = project?.issuetypes ?? [];
    const chosen = issueType ? list.find((t: any) => String(t.name).toLowerCase() === issueType.toLowerCase()) : null;
    return {
      issueTypes: list,
      fields: chosen ? Object.entries(chosen.fields ?? {}).map(([id, f]: any) => ({ fieldId: id, ...f })) : null,
    };
  }

  /** Every field, including custom ones — how you find a customfield_NNNNN id. */
  allFields(): Promise<any[]> {
    return this.http.get(`${this.api}/field`);
  }

  linkTypes(): Promise<any> {
    return this.http.get(`${this.api}/issueLinkType`);
  }

  linkIssues(inwardKey: string, outwardKey: string, type: string) {
    return this.http.post(`${this.api}/issueLink`, {
      type: { name: type },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    });
  }

  async attach(key: string, fileName: string, bytes: Uint8Array) {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), fileName);
    // Content-Type must be left unset so fetch adds the multipart boundary.
    return this.http.request("POST", `${this.api}/issue/${encodeURIComponent(key)}/attachments`, {
      formData: form,
      headers: { "X-Atlassian-Token": "no-check" },
    });
  }

  boards(projectKey?: string): Promise<any[]> {
    return this.http
      .get("/rest/agile/1.0/board", { projectKeyOrId: projectKey, maxResults: 100 })
      .then((r: any) => r?.values ?? []);
  }

  sprints(boardId: string | number, state = "active,future"): Promise<any[]> {
    return this.http
      .get(`/rest/agile/1.0/board/${boardId}/sprint`, { state, maxResults: 100 })
      .then((r: any) => r?.values ?? []);
  }

  /** The browser URL for an issue — what a human actually wants pasted back. */
  browseUrl(key: string): string {
    return `${this.http.site.baseUrl}/browse/${encodeURIComponent(key)}`;
  }
}
