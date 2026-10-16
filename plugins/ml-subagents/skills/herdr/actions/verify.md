---
id: verify
type: prompt
parallel: false
---

Run the herdr helper's check, from this skill's folder (the parent of this `actions/` folder):

```bash
bun <herdr-skill-dir>/scripts/herdr-agent.ts config check
```

It prints which layers were read, every preset name (the built-ins plus the configured ones) and
`errors`: presets that could not launch, such as one with no `command` or a `defaults.agent` that
names no preset. A non-zero exit means `errors` is not empty or the plan is not ready; relay those
lines. Presets hold no credential, but `config show` redacts `env` values anyway, so prefer it
over printing a layer file.

A preset that passes is only launchable on paper. Whether its binary is installed and signed in is
`herdr integration status` on the target machine, not this check.
