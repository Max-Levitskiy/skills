//! The holder handle `start` returns and spore gives back to every `probe` and `stop`.
//! A probe runs in a fresh instance and keeps nothing between calls, so everything it needs
//! is here: canonical JSON (sorted keys, no whitespace, integers only, counters as decimal
//! strings), at most 4 KiB.

use serde_json::{Value, json};

use crate::host::Process;

pub const MAX_HANDLE_BYTES: usize = 4096;
const VERSION: u64 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Handle {
    /// Claude in a herdr pane.
    Watched {
        /// The herdr agent name.
        agent: String,
        pane: String,
        workspace: String,
        socket: String,
        /// The Claude session the pane must hold.
        session: String,
        /// herdr's `completion_seq` when this attempt's prompt went in: the turn has ended
        /// once it rises above.
        prompt_seq: u64,
    },
    /// A windowless `claude -p`.
    Background { process: Process, session: String },
}

impl Handle {
    pub fn to_json(&self) -> String {
        let value = match self {
            Handle::Watched {
                agent,
                pane,
                workspace,
                socket,
                session,
                prompt_seq,
            } => json!({
                "v": VERSION, "mode": "watched", "agent": agent, "pane": pane, "workspace": workspace,
                "socket": socket, "session": session, "promptSeq": prompt_seq.to_string(),
            }),
            Handle::Background { process, session } => json!({
                "v": VERSION, "mode": "background", "session": session,
                "process": {"program": process.program, "host": process.host, "boot": process.boot,
                            "pgid": process.pgid, "started": process.started},
            }),
        };
        // serde_json's map is a BTreeMap: keys come out sorted, and every key here is ASCII,
        // where UTF-16 order and byte order agree.
        value.to_string()
    }

    pub fn parse(text: &str) -> Option<Handle> {
        let value: Value = serde_json::from_str(text).ok()?;
        if value.get("v")?.as_u64()? != VERSION {
            return None;
        }
        let text = |v: &Value, key: &str| v.get(key).and_then(Value::as_str).map(String::from);
        let session = text(&value, "session")?;
        match value.get("mode")?.as_str()? {
            "watched" => Some(Handle::Watched {
                agent: text(&value, "agent")?,
                pane: text(&value, "pane")?,
                workspace: text(&value, "workspace")?,
                socket: text(&value, "socket")?,
                session,
                prompt_seq: text(&value, "promptSeq")?.parse().ok()?,
            }),
            "background" => {
                let p = value.get("process")?;
                Some(Handle::Background {
                    process: Process {
                        program: text(p, "program")?,
                        host: text(p, "host")?,
                        boot: text(p, "boot")?,
                        pgid: i32::try_from(p.get("pgid")?.as_i64()?).ok()?,
                        started: text(p, "started")?,
                    },
                    session,
                })
            }
            _ => None,
        }
    }
}
