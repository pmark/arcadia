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

| Tier | Model (pinned) | Default effort | When |
| --- | --- | --- | --- |
| Frontier | `claude-opus-5` | high | Only when the Action's acceptance criteria call for a genuine redesign, a new cross-cutting mechanism, or resolving a named ambiguity/Decision the Action itself must work through. Not "this is a new feature" — most new features are tier 2. |
| Default | `claude-sonnet-5` | medium (raise to high only when the Action's own criteria demand it) | The default for every Action unless it qualifies for frontier above. Ordinary feature work, refactors, bug fixes, and the tests that ship with them all stay here — Arcadia dispatches one session per Action, so there is no cheaper coding-agent tier to fall back to mid-session. |

Codex-side pins (the equivalent choice for `--agent codex`) are deliberately
not filled in here — confirm the exact supported model string against the
Codex CLI's current model list before pinning one (`codex --help` / OpenAI's
docs) rather than trusting a name typed from memory. `go.ts`'s
`isPlausibleClaudeModel` guard exists precisely because an unverified string
reaching `--model` unvalidated is a real failure mode, not a hypothetical one;
treat any Codex-side pin the same way before it reaches a launch command.

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
