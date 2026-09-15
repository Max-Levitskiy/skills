# comment-rule

An explicit-only code-commenting skill for Claude Code and OpenAI Codex.

It enforces a simple default: do not add comments unless they explain a non-obvious constraint, invariant, workaround, or surprising behavior.

## Invocation

Claude Code:

```text
/comment-rule
```

OpenAI Codex:

```text
$comment-rule
```

Automatic invocation is disabled in both harnesses:

- Claude Code: `disable-model-invocation: true` in `SKILL.md`
- Codex: `policy.allow_implicit_invocation: false` in `agents/openai.yaml`
