#!/usr/bin/env bun
// Optional ACS preset adapter. Native CLI owns launch, prompt submission and waits.
import { agents, defaults, expandPath, layerPath, loadConfig, resolvePreset, validate, writeLayer, type Layer } from "./lib/config.ts";
import { HerdrClient, outcome, validateRead } from "./lib/herdr-client.mjs";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const HELP = `herdr-agent.ts presets|running [--json]
herdr-agent.ts start [preset] [--prompt TEXT] [--name NAME] [--kind KIND]
  [--pane ID | --anchor-pane ID | --workspace ID | --tab ID] [--split right|down]
  [--cwd PATH] [--env K=V] [--focus] [--timeout MS] [--json]
herdr-agent.ts ask TARGET TEXT [--timeout MS] [--lines N] [--max-chars N] [--json]
herdr-agent.ts read TARGET [--source visible|detection|recent|recent-unwrapped] [--lines N]
herdr-agent.ts stop TARGET --force
herdr-agent.ts config check|show|path [global|repo|local]|write LAYER
Target flags: --session NAME | --machine PROFILE; --wsl DISTRO; --herdr-bin PATH
No --remote flag: use a saved machine or run the CLI on that host.
Native start/prompt capability is required; no legacy timing/Enter retries.
Start defaults to a separate workspace. Replies are bounded screens, task_verified=false.
--raw remains accepted; marker-based reply extraction has been retired.`;

function flags(argv: string[]) {
  const f: any = { rest: [], env: [] };
  const values: Record<string,string> = { "--session":"session","--machine":"machine","--wsl":"wsl","--herdr-bin":"binary",
    "--name":"name","--kind":"kind","--pane":"pane","--anchor-pane":"anchor","--workspace":"workspace","--tab":"tab",
    "--prompt":"prompt","--split":"split","--cwd":"cwd","--timeout":"timeout","--lines":"lines","--source":"source","--max-chars":"maxChars" };
  for (let n=0;n<argv.length;n++) {
    const a=argv[n];
    if (a==="--") { f.rest.push(...argv.slice(n+1)); break; }
    if (values[a] || a==="--env") {
      const v=argv[++n]; if (v===undefined || !v.trim()) throw new Error(a+" requires a nonempty value");
      if (a==="--env") f.env.push(v); else f[values[a]]=v;
    } else if (["--json","--raw","--force","--yes","--focus","--no-focus"].includes(a)) {
      if (a==="--no-focus") f.focus=false; else f[a==="--yes"?"force":a.slice(2)]=true;
    } else if (a.startsWith("--")) throw new Error("Unknown flag "+a);
    else f.rest.push(a);
  }
  for (const k of ["timeout","lines","maxChars"]) if (f[k]!==undefined) {
    f[k]=Number(f[k]); if (!Number.isInteger(f[k]) || f[k]<1) throw new Error(k+" must be a positive integer");
  }
  if (f.timeout>3598000) throw new Error("timeout must be <=3598000 ms");
  if (f.split && !["right","down"].includes(f.split)) throw new Error("split must be right/down");
  return f;
}
const canonical: Record<string,string> = { "claude":"claude","codex":"codex","cursor-agent":"cursor","agy":"agy" };
function kindFor(preset: any, override?: string) {
  const executable=preset.command?.[0];
  if (!executable || basename(executable)!==executable) throw new Error("Managed presets require a canonical command name, not a path/wrapper");
  const kind=override || preset.kind || canonical[executable] || executable;
  if ((kind==="cursor" ? "cursor-agent" : kind)!==executable)
    throw new Error("Preset executable does not match managed --kind; use an explicit supported launch workflow");
  return kind;
}
function print(value: any, json: boolean) { console.log(json ? JSON.stringify(value,null,2) : typeof value==="string" ? value : JSON.stringify(value,null,2)); }
function configCommand(f: any) {
  const sub=f.rest[0] || "check"; const loaded=loadConfig();
  const layer=(f.rest[1] || "global") as Layer;
  if (!["global","repo","local"].includes(layer)) throw new Error("Expected global/repo/local layer");
  if (sub==="path") return console.log(layerPath(layer) || "This layer needs a Git repository");
  if (sub==="write") {
    const c=JSON.parse(readFileSync(0,"utf8")); const errors=validate(c);
    if (errors.length) throw new Error(errors.join("; "));
    return print(writeLayer(layer,{version:1,...c}),true);
  }
  if (sub==="show") {
    const safe:any={...loaded.config};
    if (safe.credentials) safe.credentials=Object.fromEntries(Object.keys(safe.credentials).map(k=>[k,"[reference omitted]"]));
    for (const group of ["agents","defaults"]) if (safe[group]) {
      safe[group]=JSON.parse(JSON.stringify(safe[group]));
      const records=group==="agents" ? Object.values(safe[group]) : [safe[group]];
      for (const record of records) { const r = record as any; if (r.env) r.env=Object.fromEntries(Object.keys(r.env).map(k=>[k,"[redacted]"])); }
    }
    return print(safe,true);
  }
  if (sub!=="check") throw new Error("Expected config check/show/path/write");
  const errors=validate(loaded.config);
  print({found:loaded.found,legacy:loaded.legacy,presets:Object.keys(agents(loaded.config)),errors},true);
  if (errors.length) process.exitCode=1;
}
function main() {
  const [sub,...argv]=process.argv.slice(2);
  if (!sub || sub==="--help" || sub==="-h") return console.log(HELP);
  const f=flags(argv);
  if (!["presets","running","start","ask","read","stop","config"].includes(sub)) throw new Error("Unknown command; use --help");
  if (f.prompt !== undefined && sub !== "start") throw new Error("--prompt is only valid with start");
  if (sub==="config") { if (f.session || f.machine || f.wsl || f.binary) throw new Error("ACS config commands are local, not server-routed"); return configCommand(f); }
  if (["pane","anchor","workspace","tab","name","kind","split","cwd"].some(k=>f[k]!==undefined) && sub!=="start")
    throw new Error("Launch/location flags are only valid with start");
  const count = sub==="running" || sub==="presets" ? 0 : sub==="start" || sub==="read" || sub==="stop" ? 1 : null;
  if (count!==null && f.rest.length>count) throw new Error("Unexpected positional arguments");
  if (["start","read","ask","stop"].includes(sub) && f.rest[0]!==undefined && !f.rest[0].trim())
    throw new Error("Preset/agent target must be nonempty");
  const loaded=loadConfig(); const errors=validate(loaded.config);
  if (errors.length) throw new Error(errors.join("; "));
  const d=defaults(loaded.config);
  let preset:any;
  if (sub==="start") preset=resolvePreset(loaded.config,f.rest[0]);
  const scope={session:f.session || (!f.machine ? preset?.session : undefined),machine:f.machine,wsl:f.wsl,binary:f.binary};
  if (f.machine && preset?.session) throw new Error("Machine profile conflicts with preset session; select a preset/target explicitly");
  const client=new HerdrClient(scope,{maxChars:f.maxChars || 16384});
  if (sub==="presets") {
    return print({defaults:{agent:d.agent,split:d.split,focus:d.focus},presets:Object.entries(agents(loaded.config)).map(([name,p]:any)=>
      ({name,command:p.command,kind:p.kind,description:p.description,session:p.session,env_keys:Object.keys(p.env||{})}))},f.json);
  }
  if (sub==="running") return print(client.run(["agent","list"]).agents || [],f.json);
  if (sub==="read") {
    if (!f.rest[0]) throw new Error("read requires a target");
    const r=client.read(f.rest[0],{lines:f.lines || d.readLines,source:f.source || "visible"});
    return f.json ? print(r,true) : console.log(r.text+(r.truncated?"\n[output truncated]":""));
  }
  if (sub==="ask") {
    if (f.rest.length<2) throw new Error("ask requires target and prompt");
    return print(client.ask(f.rest[0],f.rest.slice(1).join(" "),{timeout:f.timeout || d.replyTimeoutMs,lines:f.lines || d.readLines,source:f.source || "visible"}),f.json);
  }
  if (sub==="stop") {
    if (!f.force || !f.rest[0]) throw new Error("stop TARGET --force closes its pane and kills its current process");
    const a=client.get(f.rest[0]); if (!a?.pane_id) throw new Error("No live agent found");
    return print(client.run(["pane","close",a.pane_id]),f.json);
  }
  if (sub!=="start") throw new Error("Unknown command; use --help");
  validateRead({lines:f.lines ?? preset.readLines,source:f.source || "visible"});
  if (!Number.isInteger(preset.replyTimeoutMs) || preset.replyTimeoutMs < 1 || preset.replyTimeoutMs > 3598000) throw new Error("Preset reply timeout must be 1..3598000 ms");
  if (f.prompt !== undefined && !f.prompt.trim()) throw new Error("Prompt must be nonempty");
  const kind=kindFor(preset,f.kind); const name=f.name || preset.name;
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) throw new Error("Agent name must match [a-z][a-z0-9_-]{0,31}");
  const timeout=f.timeout || preset.bootTimeoutMs;
  if (!Number.isInteger(timeout) || timeout<=3000 || timeout>300000) throw new Error("Startup timeout must be >3000 and <=300000");
  if ([f.pane,f.anchor,f.workspace,f.tab].filter(Boolean).length>1) throw new Error("Select one pane, anchor-pane, workspace, or tab");
  const env=[...Object.entries(preset.env||{}).map(([k,v])=>k+"="+v),...f.env];
  if (env.some(v=>!/^[_A-Za-z][_A-Za-z0-9]*=/.test(v))) throw new Error("--env expects KEY=VALUE");
  if (f.pane && (f.cwd || preset.cwd || env.length)) throw new Error("Existing pane inherits its cwd/env; create a location explicitly for these overrides");
  const foreign=Boolean(f.machine || f.wsl);
  let cwd=f.cwd || preset.cwd;
  if (!f.pane) {
    if (!cwd && foreign) throw new Error("Foreign target creation requires its explicit cwd");
    cwd=foreign ? cwd : expandPath(cwd || process.cwd());
    if (foreign && !/^(\/|~(?:\/|$)|[A-Za-z]:[\\/])/.test(cwd)) throw new Error("Foreign cwd must be absolute or home-relative");
  }
  client.probe({launch:true,kind}); // Refuse unsupported targets before creating layout.
  const live = client.run(["agent","list"]).agents || [];
  if (live.some((a:any)=>a.name===name)) throw new Error("Agent name already exists on this server; no location was created");
  let pane=f.pane; let location:any;
  if (!pane) {
    const common=["--cwd",cwd, f.focus ?? preset.focus ? "--focus":"--no-focus"];
    for (const pair of env) common.push("--env",pair);
    let args;
    if (f.anchor) args=["pane","split",f.anchor,"--direction",f.split || preset.split,...common];
    else if (f.tab) {
      const matches=(client.run(["pane","list"]).panes || []).filter((p:any)=>p.tab_id===f.tab);
      if (matches.length!==1) throw new Error("Tab has zero/multiple panes; pass explicit --anchor-pane");
      args=["pane","split",matches[0].pane_id,"--direction",f.split || preset.split,...common];
    } else if (f.workspace) args=["tab","create","--workspace",f.workspace,"--label",name,...common];
    else args=["workspace","create","--label",name,...common];
    location=client.run(args); pane=location.root_pane?.pane_id || location.pane?.pane_id;
    if (!pane) throw new Error("Creation returned no pane; reconcile the target before retrying");
  }
  try {
    const started=client.run(["agent","start",name,"--kind",kind,"--pane",pane,"--timeout",String(timeout),"--",...preset.command.slice(1)],{timeoutMs:timeout+2000});
    const reply=f.prompt ? client.ask(pane,f.prompt,{timeout:preset.replyTimeoutMs,lines:f.lines || preset.readLines,source:f.source || "visible"}) : undefined;
    print({target:scope,preset:preset.name,pane_id:pane,location,agent:started.agent,...outcome(started.agent),reply},f.json);
  } catch (error:any) { error.pane_id=pane; error.target=scope; error.task_verified=false; throw error; }
}
try { main(); } catch (e:any) {
  const safe:any={error:{code:e.code || "adapter_error",message:e.message}};
  for (const key of ["target","pane_id","submission_may_have_occurred","task_verified","observation"]) if (e[key]!==undefined) safe[key]=e[key];
  console.error(JSON.stringify(safe)); process.exitCode=1;
}
