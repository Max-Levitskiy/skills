#!/usr/bin/env python3
"""herdr_here.py - resolve and act on the *current* (or a named) herdr workspace.

herdr's object model is nested:  session (server) > workspace > tab > pane > agent.
The single most important thing to know is that what a person calls "this session"
is usually the WORKSPACE - the per-worktree unit that carries the label you see in
the sidebar (e.g. "traefik-https" or an auto-codename like "brave-river-06c0").

`herdr session` is a different thing: a named background server with its own socket
and its own workspace tree. Those are real and plural - users run one per project,
and "default" is often stopped - but this script only ever addresses the session its
own pane belongs to. Run `herdr session list` when a workspace seems to be missing.

The fiddly part of driving herdr is turning "this one" / "the X workspace" into the
right id. That's this script's whole job. herdr's own CLI already does the verbs
(rename/focus/close/create) well, so once you have an id you can call it directly.

Anchoring "current": prefer $HERDR_PANE_ID -> `herdr pane get` (exact, even from a
subdirectory or a detached cwd). Fall back to matching $PWD against each workspace's
worktree checkout path.

Usage:
  herdr_here.py whoami [--json]
  herdr_here.py list [--json]
  herdr_here.py resolve [<selector>] [--json]
  herdr_here.py rename <new-name> [--what workspace|tab|pane|agent] [--target <selector>]

<selector> (default "current"):
  current | . | here     the workspace this script is running inside
  <label>                a workspace whose sidebar label matches exactly
  w<hex>                 a workspace id (used as-is)
"""
import argparse
import json
import os
import subprocess
import sys


def herdr(*args):
    """Run a herdr CLI command and return the parsed JSON envelope's `result`."""
    proc = subprocess.run(
        ["herdr", *args], capture_output=True, text=True
    )
    if proc.returncode != 0:
        sys.exit(f"herdr {' '.join(args)} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    out = proc.stdout.strip()
    if not out:
        return {}
    try:
        return json.loads(out).get("result", {})
    except json.JSONDecodeError:
        sys.exit(f"could not parse herdr output as JSON:\n{out}")


def list_workspaces():
    return herdr("workspace", "list").get("workspaces", [])


def current_pane():
    """Resolve the pane this process runs in, or None if it can't be determined."""
    pane_env = os.environ.get("HERDR_PANE_ID")
    if pane_env:
        pane = herdr("pane", "get", pane_env).get("pane")
        if pane:
            return pane
    # Fallback: match $PWD against workspace checkout paths (longest prefix wins).
    cwd = os.getcwd()
    best = None
    for ws in list_workspaces():
        path = (ws.get("worktree") or {}).get("checkout_path")
        if path and (cwd == path or cwd.startswith(path.rstrip("/") + "/")):
            if best is None or len(path) > len(best[0]):
                best = (path, ws)
    if best:
        ws = best[1]
        return {
            "workspace_id": ws["workspace_id"],
            "tab_id": ws.get("active_tab_id"),
            "pane_id": None,
            "cwd": cwd,
            "agent": None,
        }
    return None


def resolve_workspace(selector):
    """Return the full workspace dict for a selector. Exits with guidance on miss."""
    selector = (selector or "current").strip()
    if selector in ("current", ".", "here"):
        pane = current_pane()
        if not pane:
            sys.exit(
                "could not determine the current workspace ($HERDR_PANE_ID unset and "
                "no workspace checkout path matches the cwd). Pass a label or id instead."
            )
        wsid = pane["workspace_id"]
        ws = herdr("workspace", "get", wsid).get("workspace")
        return ws or sys.exit(f"workspace {wsid} not found")
    # An explicit workspace id?
    if selector.startswith("w") and ":" not in selector and "-" not in selector:
        ws = herdr("workspace", "get", selector).get("workspace")
        if ws:
            return ws
    # Otherwise treat as a label (exact match).
    matches = [w for w in list_workspaces() if w.get("label") == selector]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        labels = ", ".join(sorted(w.get("label", "?") for w in list_workspaces()))
        sys.exit(f"no workspace labeled {selector!r}. Existing labels: {labels}")
    sys.exit(
        f"{len(matches)} workspaces are labeled {selector!r}; disambiguate by id: "
        + ", ".join(w["workspace_id"] for w in matches)
    )


def fmt_ws(ws, current_id=None):
    mark = "*" if ws["workspace_id"] == current_id else " "
    repo = (ws.get("worktree") or {}).get("repo_name", "-")
    path = (ws.get("worktree") or {}).get("checkout_path", "-")
    return (
        f"{mark} #{ws.get('number'):<3} {ws.get('label',''):<28} "
        f"[{ws.get('agent_status','?'):<8}] {repo:<22} {path}"
    )


def cmd_whoami(args):
    pane = current_pane()
    if not pane:
        sys.exit("not inside a resolvable herdr workspace (no $HERDR_PANE_ID, no cwd match)")
    ws = herdr("workspace", "get", pane["workspace_id"]).get("workspace", {})
    info = {
        "workspace_id": pane["workspace_id"],
        "label": ws.get("label"),
        "number": ws.get("number"),
        "tab_id": pane.get("tab_id"),
        "pane_id": pane.get("pane_id"),
        "agent": pane.get("agent"),
        "agent_status": pane.get("agent_status"),
        "cwd": pane.get("cwd") or os.getcwd(),
        "repo": (ws.get("worktree") or {}).get("repo_name"),
    }
    if args.json:
        print(json.dumps(info, indent=2))
        return
    print(f"workspace  {info['label']}  (#{info['number']}, {info['workspace_id']})")
    print(f"tab        {info['tab_id']}")
    print(f"pane       {info['pane_id']}")
    if info["agent"]:
        print(f"agent      {info['agent']}  [{info['agent_status']}]")
    print(f"repo       {info['repo']}")
    print(f"cwd        {info['cwd']}")


def cmd_list(args):
    workspaces = list_workspaces()
    if args.json:
        print(json.dumps(workspaces, indent=2))
        return
    pane = current_pane()
    current_id = pane["workspace_id"] if pane else None
    for ws in sorted(workspaces, key=lambda w: w.get("number", 0)):
        print(fmt_ws(ws, current_id))


def cmd_resolve(args):
    ws = resolve_workspace(args.selector)
    if args.json:
        print(json.dumps(ws, indent=2))
        return
    print(ws["workspace_id"])


def cmd_rename(args):
    name = args.name
    what = args.what
    if what == "workspace":
        ws = resolve_workspace(args.target)
        old = ws.get("label")
        herdr("workspace", "rename", ws["workspace_id"], name)
        print(f"workspace {ws['workspace_id']}: {old!r} -> {name!r}")
    elif what == "tab":
        ws = resolve_workspace(args.target)
        # current tab of the resolved workspace
        if args.target in (None, "current", ".", "here"):
            pane = current_pane()
            tab_id = pane.get("tab_id") if pane else ws.get("active_tab_id")
        else:
            tab_id = ws.get("active_tab_id")
        herdr("tab", "rename", tab_id, name)
        print(f"tab {tab_id} -> {name!r}")
    elif what == "pane":
        pane = current_pane() if args.target in (None, "current", ".", "here") else None
        pane_id = (pane or {}).get("pane_id") or os.environ.get("HERDR_PANE_ID")
        if not pane_id:
            sys.exit("could not resolve a pane to rename")
        herdr("pane", "rename", pane_id, name)
        print(f"pane {pane_id} -> {name!r}")
    elif what == "agent":
        target = args.target if args.target not in (None, "current", ".", "here") else (
            os.environ.get("HERDR_PANE_ID") or (current_pane() or {}).get("pane_id")
        )
        if not target:
            sys.exit("could not resolve an agent to rename")
        herdr("agent", "rename", target, name)
        print(f"agent {target} -> {name!r}")


def main():
    p = argparse.ArgumentParser(description="resolve and act on the current/named herdr workspace")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("whoami", help="show the current workspace/tab/pane")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_whoami)

    sp = sub.add_parser("list", help="list workspaces (current marked with *)")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_list)

    sp = sub.add_parser("resolve", help="print the workspace id for a selector")
    sp.add_argument("selector", nargs="?", default="current")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=cmd_resolve)

    sp = sub.add_parser("rename", help="rename the current/named workspace (or tab/pane/agent)")
    sp.add_argument("name")
    sp.add_argument("--what", choices=["workspace", "tab", "pane", "agent"], default="workspace")
    sp.add_argument("--target", default="current", help="selector: current | <label> | <id>")
    sp.set_defaults(func=cmd_rename)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
