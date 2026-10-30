//! The runner's start, probe and stop against a fake host (tests/fake): what it asks herdr
//! and the host, the handles it returns, and that a probe and a stop fit their 10 s.

mod fake;

use claude_runner::claude::{Occasion, Params, message};
use claude_runner::handle::Handle;
use claude_runner::host::{Holder, Process};
use claude_runner::runner::{self, PROBE_BUDGET_MS};
use claude_runner::session::{agent_name, session_id};
use fake::{Fake, context};
use serde_json::{Value, json};

const SESSION: &str = "643fcbd1-a449-57e4-b6da-e2077f1f1fd7";
const AGENT: &str = "sp-implement-643fcbd1a4";
const TRANSCRIPTS: &str = "~/.claude/projects/-project";

fn watched() -> Value {
    json!({"runMode": "watched", "schema": {"ok": {"type": "object"}}, "tools": ["Read", "Edit"], "instructions": "steps/implement.md"})
}

fn background() -> Value {
    json!({"runMode": "background", "format": "text", "outcome": "ok"})
}

/// Claude Code has the step's transcript for /project.
fn with_transcript(fake: &Fake) {
    let mut s = fake.state();
    s.folders
        .insert("~/.claude/projects".into(), vec!["-other".into(), "-project".into()]);
    s.folders.insert(TRANSCRIPTS.into(), vec![format!("{SESSION}.jsonl")]);
}

fn handle_of(text: &str) -> Handle {
    Handle::parse(text).expect("a handle the runner reads back")
}

#[test]
fn names_match_claude_spore() {
    // src/session.ts and src/interactive.ts give these for run_0123abcd/implement.
    assert_eq!(session_id("run_0123abcd", "implement"), SESSION);
    assert_eq!(agent_name("implement", SESSION), AGENT);
}

#[test]
fn a_handle_is_canonical_json_and_reads_back() {
    let handle = Handle::Watched {
        agent: AGENT.into(),
        pane: "w1:p1".into(),
        workspace: "w1".into(),
        socket: "~/.config/herdr/herdr.sock".into(),
        session: SESSION.into(),
        prompt_seq: 6087,
    };
    let text = handle.to_json();
    assert!(!text.contains(' ') && !text.contains('\n'));
    let keys: Vec<String> = serde_json::from_str::<Value>(&text)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted);
    assert!(
        text.contains(r#""promptSeq":"6087""#),
        "a counter is a decimal string: {text}"
    );
    assert_eq!(handle_of(&text), handle);
    let process = Process {
        program: "claude".into(),
        host: "box".into(),
        boot: "b".into(),
        pgid: 42,
        started: "77".into(),
    };
    let background = Handle::Background {
        process,
        session: SESSION.into(),
    };
    assert_eq!(handle_of(&background.to_json()), background);
    assert!(Handle::parse("{}").is_none() && Handle::parse("not json").is_none());
}

#[test]
fn params_are_checked() {
    let err = |p: Value| Params::parse(&p.to_string()).unwrap_err();
    assert_eq!(err(json!({"runMode": "pane", "outcome": "ok"})).code, "params.invalid");
    assert!(
        err(json!({"tool": ["Read"], "outcome": "ok"}))
            .message
            .contains("`tool` is not a param")
    );
    assert!(err(json!({"format": "json"})).message.contains("needs `schema`"));
    assert!(err(json!({})).message.contains("needs `outcome`"));
    assert!(!err(json!({"outcome": "ok", "startTimeoutMs": 10})).retryable);
    let params = Params::parse(&watched().to_string()).unwrap();
    assert_eq!(params.socket, "~/.config/herdr/herdr.sock");
}

#[test]
fn the_first_message_is_one_line_with_the_input_and_the_answer_form() {
    let params = Params::parse(&watched().to_string()).unwrap();
    let text = message(&params, &context(watched()), Occasion::First);
    assert!(
        !text.chars().any(char::is_control),
        "herdr refuses control characters: {text}"
    );
    assert!(
        text.contains(r#"{"task":"add a flag\nwith two lines"}"#),
        "the input as compact JSON: {text}"
    );
    assert!(text.contains("/db.files/steps/abc/steps/implement.md"));
    assert!(text.contains(r#"{"answer": {"outcome": <outcome>, "output": <output>}}"#));
    assert!(text.contains(r#"{"ok":{"type":"object"}}"#));
}

#[test]
fn watched_start_opens_a_pane_and_returns_once_claude_is_ready() {
    let fake = Fake::new();
    fake.state().herdr.busy = 2; // the new pane's shell is not at its prompt yet
    let text = runner::start(&fake, &context(watched())).expect("started");
    let Handle::Watched {
        agent,
        pane,
        workspace,
        session,
        prompt_seq,
        ..
    } = handle_of(&text)
    else {
        panic!()
    };
    assert_eq!((agent.as_str(), session.as_str(), prompt_seq), (AGENT, SESSION, 0));
    assert_eq!(pane, format!("{workspace}:p1"));
    let methods = fake.methods();
    assert_eq!(&methods[..3], ["ping", "agent.get", "workspace.create"]);
    assert_eq!(methods.iter().filter(|m| *m == "agent.start").count(), 3);
    let s = fake.state();
    let created = &s.herdr.calls.iter().find(|(m, _)| m == "workspace.create").unwrap().1;
    assert_eq!(created["focus"], json!(false));
    assert_eq!(created["cwd"], json!("/project"));
    // The token goes to a file for the hooks; the pane's environment only says where.
    assert_eq!(
        s.herdr.created_env[0],
        json!({"RUNSPORE_STEP_FILE": "/db.files/work/run_0123abcd/inv_1/claude-step.json"})
    );
    let step: Value = serde_json::from_slice(&s.files["/db.files/work/run_0123abcd/inv_1/claude-step.json"]).unwrap();
    assert_eq!(step["token"], "tok-secret");
    assert_eq!(step["attempt"], 1);
    let a = &s.herdr.agents[AGENT];
    assert!(
        a.interactive_ready,
        "start returned only once herdr said interactive_ready"
    );
    // The first prompt goes in as Claude's argument, after `--`.
    let dashes = a.args.iter().position(|x| x == "--").unwrap();
    assert_eq!(dashes, a.args.len() - 2);
    assert!(a.args.last().unwrap().starts_with("You are doing the step `implement`"));
    assert_eq!(&a.args[..2], ["--session-id", SESSION]);
    assert!(a.args.windows(2).any(|w| w == ["--allowedTools", "Read,Edit"]));
}

#[test]
fn watched_start_refuses_a_herdr_it_was_not_built_for() {
    let fake = Fake::new();
    fake.state().herdr.protocol = 23;
    let failure = runner::start(&fake, &context(watched())).unwrap_err();
    assert_eq!((failure.code.as_str(), failure.retryable), ("herdr.protocol", false));
    assert_eq!(fake.methods(), ["ping"]);
}

#[test]
fn an_unreachable_herdr_is_retryable() {
    let fake = Fake::new();
    fake.state().herdr.down = true;
    let failure = runner::start(&fake, &context(watched())).unwrap_err();
    assert_eq!((failure.code.as_str(), failure.retryable), ("herdr.unreachable", true));
    assert!(failure.message.contains("~/.config/herdr/herdr.sock"));
}

#[test]
fn a_question_before_claude_is_ready_fails_the_start_and_closes_the_pane() {
    let fake = Fake::new();
    {
        let mut s = fake.state();
        let template = fake::FakeAgent {
            name: String::new(),
            pane: String::new(),
            workspace: String::new(),
            program: Some("claude".into()),
            status: "unknown".into(),
            interactive_ready: false,
            launch_pending: true,
            completion_seq: 0,
            session: None,
            ready_after: 0,
            blocked_at_start: true,
            deaf_escapes: 0,
            stalls: 0,
            args: vec![],
        };
        s.herdr.template = Some(template);
    }
    let failure = runner::start(&fake, &context(watched())).unwrap_err();
    assert_eq!(
        (failure.code.as_str(), failure.retryable),
        ("claude.start-blocked", false)
    );
    assert!(failure.message.contains("trust /project"));
    assert!(fake.state().herdr.workspaces.is_empty(), "the pane it opened is closed");
}

#[test]
fn a_new_attempt_goes_to_the_live_pane_after_an_interrupt() {
    let fake = Fake::new();
    let mut live = fake.live_agent(AGENT, SESSION, "working", 6090);
    live.deaf_escapes = 1; // the spike's first Escape did nothing
    fake.state().herdr.agents.insert(AGENT.into(), live.clone());
    let mut ctx = context(watched());
    ctx.attempt = 2;
    let text = runner::start(&fake, &ctx).expect("started");
    let Handle::Watched { pane, prompt_seq, .. } = handle_of(&text) else {
        panic!()
    };
    assert_eq!(pane, live.pane);
    assert_eq!(prompt_seq, 6091, "the prompt went in after the interrupted turn ended");
    let s = fake.state();
    let keys: Vec<Value> = s
        .herdr
        .calls
        .iter()
        .filter(|(m, _)| m == "agent.send_keys")
        .map(|(_, p)| p["keys"][0].clone())
        .collect();
    assert_eq!(
        keys,
        [json!("up"), json!("ctrl+u"), json!("esc"), json!("esc")],
        "queued prompts pulled and cleared, then Escape twice"
    );
    let prompt = &s.herdr.calls.iter().find(|(m, _)| m == "agent.prompt").unwrap().1;
    assert!(prompt["text"].as_str().unwrap().starts_with("You were cut off"));
    assert!(!s.herdr.calls.iter().any(|(m, _)| m == "workspace.create"));
    // The new attempt's token replaces the old one in the same file.
    let step: Value = serde_json::from_slice(&s.files["/db.files/work/run_0123abcd/inv_1/claude-step.json"]).unwrap();
    assert_eq!(step["attempt"], 2);
}

#[test]
fn a_prompt_claude_did_not_take_is_sent_again() {
    let fake = Fake::new();
    let mut live = fake.live_agent(AGENT, SESSION, "idle", 7);
    live.stalls = 2;
    fake.state().herdr.agents.insert(AGENT.into(), live);
    let mut ctx = context(watched());
    ctx.visit = 2;
    runner::start(&fake, &ctx).expect("started");
    let prompts = fake.methods().iter().filter(|m| *m == "agent.prompt").count();
    assert_eq!(prompts, 3);
}

#[test]
fn a_pane_holding_another_conversation_is_closed_and_a_new_one_opened() {
    let fake = Fake::new();
    fake.live_agent(AGENT, "another-session", "idle", 3);
    with_transcript(&fake);
    let mut ctx = context(watched());
    ctx.visit = 2;
    runner::start(&fake, &ctx).expect("started");
    let s = fake.state();
    assert_eq!(s.herdr.workspaces.len(), 1);
    let a = &s.herdr.agents[AGENT];
    assert_eq!(&a.args[..2], ["--resume", SESSION], "the transcript exists: resume it");
    assert!(
        a.args
            .last()
            .unwrap()
            .starts_with("The run came back to this step: this is its visit 2")
    );
}

#[test]
fn sessions_that_cannot_be_right_fail_for_good() {
    let fake = Fake::new();
    with_transcript(&fake);
    let failure = runner::start(&fake, &context(background())).unwrap_err();
    assert_eq!((failure.code.as_str(), failure.retryable), ("session.foreign", false));
    let fake = Fake::new();
    let mut ctx = context(background());
    ctx.visit = 3;
    let failure = runner::start(&fake, &ctx).unwrap_err();
    assert_eq!((failure.code.as_str(), failure.retryable), ("session.lost", false));
}

fn watched_handle(fake: &Fake, status: &str, completion_seq: u64, prompt_seq: u64) -> String {
    let live = fake.live_agent(AGENT, SESSION, status, completion_seq);
    Handle::Watched {
        agent: AGENT.into(),
        pane: live.pane,
        workspace: live.workspace,
        socket: "~/.config/herdr/herdr.sock".into(),
        session: SESSION.into(),
        prompt_seq,
    }
    .to_json()
}

fn probe_within_deadline(fake: &Fake, handle: &str) -> Holder {
    fake.reset_clock();
    let holder = runner::probe(fake, handle);
    let worst = fake.state().worst_ms;
    assert!(
        worst <= PROBE_BUDGET_MS,
        "a probe's calls may take {worst} ms, over its deadline"
    );
    holder
}

#[test]
fn a_watched_probe_says_alive_while_the_turn_runs() {
    let fake = Fake::new();
    let handle = watched_handle(&fake, "working", 6087, 6087);
    assert_eq!(probe_within_deadline(&fake, &handle), Holder::Alive);
    // The status lags a prompt: idle with no finished turn since is still the turn.
    fake.state().herdr.agents.get_mut(AGENT).unwrap().status = "idle".into();
    assert_eq!(probe_within_deadline(&fake, &handle), Holder::Alive);
    fake.state().herdr.agents.get_mut(AGENT).unwrap().status = "blocked".into();
    assert_eq!(
        probe_within_deadline(&fake, &handle),
        Holder::Alive,
        "a question waits for the person"
    );
}

#[test]
fn a_watched_probe_says_stopped_once_the_turn_has_stayed_ended() {
    let fake = Fake::new();
    let handle = watched_handle(&fake, "done", 6088, 6087);
    assert_eq!(probe_within_deadline(&fake, &handle), Holder::Stopped);
    let s = fake.state();
    assert_eq!(s.sleeps, [runner::SETTLE_MS], "it looked twice, the settle time apart");
}

#[test]
fn a_watched_probe_says_dead_when_claude_is_gone() {
    let fake = Fake::new();
    let handle = watched_handle(&fake, "idle", 0, 0);
    fake.state().herdr.agents.get_mut(AGENT).unwrap().program = None; // Claude exited to the shell
    assert_eq!(probe_within_deadline(&fake, &handle), Holder::Dead);
    fake.state().herdr.agents.get_mut(AGENT).unwrap().program = Some("claude".into());
    fake.state().herdr.agents.get_mut(AGENT).unwrap().session = Some("after-clear".into());
    assert_eq!(
        probe_within_deadline(&fake, &handle),
        Holder::Dead,
        "another conversation is not the step"
    );
    fake.state().herdr.agents.clear(); // the pane was closed
    assert_eq!(probe_within_deadline(&fake, &handle), Holder::Dead);
    fake.state().herdr.down = true;
    assert_eq!(
        probe_within_deadline(&fake, &handle),
        Holder::Unknown,
        "herdr not answering frees nothing"
    );
    assert_eq!(probe_within_deadline(&fake, "not a handle"), Holder::Unknown);
}

#[test]
fn a_watched_stop_closes_the_workspace_within_its_deadline() {
    let fake = Fake::new();
    let handle = watched_handle(&fake, "working", 1, 1);
    fake.reset_clock();
    let said = runner::stop(&fake, &handle).unwrap();
    assert!(said.starts_with("closed workspace w1"), "{said}");
    assert!(fake.state().worst_ms <= PROBE_BUDGET_MS);
    assert!(fake.state().herdr.agents.is_empty());
    assert_eq!(runner::stop(&fake, &handle).unwrap(), "workspace w1 was already closed");
    fake.state().herdr.down = true;
    assert!(
        runner::stop(&fake, &handle)
            .unwrap_err()
            .contains("herdr does not answer")
    );
}

#[test]
fn background_start_runs_claude_p_without_reading_its_exit() {
    let fake = Fake::new();
    let text = runner::start(&fake, &context(background())).expect("started");
    let Handle::Background { process, session } = handle_of(&text) else {
        panic!()
    };
    assert_eq!(session, SESSION);
    let s = fake.state();
    let (_, _, spawn) = &s.processes[&process.pgid];
    assert_eq!(&spawn.argv[..4], ["claude", "-p", "--session-id", SESSION]);
    assert_eq!(spawn.argv[spawn.argv.len() - 2], "--");
    assert!(
        spawn
            .argv
            .last()
            .unwrap()
            .ends_with("your last message is the step's output.")
    );
    assert_eq!(spawn.cwd.as_deref(), Some("/project"));
    assert_eq!(
        spawn.env,
        [(
            "RUNSPORE_STEP_FILE".to_string(),
            "/db.files/work/run_0123abcd/inv_1/claude-step.json".to_string()
        )]
    );
    assert!(
        s.files
            .contains_key("/db.files/work/run_0123abcd/inv_1/claude-runner.json")
    );
}

#[test]
fn a_repeated_background_start_finds_its_claude() {
    let fake = Fake::new();
    let first = runner::start(&fake, &context(background())).unwrap();
    assert_eq!(
        runner::start(&fake, &context(background())).unwrap(),
        first,
        "the same attempt: the same Claude"
    );
    assert_eq!(fake.state().processes.len(), 1);
    // The next attempt ends the earlier one's Claude before it resumes the conversation.
    with_transcript(&fake);
    let mut ctx = context(background());
    ctx.attempt = 2;
    let second = runner::start(&fake, &ctx).unwrap();
    let Handle::Background { process: old, .. } = handle_of(&first) else {
        panic!()
    };
    let Handle::Background { process: new, .. } = handle_of(&second) else {
        panic!()
    };
    let s = fake.state();
    assert!(!s.processes[&old.pgid].1, "the earlier Claude was ended");
    assert_eq!(&s.processes[&new.pgid].2.argv[2..4], ["--resume", SESSION]);
}

#[test]
fn a_host_without_write_file_leaves_the_work_folder_alone() {
    let fake = Fake::new();
    fake.state().writes = false;
    runner::start(&fake, &context(background())).unwrap();
    let s = fake.state();
    assert!(s.files.is_empty());
    assert!(s.processes.values().next().unwrap().2.env.is_empty());
}

#[test]
fn a_killed_background_claude_probes_dead_and_stop_escalates() {
    let fake = Fake::new();
    let text = runner::start(&fake, &context(background())).unwrap();
    assert_eq!(probe_within_deadline(&fake, &text), Holder::Alive);
    let Handle::Background { process, .. } = handle_of(&text) else {
        panic!()
    };
    fake.state().processes.get_mut(&process.pgid).unwrap().1 = false; // kill -9
    assert_eq!(probe_within_deadline(&fake, &text), Holder::Dead);

    let text = runner::start(&fake, &context(background())).unwrap();
    let Handle::Background { process, .. } = handle_of(&text) else {
        panic!()
    };
    fake.state().ignores_term.insert(process.pgid);
    fake.reset_clock();
    assert!(runner::stop(&fake, &text).unwrap().starts_with("killed process group"));
    assert!(fake.state().worst_ms <= PROBE_BUDGET_MS);
}
