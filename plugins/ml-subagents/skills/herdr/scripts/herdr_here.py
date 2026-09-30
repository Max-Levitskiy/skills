#!/usr/bin/env python3
"""Resolve labels/current identity on one explicit Herdr server; IDs stay opaque."""
import argparse
import json
import os
import re
import subprocess
import sys

CURRENT = {"current", ".", "here"}
CONTEXT = ("HERDR_SOCKET_PATH", "HERDR_SESSION", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID")


class Resolver:
    def __init__(self, args):
        self.args = args
        for field in ("session", "machine", "wsl", "binary", "pane", "tab", "selector", "target", "name"):
            value = getattr(args, field, None)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ValueError(field + " requires a nonempty value")
        self.session = getattr(args, "session", None)
        self.machine = getattr(args, "machine", None)
        self.wsl = getattr(args, "wsl", None)
        self.binary = getattr(args, "binary", None) or os.environ.get("HERDR_BIN_PATH", "herdr")
        self.timeout = getattr(args, "timeout", 15000)
        if self.session and self.machine:
            raise ValueError("Machine profiles already select a session")
        if not 1 <= self.timeout <= 60000:
            raise ValueError("timeout must be 1..60000 ms")
        self.scoped = bool(self.session or self.machine or self.wsl)
        self.wsl_checked = False

    def call(self, *arguments):
        env = dict(os.environ)
        if self.scoped:
            for name in CONTEXT:
                env.pop(name, None)
        prefix = ["--machine", self.machine] if self.machine else ["--session", self.session] if self.session else []
        command = [self.binary, *prefix, *arguments]
        if self.wsl:
            wsl = "wsl.exe" if os.name == "nt" else "wsl"
            if not self.wsl_checked:
                inventory = subprocess.run([wsl, "--list", "--verbose"], capture_output=True, text=True, timeout=self.timeout / 1000)
                rows = [line.strip().lstrip("*").strip() for line in inventory.stdout.replace("\0", "").splitlines()]
                row = next((x for x in rows if x.startswith(self.wsl + " ") or x.startswith(self.wsl + "\t")), "")
                if inventory.returncode or not row or row[len(self.wsl):].strip().split()[0] != "Running":
                    raise ValueError("Selected distro is absent/stopped/unknown; no command ran inside it")
                self.wsl_checked = True
            command = [wsl, "-d", self.wsl, "--exec", *command]
        proc = subprocess.run(command, capture_output=True, text=True, env=env, timeout=self.timeout / 1000)
        if proc.returncode:
            raise ValueError((proc.stderr.strip() or "Selected Herdr command failed")[:1000])
        if len(proc.stdout) > 524288:
            raise ValueError("Inventory exceeded the response budget")
        response = json.loads(proc.stdout)
        if "error" in response:
            raise ValueError(str(response["error"])[:1000])
        return response.get("result", response)

    def workspaces(self):
        return self.call("workspace", "list").get("workspaces", [])

    def current(self):
        explicit = getattr(self.args, "pane", None)
        inherited_scope_matches = not self.scoped or (
            self.session and not self.machine and not self.wsl and self.session == os.environ.get("HERDR_SESSION"))
        pane_id = explicit or (os.environ.get("HERDR_PANE_ID") if inherited_scope_matches else None)
        if pane_id:
            return self.call("pane", "get", pane_id).get("pane")
        if self.scoped:
            return None
        cwd = os.getcwd()
        matches = []
        for ws in self.workspaces():
            path = (ws.get("worktree") or {}).get("checkout_path")
            if path and (cwd == path or cwd.startswith(path.rstrip("/") + "/")):
                matches.append((len(path), ws))
        if not matches:
            return None
        depth = max(length for length, _ in matches)
        best = [ws for length, ws in matches if length == depth]
        if len(best) != 1:
            raise ValueError("Current cwd matches multiple workspaces; select an explicit ID")
        ws = best[0]
        return {"workspace_id": ws["workspace_id"], "tab_id": ws.get("active_tab_id"),
                "pane_id": None, "cwd": cwd, "agent": None}

    def workspace(self, selector):
        if selector in CURRENT:
            pane = self.current()
            if not pane:
                raise ValueError("Current is unresolved in this scope; pass a workspace ID/label or --pane")
            return self.call("workspace", "get", pane["workspace_id"]).get("workspace") or self.missing(selector)
        rows = self.workspaces()
        ids = [x for x in rows if x.get("workspace_id") == selector]
        if len(ids) == 1:
            return ids[0]
        matches = [x for x in rows if x.get("label") == selector]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError("Workspace label is ambiguous; use ID: " + ", ".join(x["workspace_id"] for x in matches))
        return self.missing(selector)

    @staticmethod
    def missing(selector):
        raise ValueError("Workspace not found: " + selector)


def nonempty_selector(value):
    if not value.strip():
        raise argparse.ArgumentTypeError("selector/value must be nonempty")
    return value


def main():
    common = argparse.ArgumentParser(add_help=False)
    for flag in ("session", "machine", "wsl", "pane", "tab"):
        common.add_argument("--" + flag, type=nonempty_selector, default=argparse.SUPPRESS)
    common.add_argument("--herdr-bin", dest="binary", type=nonempty_selector, default=argparse.SUPPRESS)
    common.add_argument("--timeout", type=int, default=argparse.SUPPRESS)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    parser = argparse.ArgumentParser(description=__doc__, parents=[common])
    subs = parser.add_subparsers(dest="command", required=True)
    for name in ("whoami", "list", "resolve", "rename"):
        sp = subs.add_parser(name, parents=[common])
        if name == "resolve":
            sp.add_argument("selector", nargs="?", type=nonempty_selector, default="current")
        if name == "rename":
            sp.add_argument("name", type=nonempty_selector)
            sp.add_argument("--what", choices=("workspace", "tab", "pane", "agent"), default="workspace")
            sp.add_argument("--target", type=nonempty_selector, default="current")
    args = parser.parse_args()
    resolver = Resolver(args)
    if getattr(args, "tab", None) and args.command != "rename":
        raise ValueError("--tab is for an explicit tab rename")
    if args.command == "rename" and getattr(args, "tab", None) and args.what != "tab":
        raise ValueError("--tab requires --what tab")
    if args.command == "rename" and not args.name.strip():
        raise ValueError("New label/name must be nonempty")
    if args.command == "rename" and args.what == "agent" and not re.fullmatch(r"[a-z][a-z0-9_-]{0,31}", args.name):
        raise ValueError("Invalid live agent name")
    if args.command == "list":
        rows = resolver.workspaces()
        if getattr(args, "json", False):
            print(json.dumps(rows, indent=2))
        else:
            pane = resolver.current() if not resolver.scoped or getattr(args,"pane",None) else None
            current_id = pane.get("workspace_id") if pane else None
            for ws in sorted(rows,key=lambda w:w.get("number") or 0):
                mark = "*" if ws["workspace_id"] == current_id else " "
                worktree = ws.get("worktree") or {}
                print(f"{mark} #{str(ws.get('number')):<3} {ws.get('label',''):<28} "
                      f"[{ws.get('agent_status','?'):<8}] {worktree.get('repo_name','-'):<22} "
                      f"{worktree.get('checkout_path','-')}")
        return
    if args.command == "resolve":
        ws = resolver.workspace(args.selector)
        print(json.dumps(ws, indent=2) if getattr(args, "json", False) else ws["workspace_id"])
        return
    if args.command == "whoami":
        pane = resolver.current()
        if not pane:
            raise ValueError("Current pane is unresolved; select its scoped --pane ID")
        ws = resolver.workspace(pane["workspace_id"])
        info = {"workspace_id":pane["workspace_id"],"label":ws.get("label"),"number":ws.get("number"),
                "tab_id":pane.get("tab_id"),"pane_id":pane.get("pane_id"),"agent":pane.get("agent"),
                "agent_status":pane.get("agent_status"),"cwd":pane.get("cwd") or os.getcwd(),
                "repo":(ws.get("worktree") or {}).get("repo_name")}
        if getattr(args,"json",False):
            print(json.dumps(info, indent=2))
        else:
            print(f"workspace  {info['label']}  (#{info['number']}, {info['workspace_id']})")
            print(f"tab        {info['tab_id']}")
            print(f"pane       {info['pane_id']}")
            if info["agent"]: print(f"agent      {info['agent']}  [{info['agent_status']}]")
            print(f"repo       {info['repo']}")
            print(f"cwd        {info['cwd']}")
        return
    selector = args.target
    if args.what == "workspace":
        target = resolver.workspace(selector)["workspace_id"]
    elif args.what == "tab":
        if getattr(args, "tab", None):
            target = resolver.call("tab", "get", args.tab)["tab"]["tab_id"]
        elif selector in CURRENT:
            pane = resolver.current()
            if not pane or not pane.get("tab_id"):
                raise ValueError("Current tab unresolved; pass --tab")
            target = pane["tab_id"]
        else:
            target = resolver.workspace(selector).get("active_tab_id")
        if not target:
            raise ValueError("No tab found")
    elif args.what == "pane":
        pane = resolver.current() if selector in CURRENT else resolver.call("pane", "get", selector).get("pane")
        if not pane or not pane.get("pane_id"):
            raise ValueError("Pane target unresolved; pass its explicit ID")
        target = pane["pane_id"]
    else:
        if selector in CURRENT:
            pane = resolver.current()
            if not pane or not pane.get("pane_id"):
                raise ValueError("Current agent unresolved; pass its name/hosting pane ID")
            selector = pane["pane_id"]
        agent = resolver.call("agent", "get", selector).get("agent")
        if not agent or not agent.get("pane_id"):
            raise ValueError("No unique live agent found")
        target = agent["pane_id"]
    resolver.call(args.what, "rename", target, args.name)
    if getattr(args,"json",False): print(json.dumps({"object": args.what, "target": target, "label": args.name}))
    else: print(f"{args.what} {target} -> {args.name!r}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error)[:1000], file=sys.stderr)
        sys.exit(1)
