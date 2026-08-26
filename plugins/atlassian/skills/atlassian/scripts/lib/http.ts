// Shared HTTP layer for both products. Handles auth, retries, and — mostly —
// turning Atlassian's several incompatible error shapes into one sentence a
// human can act on.

import type { ResolvedProduct } from "./config";
import { lazyCredential } from "./credentials";

export class AtlassianError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RequestOptions {
  query?: Record<string, string | number | boolean | string[] | undefined>;
  body?: unknown;
  /** Send/expect something other than JSON (attachment upload, page export). */
  formData?: FormData;
  raw?: boolean;
  headers?: Record<string, string>;
}

export class HttpClient {
  private token: () => string;

  constructor(readonly site: ResolvedProduct) {
    this.token = lazyCredential(site.credential, site.credentialKey);
  }

  private authHeader(): string {
    const secret = this.token();
    if (this.site.authMode === "bearer") return `Bearer ${secret}`;
    // Cloud API tokens are not bearer tokens: they are the password half of
    // basic auth against the account email. Sending one as a bearer token gets
    // a 401 that looks identical to a revoked token.
    return `Basic ${Buffer.from(`${this.site.email}:${secret}`).toString("base64")}`;
  }

  url(path: string, query?: RequestOptions["query"]): string {
    const u = new URL(this.site.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        if (v.length) u.searchParams.set(k, v.join(","));
      } else {
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  async request(method: string, path: string, opts: RequestOptions = {}): Promise<any> {
    const url = this.url(path, opts.query);
    const maxAttempts = 4;
    let res!: Response;
    let text!: string;

    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = {
        Authorization: this.authHeader(),
        Accept: "application/json",
        // Data Center rejects unauthenticated-looking XSRF-prone calls without this.
        "X-Atlassian-Token": "no-check",
        ...opts.headers,
      };
      let payload: BodyInit | undefined;
      if (opts.formData) {
        payload = opts.formData;
      } else if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(opts.body);
      }

      try {
        res = await fetch(url, { method, headers, body: payload });
        text = await res.text();
      } catch (e: any) {
        if (attempt >= maxAttempts) {
          throw new AtlassianError(`Network error calling ${method} ${url}: ${e.message}`);
        }
        await sleep(attempt * 700);
        continue;
      }

      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable || attempt >= maxAttempts) break;
      // Atlassian sends Retry-After on 429 and means it; ignoring it just burns
      // the remaining budget and extends the block.
      const after = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : attempt * 900);
    }

    if (!res.ok) throw this.describeFailure(res, text, method, url);
    if (opts.raw) return text;
    if (!text.trim()) return null; // 204 from deletes and some updates

    try {
      return JSON.parse(text);
    } catch {
      throw new AtlassianError(this.explainNonJson(text, url), res.status, text.slice(0, 400));
    }
  }

  /**
   * A 200 carrying HTML almost always means an SSO login page rather than the API:
   * the most confusing failure this skill can hit, because the request "succeeded".
   */
  private explainNonJson(text: string, url: string): string {
    if (text.trimStart().startsWith("<")) {
      return (
        `Expected JSON from ${url} but got HTML. Usually one of: the base URL is wrong ` +
        `(Confluence Cloud lives under /wiki), or an SSO proxy intercepted the call and returned a ` +
        `login page. Personal access tokens bypass SSO on Data Center only if the API path is excluded ` +
        `from the proxy.`
      );
    }
    return `Expected JSON from ${url} but got: ${text.slice(0, 200)}`;
  }

  private describeFailure(res: Response, text: string, method: string, url: string): AtlassianError {
    const detail = extractErrorDetail(text);

    if (res.status === 401) {
      return new AtlassianError(
        `401 Unauthorized on ${method} ${url}. The ${this.site.product} credential (${this.site.credentialKey}) was rejected — ` +
          (this.site.authMode === "basic"
            ? `check that auth.email (${this.site.email}) matches the account that issued the API token, and that the token is not revoked.`
            : `check the personal access token has not expired or been revoked.`) +
          (detail ? ` Server said: ${detail}` : ""),
        res.status,
        text,
      );
    }
    if (res.status === 403) {
      return new AtlassianError(
        `403 Forbidden on ${method} ${url}. Authentication worked but this account lacks permission for that ` +
          `operation${detail ? ` — ${detail}` : ""}. On Data Center a 403 can also mean CAPTCHA is triggered on the account ` +
          `after failed logins; log in through the browser once to clear it.`,
        res.status,
        text,
      );
    }
    if (res.status === 404 && text.trimStart().startsWith("<")) {
      return new AtlassianError(
        `404 on ${method} ${url} with an HTML body — the base URL is probably wrong for this product. ` +
          `Check ${this.site.product}.baseUrl in the config.`,
        res.status,
        text,
      );
    }
    return new AtlassianError(
      `HTTP ${res.status} on ${method} ${url}${detail ? `: ${detail}` : `: ${text.slice(0, 400)}`}`,
      res.status,
      text,
    );
  }

  get(path: string, query?: RequestOptions["query"]) {
    return this.request("GET", path, { query });
  }
  post(path: string, body?: unknown, query?: RequestOptions["query"]) {
    return this.request("POST", path, { body, query });
  }
  put(path: string, body?: unknown, query?: RequestOptions["query"]) {
    return this.request("PUT", path, { body, query });
  }
  del(path: string, query?: RequestOptions["query"]) {
    return this.request("DELETE", path, { query });
  }
}

/**
 * Jira, Confluence v1 and Confluence v2 each report errors differently, and the
 * useful sentence is buried in a different key in each.
 */
export function extractErrorDetail(text: string): string | null {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const parts: string[] = [];

  // Jira: { errorMessages: [...], errors: { summary: "..." } }
  if (Array.isArray(parsed?.errorMessages)) parts.push(...parsed.errorMessages);
  if (parsed?.errors && !Array.isArray(parsed.errors)) {
    for (const [field, msg] of Object.entries(parsed.errors)) parts.push(`${field}: ${msg}`);
  }
  // Confluence v2: { errors: [{ title, detail }] }
  if (Array.isArray(parsed?.errors)) {
    for (const e of parsed.errors) parts.push([e.title, e.detail].filter(Boolean).join(" — "));
  }
  // Confluence v1: { message: "..." } / { statusCode, message }
  if (typeof parsed?.message === "string") parts.push(parsed.message);

  const joined = parts.filter(Boolean).join("; ").trim();
  return joined || null;
}
