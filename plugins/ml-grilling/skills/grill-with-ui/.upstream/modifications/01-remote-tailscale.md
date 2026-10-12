---
name: remote-tailscale
added: 2026-10-12
files: [server.mjs, SKILL.md, README.md]
---

## Modification

I run the agent on a remote Linux machine (WSL) and read the page on my Mac, both on the same
Tailscale network. Serve the grill page on the machine's Tailscale address instead of
127.0.0.1, and open it in the Mac's default browser automatically as soon as the server is
listening, on every start and resume, so I never have to copy a URL. Configuration is two
environment variables, `GRILL_HOST` (the address to bind, with `tailscale` meaning "this
machine's Tailscale IPv4") and `GRILL_OPEN` (a shell command run with the URL). With neither
set, behave exactly as upstream. Never bind `0.0.0.0` by default: the Send endpoint must not be
exposed beyond the tailnet. The skill text should say the page was opened rather than asking
the user to open it.

## Applied

- `server.mjs`: `bindHost()` reads `GRILL_HOST` (default `127.0.0.1`; `tailscale` resolves the
  first 100.64.0.0/10 IPv4 on any interface, dying with a message when there is none) and
  `serve` binds it and puts it in the url (IPv6 bracketed). The bound host is added to
  `selfOrigins`, upstream's same-origin check on `POST /send`, so the page opened on that
  address can Send; the loopback spellings stay. `openUrl()` runs `GRILL_OPEN` with the url
  as `$1` once listening, detached, stdout dropped so the agent's event stream stays clean,
  errors to stderr. A header comment documents both variables.
- `SKILL.md`: Start step 5 adds "When `GRILL_OPEN` is set, `serve` has already opened the URL
  in the user's browser; say "opened" rather than asking them to open it." before upstream's
  closing "Return to listening."
- `README.md`: section "Running the agent on a remote machine" after the `GRILL_HOME` line,
  with the Tailscale + `ssh mac open` example and the warning against `0.0.0.0`.

Run upstream's tests with `GRILL_HOST` and `GRILL_OPEN` unset: its suite spreads `process.env`
into the server it starts and expects `127.0.0.1`.
