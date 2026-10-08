---
id: verify
type: prompt
parallel: false
---

Run the Fellow CLI's check, from this skill's folder (the parent of this `actions/` folder):

```bash
bun <fellow-skill-dir>/scripts/fellow.ts config check
```

It loads the config, resolves the API key and makes a real `/me` call. Show the user the
authenticated name, email and workspace it prints. A non-zero exit names what failed: a missing
key, an unresolvable credential reference, or the API refusing the key. Relay that line, and never
the key itself.
