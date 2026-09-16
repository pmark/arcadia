---
arcadia: v1
type: proposal
project: arcadia
question: "Can Arcadia route complex planning work to a dedicated planning agent — a configurable model, default gpt-5.6-luna at high reasoning — whose output is constrained by few-shot structural templates into exact, ordered, observable steps an executor agent can follow without interpretation?"
---

# Planning agent route with structural templates

## Why this Project needs it

Planning and build share one model today. `config/defaults/provider-adapters.json`
maps `agentProfiles: ["codex_planning", "codex_build"]` to the same bindings, and
`selectAgentProfileForWorkItem` (`src/codex/packets.ts:224-235`) returns a profile
with `configuration: null` whenever the Action has no `execution_requirement_json`.
The binding's model args are therefore never applied on that path
(`src/codingAgents/adapters.ts:21-31`), so a planning-specific, configurable model
cannot currently reach a planning run.

The planning artifact is free Markdown. Its only contract is a set of heading
greps in `src/stewardship/artifactValidator.ts:60-207`, scored
`100 - failures*12 - warnings*4` (`:197`). A lightweight tier-two model can
satisfy every heading and still emit prose no executor can follow safely. The
live two-Action rehearsal already recorded exactly that failure: a trivial
Action scored 0/9 against a planning template built for multi-phase feature
plans (`docs/reports/prove-two-action-unattended-production-runbook.md:60-68`).

There is no few-shot mechanism anywhere in the prompt path — `rg -i "few.?shot"`
matches nothing, and `renderPrompt` (`src/codex/packets.ts:303-421`) states
requirements as prose only. The consumer that must act on these plans is now an
opencode executor (Action `add-opencode-production-provider`), which needs exact
steps, not ordered phases to interpret.

## What we would build locally

A second planning pipeline, a parallel schema store, or a model name smuggled
into the `codex_planning` profile's `args`. This proposal exists to avoid all
three: routing belongs in the existing provider registry, templates in the
existing registry-loader pattern, and the contract in the existing deterministic
validator.

## Recommendation

Give planning its own provider binding, its own structural template registry,
and a machine-checked executor-step block that becomes the canonical handoff.

### 1. A configurable planning route

- Add a planning-only binding to `config/defaults/provider-adapters.json` (and
  each workspace copy): `id: codex-luna-planning`, `provider: codex-cli`,
  `agentProfiles: ["codex_luna_planning"]`, `model: gpt-5.6-luna`,
  `modelArgs: ["--model", "gpt-5.6-luna"]`, `effortArgs.e3_deep` mapping to
  `model_reasoning_effort="high"`, `capability: c2_integrated`, and a `costRank`
  below `codex-terra`.
- Add the `codex_luna_planning` profile and set
  `config/defaults/coding-agent-profiles.json` `defaults.planning` to it.
- `selectCompliantCodingAgent` already filters on
  `profile.purpose !== input.purpose`
  (`src/codingAgents/providerAdapters.ts:145`), so a planning-only binding is
  never selected for build. The model stays installation-configurable through
  the workspace registry (`src/intent/registries.ts:70-107`).
- Fix `selectAgentProfileForWorkItem` so the no-execution-requirement path still
  resolves the binding matching the profile's purpose and carries its
  `modelArgs`/`effortArgs`. Without this the configurable model is inert.

This adds no third place a model is chosen; it stays inside the provider-adapter
registry that `docs/model-selection.md` already names as place #1.

### 2. Few-shot structural templates

Add `config/defaults/planning-templates.json`, loaded and validated with the
existing registry-loader pattern in `src/intent/registries.ts`:

- `id`, `title`, `taskKinds`, `sections` (the exact headings the validator
  already expects), `executorBlock` schema version, and `examples`.
- One entry per task kind (`feature-slice`, `refactor`, `migration`,
  `integration`, `bugfix`), plus one `default` fallback.

`renderPrompt` gains two planning-only sections after `## Expected Artifact`:

- `## Output Contract (required, exact)` — the required section list and the
  fenced block schema, with an explicit "emit nothing outside these sections".
- `## Worked Examples (copy this structure)` — one or two complete artifacts,
  rendered verbatim, selected deterministically from the Action's wording and
  intent (extending the keyword routing in `src/execution/skills.ts:140-179`).

The block is the part the executor consumes:

```
arcadia-execution-steps (fields, v1)
  goal: one sentence
  repo_impact: [path, ...]
  steps:
    - id: s1
      action: "Create src/foo.ts exporting createFoo()"
      files: [src/foo.ts]
      depends_on: []
      done_when: "pnpm test tests/foo.test.ts passes"
  validation: [pnpm test tests/foo.test.ts]
```

### 3. Deterministic validator upgrade

Extend `src/stewardship/artifactValidator.ts` additively so existing artifacts
keep passing:

- Parse the fenced `arcadia-execution-steps` block into structured steps.
- New failures: `missing_executor_instruction_block`,
  `malformed_executor_instruction_block`, `executor_step_missing_concrete_verb`,
  `executor_step_missing_files`, and `executor_step_not_observable` (no
  `done_when`).
- Keep the existing prose checks so `planningPromotion.ts` and the acceptance
  Decisions keep working; the block becomes canonical, the prose becomes its
  wrapper.

### 4. Handoff to the executor

`ensureBuildPacketForPlan` (`src/commands/work.ts:1120-1202`) and
`planningPromotion.ts` currently lift `smallestFollowUpGoal` into one build
Action. Change promotion to copy the parsed block verbatim into the build
packet and to derive the executing Action's acceptance criteria from each
step's `done_when`. The executor then receives ordered steps with explicit
files, dependencies, and observable completion.

### 5. Bounded repair

The `codex_planning_artifact_validation` to `CodexPlanningRetryApproval` path
already exists (`src/execution/runner.ts:676-727`,
`src/commands/review.ts:962-1010`). Enrich the retry packet with the validator's
exact failures plus the same worked example, and cap attempts with the existing
repair-budget pattern. Deterministic feedback plus few-shot is what closes the
gap for a tier-two model; retries without it are token burn.

## Smallest implementation

The 80/20 slice is the planning binding plus one template plus the block
validator, in that order:

1. Planning binding and profile (config only).
2. `selectAgentProfileForWorkItem` binding resolution (small code fix).
3. One `feature-slice` template, rendered into the planning prompt.
4. Block parsing and the five new validator checks.
5. Promotion copies the block into the build packet.

Everything else — more templates, task-kind routing breadth, retry-prompt
enrichment — is follow-on once the first real planning run produces a block the
opencode executor actually follows.

## Deferred, with triggers

- **Per-template model overrides** — when a second concrete planning model is
  actually needed (a named task kind that Luna cannot serve).
- **Mid-plan model switching** — when a real plan provably needs a stronger
  model for one phase (the trigger `docs/model-selection.md` already names).
- **Multi-provider planning** — when a planning run must substitute providers
  under capacity pressure, which is `prove-multi-provider-production-recovery`'s
  scope, not this one.
- **A general few-shot authoring tool** — when there are more than three
  templates and hand-editing them demonstrably costs more than it saves.

## Risks

- Luna may still produce a well-formed block whose steps are wrong. The block
  validator proves shape, not correctness; the existing acceptance Decision
  remains the judgment gate, and the executor's `done_when` checks bound the
  damage.
- The block is a new contract, so validator churn could reject legitimate
  artifacts. Keeping the block additive and running it against existing plans
  in tests is the mitigation.
- Model names are configurable, so a workspace can point `defaults.planning` at
  a weaker or unavailable model. Selection already fails closed on availability
  (`src/codex/packets.ts:286-298`); the binding must keep that behavior.

## How this is verified

- Deterministic tests: block parsing accepts a valid example and refuses each
  new failure class; binding selection picks the planning binding for
  `purpose: planning` and never for build; promotion copies the block verbatim.
- One real planning run against a disposable fixture, scored by the validator
  and then executed by the opencode executor, with the transcript preserved as
  the proof Artifact.
- No change to approval boundaries: the planning packet stays planning-only,
  and the build packet still requires its own approval.

