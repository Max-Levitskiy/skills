# code-comment-guidelines

Explicit-only code comment guidelines for Claude Code and OpenAI Codex.

They enforce a simple default: do not add comments unless they explain a non-obvious constraint, invariant, workaround, or surprising behavior.

## Invocation

Claude Code:

```text
/code-comment-guidelines
```

OpenAI Codex:

```text
$code-comment-guidelines
```

Automatic invocation is disabled in both harnesses:

- Claude Code: `disable-model-invocation: true` in `SKILL.md`
- Codex: `policy.allow_implicit_invocation: false` in `agents/openai.yaml`
