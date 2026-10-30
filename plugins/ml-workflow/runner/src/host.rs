//! The world's types and the host's imports, as plain Rust: the runner's logic is written
//! against [`Host`], so the specs drive it with a fake host on the native target and the
//! module drives it with the real one (`guest.rs`).

/// A process the host started detached (`host.process`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Process {
    pub program: String,
    pub host: String,
    pub boot: String,
    pub pgid: i32,
    pub started: String,
}

/// A program to start (`host.spawn`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Spawn {
    pub argv: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Liveness {
    Alive,
    Dead,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Signal {
    Term,
    Kill,
}

/// What a probe says. `Stopped` is runspore:runner@0.2.0's: the holder runs but its work
/// has stopped; a 0.1 build answers `Alive` for it (`guest.rs`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Holder {
    Alive,
    Dead,
    Unknown,
    Stopped,
}

/// The try a call is for (`step.context`).
#[derive(Clone, Debug, Default)]
pub struct Context {
    pub run_id: String,
    pub tenant: String,
    pub node_id: String,
    pub action_id: String,
    pub invocation_id: String,
    pub attempt: u32,
    pub visit: u32,
    pub effect_key: String,
    pub input: String,
    pub params: String,
    pub base_dir: String,
    pub work_dir: Option<String>,
    pub step_files: Option<String>,
    pub token: Option<String>,
    pub result_channel: String,
}

/// A start that did not start the work (`step.failure`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Failure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl Failure {
    pub fn new(code: &str, message: impl Into<String>, retryable: bool) -> Self {
        Failure {
            code: code.to_string(),
            message: message.into(),
            retryable,
        }
    }
}

/// The host's imports. A call outside the action's grants traps in the real host; the
/// runner never sees it return.
pub trait Host {
    fn start_process(&self, spawn: &Spawn) -> Result<Process, String>;
    fn process_alive(&self, process: &Process) -> Liveness;
    fn signal_process(&self, process: &Process, signal: Signal) -> Result<bool, String>;
    fn request(&self, socket: &str, body: &[u8], timeout_ms: u32) -> Result<Vec<u8>, String>;
    fn sleep(&self, ms: u32);
    fn read_file(&self, path: &str) -> Result<Vec<u8>, String>;
    fn list_folder(&self, path: &str) -> Result<Vec<String>, String>;
    /// `write-file` of runspore:runner@0.1.1 and later (Web-tree/runspore#290); `None` from
    /// a host built for 0.1.0, which has no such import.
    fn write_file(&self, path: &str, bytes: &[u8]) -> Option<Result<(), String>>;
    /// Whether `write_file` exists. A workflow for such a host grants the work folder to
    /// read and write (`$RUNSPORE_WORK_DIR`); one for a 0.1.0 host cannot name it, so the
    /// runner then leaves the work folder alone.
    fn writes_files(&self) -> bool;
}
