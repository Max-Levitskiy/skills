import test from "node:test";
import assert from "node:assert/strict";
import { bounded, route, outcome, movedIdentity, mapLimit, reconcileSnapshot, HerdrClient } from "../scripts/lib/herdr-client.mjs";

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=value=>({status:0,stdout:JSON.stringify({result:value}),stderr:""});

test("explicit targets keep server scope and remove inherited pane context",()=>{
  const env={HERDR_SESSION:"wrong",HERDR_SOCKET_PATH:"/wrong",HERDR_PANE_ID:"wrong",PATH:"fixture"};
  for(const scope of [{session:"chosen"},{machine:"profile"},{wsl:"Private",session:"chosen"}]){
    const r=route(scope,["agent","list"],env);
    assert.equal(r.env.HERDR_SESSION,undefined);assert.equal(r.env.PATH,"fixture");
    assert.deepEqual(r.args.slice(-2),["agent","list"]);
    if(scope.wsl)assert.deepEqual(r.args.slice(0,4),["-d","Private","--exec","herdr"]);
    else assert.deepEqual(r.args.slice(0,2),scope.machine?["--machine","profile"]:["--session","chosen"]);
  }
  assert.equal(route({},[],env).env.HERDR_PANE_ID,"wrong");
  assert.throws(()=>route({machine:"x",session:"y"}),{code:"conflicting_target"});
  assert.throws(()=>route({remote:"x"}),{code:"interactive_target"});
});

test("move adopts returned identities and rejects stale pane response",()=>{
 const record={runtime:"Private",session:"farm",pane_id:"old",workspace_id:"w1",tab_id:"t1"};
 const moved=movedIdentity(record,{move_result:{previous_pane_id:"old",pane:{pane_id:"new",workspace_id:"w2",tab_id:"t2"}}});
 assert.equal(moved.pane_id,"new");assert.equal(moved.session,"farm");assert.equal(moved.workspace_id,"w2");
 assert.throws(()=>movedIdentity(moved,{move_result:{previous_pane_id:"old",pane:{pane_id:"again"}}}),{code:"stale_move"});
});

test("native state never verifies task success",()=>{
 for(const status of ["idle","done","blocked","working","unknown",undefined]){
  const r=outcome({agent_status:status});assert.equal(r.task_verified,false);assert.notEqual(r.disposition,"verified");
 }
 assert.equal(outcome({agent_status:"done"},true).disposition,"verified");
 assert.equal(outcome({agent_status:"blocked"}).disposition,"inspect-input");
});

test("character budgets bound output and reject invalid limits",()=>{
 assert.deepEqual(bounded("abcdef",3),{text:"abc",truncated:true});
 for(const n of [0,65537,NaN,1.5])assert.throws(()=>bounded("x",n),{code:"invalid_budget"});
});

test("bounded workers settle errors and preserve order across 100 fixture tasks",async()=>{
 let active=0,peak=0;
 const results=await mapLimit(Array.from({length:100},(_,i)=>i),4,async i=>{
  active++;peak=Math.max(peak,active);try{await delay(1);if(i===33)throw Error("fixture failure");return i*2;}finally{active--;}
 });
 assert.equal(results.length,100);assert.equal(peak,4);assert.equal(active,0);
 assert.equal(results[34].value,68);assert.equal(results[33].ok,false);
});

test("invalid concurrency starts no workers",async()=>{
 let calls=0;
 for(const limit of [0,101,1.5])await assert.rejects(mapLimit([1],limit,()=>calls++),{code:"invalid_concurrency"});
 assert.equal(calls,0);
});

test("subscribe acknowledgement precedes snapshot; events invalidate rather than replay",async()=>{
 let acknowledged=false,closed=0,notify,reads=0;
 const value=await reconcileSnapshot(async callback=>{
  notify=callback;await delay(1);acknowledged=true;return ()=>closed++;
 },async()=>{assert.equal(acknowledged,true);reads++;if(reads===1)notify({type:"pane.changed",bad_patch:"ignore"});return {snapshot:reads};});
 assert.deepEqual(value,{snapshot:2});assert.equal(reads,2);assert.equal(closed,1);
});

test("event loss discards cache and requires a fresh acknowledged subscription",async()=>{
 let oldClosed=0,newClosed=0;
 await assert.rejects(reconcileSnapshot(async callback=>{callback({code:"events_lost"});return ()=>oldClosed++;},async()=>({stale:true})),{code:"events_lost"});
 assert.equal(oldClosed,1);
 const value=await reconcileSnapshot(async()=>()=>newClosed++,async()=>({fresh:true}));
 assert.deepEqual(value,{fresh:true});assert.equal(newClosed,1);
});

test("churn and recovery deadlines close subscriptions",async()=>{
 let callback,closed=0,reads=0;
 await assert.rejects(reconcileSnapshot(async cb=>{callback=cb;return ()=>closed++;},async()=>{reads++;callback({});return {};},{maxRefreshes:2}),{code:"recovery_churn"});
 assert.equal(reads,2);assert.equal(closed,1);
 await assert.rejects(reconcileSnapshot(async()=>()=>closed++,async()=>{await delay(30);return {};},{timeoutMs:5}),{code:"recovery_timeout"});
 assert.equal(closed,2);
});

test("late subscription acknowledgement still releases its resource",async()=>{
 let closed=0;
 await assert.rejects(reconcileSnapshot(async()=>{await delay(25);return ()=>closed++;},async()=>({}),{timeoutMs:5}),{code:"recovery_timeout"});
 await delay(30);assert.equal(closed,1);
});

test("invalid recovery budgets subscribe nowhere",async()=>{
 let calls=0;
 await assert.rejects(reconcileSnapshot(()=>calls++,async()=>({}),{maxRefreshes:0}),{code:"invalid_budget"});
 assert.equal(calls,0);
});

test("working turn cannot be used as completion evidence for a new ask",()=>{
 let prompts=0;
 const c=new HerdrClient({}, {runner:(binary,args)=>{
  if(args.includes("--version"))return {status:0,stdout:"herdr 0.9.3"};
  if(args.includes("--help"))return {status:0,stdout:"--wait --until"};
  if(args[0]==="status")return json({running:true,compatible:true});
  if(args[1]==="get")return json({agent:{pane_id:"p",agent_status:"working",completion_seq:42}});
  prompts++;throw Error("should not submit");
 }});
 assert.throws(()=>c.ask("reviewer","new task"),{code:"agent_not_idle",submission_may_have_occurred:false});
 assert.equal(prompts,0);
});

test("invalid read/prompt inputs have no CLI effects",()=>{
 let calls=0;const c=new HerdrClient({}, {runner:()=>calls++});
 assert.throws(()=>c.ask("p","   "),{code:"invalid_prompt"});
 assert.throws(()=>c.read("p",{lines:1001}),{code:"invalid_read"});
 assert.throws(()=>c.ask("p","task",{timeout:Infinity}),{code:"invalid_timeout"});
 assert.equal(calls,0);
});

test("empty route and agent selectors reject before runner calls",()=>{
 let calls=0;
 for(const value of [""," ","\t\n"]){
  for(const key of ["session","machine","wsl","binary","remote"])
   assert.throws(()=>new HerdrClient({[key]:value},{runner:()=>calls++}),{code:"invalid_target"});
  const c=new HerdrClient({}, {runner:()=>calls++});
  assert.throws(()=>c.get(value),{code:"invalid_target"});
  assert.throws(()=>c.read(value),{code:"invalid_target"});
 }
 assert.equal(calls,0);
});
