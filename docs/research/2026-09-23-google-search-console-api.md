# Google Search Console API: auth onboarding and API surface

Research for the `ml-analytics:search-console` skill: a zero-dependency bun/TypeScript CLI that calls
the Search Console API with `fetch`, plus an onboarding flow (bash wizard or an agent driving Chrome)
that walks a human through Google Cloud setup.

- Researched: 2026-09-23. Discovery document revision `20260916`.
- Sources: primary only (developers.google.com, cloud.google.com / docs.cloud.google.com,
  support.google.com, the API discovery document). Every claim cites the page it came from.
- Short-hand used below: **[DISC]** = `https://searchconsole.googleapis.com/$discovery/rest?version=v1`
  (fetched raw, revision 20260916).

## Summary

1. **Testing-mode refresh tokens expire after 7 days. Confirmed.** It applies to *External* user type
   with publishing status *Testing*, for every scope except the identity set (`openid`,
   `userinfo.email`, `userinfo.profile`). `webmasters` / `webmasters.readonly` are therefore affected.
   Source: https://developers.google.com/identity/protocols/oauth2 (§ Refresh token expiration) and
   https://support.google.com/cloud/answer/15549945 (§ Publishing status → Testing).
2. **Getting past the 7-day limit for personal use:** click *Publish app* to move it to *In production*.
   Google allows a "personal use" app (fewer than 100 users) to skip verification. Users then click
   through the "unverified app" screen, if one appears at all. That screen and the 100-user cap only
   apply to **sensitive or restricted** scopes. I found no primary source that says whether
   `webmasters(.readonly)` is sensitive, so this must be checked on the Data Access page (see
   Unverified). Sources: https://support.google.com/cloud/answer/13464323,
   https://support.google.com/cloud/answer/7454865.
3. **Client secrets are shown only once. Confirmed.** Since June 2025, new OAuth clients show and
   download the secret only at creation. Existing clients followed from November 2025. After that the
   console shows the last 4 characters. Recovery path: *Add Secret* (rotation).
   Source: https://support.google.com/cloud/answer/15549257 (§ Client Secret Handling and Visibility).
   The wizard therefore **must** capture the JSON download in the creation dialog.
4. **Service-account key creation is blocked by default for new organizations. Confirmed, with a
   scope limit.** It applies to organizations created on or after 2024-05-03, and to some created in
   Feb–Apr 2024. A personal @gmail.com project with **"No organization"** has no parent org policy.
   The key-creation constraint is *not* in the list of constraints Google enforces by default without
   a policy, so key creation should work there. That last step is my inference; verify it.
   Sources: https://cloud.google.com/iam/docs/keys-create-delete,
   https://cloud.google.com/resource-manager/docs/secure-by-default-organizations,
   https://docs.cloud.google.com/organization-policy/reference/org-policy-constraints.
5. **The console was reorganised into the "Google Auth Platform".** Its pages are *Overview /
   Branding / Audience / Clients / Data Access / Verification Center*. Google's own help links use
   `console.developers.google.com/auth/{overview,branding,audience,clients,scopes,verification}`.
   Data Access lives at `/auth/scopes`. Source: https://support.google.com/cloud/answer/15544987 and
   its sibling articles.
6. **Installed-app flow:** use a loopback redirect `http://127.0.0.1:PORT` with PKCE S256. The token
   endpoint is `https://oauth2.googleapis.com/token`. Installed apps **always** get a refresh token,
   so `access_type=offline` is not needed. `client_secret` is documented as *Optional* at the token
   endpoint. The OOB (copy/paste) flow is fully blocked since 2023-01-31.
   Sources: https://developers.google.com/identity/protocols/oauth2/native-app,
   https://developers.google.com/identity/protocols/oauth2/resources/oob-migration.
7. **API surface (discovery rev 20260916):** `sites.{list,get,add,delete}`,
   `sitemaps.{list,get,submit,delete}`, `searchanalytics.query`, `urlInspection.index.inspect`, and
   the retired `urlTestingTools.mobileFriendlyTest.run`, which is still in the discovery doc.
   New since 2024: the `HOUR` dimension and the `HOURLY_ALL` dataState (April 2025, up to 10 days of
   hourly data). The June 2026 generative-AI performance reports have **no API surface** that I could
   find.
8. **Quotas:**
   - Search Analytics: 1,200 QPM per site and per user; 40,000 QPM and 30M QPD per project; plus
     load quotas.
   - URL Inspection: 2,000 QPD and 600 QPM per site.
   - Everything else: 20 QPS / 200 QPM per user.
   - Data caps: about 50K rows per day per search type, 25K rows per request, 16 months of history.

## A. OAuth desktop-client path (acts as the user)

### A1. Project and API enablement

**Create a project:**
- Console path: *Manage resources* page → **Create project** → name (4–30 chars) → Parent resource
  (pick **No organization** if offered) → **Create**.
  https://cloud.google.com/resource-manager/docs/creating-managing-projects
- Direct URLs from the same page: `https://console.cloud.google.com/projectcreate` and
  `https://console.cloud.google.com/cloud-resource-manager`.
- CLI: `gcloud projects create PROJECT_ID` (6–30 chars, lowercase letter first). Same source.

**Enable the API:**
- Console path: `https://console.cloud.google.com/apis/library` → select project → search box
  "Search for APIs & Services" → click the API → **Enable**.
  https://cloud.google.com/service-usage/docs/enable-disable
- API title: **"Google Search Console API"** [DISC `title`]. Service name:
  `searchconsole.googleapis.com` (the discovery `rootUrl`) [DISC].
- Deep link `https://console.cloud.google.com/apis/library/searchconsole.googleapis.com` follows the
  console's standard pattern, but no docs page states it. See Unverified.
- CLI: `gcloud services enable searchconsole.googleapis.com`. The command is from
  https://cloud.google.com/service-usage/docs/enable-disable; the service name is from [DISC].

The Search Console API's own auth page still says "Activate the Google Search Console API in the Google
API Console" (https://developers.google.com/webmaster-tools/v1/how-tos/authorizing).

### A2. Google Auth Platform (formerly "OAuth consent screen")

Pages and the URLs Google's help articles link to:

| Page | URL (as linked from Google help) | Source |
|---|---|---|
| Overview (has **GET STARTED** for first-time setup) | `https://console.developers.google.com/auth/overview` | https://support.google.com/cloud/answer/15544987 , https://support.google.com/cloud/answer/15548748 |
| Branding | `https://console.developers.google.com/auth/branding` | https://support.google.com/cloud/answer/15549049 |
| Audience | `https://console.developers.google.com/auth/audience` | https://support.google.com/cloud/answer/15549945 |
| Clients | `https://console.developers.google.com/auth/clients` | https://support.google.com/cloud/answer/15549135 , https://support.google.com/cloud/answer/15549257 |
| Data Access (scopes) | `https://console.developers.google.com/auth/scopes` | https://support.google.com/cloud/answer/15549135 |
| Verification Center | `https://console.developers.google.com/auth/verification` | https://support.google.com/cloud/answer/15549049 |

The page names are confirmed: "Branding", "Audience", "Clients", "Data Access", "Verification Center"
(https://support.google.com/cloud/answer/15544987). `console.cloud.google.com/auth/...` is assumed to
be equivalent; see Unverified.

**First-time setup (GET STARTED wizard).** It asks for:
- App Information: App name and User support email.
- Audience: External or Internal.
- Contact Information.

Source: https://support.google.com/cloud/answer/15544987. The Clients page forces this step first:
"You will be prompted to register your application to use Google Auth if you are yet to do so. This is
required before creating a client." (https://support.google.com/cloud/answer/15549257).

**User type** (https://support.google.com/cloud/answer/15549945):
- *External*: "available to any user with a Google Account." This is the only option for a personal
  @gmail.com project.
- *Internal*: only for projects in a Google Cloud Organization. It limits access to org members;
  anyone else gets an `org_internal` error. Internal apps skip the unverified screen and the 100-user
  cap (https://support.google.com/cloud/answer/13464323).

**Publishing status** (https://support.google.com/cloud/answer/15549945):
- *Testing*:
  - At most 100 test users, "listed in the OAuth consent screen".
  - Test users see a warning before consent.
  - "Authorizations by a test user will expire seven days from the time of consent. If your OAuth
    client requests an offline access type and receives a refresh token, that token will also
    expire."
- *In production*: "considered In production after selecting the **Publish app** button." Google shows
  "an Unverified apps warning message if your project's OAuth clients request authorization of scopes
  considered sensitive or restricted before your project has completed verification for those scopes."
- The exact UI label and location of the test-user "add" control is not given in the help text. See
  Unverified.

**Data Access.** Scopes are classed as Non-Sensitive, Sensitive or Restricted. To add scopes: Data
Access page → **ADD OR REMOVE SCOPES** → select → **UPDATE**. "Only scopes for enabled APIs are listed
in the scopes table", so enable the API first, or use "Manually add scopes".
https://support.google.com/cloud/answer/15549135

**Branding.** The app name and logo appear on the consent screen only after brand verification. Before
that, only the app domain shows. https://support.google.com/cloud/answer/15549049

### A3. Refresh-token lifetime rules

- **Testing + External = 7 days**, "unless the only OAuth scopes requested are a subset of name, email
  address, and user profile (through the userinfo.email, userinfo.profile, openid scopes, or their
  OpenID Connect equivalents)."
  https://developers.google.com/identity/protocols/oauth2 (§ Refresh token expiration). The same rule
  is in https://support.google.com/cloud/answer/15549945. So with `webmasters*` scopes the token dies
  after 7 days in Testing.
- **Other ways a refresh token dies** (https://developers.google.com/identity/protocols/oauth2):
  - The user revoked access.
  - Unused for **six months**.
  - Password change (Gmail scopes only).
  - Too many live refresh tokens: **100 per Google Account per OAuth client ID**, and "creating a new
    refresh token automatically invalidates the oldest ... without warning".
  - Time-based access expired.
  - Admin restriction (`admin_policy_enforced`).
  - GCP session-control policy.
- **The OAuth client itself is deleted after six months of inactivity.** You get an email 30 days
  before, and deleted clients can be restored within 30 days
  (https://support.google.com/cloud/answer/15549257 § Unused Client Deletion). A rarely used personal
  CLI can hit this. The CLI should report `deleted_client` clearly.
- **"In production", unverified, personal use:**
  - https://support.google.com/cloud/answer/13464323: "Personal Use apps: If the app is for your
    personal use (fewer than 100 users), you and your limited number of users can continue using the
    app without going through verification (users will be allowed to click through 'unverified app'
    warning screens during sign-in)."
  - https://support.google.com/cloud/answer/15549945: the user cap is "100 new users in total, after
    the app presents the unverified app screen." It "applies over the entire lifetime of the project,
    and it cannot be reset."
  - https://support.google.com/cloud/answer/7454865: the unverified screen is shown only for sensitive
    or restricted scopes.
  - The production rules above contain no 7-day expiry, so the normal rules apply (six months unused
    and so on).
- **Sensitivity of `webmasters` / `webmasters.readonly`: not confirmed from a primary source.** The
  scopes reference lists both with descriptions but no sensitivity marker
  (https://developers.google.com/identity/protocols/oauth2/scopes). Sensitivity "is indicated in the
  Google Cloud Console" (same page). A secondary source claims `webmasters.readonly` was reclassified
  as non-sensitive in 2024. I did not use it. Validate on the Data Access page.

### A4. Creating the OAuth client

- Path: Google Auth Platform **Clients** page → **CREATE CLIENT** → Application type → **Create**.
  "The console does not require any additional information to create OAuth 2.0 credentials for
  desktop applications." https://support.google.com/cloud/answer/15549257
- The native-app guide gives the application-type label "**Desktop app**": "Set the application type
  to Desktop app" (https://developers.google.com/identity/protocols/oauth2/native-app § Loopback IP
  address). For a Desktop client, loopback redirects need no pre-registration beyond the client type.
  The guide gives the redirect as `http://127.0.0.1:port` or `http://[::1]:port` and says to listen
  on a random available port.
- **Secret visibility:** "Your application's client secret will only be shown after you create the
  client. Store this information in a secure place ... because it will not be visible or accessible
  again."
  - "This feature is currently available for new clients created after June 2025 and will be extended
    to existing clients starting November 2025."
  - "After the initial creation, the Google Cloud Console will only display the last four characters
    of the client secret."
  - "If you lose your client secret, you can use the client secret rotation feature." Rotation: client
    details → **Add Secret**, at most 2 secrets.

  Source: https://support.google.com/cloud/answer/15549257
- **Downloaded JSON shape.** Google's `client_secrets` format doc (Google-owned repo, legacy) gives a
  top-level `installed` object. Mandatory: `client_id`, `client_secret`, `redirect_uris`, `auth_uri`,
  `token_uri`. Optional: `auth_provider_x509_cert_url` and others.
  https://github.com/googleapis/google-api-python-client/blob/main/docs/client-secrets.md
  That doc's example still lists the dead OOB redirect and the old `accounts.google.com/o/oauth2/token`
  token URI, so it is out of date. **Parse `installed.client_id` and `installed.client_secret` only.
  Hard-code the token endpoint to `https://oauth2.googleapis.com/token` and do not trust `token_uri`.**
  The exact current download (e.g. whether `project_id` is present) is listed under Unverified.
- Public vs private clients: "Native apps ... cannot securely store secrets ... and as such do not use
  client secrets" (https://support.google.com/cloud/answer/15549257). Yet Desktop clients are still
  issued a secret. Treat it as non-confidential: "the client secret is obviously not treated as a
  secret" (https://developers.google.com/identity/protocols/oauth2).

### A5. Installed-app flow for a CLI

All of this is from https://developers.google.com/identity/protocols/oauth2/native-app unless noted.

1. **PKCE.**
   - `code_verifier`: 43–128 chars from `[A-Za-z0-9-._~]`.
   - `code_challenge = BASE64URL(SHA256(verifier))` with no padding, and
     `code_challenge_method=S256`. `plain` is also accepted, and it is the default if the method is
     omitted.
2. **Authorization request** to `https://accounts.google.com/o/oauth2/v2/auth` with:
   - `client_id`
   - `redirect_uri=http://127.0.0.1:PORT`
   - `response_type=code`
   - `scope` (space-delimited)
   - `code_challenge`, `code_challenge_method`
   - `state` (recommended, for CSRF)
   - `login_hint` (optional)

   Other notes:
   - Incremental authorization is **not** supported for installed apps.
   - `localhost` also works but "may cause issues with client firewalls". Prefer `127.0.0.1`.
   - After the redirect, show an HTML page telling the user to close the tab.
3. **`access_type` / `prompt`.** The native-app parameter table does **not** list `access_type`.
   "Note that refresh tokens are always returned for installed applications." `prompt=consent` is
   mentioned as the way to force a *new* refresh token when one already exists. Recommendation: send
   `prompt=consent` on re-login, and don't rely on `access_type=offline`. Sending it anyway is
   probably harmless; see Validation.
4. **Code exchange:** `POST https://oauth2.googleapis.com/token` (form-encoded) with:
   - `client_id`
   - `client_secret` (documented **Optional**)
   - `code`
   - `code_verifier`
   - `grant_type=authorization_code`
   - `redirect_uri`

   The response has `access_token`, `expires_in` (sample 3920 s), `refresh_token`, `scope`,
   `token_type=Bearer`, and `refresh_token_expires_in` (only for time-based access). Check `scope`
   because granular consent may grant fewer scopes than requested.
5. **Refresh:** same endpoint, with `client_id`, `client_secret` (Optional), `grant_type=refresh_token`
   and `refresh_token`.
6. **DPoP** (optional, recommended). An ES256 proof in a `DPoP` header binds the *refresh token* to a
   key; access tokens stay `Bearer`. It adds complexity (nonce handling, raw R|S signatures). Skip it
   for v1 of a personal CLI.
7. **Revocation:** `POST https://oauth2.googleapis.com/revoke?token=...`. It accepts an access or
   refresh token, and revoking an access token also revokes its refresh token. "Revocation removes all
   OAuth 2.0 scopes previously granted to a project ... for all clients registered under that
   project."
8. **Error codes worth mapping to messages:**
   - `invalid_grant`: refresh token expired or revoked, which covers the 7-day Testing case.
   - `redirect_uri_mismatch`
   - `org_internal`
   - `deleted_client`
   - `admin_policy_enforced`
   - `access_denied`
9. **OOB / manual copy-paste:** "no longer supported". Blocked for new clients on 2022-02-28 and for
   all clients on 2023-01-31. Desktop clients must use loopback.
   https://developers.google.com/identity/protocols/oauth2/resources/oob-migration
10. **The gcloud ADC shortcut does not avoid creating a client.** For non-Cloud scopes, `gcloud auth
    application-default login --scopes=...` needs `--client-id-file` (your own OAuth client). "To add
    scopes for applications outside of Google Cloud Platform ... create an OAuth Client ID and provide
    it by using the --client-id-file flag."
    https://cloud.google.com/sdk/gcloud/reference/auth/application-default/login

### A6. Scopes and which methods need write access

Scopes (https://developers.google.com/webmaster-tools/v1/how-tos/authorizing; [DISC] `auth.oauth2.scopes`):
- `https://www.googleapis.com/auth/webmasters`: "Read/write access."
- `https://www.googleapis.com/auth/webmasters.readonly`: "Read-only access."

Per-method scopes from [DISC] `methods.*.scopes`:

| Method | HTTP | `webmasters.readonly` OK? |
|---|---|---|
| `sites.list` | GET `webmasters/v3/sites` | yes |
| `sites.get` | GET `webmasters/v3/sites/{siteUrl}` | yes |
| `sites.add` | PUT `webmasters/v3/sites/{siteUrl}` | **no, needs `webmasters`** |
| `sites.delete` | DELETE `webmasters/v3/sites/{siteUrl}` | **no, needs `webmasters`** |
| `sitemaps.list` | GET `webmasters/v3/sites/{siteUrl}/sitemaps` | yes |
| `sitemaps.get` | GET `.../sitemaps/{feedpath}` | yes |
| `sitemaps.submit` | PUT `.../sitemaps/{feedpath}` | **no, needs `webmasters`** |
| `sitemaps.delete` | DELETE `.../sitemaps/{feedpath}` | **no, needs `webmasters`** |
| `searchanalytics.query` | POST `webmasters/v3/sites/{siteUrl}/searchAnalytics/query` | yes |
| `urlInspection.index.inspect` | POST `v1/urlInspection/index:inspect` | yes |
| `urlTestingTools.mobileFriendlyTest.run` | POST `v1/urlTestingTools/mobileFriendlyTest:run` | no scopes listed (API-key based); retired, see C |

Design implication: default to `webmasters.readonly`. Request `webmasters` only for a `sitemaps
submit/delete` or `sites add/delete` subcommand.

## B. Service-account path

### B1. Create the SA and a JSON key

**Create the SA** (https://cloud.google.com/iam/docs/service-accounts-create):
1. *Create service account* page (`https://console.cloud.google.com/projectselector/iam-admin/serviceaccounts/create`).
2. Select project.
3. Enter the service account name. The ID is generated from it and "You cannot change the ID later".
4. Optional: description.
5. Either click **Done**, or **Create and continue** → optional roles → **Continue**.

No IAM role is needed for Search Console; access is granted inside Search Console (B3).

**Create a key** (https://cloud.google.com/iam/docs/keys-create-delete):
1. *Service accounts* page (`https://console.cloud.google.com/iam-admin/serviceaccounts`).
2. Select project.
3. Click the SA's email.
4. **Keys** tab.
5. **Add key** drop-down → **Create new key**.
6. Key type **JSON** → **Create**.

"After you download the key file, you cannot download it again." A new key may need "60 seconds or
more" before use, so retry with backoff. The role needed is Service Account Key Admin
(`roles/iam.serviceAccountKeyAdmin`); a project Owner has it.

**Key JSON format** (same page):

```json
{
  "type": "service_account",
  "project_id": "PROJECT_ID",
  "private_key_id": "KEY_ID",
  "private_key": "-----BEGIN PRIVATE KEY-----\nPRIVATE_KEY\n-----END PRIVATE KEY-----\n",
  "client_email": "SERVICE_ACCOUNT_EMAIL",
  "client_id": "CLIENT_ID",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://accounts.google.com/o/oauth2/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/SERVICE_ACCOUNT_EMAIL"
}
```

The `BEGIN PRIVATE KEY` label (not `BEGIN RSA PRIVATE KEY`) means an unencrypted **PKCS#8** key. That
is the format WebCrypto `importKey('pkcs8', …)` accepts. The WebCrypto half of this is platform
knowledge, not a Google source; check it in bun (Validation).

**Org policy:**
- "If this constraint is enforced for your project, you can't create service account keys in that
  project. **Note: If your organization was created on or after May 3, 2024, this constraint is
  enforced by default.**" Constraint: `iam.disableServiceAccountKeyCreation`.
  https://cloud.google.com/iam/docs/keys-create-delete
- The "Google Cloud security baseline" is enforced for "all organizations created on or after May 3,
  2024. Some organizations created between February 2024 and April 2024 might also have these default
  policy enforcements set." It lists the managed constraint
  `constraints/iam.managed.disableServiceAccountKeyCreation` and also key *upload* blocking.
  https://cloud.google.com/resource-manager/docs/secure-by-default-organizations
- The constraints reference lists both the legacy `constraints/iam.disableServiceAccountKeyCreation`
  ("By default, service account external keys can be created by users based on their Cloud IAM
  roles") and the managed variant. Both are "automatically provisioned as part of Google Cloud
  security baseline". https://docs.cloud.google.com/organization-policy/reference/org-policy-constraints
- **What a personal @gmail.com project without an org sees:**
  - Projects can be created with parent "No organization"
    (https://cloud.google.com/resource-manager/docs/creating-managing-projects).
  - A constraint with no policy anywhere in the ancestry falls back to its "Google-managed default
    behavior". Only the constraints in the listed table restrict by default, and the key-creation
    constraints are **not** in that table
    (https://docs.cloud.google.com/organization-policy/reference/org-policy-constraints).
  - **Inference:** key creation works in a no-org personal project. Workspace or Cloud Identity
    accounts whose org was created after 2024-05-03 will hit the block, and need an Org Policy
    Administrator to add a tag-based exemption (https://cloud.google.com/iam/docs/keys-create-delete).
- Also in the Google-managed-default table: `constraints/iam.serviceAccountKeyExposureResponse`
  (acts on keys detected as publicly exposed). Never commit the key.

### B2. JWT-bearer flow without libraries

Source: https://developers.google.com/identity/protocols/oauth2/service-account

- **Header:** `{"alg":"RS256","typ":"JWT","kid":"<private_key_id>"}`. RS256 is the only supported
  algorithm. `kid` is optional. If it is wrong, Google tries all of the SA's keys.
- **Claims:**
  - `iss` = `client_email`
  - `scope` = space-delimited scopes (e.g. `https://www.googleapis.com/auth/webmasters.readonly`)
  - `aud` = `https://oauth2.googleapis.com/token`
  - `iat` = now (epoch seconds)
  - `exp` ≤ `iat` + 3600
  - No `sub`. `sub` is only for Workspace domain-wide delegation, which is irrelevant here.
- **Signing:** `base64url(header) + "." + base64url(claims)`, signed RSA SHA-256, signature
  base64url-appended.
- **Token request:** `POST https://oauth2.googleapis.com/token`, form-encoded:
  `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<JWT>`.
- **Response:** `{"access_token", "scope", "token_type":"Bearer", "expires_in":3600}`. There is no
  refresh token; mint a new JWT when the token expires.
- Google "strongly recommend[s]" client libraries over hand-rolled JWTs. That is a recommendation, not
  a requirement.

### B3. Grant the SA access to a Search Console property

**Current UI path** (https://support.google.com/webmasters/answer/2451999):
1. Open the property in Search Console (`https://search.google.com/search-console`).
2. **Settings > Users and permissions**. The page is visible only to property owners.
3. **Add user**.
4. Enter the Google Account email (here, the SA `client_email`).
5. Choose the permission level.
6. Save.

Limits: 100 non-owner users per property. "An email group cannot be added as a user."

**Conflicting older path.** The Indexing API prereqs still describe "In the Verified owner list, click
**Add an owner**" and adding the SA as a *delegated owner*
(https://developers.google.com/search/apis/indexing-api/v3/prereqs). That reads like the legacy UI.
Treat *Settings > Users and permissions > Add user* (permission **Owner** if delegated ownership is
wanted) as current.

**Known issue (unconfirmed status).** A Search Central Community guide is titled "Issues Adding
Service User Accounts to Search Console - Failed to add user: email address not found"
(https://support.google.com/webmasters/community-guide/429538961/). The body is JS-rendered and I could
not read it, so its date, status and workaround are unknown. The SA path must be validated live.

**Permission levels.** API enum values [DISC `WmxSite.permissionLevel`]: `SITE_OWNER`,
`SITE_FULL_USER`, `SITE_RESTRICTED_USER`, `SITE_UNVERIFIED_USER`. The help-center table
(https://support.google.com/webmasters/answer/2451999), parsed from the page's icons:

| Feature | Owner | Full | Restricted |
|---|---|---|---|
| Performance (Search Analytics) | yes | yes | yes |
| Submit sitemap | yes | yes | — |
| URL Inspection | yes | yes | "Fetch only" |
| Index Coverage | yes | yes | View only |
| Add users / add-remove owners | yes | — | — |
| View all reports | yes | yes | yes |

**Mapping to API methods.** The API docs say only: "Your account must have the appropriate Search
Console permission on a given property in order to call that method ... in order to run
searchAnalytics.query you need read permissions"
(https://developers.google.com/webmaster-tools/v1/prereqs). Inferred from the UI table:
- `searchanalytics.query`, `sitemaps.list/get`, `sites.get`: any level.
- `sitemaps.submit/delete`: Full or Owner.
- `urlInspection.index.inspect`: Full or Owner is safe. What Restricted "Fetch only" means for the API
  is **unconfirmed**.

**Recommendation:** grant the SA **Full** (read + sitemap submit). Use Restricted for read-only
reporting only after validating that it covers what you need.

### B4. Keyless alternatives (brief)

- **SA impersonation.**
  - The human's own credentials (roles/iam.serviceAccountTokenCreator on the SA) mint a short-lived SA
    token: `POST https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/SA:generateAccessToken`
    with `scope` and `lifetime`. Default max lifetime is 1 h; up to 12 h via
    `constraints/iam.allowServiceAccountCredentialLifetimeExtension`. Needs
    `iamcredentials.googleapis.com` enabled.
    https://cloud.google.com/iam/docs/create-short-lived-credentials-direct
  - gcloud: `--impersonate-service-account`, or `gcloud auth application-default login
    --impersonate-service-account SA`.
    https://cloud.google.com/docs/authentication/use-service-account-impersonation
  - This avoids key files entirely, and it is the answer when org policy blocks keys. It still needs
    a user credential with a cloud-platform scope (gcloud) to call IAM Credentials.
- **Workload Identity Federation.** Recommended over keys for workloads outside Google Cloud, such as
  CI (https://cloud.google.com/iam/docs/keys-create-delete intro). Relevant only if the CLI runs in
  CI (e.g. a GitHub Actions OIDC token). Out of scope for interactive onboarding.

## C. API surface

### C1. Hosts and paths

- The discovery `rootUrl` is `https://searchconsole.googleapis.com/`. Method paths are
  `webmasters/v3/...` for sites, sitemaps and searchanalytics, and `v1/...` for URL inspection and the
  testing tools [DISC].
- The reference pages still show `https://www.googleapis.com/webmasters/v3/...`
  (https://developers.google.com/webmaster-tools/v1/api_reference_index).
- Recommendation: use `https://searchconsole.googleapis.com/webmasters/v3/...` and
  `https://searchconsole.googleapis.com/v1/...`. Both hosts should work; see Validation.

### C2. Site URL formats and encoding

- URL-prefix property: `https://www.example.com/`, with protocol and trailing slash. Domain property:
  `sc-domain:example.com`. https://developers.google.com/webmaster-tools/v1/sites and [DISC]
  `sites.get.parameters.siteUrl`.
- For URL inspection: "URL-prefix properties must include a trailing / mark"
  (https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect).
- **Path encoding.** Google's example percent-encodes the whole siteUrl:
  `.../sites/https%3A%2F%2Fwww.example.com%2F/searchAnalytics/query`
  (https://developers.google.com/webmaster-tools/v1/api_reference_index). A 2020 example leaves the
  domain form unencoded: `.../sites/sc-domain:example.com/sitemaps`
  (https://developers.google.com/search/blog/2020/12/search-console-api-updates).
- For sitemaps, `feedpath` is a full URL (`http://www.example.com/sitemap.xml`) and must be encoded the
  same way [DISC].
- Recommendation: `encodeURIComponent(siteUrl)` and `encodeURIComponent(feedpath)` for path segments.
  For `urlInspection`, `siteUrl` goes in the JSON body with no encoding.

### C3. Methods

**sites** [DISC; https://developers.google.com/webmaster-tools/v1/sites]
- `list` → `{siteEntry:[{siteUrl, permissionLevel}]}`.
- `get` → `{siteUrl, permissionLevel}`.
- `add` (PUT, empty body) adds a site to the user's set. Verification is separate. An added-but-
  unverified site shows `SITE_UNVERIFIED_USER`.
- `delete`.

**sitemaps** [DISC]
- `list?sitemapIndex=<url>` → `{sitemap:[WmxSitemap]}`.
- `get` → WmxSitemap, with fields:
  - `path`
  - `type`: SITEMAP | URL_LIST | RSS_FEED | ATOM_FEED | NOT_SITEMAP | PATTERN_SITEMAP | OCEANFRONT
  - `isPending`, `isSitemapsIndex`
  - `lastSubmitted`, `lastDownloaded`
  - `errors`, `warnings` (int64 as string)
  - `contents[]` of `{type: WEB|IMAGE|VIDEO|NEWS|MOBILE|ANDROID_APP|IOS_APP|…, submitted, indexed}`.
    `indexed` is "*Deprecated; do not use.*"
- `submit` (PUT, no body).
- `delete`: "Does not stop Google from crawling this sitemap."
- Domain properties are supported
  (https://developers.google.com/search/blog/2020/12/search-console-api-updates).

**searchanalytics.query.** Request body; sources are
https://developers.google.com/webmaster-tools/v1/searchanalytics/query and [DISC
`SearchAnalyticsQueryRequest`].

| Field | Values / rules |
|---|---|
| `startDate`, `endDate` | Required, `YYYY-MM-DD`, **PT** (UTC-7/-8), inclusive, start ≤ end |
| `dimensions[]` | `date`, `query`, `page`, `country` (ISO 3166-1 alpha-3), `device` (DESKTOP/MOBILE/TABLET), `searchAppearance`, `hour`. No limit on count; no dimension twice |
| `type` | `web` (default; the "All" tab, excluding Discover/News), `image`, `video`, `news` (News tab in Search), `discover`, `googleNews` (news.google.com + News apps). `searchType` is "Deprecated, use type instead" |
| `dimensionFilterGroups[]` | All groups ANDed. `groupType`: only `and` ("or ... not yet supported") |
| `filters[].dimension` | `country`, `device`, `page`, `query`, `searchAppearance` (no `date`/`hour` filter) |
| `filters[].operator` | `equals` (default; case-sensitive for page/query), `notEquals`, `contains`, `notContains` (both case-insensitive), `includingRegex`, `excludingRegex` (**RE2**) |
| `filters[].expression` | "Max length 4096 characters" |
| `aggregationType` | `auto` (default), `byPage`, `byProperty`, `byNewsShowcasePanel`. You can't use `byProperty` when grouping or filtering by page, or with `discover` / `googleNews`. `byNewsShowcasePanel` needs a `NEWS_SHOWCASE` searchAppearance filter plus `type=discover` or `googleNews`, with no page group or filter. An invalid combination returns an error; "The API will never change your aggregation type" |
| `rowLimit` | 1–25,000, default 1,000 |
| `startRow` | ≥0, default 0; past the end = 200 with zero rows |
| `dataState` | `final` (default), `all` (includes fresh/partial), `hourly_all` (required for `hour`) |

Response:
- `rows[]` of `{keys[], clicks, impressions, ctr (0–1), position}`, plus `responseAggregationType`.
- `metadata.first_incomplete_date` (when dataState=all and grouped by date) or
  `first_incomplete_hour` (hourly_all + hour), in America/Los_Angeles. [DISC `Metadata`]
- Sort order: clicks descending, or date ascending when grouped by date.
- "The API ... does not guarantee to return all data rows but rather top ones."

**Hourly** (new, 2025-04-09): the `HOUR` dimension plus the `HOURLY_ALL` dataState. "The API will
return data for up to 10 days with an hourly breakdown." Keys look like `2025-04-07T00:00:00-07:00`.
https://developers.google.com/search/blog/2025/04/san-hourly-data. [DISC] also notes "Data is
available up to 10 days."

**searchAppearance values:** discover them at runtime ("run a query grouped by searchAppearance").
"Search appearance is not available as a column along with any other dimensions", so use a two-step
query: first list the appearance types, then filter by one.
https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data. Documented Discover and News
values include `AMP_TOP_STORIES`, `NEWS_SHOWCASE` and `AMP_STORY`
(https://support.google.com/webmasters/answer/9216516,
https://support.google.com/webmasters/answer/10083653).

**Discover / Google News specifics (UI docs).**
- Discover metrics are impressions, clicks and CTR, with no position. Dimensions are page, country,
  date and Discover appearance, with no query
  (https://support.google.com/webmasters/answer/9216516).
- Google News adds device (https://support.google.com/webmasters/answer/10083653).
- What the API returns for `query`/`position` with these types is not documented. See Validation.

**urlInspection.index.inspect**
(https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect; [DISC]):
- Request: `{inspectionUrl (required, must be under siteUrl), siteUrl (required), languageCode
  (optional BCP-47, default en-US)}`.
- "Presently only the status of the version in the Google index is available; you cannot test the
  indexability of a live URL." The API cannot "request indexing" either.
- Response `inspectionResult`:
  - `inspectionResultLink`
  - `indexStatusResult`:
    - `verdict`: PASS / FAIL / NEUTRAL / PARTIAL(unused)
    - `coverageState` (human string, e.g. "Indexed, not submitted in sitemap")
    - `robotsTxtState`: ALLOWED / DISALLOWED
    - `indexingState`: INDEXING_ALLOWED / BLOCKED_BY_META_TAG / BLOCKED_BY_HTTP_HEADER
    - `pageFetchState`: SUCCESSFUL / SOFT_404 / BLOCKED_ROBOTS_TXT / NOT_FOUND / ACCESS_DENIED /
      SERVER_ERROR / REDIRECT_ERROR / ACCESS_FORBIDDEN / BLOCKED_4XX / INTERNAL_CRAWL_ERROR /
      INVALID_URL
    - `lastCrawlTime`
    - `crawledAs`: DESKTOP / MOBILE
    - `googleCanonical`, `userCanonical`
    - `sitemap[]`, `referringUrls[]`
  - `ampResult`: only for AMP pages.
  - `richResultsResult`: `verdict`, and `detectedItems[{richResultType, items[{name,
    issues[{issueMessage, severity}]}]}]`.
  - `mobileUsabilityResult`: still in the schema. The Mobile Usability report was retired on
    2023-12-01, so expect it to be empty or meaningless.
- Launch post: https://developers.google.com/search/blog/2022/01/url-inspection-api.

### C4. Data caveats

- **Retention: 16 months.** "The Search Analytics API now returns 16 months of data, just like the
  Performance report" (https://developers.google.com/search/blog/2018/06/new-url-inspection-tool-more-in-search).
  "If you'd like to extend the 16 months, you could use the Search Analytics API or bulk data exports
  to pull data and store it in your systems"
  (https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops).
- **Freshness:** "Data is typically available after 2-3 days". To find the latest available date, run
  a query grouped by date over the past 10 days. `dataState=all` gives fresh, partial data.
  https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- **Row cap:** "maximum of 50K rows of data per day per search type ... sorted by clicks". Page with
  `startRow` in steps of 25,000 until a response has 0 rows. Recommended pattern: one query per day,
  for one day, per type. https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data.
  The 2022 deep-dive phrases it as "50,000 rows per day per site per search type". It also says
  queries without query or URL dimensions return all data
  (https://developers.google.com/search/blog/2022/10/performance-data-deep-dive).
- **Anonymized queries:** "queries that aren't issued by more than a few dozen users over a
  two-to-three month period". They are omitted from rows, but included in totals "unless you filter
  by query". Any filter drops them, so `contains X` plus `notContains X` does not add up to the total.
  https://developers.google.com/search/blog/2022/10/performance-data-deep-dive
- **Page and query grouping drops data:** "When you group by page and/or query, our system may drop
  some data." For accurate totals, omit page and query.
  https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data
- **Property vs page aggregation** changes the numbers. In the UI, query, country, device and date
  are aggregated by property; page and search appearance by page.
  https://support.google.com/webmasters/answer/7576553
- **Bulk alternative for big sites:** the BigQuery bulk export gives "all the performance data
  available ... with the exception of anonymized queries".
  https://support.google.com/webmasters/answer/12918484

### C5. Quotas

Source: https://developers.google.com/webmaster-tools/limits

- **Search Analytics load quota.**
  - Short-term load is measured in 10-minute chunks; if you exceed it, wait 15 minutes.
  - Long-term load is measured in 1-day chunks.
  - Page+query grouping or filtering is the most expensive. Cost grows with date range. Don't
    re-query the same data.
- **Search Analytics QPS quota:**
  - Per site: 1,200 QPM.
  - Per user: 1,200 QPM.
  - Per project: 40,000 QPM and 30,000,000 QPD.
- **URL Inspection:**
  - Per site: 2,000 QPD and 600 QPM.
  - Per project: 15,000 QPM and 10,000,000 QPD.
- **Everything else** (sites, sitemaps):
  - Per user: 20 QPS and 200 QPM.
  - Per project: 100,000,000 QPD.
- Every limit returns the same "quota exceeded" error. Usage shows in the project's quota tab.
- Implication: batch URL inspection must stop at 2,000 per property per day (Pacific day assumed; see
  Unverified), and pace at ≤10/s.

### C6. Not supported, one line each

- **Mobile-Friendly Test API:** retired. "Starting December 1, 2023, we'll be retiring Search
  Console's 'Mobile Usability' report, the Mobile-Friendly Test tool and Mobile-Friendly Test API"
  (https://developers.google.com/search/blog/2023/04/page-experience-in-search). The method is still
  in [DISC], but its reference page now returns 404 and the API reference index no longer lists it.
  Point users to Lighthouse or PageSpeed Insights instead.
- **Indexing API ("request indexing"):** "can only be used to crawl pages with either JobPosting or
  BroadcastEvent embedded in a VideoObject"
  (https://developers.google.com/search/apis/indexing-api/v3/quickstart). Default quota is 200
  publish requests per day, and further use needs approval
  (https://developers.google.com/search/apis/indexing-api/v3/quota-pricing). The Search Console API
  has no request-indexing method.
- **Generative-AI performance reports** (AI Overviews / AI Mode; launched 2026-06-03, all sites
  2026-08-31): UI and export only in the docs I found
  (https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports,
  https://support.google.com/webmasters/answer/16984139). Discovery rev 20260916 has no new `type`
  or dimension for them.
- **Links, Page-indexing (coverage) report, Core Web Vitals, manual actions, removals:** not
  resources in [DISC]. The API has only sites, sitemaps, searchanalytics, urlInspection and
  urlTestingTools.

## D. Practitioner features the API supports

Each item names the API capability that makes it possible.

- **Period comparison (WoW/MoM/YoY):**
  - Two `searchanalytics.query` calls with the same dimensions and different date ranges, joined on
    `keys`.
  - YoY is possible because there are 16 months of data. Google's traffic-drop guide recommends a
    16-month view to spot seasonality
    (https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops).
- **Drop and spike detection:**
  - `dimensions:["date"]` time series. Use `dataState=all` with `metadata.first_incomplete_date` so
    partial days aren't flagged as drops.
  - Near-real-time: `HOUR` + `HOURLY_ALL` over up to 10 days, which makes a "same weekday last week"
    comparison possible, as Google's own post suggests
    (https://developers.google.com/search/blog/2025/04/san-hourly-data).
- **Drop attribution:** break a drop down by `page`, `query`, `country`, `device` and
  `searchAppearance`, and by `type` (web / image / video / news / discover / googleNews).
- **Cannibalisation:**
  - `dimensions:["query","page"]` and find queries with more than one page getting impressions.
  - Caveats: this is the most expensive load class, and it drops data (C4/C5). Keep date ranges short
    or build it from daily pulls.
- **Striking distance / CTR outliers:**
  - Rows with average `position` in a band (e.g. 8–20) and high `impressions`.
  - Low CTR relative to position. The `position` and `ctr` fields are per row.
- **Brand vs non-brand:** `includingRegex` / `excludingRegex` (RE2) on `query`. Remember that
  filtering drops anonymized queries.
- **Anonymized-traffic share:** the no-dimension total minus the sum of query rows. This rests on
  Google's explanation that anonymized queries count in totals but not rows. It is approximate,
  because the row cap also contributes.
- **Archive beyond 16 months:** a daily one-day pull per `type`, paged by `startRow`. This is Google's
  recommended pattern, stored locally (e.g. SQLite or JSONL).
- **Sitemap health:** `sitemaps.list`, flagging `errors > 0`, `warnings > 0`, `isPending`, and stale
  `lastDownloaded`.
- **Index spot checks:** `urlInspection.index.inspect` over the top-N pages from Search Analytics, or
  over sitemap URLs, within 2,000/day/site. Flag:
  - `googleCanonical != userCanonical`
  - `verdict != PASS`
  - `indexingState` noindex
  - `robotsTxtState=DISALLOWED`
  - `pageFetchState` errors
  - stale `lastCrawlTime`
  - pages missing from `sitemap[]`
- **Property inventory and permission audit:** `sites.list` with `permissionLevel`. It also serves as
  onboarding verification: the SA or user can see the property.
- **Rich-result coverage per URL:** `richResultsResult.detectedItems` and issue severities from URL
  inspection.

## Unverified / could not confirm

1. **Sensitivity of `webmasters` / `webmasters.readonly`.** No primary page states it. This matters
   because it decides whether "In production, unverified" shows the unverified screen and the
   100-user cap. Check on the Data Access page after adding the scopes.
2. **Console URLs on `console.cloud.google.com/auth/...`.** The help articles link to
   `console.developers.google.com/auth/...`. The cloud host is assumed to be equivalent.
3. **API Library deep link** `console.cloud.google.com/apis/library/searchconsole.googleapis.com`.
   The pattern is not stated in the docs.
4. **Exact UI label of the test-users control** on the Audience page (e.g. "+ Add users"), and
   whether *Publish app* shows a confirmation dialog. The help text names the button "Publish app"
   but does not describe the test-user control.
5. **Exact current shape of the Desktop client JSON download.** Only a legacy Google-owned format
   doc exists. Whether `project_id` is present and what `redirect_uris` contains
   (`["http://localhost"]` expected) are unconfirmed.
6. **Whether a Desktop client's token exchange really works without `client_secret`.** It is
   documented as Optional. Practitioners have reported "client_secret is missing" errors, but that
   report is not from a primary source. Test it.
7. **Whether `access_type=offline` is accepted, ignored or rejected** on the installed-app flow. It
   isn't listed for native apps.
8. **Restricted-user access to `urlInspection.index.inspect` via the API.** The UI says "Fetch only".
9. **Service-account add to Search Console.** The community guide on "Failed to add user: email
   address not found" could not be read (JS-rendered); its date and status are unknown. The Indexing
   API prereqs describe an older "Verified owner list → Add an owner" UI that conflicts with the
   current help page.
10. **Key creation in a no-org personal project.** This is inferred from the constraint defaults. No
    page states it directly for @gmail.com accounts.
11. **Discover and googleNews API behaviour** for `query` / `position` / `byProperty`. Only the UI
    docs and the `byProperty` restriction are documented.
12. **Timezone of the URL Inspection daily-quota reset.** Not stated on the limits page.
13. **Whether both hosts** (`www.googleapis.com/webmasters/v3` and
    `searchconsole.googleapis.com/webmasters/v3`) are accepted. The docs show the first; the discovery
    rootUrl implies the second.

## Validation checklist

Run these against a real Google account. Record the screen labels verbatim, so the wizard and Chrome
scripts use observed text rather than the labels above.

### OAuth desktop path (personal @gmail.com, no org)

- [ ] Create a project via `console.cloud.google.com/projectcreate`. Confirm "No organization" is the
      parent and record the field labels.
- [ ] Enable the API. Open `console.cloud.google.com/apis/library/searchconsole.googleapis.com`
      (confirms Unverified #3) and confirm the tile title is "Google Search Console API". Also run
      `gcloud services enable searchconsole.googleapis.com` in a second project and confirm it
      succeeds.
- [ ] Open `console.cloud.google.com/auth/overview` **and** `console.developers.google.com/auth/overview`
      and confirm both resolve (Unverified #2). Click **GET STARTED** and record every step and field
      label (App name, User support email, Audience External, Contact information, agreement
      checkbox).
- [ ] Data Access → **ADD OR REMOVE SCOPES**, add `webmasters.readonly` and `webmasters`. **Record
      which table (non-sensitive / sensitive / restricted) each lands in** (Unverified #1).
- [ ] Clients → **CREATE CLIENT** → Application type "Desktop app" → Create. Screenshot the dialog and
      confirm the secret is shown and the JSON is downloadable **only here**. Reopen the client and
      confirm only the last 4 characters show. Save the JSON and record its exact keys (Unverified #5).
- [ ] Audience → stay in *Testing* and add your own account as a test user. Record the control label
      (Unverified #4).
- [ ] Run the CLI loopback flow on `http://127.0.0.1:<random>` with PKCE S256 and `prompt=consent`.
      Confirm the warning screen appears, and that the response has `refresh_token` and a `scope`
      containing the requested scope.
- [ ] Repeat the code exchange **without** `client_secret` and record the result (Unverified #6).
      Repeat the auth request with `access_type=offline` and record the result (Unverified #7).
- [ ] Call `sites.list`, `searchanalytics.query` (1 day, `dimensions:["date"]`), `sitemaps.list` and
      `urlInspection.index.inspect` against a URL-prefix property and an `sc-domain:` property. Check
      both encoded (`sc-domain%3Aexample.com`) and unencoded path forms, and both hosts
      (Unverified #13).
- [ ] With a `webmasters.readonly` token, call `sitemaps.submit` and confirm a 403 insufficient-scope
      error.
- [ ] Refresh the token via `grant_type=refresh_token` and confirm a new `access_token`.
- [ ] **7-day check:** keep the Testing-mode refresh token and retry after 7×24 h + 1 h. Expect
      `invalid_grant`. Put a dated reminder in the tracker.
- [ ] Audience → **Publish app** and record any dialog. Re-authorize and record whether an
      "unverified app" screen appears and what click-through labels it has (e.g. "Advanced" / "Go to
      … (unsafe)"). Keep this refresh token and confirm it still works after day 8.
- [ ] Revoke via `POST https://oauth2.googleapis.com/revoke?token=<refresh>`, then confirm refresh
      fails with `invalid_grant`.

### Service-account path

- [ ] In the same no-org project, create an SA (record the labels) → Keys → Add key → Create new key
      → JSON. Confirm the download works, which confirms Unverified #10. If you have a Workspace or
      Cloud Identity org created after 2024-05-03, repeat there and record the exact error text for
      `iam.disableServiceAccountKeyCreation` / `iam.managed.disableServiceAccountKeyCreation`.
- [ ] Confirm `private_key` begins `-----BEGIN PRIVATE KEY-----` and that bun `crypto.subtle.importKey
      ('pkcs8', der, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['sign'])` accepts it.
- [ ] Build the JWT (`iss`=client_email, `scope`=webmasters.readonly, `aud`=
      `https://oauth2.googleapis.com/token`, `exp`=iat+3600), exchange it, and confirm
      `expires_in:3600` and no refresh token. Wait 60+ seconds after key creation first.
- [ ] Before sharing the property, call `sites.list` with the SA token. Expect an empty list.
- [ ] Search Console → property → **Settings > Users and permissions > Add user** → paste the SA email
      → choose **Full** → Add. Record the exact labels and any "email address not found" error
      (Unverified #9). If it fails, try **Owner** and record the result.
- [ ] Call `sites.list` again. Expect the property with `SITE_FULL_USER`. Then `searchanalytics.query`,
      `sitemaps.submit` (with the `webmasters` scope) and `urlInspection.index.inspect`: all should
      succeed.
- [ ] Downgrade the SA to **Restricted** and retry `urlInspection.index.inspect` and `sitemaps.submit`.
      Record allow or deny (Unverified #8).
- [ ] Optional keyless check: grant yourself `roles/iam.serviceAccountTokenCreator` on the SA, then
      call `iamcredentials ... :generateAccessToken` with `scope:["https://www.googleapis.com/auth/webmasters.readonly"]`
      and use the token against `sites.list`.

### API behaviour spot checks

- [ ] `type:"discover"` with `dimensions:["query"]` and `aggregationType:"byProperty"`: record the
      errors (Unverified #11).
- [ ] `dimensions:["hour"]` with `dataState:"hourly_all"` over 10 days and over 11 days: record where
      data stops, and confirm `metadata.first_incomplete_hour`.
- [ ] A `startDate` older than 16 months: record whether it errors or returns empty.
- [ ] Paging: `rowLimit:25000`, and `startRow` beyond the end returns 200 with no `rows`.
