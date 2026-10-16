# Authoring a workflow by interview

The guide the `author` skill follows (docs/spec.md p.21–p.23, design record C09). It runs in the person's own session. Nothing in it is a step of a run.

Words for the person: say **workflow**, **step**, **draft**, **run**. Do not show them JSON, DOT, `$get` or effect-class names unless they ask; the draft speaks plain words and the files hold the machinery.

Two folders beside this guide are what the interview writes for the reference coding loop. Copy their shapes:

- `examples/coding-loop/`: Claude implements, the tests run, red goes back to Claude at most 3 times in a row before a person is asked, and a person approves.
- `examples/parallel-coding-loop/`: the same loop for running several at once, with the worktree step first.

## 1. A new workflow

1. **Description.** Ask one open question and end the turn: "What should this workflow do, from start to finish?" When the conversation already describes it, draft from that and say so.
2. **Draft.** Draft the whole workflow and show it as a numbered list (§3). Fill every gap with a proposal; never leave a hole for the person to fill.
3. **Questions.** Under the draft, ask only what the description left open and what changes the outcome (§4), at most three at a time, in plain words, each with the answer the draft already proposes.
4. **Corrections.** The person corrects in plain words ("tests should go back only twice", "I want to watch implement"). Redraw the whole list after each correction. On request show a step's full instructions, exactly as they will be written, or a picture (§3).
5. **Save.** Only when the person says save (or "write it", "looks good, save"), do §6. Approval of the draft is not a save.
6. **Ending.** §7.

## 2. Names

- The workflow's name is lowercase words joined by hyphens, such as `fix-and-test`. It is both the graph id and the folder name. Propose it from the description in the draft's first line; the person may change it.
- In "new", the name must not be a folder under `.spore/workflows/` nor another workflow's graph id there: propose another. Never overwrite a workflow in "new".
- Node IDs are lowercase words joined by `_` (`tests_stuck`). Outcomes and signal names are lowercase words joined by `-` (`keep-going`, `tests-stuck`), at most 64 characters.

## 3. The draft

```
Workflow: fix-and-test   (input: task, text — what should this run build or fix?)
1. implement     Claude, in the background, can edit files          done → test
                 sees: task, why it is back, last test output
2. test          command: npm test, safe to repeat, 30 min           green → approve; red → implement (at most 3 times in a row, then → tests_stuck)
3. tests_stuck   you decide                                          keep going → implement; stop → stopped
4. approve       you decide; a rejection says why                   approved → done; rejected → implement
5. done          end, completed
6. stopped       end, failed
Instructions:
- implement: make the change the task asks for; on a return, fix what the tests or your rejection reported.
- tests_stuck: the tests keep failing; let Claude carry on, with a hint, or stop.
- approve: check the whole change in the working tree and Claude's summary; approve, or reject with a reason.
Defaults: Claude steps 3 tries, 1 h each; your decisions have no time limit.
```

- One line per step: its ID, who does it, the facts that change the outcome (watched or not, what it may do, safe to repeat or not, time limit), and where each ending goes. A Claude step gets a "sees:" line under it.
- Under the list, one line per Claude, approval and manual-work step saying what its instructions will tell the one who takes it. The full text is shown only on request.
- Under that, one "Defaults:" line with the defaults that matter most; the ending lists all of them.
- **A picture on request** is a text drawing in a code block: boxes for steps, arrows labelled with the ending that takes them, end steps marked. Nothing is written to disk for it.

## 4. What to ask, and what to propose

Ask, or propose in the draft for the person to correct, unless the description already answered it:

| Topic | Plain question | Written as |
|---|---|---|
| The steps and their order | (from the description) | `workflow.dot` nodes and edges |
| Who does each step | "Is this a command, Claude, or you?" | §5's kinds |
| Claude steps: watch or not | "Do you want to watch this step and type into it?" | background unless the person says otherwise (§5.3) |
| How each step can end, and where each ending goes | "What can come out of this step, and what happens next in each case?" | the action's `outcomes`, `exitOutcomes`, edges with `on` |
| Loops | "How many times in a row may it go back before you are asked?" | `loopLimits` and an `exhausted` arrow; propose 3 |
| Approvals and manual work | "Who approves, and what can they answer?" | an `await-signal` node with one edge per answer; `external` with actor `person` for manual work |
| What a person's answer carries | "Should a rejection say why?" | an output schema on that answer, such as a required `reason` string |
| The inputs a run starts with | "What does a run need to know when it starts?" | `inputSchema`, a `description` per property, phrased as the question the start flow asks |
| Steps that push, deploy, send messages or write to another system | "If this step is cut off halfway and run again, is that safe?" | `effect: "idempotent"` on yes, `"unsafe"` on no |
| Every other command and manual-work step | none: propose "only reads", "safe to repeat" or "not safe to repeat" in the draft | `read-only`, `idempotent` or `unsafe`. When you cannot tell, propose "not safe to repeat" and say why. Never propose `pure` |
| What each step sees | none: propose a "sees:" line | the node's `input`; for a Claude step its `context` (§5.4) |
| Several at once | "Will you run more than one of these at a time in this checkout?" | on yes, the worktree step (§5.7) |

Fill in the rest from §5's defaults, and list each one in the ending.

## 5. Writing the files

```
.spore/workflows/<name>/
  workflow.dot        the graph: id, dialect, start, each node's kind and label, each edge's on
  settings.json       format, limits when needed, inputSchema, actions, nodes
  steps/<node>.md     the instructions of each Claude, approval and manual-work step
```

Nothing else is written: no draft, scratch or backup files.

### 5.1 `workflow.dot`

- Open with a `//` comment of one to three lines saying what the workflow does.
- `digraph "<name>" {`, then `dialect = "runspore/0.2";` and `start = "<first node>";`.
- One statement per node with a `label` in plain words, `(Claude)` or `(you)` at its end for those steps; `kind="await-signal"`, `"complete"` or `"fail"` where it is not an activity.
- One edge per outcome: `a -> b [on="<outcome>"];`. `on` defaults to `ok`, so a single-outcome step's edge may omit it. A loop's back edge may carry a `label` such as `"red ×3"`.

### 5.2 `settings.json`

- `"format": "runspore.workflow/0.2"`.
- `inputSchema`: `"type": "object"`, `additionalProperties: false`, the required properties in `required`, a `description` on each. A required text input gets `"minLength": 1`.
- `actions`: one per kind of work, keyed by the node ID that uses it.
- `nodes`: each activity node's `action`, `instructions`, `outputSchemas`, `input` and `loopLimits`; each `await-signal` node's `signal`, `instructions` and `outputSchemas`; each `complete` node's `output`; each `fail` node's `error` (`{"code": "<area>.<what>", "message": "<a sentence>"}`, required).
- A `complete` node's `output` maps what the run produced: the input that names the job and the last step's result, as `examples/coding-loop/` does.
- `limits`: leave it out. Write `"limits": {"maxVisitsPerNode": <n>}` only when a loop limit needs it: a limit plus one must be at most `maxVisitsPerNode`, 16 by default, so a limit of 16 or more raises it to the limit plus one. Where a "keep going" answer can send the run round a loop again, say in the draft and in that step's instructions that the run fails once a step has been visited `maxVisitsPerNode` times, and nothing can catch that.

### 5.3 The kinds of step

The kinds are words in the draft. The files hold plain actions:

| The draft says | Action | Node |
|---|---|---|
| command | `{"kind": "command", "argv": [...], "effect": ..., "outcomes": [...], "timeoutMs": ...}`; `exitOutcomes` maps a non-zero exit code to an outcome (`{"1": "red"}`); 3 tries (`"retry": {"maxAttempts": 3}`) unless it is not safe to repeat | `action`, and `input` only when its `cwd` comes from input (§5.7) |
| Claude, in the background | `{"kind": "command", "argv": ["claude-spore", "run"], "output": "result", "effect": "idempotent", "outcomes": [...], "retry": {"maxAttempts": 3}, "timeoutMs": "3600000"}` | `action`, `instructions`, `outputSchemas`, `input` (§5.4) |
| Claude, watched | as background, with `"argv": ["claude-spore", "start"]`, no `timeoutMs` and no `output`, and `"async": {"timeoutMs": "14400000", "probe": {"command": {"argv": ["claude-spore", "probe"]}}, "watch": {"command": {"argv": ["claude-spore", "watch"]}}, "stop": {"command": {"argv": ["claude-spore", "stop"]}}}` | as background |
| Claude with a skill | as Claude, plus the `skill` parameter | as Claude |
| you decide | none | `kind="await-signal"` in the DOT; `signal` (a name for what it waits for, such as `approval`), `instructions`, and `outputSchemas` for each answer that carries data |
| you do it by hand | `{"kind": "external", "actor": "person", "effect": ..., "outcomes": [...], "async": {"timeoutMs": "604800000"}}` | `action`, `instructions`, `outputSchemas` for each outcome that carries data |

- **Watched steps need the interactive helper.** Run `claude-spore --help`. When it lists `start`, write the watched form. When it does not, tell the person in one line that watched Claude steps are not built in this release, write the step as a background step, and list that in the ending.
- A command's `timeoutMs` is proposed in the draft from what it does: 30 min (`"1800000"`) for a test suite or a build, 10 min (`"600000"`) for anything quick.
- Time limits and counts are decimal strings of milliseconds (`"3600000"`); `maxAttempts` and limits are numbers.

### 5.4 A Claude step's parameters

They go in the node's `input`, every one but `context` as a `$literal`. The set is closed: `format`, `schema`, `outcome`, `model`, `tools`, `skill`, `keepSeconds`, `context`. Nothing else may appear there.

```json
"input": {
  "format":  {"$literal": "json"},
  "schema":  {"$outputSchemas": {}},
  "tools":   {"$literal": ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]},
  "context": {
    "task":     {"$get": ["input", "task"]},
    "cameFrom": {"$get": ["from"]},
    "lastTest": {"$get": ["nodes", "test"], "default": null}
  }
}
```

- `format` is `json`, with `schema` set to `{"$outputSchemas": {}}` and an `outputSchemas` entry for every outcome of the action. Write `format: "text"` only when the person asks for a plain-text answer on a step with one outcome; then add `"outcome": {"$literal": "<that outcome>"}` and leave out `schema` and `outputSchemas`.
- `tools` from what the step does: the edits set `Read`, `Glob`, `Grep`, `Edit`, `Write`, `Bash` for a step that changes files; the reads set `Read`, `Glob`, `Grep` for one that reviews or answers. Show which in the draft ("can edit files", "only reads").
- `model` and `skill` only when the person names one.
- `keepSeconds` only on a watched step, and only when the person wants its pane to stay open after the step ends: a whole number of seconds (`{"$literal": 600}`). Without it the pane closes as the run leaves the step.
- `context` is the data Claude sees, from the "sees:" line:
  - a run input: `{"$get": ["input", "<property>"]}`;
  - why the step is running again, for any step an edge leads back to: `{"$get": ["from"]}`, which holds the step that sent the run here, its outcome and its output;
  - an earlier step's result that may not exist yet (a step later in a loop): `{"$get": ["nodes", "<node>"], "default": null}`;
  - an earlier step's output that always exists: `{"$get": ["nodes", "<node>", "output", "<field>"]}`.

### 5.5 Output schemas

- Every outcome of a `json` Claude step gets a schema. The default is `{summary: string}`, extended where the outcome carries data, such as the list of changes on `changes`:
  ```json
  {"type": "object", "additionalProperties": false, "required": ["summary"],
   "properties": {"summary": {"type": "string", "description": "What you did and why, in a few sentences."}}}
  ```
- A Claude step's schemas use only Claude Code's strict form, so `claude-spore check` reports no warning: `type`, `description`, `title`, `properties`, `required`, `additionalProperties: false`, `items`, `enum`, `const` and `anyOf`, every object with `properties`. No `minLength`, `pattern` or numeric bounds there.
- A person's answers may use any keyword spore's subset has. A reason that must be given is `{"type": "string", "minLength": 1}`.
- Schemas are written inline in `settings.json`, never as separate files.

### 5.6 Instructions files

Plain prose, no frontmatter, written to the one who takes the step.

- **A Claude step:** what the step is for and where it sits in the workflow; what each part of its `context` holds, and for `cameFrom` what each way back means; that the conversation continues on every return, so it must not repeat a failed attempt; that after an interruption it checks its earlier edits first; and what each outcome means and what its output must say.
- **A decision:** what to check and where to find it; each answer, what it does next, what data it needs, and its terminal form `spore signal <run> <signal> --outcome <o> [--data '…'] --id <activationId>`, with the activation ID from `position.activationId` in `spore status <run> --json`.
- **Manual work:** what to do, each outcome and what it means, and that the step is claimed with `spore step claim <run> --actor person`.

`examples/coding-loop/steps/` holds one of each Claude and decision kind.

### 5.7 Several at once

When the person will run more than one at a time in this checkout, add a first step `worktree` that makes the run's own git worktree, and point every later action's working folder at it. Copy it from `examples/parallel-coding-loop/settings.json`:

- **The worktree action** is a `command` running `sh -c`, which reads the run ID from `$RUNSPORE_RUN_ID`. It makes `<repo>/../<repo name>.worktrees/<run id>` on a new branch `spore/<run id>` from `HEAD`, reuses that folder when an earlier try made it, and prints `{"workdir": "<absolute path>"}`. It has `"output": "json"`, `effect: "idempotent"`, 3 tries and 10 min. Its node has no `input`.
- **Commands** get `"cwd": {"fromInput": "/workdir"}` on their action, and `"workdir": {"$get": ["nodes", "worktree", "output", "workdir"]}` in their node's `input`.
- **Claude steps** get `"cwd": {"fromInput": "/context/workdir"}` on their action, and `workdir` with the same `$get` in their `context`, since their parameter set is closed and data travels in `context`. Their instructions say that `workdir` is the folder to work in.
- A decision or manual-work step's instructions name the worktree and its branch, since the change is there and not in the main checkout.
- The worktree stays when the run ends. Say in the draft and the ending that merging and removing it are the person's.

## 6. Save

1. **The project folder.** Run `spore --json list`. When its `db` is not inside a `.spore/` folder, run `spore init`. If `init` refuses (`project.nested`, `project.legacy-database`, `project.unusable`), show its message and stop; write nothing.
2. **Write** the folder `<project root>/.spore/workflows/<name>/` (§5): `workflow.dot`, `settings.json`, and `steps/<node>.md` for each Claude, approval and manual-work step.
3. **Check:** `spore validate <folder>`, then `claude-spore check <folder>`.
4. **Fix your own errors.** On any problem or warning, edit the files and run both checks again. That is one round. After the third round that still fails, stop: show each remaining problem in plain words, with spore's fix when it gives one, and ask the person what to do.
5. **Never commit, stage or push**, and never run `git` commands that change the repository. The new folder is the person's to commit.

## 7. The ending

One short message:

- the folder written, and that `git status` shows it uncommitted;
- every default filled in, one line each: tries and time limits per kind, `effect: "idempotent"` on Claude steps, `format` and the `{summary}` schema on Claude steps, the tool sets, the loop limits, `maxVisitsPerNode` when raised, a watched step written as background, the worktree left behind after each run;
- one offer: "Start a run now?" On yes, load the `ml-workflow:start` skill with the workflow's name; it asks for the inputs.

The new workflow is already in the menu, which lists every folder under `.spore/workflows/`.

## 8. Changing a workflow

`/ml-workflow:author <workflow>` changes that workflow; `/ml-workflow:author --change` lists the workflows under `.spore/workflows/` and asks which.

1. **Find it** by graph id: the folder under `.spore/workflows/` whose `workflow.dot` declares `digraph "<workflow>"`, whatever the folder's name. A folder or `workflow.dot` path works too.
2. **Check it first** with `spore validate` and `claude-spore check`. When it does not build, still show it, with its errors first in plain words, and offer to fix them as the first change.
3. **Show it** as the same numbered list (§3), with one line per step's instructions read from its file, then ask what to change.
4. **Correct** in plain words as in §1, redrawing the list after each change.
5. **On save, edit in place** with small text edits, never by regenerating a file:
   - `workflow.dot`: keep every comment, render attribute (`label`, `shape`, `color`, …), blank line and statement order; touch only the lines the change needs.
   - `settings.json`: change only the keys the change needs, in the file's own layout and key order.
   - `steps/<node>.md`: hand-written instructions are the person's. Change a file only when the person asks, or when the change makes a sentence in it wrong; then edit only those sentences, and say which. A new step gets a new file; a removed step's file is deleted only when nothing else names it.
   - Everything not asked to change stays as it was.
6. **Check and fix** as in §6 steps 3–5.
7. **End** with the new list, only the defaults this change added, and, when `spore list` shows any unfinished run, that runs keep the version they started with and only new runs get the change.
