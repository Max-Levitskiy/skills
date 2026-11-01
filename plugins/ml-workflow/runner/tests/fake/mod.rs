//! A fake host: herdr's socket simulated well enough for the runner's calls, a process
//! table, files, and a tally of the time each call may take, so the specs can hold
//! `probe` and `stop` inside their 10 s.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use claude_runner::host::{Context, Host, Liveness, Process, Signal, Spawn};
use serde_json::{Value, json};

#[derive(Clone, Debug)]
pub struct FakeAgent {
    pub name: String,
    pub pane: String,
    pub workspace: String,
    pub program: Option<String>,
    pub status: String,
    pub interactive_ready: bool,
    pub launch_pending: bool,
    pub completion_seq: u64,
    pub session: Option<String>,
    /// `agent.get` calls before it is ready.
    pub ready_after: u32,
    /// Stays `blocked` before it is ready: a question at start, such as the trust prompt.
    pub blocked_at_start: bool,
    /// Escapes it ignores before one interrupts its turn.
    pub deaf_escapes: u32,
    /// Prompts refused with `agent_prompt_stalled` before one lands.
    pub stalls: u32,
    pub args: Vec<String>,
}

#[derive(Default, Debug)]
pub struct Herdr {
    pub protocol: u64,
    pub down: bool,
    /// `agent.start` calls refused with `agent_pane_busy` before the shell is ready.
    pub busy: u32,
    pub workspaces: BTreeMap<String, (String, String)>, // id -> (label, cwd)
    pub agents: BTreeMap<String, FakeAgent>,
    pub calls: Vec<(String, Value)>,
    pub created_env: Vec<Value>,
    next: u32,
    /// Applied to a new agent.
    pub template: Option<FakeAgent>,
}

#[derive(Default)]
pub struct State {
    pub herdr: Herdr,
    pub processes: BTreeMap<i32, (Process, bool, Spawn)>, // pgid -> (record, alive, spawn)
    pub ignores_term: BTreeSet<i32>,
    pub files: BTreeMap<String, Vec<u8>>,
    pub folders: BTreeMap<String, Vec<String>>,
    pub writes: bool,
    /// Worst-case milliseconds the calls so far may have taken: each request's timeout,
    /// each sleep.
    pub worst_ms: u64,
    pub sleeps: Vec<u32>,
    next_pgid: i32,
}

pub struct Fake(pub RefCell<State>);

impl Fake {
    pub fn new() -> Fake {
        let mut state = State {
            writes: true,
            next_pgid: 4000,
            ..State::default()
        };
        state.herdr.protocol = 22;
        Fake(RefCell::new(state))
    }

    pub fn state(&self) -> std::cell::RefMut<'_, State> {
        self.0.borrow_mut()
    }

    pub fn methods(&self) -> Vec<String> {
        self.0.borrow().herdr.calls.iter().map(|(m, _)| m.clone()).collect()
    }

    pub fn reset_clock(&self) {
        let mut s = self.state();
        s.worst_ms = 0;
        s.sleeps.clear();
        s.herdr.calls.clear();
    }

    /// A Claude already in a pane of a workspace the runner made.
    pub fn live_agent(&self, name: &str, session: &str, status: &str, completion_seq: u64) -> FakeAgent {
        let mut s = self.state();
        s.herdr.next += 1;
        let ws = format!("w{}", s.herdr.next);
        s.herdr
            .workspaces
            .insert(ws.clone(), (name.to_string(), "/project".into()));
        let agent = FakeAgent {
            name: name.into(),
            pane: format!("{ws}:p1"),
            workspace: ws,
            program: Some("claude".into()),
            status: status.into(),
            interactive_ready: true,
            launch_pending: false,
            completion_seq,
            session: Some(session.into()),
            ready_after: 0,
            blocked_at_start: false,
            deaf_escapes: 0,
            stalls: 0,
            args: vec![],
        };
        s.herdr.agents.insert(name.into(), agent.clone());
        agent
    }
}

fn error(code: &str) -> Value {
    json!({"error": {"code": code, "message": code.replace('_', " ")}})
}

fn info(a: &FakeAgent) -> Value {
    let mut v = json!({
        "name": a.name, "pane_id": a.pane, "workspace_id": a.workspace, "agent": a.program,
        "agent_status": a.status, "interactive_ready": a.interactive_ready,
        "launch_pending": a.launch_pending, "terminal_id": "t", "tab_id": "t1",
    });
    if a.completion_seq > 0 {
        v["completion_seq"] = json!(a.completion_seq);
    }
    if let Some(s) = &a.session {
        v["agent_session"] = json!({"source": "herdr:claude", "agent": "claude", "kind": "id", "value": s});
    }
    v
}

impl Herdr {
    fn answer(&mut self, method: &str, p: &Value) -> Value {
        let target = p.get("target").and_then(Value::as_str).unwrap_or_default().to_string();
        match method {
            "ping" => json!({"result": {"type": "pong", "version": "0.9.3", "protocol": self.protocol}}),
            "workspace.create" => {
                self.next += 1;
                let ws = format!("w{}", self.next);
                let label = p["label"].as_str().unwrap_or_default().to_string();
                self.workspaces
                    .insert(ws.clone(), (label, p["cwd"].as_str().unwrap_or_default().into()));
                self.created_env.push(p["env"].clone());
                json!({"result": {"type": "workspace_created", "workspace": {"workspace_id": ws},
                                  "root_pane": {"pane_id": format!("{ws}:p1")}}})
            }
            "workspace.get" => match self.workspaces.get(p["workspace_id"].as_str().unwrap_or_default()) {
                Some((label, _)) => json!({"result": {"workspace": {"label": label}}}),
                None => error("workspace_not_found"),
            },
            "workspace.close" => {
                let ws = p["workspace_id"].as_str().unwrap_or_default().to_string();
                if self.workspaces.remove(&ws).is_none() {
                    return error("workspace_not_found");
                }
                self.agents.retain(|_, a| a.workspace != ws);
                json!({"result": {"type": "ok"}})
            }
            "pane.close" => {
                let pane = p["pane_id"].as_str().unwrap_or_default().to_string();
                let before = self.agents.len();
                self.agents.retain(|_, a| a.pane != pane);
                if before == self.agents.len() {
                    error("pane_not_found")
                } else {
                    json!({"result": {"type": "ok"}})
                }
            }
            "agent.start" => {
                if self.busy > 0 {
                    self.busy -= 1;
                    return error("agent_pane_busy");
                }
                let args: Vec<String> = p["args"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|a| a.as_str().unwrap().to_string())
                    .collect();
                if args.iter().any(|a| a.chars().any(char::is_control)) {
                    return error("invalid_agent_argument");
                }
                let pane = p["pane_id"].as_str().unwrap().to_string();
                let session = args
                    .windows(2)
                    .find(|w| w[0] == "--session-id" || w[0] == "--resume")
                    .map(|w| w[1].clone());
                let mut agent = self.template.clone().unwrap_or(FakeAgent {
                    name: String::new(),
                    pane: String::new(),
                    workspace: String::new(),
                    program: Some("claude".into()),
                    status: "unknown".into(),
                    interactive_ready: false,
                    launch_pending: true,
                    completion_seq: 0,
                    session: None,
                    ready_after: 3,
                    blocked_at_start: false,
                    deaf_escapes: 0,
                    stalls: 0,
                    args: vec![],
                });
                agent.name = p["name"].as_str().unwrap().into();
                agent.workspace = pane.split(':').next().unwrap().into();
                agent.pane = pane;
                agent.session = session;
                agent.args = args;
                let v = info(&agent);
                self.agents.insert(agent.name.clone(), agent);
                json!({"result": {"type": "agent_started", "agent": v}})
            }
            "agent.get" => {
                let Some(a) = self.agents.get_mut(&target) else {
                    return error("agent_not_found");
                };
                if !a.interactive_ready {
                    if a.blocked_at_start {
                        a.status = "blocked".into();
                    } else if a.ready_after == 0 {
                        a.interactive_ready = true;
                        a.launch_pending = false;
                        a.status = "working".into();
                    } else {
                        a.ready_after -= 1;
                    }
                }
                json!({"result": {"type": "agent_info", "agent": info(a)}})
            }
            "agent.prompt" => {
                let Some(a) = self.agents.get_mut(&target) else {
                    return error("agent_not_found");
                };
                if a.status == "blocked" {
                    return error("agent_blocked");
                }
                if a.stalls > 0 {
                    a.stalls -= 1;
                    return error("agent_prompt_stalled");
                }
                a.status = "working".into();
                json!({"result": {"type": "agent_prompted", "agent": info(a)}})
            }
            "agent.send_keys" => {
                let Some(a) = self.agents.get_mut(&target) else {
                    return error("agent_not_found");
                };
                let keys: Vec<&str> = p["keys"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|k| k.as_str().unwrap())
                    .collect();
                if keys == ["esc"] && a.status == "working" {
                    if a.deaf_escapes > 0 {
                        a.deaf_escapes -= 1;
                    } else {
                        a.status = "done".into();
                        a.completion_seq += 1;
                    }
                }
                json!({"result": {"type": "ok"}})
            }
            _ => error("unknown_method"),
        }
    }
}

impl Host for Fake {
    fn start_process(&self, spawn: &Spawn) -> Result<Process, String> {
        let mut s = self.state();
        s.next_pgid += 1;
        let process = Process {
            program: spawn.argv[0].clone(),
            host: "box".into(),
            boot: "boot-1".into(),
            pgid: s.next_pgid,
            started: format!("{}", 1000 + s.next_pgid),
        };
        s.processes.insert(process.pgid, (process.clone(), true, spawn.clone()));
        Ok(process)
    }

    fn process_alive(&self, process: &Process) -> Liveness {
        match self.0.borrow().processes.get(&process.pgid) {
            Some((p, alive, _)) if p == process => {
                if *alive {
                    Liveness::Alive
                } else {
                    Liveness::Dead
                }
            }
            _ => Liveness::Dead,
        }
    }

    fn signal_process(&self, process: &Process, signal: Signal) -> Result<bool, String> {
        if self.process_alive(process) != Liveness::Alive {
            return Ok(false);
        }
        let mut s = self.state();
        let deaf = signal == Signal::Term && s.ignores_term.contains(&process.pgid);
        if !deaf {
            s.processes.get_mut(&process.pgid).unwrap().1 = false;
        }
        Ok(true)
    }

    fn request(&self, socket: &str, body: &[u8], timeout_ms: u32) -> Result<Vec<u8>, String> {
        let mut s = self.state();
        s.worst_ms += u64::from(timeout_ms);
        assert!(body.ends_with(b"\n"), "a request is one line");
        assert_eq!(socket, "~/.config/herdr/herdr.sock");
        let request: Value = serde_json::from_slice(body).unwrap();
        let method = request["method"].as_str().unwrap().to_string();
        s.herdr.calls.push((method.clone(), request["params"].clone()));
        if s.herdr.down {
            return Err("connecting: No such file or directory".into());
        }
        let mut reply = s.herdr.answer(&method, &request["params"]);
        reply["id"] = request["id"].clone();
        Ok(reply.to_string().into_bytes())
    }

    fn sleep(&self, ms: u32) {
        let mut s = self.state();
        s.worst_ms += u64::from(ms);
        s.sleeps.push(ms);
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        self.0
            .borrow()
            .files
            .get(path)
            .cloned()
            .ok_or_else(|| format!("{path}: no such file"))
    }

    fn list_folder(&self, path: &str) -> Result<Vec<String>, String> {
        let s = self.0.borrow();
        if path.starts_with("/db.files/work/") {
            // The work folder: spore makes it before the first try.
            let prefix = format!("{path}/");
            return Ok(s
                .files
                .keys()
                .filter_map(|f| f.strip_prefix(&prefix))
                .map(String::from)
                .collect());
        }
        s.folders
            .get(path)
            .cloned()
            .ok_or_else(|| format!("{path}: no such folder"))
    }

    fn write_file(&self, path: &str, bytes: &[u8]) -> Option<Result<(), String>> {
        let mut s = self.state();
        if !s.writes {
            return None;
        }
        s.files.insert(path.to_string(), bytes.to_vec());
        Some(Ok(()))
    }

    fn writes_files(&self) -> bool {
        self.0.borrow().writes
    }
}

pub fn context(params: Value) -> Context {
    Context {
        run_id: "run_0123abcd".into(),
        tenant: "default".into(),
        node_id: "implement".into(),
        action_id: "claude".into(),
        invocation_id: "inv_1".into(),
        attempt: 1,
        visit: 1,
        effect_key: "inv_1".into(),
        input: r#"{"task":"add a flag\nwith two lines"}"#.into(),
        params: params.to_string(),
        base_dir: "/project".into(),
        work_dir: Some("/db.files/work/run_0123abcd/inv_1".into()),
        step_files: Some("/db.files/steps/abc".into()),
        token: Some("tok-secret".into()),
        result_channel: "store".into(),
    }
}
