# W02 — What can be enforced at an agent boundary, and how big is the validator

Research notes for [W02](https://github.com/Max-Levitskiy/skills/issues/20) on
[Map: workflow](https://github.com/Max-Levitskiy/skills/issues/18). Throwaway branch; the canonical
answer is the resolution comment on the ticket.

Pinned to **Claude Code 2.1.269** (`claude --version`), binary
`/Users/max/.local/share/claude/versions/2.1.269` (Mach-O arm64, 194 MB, bytecode + embedded JS).
All "binary" quotes below are literal strings/source extracted from that file and are reproducible
with a byte search; all "live" results are real `claude -p` runs made on 2026-09-11.

## Part (a) — enforcement at an agent boundary

### Verdict: the premise holds, but not at the boundary the map assumed

There are three distinct boundaries, with three different answers.

| Boundary | Schema enforceable? | Mechanism | Retry on violation |
| --- | --- | --- | --- |
| **Task/Agent tool** (`subagent_type`, `.claude/agents/*.md`) | **No** | subagent returns one free-text message | none (only `maxTurns`) |
| **Headless CLI** `claude -p --json-schema <schema>` | **Yes** | `StructuredOutput` tool + Ajv, strict grammar when derivable | **yes, 5 attempts** |
| **Anthropic Messages API** (`output_config.format`, `tools[].strict`) | **Yes** | grammar-constrained decoding | n/a (cannot violate) |

Claude Code's own dynamic-workflow runtime also exposes `agent(prompt, { schema })`, documented at
<https://code.claude.com/docs/en/workflows>, which is the same machinery as the CLI flag. It is not
reachable from a plugin script (workflow scripts get no filesystem/shell access and no module
loading), so for our engine the reachable enforced boundary is the **CLI subprocess**.

### The Task-tool boundary carries no schema

The Agent tool's own prompt text, from the binary:

> The agent's final message is returned to you as the tool result; it is not shown to the user —
> relay what matters.

and results arrive as `<task-notification><result>…</result></task-notification>` — prose. The
subagent frontmatter field set (`name`, `description`, `tools`, `disallowedTools`, `model`,
`permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`,
`isolation`, `color`, `initialPrompt`, `experimental.cacheTtl`) has **no output-schema field**
(<https://code.claude.com/docs/en/sub-agents>). The nearest lever is a `SubagentStop` hook feeding
`additionalContext` back into the subagent — caller-written logic, no schema semantics.

**Consequence for the map:** an `agent` node driven by the in-session agent through the Task tool
gets *zero* harness enforcement. The validator and the repair loop are ours.

### How `--json-schema` actually enforces

`claude --help`, verbatim:

```
--json-schema <schema>   JSON Schema for structured output validation. Example:
                         {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}
```

Implementation, from the binary:

1. The schema is validated against the JSON Schema meta-schema up front. Invalid → **exit 1** before
   any model call: `Error: --json-schema is not a valid JSON Schema: data/type must be equal to one
   of the allowed values, …` (live, case 5).
2. A tool named `StructuredOutput` is injected: *"Use this tool to return your final response in the
   requested structured format. You MUST call this tool exactly once at the end of your response."*
   The declared input schema is the caller's schema.
3. A **strict-subset derivation** runs over the schema. If it succeeds the derived schema is attached
   as `strictInputJSONSchema` (grammar-constrained decoding); if it fails, Claude Code logs
   `Strict structured-output schema derivation failed, falling back to non-strict:` and proceeds
   **unstrict** — the schema is still enforced, just by Ajv after the fact instead of by the decoder.
4. Every `StructuredOutput` call is validated with Ajv. On failure the tool result is an error, fed
   straight back into the same conversation.
5. Default **5 attempts** (`var BSt=5`, override `MAX_STRUCTURED_OUTPUT_RETRIES`); exhaustion ends the
   turn with `terminal_reason: "structured_output_retry_exhausted"` and subtype
   `error_max_structured_output_retries`.

### The strict-derivation allowlist (exact, from the binary)

```js
et = new Set(["$schema","type","description","title","properties","required",
              "additionalProperties","items","enum","const","anyOf"]);
ge = new Set(["object","array","string","integer","number","boolean","null"]);
ot = 32;    // max depth
st = 1e5;   // max nodes
```

Rejection reasons, i.e. the conditions that drop a schema to non-strict: `unsupported_keyword`,
`unsupported_type`, `unsupported_const`, `unsupported_enum`, `unsupported_items`,
`mismatched_keywords`, `no_properties`, `additional_properties`, `invalid_required`, `missing_type`,
`root_not_object`, `max_depth`, `max_nodes`.

Rules worth naming, because they constrain any schema we want *grammar*-enforced:

- root must be `type: "object"`;
- an object **must** declare `properties`, and `additionalProperties` must be absent or `false` — the
  derivation then sets `additionalProperties: false` unconditionally;
- `required` entries must be strings present in `properties`, unique;
- an array **must** declare `items`, non-tuple;
- `enum`/`const` values must be primitives (`null`/string/finite number/boolean), non-empty, unique;
- `type` may be an array of types, but not one containing `object` or `array`;
- `properties`/`required`/`additionalProperties` only under `type: "object"`; `items` only under
  `type: "array"`;
- `anyOf` is allowed only as the sole keyword (plus `$schema`/`description`/`title`).

The locked subset (`object`/`array`/`string`/`number`/`boolean`, `properties`, `required`, `enum`,
`items`) is a **strict subset of this allowlist**, so it compiles to a grammar. Two shorthand
desugaring rules follow for free: every object node must emit `properties`, every array node must
emit `items`.

### Validation errors are specific enough to repair from (live evidence)

Claude Code's formatter, from the binary — Ajv error plus a keyword-specific actual-value tail:

```js
`${e.instancePath||"root"}: ${e.message}`
// + additionalProperties → ('<prop>' is not allowed)
// + minLength/maxLength  → (got N)          (N = code points of the actual string)
// + minItems/maxItems    → (got N)
// + minProperties/maxProperties → (got N)
// + enum  → : <allowedValues JSON, ≤300 chars>
// + const → : <allowedValue JSON>
throw new k(`Output does not match required schema: ${E}`, `StructuredOutput schema mismatch: ${S}`)
```

Two real violations captured from `--output-format stream-json` runs:

```
Output does not match required schema: /essay: must NOT have more than 12 characters (got 2211)
Output does not match required schema: /words: must NOT have duplicate items (items ## 2 and 1 are identical)
```

The first one **repaired itself on the next attempt** (`{"essay":"The vast sea"}`, 4 turns) — so the
"feed the error back and let it retry" loop is verified working, not assumed.

Exhaustion text (binary): `Failed to provide valid structured output after ${n} attempts — last
StructuredOutput error: ${e}`, where `e` is the last errored tool result, sanitised and truncated to
**600 chars**.

### Live results (`claude -p --output-format json --model haiku --json-schema …`)

| # | Schema | Prompt | Result |
| --- | --- | --- | --- |
| 1 | subset only | "person named Bob who is 42" | `structured_output: {name:"Bob",age:42}`, `stop_reason: tool_use` |
| 2 | `pattern:"^[0-9]{3}$"` (outside allowlist) | asked for lowercase letters | `{"sku":"123"}` — **schema won over the prompt** |
| 3 | `oneOf` | — | accepted, satisfied |
| 4 | `required:["a","b"]`, `b` undeclared | "say anything" | no structured output; model asked a clarifying question; **`subtype: success`, `is_error: false`** |
| 5 | `{"type":"nonsense-type"}` | — | exit 1, meta-schema error, no model call |
| 6 | `minimum: 100` on a toddler's age | — | `{"age":730}` — satisfied the schema by switching to days |

Four findings that matter more than the happy path:

1. **Keywords outside the allowlist are not ignored.** The API 400s on unsupported keywords, but
   Claude Code never sends them as *strict*; it falls back to non-strict and enforces them with Ajv +
   retry. So `pattern`, `minLength`, `uniqueItems`, `oneOf` all work at this boundary — at the cost
   of the grammar guarantee.
2. **The real failure mode is an absent payload, not a malformed one.** In cases 4 and D the model
   never called `StructuredOutput`; the run still reported `subtype: "success"`, `is_error: false`,
   `structured_output: null`. A caller that trusts `is_error` will read a missing result as a
   success. The `agent({schema})` path nudges and then errors
   (`agent({schema}): subagent completed without calling StructuredOutput (after in-conversation
   nudge)`); the `-p` path does not.
3. **Enforcement guarantees shape, never truth.** Case 6 is the cautionary one: given an impossible
   bound the model re-interpreted the unit rather than fail. A validated payload is not a correct
   payload.
4. **Pre-flight unsatisfiability proof is documented for `agent({schema})`** ("when it can prove the
   schema contradicts itself, the call fails … and the subagent never starts", with `required` vs
   `additionalProperties:false` as the named example) but did **not** fire on the `-p` path in case 4.
   Don't count on it.

### API-level facts (docs, for the record)

`output_config.format = {type:"json_schema", schema:…}` (the older `output_format` is deprecated;
both appear in the binary, including the error *"Both output_format and output_config.format were
provided. Please use only output_config.format (output_format is deprecated)."*). Tool inputs are
enforced by `tools[].strict = true`. Supported: all basic types, `properties`, `required`,
`additionalProperties: false`, `enum` (primitives), `const`, `default`, internal `$ref`, `anyOf`,
`allOf` (not with `$ref`), restricted `pattern`, `minItems` of 0/1. Not supported: `minimum`/
`maximum`/`multipleOf`, `minLength`/`maxLength`, other array constraints, external `$ref`, recursive
schemas, `additionalProperties` other than `false`. **Unsupported keywords are a 400, never a silent
ignore.** Documented guarantee gaps: `stop_reason: "refusal"`, `stop_reason: "max_tokens"`, and enum
**casing** drift (returns normally, no error). `oneOf` is not mentioned either way in Anthropic's
supported/unsupported lists — our exclusion of it is our own choice, not an API limit.

### Reference: a harness that already does this

The local `omp` harness implements the same repair loop over a hand-rolled (no Ajv) validator:
`MAX_SCHEMA_RETRIES = 3`, error text
`` `${scope} does not match schema: ${formatAllValidationIssues(issues)}.` `` plus
`` ` Call yield again with the corrected shape — ${remaining} retry attempt(s) remain before the schema constraint is dropped.` ``,
headline `schema_violation: missing required fields: …`, and — note the divergence from this map —
on exhaustion it **drops the constraint and accepts the output**, flagged
`Result submitted (schema validation overridden after N failed attempt(s)).` It also has a separate
`MAX_YIELD_RETRIES = 3` loop for "never produced any structured output at all", which is finding (2)
above showing up as a second, independent mechanism.

## Part (b) — validator scope and size

`docs/research/w02-validator/` holds a working implementation of the locked subset: zero imports,
Bun/TypeScript, `validate(schema, value) → {valid, errors[]}` plus `formatErrors()`.
`bun test.ts` → **22 passed, 0 failed**.

| Slice | Lines | Non-blank | Bytes |
| --- | --- | --- | --- |
| Core validator | 132 | 112 | 4766 |
| `formatErrors` | 11 | 11 | 499 |
| **Total production** | **143** | **123** | **5265** |
| Tests | 217 | 172 | 7671 |

What the subset costs those 143 lines to cover correctly — the list is the answer to "what must an
implementation actually cover", and every item is a case the tests exercise:

- `typeof null === "object"` — null rejected where `object` is declared;
- `Array.isArray` for array/object discrimination, both directions;
- `Number.isFinite` — `NaN`/`Infinity` are not valid `number`s;
- `required` checked with `key in obj`, so an explicit `null` counts as present;
- `enum` by deep equality (key-order-independent), not `===`;
- extra properties reported at `info` severity and **excluded from `valid`** — this is where the map's
  width subtyping lives in code;
- empty schema `{}` accepts anything, with no special case;
- errors accumulated across the whole tree, never fail-fast — a repair turn should see every problem
  at once;
- paths rendered JS-style (`$.owner.name`, `$.tags[1]`).

Real error strings:

```
$.owner.name: expected type "string", got number (42)
$.id: missing required property
$.kind: expected one of "agent" | "command", got string ("background-job")
$.tags[1]: expected type "string", got number (42)
$.owner: expected type "object", got null (null)
```

Full repair message = `Validation failed against schema:` + `JSON.stringify(schema)` + the error
list + `Fix the output and resubmit.` — compact enough to paste into a retry turn.

**Gaps, ranked by how fast an author will hit them**, with measured-style increments in the same
code shape: nullable-vs-optional ~5–10 lines; `minimum`/`maximum` ~10; `minLength`/`maxLength`/
`pattern` ~15; `minItems`/`maxItems` ~8; closed records / dictionary maps ~20–25. Then the cliff:
unions (`anyOf`/`oneOf`) ~25–30 lines *and* a new error-reporting semantics question (which branch's
errors do you show?), and `$ref` ~40+ with a resolution pass and cycle detection. The first five are
one more `if` in the same walk; the last two are different problems. The map's exclusions land on
exactly the right side of that line.

## Reproduce

```bash
claude --version
claude --help | grep -A2 'json-schema'
claude -p 'Give me a person named Bob who is 42.' --output-format json --model haiku \
  --json-schema '{"type":"object","properties":{"name":{"type":"string"},"age":{"type":"number"}},"required":["name","age"],"additionalProperties":false}'
# force a violation and watch the repair turn
claude -p "Write a detailed two-paragraph essay about the sea in the 'essay' field." \
  --output-format stream-json --verbose --model haiku \
  --json-schema '{"type":"object","properties":{"essay":{"type":"string","maxLength":12}},"required":["essay"],"additionalProperties":false}'
cd docs/research/w02-validator && bun test.ts
```
