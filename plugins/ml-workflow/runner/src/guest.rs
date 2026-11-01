//! The world's bindings: the host's imports behind [`Host`], and the `step` exports calling
//! `runner.rs`. The default build is world `runspore:runner/runner@0.2.0`; the
//! `runner-0-1` feature builds 0.1.0 for a released spore 0.7, whose host has no
//! `write-file` and whose probe cannot say `stopped` (answered `alive` instead: Claude is
//! there, idle at its prompt).

#[cfg(not(feature = "runner-0-1"))]
wit_bindgen::generate!({ path: "wit/0.2.0", world: "runner" });
#[cfg(feature = "runner-0-1")]
wit_bindgen::generate!({ path: "wit/0.1.0", world: "runner" });

use exports::runspore::runner::step::{self, Context as WitContext, Failure as WitFailure, Holder as WitHolder};
use runspore::runner::host as wit;

use crate::host::{Context, Failure, Holder, Host, Liveness, Process, Signal, Spawn};
use crate::runner;

struct WasmHost;

fn to_wit(p: &Process) -> wit::Process {
    wit::Process {
        program: p.program.clone(),
        host: p.host.clone(),
        boot: p.boot.clone(),
        pgid: p.pgid,
        started: p.started.clone(),
    }
}

impl Host for WasmHost {
    fn start_process(&self, spawn: &Spawn) -> Result<Process, String> {
        let p = wit::start_process(&wit::Spawn {
            argv: spawn.argv.clone(),
            cwd: spawn.cwd.clone(),
            env: spawn.env.clone(),
        })?;
        Ok(Process {
            program: p.program,
            host: p.host,
            boot: p.boot,
            pgid: p.pgid,
            started: p.started,
        })
    }

    fn process_alive(&self, process: &Process) -> Liveness {
        match wit::process_alive(&to_wit(process)) {
            wit::Liveness::Alive => Liveness::Alive,
            wit::Liveness::Dead => Liveness::Dead,
            wit::Liveness::Unknown => Liveness::Unknown,
        }
    }

    fn signal_process(&self, process: &Process, signal: Signal) -> Result<bool, String> {
        let signal = match signal {
            Signal::Term => wit::Signal::Term,
            Signal::Kill => wit::Signal::Kill,
        };
        wit::signal_process(&to_wit(process), signal)
    }

    fn request(&self, socket: &str, body: &[u8], timeout_ms: u32) -> Result<Vec<u8>, String> {
        wit::request(socket, body, timeout_ms)
    }

    fn sleep(&self, ms: u32) {
        wit::sleep(ms);
    }

    fn read_file(&self, path: &str) -> Result<Vec<u8>, String> {
        wit::read_file(path)
    }

    fn list_folder(&self, path: &str) -> Result<Vec<String>, String> {
        wit::list_folder(path)
    }

    #[cfg(not(feature = "runner-0-1"))]
    fn write_file(&self, path: &str, bytes: &[u8]) -> Option<Result<(), String>> {
        Some(wit::write_file(path, bytes))
    }

    #[cfg(feature = "runner-0-1")]
    fn write_file(&self, _path: &str, _bytes: &[u8]) -> Option<Result<(), String>> {
        None
    }

    fn writes_files(&self) -> bool {
        cfg!(not(feature = "runner-0-1"))
    }
}

fn context(c: WitContext) -> Context {
    Context {
        run_id: c.run_id,
        tenant: c.tenant,
        node_id: c.node_id,
        action_id: c.action_id,
        invocation_id: c.invocation_id,
        attempt: c.attempt,
        visit: c.visit,
        effect_key: c.effect_key,
        input: c.input,
        params: c.params,
        base_dir: c.base_dir,
        work_dir: c.work_dir,
        step_files: c.step_files,
        token: c.token,
        result_channel: c.result_channel,
    }
}

struct Runner;

export!(Runner);

impl step::Guest for Runner {
    fn start(c: WitContext) -> Result<String, WitFailure> {
        runner::start(&WasmHost, &context(c)).map_err(|f: Failure| WitFailure {
            code: f.code,
            message: f.message,
            retryable: f.retryable,
        })
    }

    fn probe(_c: WitContext, handle: String) -> WitHolder {
        match runner::probe(&WasmHost, &handle) {
            Holder::Alive => WitHolder::Alive,
            Holder::Dead => WitHolder::Dead,
            Holder::Unknown => WitHolder::Unknown,
            #[cfg(not(feature = "runner-0-1"))]
            Holder::Stopped => WitHolder::Stopped,
            #[cfg(feature = "runner-0-1")]
            Holder::Stopped => WitHolder::Alive,
        }
    }

    fn stop(_c: WitContext, handle: String) -> Result<String, String> {
        runner::stop(&WasmHost, &handle)
    }
}
