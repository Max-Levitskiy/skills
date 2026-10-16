# The release check

The end-to-end check of [spec.md p.25](spec.md#the-reference-loop-is-the-check-p25), run before each release of the plugin. It has two parts. The gated spec kills the reference loop at every row of the C11 table with the real `spore`, `claude` and `herdr`. This checklist then has a person go once through what only Claude Code's screen shows. Both parts need a logged-in Claude. Each run spends a few cents of `haiku` turns.

## 1. The gated spec

Install the version to release first, at user scope (`/plugin install ml-workflow@max-skills`, or `claude plugin update`). The pane's Claude hands in its answer with the installed plugin's `claude-spore`. Start herdr. Then, from the repository root:

```sh
bun test --bail ./plugins/ml-workflow/test/reference-loop.e2e.ts
```

It takes about half an hour. It opens herdr workspaces named `sp-implement-…` without focus, and closes them. A form it cannot run is skipped with the reason, so read the first lines: both forms must run. `SPORE=<path>` checks another `spore`; `E2E_FORMS=background` or `interactive` runs one form.

## 2. In Claude Code

Use a scratch repository with a `package.json` whose `npm test` passes, in a terminal Claude Code inside herdr. Do it once with `implement` in the background and once watched in a herdr pane. Tick each line.

**Writing the loop.**

- [ ] `/ml-workflow:author`, described as "Claude implements, npm test runs, red goes back to Claude three times, then I decide; I approve the result". The draft is the reference loop as a numbered list. Saving writes `.spore/workflows/coding-loop/`, and `spore validate` and `claude-spore check` pass. Nothing was committed or staged.
- [ ] For the watched pass, answer "watch it" for `implement`. The saved action is `claude-spore start` with `async`.

**Starting and following.**

- [ ] `/ml-workflow:menu` lists `coding-loop` under "Start a workflow". Picking it asks for the task, with the input's description as the question, and starts the run.
- [ ] A run line shows above the prompt: the run's key, `at implement`, and `try 1/3`. `v` opens the live view with `implement` lit, beside `workflow.dot`, `settings.json` and the instructions.

**Killing it.**

- [ ] While `implement` works, quit Claude Code (ctrl+c twice) and open a new session in the same folder. The start line names the run. The menu offers Continue, View and Cancel, or for the watched pass Open its pane, Continue, Abandon, View and Cancel. In the watched pass the pane kept working.
- [ ] Continue. The run line follows the run again. The background pass resumes the same conversation: `claude --resume <session>` in the project shows the cut-off message.
- [ ] Make the tests red. After three reds and a fourth, the session says the run needs a decision at `tests_stuck`, and the run line shows `needs you`. Close Claude Code and come back with `claude --resume`. The start line, the menu row and the decision are the same as in a new session.
- [ ] Decide keep-going with a hint. Fix the tests. At `approve`, Decide shows the summary. Reject with a reason, then approve. The session says the run finished. The run line leaves, and the next session prints no start line.
- [ ] Watched pass only: start another run, and while its pane works, close the pane's terminal and quit Claude Code, as a machine going down would. Continue from a new session. A new pane opens and resumes the conversation.
- [ ] Start another run and Cancel it from the menu while `implement` works. It asks for confirmation. The run ends, and in the watched pass its pane closes.

Record the plugin version, the `spore` version, the Claude Code version and the date in the release's pull request.
