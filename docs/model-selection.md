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
| heavy | `gpt-5.6-sol` | `opus` | `opencode-go/gpt-5.6-luna` | `e3_deep` | A genuine redesign, a new cross-cutting mechanism, or resolving a named ambiguity/Decision the Action itself must work through. Not "this is a new feature" — most new features are standard. |
| standard | `gpt-5.6-terra` | `sonnet` | `opencode-go/deepseek-v4.1-flash` | `e2_standard` | The default for every Action unless it qualifies for heavy. Ordinary feature work, refactors, bug fixes, and the tests that ship with them stay here — Arcadia dispatches one session per Action, so there is no cheaper tier to fall back to mid-session. |
| light | `gpt-5.6-luna` | `haiku` | `opencode-go/glm-5.3-flash` | `e1_brief` | Mechanical, well-specified work whose acceptance criteria leave little judgment: a rename, a bounded test addition, a doc-and-config sync. |

The rules that make it agent-agnostic:

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
separately from the Action that contains it today. Using a cheap model here
for "simple" work would require Arcadia to gain intra-session model
switching, which does not exist — that capability, if ever wanted, is a
deferred item with its own trigger (a real workload where Action-level
granularity is provably too coarse), not something to route around by
mislabeling a whole Action "simple."

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
