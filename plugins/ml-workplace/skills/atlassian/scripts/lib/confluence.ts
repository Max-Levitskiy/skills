// Confluence REST client covering both deployments.
//
// Cloud is a split API and there is no way around it: pages live in v2
// (/api/v2/pages), but CQL search and attachment upload were never ported, so
// those still go through v1 (/rest/api/...). Data Center is v1 throughout.
//
// Two traps this client exists to absorb:
//   - v2 create wants a numeric spaceId; every human and every URL uses the
//     space *key*. resolveSpace() translates.
//   - Updating a page requires the next version number and the *whole* body.
//     Read-modify-write is the only correct pattern, and it races: see updatePage.

import type { Deployment } from "./config";
import type { HttpClient } from "./http";
import { AtlassianError } from "./http";

export interface Page {
  id: string;
  title: string;
  spaceKey?: string;
  spaceId?: string;
  version: number;
  parentId?: string;
  storage?: string;
  url: string;
  status?: string;
}

export interface SearchHit {
  id: string;
  title: string;
  type: string;
  spaceKey?: string;
  excerpt?: string;
  url: string;
  lastModified?: string;
}

/**
 * Turn plain words into CQL. Exported so a caller can layer a scope's clauses on
 * top before searching, rather than having the query built out of reach inside
 * the client.
 */
export function buildTextCql(text: string, spaceKey?: string, type?: string): string {
  const escaped = text.replace(/["\\]/g, "\\$&");
  const clauses = [`text ~ "${escaped}"`];
  if (spaceKey) clauses.push(`space = "${spaceKey}"`);
  clauses.push(`type = "${type ?? "page"}"`);
  return `${clauses.join(" AND ")} ORDER BY lastmodified DESC`;
}

export class ConfluenceClient {
  private spaceKeyCache = new Map<string, string>();

  constructor(
    private http: HttpClient,
    readonly deployment: Deployment,
  ) {}

  get cloud(): boolean {
    return this.deployment === "cloud";
  }

  /** v1 REST root — present on both deployments. */
  private get v1(): string {
    return "/rest/api";
  }

  myself() {
    return this.cloud ? this.http.get(`${this.v1}/user/current`) : this.http.get(`${this.v1}/user/current`);
  }

  private webUrl(links: any, fallbackId?: string): string {
    const webui = links?.webui;
    if (webui) {
      const base = links?.base ?? this.http.site.baseUrl;
      return `${String(base).replace(/\/+$/, "")}${webui}`;
    }
    return fallbackId ? `${this.http.site.baseUrl}/pages/viewpage.action?pageId=${fallbackId}` : this.http.site.baseUrl;
  }

  // ------------------------------------------------------------------ spaces

  async spaces(): Promise<{ id: string; key: string; name: string }[]> {
    if (this.cloud) {
      const res = await this.http.get("/api/v2/spaces", { limit: 250 });
      return (res?.results ?? []).map((s: any) => ({ id: String(s.id), key: s.key, name: s.name }));
    }
    const res = await this.http.get(`${this.v1}/space`, { limit: 250 });
    return (res?.results ?? []).map((s: any) => ({ id: String(s.id), key: s.key, name: s.name }));
  }

  /** Space key → numeric id, which only Cloud v2 needs. Cached per process. */
  async resolveSpaceId(key: string): Promise<string> {
    const cached = this.spaceKeyCache.get(key.toUpperCase());
    if (cached) return cached;
    const res = await this.http.get("/api/v2/spaces", { keys: key, limit: 1 });
    const found = res?.results?.[0];
    if (!found) {
      throw new AtlassianError(
        `No space with key "${key}". Space keys are case-sensitive in the API and are not the space *name* — ` +
          `run 'confluence spaces' to list them.`,
      );
    }
    this.spaceKeyCache.set(key.toUpperCase(), String(found.id));
    return String(found.id);
  }

  private async spaceKeyById(id: string | number | undefined): Promise<string | undefined> {
    if (id === undefined || id === null) return undefined;
    for (const [key, cachedId] of this.spaceKeyCache) if (cachedId === String(id)) return key;
    try {
      const res = await this.http.get(`/api/v2/spaces/${id}`);
      if (res?.key) {
        this.spaceKeyCache.set(String(res.key).toUpperCase(), String(id));
        return res.key;
      }
    } catch {
      // A missing space key is cosmetic — never fail a page read over it.
    }
    return undefined;
  }

  // ------------------------------------------------------------------ pages

  async getPage(id: string, withBody = true): Promise<Page> {
    if (this.cloud) {
      const res = await this.http.get(`/api/v2/pages/${encodeURIComponent(id)}`, {
        "body-format": withBody ? "storage" : undefined,
      });
      return {
        id: String(res.id),
        title: res.title,
        spaceId: res.spaceId !== undefined ? String(res.spaceId) : undefined,
        spaceKey: await this.spaceKeyById(res.spaceId),
        version: res.version?.number ?? 1,
        parentId: res.parentId ? String(res.parentId) : undefined,
        storage: res.body?.storage?.value,
        status: res.status,
        url: this.webUrl(res._links, String(res.id)),
      };
    }
    const res = await this.http.get(`${this.v1}/content/${encodeURIComponent(id)}`, {
      expand: withBody ? "body.storage,version,space,ancestors" : "version,space,ancestors",
    });
    const ancestors = res.ancestors ?? [];
    return {
      id: String(res.id),
      title: res.title,
      spaceKey: res.space?.key,
      version: res.version?.number ?? 1,
      parentId: ancestors.length ? String(ancestors[ancestors.length - 1].id) : undefined,
      storage: res.body?.storage?.value,
      status: res.status,
      url: this.webUrl(res._links, String(res.id)),
    };
  }

  /** Find a page by exact title within a space — the usual way a human names one. */
  async findPage(spaceKey: string, title: string): Promise<Page | null> {
    if (this.cloud) {
      const spaceId = await this.resolveSpaceId(spaceKey);
      const res = await this.http.get(`/api/v2/spaces/${spaceId}/pages`, { title, limit: 5, "body-format": "storage" });
      const hit = (res?.results ?? []).find((p: any) => p.title === title) ?? res?.results?.[0];
      return hit ? this.getPage(String(hit.id)) : null;
    }
    const res = await this.http.get(`${this.v1}/content`, {
      spaceKey,
      title,
      type: "page",
      expand: "version,space",
      limit: 5,
    });
    const hit = res?.results?.[0];
    return hit ? this.getPage(String(hit.id)) : null;
  }

  async childPages(id: string): Promise<{ id: string; title: string }[]> {
    if (this.cloud) {
      const res = await this.http.get(`/api/v2/pages/${encodeURIComponent(id)}/children`, { limit: 250 });
      return (res?.results ?? []).map((p: any) => ({ id: String(p.id), title: p.title }));
    }
    const res = await this.http.get(`${this.v1}/content/${encodeURIComponent(id)}/child/page`, { limit: 250 });
    return (res?.results ?? []).map((p: any) => ({ id: String(p.id), title: p.title }));
  }

  async pagesInSpace(spaceKey: string, limit = 100): Promise<{ id: string; title: string }[]> {
    if (this.cloud) {
      const spaceId = await this.resolveSpaceId(spaceKey);
      const res = await this.http.get(`/api/v2/spaces/${spaceId}/pages`, { limit });
      return (res?.results ?? []).map((p: any) => ({ id: String(p.id), title: p.title }));
    }
    const res = await this.http.get(`${this.v1}/content`, { spaceKey, type: "page", limit });
    return (res?.results ?? []).map((p: any) => ({ id: String(p.id), title: p.title }));
  }

  async createPage(input: {
    spaceKey: string;
    title: string;
    storage: string;
    parentId?: string;
  }): Promise<Page> {
    if (this.cloud) {
      const spaceId = await this.resolveSpaceId(input.spaceKey);
      const res = await this.http.post("/api/v2/pages", {
        spaceId,
        status: "current",
        title: input.title,
        ...(input.parentId ? { parentId: input.parentId } : {}),
        body: { representation: "storage", value: input.storage },
      });
      return {
        id: String(res.id),
        title: res.title,
        spaceId: String(res.spaceId),
        spaceKey: input.spaceKey,
        version: res.version?.number ?? 1,
        parentId: res.parentId ? String(res.parentId) : undefined,
        url: this.webUrl(res._links, String(res.id)),
      };
    }
    const res = await this.http.post(`${this.v1}/content`, {
      type: "page",
      title: input.title,
      space: { key: input.spaceKey },
      ...(input.parentId ? { ancestors: [{ id: input.parentId }] } : {}),
      body: { storage: { value: input.storage, representation: "storage" } },
    });
    return {
      id: String(res.id),
      title: res.title,
      spaceKey: input.spaceKey,
      version: res.version?.number ?? 1,
      parentId: input.parentId,
      url: this.webUrl(res._links, String(res.id)),
    };
  }

  /**
   * Confluence has no partial update: the payload replaces the body wholesale and
   * must carry version = current + 1. That makes every edit a read-modify-write,
   * and if someone saves the page between the read and the write, the API accepts
   * ours (the version number still matches) and their edit is gone. `expectVersion`
   * lets a caller assert what it based its edit on and fail loudly instead.
   */
  async updatePage(
    id: string,
    input: { title?: string; storage: string; expectVersion?: number; message?: string },
  ): Promise<Page> {
    const current = await this.getPage(id, false);
    if (input.expectVersion !== undefined && current.version !== input.expectVersion) {
      throw new AtlassianError(
        `Page ${id} is at version ${current.version}, not the expected ${input.expectVersion} — someone edited it ` +
          `since it was read. Re-read the page and re-apply the change so their edit isn't overwritten.`,
      );
    }
    const title = input.title ?? current.title;
    const nextVersion = current.version + 1;

    if (this.cloud) {
      const res = await this.http.put(`/api/v2/pages/${encodeURIComponent(id)}`, {
        id,
        status: "current",
        title,
        body: { representation: "storage", value: input.storage },
        version: { number: nextVersion, ...(input.message ? { message: input.message } : {}) },
      });
      return {
        id: String(res.id),
        title: res.title,
        spaceId: res.spaceId !== undefined ? String(res.spaceId) : undefined,
        spaceKey: current.spaceKey,
        version: res.version?.number ?? nextVersion,
        url: this.webUrl(res._links, String(res.id)),
      };
    }
    const res = await this.http.put(`${this.v1}/content/${encodeURIComponent(id)}`, {
      id,
      type: "page",
      title,
      body: { storage: { value: input.storage, representation: "storage" } },
      version: { number: nextVersion, ...(input.message ? { message: input.message } : {}) },
    });
    return {
      id: String(res.id),
      title: res.title,
      spaceKey: current.spaceKey,
      version: res.version?.number ?? nextVersion,
      url: this.webUrl(res._links, String(res.id)),
    };
  }

  deletePage(id: string, purge = false) {
    if (this.cloud) {
      // Without purge the page goes to the space trash and can be restored.
      return this.http.del(`/api/v2/pages/${encodeURIComponent(id)}`, purge ? { purge: "true" } : undefined);
    }
    return this.http.del(`${this.v1}/content/${encodeURIComponent(id)}`);
  }

  // ------------------------------------------------------------------ search

  /**
   * CQL search. Cloud never shipped a v2 equivalent, so both deployments use the
   * v1 endpoint — the one place where "Cloud means v2" is wrong.
   */
  async search(cql: string, limit = 25): Promise<SearchHit[]> {
    const res = await this.http.get(`${this.v1}/search`, { cql, limit, expand: "content.space,content.version" });
    return (res?.results ?? []).map((r: any) => {
      const c = r.content ?? {};
      return {
        id: String(c.id ?? r.id ?? ""),
        title: c.title ?? r.title ?? "(untitled)",
        type: c.type ?? r.entityType ?? "unknown",
        spaceKey: c.space?.key ?? r.resultGlobalContainer?.title,
        excerpt: (r.excerpt ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined,
        lastModified: r.lastModified ?? c.version?.when,
        url: r.url ? `${this.http.site.baseUrl}${r.url}` : this.webUrl(c._links, String(c.id ?? "")),
      };
    });
  }

  /** Free-text search without making the caller write CQL. */
  textSearch(text: string, opts: { spaceKey?: string; type?: string; limit?: number } = {}): Promise<SearchHit[]> {
    return this.search(buildTextCql(text, opts.spaceKey, opts.type), opts.limit ?? 25);
  }

  // ---------------------------------------------------------------- comments

  async comments(pageId: string): Promise<{ id: string; author?: string; when?: string; storage: string }[]> {
    if (this.cloud) {
      const res = await this.http.get(`/api/v2/pages/${encodeURIComponent(pageId)}/footer-comments`, {
        "body-format": "storage",
        limit: 100,
      });
      return (res?.results ?? []).map((c: any) => ({
        id: String(c.id),
        author: c.version?.authorId,
        when: c.version?.createdAt,
        storage: c.body?.storage?.value ?? "",
      }));
    }
    const res = await this.http.get(`${this.v1}/content/${encodeURIComponent(pageId)}/child/comment`, {
      expand: "body.storage,version,history",
      limit: 100,
    });
    return (res?.results ?? []).map((c: any) => ({
      id: String(c.id),
      author: c.version?.by?.displayName ?? c.history?.createdBy?.displayName,
      when: c.version?.when,
      storage: c.body?.storage?.value ?? "",
    }));
  }

  addComment(pageId: string, storage: string) {
    if (this.cloud) {
      return this.http.post("/api/v2/footer-comments", {
        pageId,
        body: { representation: "storage", value: storage },
      });
    }
    return this.http.post(`${this.v1}/content`, {
      type: "comment",
      container: { id: pageId, type: "page" },
      body: { storage: { value: storage, representation: "storage" } },
    });
  }

  // ------------------------------------------------------------- attachments

  async attachments(pageId: string): Promise<{ id: string; title: string; size?: number }[]> {
    if (this.cloud) {
      const res = await this.http.get(`/api/v2/pages/${encodeURIComponent(pageId)}/attachments`, { limit: 100 });
      return (res?.results ?? []).map((a: any) => ({ id: String(a.id), title: a.title, size: a.fileSize }));
    }
    const res = await this.http.get(`${this.v1}/content/${encodeURIComponent(pageId)}/child/attachment`, { limit: 100 });
    return (res?.results ?? []).map((a: any) => ({ id: String(a.id), title: a.title, size: a.extensions?.fileSize }));
  }

  /** Upload is v1-only on both deployments — v2 can list attachments but not create them. */
  attach(pageId: string, fileName: string, bytes: Uint8Array, comment?: string) {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), fileName);
    if (comment) form.append("comment", comment);
    form.append("minorEdit", "true");
    return this.http.request("PUT", `${this.v1}/content/${encodeURIComponent(pageId)}/child/attachment`, {
      formData: form,
      headers: { "X-Atlassian-Token": "no-check" },
    });
  }

  /** Accepts a page id or any Confluence URL containing one. */
  static parsePageId(input: string): string {
    if (/^\d+$/.test(input)) return input;
    const patterns = [/\/pages\/(\d+)/, /pageId=(\d+)/, /\/content\/(\d+)/];
    for (const p of patterns) {
      const m = p.exec(input);
      if (m) return m[1];
    }
    throw new AtlassianError(
      `"${input}" is not a page id or a URL containing one. Confluence URLs look like ` +
        `/wiki/spaces/KEY/pages/123456/Title — the number is the id.`,
    );
  }
}
