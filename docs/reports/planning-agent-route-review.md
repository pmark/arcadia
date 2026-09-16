---
arcadia: v1
type: review
project: arcadia
reviewed: docs/proposals/planning-agent-route-with-structural-templates.md
updated: 2026-09-15
---

# Review: planning-agent-route-with-structural-templates

Independent review. No code or governance state was modified. Every factual
claim in the proposal was checked against the code at the current revision.
Re-created after the original write of this file failed to persist; content is
unchanged from that review.

## Part 1 — Factual verification

| # | Claim (proposal lines) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `config/defaults/provider-adapters.json` maps `["codex_planning", "codex_build"]` to the same bindings (:12-13) | **Correct** | `codex-terra` and `codex-sol` both list both profiles (`config/defaults/provider-adapters.json:24,43`). |
| 2 | `selectAgentProfileForWorkItem` (`src/codex/packets.ts:224-235`) returns a profile with `configuration: null` whenever the Action has no `execution_requirement_json` (:14-15) | **Correct** | Verified at `src/codex/packets.ts:224-235` — the condition is `!input.workItem.execution_requirement_json || !input.adapters`; "whenever" is marginally broad but accurate in substance. |
| 3 | The binding's model args are therefore never applied on that path (`src/codingAgents/adapters.ts:21-31`) (:16-18) | **Correct but materially understated** — see Finding B1. `buildCodingAgentCommand` (`src/codingAgents/adapters.ts:20-34`) merges `configurationArgs`; the null path passes none (`src/codex/packets.ts:81-86`). But the only real spawn site, `src/execution/runner.ts:369` → `spawnSync` at `:423-431`, calls `buildCodingAgentCommand(profile, executionScope, finalMessagePath)` with **no** `configurationArgs` on *every* path. Binding model args reach the packet's display command only; they never reach a launched process, with or without an execution requirement. |
| 4 | The planning artifact's only contract is heading greps in `src/stewardship/artifactValidator.ts:60-207`, scored `100 - failures*12 - warnings*4` (`:197`) (:20-23) | **Correct** | Function spans `60-207`; score formula verbatim at `:197`. It also does content checks (`:417-440`), but "heading greps" is a fair summary. |
| 5 | The live two-Action rehearsal recorded a trivial Action scored 0/9 against a planning template built for multi-phase feature plans (:24-26) | **Correct** | `docs/reports/prove-two-action-unattended-production-runbook.md:60-68`; "scored 0/9 in the live run" at line 67. |
| 6 | No few-shot mechanism anywhere in the prompt path; `renderPrompt` (`src/codex/packets.ts:303-421`) states requirements as prose only (:28-31) | **Correct** | `rg -i "few.?shot"` over `src/` matches nothing; `renderPrompt` sections are prose-only, confirmed section by section. |
| 7 | `selectCompliantCodingAgent` filters on `profile.purpose !== input.purpose` (`src/codingAgents/providerAdapters.ts:145`), so a planning-only binding is never selected for build (:57-59) | **Correct, citation off by one** | The purpose filter is at `src/codingAgents/providerAdapters.ts:144`; `:145` is the `requestedProfile` filter. Conclusion holds. |
| 8 | The model stays installation-configurable through the workspace registry (`src/intent/registries.ts:70-107`) (:60-61) | **Correct** | `loadPhase3Registries` at `src/intent/registries.ts:70-77`; `registryPath` prefers the workspace copy at `:103-107`. |
| 9 | The retry path `codex_planning_artifact_validation` → `CodexPlanningRetryApproval` already exists (`src/execution/runner.ts:676-727`, `src/commands/review.ts:962-1010`) (:127-129) | **Correct** | `createPlanningValidationReviewItem` at `runner.ts:676-727`; review.ts `:962-1010` converts its approval into a `CodexPlanningRetryApproval`. |
| 10 | Cap attempts with "the existing repair-budget pattern" (:130-131) | **Misplaced** | A repair budget exists only in the production loop (`src/production/policy.ts:57`, `repair_budget_exhausted` at `src/production/tick.ts:194`). The planning retry path has no budget; each attempt is gated by a fresh operator approval (`review.ts:962-1010`). |
| 11 | `ensureBuildPacketForPlan` (`work.ts:1120-1202`) and `planningPromotion.ts` lift `smallestFollowUpGoal` into one build Action (:118-120) | **Half correct** | `ensureBuildPacketForPlan` (`src/commands/work.ts:1120-1202`) prepares the packet and approval for an existing work item; it lifts nothing. The lift happens in `src/projects/planningPromotion.ts:250-272` (`next_action`/title from `fields.smallestFollowUpGoal`); acceptance criteria at `:264-268`. |
| 12 | Selection already fails closed on availability (`src/codex/packets.ts:286-298`) (:170-172) | **Correct for that path** | `selectAgentProfile` throws or falls back at `src/codex/packets.ts:286-298`. But see Finding B6 for the binding path. |
| 13 | Template selection can extend "the keyword routing in `src/execution/skills.ts:140-179`" (:84-85) | **Correct** | `planStepsForWorkItem` and its codex_planning/codex_build keyword routing sit exactly there (`src/execution/skills.ts:157-178`). |
| 14 | `gpt-5.6-luna` as the pinned model | **Unverified** | The string appears in the repo only in a plan frontmatter (`docs/plans/decision-queue-reconciliation.md:10`) and this proposal. `docs/model-selection.md:24-30` requires confirming Codex-side model strings against the CLI's current model list before pinning; the proposal pins it without naming that verification step. |
| 15 | The consumer that must act on these plans is now an opencode executor (Action `add-opencode-production-provider`) (:30-32) | **Correct** | `docs/plans/bootstrap-managed-production-to-build-flight-deck.md:790-812` (`current_action: add-opencode-production-provider`). Note that Action's criterion at `:806` explicitly defers "an opencode planning profile" against a named trigger — see Finding B4. |

Nothing else in the proposal was wrong or outdated. The runbook citations
(:60-68, :124-150) match their sections; the "architecture repair" paragraph
(:124-150) correctly describes what `ensureBuildPacketForPlan` now does.

## Part 2 — Design assessment (severity-ranked)

### Blocker

**B1 — The smallest-implementation slice leaves the configurable model inert.**
The proposal's own premise is that the binding's model args are inert, and its
fix is step 2: "`selectAgentProfileForWorkItem` binding resolution (small code
fix)". That fix is necessary but insufficient. The only coding-agent spawn in
the codebase is `src/execution/runner.ts:424`, fed by
`buildCodingAgentCommand(profile, executionScope, finalMessagePath)` at
`src/execution/runner.ts:369` — called without the fourth `configurationArgs`
parameter (`src/codingAgents/adapters.ts:20-34`). Binding `modelArgs`/
`effortArgs` are recorded in the packet metadata's display command
(`src/codex/packets.ts:81-86`) and then silently dropped at spawn, on *every*
path, including the with-requirement path. The proposal's verification section
("binding selection picks the planning binding…") is exactly the check that
would pass while the feature stays inert — the constitution's "would a mistake
here go unnoticed" test, answered the wrong way.

### Major

**B2 — "Additive, existing artifacts keep passing" contradicts the proposed
failure list.** §3 adds `missing_executor_instruction_block` as a failure.
Unconditional, that re-classifies every legacy planning artifact as failing the
moment it is re-validated (the retry path re-validates: `runner.ts:668-674`,
`planningPromotion.ts:144-162`), contradicting §3's first sentence. The fix
already exists in the same file: gate the new checks on the packet-derived
contract the way `repositoryImpactRequired` is
(`src/stewardship/artifactValidator.ts:114-124`) — required only when the
packet declares the executor-block contract.

**B3 — The block will routinely trip the existing prose claim-detectors.** The
executor block embeds `validation: [pnpm test …]` and `done_when: "pnpm test …
passes"` inside a planning-only artifact whose validator fails
`validation_execution_claim_not_required` on claim-shaped lines
(`artifactValidator.ts:178-185`, patterns at `:431-440`) and
`implementation_claim_in_planning_artifact` on implementation-shaped lines
(`:169-176`, patterns at `:421-429`). Present-tense step text dodges the
current patterns, but that is luck, not design. State the interplay: carve the
fenced block out of the prose detectors, or word the schema to stay clear of
them.

**B4 — The named consumer does not read the build packet.** The proposal cites
`add-opencode-production-provider` as the consumer (:30-32) and §4's fix is to
copy the block into the build packet. But the guarded production path launches
sessions that run `arcadia advance` in the prepared worktree — those sessions
consume the plan document (frontmatter acceptance criteria quoted verbatim per
`docs/managed-documents.md`), not the `codex_invocations` build packet. The
packet copy serves the legacy codex spawn path only. The proposal must name the
delivery channel per consumer and which one is canonical, or "the executor
receives ordered steps" is unproven.

**B5 — `docs/model-selection.md` is mischaracterized.** §1 claims the planning
binding "stays inside the provider-adapter registry that `docs/model-selection.md`
already names as place #1" (:66-67). It does not. That doc names place #1 as
the plan's `recommended_model` field resolved by `arcadia go`
(`docs/model-selection.md:11-17`) and place #2 as the Intelligence LiteLLM
route registry (:41-45). The provider-adapter binding registry is a *third*
model-selection surface the doc's "exactly two places" rule (:8-9) does not
acknowledge. Related: Decision 0010
(`docs/decisions/0010-pin-the-agent-handoff-model.md:47-53`) pins the launch
model at the plan boundary and refuses unstated defaults. The proposal never
states which authority wins for a planning run — the plan's
`recommended_model` or the binding's `modelArgs`. This needs an explicit
precedence rule and a `docs/model-selection.md` amendment in the same change,
not an assertion that the doc already blesses it.

### Minor

**B6 — Availability does not fail closed on the binding path.** True for
`selectAgentProfile` (`src/codex/packets.ts:286-298`). But in
`selectCompliantCodingAgent`, a binding whose profile is absent from the
workspace registry is silently skipped
(`src/codingAgents/providerAdapters.ts:142-144`, and `:237-243` in validation),
and the candidate sort selects the next binding — a stale workspace copy of
`coding-agent-profiles.json` silently downgrades planning to terra rather than
refusing. "The binding must keep that behavior" is unachieved as written.

**B7 — `depends_on` integrity is missing from the five new checks.** The block
schema has `depends_on` (:96-97) but the proposed checks (:108-111) never
verify that referenced step ids exist or that the graph is acyclic. Both are
cheap deterministic checks; an executor following a cyclic or dangling
dependency list is exactly the interpretation this proposal exists to remove.

**B8 — The executor block omits failure semantics.** As specified (:89-100) it
carries goal, impact, ordered steps, and validation commands, but not: the base
revision the steps assume; what the executor does when a step's `done_when`
fails (stop-and-report vs repair; no rollback guidance); per-step status
reporting back to the Run; when to commit. Some of this is launch-context
material, but the proposal should say which, or the opencode executor will
still be interpreting.

**B9 — "Cap attempts with the existing repair-budget pattern" cites machinery
that lives elsewhere** (`src/production/policy.ts:57`, `src/production/tick.ts:194`).
Planning retries are bounded only by per-attempt operator approval
(`src/commands/review.ts:962-1010`). Either port the budget (new code — say so)
or drop the claim; the operator gate already bounds token burn.

**B10 — `gpt-5.6-luna` is pinned without the verification step
`docs/model-selection.md:24-30` demands for every Codex-side string.** Add
"confirm the model string against the current Codex CLI model list" to the
slice's acceptance criteria.

### Nits

- Citation drift: the purpose filter is `providerAdapters.ts:144`, not `:145`.
- "a `costRank` below `codex-terra`" (:53-54) is ambiguous — terra is 1, the
  current minimum, and `costRank` must be a non-negative integer
  (`providerAdapters.ts:234-236`). Say "costRank 0" or "cheaper than terra",
  noting the tie-break order (`providerAdapters.ts:171-176`).
- `config/defaults/coding-agent-profiles.json` workspace copies also need the
  new profile, not just `provider-adapters.json` copies — otherwise silently
  ineligible (see B6).
- The new `planning-templates.json` is a fourth registry beside the existing
  `template-registry.json`; defensible (different lifecycle, few-shot payload),
  but say why it is not an extension of `TemplateRegistry`
  (`src/intent/registries.ts:70-77`).

### Direct answers to the review questions

- **Reuse vs parallel pipeline:** Good. It reuses the provider registry, the
  registry-loader pattern, the deterministic validator, the retry path, and the
  promotion machinery. Nothing here is a parallel pipeline. The one soft spot
  is the new registry file (nit above).
- **Few-shot + deterministic validation: theater?** Not theater, but bounded:
  it constrains *shape*, and the proposal honestly says so (:162-166). What it
  does not catch: wrong-but-well-formed file paths and commands; `done_when`
  that cannot run or that hides an approval-boundary violation; dependency
  cycles (B7); fabricated observability ("tests pass" with no command). The
  acceptance Decision remains the judgment gate, as the proposal states — the
  block bounds damage rather than proving correctness.
- **Planning-only and build approval boundaries:** Preserved. Planning stays
  read-only (the `codex_planning` profile sandbox); the build packet still
  requires its own `CodexBuildPacketApproval`
  (`src/commands/work.ts:1160-1199`); §4's promotion change happens after the
  planning acceptance Decision. The one boundary friction is B3 — a validator
  concern, not an authority leak.
- **Executor-step block sufficiency:** Partially (B8). Ordering exists
  (`depends_on`) but is unchecked; context (base revision, working tree) and
  failure/rollback semantics are absent; `validation` commands are present but
  unowned (who runs them, when).
- **Is the slice the real 80/20?** No — it is missing its own prerequisite
  (B1: the runner spawn-path fix). With that added, the ordering (binding →
  template → validator → promotion) is the right vital few, and the deferral
  list properly names triggers.
- **Conflicts:** with `docs/model-selection.md` as written (B5 — the proposal
  misquotes what that doc names); tension with Decision 0010's plan-boundary
  model authority, unresolved; no conflict with the provider-adapter contract —
  every proposed field passes `validateProviderAdapterRegistry`
  (`providerAdapters.ts:199-262`).

## Part 3 — Verdict

**Revise.** The diagnosis is sound, the reuse story is genuinely good, and the
evidence chain (rehearsal 0/9 → template mismatch → free-Markdown contract) is
real and correctly cited. But the proposal's central promise — a configurable
model that actually reaches a planning run — is not delivered by the
implementation slice it names, and its claims about the governing documents are
wrong.

### Smallest set of changes that would make it acceptable

1. **Add the spawn-path fix to the slice.** Step 2 becomes: binding resolution
   in `selectAgentProfileForWorkItem` *and* threading `configuration.args`
   through `executeCodexStep` (`src/execution/runner.ts:369`). Add a
   verification criterion that the launched command line actually contains the
   model flag — recorded from the spawn, not the packet metadata.
2. **Gate the new block checks on the packet contract** (a `contract.` field
   like `repositoryImpactRequired`), so legacy artifacts keep passing and §3's
   two sentences stop contradicting each other.
3. **State the channel.** One paragraph in §4: the opencode executor consumes
   the plan Action's acceptance criteria (derived from `done_when`); the build
   packet copy serves the legacy codex path. Name which is canonical.
4. **Fix the governance claims.** Amend `docs/model-selection.md` to name the
   provider-binding surface explicitly (or fold it under place #1 with a
   sentence), state the precedence between the plan's `recommended_model`
   (Decision 0010) and the binding's `modelArgs`, and add the Codex
   model-string verification step for `gpt-5.6-luna` to the slice.
5. **Add two cheap checks** to the validator list: unknown `depends_on`
   reference and `depends_on` cycle; and one sentence on whether the fenced
   block is excluded from `validationClaimEvidence`/`implementationClaimEvidence`
   (or reword the example schema to avoid them).

Items 1-4 are required for acceptance; item 5 is strongly recommended and
cheap. Everything else in the proposal can stand as written.
