"""End-to-end public helpers use only a temporary fake CLI and isolated HOME."""
import json,os,shutil,subprocess,tempfile,unittest
from pathlib import Path

SKILL=Path(__file__).resolve().parents[1]
NODE=os.environ.get("HERDR_TEST_NODE","node")
FIXTURE=Path(__file__).with_name("fake_cli.py")
MUTATIONS={("workspace","create"),("tab","create"),("pane","split"),("agent","start"),("agent","prompt"),("pane","close")}

class Helpers(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix="herdr-test-")
  self.root=Path(self.tmp.name);self.log=self.root/"calls.jsonl"
  for name in ("herdr","wsl","wsl.exe"):
   file=self.root/name;shutil.copyfile(FIXTURE,file);file.chmod(0o755)
  self.env={**os.environ,"HOME":str(self.root),"PATH":str(self.root)+os.pathsep+"/usr/bin:/bin",
            "FAKE_HERDR_LOG":str(self.log),"HERDR_PANE_ID":"inherited-wrong-pane",
            "HERDR_SESSION":"inherited-wrong-session","HERDR_SOCKET_PATH":"/wrong.sock"}
  self.addCleanup(self.tmp.cleanup)
 def calls(self):return [json.loads(x) for x in self.log.read_text().splitlines()] if self.log.exists() else []
 def commands(self):
  result=[]
  for x in self.calls():
   a=x["args"]
   if x["program"].startswith("wsl"):
    if a==["--list","--verbose"]:continue
    a=a[4:]
   if a[:1] in (["--session"],["--machine"]):a=a[2:]
   result.append(a)
  return result
 def mutations(self):return [a for a in self.commands() if "--help" not in a and "--version" not in a and (tuple(a[:2]) in MUTATIONS or a[1:2]==["rename"])]
 def run_helper(self,*args,case="normal",resolver=False,input=None,ok=True):
  self.env["FAKE_HERDR_CASE"]=case
  command=["python3",str(SKILL/"scripts/herdr_here.py")] if resolver else [NODE,str(SKILL/"scripts/herdr-agent.ts")]
  r=subprocess.run(command+list(args),cwd=self.root,env=self.env,input=input,capture_output=True,text=True,timeout=10)
  if ok:self.assertEqual(r.returncode,0,r.stderr)
  else:self.assertNotEqual(r.returncode,0,r.stdout)
  return r
 def test_public_help(self):
  self.assertIn("--prompt",self.run_helper("--help").stdout)
  self.assertEqual(self.calls(),[])
 def test_plain_text_read_is_bounded(self):
  result=json.loads(self.run_helper("read","reviewer","--json","--max-chars","64",case="long").stdout)
  self.assertEqual(len(result["text"]),64);self.assertTrue(result["truncated"])
 def test_native_start_and_prompt_once(self):
  result=json.loads(self.run_helper("start","claude","--prompt","line one\nline two","--json").stdout)
  self.assertEqual(result["reply"]["native_status"],"done");self.assertFalse(result["reply"]["task_verified"])
  prompts=[a for a in self.commands() if a[:2]==["agent","prompt"] and "--help" not in a]
  self.assertEqual(len(prompts),1);self.assertEqual(prompts[0][3],"line one\nline two")
  start=next(a for a in self.mutations() if a[:2]==["agent","start"])
  self.assertIn("--kind",start);self.assertIn("--pane",start);self.assertNotIn("--cwd",start)
 def test_public_scope_routes_and_context(self):
  for flags,prefix in [([],[]),(["--session","chosen"],["--session","chosen"]),
                       (["--machine","profile"],["--machine","profile"]),
                       (["--wsl","Private","--session","chosen"],["--session","chosen"])]:
   with self.subTest(flags=flags):
    self.log.unlink(missing_ok=True)
    self.run_helper("running",*flags,"--json")
    calls=self.calls();last=calls[-1];a=last["args"][4:] if last["program"].startswith("wsl") else last["args"]
    self.assertEqual(a[:len(prefix)],prefix)
    if flags:self.assertEqual(last["context"],{})
    if "--wsl" in flags:self.assertEqual(calls[0]["args"],["--list","--verbose"])
 def test_start_and_ask_target_prefixes_end_to_end(self):
  for flags,prefix in [(["--session","chosen"],["--session","chosen"]),(["--machine","profile"],["--machine","profile"]),(["--wsl","Private","--session","chosen"],["--session","chosen"])]:
   with self.subTest(flags=flags):
    self.log.unlink(missing_ok=True)
    self.run_helper("start","claude",*flags,"--cwd","/srv/scratch","--prompt","marker","--json")
    for call in self.calls():
     a=call["args"]
     if call["program"].startswith("wsl"):
      if a==["--list","--verbose"]:continue
      a=a[4:]
     self.assertEqual(a[:2],prefix);self.assertEqual(call["context"],{})
    self.assertEqual(len([a for a in self.mutations() if a[:2]==["agent","prompt"]]),1)
 def test_stopped_wsl_never_enters_distro(self):
  self.run_helper("running","--wsl","Private",case="stopped",ok=False)
  self.assertEqual([x["args"] for x in self.calls()],[["--list","--verbose"]])
 def test_invalid_args_have_no_cli_effects(self):
  cases=[["start","claude","--prompt","x","--lines","1001"],["start","claude","--source","bad"],
   ["start","claude","--pane","p","--cwd","/tmp"],["start","claude","--timeout","3000"],
   ["ask","reviewer","x","--lines","0"],["ask","reviewer","x","--source","bad"],
   ["running","--session","s","--machine","m"],["stop","reviewer"],["read","reviewer","--max-chars","65537"],["ask","reviewer","task","--pane","wrong"],["start","claude","extra"]]
  for args in cases:
   with self.subTest(args=args):
    self.log.unlink(missing_ok=True);self.run_helper(*args,ok=False);self.assertEqual(self.calls(),[])
 def test_empty_adapter_selectors_never_reach_cli(self):
  for value in ("", " ", "\t\n"):
   for flag in ("--session","--machine","--wsl","--herdr-bin","--pane","--anchor-pane","--workspace","--tab","--name","--kind","--cwd"):
    with self.subTest(flag=flag,value=value):
     self.log.unlink(missing_ok=True)
     self.run_helper("start","claude",flag,value,ok=False)
     self.assertEqual(self.calls(),[]);self.assertEqual(self.mutations(),[])
   for command in ("start","read","ask","stop"):
    with self.subTest(command=command,value=value):
     self.log.unlink(missing_ok=True)
     args=[command,value]+(["task"] if command=="ask" else ["--force"] if command=="stop" else [])
     self.run_helper(*args,ok=False);self.assertEqual(self.calls(),[])
 def test_empty_selector_cannot_be_overwritten_by_a_later_flag(self):
  for resolver,command in ((False,"running"),(True,"list")):
   for flag,valid in (("--session","chosen"),("--machine","profile"),("--wsl","Private"),("--herdr-bin","herdr")):
    for value in ("", " "):
     with self.subTest(resolver=resolver,flag=flag,value=value):
      self.log.unlink(missing_ok=True)
      self.run_helper(command,flag,value,flag,valid,resolver=resolver,ok=False)
      self.assertEqual(self.calls(),[])
 def test_empty_resolver_selectors_never_reach_cli(self):
  for value in ("", " ", "\t\n"):
   for flag in ("--session","--machine","--wsl","--herdr-bin","--pane","--tab"):
    for flags in ((flag,value,"list"),("list",flag,value)):
     with self.subTest(flags=flags):
      self.log.unlink(missing_ok=True);self.run_helper(*flags,resolver=True,ok=False)
      self.assertEqual(self.calls(),[]);self.assertEqual(self.mutations(),[])
   for args in (["resolve",value],["rename","new","--target",value],["rename",value]):
    with self.subTest(args=args):
     self.log.unlink(missing_ok=True);self.run_helper(*args,resolver=True,ok=False)
     self.assertEqual(self.calls(),[])
 def test_successful_prompt_then_observation_error_never_unsends_or_retries(self):
  for case,code in (("read-gone","agent_not_found"),("read-blocked","agent_blocked")):
   for args in (["ask","reviewer","task"],["start","claude","--prompt","task"]):
    with self.subTest(case=case,entry=args[0]):
     self.log.unlink(missing_ok=True)
     data=json.loads(self.run_helper(*args,case=case,ok=False).stderr)
     self.assertEqual(data["error"]["code"],code)
     self.assertTrue(data["submission_may_have_occurred"]);self.assertFalse(data["task_verified"])
     self.assertEqual(len([a for a in self.mutations() if a[:2]==["agent","prompt"]]),1)
 def test_busy_unknown_blocked_and_duplicate_never_prompt(self):
  for case,target in [("working","reviewer"),("unknown","reviewer"),("blocked","reviewer"),("normal","duplicate")]:
   with self.subTest(case=case):
    self.log.unlink(missing_ok=True);self.run_helper("ask",target,"task",case=case,ok=False)
    self.assertEqual(self.mutations(),[])
 def test_timeout_inspects_without_retry(self):
  r=self.run_helper("ask","reviewer","task",case="timeout",ok=False);data=json.loads(r.stderr)
  self.assertTrue(data["submission_may_have_occurred"]);self.assertFalse(data["task_verified"])
  self.assertEqual(len([a for a in self.mutations() if a[:2]==["agent","prompt"]]),1)
  self.assertIn("observation",data)
 def test_done_unknown_blocked_are_unverified(self):
  for case,state in [("normal","done"),("after-unknown","unknown"),("after-blocked","blocked")]:
   with self.subTest(case=case):
    r=self.run_helper("ask","reviewer","task",case=case);data=json.loads(r.stdout)
    self.assertEqual(data["native_status"],state);self.assertFalse(data["task_verified"])
 def test_old_cli_and_disconnect_do_not_create_or_fallback(self):
  for case in ["old","disconnected"]:
   with self.subTest(case=case):
    self.log.unlink(missing_ok=True);self.run_helper("start","claude","--machine","profile","--cwd","/srv/repo",case=case,ok=False)
    self.assertEqual(self.mutations(),[])
    self.assertTrue(all(x["args"][:2]==["--machine","profile"] for x in self.calls()))
 def test_duplicate_start_name_no_layout(self):
  self.run_helper("start","claude","--name","reviewer",case="duplicate-name",ok=False)
  self.assertEqual(self.mutations(),[])
 def test_existing_pane_and_native_model_arguments(self):
  config=self.root/".agents/config/herdr/config.json";config.parent.mkdir(parents=True)
  config.write_text(json.dumps({"agents":{"review":{"command":["codex","-m","fixture-model"]}}}))
  self.run_helper("start","review","--pane","explicit-pane")
  self.assertEqual(self.mutations()[0][-3:],["--","-m","fixture-model"])
  self.assertEqual(len(self.mutations()),1)
 def test_config_public_write_check_show(self):
  c={"version":1,"agents":{"review":{"command":["claude"],"env":{"SECRET_FIXTURE":"hidden"}}}}
  self.run_helper("config","write","global",input=json.dumps(c))
  self.assertFalse(json.loads(self.run_helper("config","check").stdout)["errors"])
  show=self.run_helper("config","show").stdout;self.assertNotIn("hidden",show);self.assertIn("[redacted]",show)
  self.assertEqual(self.calls(),[])
 def test_invalid_config_never_writes(self):
  configs=[None,[],{"version":2},{"agents":[]},{"agents":{"bad":None}},
   {"defaults":{"bootTimeoutMs":3000}},{"defaults":{"readLines":1001}},
   {"agents":{"x":{"command":["claude"],"env":{"BAD-NAME":"x"}}}},
   {"agents":{"x":{"command":["claude"],"focus":"false"}}}]
  for config in configs:
   with self.subTest(config=config):
    self.run_helper("config","write","global",input=json.dumps(config),ok=False)
    self.assertFalse((self.root/".agents/config/herdr/config.json").exists());self.assertEqual(self.calls(),[])
 def test_unsupported_kind_rejected_before_layout(self):
  config=self.root/".agents/config/herdr/config.json";config.parent.mkdir(parents=True)
  config.write_text(json.dumps({"agents":{"custom":{"command":["not-a-managed-kind"]}}}))
  self.run_helper("start","custom",ok=False);self.assertEqual(self.mutations(),[])
 def test_replaced_occupant_and_blocked_race_never_retry(self):
  for case,may in [("replaced",True),("race-blocked",False),("race-not-found",True)]:
   with self.subTest(case=case):
    self.log.unlink(missing_ok=True)
    data=json.loads(self.run_helper("ask","reviewer","task",case=case,ok=False).stderr)
    self.assertEqual(data["submission_may_have_occurred"],may)
    self.assertEqual(len(self.mutations()),1);self.assertFalse(data["task_verified"])
 def test_resolver_human_and_json_interfaces(self):
  human=self.run_helper("whoami","--pane","explicit",resolver=True).stdout
  self.assertIn("workspace  project",human);self.assertIn("pane       explicit",human)
  data=json.loads(self.run_helper("whoami","--pane","explicit","--json",resolver=True).stdout)
  self.assertEqual(data["pane_id"],"explicit")
  self.assertIn("* #1",self.run_helper("list",resolver=True).stdout)
 def test_sample_config_validates(self):
  self.run_helper("config","write","global",input=(SKILL/"config.example.json").read_text())
  self.run_helper("config","check")
 def test_resolver_opaque_ids_and_explicit_rename(self):
  self.assertEqual(self.run_helper("resolve","opaque#two",resolver=True).stdout.strip(),"opaque#two")
  self.log.unlink()
  self.run_helper("rename","new-label","--what","pane","--target","chosen-pane",resolver=True)
  self.assertEqual(self.mutations(),[["pane","rename","chosen-pane","new-label"]])
 def test_resolver_ambiguity_and_foreign_current(self):
  self.run_helper("resolve","project",resolver=True,case="duplicate-label",ok=False);self.assertEqual(self.mutations(),[])
  self.log.unlink()
  self.run_helper("--machine","profile","whoami",resolver=True,ok=False)
  self.assertEqual(self.calls(),[])
 def test_resolver_target_flags_before_and_after_verb(self):
  for flags in [("--session","chosen","list"),("list","--session","chosen"),("list","--machine","profile"),("list","--wsl","Private","--session","chosen")]:
   with self.subTest(flags=flags):
    self.log.unlink(missing_ok=True);self.run_helper(*flags,resolver=True)
    calls=self.calls();last=calls[-1];a=last["args"][4:] if last["program"].startswith("wsl") else last["args"]
    self.assertIn(a[:2],[["--session","chosen"],["--machine","profile"]]);self.assertEqual(last["context"],{})
 def test_resolver_tab_and_agent_exact_targets(self):
  self.run_helper("rename","new-tab","--what","tab","--tab","tab-id",resolver=True)
  self.run_helper("rename","new-agent","--what","agent","--target","agent-name",resolver=True)
  self.assertIn(["tab","rename","tab-id","new-tab"],self.mutations());self.assertIn(["agent","rename","pane@root","new-agent"],self.mutations())
 def test_resolver_stopped_wsl(self):
  self.run_helper("list","--wsl","Private",case="stopped",resolver=True,ok=False)
  self.assertEqual([x["args"] for x in self.calls()],[["--list","--verbose"]])

if __name__=="__main__":unittest.main()
