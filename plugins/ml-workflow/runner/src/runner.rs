//! `start`, `probe` and `stop` of a Claude step (docs/claude-step-runner-design.md,
//! decisions 1–3, "The runner drives herdr over its socket", "Liveness is the runner's
//! probe"). The runner never reads `claude -p`'s exit code, which is 0 even when a hook
//! blocked the prompt: Claude hands its answer to spore through the runner's hook plugin,
//! and the probe only says whether Claude is still at work.

use serde_json::json;

use crate::budget::Budget;
use crate::claude::{self, Occasion, Params, RunMode, SessionMode};
use crate::handle::{Handle, MAX_HANDLE_BYTES};
use crate::herdr::{Agent, Herdr, HerdrError, PROTOCOLS};
use crate::host::{Context, Failure, Holder, Host, Liveness, Signal, Spawn};
use crate::session::{agent_name, project_folder, session_id};

/// The deadline spore gives a probe and a stop, less a margin for the calls' own work.
pub const PROBE_BUDGET_MS: u64 = 9_000;
/// One `agent.get` in a probe.
const PROBE_GET_MS: u32 = 2_500;
/// How long a turn must stay ended before the probe says so. Claude Code runs every `Stop`
/// hook at once, herdr's state hook among them, so `completion_seq` can rise a moment
/// before the step's own `Stop` hook has proposed its answer (runspore#278, "Note for the
/// runner module").
pub const SETTLE_MS: u32 = 3_000;
const POLL_MS: u32 = 400;
/// Escapes sent before an interrupt is given up: the spike's first one did nothing.
const ESCAPES: usize = 4;
const PROMPT_TRIES: usize = 6;

/// The file in the work folder that hands the attempt's token and identity to the runner's
/// hook plugin (mode 0600, written by `write-file`), so Claude is started without
/// `RUNSPORE_TOKEN` in its environment (`"passToken": false`).
pub const STEP_FILE: &str = "claude-step.json";
/// What a background start started, so a repeated start of the same attempt finds it.
pub const BACKGROUND_FILE: &str = "claude-runner.json";

pub fn start<H: Host>(host: &H, context: &Context) -> Result<String, Failure> {
    let params = Params::parse(&context.params)?;
    let session = session_id(&context.run_id, &context.node_id);
    let step_file = write_step_file(host, context)?;
    let mut env: Vec<(String, String)> = Vec::new();
    if let Some(path) = &step_file {
        env.push(("RUNSPORE_STEP_FILE".into(), path.clone()));
    }
    let handle = match params.run_mode {
        RunMode::Watched => start_watched(host, context, &params, &session, &env)?,
        RunMode::Background => start_background(host, context, &params, &session, &env)?,
    };
    let text = handle.to_json();
    if text.len() > MAX_HANDLE_BYTES {
        return Err(Failure::new(
            "runner.handle-too-large",
            format!("the handle takes {} bytes, over 4 KiB", text.len()),
            false,
        ));
    }
    Ok(text)
}

/// Writes the attempt's token and identity for the hooks. `None` on a host without
/// `write-file` (runspore:runner@0.1.0): there a background Claude has `RUNSPORE_TOKEN`
/// in its environment from spore, and a watched one gets no token at all.
fn write_step_file<H: Host>(host: &H, context: &Context) -> Result<Option<String>, Failure> {
    let (Some(work), Some(token)) = (&context.work_dir, &context.token) else {
        return Ok(None);
    };
    let path = format!("{}/{STEP_FILE}", work.trim_end_matches('/'));
    let body = json!({
        "token": token, "runId": context.run_id, "tenant": context.tenant, "nodeId": context.node_id,
        "actionId": context.action_id, "invocationId": context.invocation_id,
        "attempt": context.attempt, "visit": context.visit, "resultChannel": context.result_channel,
    })
    .to_string();
    match host.write_file(&path, body.as_bytes()) {
        None => Ok(None),
        Some(Ok(())) => Ok(Some(path)),
        Some(Err(e)) => Err(Failure::new(
            "runner.step-file",
            format!("could not write {path} for the step's hooks: {e}"),
            true,
        )),
    }
}

/// A new conversation, or the step's own to resume: whether Claude Code has its
/// transcript. A later visit whose conversation is gone, and a first try whose session
/// already holds one, fail for good, as `claude-spore` does (docs/spec.md, p.18).
fn session_mode<H: Host>(
    host: &H,
    context: &Context,
    params: &Params,
    cwd: &str,
    session: &str,
) -> Result<SessionMode, Failure> {
    let exists = transcript_exists(host, &params.transcripts, cwd, session);
    match (exists, context.visit, context.attempt) {
        (false, 1, _) => Ok(SessionMode::Start),
        (false, visit, _) => Err(Failure::new(
            "session.lost",
            format!(
                "the conversation of this step, {session}, is gone (removed, or on another machine); this is visit {visit}"
            ),
            false,
        )),
        (true, 1, 1) => Err(Failure::new(
            "session.foreign",
            format!(
                "the session for this step, {session}, already belongs to another conversation; this run is on its first try of its first visit"
            ),
            false,
        )),
        (true, _, _) => Ok(SessionMode::Resume),
    }
}

/// Whether Claude Code keeps `session`'s transcript for `cwd`. Each folder is listed only
/// once its parent's listing shows it: spore 0.7 refuses a path it cannot resolve as
/// outside the grant (`component.not-granted`), so a missing one is never named.
fn transcript_exists<H: Host>(host: &H, transcripts: &str, cwd: &str, session: &str) -> bool {
    let file = format!("{session}.jsonl");
    let root = transcripts.trim_end_matches('/');
    let folder = project_folder(cwd);
    let holds = |name: &str| {
        host.list_folder(&format!("{root}/{name}"))
            .is_ok_and(|names| names.contains(&file))
    };
    // Claude Code cuts a folder name over 200 characters there and adds a hash of the path.
    let prefix = &folder[..folder.len().min(200)];
    host.list_folder(root)
        .unwrap_or_default()
        .iter()
        .filter(|name| **name == folder || (folder.len() > 200 && name.starts_with(prefix)))
        .any(|name| holds(name))
}

fn herdr_failure(what: &str, error: &HerdrError) -> Failure {
    let retryable = !matches!(error, HerdrError::Malformed(_));
    Failure::new("herdr.failed", format!("{what}: {error}"), retryable)
}

fn start_watched<H: Host>(
    host: &H,
    context: &Context,
    params: &Params,
    session: &str,
    env: &[(String, String)],
) -> Result<Handle, Failure> {
    let herdr = Herdr::new(host, &params.socket);
    let mut budget = Budget::polling(params.start_timeout_ms);
    match herdr.ping(&mut budget) {
        Ok(protocol) if PROTOCOLS.contains(&protocol) => {}
        Ok(protocol) => {
            return Err(Failure::new(
                "herdr.protocol",
                format!(
                    "herdr at {} speaks protocol {protocol}; this runner was built for {PROTOCOLS:?}: update ml-workflow",
                    params.socket
                ),
                false,
            ));
        }
        // Herdr unreachable is retryable (design, "Herdr unreachable"): the node's retry waits.
        Err(e) => {
            return Err(Failure::new(
                "herdr.unreachable",
                format!("herdr at {} does not answer: {e}", params.socket),
                true,
            ));
        }
    }
    let name = agent_name(&context.node_id, session);
    let cwd = params.cwd(context);

    // A live Claude of this step, from an earlier try or visit: the new attempt goes to it.
    match herdr.agent(&mut budget, &name, 2_000) {
        Err(e) => return Err(herdr_failure("looking for this step's pane", &e)),
        Ok(Some(agent)) if holds(&agent, session) => {
            let message = claude::message(params, context, Occasion::of(context, SessionMode::Resume));
            let prompt_seq = deliver(&herdr, &mut budget, &name, &message)?;
            return Ok(Handle::Watched {
                agent: name,
                pane: agent.pane,
                workspace: agent.workspace,
                socket: params.socket.clone(),
                session: session.to_string(),
                prompt_seq,
            });
        }
        // A pane under this name that no longer holds the step's conversation.
        Ok(Some(agent)) => {
            close(&herdr, &mut budget, &name, &agent).map_err(|e| herdr_failure("closing this step's old pane", &e))?
        }
        Ok(None) => {}
    }

    let mode = session_mode(host, context, params, &cwd, session)?;
    let mut args = claude::flags(params, context, mode, session);
    args.push(claude::message(params, context, Occasion::of(context, mode)));
    let (workspace, pane) = herdr
        .create_workspace(&mut budget, &cwd, &name, env)
        .map_err(|e| herdr_failure("opening a workspace", &e))?;
    let give_up = |budget: &mut Budget, failure: Failure| {
        let _ = herdr.close_workspace(budget, &workspace);
        Err(failure)
    };
    // herdr refuses a pane whose shell has not reached its prompt yet.
    loop {
        match herdr.start_agent(&mut budget, &name, &pane, &args) {
            Ok(()) => break,
            Err(HerdrError::Api { code, .. }) if code == "agent_pane_busy" && budget.take(u64::from(POLL_MS)) => {
                host.sleep(POLL_MS)
            }
            Err(e) => return give_up(&mut budget, herdr_failure("starting Claude in the pane", &e)),
        }
    }
    // `agent.start` returns at once with `launch_pending`; the prompt went in as Claude's
    // argument and runs once Claude is ready.
    let mut blocked = 0;
    let agent = loop {
        match herdr.agent(&mut budget, &name, 2_000) {
            Ok(Some(agent)) if agent.interactive_ready => break agent,
            // A question before Claude is ready: most often whether to trust the folder.
            Ok(Some(agent)) if agent.status == "blocked" => {
                blocked += 1;
                if blocked >= 2 {
                    return give_up(
                        &mut budget,
                        Failure::new(
                            "claude.start-blocked",
                            format!(
                                "Claude stopped at a question before it was ready, most often whether to trust {cwd}: run `claude` there once and answer it, then retry the step"
                            ),
                            false,
                        ),
                    );
                }
            }
            Ok(Some(_)) => blocked = 0,
            Ok(None) => {
                return give_up(
                    &mut budget,
                    Failure::new(
                        "claude.exited",
                        format!("Claude left pane {pane} before it was ready"),
                        true,
                    ),
                );
            }
            Err(HerdrError::OutOfTime) => {}
            Err(e) => return give_up(&mut budget, herdr_failure("waiting for Claude", &e)),
        }
        if !budget.take(u64::from(POLL_MS)) {
            return give_up(
                &mut budget,
                Failure::new(
                    "claude.not-ready",
                    format!(
                        "Claude was not ready in pane {pane} within {} ms",
                        params.start_timeout_ms
                    ),
                    true,
                ),
            );
        }
        host.sleep(POLL_MS);
    };
    Ok(Handle::Watched {
        agent: name,
        pane: agent.pane,
        workspace,
        socket: params.socket.clone(),
        session: session.to_string(),
        // A new agent: its first finished turn is the first prompt's.
        prompt_seq: 0,
    })
}

/// Whether the pane still runs Claude on the step's own conversation.
fn holds(agent: &Agent, session: &str) -> bool {
    agent.program.as_deref() == Some("claude")
        && agent.interactive_ready
        && agent.session.as_deref().is_none_or(|s| s == session)
}

/// Closes the workspace when the runner made it (its label is the agent's name), else the
/// pane alone.
fn close<H: Host>(herdr: &Herdr<'_, H>, budget: &mut Budget, name: &str, agent: &Agent) -> Result<(), HerdrError> {
    if herdr.workspace_label(budget, &agent.workspace)?.as_deref() == Some(name) {
        herdr.close_workspace(budget, &agent.workspace)?;
    } else {
        herdr.close_pane(budget, &agent.pane)?;
    }
    Ok(())
}

/// Prompts a live Claude and returns `completion_seq` from just before: the prompt goes in
/// only while Claude is `idle` or `done`, after an interrupt when it is working, and is
/// tried again when herdr says Claude did not take it.
fn deliver<H: Host>(herdr: &Herdr<'_, H>, budget: &mut Budget, name: &str, message: &str) -> Result<u64, Failure> {
    for _ in 0..PROMPT_TRIES {
        let agent = match herdr.agent(budget, name, 2_000) {
            Ok(Some(agent)) => agent,
            Ok(None) => return Err(Failure::new("claude.exited", "this step's Claude left its pane", true)),
            Err(e) => return Err(herdr_failure("checking this step's Claude", &e)),
        };
        if agent.status == "working" {
            interrupt(herdr, budget, name).map_err(|e| herdr_failure("interrupting Claude", &e))?;
            continue;
        }
        if agent.at_prompt() {
            match herdr.prompt(budget, name, message) {
                Ok(()) => return Ok(agent.completion_seq),
                Err(HerdrError::Api { code, .. }) if code == "agent_prompt_stalled" || code == "agent_blocked" => {}
                Err(e) => return Err(herdr_failure("prompting Claude", &e)),
            }
        }
        // Blocked on a question, stalled, or not at its prompt yet: wait and look again.
        if !budget.take(1_000) {
            break;
        }
        herdr.sleep(1_000);
    }
    Err(Failure::new(
        "claude.prompt-refused",
        "Claude did not take the step's message: it is not at its prompt",
        true,
    ))
}

/// Stops Claude's turn. Prompts sent mid-turn are queued and would still run after an
/// interrupt, so first Up pulls them into the input box and the input is cleared; then
/// Escape, checked with `agent.get` and sent again while Claude still works.
pub fn interrupt<H: Host>(herdr: &Herdr<'_, H>, budget: &mut Budget, name: &str) -> Result<bool, HerdrError> {
    herdr.send_keys(budget, name, &["up"])?;
    let clear: Vec<&str> = std::iter::repeat_n(["ctrl+u", "backspace"], 20).flatten().collect();
    herdr.send_keys(budget, name, &clear)?;
    for _ in 0..ESCAPES {
        let before = herdr.agent(budget, name, 2_000)?;
        let Some(before) = before else { return Ok(true) };
        if before.status != "working" {
            return Ok(true);
        }
        herdr.send_keys(budget, name, &["esc"])?;
        if !budget.take(800) {
            return Err(HerdrError::OutOfTime);
        }
        herdr.sleep(800);
        match herdr.agent(budget, name, 2_000)? {
            None => return Ok(true),
            Some(after) if after.status != "working" || after.completion_seq > before.completion_seq => {
                return Ok(true);
            }
            Some(_) => {}
        }
    }
    Ok(false)
}

fn start_background<H: Host>(
    host: &H,
    context: &Context,
    params: &Params,
    session: &str,
    env: &[(String, String)],
) -> Result<Handle, Failure> {
    let work = context
        .work_dir
        .as_deref()
        .filter(|_| host.writes_files())
        .map(|w| w.trim_end_matches('/'));
    // What an earlier start in this work folder left running: this attempt's own (a worker
    // that died before spore held the handle) is the job; an earlier attempt's is ended
    // first, so two never write to one conversation.
    if let Some((attempt, Handle::Background { process, .. })) = work.and_then(|w| read_record(host, w))
        && host.process_alive(&process) == Liveness::Alive
    {
        if attempt == context.attempt {
            return Ok(Handle::Background {
                process,
                session: session.to_string(),
            });
        }
        let _ = end_process(host, &process, &mut Budget::strict(PROBE_BUDGET_MS));
    }
    let cwd = params.cwd(context);
    let mode = session_mode(host, context, params, &cwd, session)?;
    let mut argv = vec!["claude".to_string(), "-p".to_string()];
    argv.extend(claude::flags(params, context, mode, session));
    argv.push(claude::message(params, context, Occasion::of(context, mode)));
    let process = host
        .start_process(&Spawn {
            argv,
            cwd: Some(cwd),
            env: env.to_vec(),
        })
        .map_err(|e| Failure::new("claude.start-failed", format!("could not start claude: {e}"), true))?;
    let handle = Handle::Background {
        process,
        session: session.to_string(),
    };
    if let Some(work) = work {
        let body = json!({"attempt": context.attempt, "handle": handle.to_json()}).to_string();
        // Only a host with `write-file` keeps it; without, a repeated start starts again.
        let _ = host.write_file(&format!("{work}/{BACKGROUND_FILE}"), body.as_bytes());
    }
    Ok(handle)
}

fn read_record<H: Host>(host: &H, work: &str) -> Option<(u32, Handle)> {
    // Listed first: a missing file is never named (see `transcript_exists`).
    if !host.list_folder(work).ok()?.iter().any(|name| name == BACKGROUND_FILE) {
        return None;
    }
    let path = format!("{work}/{BACKGROUND_FILE}");
    let value: serde_json::Value = serde_json::from_slice(&host.read_file(&path).ok()?).ok()?;
    let attempt = u32::try_from(value.get("attempt")?.as_u64()?).ok()?;
    Some((attempt, Handle::parse(value.get("handle")?.as_str()?)?))
}

/// SIGTERM to the process group, then SIGKILL once it has not ended within 4 s.
fn end_process<H: Host>(host: &H, process: &crate::host::Process, budget: &mut Budget) -> Result<String, String> {
    if !host.signal_process(process, Signal::Term)? {
        return Ok(format!("process group {} had already ended", process.pgid));
    }
    for _ in 0..20 {
        if host.process_alive(process) == Liveness::Dead {
            return Ok(format!("ended process group {}", process.pgid));
        }
        if !budget.take(200) {
            break;
        }
        host.sleep(200);
    }
    host.signal_process(process, Signal::Kill)?;
    Ok(format!("killed process group {}", process.pgid))
}

/// What one look at a watched step's pane shows.
enum Look {
    /// The pane is closed, herdr has no such agent, Claude has left the pane, or the pane
    /// holds another conversation.
    Gone,
    Working,
    /// The prompt's turn has ended and Claude is at its prompt.
    Ended,
}

struct Watched<'a> {
    agent: &'a str,
    pane: &'a str,
    session: &'a str,
    prompt_seq: u64,
}

fn look<H: Host>(herdr: &Herdr<'_, H>, budget: &mut Budget, watched: &Watched<'_>) -> Result<Look, HerdrError> {
    let Some(agent) = herdr.agent(budget, watched.agent, PROBE_GET_MS)? else {
        return Ok(Look::Gone);
    };
    let left = agent.program.as_deref() != Some("claude") && !agent.launch_pending;
    let other = agent.session.as_deref().is_some_and(|s| s != watched.session);
    if agent.pane != watched.pane || left || other {
        return Ok(Look::Gone);
    }
    Ok(if agent.turn_ended(watched.prompt_seq) {
        Look::Ended
    } else {
        Look::Working
    })
}

/// Spore's check of a held step, at most every 30 s, inside 10 s. `Alive` while Claude
/// works on the attempt's turn or waits on a question; `Stopped` once the turn has ended
/// and stayed ended for [`SETTLE_MS`], so spore commits the hooks' candidate answer;
/// `Dead` when Claude is gone, which frees the step for another try (and commits a
/// candidate it holds). A background Claude is checked by its process group, start time
/// and boot.
pub fn probe<H: Host>(host: &H, handle: &str) -> Holder {
    match Handle::parse(handle) {
        None => Holder::Unknown,
        Some(Handle::Background { process, .. }) => match host.process_alive(&process) {
            Liveness::Alive => Holder::Alive,
            Liveness::Dead => Holder::Dead,
            Liveness::Unknown => Holder::Unknown,
        },
        Some(Handle::Watched {
            agent,
            pane,
            socket,
            session,
            prompt_seq,
            ..
        }) => {
            let herdr = Herdr::new(host, &socket);
            let mut budget = Budget::strict(PROBE_BUDGET_MS);
            let watched = Watched {
                agent: &agent,
                pane: &pane,
                session: &session,
                prompt_seq,
            };
            match look(&herdr, &mut budget, &watched) {
                Err(_) => Holder::Unknown,
                Ok(Look::Gone) => Holder::Dead,
                Ok(Look::Working) => Holder::Alive,
                Ok(Look::Ended) => {
                    if !budget.take(u64::from(SETTLE_MS)) {
                        return Holder::Alive;
                    }
                    host.sleep(SETTLE_MS);
                    match look(&herdr, &mut budget, &watched) {
                        Err(_) => Holder::Unknown,
                        Ok(Look::Gone) => Holder::Dead,
                        Ok(Look::Working) => Holder::Alive,
                        Ok(Look::Ended) => Holder::Stopped,
                    }
                }
            }
        }
    }
}

/// Ends the work when its run is cancelled: the workspace the runner made, or the
/// background process group. Inside 10 s.
pub fn stop<H: Host>(host: &H, handle: &str) -> Result<String, String> {
    let mut budget = Budget::strict(PROBE_BUDGET_MS);
    match Handle::parse(handle) {
        None => Err("the handle is not one this runner returned".into()),
        Some(Handle::Background { process, .. }) => end_process(host, &process, &mut budget),
        Some(Handle::Watched {
            workspace,
            pane,
            socket,
            ..
        }) => match Herdr::new(host, &socket).close_workspace(&mut budget, &workspace) {
            Ok(true) => Ok(format!("closed workspace {workspace} (pane {pane})")),
            Ok(false) => Ok(format!("workspace {workspace} was already closed")),
            Err(e) => Err(format!("closing workspace {workspace}: {e}")),
        },
    }
}
