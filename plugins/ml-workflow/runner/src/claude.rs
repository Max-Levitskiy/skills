//! What the runner tells Claude: the node's `params`, Claude's flags and the step's first
//! message. The messages are the ones `claude-spore` sends (src/claude.ts), with the answer
//! handed in as Claude's last message (docs/claude-step-runner-design.md, decision 5).

use std::collections::BTreeMap;

use serde_json::Value;

use crate::herdr::DEFAULT_SOCKET;
use crate::host::{Context, Failure};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunMode {
    /// In a herdr pane the person can watch and type into.
    Watched,
    /// A windowless `claude -p`.
    Background,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Format {
    /// The answer is `{"answer": {"outcome", "output"}}`, each outcome with its schema.
    Json(BTreeMap<String, Value>),
    /// The answer is Claude's last message as text, the output of this one outcome.
    Text(String),
}

/// A node's `params`: how it sets up the runner. Its `input` is the data Claude gets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Params {
    /// `"watched"` or `"background"`. The node's own value wins; a workflow takes the
    /// default from agent config through a run input (README, "The runner module").
    pub run_mode: RunMode,
    pub format: Format,
    pub tools: Option<Vec<String>>,
    pub model: Option<String>,
    pub skill: Option<String>,
    /// The node's instructions file, a path inside the step files.
    pub instructions: Option<String>,
    /// Where Claude runs: absolute, or relative to the run's base folder; the base folder
    /// when unset.
    pub cwd: Option<String>,
    /// herdr's socket, which the action must grant.
    pub socket: String,
    /// Plugins loaded for this session only (`--plugin-dir`), such as the runner's hook
    /// plugin (skills#153).
    pub plugin_dirs: Vec<String>,
    /// Claude Code's transcripts, read to tell a new conversation from one to resume.
    pub transcripts: String,
    /// How long `start` may take: at most the action's `timeoutMs` (60 s by default), less
    /// a margin, since the runner is not told it.
    pub start_timeout_ms: u64,
}

pub const DEFAULT_START_TIMEOUT_MS: u64 = 50_000;

const KEYS: &[&str] = &[
    "runMode",
    "format",
    "schema",
    "outcome",
    "tools",
    "model",
    "skill",
    "instructions",
    "cwd",
    "socket",
    "pluginDirs",
    "transcripts",
    "startTimeoutMs",
];

pub const DEFAULT_TRANSCRIPTS: &str = "~/.claude/projects";

fn invalid(message: impl Into<String>) -> Failure {
    Failure::new("params.invalid", message, false)
}

impl Params {
    pub fn parse(text: &str) -> Result<Params, Failure> {
        let value: Value =
            serde_json::from_str(text).map_err(|e| invalid(format!("the node's params are not JSON: {e}")))?;
        let Value::Object(map) = value else {
            return Err(invalid("the node's params must be an object"));
        };
        if let Some(key) = map.keys().find(|k| !KEYS.contains(&k.as_str())) {
            return Err(invalid(format!(
                "`{key}` is not a param of a Claude step; they are {}",
                KEYS.join(", ")
            )));
        }
        let string = |key: &str| -> Result<Option<String>, Failure> {
            match map.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(s)) if !s.is_empty() => Ok(Some(s.clone())),
                Some(_) => Err(invalid(format!("`{key}` must be a non-empty string"))),
            }
        };
        let strings = |key: &str| -> Result<Option<Vec<String>>, Failure> {
            match map.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::Array(items)) => items
                    .iter()
                    .map(|i| i.as_str().filter(|s| !s.is_empty()).map(String::from))
                    .collect::<Option<Vec<_>>>()
                    .map(Some)
                    .ok_or_else(|| invalid(format!("`{key}` must be a list of non-empty strings"))),
                Some(_) => Err(invalid(format!("`{key}` must be a list of strings"))),
            }
        };
        let run_mode = match string("runMode")?.as_deref() {
            None | Some("background") => RunMode::Background,
            Some("watched") => RunMode::Watched,
            Some(other) => {
                return Err(invalid(format!(
                    "`runMode` is \"watched\" or \"background\", not \"{other}\""
                )));
            }
        };
        let schema = match map.get("schema") {
            None | Some(Value::Null) => None,
            Some(Value::Object(s)) if !s.is_empty() && s.values().all(Value::is_object) => Some(
                s.iter()
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect::<BTreeMap<_, _>>(),
            ),
            Some(_) => return Err(invalid("`schema` must map each outcome to its output's JSON Schema")),
        };
        let format = match (string("format")?.as_deref(), schema) {
            (None | Some("json"), Some(schema)) => Format::Json(schema),
            (Some("json"), None) => {
                return Err(invalid(
                    "a `format: \"json\"` step needs `schema`: {\"$outputSchemas\": {}}",
                ));
            }
            (None | Some("text"), None) => Format::Text(
                string("outcome")?
                    .ok_or_else(|| invalid("a text step needs `outcome`, the one outcome its reply ends with"))?,
            ),
            (Some("text"), Some(_)) => return Err(invalid("a `format: \"text\"` step has no `schema`")),
            (Some(other), _) => return Err(invalid(format!("`format` is \"json\" or \"text\", not \"{other}\""))),
        };
        Ok(Params {
            run_mode,
            format,
            tools: strings("tools")?,
            model: string("model")?,
            skill: string("skill")?,
            instructions: string("instructions")?,
            cwd: string("cwd")?,
            socket: string("socket")?.unwrap_or_else(|| DEFAULT_SOCKET.to_string()),
            plugin_dirs: strings("pluginDirs")?.unwrap_or_default(),
            transcripts: string("transcripts")?.unwrap_or_else(|| DEFAULT_TRANSCRIPTS.to_string()),
            start_timeout_ms: match map.get("startTimeoutMs") {
                None | Some(Value::Null) => DEFAULT_START_TIMEOUT_MS,
                Some(v) => v
                    .as_u64()
                    .filter(|ms| (5_000..=3_600_000).contains(ms))
                    .ok_or_else(|| {
                        invalid("`startTimeoutMs` must be a whole number of milliseconds from 5000 to 3600000")
                    })?,
            },
        })
    }

    /// The folder Claude runs in, absolute.
    pub fn cwd(&self, context: &Context) -> String {
        match &self.cwd {
            None => context.base_dir.clone(),
            Some(p) if p.starts_with('/') => p.clone(),
            Some(p) => format!(
                "{}/{}",
                context.base_dir.trim_end_matches('/'),
                p.trim_start_matches("./")
            ),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionMode {
    Start,
    Resume,
}

/// `--session-id` or `--resume`, the permission mode, tools, model, the step files and
/// the session's plugins, then `--`, so a variadic flag such as `--allowedTools` cannot
/// take the message for one of its values.
pub fn flags(params: &Params, context: &Context, mode: SessionMode, session: &str) -> Vec<String> {
    let mut args: Vec<String> = vec![
        if mode == SessionMode::Start {
            "--session-id"
        } else {
            "--resume"
        }
        .into(),
        session.into(),
        "--permission-mode".into(),
        "default".into(),
    ];
    if let Some(tools) = &params.tools {
        args.push("--tools".into());
        args.push(tools.join(","));
        if !tools.is_empty() {
            args.push("--allowedTools".into());
            args.push(tools.join(","));
        }
    }
    if let Some(model) = &params.model {
        args.push("--model".into());
        args.push(model.clone());
    }
    if let Some(files) = &context.step_files {
        args.push("--add-dir".into());
        args.push(files.clone());
    }
    for dir in &params.plugin_dirs {
        args.push("--plugin-dir".into());
        args.push(dir.clone());
    }
    args.push("--".into());
    args
}

/// What the message is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Occasion {
    /// The conversation's first message.
    First,
    /// The run came back to the node: a later visit.
    CameBack,
    /// An earlier try of this visit was cut off.
    CutOff,
}

impl Occasion {
    pub fn of(context: &Context, mode: SessionMode) -> Occasion {
        match mode {
            SessionMode::Start => Occasion::First,
            SessionMode::Resume if context.attempt > 1 => Occasion::CutOff,
            SessionMode::Resume => Occasion::CameBack,
        }
    }
}

/// The message, on one line: herdr types Claude's arguments into the pane's shell and
/// refuses a control character in them (`invalid_agent_argument`), so the input and the
/// schemas go in as compact JSON, whose strings keep their newlines escaped.
pub fn message(params: &Params, context: &Context, occasion: Occasion) -> String {
    let input = compact(&context.input);
    let mut parts: Vec<String> = Vec::new();
    match occasion {
        Occasion::First => {
            parts.push(format!(
                "You are doing the step `{}` of a workflow run.",
                context.node_id
            ));
            if let (Some(path), Some(files)) = (&params.instructions, &context.step_files) {
                parts.push(format!(
                    "Read its instructions first: {}/{}.",
                    files.trim_end_matches('/'),
                    path.trim_start_matches("./")
                ));
            }
            if let Some(files) = &context.step_files {
                parts.push(format!("The step's files are in {files}."));
            }
        }
        Occasion::CameBack => parts.push(format!(
            "The run came back to this step: this is its visit {}. Do the step again with the new input.",
            context.visit
        )),
        Occasion::CutOff => parts.push(
            "You were cut off before you finished this step. Check what you already did, then finish the step.".into(),
        ),
    }
    parts.push(format!("The input of this step, as JSON: {input}"));
    parts.push(ending(params));
    let text = parts.join(" ");
    one_line(&match (&params.skill, occasion) {
        (Some(skill), Occasion::First) => format!("/{skill} {text}"),
        _ => text,
    })
}

fn ending(params: &Params) -> String {
    match &params.format {
        Format::Json(schema) => {
            let outcomes: Vec<&str> = schema.keys().map(String::as_str).collect();
            let schemas = Value::Object(schema.iter().map(|(k, v)| (k.clone(), v.clone())).collect());
            format!(
                "When you have finished, end your turn with your answer as your last message, and nothing else in it: one JSON object {{\"answer\": {{\"outcome\": <outcome>, \"output\": <output>}}}}, where <outcome> is one of {} and <output> fits that outcome's JSON Schema here: {}",
                outcomes.iter().map(|o| format!("\"{o}\"")).collect::<Vec<_>>().join(", "),
                schemas
            )
        }
        Format::Text(_) => "When you have finished, end your turn with your reply as plain text: your last message is the step's output.".into(),
    }
}

/// The text as compact JSON when it is JSON, else as it is with its control characters
/// made spaces.
fn compact(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(value) => value.to_string(),
        Err(_) => one_line(text),
    }
}

/// Every control character made a space.
pub fn one_line(text: &str) -> String {
    text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect()
}
