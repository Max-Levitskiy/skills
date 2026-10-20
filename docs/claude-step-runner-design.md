# Claude steps without the claude-spore binary

A Claude step in a Runspore workflow stops depending on the `claude-spore` helper program. Instead,
a small **runner module** (WASM, written in Rust, owned by ml-workflow) is sealed into the workflow
artifact. Spore loads it and grants it only the rights the workflow lists. The module starts Claude
Code for the step, in a herdr pane or as a plain windowless process, then detaches. Claude Code's own
**hooks** tell spore what happens next: still working, finished (with the answer, which spore checks
against the step's output schema), asking you, needs you, session closed. The runner's `probe`,
which spore calls on a held step, catches the cases where no hook fires. Spore 0.7.0 hosts runner
modules; two more runspore features (decision 9) block the switch, and `claude-spore` stays as it
is until then. Diagram:
[claude-step-runner-visual.html](claude-step-runner-visual.html).

## Terms

- **step runner**: the piece that starts Claude Code for one workflow step, checks it is alive, and
  closes it. Today these are the `start`, `probe`, `watch` and `stop` commands of `claude-spore`.
  *Avoid:* helper, driver.
- **runner module**: the WASM step runner sealed into a workflow, which spore loads to start, check
  and stop Claude for a step. *Avoid:* component, plugin.
- **run mode**: how a Claude step runs: in a herdr pane you watch, or as a plain Claude Code process
  with no window. A default is set in agent config, and each workflow node can override it.
  *Avoid:* backend, driver.
- **step plugin**: a folder of skills, hooks and tools loaded into Claude Code for one step only,
  without installing anything (Claude Code's `--plugin-dir`). *Avoid:* extension, addon.
- **watched step**: a Claude step running in a herdr pane you can look at and type into.
  *Avoid:* interactive step.
- **background step**: a Claude step running with no window, its answer collected when it finishes.
  *Avoid:* headless step.

## Why

In the user's words: "I don't like from the architectural stand point the way that we add
additional kind of binary. For me, I see it more like a WASM, that run claude code as a process or
in the herdr, detaches from it, and 'monitor'/'waiting for signals', instead of maintaining some
additional binary."

Today `claude-spore` (a Bun script at `plugins/ml-workflow/bin/claude-spore`) is a second program
next to `spore`. Workflow steps call it through `command` actions (`claude-spore run`,
`claude-spore start|probe|watch|stop`, `claude-spore report`). A `spore worker` started in a plain
terminal can only find it through a separate launcher in `~/.local/bin`. It requires Bun, it is not
pinned to a run, and it does the watching (polling the pane for quiet, typing the prompt again until
Claude takes it) that Claude Code's hooks can report directly.

## Locked decisions

### 1. One step runner, two run modes, chosen in agent config and per node (Q1)

The plugin works with both herdr and the Claude Code CLI directly. Which one a step uses is its
**run mode**: a default in agent config (the ml-agent-config layers), overridable by a node
parameter in the workflow. A node's own setting wins over the default, as node settings do
everywhere else. "Directly" is read as the windowless `claude` process (today's background step).
If an interactive Claude in a plain terminal was meant, that is a third run mode to add.

The question was first asked as "what starts Claude for a step" (A: WASM module, B: small separate
program, C: built into spore). The answer settled what the runner does, not what form it takes; the
form was asked again as decision 2.

### 2. The runner is a WASM module sealed into the workflow (Q4)

Spore loads the runner module from the workflow artifact. Spore lends it the right to start
programs and talk to herdr. Settled with it: the module belongs to the ml-workflow plugin, written in
Rust (a JS component would carry a large embedded engine); spore runs it without knowing it is
Claude; a run keeps the module it started with, so updating the plugin never changes a run in
flight.

What it gains: no extra program on PATH, no launcher, no Bun requirement for step execution, the
runner pinned to the run, and a worker started in any terminal can run Claude steps.

Rejected:
- **A small separate program doing only start, alive? and stop.** Works today, and hooks would
  make it small. But it is still the extra binary on PATH that a plain-terminal worker has to find.
- **Spore itself learns to start Claude Code, as a built-in kind of step.** Least code, but
  runspore would have to know Claude Code and herdr. That reverses the recorded decision
  (runspore `docs/13-claude-and-skills-integration.md`, C10) that spore knows nothing of the
  plugin and offers it only its CLI and versioned JSON.

### 3. The workflow lists what its runner may do; spore enforces exactly that list and never asks (Q8)

A workflow folder is committed code in the project, trusted like a script in it. The list lives in
that folder and spore enforces it, so a run started overnight never stalls on a prompt.

The right to start programs names the programs, not "any program": the list gives each executable
(for example `claude`, resolved to a path when the run starts), and the sockets it may reach (herdr's).
It does not limit a program's arguments: spore 0.7.0's grants name programs only, and the runner is
the plugin's own sealed code, so a second limit inside it buys little. A runner that tries to start
anything else, or reach another socket, fails the step with `component.not-granted`, naming the
missing grant.

The boundary is the runner, not what it starts. A program the runner starts runs with the worker
user's own rights, as any `command` action does today; spore does not sandbox it. Claude's own
limits come from Claude Code's permission system and from where the step runs (a disposable
worktree, as runspore `docs/11-security.md` advises for agent workers).

Accepted cost: the list protects against a buggy runner, not against a workflow copied without
reading it, and not against what an allowed program does once started.

Rejected:
- **Spore asks the first time a workflow wants a right, and remembers the yes.** Catches a
  surprising right, but the first run of every new workflow waits for a person.
- **No list: the module may do anything spore can.** Throws away the main safety gain of moving to
  a module.

### 4. Claude hands in its answer through a hook (Q2)

When Claude ends its turn, a hook (Claude Code's `Stop` hook) reads its final message and hands it
to spore. This works in both run modes, because a herdr pane runs ordinary Claude Code.

Handing in takes two steps, because one `Stop` hook cannot know whether Claude will really stop.
Claude Code runs all matching `Stop` hooks at once, and any of them, including the user's own
(decision 7), can keep Claude working.
1. **Check:** the step's `Stop` hook has spore check the message (decision 5) and records it as
   the attempt's candidate answer. If the check fails, the hook refuses the stop.
2. **Commit:** the runner completes the attempt with the candidate only once it sees Claude has
   really stopped. It watches for this on its own, not through our hooks: a background `claude`
   process exits; in a pane, herdr reports the agent `idle` or `done` (`agent.get`). If
   Claude goes on working instead, the candidate is discarded at the first sign of it (a
   `PreToolUse`, a `UserPromptSubmit`, or herdr reporting the pane `working`), so a later stop
   whose hook fails cannot commit an earlier, stale answer. A candidate belongs to one stop.

This needs spore features that spore 0.7.0 lacks, tracked as
[Web-tree/runspore#278](https://github.com/Web-tree/runspore/issues/278). One checks an answer and
stores it as the attempt's candidate without completing the attempt. Another discards it. The
commit cannot be the runner's own call: a 0.7.0 runner exports only `start`, `probe` and `stop`
and cannot call spore, and its `probe` answers only `alive`, `dead` or `unknown`. So the runner's
probe says what it sees ("Claude has stopped"), and spore commits the candidate. Spore probes a
held step at most every 30 seconds, so an answer can take up to that long to land.

Rejected:
- **A "report" tool from the step plugin** (the original recommendation). It keeps the token out of
  the prompt and returns errors as tool errors, but needs a tool server per step. The hook gets the
  same fix loop through the `Stop` hook's refusal (decision 5).
- **Claude runs the spore command itself, with the step's token.** The token sits in the prompt, and
  a mistyped command fails less helpfully.
- **Claude writes the answer into a file, handed in when it stops.** Equivalent to the hook, but
  with a file convention Claude has to follow instead of its plain final message.

### 5. Every stop is checked against the step's output schema, in spore (Q7)

The hook does not judge whether the message is an answer; spore checks it against the step's
output schema, as runspore already does for any step. A message that fits is the answer. One that
does not is refused: the hook refuses the stop (`{"decision":"block","reason":…}`) and passes
spore's error back to Claude to fix, up to the fix limit (today's limit, twice, carries over). The
same in both run modes. The hook counts the refusals itself: Claude Code's own cap on `Stop`
continuations is far higher (a spike saw 12 in a row before Claude stopped). The step's prompt
states the answer's shape, since a refusal alone did not teach a model to produce it.

The answer names its outcome. As json Claude steps already do (`plugins/ml-workflow/src/schema.ts`),
the final message is `{"answer": {"outcome": "<outcome>", "output": {…}}}`, and each outcome has
its own output schema. Spore checks `output` against the schema of the outcome named, and the
outcome picks the edge the run takes. The route is never guessed by matching the output against
each schema, since two outcomes' schemas can both fit the same output.

A `format: "text"` step keeps working. It has one outcome and no schema, so the hook wraps Claude's
final message as that outcome's output, as `claude-spore run` does today
(`plugins/ml-workflow/src/run.ts`). There is nothing to refuse, and the two-step hand-in of
decision 4 still applies.

Rejected (the options as asked, about a stop that is a question rather than an answer):
- **In a pane, let it stop and mark "needs you"; without a window, push back** (the original
  recommendation). Two behaviours; superseded by one rule plus decision 6.
- **Always push back once, then let it stop.**
- **Always push back until it answers or runs out of fixes.**

### 6. Asking you is one of the step's allowed answers (Q10)

When Claude genuinely needs to ask something mid-step, it answers with the step's `question`
outcome, whose output carries the question, and that outcome's edge leads to the reply node. The
run then waits for your reply in the workflow, and afterwards goes back into the same
Claude conversation (one conversation per node, as today). Settled with it: you can reply in the
pane or from the plugin's menu, whichever comes first; a watched step's pane stays open while it
waits.

A reply typed in the pane must not reach Claude directly: at that moment the run is at the reply
node, so Claude has no step attempt to work under. While the step waits for a reply, a
`UserPromptSubmit` hook sends your text to spore as the reply and refuses the prompt
(`decision: "block"`). When the run comes back to the Claude node and its new attempt starts, the
runner delivers the reply to Claude as the next prompt, in the same conversation.

This interception has to fail closed: a reply hook that times out or crashes would otherwise let
the prompt through while the run has no attempt. The hook sets `"onFailure": "block"`, which Claude
Code 2.1.305 offers: with it, a crash, a timeout and a missing script each blocked the prompt in a
spike, where without it all three let the prompt through. The runner also backs it up: if herdr reports the pane `working` while the run is at the reply node, the runner
interrupts Claude (Escape, through herdr's `agent.send_keys`), and you can send the reply again.

Accepted cost: a workflow node for the reply and a resumed conversation.

Rejected:
- **No asking: Claude must hand in a real answer, with unclear points as a note in it.** Simplest
  and fully unattended, but Claude guesses where it should have asked.
- **Only in a herdr pane: a question pauses the check so you reply in the pane.** Most natural in a
  pane, but the question lives only in the terminal, is lost if the pane dies, and the two run
  modes behave differently.

### 7. The step's Claude loads the project normally, and a node can add or switch off specifics (Q5)

Claude starts in the project folder and loads everything as the user's normal Claude would: their
plugins and settings, the project's CLAUDE.md, skills and permissions. Herdr's own state hook (in
the user's settings) comes along with it. On top of that, a node can add things for its step (its
step plugin, extra tool servers) and switch things off (a plugin, a tool server, a tool).

Two different plugins come with a step. The **runner's hook plugin** carries the `SessionStart`,
`Stop`, `StopFailure`, `UserPromptSubmit`, `Notification`, tool and `SessionEnd` hooks this design
depends on. The runner always loads it, and a node cannot leave it out or switch it off. The node's
**step plugin** is optional and holds only what that node adds.

Accepted cost: a run depends on what the person who started it has installed.

Rejected:
- **The project's setup only, plus the step plugin** (the original recommendation). More
  repeatable, but drops the person's own plugins and needs the runner to add herdr's hook itself.
- **Only the step plugin.** Most repeatable, but loses the project's own instructions.

### 8. Spore records "this step needs you" (Q3)

When Claude in a watched pane waits on the person (a permission prompt, idle with a question), a
hook (Claude Code's `Notification` hook) tells spore, and spore records it on the step. `spore
status`, `spore continue` and the Claude Code menu all show it, and it survives a closed Claude
session. It needs a small runspore feature: today a signal goes to the run, not to the step it is
in.

Claude Code sends no "working again" notification, so the mark is cleared explicitly, by every
hook that shows Claude is past the wait, not only by the happy path:
- `UserPromptSubmit`: you typed into the pane;
- `PreToolUse`: Claude is about to call its next tool, which also covers a denied permission
  prompt after which Claude carries on (a manual denial emits no event of its own);
- `PostToolUse` and `PostToolUseFailure`: a tool you approved has run, whether it succeeded or
  failed;
- `Stop`: Claude ended its turn. If it then sits idle, the later `idle_prompt` notification sets
  the mark again.

The mark also clears when the step completes, fails or is abandoned. Clearing a mark that is not
set does nothing, so these hooks can clear on every call.

Rejected:
- **Only the Claude Code menu and run line show it.** No runspore change, but invisible from a
  plain terminal or after the session closes.
- **Nowhere: you notice by looking at the pane.** Loses what the watcher does today.

### 9. The switch is blocked by runspore issues (Q9)

Hosting modules was runspore work: rights to start programs and reach herdr (WASI 0.2 has no process
spawning and no Unix sockets, so spore provides its own imports), granting them per workflow,
sealing the module, and crash tests at each failpoint. It was
[Web-tree/runspore#233](https://github.com/Web-tree/runspore/issues/233), shipped in spore 0.7.0
(runspore PR #269) as a `component` action kind; Verified facts lists what it offers. Two runspore
features are still open: the "needs you" mark of decision 8,
[Web-tree/runspore#234](https://github.com/Web-tree/runspore/issues/234), and the candidate answer
of decision 4, [Web-tree/runspore#278](https://github.com/Web-tree/runspore/issues/278). The
ml-workflow move to the runner module,
[Max-Levitskiy/skills#123](https://github.com/Max-Levitskiy/skills/issues/123), is blocked by all
three with native GitHub blocking dependencies, not a note in the text. Until the open ones are
done, `claude-spore` stays as it is.

Rejected:
- **Keep claude-spore, move the hook parts over now, switch when the host lands** (the original
  recommendation). Would shrink claude-spore early, at the cost of a period with both.
- **Build the small separate runner first as a stepping stone.** Builds a runner twice.

If the hook parts (decisions 4, 5, 8 and the liveness probe) should start before the open runspore
features land, this decision reopens.

## Routine choices

- **The runner drives herdr over its socket, never the `herdr` CLI.** The CLI is a thin client over
  the same socket, and a program the runner starts has its output thrown away, so the CLI could
  not hand back a pane ID or a state. Each job is one newline-delimited JSON request and one reply
  line, which the `request` import does:
  - start: `workspace.create` (or `tab.create`) with the project folder and `focus: false`, then
    `agent.start` with `kind: "claude"` and Claude's arguments. `agent.start` returns at once with
    `launch_pending: true`, so `start` polls `agent.get` until `interactive_ready` is true (under 3
    seconds in the spike), within the action's `timeoutMs`;
  - probe: `agent.get`, whose `agent_status` is `idle`, `working`, `blocked`, `done` or `unknown`.
    The status lags a prompt (it still read `idle` just after one) and `done` stays until the next
    prompt, so "this turn ended" is `completion_seq` rising above its value when the prompt went
    in, not the status word;
  - prompt: `agent.prompt`, only while Claude is `idle` or `done`. A prompt sent mid-turn is not
    refused: Claude queues it, and it still runs after an interrupt. The `agent_prompt_stalled` and
    `agent_blocked` errors say Claude did not take it, so the runner retries on those instead of
    typing again blind;
  - Escape: `agent.send_keys` with `esc`, then `agent.get` to see it took. In the spike the first
    Escape did nothing and the second interrupted the turn, so the runner retries;
  - stop: `workspace.close` for a workspace the runner made (the spike saw the `claude` process
    gone after it), `pane.close` otherwise.

  The pane ID and the agent name go into the handle `start` returns, which spore gives back to
  every `probe` and `stop`. The runner sends `ping` first and refuses a herdr whose `protocol` it
  was not built for. The grant names the socket, `~/.config/herdr/herdr.sock` by default, or
  `HERDR_SOCKET_PATH` when set.
- **Herdr unreachable** is an ordinary retryable failure (Q6). Spore's normal rules handle it:
  tries with a wait between them, then the step gives up and the run pauses for a person, who resumes
  it once herdr is back. The node's `settings.json` can change the tries and waits. The plugin's
  default: the step fails as retryable with a message naming herdr, 3 tries, starting at a 30-second
  wait.
- **Liveness is the runner's probe:** once `start` returns its handle, spore holds the step and
  no worker renews a lease for it. Spore calls the runner's `probe` at most every 30 seconds, and
  a `dead` answer frees the step for another try. The probe says `alive` while Claude is alive and
  a turn is in progress. A turn starts when a prompt reaches Claude (the runner delivers it, or
  `UserPromptSubmit` lets it through). It ends when the runner sees Claude has really stopped, as
  in decision 4's commit step: the background process exits, or herdr reports the pane `idle` or
  `done`. Hooks do not decide it, so a refused `Stop` (decision 5's fix loop) keeps the turn in
  progress, and a `Stop` hook that crashed, timed out or was cancelled cannot leave a turn running
  forever. Hooks do not carry the liveness either: `PostToolUse` fires only after a tool succeeds,
  so a long model response, one long tool or an answer with no tools would look like a dead step.
  The step's async deadline still bounds the whole try.
- **The probe keeps no memory:** each call runs a fresh instance, and a runner can read granted
  folders but not write them. What the probe knows across calls comes from files the hooks write
  in the step's work folder, or from herdr.
- **A turn that ends without a candidate answer** is not taken for work in progress. In a pane,
  Claude idling at its prompt then shows "needs you", and the probe answers `dead` once it has
  been idle with no candidate for a set idle limit, so spore retries as usual. `StopFailure`,
  which Claude Code fires instead of `Stop` when a turn ends on an API error, fails the attempt as
  retryable. A `Stop` hook that crashed, timed out or was cancelled recorded no candidate, so it
  ends the same way.
- **The step's hooks must load:** the runner's hook plugin's `SessionStart` hook tells spore the Claude
  session ID. If that does not arrive within a short time, the runner stops Claude and fails the
  step, not retryable, with a message saying the step's hooks did not load. A managed policy with
  `allowManagedHooksOnly` causes this: it blocks hooks from a `--plugin-dir` plugin unless managed
  policy force-enables it. Without this check, a background step would finish without handing in
  an answer and could only retry or expire.
- **Session closed without an answer:** a `SessionEnd` hook acts on the end reason.
  `prompt_input_exit`, `logout` and `other` mean Claude exited: the hook fails the step
  (`spore step fail`), so it retries at once instead of waiting for the probe to see it. `clear`
  and `resume` leave the same process running on a different conversation: the runner closes it and
  fails the step, so the next try resumes the step's own conversation in a new pane.
- **Safety net:** hooks are the fast path, not a guarantee. A SIGKILL, a dead machine or a failed
  hook call fires nothing, so the runner's probe stays. For a background step it checks the
  process group, start time and boot (the host's `process-alive`); for a watched step, which herdr
  started, it asks herdr (`agent.get`), and a closed pane or an unknown agent is dead. Both also
  check the Claude session ID recorded at `SessionStart`, so a live Claude on another conversation
  is not taken for the step.
- **The step token stays out of Claude's environment:** hooks and the tools Claude runs inherit
  `claude`'s environment, and decision 7 loads the user's own hooks too. The runner writes the
  token to a file only the user can read, in the step's work folder, and only the runner's hook
  plugin reads it. That keeps the token out of environment dumps and logs. The file's path stays the
  same for the whole conversation, and the hooks read it on every call. When a new attempt starts
  on a live Claude, for example after you reply to a question, the runner writes the new attempt's
  token into the file before it delivers the next prompt, so the process needs no restart. It is not a hard
  boundary: in the local profile, any program running as the same user can read that file, which
  runspore `docs/11-security.md` accepts ("same-user native code and installed mods are trusted").
  How the file gets written with spore 0.7.0 is open (see Open threads).
- **Hooks stay short:** they block Claude while they run, so each spore call has a tight timeout.
- **Hooks that guard fail closed:** every hook whose failure would let something through
  (`UserPromptSubmit` during a reply wait, the `Stop` check) sets `"onFailure": "block"`. Claude
  Code's default is `"continue"`, so a crash, a timeout or a missing script lets the action
  through.
- **Claude's exit code means nothing:** `claude -p` exits 0 even when a hook blocked its prompt,
  so the runner reads what happened from spore and the hooks, never from the exit status.
- **Repeated signals are harmless:** spore ignores a repeated message ID, so each signal's ID names
  the one moment it answers. A reply uses the reply node's activation ID (`position.activationId`,
  for example `reply/2`), as the shipped `approve` and `tests_stuck` steps already do. A session
  that asks twice reaches two activations, so the second reply is not dropped as a repeat of the
  first.
- **No bare mode:** steps never run `claude --bare`, which skips OAuth and the keychain, so steps
  keep the user's Claude subscription sign-in.
- **The rest of claude-spore** (`menu`, `line`, `view`, `draw`, `check`, `example`, `doctor`,
  `install-spore`) is not step execution. It moves into the plugin's in-Claude code (the mod, which
  already registers tools such as `open_menu`), so skills call tools instead of a command. Together
  with the module, that retires `bin/claude-spore` and the launcher.

## Verified facts

- **The Claude Agent SDK starts the Claude Code program.** In `@anthropic-ai/claude-agent-sdk`
  0.2.117, `sdk.mjs` launches `claude` (from `@anthropic-ai/claude-agent-sdk-<platform>/claude`, about
  206 MB, Claude Code 2.1.117) with `--output-format stream-json --input-format stream-json`; the
  browser build connects over a WebSocket to a Claude Code elsewhere. So putting the SDK itself in
  WASM would not remove the native program.
- **Per-session additions in Claude Code 2.1.302:** `--plugin-dir` / `--plugin-url` (a plugin for
  this session only), `--mcp-config` with `--strict-mcp-config`, `--settings <file or JSON>` (which
  can carry hooks), `--agents`, `--setting-sources`, `--add-dir`, `--append-system-prompt`, and
  `--json-schema` for structured output. The SDK's counterparts are `plugins`, `mcpServers`,
  `strictMcpConfig`, `hooks`, `settings`, `settingSources` and `agents`.
- **`--bare` never reads OAuth or the keychain;** authentication is then `ANTHROPIC_API_KEY` or an
  `apiKeyHelper`.
- **Herdr 0.9.3 has no answer channel of its own.** It learns Claude's state (idle, working, blocked,
  done) through a Claude Code hook it installs, `~/.claude/hooks/herdr-agent-state.sh`, which reports
  over `HERDR_SOCKET_PATH` for `HERDR_PANE_ID`. `herdr agent wait --until done|blocked` waits on that
  state.
- **Hooks from `--plugin-dir`, Claude Code 2.1.305** (spike): `SessionStart`, `UserPromptSubmit`
  and `Stop` fire and see the variables in `claude`'s environment. `Stop`'s input carries
  `session_id`, `last_assistant_message`, `stop_hook_active`, `background_tasks` and
  `session_crons`. `"onFailure": "block"` makes a failed or timed-out hook block; exit 2 and
  `{"decision":"block"}` block from a hook that runs.
- **`spore step complete` from a hook** (spore 0.6.1, spike) is accepted for a step another process
  claimed, with the token and `RUNSPORE_DB` from the environment. A second complete and a changed
  token give `lease.lost`; a malformed token gives `step.token-invalid`; an answer that does not
  fit gives `output.invalid` with each error's path, and leaves the step held and the token valid,
  so Claude can try again. A completed step finishes the run only once a worker applies it.
- **Herdr's socket is its contract,** and the CLI is a client of it ("Herdr's CLI talks to the
  running server over the same local socket API", herdr `cli-reference.mdx`). It is
  newline-delimited JSON, `{"id","method","params"}` in and `{"id","result"}` or
  `{"id","error":{"code","message"}}` out. `ping` on herdr 0.9.3 returned protocol 22, and
  `herdr api schema --json` prints the schema of about 130 methods. Tried on 0.9.3 in a throwaway
  workspace: `workspace.create`, `pane.send_input`, `pane.send_keys`, `agent.list`, `pane.get` and
  `workspace.close`. Herdr keeps no state file that holds an agent's state.
- **spore 0.4.0** has `spore signal <run> <name> --id <id>` (a repeated ID does nothing) and
  `spore step claim|renew|complete|fail|abandon|show` for external steps.
- **Runspore retries can wait between tries:** an action's `retry` takes `maxAttempts` (1 to 100)
  and a back-off (`backoffMs`), and the next try is not before `now + delay` (runspore
  `spec/kernel.md`).
- **Spore 0.7.0 hosts runner modules** as a `component` action kind (runspore `spec/host.md` §3,
  `contracts/wit/runner/runner.wit`, world `runspore:runner/runner@0.1.0`). Checked against
  runspore `main` at `531833d`:
  - The runner exports `start`, `probe` and `stop`, and no `watch`. A `component` action is
    always async: `start` returns a handle of at most 4 KiB, and spore holds the step with it.
  - The host imports: `start-process` (detached, with standard input, output and error on the
    null device), `process-alive`, `signal-process`, `request` (one request over a Unix socket),
    `sleep`, and read-only `read-file` and `list-folder`. There is no import that runs a program
    and reads its output, and none that calls spore.
  - Grants list `programs`, `sockets` and `folders`, with no per-program arguments. A call outside
    them fails the step with `component.not-granted`, naming the grant and the value.
  - Each call runs a fresh instance with 64 MiB of memory, a fuel watchdog and no WASI; `start`
    gets the action's `timeoutMs`, `probe` and `stop` 10 seconds.
  - A started program gets `RUNSPORE_TOKEN` and the other async start variables, so the work
    reports with `complete_step` or `fail_step`.
  - A `dead` probe frees the step. Probes run in the sweep, at most every 30 seconds.
  - Known limit: the host checks a handle's program and start time, not that the runner started
    the process.
  - The `component` form of `probe`, `watch` and `stop` on other actions is still refused, with
    `action.component-unsupported`.
- **Runspore's security chapter** already plans WASM activities with an import allowlist, memory
  and CPU limits and capability-scoped host calls (`docs/11-security.md`).

## Risks

- **Not yet tried in a spike:** Claude's folder-trust prompt at start (herdr's `blocked` and
  `agent_not_ready`), a `Stop` hook that fails, `SessionEnd`, a long turn against the step's
  deadline, how to clear prompts Claude has queued, and a newer herdr (0.9.5 is out) against a
  runner built for protocol 22.
- **Switching off a plugin for one session** should work through a per-session settings override
  (`--settings` with `enabledPlugins`), but it has not been tried.
- **Managed hook policies:** where an organisation sets `allowManagedHooksOnly`, the runner's hook plugin's
  hooks are blocked and Claude steps cannot hand in answers at all. The `SessionStart` check turns
  that into a clear failure; making it work needs the runner's hook plugin installed through managed policy.
- **Runs depend on the user's setup** (decision 7): a plugin or hook the user installs can change
  how a workflow behaves, or slow it.
- **A trusted workflow list** (decision 3) does not protect against a workflow copied without
  reading it.
- **What spore does with a signal nothing waits for** has not been checked; the "needs you" mark
  (decision 8) is a new step-level feature, not a signal.
- **The runner acts only inside `start`, `probe` and `stop`,** so a prompt typed again or decision
  6's Escape happens on a probe, up to 30 seconds apart. The first prompt can go in as Claude's
  argument at `agent.start`; a later one is a new attempt's `start`.

## Deferred

None.

## Open threads

- Whether "directly" in decision 1 also means an interactive Claude in a plain terminal (a third
  run mode).
- Whether the hook parts should start before the open runspore features (decision 9 as recorded
  says no).
- **How the step's token and run reach the hooks.** The token-file choice assumed the runner writes
  the file, but a 0.7.0 runner cannot write files. And the two run modes differ: a program the
  runner starts always gets `RUNSPORE_TOKEN` and the other `RUNSPORE_*` variables after the
  spawn's own (`runner.wit`), so a background Claude has the token in its environment whatever the
  runner does; a watched Claude is started by herdr, whose `agent.start` takes no environment, so
  its hooks get none of them. Ways out: a runspore import that writes a file in a granted folder
  and an option to start a program without the token (the token-file choice then holds as
  written); or accept the token in a background Claude's environment, as runspore's same-user
  trust model allows, and pass a watched Claude only non-secret paths through `--settings`.
