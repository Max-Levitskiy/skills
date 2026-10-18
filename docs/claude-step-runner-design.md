# Claude steps without the claude-spore binary

A Claude step in a Runspore workflow stops depending on the `claude-spore` helper program. Instead,
a small **runner module** (WASM, written in Rust, owned by ml-workflow) is sealed into the workflow
artifact. Spore loads it and grants it only the rights the workflow lists. The module starts Claude
Code for the step, in a herdr pane or as a plain windowless process, then detaches. Claude Code's own
**hooks** tell spore what happens next: still working, finished (with the answer, which spore checks
against the step's output schema), asking you, needs you, session closed. The step's lease plus a
liveness check catch the cases where no hook fires. Runspore has to learn to host modules first;
that runspore issue blocks the switch, and `claude-spore` stays as it is until then. Diagram:
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
(for example `claude` and `herdr`, resolved to a path when the run starts) and, where it matters,
the arguments it may take. A runner that tries to start anything else fails the step with a code
naming the missing grant.

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
same in both run modes.

The answer names its outcome. As json Claude steps already do (`plugins/ml-workflow/src/schema.ts`),
the final message is `{"answer": {"outcome": "<outcome>", "output": {…}}}`, and each outcome has
its own output schema. Spore checks `output` against the schema of the outcome named, and the
outcome picks the edge the run takes. The route is never guessed by matching the output against
each schema, since two outcomes' schemas can both fit the same output.

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

### 9. The switch is blocked by a runspore issue for the module host (Q9)

Hosting modules is runspore work: rights to start programs and reach herdr (WASI 0.2 has no process
spawning and no Unix sockets, so spore provides its own imports), granting them per workflow,
sealing the module, and crash tests at each failpoint. It is tracked as a runspore issue, and the
ml-workflow move to the runner module is blocked by it with a native GitHub blocking dependency, not
a note in the text. Until that issue is done, `claude-spore` stays as it is.

Rejected:
- **Keep claude-spore, move the hook parts over now, switch when the host lands** (the original
  recommendation). Would shrink claude-spore early, at the cost of a period with both.
- **Build the small separate runner first as a stepping stone.** Builds a runner twice.

If the hook parts (decisions 4, 5, 8 and the heartbeat) should start before the module host, this
decision reopens.

## Routine choices

- **Herdr unreachable** is an ordinary retryable failure (Q6). Spore's normal rules handle it:
  tries with a wait between them, then the step gives up and the run pauses for a person, who resumes
  it once herdr is back. The node's `settings.json` can change the tries and waits. The plugin's
  default: the step fails as retryable with a message naming herdr, 3 tries, starting at a 30-second
  wait.
- **Heartbeat:** the host renews the step's lease on a timer while two things hold: the runner's
  liveness check says Claude is alive, and a turn is in progress. A turn starts when a prompt
  reaches Claude (the runner delivers it, or `UserPromptSubmit` lets it through). It ends at `Stop`
  or `StopFailure`, which Claude Code fires instead of `Stop` when the turn ends on an API error.
  Hooks do not carry the heartbeat itself: `PostToolUse` fires only after a tool succeeds, so a
  long model response, one long tool or an answer with no tools would let the lease run out while
  Claude is still working.
- **A turn that ends without an accepted answer** stops the renewal. In a pane, Claude idling at
  its prompt is then not taken for work in progress. `StopFailure` fails the attempt as
  retryable. A `Stop` hook that timed out or crashed hands in nothing and is not refused either,
  so the turn simply ends: renewal stops, the step shows "needs you" once Claude is idle, and if
  nobody acts the lease runs out and spore retries as usual.
- **The step's hooks must load:** the step plugin's `SessionStart` hook tells spore the Claude
  session ID. If that does not arrive within a short time, the runner stops Claude and fails the
  step, not retryable, with a message saying the step's hooks did not load. A managed policy with
  `allowManagedHooksOnly` causes this: it blocks hooks from a `--plugin-dir` plugin unless managed
  policy force-enables it. Without this check, a background step would finish without handing in
  an answer and could only retry or expire.
- **Session closed without an answer:** a `SessionEnd` hook acts on the end reason.
  `prompt_input_exit`, `logout` and `other` mean Claude exited: the hook fails the step
  (`spore step fail`), so it retries at once instead of waiting for the lease to run out. `clear`
  and `resume` leave the same process running on a different conversation: the runner closes it and
  fails the step, so the next try resumes the step's own conversation in a new pane.
- **Safety net:** hooks are the fast path, not a guarantee. A SIGKILL, a dead machine or a failed
  hook call fires nothing, so the step's lease and a liveness check stay. The check covers the pid,
  process start time and boot ID, as `probe` does today, plus the Claude session ID recorded at
  `SessionStart`, so a live process on another conversation is not taken for the step.
- **The step token stays out of Claude's environment:** hooks and the tools Claude runs inherit
  `claude`'s environment, and decision 7 loads the user's own hooks too. The runner writes the
  token to a file only the user can read, in the step's work folder, and only the step plugin's
  hooks read it. That keeps the token out of environment dumps and logs. The file's path stays the
  same for the whole conversation, and the hooks read it on every call. When a new attempt starts
  on a live Claude, for example after you reply to a question, the runner writes the new attempt's
  token into the file before it delivers the next prompt, so the process needs no restart. It is not a hard
  boundary: in the local profile, any program running as the same user can read that file, which
  runspore `docs/11-security.md` accepts ("same-user native code and installed mods are trusted").
- **Hooks stay short:** they block Claude while they run, so each spore call has a tight timeout.
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
- **spore 0.4.0** has `spore signal <run> <name> --id <id>` (a repeated ID does nothing) and
  `spore step claim|renew|complete|fail|abandon|show` for external steps.
- **Runspore retries can wait between tries:** an action's `retry` takes `maxAttempts` (1 to 100)
  and a back-off (`backoffMs`), and the next try is not before `now + delay` (runspore
  `spec/kernel.md`).
- **The module slot is reserved:** runspore `spec/host.md` names a `component` form for `probe`,
  `watch` and `stop`, and the current host refuses it with `action.component-unsupported`. No form
  is specified for the action itself yet.
- **Runspore's security chapter** already plans WASM activities with an import allowlist, memory
  and CPU limits and capability-scoped host calls (`docs/11-security.md`).

## Risks

- **The module host is a large runspore change** (imports for starting programs and reaching
  herdr, grants, sealing, recovery tests), and everything in this design waits on it.
- **Switching off a plugin for one session** should work through a per-session settings override
  (`--settings` with `enabledPlugins`), but it has not been tried.
- **Managed hook policies:** where an organisation sets `allowManagedHooksOnly`, the step plugin's
  hooks are blocked and Claude steps cannot hand in answers at all. The `SessionStart` check turns
  that into a clear failure; making it work needs the step plugin installed through managed policy.
- **Hooks reaching the run:** not yet tested whether a hook from `--plugin-dir` sees the
  `RUNSPORE_DB`, the run ID and the token file's path that the runner put in `claude`'s
  environment, and whether
  `spore step complete` from inside the pane is accepted for the attempt the runner claimed.
- **Runs depend on the user's setup** (decision 7): a plugin or hook the user installs can change
  how a workflow behaves, or slow it.
- **A trusted workflow list** (decision 3) does not protect against a workflow copied without
  reading it.
- **What spore does with a signal nothing waits for** has not been checked; the "needs you" mark
  (decision 8) is a new step-level feature, not a signal.
- **Prompt delivery to a herdr pane** ("typed again until Claude takes it" today) still has to be
  done by the runner module, which needs herdr's `agent prompt` or `wait` through its imports.

## Deferred

None.

## Open threads

- Whether "directly" in decision 1 also means an interactive Claude in a plain terminal (a third
  run mode).
- Whether the hook parts should start before the module host (decision 9 as recorded says no).
- The runspore issue for the module host and the blocked ml-workflow issue are not filed yet.
