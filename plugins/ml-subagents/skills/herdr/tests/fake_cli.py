#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
log=Path(os.environ["FAKE_HERDR_LOG"])
case=os.environ.get("FAKE_HERDR_CASE","normal")
entry={"program":Path(sys.argv[0]).name,"args":args,"context":{k:os.environ[k] for k in ["HERDR_PANE_ID","HERDR_SESSION","HERDR_SOCKET_PATH"] if k in os.environ}}
with log.open("a") as f: f.write(json.dumps(entry)+"\n")
if Path(sys.argv[0]).name in ("wsl","wsl.exe"):
 if args==["--list","--verbose"]:
  state="Stopped" if case=="stopped" else "Running"
  print("* Private  "+state+"  2\n  Other  Running  2")
  sys.exit()
 args=args[4:] # -d Private --exec executable
target="default"
if args and args[0] in ("--session","--machine"):
 target=args[1]; args=args[2:]
def out(v): print(json.dumps({"id":"fixture","result":v}));sys.exit()
def err(code): print(json.dumps({"error":{"code":code,"message":"fixture "+code}}),file=sys.stderr);sys.exit(1)
if args==["--version"]: print("herdr 0.9.3");sys.exit()
if "--help" in args:
 print("Usage: agent prompt --wait --until --timeout" if args[:2]==["agent","prompt"] and case!="old" else
       "Usage: agent start --kind --pane --timeout [possible values: claude, codex, cursor, omp]" if args[:2]==["agent","start"] else "old help")
 sys.exit()
if args==["status","server","--json"]:
 if case=="disconnected":err("unavailable")
 out({"server":{"running":True,"compatible":True,"version":"0.9.3","protocol":22,"target":target}})
ws={"workspace_id":"space@root","label":"project","active_tab_id":"tab@root","number":1,"worktree":{"checkout_path":os.getcwd()}}
other={"workspace_id":"opaque#two","label":"other","active_tab_id":"tab@two","number":2}
before=case if case in ("working","blocked","unknown") else "idle"
prior=log.read_text().splitlines()
sent=any(json.loads(x)["args"][-1:]!=["--help"] and "prompt" in json.loads(x)["args"] and "--wait" in json.loads(x)["args"] for x in prior)
agent={"pane_id":"pane@root","tab_id":"tab@root","workspace_id":"space@root","terminal_id":"term.1",
       "name":"reviewer","agent":"claude","agent_status":("unknown" if case=="timeout" and sent else before),"interactive_ready":True}
if args==["agent","list"]:
 out({"agents":[agent] if case=="duplicate-name" else []})
if args[:2]==["agent","get"]:
 if args[2]=="duplicate":err("ambiguous_target")
 if args[2]=="missing":err("not_found")
 out({"agent":agent})
if args[:2]==["agent","read"]:
 if sent and case in ("read-gone","read-blocked"):err("agent_not_found" if case=="read-gone" else "agent_blocked")
 print("x"*20000 if case=="long" else "plain text response\nsecond row");sys.exit()
if args[:2]==["agent","prompt"]:
 if case=="timeout":err("timeout")
 if case=="race-blocked":err("agent_blocked")
 if case=="race-not-found":err("agent_not_found")
 if case=="replaced":agent["terminal_id"]="term.replaced"
 agent["agent_status"]="blocked" if case=="after-blocked" else "unknown" if case=="after-unknown" else "done"
 out({"agent":agent})
if args[:2]==["agent","start"]:out({"agent":agent})
if args[:2] in (["workspace","create"],["tab","create"]):out({"workspace":ws,"root_pane":agent,"tab":{"tab_id":"tab@root"}})
if args[:2]==["pane","split"]:out({"pane":agent})
if args==["pane","list"]:out({"panes":[agent]})
if args==["workspace","list"]:
 rows=[ws,other]
 if case=="duplicate-label":other["label"]="project"
 out({"workspaces":rows})
if args[:2]==["workspace","get"]:
 out({"workspace":ws if args[2]==ws["workspace_id"] else other if args[2]==other["workspace_id"] else None})
if args[:2]==["pane","get"]:
 if args[2]=="missing":err("not_found")
 out({"pane":{**agent,"pane_id":args[2]}})
if args[:2]==["tab","get"]:out({"tab":{"tab_id":args[2]}})
if len(args)>1 and args[1] in ("rename","close"):out({"type":"ok","target":args[2]})
err("unexpected_fixture_command")
