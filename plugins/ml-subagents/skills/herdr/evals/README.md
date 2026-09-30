# Evaluate without pre-solving

Give a smaller-model evaluator the skill path and one prompt from cases.json. Supply
only authorization, the intended runtime/session/SSH target, and resource limits;
do not tell it which reference or commands solve the task. Missing access/binaries/auth
are valid bounded skips, not instructions to change setup. Keep all live writes in
uniquely named run-owned test sessions and scratch directories. Record initial and final
session inventories, created IDs and any stored session/scratch state left behind.

Run the deterministic helper regressions separately:

```bash
HERDR_TEST_NODE=/absolute/path/to/node python3 tests/test_helpers.py
node --test tests/test_client.mjs
```

Python tests invoke the public TypeScript/Python helpers with a fake executable, temporary
HOME and deadlines. Node 24.12+ can run TypeScript; Bun remains the normal helper runtime.
The core test with 100 fixture tasks checks worker bounds, not live fleet capacity.

## Reported independent live results (2026-09-30)

Parent-reported Luna discovery succeeded on Private WSL / Herdr 0.9.3 in wt-minipc.
It found the webtree workspace/tab/pane and no agents, refusing to infer native state
from unknown pane metadata. It loaded SKILL, targets, agents, tabs-and-panes.

A separate parent-reported Luna evaluation launched Claude Haiku 4.5 in an isolated
session, obtained a unique marker and 2+2=4, then recalled both on follow-up. It verified
actual reply evidence. It loaded SKILL, targets, workspaces, tabs-and-panes, agents,
sessions. It stopped only its run-owned session; stored session and empty scratch
remained. Default/wt-minipc were preserved. Codex was skipped: no CLI in the tested
noninteractive/login PATH and no installed integration. Remote operation was not tested.

Observed friction led to targeted PATH lookup/absolute-path guidance and deliberate cwd
before opening new sessions. Unrelated missing hook-script stderr was nonblocking and
was not repaired. File read counts are four and six respectively; evaluators' token
estimates were unmeasured. Character/byte counts can be reproduced from the files and are not
actual tokenizer measurements. No 100-agent live capacity claim follows from these runs.
