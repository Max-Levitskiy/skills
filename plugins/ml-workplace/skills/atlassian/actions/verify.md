---
id: verify
type: prompt
parallel: false
---

Run the Atlassian CLI's check, from this skill's folder (the parent of this `actions/` folder):

```bash
bun <atlassian-skill-dir>/scripts/atlassian.ts config check
```

It loads the config, resolves each product's token and makes a real `myself` call to Jira and to
Confluence. Show the user the identity and site it prints for each. A product reported as "not
configured" is fine when they don't use it (Confluence on Data Center without
`confluence.baseUrl`). A `FAILED` line or a non-zero exit names what failed: a missing key, an
unresolvable credential reference, or the instance refusing the token. Relay that line, and never
the token itself.
