# Model selection

Arcadia spends money in ascending order (`CONSTITUTION.md`'s Economy section):
deterministic scripts, then local models, then frontier models, then the
operator. This document is the reference every model choice checks against —
it exists so that check has one answer instead of being reinvented per Action.

There are exactly two places a model gets chosen. Nothing else should invent a
third.

## 1. Coding-agent Action handoff (`recommended_model` / `recommended_reasoning_effort`)

`arcadia go` hands one whole Action to one coding-agent session for its full
duration (`src/commands/go.ts`) — there is no mechanism to swap models
mid-session by task type. So the unit of selection is the Action, not "this
line is boilerplate, that line is architecture." A plan author sets these two
fields per Action; `go` refuses to launch unpinned.

**Model tiers are agent-agnostic.** A plan names one of three logical tiers in
`recommended_model`; `arcadia go` resolves it to a concrete model for whichever
agent is launched, from one registry (`src/codingAgents/modelTiers.ts` bundled
defaults, overridable per workspace by `config/coding-agent-models.json`). No
vendor model string is written anywhere else on the handoff path.

| Tier | codex | claude | opencode | Default effort | When |
| --- | --- | --- | --- | --- | --- |
| heavy | `gpt-6.1-sol` | `opus` | `opencode-go/gpt-5.6-luna` | `e3_deep` | A genuine redesign, a new cross-cutting mechanism, or resolving a named ambiguity/Decision the Action itself must work through. Not "this is a new feature" — most new features are standard. |
| standard | `gpt-5.6-terra` | `sonnet` | `opencode-go/deepseek-v4.1-flash` | `e2_standard` | The default for every Action unless it qualifies for heavy. Ordinary feature work, refactors, bug fixes, and the tests that ship with them stay here — Arcadia dispatches one session per Action, so there is no cheaper tier to fall back to mid-session. |
| light | `gpt-6-luna` | `haiku` | `opencode-go/glm-5.3-flash` | `e1_brief` | Mechanical, well-specified work whose acceptance criteria leave little judgment: a rename, a bounded test addition, a doc-and-config sync. |

### Sessions start on the light tier and call in help

Operator direction, 2026-10-09: "Use gpt-6-luna by default with Codex and Haiku
with Claude. I want the smallest possible model to initiate each of the
sessions, and then they can call in help from bigger models, different models,
when necessary."

So the table above is two things now: the **escalation** ladder (what a plan's
`recommended_model` names) and, separately, the **start** model. Every
coding-agent Session (`arcadia go --launch`, `arcadia session launch`, the
dashboard launch, the managed-production tick) starts on the `sessionStartTier`
model for its provider, whatever tier the plan names. The plan's tier becomes
the escalation target written into the Action brief.

- **Setting.** `sessionStartTier` in the bundled registry
  (`src/codingAgents/modelTiers.ts`), default `"light"`. A workspace changes it,
  without code, in `config/coding-agent-models.json`:
  `{ "sessionStartTier": "standard" }`, or `"plan"` to start on the plan's own
  tier as before.
- **Explicit `--model` still wins** and is never re-resolved; the brief still
  names the plan's tier as the escalation target when it differs.
- **Effort** starts at the light tier's own default (`e1_brief`) unless
  `--effort` is given; the plan's effort belongs to the plan's model and is not
  applied to the smaller one.
- `arcadia go` prints the start model and the escalation model.
- The managed-production packet still binds the plan's tier model; a Session may
  start on the start-tier model for the same provider (nothing else is accepted
  in `prepareSession`), and the packet's model is its escalation target.

**Calling in help** (a short section in the Action brief, present only when the
start model differs from the plan's):

| Agent | In-session path | Otherwise |
| --- | --- | --- |
| claude (headless) | Spawn a subagent with the Agent tool and `model: "<sonnet or opus>"`. The headless settings allow `Agent`; Claude Code lists it as needing no permission, and the subagent's own tools stay under the same allow list. | Stop; draft an Agent Ask. |
| codex | `spawn_agent` with `model: "<escalation model>"` (built-in, in-process, `multi_agent` stable in codex-cli 0.160.1; the brief is the explicit instruction its tool description requires). A nested `codex exec` is not used: the `workspace-write` sandbox has no network for child processes. | Stop; draft an Agent Ask. |
| opencode | None Arcadia can vouch for. | Stop; draft an Agent Ask. |

The fallback is always the same and honest: stop, `arcadia agent-ask draft` (or
`preview`) with `intent: proposal`, `requested_authority: propose`, asking for a
relaunch at the plan's tier; never guess past what can be verified. The Codex
`gpt-6-luna` string was confirmed in the operator's Codex models cache
(`~/.codex/models_cache.json`) on 2026-10-09.

The rules that make the tiers agent-agnostic:

- **New plans declare a tier** — `recommended_model: standard` (or `light` or
  `heavy`) — and are valid for any agent.
- **Existing concrete-model plans keep working.** A plan that still names a
  concrete model is used as-is when it plausibly belongs to the launched agent;
  when it names another provider's model it resolves that agent's `standard`
  tier, and `arcadia go` prints the substitution instead of silently swapping.
  A value that is neither a known tier nor recognizable for any agent is refused
  rather than guessed.
- **Effort is independent of the tier.** `--effort` wins, then the plan's
  `recommended_reasoning_effort`, then the tier's own default. opencode maps the
  resolved effort to its provider-specific `--variant` dial through
  `opencodeVariant`.
- **An explicit `--model` is trusted as-is** and never re-resolved.

The concrete strings above are this installation's pinned values. Adding or
changing one means verifying the exact provider string, then editing the tier
registry or the workspace override — never typing a guessed name into a plan.

**Managed-production provider pins.** The standing production path does not
pick a model per Action from `recommended_model`; it launches the provider
binding the immutable build packet recorded, and that binding's model is pinned
in the bundled `config/defaults/provider-adapters.json` (overridable by a
workspace `config/provider-adapters.json`). A third provider, `opencode-cli`, is
configured that way: binding `opencode-zen` pins
`opencode-go/deepseek-v4.1-flash` behind the `opencode_build` profile, with
opencode's `--model provider/model` argument and its provider-specific
`--variant` reasoning dial mapped from the Action's effort and clamped to that
model's `low`/`high`/`max` steps. opencode carries the
highest `costRank`, so Codex and Claude remain the default choice and opencode
is selected only when both are unavailable or excluded — the credit-exhausted
case it exists for. No `opencode_planning` profile is configured: planning
stays on Codex and Claude. opencode's own model catalogue is wide, which is why
exactly one model is pinned here rather than delegated to an unvalidated
`provider/model` string.

**No tier 3/4 exists at this layer.** Cheaper, faster model families are real
and useful, but "boilerplate/unit tests" is not a unit Arcadia can route
separately from the Action that contains it. Arcadia still has no intra-session
model switch: the Session itself runs on one model for its duration. What it
has instead is the start-small/escalate pattern above, where the Session
delegates a hard sub-problem to a bigger model through the provider's own
subagent tool. Do not route around it by mislabeling a whole Action "simple."

## 2. Intelligence capability routes (non-agent AI calls)

Everything that is *not* a coding-agent session — clarify, orientation
interpretation, morning summaries, narrative digests — goes through the
existing LiteLLM route registry (`src/intelligence/config/defaults.ts`),
keyed by `(capability, location, profile)`, resolved deterministically by
`src/intelligence/routing/resolveRoute.ts`. This is where the cheapest,
fastest model tiers actually belong: per-capability, cheapest-sufficient
profile, already wired to refuse paid usage unless a route explicitly allows
it.

This tier is not a table to fill in here — it already enforces the "smallest
sufficient model" principle in code (see `src/clarify/contract.ts`'s
hardcoded `execution: "local-preferred"`, `profile: "fast"`,
`allowPaidUsage: false`). The standing rule for any new capability route: it
defaults to the cheapest configured profile that meets its accuracy bar, and
upgrading it past that requires naming the concrete failure that justified
the upgrade — not general caution.

## Revisit trigger

Re-check the pinned models above when either vendor ships a new generation
GA — not on a calendar. Until then, this is the answer; do not re-litigate it
per Action.
