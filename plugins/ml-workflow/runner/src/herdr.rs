//! herdr's socket API, one newline-delimited JSON request and reply per call over the
//! host's `request`: `{"id","method","params"}` in, `{"id","result"}` or
//! `{"id","error":{"code","message"}}` out (herdr `socket-api.mdx`). Never the `herdr` CLI:
//! a program the runner starts has its output thrown away.

use std::cell::Cell;

use serde_json::{Value, json};

use crate::budget::Budget;
use crate::host::Host;

/// The `ping` protocols this runner was built and tried against: herdr 0.9.3 answers 22,
/// and 0.9.4 and 0.9.5 keep it (`src/protocol/wire.rs` at their tags).
pub const PROTOCOLS: &[u64] = &[22];

/// The default socket, `~/.config/herdr/herdr.sock`; herdr's `HERDR_SOCKET_PATH` moves it,
/// and a workflow then names that path in the `socket` param and the grant.
pub const DEFAULT_SOCKET: &str = "~/.config/herdr/herdr.sock";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HerdrError {
    /// The socket did not answer: herdr is not running, or the request timed out.
    Transport(String),
    /// herdr answered with an error.
    Api { code: String, message: String },
    /// herdr answered with something that is not a reply.
    Malformed(String),
    /// No time is left for the call inside the deadline.
    OutOfTime,
}

impl HerdrError {
    pub fn code(&self) -> Option<&str> {
        match self {
            HerdrError::Api { code, .. } => Some(code),
            _ => None,
        }
    }

    pub fn is_not_found(&self) -> bool {
        self.code().is_some_and(|c| c.ends_with("not_found"))
    }
}

impl std::fmt::Display for HerdrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HerdrError::Transport(e) => write!(f, "herdr does not answer: {e}"),
            HerdrError::Api { code, message } => write!(f, "herdr refused it: {code}: {message}"),
            HerdrError::Malformed(e) => write!(f, "herdr's reply is not one: {e}"),
            HerdrError::OutOfTime => write!(f, "no time left for another herdr call before the deadline"),
        }
    }
}

/// An agent as `agent.get` shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agent {
    pub pane: String,
    pub workspace: String,
    /// The program herdr sees in the pane, `claude`; none once it has exited.
    pub program: Option<String>,
    /// `idle`, `working`, `blocked`, `done` or `unknown`.
    pub status: String,
    pub interactive_ready: bool,
    pub launch_pending: bool,
    /// herdr's count of finished turns, from one sequence for all agents; 0 before the
    /// agent's first.
    pub completion_seq: u64,
    /// The Claude session herdr's state hook reported, once it has.
    pub session: Option<String>,
}

impl Agent {
    fn from(value: &Value) -> Result<Agent, HerdrError> {
        let text = |key: &str| value.get(key).and_then(Value::as_str).map(String::from);
        let flag = |key: &str| value.get(key).and_then(Value::as_bool).unwrap_or(false);
        let session = value
            .get("agent_session")
            .filter(|s| s.get("kind").and_then(Value::as_str) == Some("id"))
            .and_then(|s| s.get("value"))
            .and_then(Value::as_str)
            .map(String::from);
        Ok(Agent {
            pane: text("pane_id").ok_or_else(|| HerdrError::Malformed("an agent without pane_id".into()))?,
            workspace: text("workspace_id").unwrap_or_default(),
            program: text("agent"),
            status: text("agent_status").unwrap_or_else(|| "unknown".into()),
            interactive_ready: flag("interactive_ready"),
            launch_pending: flag("launch_pending"),
            completion_seq: value.get("completion_seq").and_then(Value::as_u64).unwrap_or(0),
            session,
        })
    }

    /// Ready for a prompt: herdr says Claude is at its prompt.
    pub fn at_prompt(&self) -> bool {
        self.status == "idle" || self.status == "done"
    }

    /// The turn that went in when `completion_seq` was `since` has ended: herdr counted a
    /// finished turn after it, and Claude is back at its prompt. The status word alone
    /// lags a prompt and `done` stays until the next one.
    pub fn turn_ended(&self, since: u64) -> bool {
        self.completion_seq > since && self.at_prompt()
    }
}

pub struct Herdr<'h, H: Host> {
    host: &'h H,
    socket: String,
    next_id: Cell<u32>,
}

impl<'h, H: Host> Herdr<'h, H> {
    pub fn new(host: &'h H, socket: &str) -> Self {
        Herdr {
            host,
            socket: socket.to_string(),
            next_id: Cell::new(1),
        }
    }

    pub fn sleep(&self, ms: u32) {
        self.host.sleep(ms);
    }

    pub fn call(&self, budget: &mut Budget, method: &str, params: Value, timeout_ms: u32) -> Result<Value, HerdrError> {
        let timeout = u64::from(timeout_ms);
        if budget.left() < timeout || !budget.take(budget.before_request(timeout)) {
            return Err(HerdrError::OutOfTime);
        }
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        let mut body = json!({"id": format!("claude-runner-{id}"), "method": method, "params": params}).to_string();
        body.push('\n');
        let reply = match self.host.request(&self.socket, body.as_bytes(), timeout_ms) {
            Ok(reply) => reply,
            Err(e) => {
                budget.after_failure(timeout);
                return Err(HerdrError::Transport(e));
            }
        };
        let reply: Value = serde_json::from_slice(&reply).map_err(|e| HerdrError::Malformed(e.to_string()))?;
        if let Some(error) = reply.get("error") {
            let field = |key: &str| error.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
            return Err(HerdrError::Api {
                code: field("code"),
                message: field("message"),
            });
        }
        reply
            .get("result")
            .cloned()
            .ok_or_else(|| HerdrError::Malformed("neither result nor error".into()))
    }

    /// herdr's `protocol`.
    pub fn ping(&self, budget: &mut Budget) -> Result<u64, HerdrError> {
        let result = self.call(budget, "ping", json!({}), 2_000)?;
        result
            .get("protocol")
            .and_then(Value::as_u64)
            .ok_or_else(|| HerdrError::Malformed("a pong without protocol".into()))
    }

    /// The agent by that name, or none when herdr has no such agent or pane.
    pub fn agent(&self, budget: &mut Budget, name: &str, timeout_ms: u32) -> Result<Option<Agent>, HerdrError> {
        match self.call(budget, "agent.get", json!({"target": name}), timeout_ms) {
            Ok(result) => {
                let agent = result
                    .get("agent")
                    .ok_or_else(|| HerdrError::Malformed("agent_info without agent".into()))?;
                Agent::from(agent).map(Some)
            }
            Err(e) if e.is_not_found() => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// A new workspace in `cwd` that does not take the focus; its id and its pane's.
    pub fn create_workspace(
        &self,
        budget: &mut Budget,
        cwd: &str,
        label: &str,
        env: &[(String, String)],
    ) -> Result<(String, String), HerdrError> {
        let env: serde_json::Map<String, Value> =
            env.iter().map(|(k, v)| (k.clone(), Value::from(v.as_str()))).collect();
        let result = self.call(
            budget,
            "workspace.create",
            json!({"cwd": cwd, "focus": false, "label": label, "env": env}),
            3_000,
        )?;
        let workspace = result.pointer("/workspace/workspace_id").and_then(Value::as_str);
        let pane = result.pointer("/root_pane/pane_id").and_then(Value::as_str);
        match (workspace, pane) {
            (Some(w), Some(p)) => Ok((w.to_string(), p.to_string())),
            _ => Err(HerdrError::Malformed("a workspace without its root pane".into())),
        }
    }

    pub fn workspace_label(&self, budget: &mut Budget, workspace: &str) -> Result<Option<String>, HerdrError> {
        match self.call(budget, "workspace.get", json!({"workspace_id": workspace}), 2_000) {
            Ok(result) => Ok(result
                .pointer("/workspace/label")
                .and_then(Value::as_str)
                .map(String::from)),
            Err(e) if e.is_not_found() => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Starts `claude <args>` in the pane. herdr returns at once with `launch_pending`.
    pub fn start_agent(&self, budget: &mut Budget, name: &str, pane: &str, args: &[String]) -> Result<(), HerdrError> {
        self.call(
            budget,
            "agent.start",
            json!({"name": name, "kind": "claude", "pane_id": pane, "args": args}),
            3_000,
        )
        .map(drop)
    }

    pub fn prompt(&self, budget: &mut Budget, name: &str, text: &str) -> Result<(), HerdrError> {
        self.call(budget, "agent.prompt", json!({"target": name, "text": text}), 3_000)
            .map(drop)
    }

    pub fn send_keys(&self, budget: &mut Budget, name: &str, keys: &[&str]) -> Result<(), HerdrError> {
        self.call(budget, "agent.send_keys", json!({"target": name, "keys": keys}), 2_000)
            .map(drop)
    }

    /// Closes the workspace; false when it was already gone.
    pub fn close_workspace(&self, budget: &mut Budget, workspace: &str) -> Result<bool, HerdrError> {
        match self.call(budget, "workspace.close", json!({"workspace_id": workspace}), 3_000) {
            Ok(_) => Ok(true),
            Err(e) if e.is_not_found() => Ok(false),
            Err(e) => Err(e),
        }
    }

    pub fn close_pane(&self, budget: &mut Budget, pane: &str) -> Result<bool, HerdrError> {
        match self.call(budget, "pane.close", json!({"pane_id": pane}), 3_000) {
            Ok(_) => Ok(true),
            Err(e) if e.is_not_found() => Ok(false),
            Err(e) => Err(e),
        }
    }
}
