---
arcadia: v1
type: log
slug: arcadia-mission-log
project: arcadia
updated: 2026-09-18
---

# Mission Log: Arcadia

## 2026-09-05 — Flight Deck board plan activated on operator direction

- **Scope:** Pointer change only; no Action implemented.
- **Did:** The operator chose the Flight Deck / Mission Control plan as the
  next `active_plan` directly (not inferred). `PROJECT.md` now points at
  `flight-deck-board-carries-the-whole-portfolio-on-one-surface` with
  `current_action: project-plan-lanes-and-pipeline-columns` — the plan's only
  Action with no unmet dependency. The plan document's `status` moves
  `draft` -> `active`, and `milestone` in `PROJECT.md` updates to match.
  Flipping it to active surfaced a real, separate defect: the plan was
  missing the `recommended_model` field the plan schema requires, which
  fails silently while a plan is `draft` (never dispatched, so never
  validated) but breaks parsing entirely once active — added
  `recommended_model: claude-sonnet-5`, matching every other plan.
- **Result:** `resolveDispatch` now resolves `project-plan-lanes-and-
  pipeline-columns` cleanly with zero blockers;
  `tests/managed-documents-contract.test.ts` passes. `agent-ask-execution-
  queue` keeps its own `current_action: dogfood-agent-managed-queue`
  untouched and un-competing, since `PROJECT.md` declaring its own
  `current_action` is what silences the "competing pointer" check for every
  other plan.
- **Next:** `flight-deck-board#project-plan-lanes-and-pipeline-columns` —
  render every governed object as one swimlane board (Plan lanes, dispatch-
  gate columns). Not started in this session; the operator asked only for
  activation.
- **Blockers:** None.

## 2026-09-05 — Way propagation delivers, and `way-delivery` reaches its milestone

- **Action:** `way-delivery#open-way-sync-pull-requests`
- **Did:** Built `arcadia way propagate`, delivering the two tiers Decision
  0024 defines: `src/projects/wayPropagation.ts` diffs an adopting
  repository's AGENTS.md region and CLAUDE.md wrapper (mechanical) and its
  CONSTITUTION.md and continuation protocol (governing) against Arcadia's
  canonical text, reusing the same pure generators `setup-context` writes
  with. `src/projects/wayPropagate.ts` orchestrates one pull request per
  repository through an injectable command runner — refusing a dirty working
  tree, a repository with no GitHub remote, or one whose
  `.arcadia/arcadia-way/adoption.json` declares `upgrade_policy:
  "explicit-only"` — and merges immediately only when a run touched the
  mechanical tier alone; a governing-tier change, alone or alongside a
  mechanical one, always leaves the pull request open. Wired as `arcadia way
  propagate [project-id] [--dry-run]`.
- **Result:** All five acceptance criteria covered by 12 new tests in
  `tests/way-propagation.test.ts`, including full orchestration against a
  real local Git repository and a local bare "origin" with `gh` faked
  through the injected runner. `tsc --noEmit` clean; full suite 1,212 passed,
  8 skipped, the same pre-existing worktree environment gaps untouched by
  this change. This was the last `open` Action in `way-delivery`, so the
  plan is marked `complete` and its milestone — every adopting project can
  receive Way changes and ask for Way capabilities without anyone writing
  Arcadia twice — is reached. `way-delivery` no longer designates a
  `current_action` (its `checked-in Arcadia control documents` contract test
  requires every active plan to resolve one, so leaving the pointer on a
  complete plan with none is a real defect, not a stylistic gap — CI caught
  it). `PROJECT.md`'s `active_plan` moves to `agent-ask-execution-queue`,
  which was already `status: active` with its own `current_action:
  dogfood-agent-managed-queue` declared — a competing pointer `resolveDispatch`
  already refused to allow alongside an active `way-delivery`. That Action is
  `blocked` behind open Decision 0041 and resolves as the operator question
  it already was, which is the sanctioned outcome here: the choice of the
  *next milestone* (`flight-deck-board-carries-the-whole-portfolio-on-one-
  surface`, still `draft`, is the evident candidate behind Arcadia's own
  recorded milestone) is a materially different decision than this session
  was dispatched to make, so it falls to the operator rather than being
  picked unilaterally to satisfy CI.
- **Next:** Operator answers Decision 0041 (reactivates
  `agent-ask-execution-queue`'s dogfood tail), or explicitly activates
  `flight-deck-board-carries-the-whole-portfolio-on-one-surface` instead.
- **Blockers:** None. Real propagation was implemented and tested against
  local fixtures only; it was not run against any real adopting repository
  in this session (that would push branches and, for a mechanical-only
  change, merge them without further review), pending the operator wanting
  a live run.

## 2026-09-05 — Decisions can carry options with consequences

- **Action:** `way-delivery#carry-decision-options`
- **Did:** Added an ordered `options` list to the Decision document type
  (`src/docs/types.ts`, `src/docs/parse.ts`), each entry a `label`, a
  `consequence`, and at most one `recommended: true`. `arcadia decision new`
  and Agent Ask's `decision` intent (`src/ask/agentAsk.ts`,
  `src/ask/settlement.ts`) both accept the same shape and render it as an
  "## Options" section ahead of "## Context", so an operator can pick a
  choice without reading the rationale first. `arcadia decision approve`
  now requires the `answer` to name one of the declared labels when options
  exist (case-insensitive match, recorded verbatim), and is unchanged for a
  Decision with none. `agent-ask contract` reports the new `options`
  envelope field and its per-option shape.
- **Result:** All five acceptance criteria covered by new tests in
  `tests/decision-command.test.ts`, `tests/agent-ask.test.ts`,
  `tests/agent-ask-settlement.test.ts`, and `tests/agent-ask-contract.test.ts`.
  Full suite: 1195 passed (up from 1186), the same 4 pre-existing failures
  unrelated to this change (missing `discord.js`/dashboard build artifacts
  in this environment). Marked the Action `done` and repointed
  `current_action` (in both `PROJECT.md` and the plan) to
  `stop-dumping-rationale-into-recommendation`, the next `agent`-
  responsibility Action with no unmet dependencies — `open-way-sync-pull-
  requests` sits earlier in the plan but is `requires_review`, not
  agent-dispatchable.
- **Next:** `way-delivery#stop-dumping-rationale-into-recommendation`, now
  the current Action.
- **Blockers:** None.

## 2026-09-05 — Closed out the codex→agent responsibility rename and repaired the stale pointer

- **Action:** `way-delivery#rename-codex-responsibility-to-agent`
- **Did:** Dispatch handed this Action to a fresh agent worktree, but every
  acceptance criterion was already satisfied by earlier work: `feat(domain):
  rename codex responsibility value to agent` (PR #164) and the follow-up
  fix cycle for the regression it caused (PR #165) had already landed
  `WORK_CLASSIFICATIONS`/`WORK_CLASSIFICATION_LABELS` using `agent`, the
  `responsibility: codex` → `agent` legacy-read normalization in
  `src/docs/parse.ts`, every plan document already rewritten to
  `responsibility: agent`, and test coverage for both the new literal value
  and the legacy spelling (`tests/docs-sync.test.ts`). What was missing was
  the record: both settle commits for that earlier work (`rename-codex-
  responsibility-log-2026-09-04`, `log-codex-responsibility-migration-fix-
  2026-09-05`) were Log-only Agent Asks, so this Action's `status` in
  `docs/plans/way-delivery.md` was never flipped to `done`, and `PROJECT.md`
  and the plan's `current_action` both still pointed at it — a stale pointer
  that would have kept re-dispatching finished work.
- **Result:** Verified every acceptance criterion directly (constants, parse.ts
  compatibility path, a repo-wide grep for `responsibility: codex` in
  `docs/plans/`, and the targeted test files), then marked the Action `done`
  and repointed `current_action` (in both `PROJECT.md` and the plan) to
  `carry-decision-options`, the next `agent`-responsibility Action with no
  unmet dependencies. `arcadia advance --json` now resolves cleanly with no
  blockers.
- **Next:** `way-delivery#carry-decision-options`, now the current Action.
- **Blockers:** None. Worth naming so it does not recur: an Agent Ask's
  `log` intent can settle without ever touching the Action it was about,
  so a session finishing real work under one request id should also confirm
  the plan document's own `status` and `current_action` fields moved, not
  just that a Log entry was written.

## 2026-09-02 — Gave Arcadia's own deferrals something that reads them

- **Action:** `way-delivery#evaluate-document-triggers`
- **Did:** Added `arcadia triggers`, a read-only noun reporting every deferral a
  repository declares and what each is doing now: `fired`, `waiting`,
  `unevaluable`, or `untriggered`. Machine-checkable conditions come from
  `.arcadia/triggers.json`, promoting the registry shape Private Practice Now
  proved, with `count` conditions read from repository-local JSON and `observed`
  conditions a person records. Prose deferrals are reported rather than
  evaluated, in every spelling the documents actually use — `**Trigger:**`,
  `*Trigger:`, `revives when`, and the `Reactivate when` tables that turned out
  to be the dominant form.
- **Result:** Arcadia's own repository reports **39 deferrals across 14
  documents** where nothing could previously list one, plus one deferred
  Decision that names no reviving condition at all. Run against Private
  Practice Now it evaluates its registry and reports **2 fired and 8 waiting**,
  with counts checked against real data — five sites, all `review`, zero
  `live`, so `0 of 5 match; 3 needed` is correct. Eleven focused tests cover
  both condition kinds, malformed and future-schema registries, an unsupported
  kind, a count file escaping the repository, all four prose spellings,
  frontmatter restatement, prose *about* triggers, and proof the command writes
  nothing. Full suite passes 1,197 with 6 skipped.
- **Next:** `way-delivery#accept-upstream-proposals`, now the current Action.
- **Blockers:** None. Two findings worth recording: Decision 0028 claimed
  Decisions 0021 through 0027 carried `**Trigger:**` clauses, and they no longer
  do — their deferrals are `Reactivate when` tables instead, which is why a
  reader built to 0028's description alone would have found nothing. And the
  first parser written here silently dropped a mid-line clause, the exact
  failure this Action exists to end; it was caught only by counting the results
  against a manual grep.

## 2026-09-02 — Made the Agent Ask contract reach every adopting project

- **Action:** `way-delivery#propagate-agent-ask-contract`
- **Did:** Added an "Asking Arcadia to change Project state" section to
  `docs/agents-context.md`, the region propagated into every adopting
  AGENTS.md: the command an agent runs from its own repository without knowing
  Arcadia's workspace path, the rule that a proposal is never self-approving, a
  table of all ten intents with what each changes and whether it opens a
  Decision, and three worked examples covering the distinct envelope shapes.
  Added `arcadia agent-ask contract`, a read-only noun that prints the live
  schema from the parser's own constants so an agent can confirm rather than
  trust a possibly stale copy. Exported the constants it derives from.
- **Result:** `project setup-context --all` wrote the section into all five
  adopting repositories, verified by reading each AGENTS.md from disk rather
  than by trusting exit status; Private Practice Now carries all ten intents
  and all three examples where it previously had zero mentions of Agent Ask.
  `arcadia way` reports 5 current, 0 stale. The contract command runs from
  Private Practice Now's checkout with no workspace, Project, or database. A
  focused test asserts its intent list equals AGENT_ASK_INTENTS and its field
  lists equal STRICT_FIELDS and STRICT_ACTION_FIELDS, so prose and parser
  cannot drift. Full suite passes 1,179 with 6 skipped.
- **Next:** Implement `arcadia triggers`, the current Action under the pointer.
- **Blockers:** None for this Action. Two findings recorded but not fixed:
  `.arcadia/repo-context.md` rewrites a `Generated:` timestamp on every run, so
  `setup-context` always dirties the tree and then blocks `agent-ask settle
  --apply`, which refuses on a dirty repository; and the local `arcadia` shim
  prints banner lines before `--json` output, which would break an agent
  piping it.

## 2026-09-01 — Dogfooded Agent Ask and the queue, then activated way-delivery

- **Action:** `agent-ask-execution-queue#dogfood-agent-managed-queue`
- **Did:** Ran the Ask-to-queue path on real work rather than fixtures. A
  natural-language reprioritization request was submitted through
  `agent-ask preview`, correctly refused to guess, and opened Decision 0042;
  the operator's answer ratified it. A strict `plan` envelope targeting the
  active Plan then created two Actions with zero required Decisions and zero
  conflicts, and two applied `advance queue reorder` moves exercised
  preview/apply, optimistic revisions, and undo receipts. Decision 0043 then
  moved the pointer to `way-delivery` at `evaluate-document-triggers`, which
  `arcadia next` and `arcadia docket` both resolve with full authorization.
- **Result:** Queue order does not grant dispatch authority: two Arcadia
  Actions sat at positions 0 and 1 reported as `waiting_for_pointer` while
  Arcadia selected a pointer-authorized Action beneath them and explained the
  skip. Four newly activated Actions with no explicit positions set
  `orderValid` false and the next Action to `None` rather than inferring
  priority from document order; one explicit placement restored revision 11.
  Three real defects surfaced. Natural-language Ask punts to a generic
  interpretation Decision even when the repository names the plan, Action, and
  Decision — now a governed Action. Decision 0042 duplicated Decision 0041's
  question with nothing to catch it — now a governed Action, with 0042 against
  0041 as its named regression fixture. Agent Ask derives Action ids by
  slugifying the whole `desired_result`, producing 70-plus character ids, one
  truncated mid-word at `-alrea`; those ids are the handle for every reorder
  and `depends_on`, so it is filed separately. Focused tests pass 31/31.
- **Next:** Implement `arcadia triggers` under the new pointer.
- **Blockers:** Phone-width browser QA and independent PR QA for
  `dogfood-agent-managed-queue` have not run, so that Action stays open with
  its question unanswered. Writing this entry broke
  `managed-documents-contract` by naming two Actions and omitting `Result`,
  which is itself evidence that the contract is enforced only by the full
  suite and never at authoring time.

## 2026-09-01 — Made Plans writable and reprioritizable through Agent Ask

- **Action:** `agent-ask-execution-queue#enable-coding-agents-to-naturally-create-amend-and-reprioritize-plan-shaped-work`
- **Did:** Extended strict Agent Ask v1 so one `plan` envelope can carry shared
  and per-Action references, create a complete inactive draft Plan, or target a
  named Plan to create and amend Actions. Active-Plan settlement can now move
  every unfinished Plan Action at one approved top/before/after boundary while
  deriving a stable dependency-safe segment. It refuses incomplete Actions,
  dependency cycles, cross-Project targets, stale revisions, unpositioned
  queues, and any attempt to queue a draft. Updated the canonical operator
  guide and CLI help.
- **Result:** Focused tests pass 23/23, the corrected full suite passes 1,170
  with 6 skipped, core and Discord TypeScript builds pass, and the live services were
  restarted from the committed feature branch. Real Plan Ask
  `agent-plan-priority-dogfood-20260901` amended the current Action and moved
  the two unfinished Arcadia Plan Actions as one queue segment at the top.
  Settlement `asksettle_1c38b693b26b492999` recorded the exact Plan and queue
  effects, resulting next Action, and operator-accep

## 2026-09-16 — Completed arcadia/refresh-preservation-heartbeat-off-tick

- **Did:** Completed Action arcadia/refresh-preservation-heartbeat-off-tick from accepted evidence (Candidate 9a8a0261a51e4a654e23d546a6db73a03ba01241).
- **Result:** Every declared acceptance criterion was accepted as met: "The 5s worker loop re-stamps the existing preservation heartbeat projection (schema arcadia-preservation-transport-v1) with an updated at timestamp and unchanged routes while a tick is in progress, so a concurrent arcadia go-broker status reports both transports READY continuously across a multi-minute runManagedProductionIteration."; "A deterministic test covers heartbeat freshness during a simulated long tick, and the existing go-request transport tests still pass.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-refresh-preservation-heartbeat-off-tick-2026-09-16-v2).

## 2026-09-16 — Completed arcadia/stop-writing-base-advances-to-mission-log

- **Did:** Completed Action arcadia/stop-writing-base-advances-to-mission-log from accepted evidence (Candidate 654cf42a09ff822e9e051d8e15380e4b31f69819).
- **Result:** Every declared acceptance criterion was accepted as met: "detectBaseBranchAdvance no longer appends a '— Base branch advanced' section to MISSION_LOG.md and no longer creates a 'chore(arcadia): record base branch advance' commit; the managed_production.base_branch_advanced event row and the production_base_branch_observations dedup row remain the durable record."; "Base advances stay visible without the Mission Log: a read-only surface (arcadia production status or the existing activity report) shows recent base-advance events with their previous and new SHA, and the existing worker log line is preserved."; "The accumulated '— Base branch advanced' sections are removed from MISSION_LOG.md once, and arcadia docs sync ingests the file cleanly afterward with no duplicate-heading validation error."; "Deterministic tests prove one advance writes exactly one events row, zero MISSION_LOG sections, and zero commits; that the visibility surface reports the previous and new SHA; and that docs sync accepts the trimmed log."; "Existing codex and claude behaviour, every other Mission Log writer, and the tick's other observations are unchanged; the full test suite and the core, Discord, and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-stop-writing-base-advances-to-mission-log-2026-09-16).

## 2026-09-17 — Completed arcadia/add-opencode-production-provider

- **Did:** Completed Action arcadia/add-opencode-production-provider from accepted evidence (Candidate c3c386ce7cec17ce851b8edcc3f7b47d087e9078).
- **Result:** Every declared acceptance criterion was accepted as met: "An opencode build coding-agent profile and an opencode-cli provider binding are registered in the workspace config, and provider selection picks them without hardcoding a new opencode name outside the existing provider registry."; "The guarded launch path launches opencode non-interactively in the prepared worktree: SessionAgent/SESSION_PROVIDER, buildSessionLaunch, the prepareAgentWorktree agent union plus its opencode worktree root, buildAgentLaunchCommand, the provider-to-agent map, and LAUNCH_ADAPTER_SUPPORT each handle opencode, reusing the existing Session, lease, packet, and promotion guards unchanged."; "A standing production policy scoped to --provider opencode-cli launches an opencode Session that runs arcadia advance with no per-launch operator click, and a concurrent launch against the same candidate is still refused with the existing lease conflict."; "opencode admission uses only the existing bounded operator capacity attestation (arcadia production capacity attest), labeled attended and never standing proof; no new capacity source, credit purchase, or paid fallback is introduced."; "Existing codex and claude selection, launch, refusal, and reconciliation behavior is unchanged, with deterministic tests covering opencode selection, launch-command construction, worktree root, and refusal cases; the full test suite and the core, Discord, and Dashboard builds pass."; "docs/model-selection.md, START_HERE.md, docs/COMMANDS.md, and the AGENTS.md Codex-only sentence are updated wherever their claims change; the legacy review-approve executor, an opencode planning profile, and go-broker sandbox config stay deferred against a named trigger.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-add-opencode-production-provider-2026-09-17).

## 2026-09-17 — Completed arcadia/resolve-agent-handoff-model-per-provider

- **Did:** Completed Action arcadia/resolve-agent-handoff-model-per-provider from accepted evidence (Candidate 0bd7527292db726d55b2679d45b06eb5fcfd9c0e).
- **Result:** Every declared acceptance criterion was accepted as met: "One tier registry (bundled defaults plus a workspace override) maps light/standard/heavy to a concrete model per coding agent, and no vendor model is hardcoded outside it: codex gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol; claude haiku, sonnet, opus; opencode opencode-go/glm-5.3-flash, opencode-go/deepseek-v4.1-flash, opencode-go/gpt-5.6-luna."; "arcadia go --agent <agent> resolves a plan recommended_model that names a known tier to that agent's tier model; a plan that names a concrete model uses it as-is only when it is plausible for the chosen agent, and otherwise resolves that agent's standard-tier model. The protected broker path succeeds with no operator-supplied --model."; "Reasoning effort resolves independently of the tier (--effort, else recommended_reasoning_effort, else the tier's own default), and opencode's --variant mapping from the resolved effort is preserved."; "Deterministic tests cover tier resolution for all three agents, concrete-model pass-through when plausible, the concrete-model fallback that fixes GitHub Issue #282 (claude-sonnet-5 handed to opencode resolving to the opencode standard model), and a legible refusal for an unknown tier or an agent with no mapping; existing codex and claude behavior for plausible concrete models is unchanged."; "docs/model-selection.md documents the three tiers, the per-agent table, and the rule that new plans declare a tier while existing concrete-model plans keep working through the fallback; docs/COMMANDS.md states the resolution order; the Action closes Issue #282 when it merges and introduces no new approval, capacity, or paid-fallback authority."; "pnpm test and the core, Discord, and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-resolve-agent-handoff-model-per-provider-merged-2026-09-17).

## 2026-09-17 — Completed arcadia/fix-agent-go-transport-readiness

- **Did:** Completed Action arcadia/fix-agent-go-transport-readiness from accepted evidence (Candidate 050bfa9ec789c8b7f4b2afd40882eff31dcd51ed).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia go-broker status reports the agent go transport NOT READY unless a worker able to service a go request is registered, so a merely fresh heartbeat from a worker whose tick is stuck in managed production can no longer satisfy it."; "A go request timeout or refusal removes the pending .arcadia-go-request marker, matching the contract #272 set for the preserve path, so an immediate retry succeeds without removing the file by hand."; "Deterministic tests cover readiness false while the worker cannot service a request, marker cleanup on timeout and on refusal, and a successful request still returning its host response; the existing preservation transport and managed-production tick behavior is unchanged."; "arcadia advance queue make-next --apply commits the pointer transition it writes (PROJECT.md and the active plan), on whatever branch it ran from and never pushing, so the governed pointer is durable and the next clean-tree-gated command is not blocked by the pointer move."; "Deterministic tests prove make-next commits exactly the pointer files and leaves no dirty tree, and that a settlement immediately after a pointer move succeeds with no manual commit."; "START_HERE.md and docs/COMMANDS.md state that a fresh heartbeat alone is not sufficient for the go transport, name the recovery for a stranded request marker, and state that a pointer move is committed by the command."; "pnpm test and the core, Discord, and Dashboard builds pass; no new approval, capacity, or paid-fallback authority is introduced.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-agent-go-transport-readiness-2026-09-17).

## 2026-09-17 — Completed arcadia/harden-agent-ask-settlement

- **Did:** Completed Action arcadia/harden-agent-ask-settlement from accepted evidence (Candidate 2b1ab152e4f47c70bfd04ad7a34e2ffa147d372b).
- **Result:** Every declared acceptance criterion was accepted as met: "A derived Decision or Plan slug from an over-long question is always valid kebab-case: slugify truncates at the 80-character cap without leaving a leading or trailing separator, and a unit test proves an over-long desired_result or question yields a slug the Decision writer accepts (fixes Issue #269)."; "agent-ask settle --apply either completes every step (managed-document writes, review-item creation, local commit) or fails cleanly with a clearly reported recoverable state; any post-write side effect (Discord notification, operational sync, database lock) is bounded by a deadline and never gates the local commit (fixes Issue #270)."; "A regression test settles with the notification/sync path stalled and asserts the command returns and the change is committed; the intermittent hang cannot reoccur without a test failure."; "Existing settlement behavior for the successful path, and existing codex and claude behavior, are unchanged; pnpm test and the core, Discord, and Dashboard builds pass."; "The Action closes GitHub Issues #269 and #270 when it merges.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-harden-agent-ask-settlement-2026-09-17).

## 2026-09-17 — Completed arcadia/deliver-session-brief

- **Did:** Completed Action arcadia/deliver-session-brief from accepted evidence (Candidate 0177e565d61063c0488147ba983ae17dda2d770d).
- **Result:** Every declared acceptance criterion was accepted as met: "The managed launch delivers the Action brief to the spawned agent for every configured provider: the Action title and next_action, every acceptance criterion verbatim and in the plan's own order, the candidate worktree path, and the standing constraints (no merge, deploy, publish, push to shared branches, or pointer edits)."; "The brief states the exact completion protocol: run the repository's declared validation, request protected preservation through the existing fixed launcher, and settle a `complete` Agent Ask with candidate_revision equal to the worktree HEAD and one `met` evidence entry per criterion, verbatim and in order."; "The brief is derived from the authoritative plan document for the Session's recorded plan_slug and action_id rather than a hardcoded or stale copy; a missing Action or missing acceptance criteria fails closed with a named error before launch."; "Deterministic tests cover the rendered brief for an Action carrying criteria and the fail-closed case for a missing Action, and existing provider argument construction (model, effort/variant, worktree cwd, agent Git identity) is unchanged."; "pnpm test and the core, Discord and Dashboard builds pass; no new approval, capacity or paid-fallback authority is introduced."; "The Blocker recorded at docs/reports/planning-agent-route-review-2.md:427-437 is resolved and the PR closes GitHub Issue #292 when it merges.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-deliver-session-brief-2026-09-17).

## 2026-09-18 — Completed arcadia/let-agent-preserve-its-candidate

- **Did:** Completed Action arcadia/let-agent-preserve-its-candidate from accepted evidence (Candidate 88a1dfe2881cc27ddd8e210f62f85e707bb1e1ae).
- **Result:** Every declared acceptance criterion was accepted as met: "Reuse the existing protected host controller, registered prepared worktree, Session lease and candidate-preservation machinery. Permit the minimal protected request transport needed for the intended sandbox to reach the existing host-side preservation operation; this is not a second controller or a general host command-execution service. Do not introduce another pointer writer, allow raw Git mutation, make shared Git metadata writable to the agent, or weaken the sandbox."; "Validate only the declared objective checks required for preservation, sourced from the existing host-managed Project metadata validation_commands and frozen into the immutable authorized Action packet. Verify their definitions against that packet and its authorizing receipt; the request cannot select or replace checks. Use a host-owned validation runner as the trusted result producer: it runs those checks with candidate code sandboxed, observes their actual process outcomes and captures evidence in host-protected storage. An agent-writable evidence file, caller-supplied passed=true, or agent completion assertion is not trusted evidence. Passing a check proves only that check passed; do not build a general acceptance evaluator or require subjective acceptance criteria to become executable."; "Bind results to the exact candidate snapshot actually tested, repository/worktree/branch/base, Project and Action, immutable packet hash, check definitions and applicable authority including policy revision/epoch. Require that the validated candidate snapshot and the committed tree are identical. Cover mutation during validation as well as mutation between validation and preservation; hashing only the content found after testing is insufficient. Use the smallest sound existing snapshot or content-binding mechanism without requiring a new snapshot framework. Refuse absent, failed, skipped, stale or caller-fabricated evidence and changed bindings, preserve candidate files on refusal, and prove that altered content cannot inherit a passing receipt."; "Make the protected preservation request agent-callable for Codex and Claude through the existing launcher setup, Codex rule and Claude allowlist. From the intended Codex sandbox, prove the actual request reaches the protected host and creates one candidate commit on a disposable objective-criteria fixture, with no direct shared-Git write by the agent or ad hoc approval escalation; allowlist presence and unsandboxed direct invocation alone are insufficient proof."; "Update the arcadia-go skill to request protected preservation after required validation, while continuing to forbid direct mutable advance and git commit. Make go-broker status report named preservation readiness and fail closed when the launcher or required protected request path is unavailable."; "Preservation records a recoverable candidate and trusted validation only; it does not accept the Action, integrate or merge it, mark it done, or advance its pointer. Subjective acceptance and required independent review remain separate gates. Remote preservation requires its existing explicit authority; unauthorized or unreachable remote preservation remains honestly LOCAL ONLY with an exact recovery action."; "Reuse the existing request-id and recovery receipts; prove retries and a lost response yield one preserved commit without cross-worktree mutation or duplicate preservation."; "Preserve passing targeted tests and a reproducible protected-boundary fixture Artifact recording exact host/runtime revision, profile, writable roots, authoritative check definitions, trusted producer, check results, tested snapshot and committed-tree identities, Action, packet, authority, request/receipt, commit and every denial, approval or operator intervention. Include fixtures for content mutation during validation and between validation and preservation, showing altered content cannot inherit passing evidence. Include exact runnable operator QA steps and the end-user procedure in the PR; distinguish fixture proof from live production acceptance.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-let-agent-preserve-its-candidate-2026-09-17).

## 2026-09-18 — Completed arcadia/fix-tick-database-open-error-boundary

- **Did:** Completed Action arcadia/fix-tick-database-open-error-boundary from accepted evidence (Candidate b0c6e6ae48d41d5fdc1728b1a8df3237123baee3).
- **Result:** Every declared acceptance criterion was accepted as met: "openDatabase in tick() (src/commands/worker.ts:118) runs inside the same error boundary as runWorkerIteration, so a throw is logged as Worker tick error: and setTimeout(tick, POLL_INTERVAL_MS) still reschedules."; "No uncaught synchronous throw in the tick path can end the loop without a log line: either the moved try covers it or a process-level uncaughtException handler logs and reschedules."; "A deterministic test forces openDatabase to throw SQLITE_BUSY and asserts the process does not exit, the failure is logged, and a subsequent tick still runs."; "Existing worker tests pass unchanged, and the happy path issues no additional log output.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-tick-database-open-error-boundary-2026-09-18).

## 2026-09-18 — Completed arcadia/stop-keepalive-worker-crash-loop

- **Did:** Completed Action arcadia/stop-keepalive-worker-crash-loop from accepted evidence (Candidate e35885c86d453ec9eece59dbe039458dca99e2f7).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia worker install no longer produces an agent that crash-loops on the benign already-running path: worker start exits 0 there, or the generated plist uses KeepAlive with SuccessfulExit false, and a test asserts the generated plist shape."; "After a fresh install with a second worker already running for the same workspace, .arcadia/worker.log gains no repeated already-running lines over a sustained interval."; "The launch-agent audit (src/runtime/launchAgents.ts) reports when two installed agents resolve to the same workspace, and its remedy names the correct command rather than a reinstalling one."; "Deterministic tests cover the already-running exit path and the duplicate-workspace audit; existing runtime-pinning tests pass.".
- **Next:** Advanced to the next eligible Action in document order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-stop-keepalive-worker-crash-loop-2026-09-18).

## 2026-09-18 — Agent Ask github-production-scheduling-mvp-2026-09-17

- **Did:** Record that the GitHub Projects production scheduling MVP was built from the operator brief: per-Project tiered queues (interrupt > blocker > corrective > planned) over the existing portfolio queue, a scheduling pass in the production tick that moves the governed pointer to the canonical next Action, GitHub Projects projection with operator card reordering read back and normalized, coding-Run discovery of blockers/correctives/follow-ups with circuit breakers, a failed-Run budget per Milestone, and a scheduling Log. See docs/production-scheduling.md.
- **Result:** The brief arrived directly from the operator outside the governed pointer; this Log entry records the delivered work so the operator can decide whether it becomes a governed Plan.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-18 — Agent Ask log-decision-deferral-slice-2026-09-18

- **Did:** Record the delivered slice of apply-answered-decision-consequences (PR #314): arcadia decision approve applies a defer effect by parking the Action and advancing the pointer to the next eligible Action in the explicit queue, and dispatch plus Agent Ask completion resolution honor the explicit queue and an approved deferral (Issue #310). Criterion 3 (a single durable receipt and a reversal path) remains open on the Action.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-18 — Completed arcadia/fix-decision-deferral-review-bugs

- **Did:** Completed Action arcadia/fix-decision-deferral-review-bugs from accepted evidence (Candidate 928fc741df90be89b1f97b163809150c42f55728).
- **Result:** Every declared acceptance criterion was accepted as met: "decision approve --dry-run never commits, even when an unapplied receipt exists (#315), with a test."; "A defer effect is applied only when the recorded status is approved (#316), with a test."; "Re-approving a previously applied deferral after revival writes and commits the new deferral (#317), with a test.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-decision-deferral-review-bugs-2026-09-18).
