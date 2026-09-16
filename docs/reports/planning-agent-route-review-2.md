# Planning agent route with structural templates — independent review 2

Proposal: `docs/proposals/planning-agent-route-with-structural-templates.md`
Reviewer scope: independent verification of every factual claim against the code,
design assessment, verdict. This review's only write is this file.

## Note on the prior review

`docs/reports/planning-agent-route-review.md` did not exist when this
review's findings were formed — absent from the working tree and from all git
history at first check — so Sections 1-4 below were produced with no knowledge
of it. It was subsequently re-persisted (its frontmatter notes the original
write "failed to persist") and was read only after Section 4 was complete.
Section 5 compares the two: where each finding agrees, where this review
disputes the prior one with evidence, and what each found that the other
missed. Severity rankings below are this review's own, assigned before the
comparison.

## 1. Factual verification of the proposal

| # | Claim (proposal line) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `provider-adapters.json` maps `agentProfiles: ["codex_planning", "codex_build"]` to the same bindings | Correct | `config/defaults/provider-adapters.json:24` (codex-terra), `:43` (codex-sol) both list both profiles |
| 2 | `selectAgentProfileForWorkItem` returns `configuration: null` when the Action has no `execution_requirement_json` | Correct, imprecise scope | `src/codex/packets.ts:224-235` — the null path also fires when `adapters` is absent, and the function spans `216-265` |
| 3 | The binding's model args "are therefore never applied on that path" (`adapters.ts:21-31`) | **Understated — see Blocker 1** | `src/codingAgents/adapters.ts:20-34` merges `configurationArgs`, but the only planning spawn path never passes them (`src/execution/runner.ts:369-371`) |
| 4 | Planning artifact contract is heading greps, scored `100 - failures*12 - warnings*4` | Correct | `src/stewardship/artifactValidator.ts:60-207`, score at `:197` |
| 5 | Live rehearsal scored 0/9 (runbook `:60-68`) | Correct | `docs/reports/prove-two-action-unattended-production-runbook.md:66-67` ("the validator correctly refuses it (scored 0/9 in the live run)"; 9 failures ⇒ `max(0, 100-108) = 0`) |
| 6 | No few-shot mechanism in the prompt path; `renderPrompt` is prose-only | Correct | `rg -i "few.?shot"` matches only this proposal; `src/codex/packets.ts:303-422` renders prose sections only |
| 7 | `selectCompliantCodingAgent` filters on purpose so a planning-only binding is never selected for build | Correct, citation drift | `src/codingAgents/providerAdapters.ts:144` (proposal cites `:145`); profile-purpose mismatch skips the binding at `:142-149` |
| 8 | Model stays installation-configurable via workspace registry (`registries.ts:70-107`) | Correct | `src/intent/registries.ts:70-77` (`loadPhase3Registries`), `:103-107` (`registryPath` prefers the workspace copy) |
| 9 | Keyword routing exists in `skills.ts:140-179` | Correct | `src/execution/skills.ts:157-178` (`raw.includes("implement")…` routing) |
| 10 | Retry path exists (`runner.ts:676-727`, `review.ts:962-1010`) | Correct | `createPlanningValidationReviewItem` (runner `:676-727`, `resolved_intent: codex_planning_artifact_validation` at `:714`) → `CodexPlanningRetryApproval` creation (`src/commands/review.ts:977-998`) |
| 11 | `ensureBuildPacketForPlan` (`work.ts:1120-1202`) and promotion lift `smallestFollowUpGoal` into one build Action | Correct | `src/commands/work.ts:1120-1202`; `src/projects/planningPromotion.ts:250-259` (lift), `:264-268` (acceptance derived from fields), `:334-448` (persist + build packet) |
| 12 | "Cap attempts with the existing repair-budget pattern" | Loosely supported | `src/workflows/config.ts:143` (`retry.maxAttempts`), `src/workflows/runner.ts:94-99`; `repair_budget_exhausted` in `src/production/tick.ts:55,194` |
| 13 | The consumer "is now an opencode executor (Action `add-opencode-production-provider`)" | Imprecise | The Action exists and is **open** (`docs/plans/bootstrap-managed-production-to-build-flight-deck.md:790-799`); no opencode provider exists in `config/defaults/provider-adapters.json` (codex-cli, claude-code-cli, gemini-cli only). The consumer *will be*, not *is* |
| 14 | "the provider-adapter registry that `docs/model-selection.md` already names as place #1" | **False — see Major 3** | `docs/model-selection.md:11` names place #1 as the plan's `recommended_model`/`recommended_reasoning_effort` handoff; the registry appears nowhere in that document |
| 15 | "Selection already fails closed on availability (`packets.ts:286-298`)" | Imprecise | `src/codex/packets.ts:286-298` first **falls back** to any other available same-purpose profile (`:292-296`) and only throws when none exists. `selectCompliantCodingAgent` does fail closed (`providerAdapters.ts:180-196`) but only on the execution-requirement path — see Minor 7 |
| 16 | New binding shape (`capability: c2_integrated`, costRank below terra, effortArgs) is registry-valid | Correct | `validateProviderAdapterRegistry` accepts it: costRank non-negative integer (`providerAdapters.ts:234-236`), non-empty modelArgs (`:231-233`), profile/provider match (`:244-249`); terra is costRank 1, so 0 wins planning ties via the sort at `:171-176` |

No claim was found fabricated. Two are materially wrong (#3 as scoped, #14),
three are imprecise (#2, #13, #15), one citation is off by one line (#7).

## 2. Findings, severity-ranked

### Blocker 1 — Binding modelArgs/effortArgs never reach any real planning spawn; the proposal's fix list omits the actual prerequisite

The proposal's stated defect ("the binding's model args are therefore never
applied on that path") is true but scoped to the wrong path. There are exactly
two `buildCodingAgentCommand` call sites:

- **Packet display command** — `src/codex/packets.ts:81-86` passes
  `input.agentConfiguration?.args`, so the displayed/stored command includes
  `--model gpt-5.6-terra` etc. It is recorded in `codex_invocations.command`
  (`src/commands/work.ts:1263`) and in the packet's `metadata.json`
  `providerSelection` (`packets.ts:138-147`). Display and record only.
- **Real spawn** — `executeCodexStep` recomputes the command as
  `buildCodingAgentCommand(profile, executionScope, finalMessagePath)`
  (`src/execution/runner.ts:369`) **with no configurationArgs** (the parameter
  defaults to `[]`, `adapters.ts:24`), then `spawnSync`s it (`runner.ts:424`).
  The profile is re-derived by name/purpose alone in `selectExecutionProfile`
  (`runner.ts:796-811`) — no adapter binding is consulted.

So on the only path that executes planning runs (`work run` →
`executeCodexStep`), the spawned coding-agent process launches with the CLI's
default model **whether or not the Action has an execution requirement**. The
stored command and metadata claim a model the process never received — a truth
defect under CONSTITUTION.md's "Completion is a proven state, not a claim."

The guarded-launch path does apply model/effort — `buildSessionLaunch` emits
`codex --model <model> --config model_reasoning_effort=…`
(`src/sessions/index.ts:522-528`, model from `preview.selection`,
`launch.ts:174-176`) — but it only launches **build** packets
(`src/sessions/packetLifecycle.ts:18-20` filters `purpose === "build"`), so it
cannot carry a planning model either.

Consequence for the proposal: its fix #2 ("Fix `selectAgentProfileForWorkItem`
… Without this the configurable model is inert") repairs selection only. With
it, the packet's *display* command gains Luna's args and the metadata records
Luna — and the spawned process still runs the codex default model. The feature
is inert end-to-end unless `runner.ts:369` also threads the recorded
providerSelection args (or uses `invocation.command`), which the proposal never
mentions; its only `runner.ts` citation (`:676-727`) is for the retry path.

### Blocker 2 — The executor-step block is delivered to a document the executor session never reads

Proposal §4 copies the parsed block "verbatim into the build packet." But a
guarded-launched executor session is launched in tmux with the prompt
`arcadia advance --session <id>` (`src/sessions/index.ts:522-527`), and
`advance` with a session id prints only session metadata — id, status,
`project/plan#action`, packet id + sha256, worktree path
(`src/commands/advance.ts:30-34`, `:50-61`). The build packet's `prompt.md`
**text is never delivered to the executor**; only its hash is bound as
authority (`src/sessions/launch.ts:285-287`). The executor agent then works
inside the candidate worktree, whose authoritative surfaces are the governed
documents — `PROJECT.md` → the plan's current Action
(`AGENTS.md` pointer chain; `docs/managed-documents.md:80-90`).

What does reach the executor today is the promoted Action's plan fields:
`next_action`, `acceptance_criteria`, `references` — and promotion already
sets `references` to include the **planning artifact path**
(`planningPromotion.ts:271`). So the proposal's "derive the executing Action's
acceptance criteria from each step's `done_when`" half works (criteria land in
the plan and reach the executor), but "copy the block verbatim into the build
packet" delivers ordered steps, files, and `depends_on` to a file whose sha is
checked and whose content is never consumed. The "canonical handoff" lands on
the wrong surface. It should live where the executor reads: the planning
artifact (already referenced), the plan Action body, or the session brief
surfaced by `advance`.

(The legacy `--allow-codex-build` path does feed `prompt.md` as stdin
(`runner.ts:426`, `input: prompt`) — but the runbook itself classifies that as
a separate legacy single-shot mechanism, "not evidence of the guarded-launch
path" (`prove-two-action-unattended-production-runbook.md:72-80`), and it is
exactly the path the production architecture is moving away from.)

### Major 3 — Misquote of `docs/model-selection.md`, and a third model-selection surface with no doc reconciliation

The proposal asserts the provider-adapter registry "stays inside … the
provider-adapter registry that `docs/model-selection.md` already names as
place #1." That document's place #1 is the **plan `recommended_model` handoff
via `arcadia go`** (`docs/model-selection.md:11-30`); place #2 is Intelligence
routes. The registry is not mentioned at all, and the doc states "There are
exactly two places a model gets chosen. Nothing else should invent a third"
(`:8-9`) — which the registry, as it exists in code today, already
contradicts. The proposal both misattributes the doc's authority to the
registry and deepens the undocumented third surface without proposing the doc
update that would make its own claim true. Additionally:

- `docs/model-selection.md:24-30` requires verifying a Codex-side model string
  against the Codex CLI's current model list before pinning it; the proposal
  pins `gpt-5.6-luna` as a default without stating verification.
- The repo's own active plan records the Codex provider as credit-exhausted —
  the reason `add-opencode-production-provider` exists
  (`bootstrap-managed-production-to-build-flight-deck.md:791`,
  "credit-exhausted Codex and Claude providers"). A default planning route
  pinned to codex-cli may be unlaunchable in this installation as things
  stand; the proposal neither addresses this nor names a trigger for
  re-pointing the default.

Decision 0010 is not directly violated (it governs the `arcadia go` handoff, a
different mechanism), but its principle — a handoff never silently launches on
an unstated model — is exactly what Blocker 1 currently breaks for the
`work run` path, and the proposal should say so rather than claiming the
config surface already governs it.

### Major 4 — `missing_executor_instruction_block` as an unconditional failure contradicts "existing artifacts keep passing"

Proposal §3 promises the validator upgrade is "additively so existing
artifacts keep passing," then lists `missing_executor_instruction_block` among
the new failures. Every legacy planning artifact lacks the block, so an
unconditional check fails them all — the exact "validator churn could reject
legitimate artifacts" risk the proposal's own Risks section names. The
validator already has the right pattern for this: contract flags derived from
the packet, like `validationExecutionRequired`
(`artifactValidator.ts:291-292`). The check must be gated on a packet-derived
"output contract demanded the block" flag; the proposal does not say so, and
§3 is internally inconsistent until it does.

### Major 5 — The block collides with the existing claim detectors

The validator's legacy detectors scan the whole artifact text, and the block's
natural content sits on their edges:

- `implementationClaimEvidence` (`artifactValidator.ts:421-428`) fires on
  `\b(?:implemented|added|modified|updated|created|removed|deleted)\s+(?:src\/|tests?\/|…)` —
  a step or `done_when` phrased "created src/foo.ts" or "updated tests/…"
  triggers `implementation_claim_in_planning_artifact`.
- `validationClaimEvidence` (`:435-439`) fires on
  `\b(?:tests?|lint|validation|checks?)\s+(?:passed|completed|succeeded|ran|were run)\b` —
  a `done_when` like "tests passed" triggers
  `validation_execution_claim_not_required`, because planning packets
  (correctly) don't require validation execution.

A tier-two model writing completion-state prose inside `done_when` — the exact
behavior few-shot examples invite — will hit these. The proposal says "keep
the existing prose checks" but never reconciles them with the block: either
exempt the fenced block from the claim scans or define safe phrasing in the
template's `done_when` grammar. Unhandled, this produces spurious failures on
legitimate artifacts (compounding Major 4) or, worse, teaches template authors
to phrase around the detectors.

### Major 6 — The five new checks omit dependency integrity

The proposal's failure codes cover presence, shape, verb, files, and
`done_when` — none cover `depends_on` integrity: dangling step references,
cycles, or step order that contradicts the dependency edges. For a handoff
whose entire point is "ordered steps an executor can follow without
interpretation," an unparseable order is as bad as a missing verb. One check
(`executor_step_dependency_invalid`: every `depends_on` id resolves, the graph
is acyclic) is cheap, deterministic, and missing.

### Minor 7 — "Fails closed on availability" describes the wrong function's behavior

`packets.ts:286-298` (the no-requirement path the proposal is changing) does
not fail closed — it silently substitutes another available same-purpose
profile and only throws when none exists. In the proposal's own risk scenario
(a workspace pointing `defaults.planning` at an unavailable model), the
configured planning model would be silently replaced, not refused. If the
planning route must keep fail-closed semantics, the proposal has to say what
replaces this fallback; citing the range as evidence of fail-closed behavior
is wrong.

### Minor 8 — Verification criteria can pass while the feature is inert

Two of the three "How this is verified" criteria are unit-shaped: "binding
selection picks the planning binding for `purpose: planning` and never for
build" and "promotion copies the block verbatim." Both pass under Blockers 1
and 2 — selection is correct while the spawn ignores it; the copy succeeds
while the executor never reads the destination. The one end-to-end criterion
("one real planning run … executed by the opencode executor, with the
transcript preserved") would catch both only if it required comparing (a) the
model recorded in metadata against the model actually observed in the run, and
(b) the document the executor session demonstrably consumed. Neither is
specified, so the strongest criterion can also pass vacuously (a transcript of
a default-model run executing criteria derived from a block it found via
references would look like success).

### Minor 9 — Single-example few-shot anchors content, not just structure

With one worked example rendered verbatim, the classic tier-two failure is
copying the exemplar's *content* ("Create src/foo.ts exporting createFoo()",
"pnpm test tests/foo.test.ts") into an unrelated task. Every proposed check
passes — the shape is perfect, the files and commands are wrong or
nonexistent. Nothing verifies block content relates to the Action (e.g.,
`repo_impact` paths intersecting the packet's repository-impact section, or
`files` existing in the target repository — the planning run is read-only and
*can* verify path existence deterministically). This is the main sense in
which "few-shot + deterministic validation constrains a tier-two model" is
only shape-deep.

### Nit 10 — Small factual/citation repairs

- `providerAdapters.ts:145` → the purpose filter is `:144`.
- "The consumer … is now an opencode executor" — the action is open and the
  provider does not exist yet (finding #13 above); say "will be."
- §2 proposes six templates (five task kinds + default) while the deferral
  trigger for a few-shot authoring tool is "more than three templates" — the
  full scope fires its own deferral trigger on day one.
- `selectAgentProfileForWorkItem` spans `packets.ts:216-265`; the null path is
  `:224-235` (the proposal's citation) but the function header it also cites
  in prose starts at `:216`.

## 3. Design assessment

**Reuse vs. parallel pipeline (YAGNI).** Genuinely good. Routing goes through
the existing provider-adapter registry, templates through the existing
registry-loader pattern (`registries.ts:70-107`), the contract into the
existing deterministic validator, repair through the existing
validation→retry path (`runner.ts:676-727`, `review.ts:962-1010`), and
promotion through the existing lift (`planningPromotion.ts:250-272`). No
second pipeline, no second schema store, no smuggled profile args. The
explicit "What we would build locally" section is the proposal honestly
declining the local reimplementation trap. This is the proposal's strongest
section.

**Does few-shot + deterministic validation actually constrain a tier-two
model?** Partially, and the proposal is honest about the residual ("The block
validator proves shape, not correctness"). Shape-checking is real value: it
guarantees a machine-parsable handoff, which is a genuine improvement over
free Markdown. But the claim that "deterministic feedback plus few-shot is
what closes the gap for a tier-two model" (§5) is unsupported, and the
unclosed failure modes are nameable: exemplar content leakage (Minor 9),
nonexistent file paths, dangling/cyclic `depends_on` (Major 6), observable-but-
wrong `done_when` (a test that doesn't exist or passes vacuously), semantic
mis-ordering behind a well-formed graph, and detector collisions (Major 5).
That is not theater — a parseable contract is strictly better than prose —
but it is shape-constraint sold partly as correctness-constraint.

**Planning-only and build approval boundaries.** Preserved. The planning
packet stays planning-only (`renderPrompt`'s planning-only gate
`packets.ts:397`, `:590`; validator `packet_not_planning_only` at
`artifactValidator.ts:70-77`), build still requires its own
`CodexBuildPacketApproval` (`work.ts:1183`) or the guarded launch's authority
checks, and the proposal's verification section states the boundary holds.
The one live risk is Major 5: the block's implementation-flavored language
sitting inside a planning artifact that legacy detectors scan for
implementation claims.

**Is the executor-step block sufficient for an opencode executor to act
without interpretation?** No, as specified. Present: goal, repo impact, steps
with id/action/files/depends_on/done_when, validation list. Missing: (a) how
the executor receives it at all (Blocker 2 — the delivery surface is wrong);
(b) context pointers — which repository/worktree/base revision, and where the
full planning artifact lives; (c) ordering guarantee — is list order
authoritative, or only `depends_on`?; (d) dependency integrity enforcement
(Major 6); (e) failure semantics — what the executor does when a `done_when`
fails mid-sequence (halt? skip? retry within the session? report and stop?),
and whether partial work is rolled back or preserved per Decision 0051's
split-session continuation; (f) who runs `validation` — the executor agent
itself, a deterministic Arcadia step, or the review gate, and when. An
executor handed the block as written still has to interpret all six.

**Is the smallest-implementation slice the real 80/20?** The ordering is
right but the slice omits its own prerequisite. Steps 1–2 (binding + selection
fix) are inert without threading args through `runner.ts:369` (Blocker 1);
step 5 (promotion copies the block) is inert as an executor handoff because of
Blocker 2. Criteria that pass while the feature remains inert are identified
in Minor 8. The 80/20 for "a configurable model reaches planning runs" is
actually: binding + profile + selection fix + **spawn arg threading** — four
items, and the fourth is the one the proposal never names. The template and
validator work (steps 3–4) is genuine 80/20 for the *handoff* half, once
gated per Major 4.

**Conflicts with `docs/model-selection.md`, Decision 0010, and the
provider-adapter validation contract.** Model-selection: Major 3 (misquote,
"exactly two places" tension, unverified model string, credit-exhausted
default provider). Decision 0010: no direct conflict — different mechanism —
but Blocker 1 is a live violation of its principle on the `work run` path.
Adapter validation contract: none — the proposed binding is valid under
`validateProviderAdapterRegistry` (finding #16), and because it is
planning-only it does not disturb `launchPreview`'s build-selection staleness
check (`launchPreview.ts:166-176`, which compares only requirement-bearing
build selections).

## 4. Verdict

**Revise.** The direction is sound and the reuse discipline is real: a
planning-only binding inside the existing registry, structural templates
inside the existing loader, a machine-checked block inside the existing
validator, and promotion inside the existing lift are all the right shapes.
But the proposal's two load-bearing claims — "the configurable model reaches
planning runs" and "the block becomes the canonical handoff" — are each false
as specified, for reasons verifiable in the code today (Blockers 1 and 2),
and its supporting citation of `docs/model-selection.md` is wrong (Major 3).

### Smallest set of changes that would make the proposal acceptable

1. **Add spawn-arg threading to the slice** (Blocker 1): `executeCodexStep`
   must pass the packet's recorded providerSelection args — or use
   `invocation.command` — at `runner.ts:369`, and the end-to-end verification
   criterion must compare the model recorded in metadata against the model
   actually observed in the run transcript. State plainly that today the
   stored command claims a model the spawn does not use.
2. **Retarget the handoff surface** (Blocker 2): keep the canonical block in
   the planning artifact (already referenced by the promoted Action's
   `references`, `planningPromotion.ts:271`), derive acceptance criteria from
   `done_when` into the plan Action (already proposed), and specify how the
   launched executor session reaches the block — plan Action body, references,
   or the `advance` session brief — verified against what the session actually
   consumes, not the build packet's prompt.md.
3. **Gate the block checks on a packet-derived contract flag** (Major 4), the
   way `validationExecutionRequired` is derived (`artifactValidator.ts:291-292`),
   so legacy artifacts keep passing; say so explicitly in §3.
4. **Add `executor_step_dependency_invalid`** (dangling `depends_on` refs,
   cycles) and **reconcile the block with the claim detectors** (Major 5) —
   exempt the fenced block from the implementation/validation claim scans or
   define a `done_when` grammar that cannot collide with them.
5. **Fix the model-selection story** (Major 3): correct the "place #1"
   misquote; either update `docs/model-selection.md` in the same change to
   name the provider-adapter registry as a model-selection surface or
   reframe the claim; state that `gpt-5.6-luna` was verified against the
   Codex CLI model list per that doc's standing rule; and address the
   credit-exhausted codex-cli default (name the provider this installation
   can actually launch, or the trigger that re-points the default).
6. **Correct the availability claim** (Minor 7): describe the actual
   fallback-then-throw behavior at `packets.ts:286-298` and state which
   behavior the planning binding must keep, plus the small factual repairs in
   Nit 10.

## 5. Comparison with the prior review

`docs/reports/planning-agent-route-review.md` was absent when this review's
findings were formed and first written (its frontmatter says it was
"re-created after the original write of this file failed to persist"). It was
read only after, and every point below was re-verified against the code before
being accepted or rebutted.

### Agreement

The two reviews converged independently on the load-bearing findings, which
raises confidence they are real:

- **Spawn-path inertness** (their B1 = my Blocker 1): `runner.ts:369` drops
  `configurationArgs` on every path; selection-only fixes leave the model
  inert. Both verified the same call sites.
- **Additive contradiction** (their B2 = my Major 4): unconditional
  `missing_executor_instruction_block` fails every legacy artifact; gate on a
  packet-derived contract flag like `repositoryImpactRequired`
  (`artifactValidator.ts:114-124`). Their version adds a citation I lacked:
  the retry and promotion paths **re-validate**, so the contradiction is not
  hypothetical — `planningPromotion.ts:153` re-runs `validatePlanningArtifact`
  on acceptance, and the validation sidecar path does too. Accepted and
  incorporated above.
- **Claim-detector collision** (their B3 = my Major 5).
- **Delivery-channel gap** (their B4 = my Blocker 2).
- **`docs/model-selection.md` misquote** (their B5 = my Major 3).
- **`depends_on` integrity missing** (their B7 = my Major 6).
- **`gpt-5.6-luna` pinned without the verification step** (their B10 = my
  Major 3, third bullet). Their supporting detail checks out and strengthens
  the point from the other direction: the string appears in the repo only in
  `docs/plans/decision-queue-reconciliation.md:10` and this proposal — so a
  second document now depends on a string nobody has verified against the
  Codex CLI list.
- **Citation drift `:145` → `:144`** (their nit = my Nit 10).
- **Verdict: revise**, with the same shape of repair list.

### Where the prior review adds something I accept

- **Decision 0010 precedence (their B5, second half).** I said "no direct
  conflict" because D0010 governs the `arcadia go` handoff, a different
  mechanism. Their question is sharper and I adopt it: when a plan pins
  `recommended_model` (D0010's governed authority) *and* a binding pins
  `modelArgs` for the same planning work, which wins? The proposal is silent,
  and Blocker 1 makes the answer load-bearing once the spawn actually uses
  the binding. This belongs in the required-changes list.
- **Availability on the binding path (their B6).** Complementary to my
  Minor 7, not duplicative: I flagged that the *cited* path
  (`packets.ts:286-298`) silently falls back to another same-purpose profile
  before throwing; they flagged that `selectCompliantCodingAgent` silently
  skips a binding whose profile is absent from a stale workspace registry copy
  (`providerAdapters.ts:142-144`, permitted by the validation comment at
  `:237-243`). Both are real; a complete proposal must answer both.
- **Workspace copies of `coding-agent-profiles.json` need the new profile**
  (their nit) — a concrete deployment detail I missed; without it the
  planning binding is silently ineligible everywhere a workspace copy
  exists.
- **The opencode action's deferral (their #15 note).** `add-opencode-production-
  provider`'s criteria explicitly defer "an opencode planning profile …
  against a named trigger" (`bootstrap-…-flight-deck.md:806`). Relevant
  context: it means the proposal's codex-side planning route does not collide
  with that action's scope — and it makes my credit-exhaustion point below
  sharper, since opencode is being added precisely because codex credits are
  exhausted.

### Disagreement, with evidence

- **Severity of the delivery-channel finding.** They rank it Major (B4); I
  rank it Blocker. §4 is the proposal's central promise ("the block becomes
  the canonical handoff"), and the mechanism evidence —
  `buildSessionLaunch` prompts `arcadia advance --session <id>`
  (`sessions/index.ts:522-527`), `advance` prints session metadata only
  (`advance.ts:50-61`), the packet is bound by sha256 not content
  (`launch.ts:285-287`), and guarded launch admits build packets only
  (`packetLifecycle.ts:18-20`) — shows the canonical handoff lands on a
  surface no consumer reads. A proposal whose headline handoff is undelivered
  is not fixable by "one paragraph" alone; it is a rewrite of §4's mechanism.
  I keep Blocker.
- **Their verdict #12 ("Correct for that path") on the fails-closed claim.**
  The cited range itself does not fail closed: `packets.ts:292-296` falls
  back to any other available same-purpose profile before throwing. The
  proposal's risk mitigation ("the binding must keep that behavior") is
  therefore answered against the wrong behavior on its own cited path. Their
  B6 covers a different path and does not repair #12.
- **Their verdict #15 ("Correct") on "the consumer is now an opencode
  executor."** Half right, and I concede the half I missed: the action is
  the plan's `current_action` (`bootstrap-…-flight-deck.md:812`), so "now" is
  more defensible than my "will be" allowed. But no opencode provider exists
  in `config/defaults/provider-adapters.json`, so the consumer the block is
  built for does not exist yet; marking the claim flatly "Correct" hides the
  dependency. Both reviews' caveats are needed for the full picture.
- **Their B9's "A repair budget exists only in the production loop."**
  Overstated: `src/workflows/config.ts:143` (`retry.maxAttempts`) is also a
  budget pattern, and the proposal's phrase is loose enough to cover either.
  Their substantive point survives — the *planning retry* path has no budget,
  each attempt gated by fresh operator approval (`review.ts:977-998`) — and
  on that I agree with them over my original "loosely supported."
- **Citation wobble in their B2:** "the retry path re-validates:
  `runner.ts:668-674`" — that range is
  `writePlanningValidationSidecar`/`createPlanningValidationArtifact`
  plumbing; the re-validation is `validatePlanningArtifact` at
  `runner.ts:608-611` (and `planningPromotion.ts:153`). Substance correct,
  citation drifted.

### What the prior review missed (findings above not present in it)

1. **The credit-exhausted default provider** (Major 3, third bullet): the
   repo's own active plan adds opencode because Codex credits are exhausted
   (`bootstrap-…-flight-deck.md:791`), yet the proposal pins the default
   planning route to codex-cli — the route may be unlaunchable in this
   installation, with no trigger named for re-pointing.
2. **The untruthful-record dimension of Blocker 1** (CONSTITUTION "Completion
   is a proven state"): `codex_invocations.command` and the packet's
   `metadata.json` `providerSelection` record a model the spawned process
   never receives today. Their B1 treats this as inertness; it is also a
   record asserting something false.
3. **Exemplar content leakage** (Minor 9): the single-worked-example anchoring
   failure mode — the tier-two model copying the example's *content*
   ("Create src/foo.ts exporting createFoo()") into an unrelated task, which
   passes every proposed shape check. Their "wrong-but-well-formed file
   paths" names the symptom without the mechanism or a mitigation (path
   existence is deterministically checkable — the planning run is read-only).
4. **The vacuity of the promotion-copy criterion** (Minor 8, second half):
   their B1 covers the binding-selection criterion; the "promotion copies the
   block verbatim" criterion can equally pass while the copy lands where no
   executor reads it.
5. **The template-count self-trigger** (Nit 10): six proposed templates
   already fire the proposal's own "more than three templates" deferral
   trigger for a few-shot authoring tool.
6. **Mechanism evidence for the delivery-channel finding** — their B4 asserts
   the channel gap without the launch-path citations that prove it
   (`sessions/index.ts:522-527`, `advance.ts:50-61`, `launch.ts:285-287`,
   `packetLifecycle.ts:18-20`); those citations are what justify blocker
   rather than major severity.

### Net assessment of the pair

Both reviews, formed independently, reach the same verdict (revise), the same
two structural defects (spawn-path inertness, wrong delivery surface), and
the same top repair items. The union of the two repair lists is: spawn-arg
threading with spawn-recorded evidence (both); delivery channel named and
verified per consumer (both, mine with mechanism); contract-gated block
checks (both); model-selection.md amendment **plus a D0010 precedence rule**
(theirs, adopted); model-string verification (both); depends_on integrity +
detector carve-out (both); and the additions unique to this review — the
credit-exhausted default provider, the untruthful metadata record, exemplar
leakage mitigation, and workspace-copy deployment of the new profile (theirs,
adopted).
