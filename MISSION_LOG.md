---
arcadia: v1
type: log
slug: arcadia-mission-log
project: arcadia
updated: 2026-09-23
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

## 2026-09-18 — Completed arcadia/preserve-projects-with-dependencies

- **Did:** Completed Action arcadia/preserve-projects-with-dependencies from accepted evidence (Candidate 24dc7aeb09ffe98a3218b9e7a2f0239ba435e3e5).
- **Result:** Every declared acceptance criterion was accepted as met: "A Project whose declared objective validation check needs installed dependencies can complete protected preservation, or Arcadia's own Project declares a genuine self-contained objective check that runs inside the existing sandbox; the chosen mechanism and its security boundary are documented, and no check that cannot run is left configured as if it could."; "The existing preservation invariants hold or any reviewed exception is narrower and bounded and named: no network, no source writes, regular files only, at most 64 MiB, temporary output only in the private scratch/TMPDIR."; "advance, go, and go-broker status report this as a named, actionable remedy instead of only validation_commands_missing when a declared check requires dependencies the sandbox refuses."; "Deterministic tests cover the chosen validation path including pass, fail, and refusal, and prove a check that cannot run reports refusal rather than readiness; existing codex and claude launch, refusal, and reconciliation behavior is unchanged; pnpm test and the core, Discord, and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-preserve-projects-with-dependencies-2026-09-18).

## 2026-09-19 — Completed arcadia/fix-plan-mode-planning-artifact

- **Did:** Completed Action arcadia/fix-plan-mode-planning-artifact from accepted evidence (Candidate 7916fa9919078d41e5016aa01e5b40857bb70e43).
- **Result:** Every declared acceptance criterion was accepted as met: "A plan-mode planning Run whose plan is written by Claude passes codex_planning_artifact_validation."; "A test reproduces the plan-in-plan-file, summary-in-final.md case and fails before the fix.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-plan-mode-planning-artifact-2026-09-19).

## 2026-09-19 — Completed arcadia/clean-up-preserve-transport-request

- **Did:** Completed Action arcadia/clean-up-preserve-transport-request from accepted evidence (Candidate f207a497810b2b9af1d7ec44cce678ba077a0912).
- **Result:** Every declared acceptance criterion was accepted as met: "requestCandidatePreservation removes its own .arcadia-preserve-request file on success, refusal, and timeout, exactly as requestAgentGo does in its finally block; it removes only its own nonce and never another caller's or a tracked file (fixes Issue #272)."; "Deterministic tests prove a refused or timed-out preservation request leaves the candidate worktree clean and cannot trip an arcadia go cleanliness check, while a successful request still returns its host response."; "Existing preservation transport and managed-production tick behavior is unchanged; pnpm test and the core, Discord, and Dashboard builds pass."; "The Action closes GitHub Issue #272 when it merges.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-clean-up-preserve-transport-request-2026-09-19).

## 2026-09-19 — Completed arcadia/fix-accepted-plan-to-build-packet-path

- **Did:** Completed Action arcadia/fix-accepted-plan-to-build-packet-path from accepted evidence (Candidate a68932efc965883a48b6a98b9f5393f5314f4382).
- **Result:** Every declared acceptance criterion was accepted as met: "A test shows an accepted validated planning Artifact for a plan-document Action yields a build packet and build approval through one supported command or automatically."; "session preview-launch reports Ready for that Action once the build approval exists, with a test covering it.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-arcadia-fix-accepted-plan-to-build-packet-path-12694df73ac8).

## 2026-09-20 — Completed arcadia/recover-protected-go-base-divergence

- **Did:** Completed Action arcadia/recover-protected-go-base-divergence from accepted evidence (Candidate eb8d296029c913c2f42bf19e56d7ac186ac3c933).
- **Result:** Every declared acceptance criterion was accepted as met: "When the local base is ahead and behind its configured remote, protected Arcadia Go either completes a host-controlled reconciliation with an auditable receipt or refuses with a generated bounded operator script; it never directs a coding agent to manually rebase or merge."; "A deterministic regression test covers the divergent-base case and proves no prepared worktree is issued before the supported reconciliation outcome is known."; "A live host probe after the repair returns a valid prepared or resumed worktree receipt through the protected Go request path.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-recover-protected-go-base-divergence-2026-09-19).

## 2026-09-20 — Completed arcadia/restore-preservation-worker-heartbeat

- **Did:** Completed Action arcadia/restore-preservation-worker-heartbeat from accepted evidence (Candidate 6d7593434e746847410d13843a790c7d31ee4d60).
- **Result:** Every declared acceptance criterion was accepted as met: "After `restart-services.sh restart` reports the worker running, `arcadia go-broker status --json` reports `preservationTransport.ready: true` and a usable Go transport state for the configured workspace."; "A deterministic regression test proves the worker publishes a preservation heartbeat after startup and that a missing or stale heartbeat fails with a diagnostic that identifies the worker route.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-restore-preservation-worker-heartbeat-2026-09-20).

## 2026-09-20 — Completed arcadia/gate-prepared-dispatch-on-transport-readiness

- **Did:** Completed Action arcadia/gate-prepared-dispatch-on-transport-readiness from accepted evidence (Candidate 36cb9b5c43bc97591624525e0073aeb72792f65c).
- **Result:** Every declared acceptance criterion was accepted as met: "A deterministic pre-dispatch check refuses preparation with an actionable remedy when the workspace database cannot be opened by the selected agent profile."; "A deterministic pre-dispatch check refuses preparation when either Go-capable or preservation transport lacks a fresh heartbeat, before a coding agent is started.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-gate-prepared-dispatch-2026-09-20).

## 2026-09-20 — Completed arcadia/fix-packet-lifecycle-latest-planning-decision

- **Did:** Completed Action arcadia/fix-packet-lifecycle-latest-planning-decision from accepted evidence (Candidate 5d288e6a46060b3d5ebed94f01a2b591ecdf2d06).
- **Result:** Every declared acceptance criterion was accepted as met: "A test with an old finished planning Decision and a newer accepted one shows the lifecycle remedy names the newer Decision, and it fails before the fix.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-packet-lifecycle-latest-planning-decision-2026-09-20).

## 2026-09-20 — Completed arcadia/approval-must-apply-or-refuse

- **Did:** Completed Action arcadia/approval-must-apply-or-refuse from accepted evidence (Candidate cf9bdf6cbea2d082a1f982c899aa6f0b3788cea9).
- **Result:** Every declared acceptance criterion was accepted as met: "Approving a review item writes the resulting state to the authoritative checked-in document, or refuses; the workspace database and that document never disagree about whether a Decision is answered."; "An approval whose effect cannot be applied is refused with a reason naming what is missing, and the item remains in the attention queue rather than leaving it."; "A `project_update` Ask whose `target_ref` names a field with no apply path is refused at preview time, rather than opening a clarification Decision that approval cannot act on."; "A regression test reproduces R183: approve a project-field clarification and assert either the field moved and the document was updated, or the approval was refused and the item is still queued."; "Preserve the proof Artifact: the regression test plus a before/after of the database and document state; include the exact runnable target and operator QA steps in the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-approval-must-apply-or-refuse-2026-09-20-v2).

## 2026-09-20 — Completed arcadia/verify-worker-recovery-before-success

- **Did:** Completed Action arcadia/verify-worker-recovery-before-success from accepted evidence (Candidate f013f0ddba92cdd29b9b15764695381a421f17c8).
- **Result:** Every declared acceptance criterion was accepted as met: "A failed launchd load or bootstrap makes worker recovery return a nonzero actionable refusal instead of reporting that the worker started."; "After a successful managed restart, worker recovery verifies a fresh preservation heartbeat and a fresh Go-capable heartbeat before reporting ready."; "A regression test covers a stale worker state and a launchd startup failure without relying on a live macOS service.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-verify-worker-recovery-before-success-2026-09-20-v3).

## 2026-09-21 — Completed arcadia/translate-reasoning-effort-at-launch

- **Did:** Completed Action arcadia/translate-reasoning-effort-at-launch from accepted evidence (Candidate afecc0d30ea090f1ebc5ccfb7733d6b853001804).
- **Result:** Every declared acceptance criterion was accepted as met: "buildProviderLaunch translates the stored abstract ReasoningEffort key (e1_brief/e2_standard/e3_deep/e4_rigorous) to the provider's native value for codex-cli (low/medium/high/xhigh) and for claude-cli (its own accepted set) at the spawn boundary; the abstract key remains the stored and bound value, and opencode's existing --variant mapping is preserved (fixes Issue #280)."; "The codex mapping reuses or deliberately mirrors prReview.ts's codexReasoningEffort rather than drifting from it."; "A launch-argument regression test covers a packet whose selection was recomputed from an Action's execution requirement (the e-key path), not only the packet-verbatim path with native effort strings."; "Existing launch behavior for the packet-verbatim path, and existing codex, claude, and opencode behavior, is unchanged; pnpm test and the core, Discord, and Dashboard builds pass."; "The Action closes GitHub Issue #280 when it merges.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-translate-reasoning-effort-at-launch-2026-09-20).

## 2026-09-21 — Agent Ask log-zero-prompt-rehearsal-switched-to-opencode-2026-09-21

- **Did:** Record that the prove-zero-prompt-production-loop rehearsal was switched to the OpenCode provider on operator direction, and that a /runs preflight now verifies its preconditions.
- **Result:** The guard this log exists for is a hazard, not a completion. On 2026-09-21 the operator ran the new preflight operator action and then directed that the rehearsal use OpenCode rather than the Codex profile. Two settled Agent Asks amended the Action's own text so the proof would not have to misdescribe its run: criterion 1 (55dafafb) now reads 'the same OpenCode provider profile', and criterion 3 (beda56d8) now names the revision-pinned arcadia-go-broker-opencode host controller. The runbook followed in PR #456 (d0782fe3): Steps 2 and 3 grant --provider opencode-cli and launch with 'opencode run', the ledger records the packet's resolved binding instead of a bundled default, and the stale 'State verified 2026-09-11' table is replaced by a live-read section, because it had claimed an active fixture Project (paused), an Inactive policy at revision 0 (Active at revision 8 / epoch 7, scoped to arcadia), and a broker pinned at f2a377e. Its Step 2 now states plainly that activation replaces scope, so following it moves live production authority off Arcadia's own bootstrap Plan and onto the fixture. The rehearsal still cannot start, and this entry does not claim it did: OpenCode capacity is manual_receipt_expired and needs an operator attestation; the fixture Project is paused with no governed reactivation writer (Issue #298); the policy must be rescoped deliberately; and the broker needs repinning, which the preflight performs once the rest is green. Three defects were captured rather than repaired here: #453 (Arcadia Go still dispatches this operator-run proof to a coding agent because the managed documents cannot express an operator-run Action), #454 (the runbook staleness, closed by PR #456), and #455 (nine documents silently omitted from docs sync for declaring the unrecognized type 'evidence'). The operator preflight itself, artifacts/generated/operator-scripts/preflight-zero-prompt-rehearsal-2026-09-21.sh, is host-local and gitignored by design.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-21 — Agent Ask log-zero-prompt-rehearsal-preflight-proven-2026-09-21

- **Did:** Record that the zero-prompt rehearsal's preconditions were completed and the chain proven READY end to end on the real host without launching a model, and that the counted run itself remains the operator's.
- **Result:** This entry records a proof and a repair, not a completion: the rehearsal did not run, no coding-agent process was started, and prove-zero-prompt-production-loop is still open. Two things were repaired. First, the fixture repository was sitting on arcadia/pause-zero-prompt-rehearsal-20260917T231722Z, an Arcadia operations branch, so protected Go refused its root outright ('Arcadia go only removes clearly agent-owned task branches', src/commands/go.ts:218). The branch was proven to be a whole-branch no-op against main before it was deleted, main was pushed, and the launcher's read-only preview then accepted the root with sourceBranch main, baseBranch main, integration not-needed, commitsToIntegrate 0 and the dispatch action resolving to write-rehearsal-marker. Second, the /runs operator action preflight-zero-prompt-rehearsal-2026-09-21 was corrected: it now reads the database status rather than only PROJECT.md, prints the correct non-displacing policy remedy, prints ADMISSION EXPIRES, and describes the integration grant as the candidate-worktree invocation rather than one run from the Project root. With the operator's re-attested opencode-cli reading (7d window, 10 percent used, from the opencode.ai dashboard) the preflight reached RESULT: READY, exit 0, and repinned the protected broker to main HEAD af55a3c9. The chain was then proven without a model call: arcadia next --project zero-prompt-rehearsal reports the Action dispatchable, arcadia session preview-launch resolves write-rehearsal-marker, buildAgentLaunchCommand produces the exact opencode run line, the opencode binary answers 1.15.4, the worktree root is writable, and the worker heartbeat registers the fixture repository as a go route. One property was proven by observation rather than inference: admission rests on an observation under 15 minutes old, so the same attestation that produced READY at 06:21:06Z produced capacity_stale at 06:26:55Z. That makes capacity the one precondition that expires on its own, and the operator must attest last and start inside the window. The runbook's premises were fixed in PR #461, which closes #458: Step 2.5 can now be satisfied (the candidate branch is only knowable from Step 3, and the integrating invocation must run from that worktree), and Step 1 asserts the fixture is on its governed base branch rather than merely clean. Three defects were filed rather than repaired in passing: #458 (closed by #461), #459 (go's refusal message names an allowedPrefixes list that omits opencode/, which SAFE_TASK_BRANCH accepts), and #460 (the fixture's Actions have no build packet, so the guarded session-launch path reports planning_required; the manual path this runbook uses is unaffected, but prove-two-action-unattended-production will need it). What remains is the counted run itself, which belongs in the operator's own terminal: an agent driving it would be the hidden intervention criterion 6 forbids.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-21 — Agent Ask log-decision-0063-answer-2026-09-21

- **Did:** Record the operator's answer to Decision 0063, including the restrictions that qualify it and the deferral of mid-session failover, and point at where each part now lives canonically.
- **Result:** The operator answered Decision 0063 as Option 1 with a hard-evidence restriction. The canonical sentence, in the operator's own words: 'Arcadia may substitute an equivalent-or-stronger permitted coding provider before packet binding when hard evidence shows the intended provider cannot presently execute the work; the substitution and reason must be recorded and surfaced. Advisory capacity evidence alone does not cause substitution, and Arcadia must not automatically switch providers after execution has begun.' Hard evidence is a closed set rather than prose: provider unavailable; model unavailable; authentication failure; explicit quota or rate-limit rejection; or another deterministic, launch-precluding condition. Advisory capacity estimates are excluded, because using them here 'would just rebuild the capacity gate indirectly, on the same shaky data the operator already ruled out as a gating input'. The boundary that stays fixed: provider identity is mutable scheduling state until packet binding and execution history after it, so a mid-session failure still terminates or suspends under the existing recovery rules with no automatic cross-provider retry; if no equivalent eligible provider exists, incapacity surfaces normally and the capability floor is never lowered to keep work moving. Option 2 (mid-session failover) is deferred and not folded in: it becomes its own future Action with its own resumability and idempotency guarantees, and feed-and-supervise-managed-production criterion 5 stays intact and unamended. Two implementation requirements accompany the decision: intended_provider, selected_provider and substitution_reason must be logged where an operator sees them in aggregate (session or plan log), not only in a per-launch preview that is easy to skim past; and the hard-evidence set must be enforced as a closed enum in code so it cannot drift back toward advisory heuristics under schedule pressure. Option 3 (stay passive) was rejected as creating operator toil with no added governance once Arcadia already has deterministic proof the intended provider cannot run. Where each part now lives: the answer field of docs/decisions/0063 carries the ratified option; the restrictions, the closed enum, the aggregate-logging requirement and the post-binding guarantee are the seven acceptance criteria of the new Action arcadia/substitute-unavailable-provider-before-binding; and mid-session failover remains unstarted, recorded here with its trigger rather than left as an open question. Recommended trigger for that deferral, subject to the operator's correction: reactivate when a managed Session has been lost to a mid-session provider failure in real use, or when the substitution Action has shipped and run clean, whichever comes first — a condition that will visibly happen or visibly not happen rather than a date. Nothing in this entry grants merge, deploy, publish, spend, credentials, messaging or production authority.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-21 — Agent Ask log-zero-prompt-rehearsal-failed-criterion-6-2026-09-21

- **Did:** Record that the first counted zero-prompt rehearsal ran on 2026-09-21 and FAILED acceptance criterion 6: the coding agent hit a sandbox permission denial, so the run was not zero-prompt and prove-zero-prompt-production-loop is not complete.
- **Result:** The rehearsal is not complete and must not be recorded as such. Action A's edit succeeded: the agent committed 5d83b20 'feat(rehearsal): add REHEARSAL.md marker for write-rehearsal-marker' on the agent-owned branch opencode/write-rehearsal-marker-20260921T162450509Z in the prepared worktree /Users/pmark/.opencode/worktrees/write-rehearsal-marker-20260921T162450509Z/arcadia-zero-prompt-rehearsal, and REHEARSAL.md contains exactly 'zero-prompt rehearsal action A'. Then the session was refused a read: 'permission requested: external_directory (/Users/pmark/Dev/MR/Arcadia/arcadia/src/*); auto-rejecting', followed by 'Read /Users/pmark/Dev/MR/Arcadia/arcadia/src/cli.ts failed [offset=740, limit=70]' and 'The user rejected permission to use this specific tool call.' Criterion 6 requires zero sandbox approval prompts and zero hidden interventions, and the runbook states plainly that any sandbox prompt or denial makes that criterion failed rather than a partial pass, so it is recorded as failed and not forced. Root cause is a named, previously deferred gap rather than a new defect: opencode's permission configuration is deliberately left alone by go-broker install, deferred by add-opencode-production-provider, and ~/.config/opencode/opencode.jsonc carries an explicit permission.external_directory allow-list that includes ~/.codex, ~/.claude, ~/.opencode, ~/.local, ~/tmp, ~/Dev/MR/Arcadia/workspaces and others but not /Users/pmark/Dev/MR/Arcadia/arcadia itself. The agent asked to read the Arcadia controller's own source from outside its fixture worktree, which no allow rule covers, so it auto-rejected. Two things follow and neither is decided here: whether that read is ever necessary, since make-worktree-runtime-self-contained requires every mandatory lifecycle path to run from the prepared candidate without reaching the main checkout's code, and if it is not necessary then why the agent went there. The agent branch is committed but UNPUSHED and un-preserved, with no draft pull request, so criterion 4's preservation step did not happen; the fixture is otherwise unchanged, the standing policy is still revision 9 epoch 8, and the pointer still names prove-zero-prompt-production-loop. No completion evidence is filed for this run and no criterion is claimed met.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-21 — Agent Ask log-zero-prompt-rehearsal-action-a-succeeded-2026-09-21

- **Did:** Record that Action A of the zero-prompt rehearsal ran with zero sandbox permission lines on the fifth counted attempt, and that the reconcile bridge has no Session to act on.
- **Result:** Run 20260921T214756Z-2193 (launch-zero-prompt-rehearsal-action-a button): opencode exit 0, 0 permission-denial lines, REHEARSAL.md correct, branch opencode/write-rehearsal-marker-20260921T214955821Z pushed, fixture PR #2 open and non-draft, and the agent settled its own complete Ask in the candidate (commit e562ae8: Action A done, fixture pointer now confirm-rehearsal-marker). Four earlier attempts failed criterion 6 on external_directory reads of Arcadia checkout, each from a real defect now fixed: #466 draft target, #469 settle target, #471 complete example in the contract, #472 work-monitor broker scoped to its Project. Criterion 6 is NOT recorded met: it spans Action B through completion. Open: go-broker without --launch creates no Session (session null, zero agent_sessions rows), so runbook Step 4 session reconcile has nothing to reconcile (issue 460); fixture PR #2 is unmerged so the fixture main pointer has not advanced to Action B.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-22 — Completed arcadia/an-agent-ask-action-amendment-can

- **Did:** Completed Action arcadia/an-agent-ask-action-amendment-can from accepted evidence (Candidate 3e3372ac3abe4b4d955db45d8dc3007d407d7abe).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia agent-ask settle --responsibility requires_review (or blocked) succeeds for an action-amendment intent, on explicit operator direction in the live session, matching the existing agent/autonomous behavior."; "arcadia agent-ask settle --responsibility <unrecognized value> is refused with a clear error naming the accepted values."; "A regression test amends an existing Actions responsibility to requires_review through this path and asserts the written plan document and settlement effects."; "No change to the existing restriction that a brand-new Action still requires an explicit --responsibility at creation time.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-an-agent-ask-action-amendment-can-2026-09-22).

## 2026-09-22 — Completed arcadia/formalize-two-phase-planning-process

- **Did:** Completed Action arcadia/formalize-two-phase-planning-process from accepted evidence (Candidate c83b2838e2aeb7c1eccc36e7156674532af3504b).
- **Result:** Every declared acceptance criterion was accepted as met: "docs/planning-process.md exists, vendor-neutral, and states the two-phase process: Phase 1 (Outcome Alignment Interview) produces a confirmed Outcome/Milestone plus any open Decisions with options and consequences; Phase 2 (Staff Planning Architect) consumes that and produces a Plan amendment or new Plan with dependency-ordered, session-sized Actions."; "The document embeds both role prompts in full, written so they can be pasted into any coding-agent or chat surface -- Claude Code, Codex, opencode, or a bare frontier-model chat -- not gated behind a single vendors skill mechanism."; "The document states how to invoke each phase today (a coding-agent session prompt, or pasting the role prompt directly) given that Claude Code skills live outside this repository at ~/.claude/skills and are not repository-managed content; wiring automatic invocation into arcadia ask routing is named as an explicit deferred trigger, not built here."; "AGENTS.md gains a short pointer to docs/planning-process.md so a future session of any vendor can discover it without being told."; "Neither the document invents a new Arcadia document type or CLI capability; both phases produce only Agent Asks against existing intents (outcome, milestone, decision, plan, action)."; "mise exec -- pnpm exec tsc -p tsconfig.json --noEmit passes, and arcadia docs sync reports no new errors attributable to the changed files; pnpm builds full-repo lint step is not a gate here, since it already fails in a prepared worktree on files this Action never touches (tracked, unrelated, in Issue #480).".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-formalize-two-phase-planning-process-2026-09-22).

## 2026-09-22 — Completed arcadia/substitute-unavailable-provider-before-binding

- **Did:** Completed Action arcadia/substitute-unavailable-provider-before-binding from accepted evidence (Candidate e3faec97194eee2406beaec91cd95520ab3f441e).
- **Result:** Every declared acceptance criterion was accepted as met: "Substitution happens only before packet binding, reusing selectCompliantCodingAgent's existing capability, tools, context, locality and sandbox floors: the replacement is equivalent-or-stronger and never a weaker or cheaper substitution, and when no equivalent eligible permitted provider exists Arcadia surfaces the incapacity normally rather than lowering a capability floor to keep work moving."; "Hard evidence is a closed enum in code rather than a heuristic, containing exactly: provider unavailable, model unavailable, authentication failure, explicit quota or rate-limit rejection, and one explicitly named deterministic launch-precluding catch-all. Advisory capacity estimates — including an unadmitted, stale, reserve-margin or exhausted capacity decision — never trigger substitution, and a regression test fails if a value is added to or removed from the closed set without the change being deliberate."; "intended_provider, selected_provider and substitution_reason are recorded where an operator sees them in aggregate — the Session or Plan log, not only the per-launch preview — and the record names which hard-evidence value caused the substitution."; "Once packet binding or execution has begun, provider identity is execution history: no automatic cross-provider retry, re-admission or provider swap occurs, and a mid-session failure still terminates or suspends under the existing recovery rules. feed-and-supervise-managed-production criterion 5 is unchanged by this Action."; "A substitution never replays work the intended provider already applied and never changes an immutable packet's bound provider; resumed work is recorded against the provider that actually runs it, with the resume guidance the existing selection contract already produces."; "Deterministic tests cover substitution for each hard-evidence value, refusal to substitute on advisory capacity alone (unadmitted, stale, reserve-margin, exhausted), refusal when no equivalent permitted provider exists without lowering a floor, and the post-binding guarantee that no switch occurs."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR states the exact operator procedure, target and recovery command or why no runnable surface exists.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-substitute-unavailable-provider-before-binding-2026-09-21).

## 2026-09-22 — Completed arcadia/refresh-managed-production-readiness-2026-09-22

- **Did:** Completed Action arcadia/refresh-managed-production-readiness-2026-09-22 from accepted evidence (Candidate 2cd83951fef34533e3e1e489a96ac6b4106401b9).
- **Result:** Every declared acceptance criterion was accepted as met: "The gate tables reflect each named Actions current status: and Gate 2 is marked closed now that verify-worker-recovery-before-success, fix-packet-lifecycle-latest-planning-decision, and translate-reasoning-effort-at-launch are done."; "prove-zero-prompt-production-loop is described accurately: reclassified to responsibility requires_review this session (Decision 0064, PR #481), so it is no longer wrongly dispatched to coding agents; separately, the real rehearsals Action A succeeded live with opencode on 2026-09-21 per MISSION_LOG, and the specific remaining technical gap is named (Issue #460)."; "The new current-pointer Action substitute-unavailable-provider-before-binding is named, with its concrete blocker (packet lifecycle planning_required, per arcadia session preview-launch)."; "The newly filed worker-hang defect (Issue #485) is named as a blocker to the indefinite-unattended claim specifically, distinct from the existing detect-hung-managed-production-sessions Action which covers hung Sessions, not a hung worker daemon itself."; "The critical path list is re-sequenced in dependency order against current Plan state, and the Last derived date and executive summary numbers (distance, gate counts, scoreboard) are updated to match."; "External blockers table is re-verified against live arcadia production capacity output and MISSION_LOG, correcting the stale opencode Unexpected server error claim."; "Every claim in the refreshed document traces to a live command output, a Plan document field, a Decision file, or a MISSION_LOG entry actually read during this Action -- no guessing forward from the prior version.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-refresh-managed-production-readiness-2026-09-22).

## 2026-09-22 — Completed arcadia/self-heal-hung-worker-heartbeat

- **Did:** Completed Action arcadia/self-heal-hung-worker-heartbeat from accepted evidence (Candidate ae153ec4f87243e78bedd439f1f5b0c609b7c137).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia worker status classifies a process whose heartbeat exceeds the existing staleness threshold as unhealthy even when the process is alive, matching the same threshold arcadia-preserve-broker-* already uses to refuse."; "arcadia worker start detects an unhealthy (stale-heartbeat) existing process rather than reporting Worker already running, and either terminates and relaunches it automatically or exits non-zero naming the exact stale PID and remedy -- it must not silently leave a hung process in place the way it did in Issue #485."; "Recovery from a hung process is safe under launchds concurrent restart semantics: no duplicate worker processes, no orphaned pidfile pointing at a dead PID, and no lost in-flight preservation or production state beyond what a normal worker restart already tolerates."; "A regression test reproduces a stale-heartbeat-but-alive worker process (fixture, not a real 159-minute hang) and asserts status reports unhealthy and start recovers it without manual intervention."; "This Action does not attempt to root-cause why the original process accumulated 159 minutes of CPU time or ignored SIGTERM -- that investigation is out of scope here and, if still worth doing after this ships, is a separate deferred item; this Action only has to make the symptom self-healing."; "docs/managed-production-readiness.md is updated to reflect the fix once it ships: the worker-hang section is closed out or rescoped depending on what actually shipped, per that documents own refresh discipline.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-self-heal-hung-worker-heartbeat-2026-09-22).

## 2026-09-22 — Completed arcadia/surface-batch-readiness-view

- **Did:** Completed Action arcadia/surface-batch-readiness-view from accepted evidence (Candidate fe77dc4da2e93c2b3b31ff4271f10be16daafc68).
- **Result:** Every declared acceptance criterion was accepted as met: "resolveReadySet (or a thin wrapper over it) groups its existing ready-set output into lanes by repo/Project -- same-repo Actions in one lane labeled sequence-advised, different-repo Actions each in their own lane -- and sums each lanes token_impact tier plus an overall total, with zero model calls."; "The same function computes the batch boundary: walk the dependency-clear ready set forward from current_action and stop at the first Decision, deferred Action, clarification: question_open Action, or capacity-gated proof run; everything before the boundary is the batch, everything after is named but not expanded."; "apps/dashboard/app/runs/page.tsx and production-control-panel.tsx extend the existing Next up section into This push (the batch, expanded, lanes visible) and Next push (collapsed by default, same pattern as Recent history) instead of the current flat list; the boundary itself renders as an actionable prompt (a Decision link, an un-defer control, or a plain named blocker) rather than prose."; "This reuses the existing /api/production-control route and useProductionControl hook -- extend their payload/types, do not add a new API route or a new top-level dashboard page."; "The GitHub board mirror writes the computed lane/batch position through the existing card-status projection pipeline (the same mechanism Gate 1 already uses to keep Arcadia status fresh per card), recomputed on the same cadence as that projection -- never cached separately, since a stale batch label on a card is worse than none."; "The mirror does not attempt to create or manage a GitHub Projects saved view, grouped board, or swimlane -- GitHubs API has no capability for that (confirmed, docs/managed-production-readiness.md Gate 1). Document that creating a grouped view from the mirrored field is a one-time manual operator step in GitHubs own UI, not something this Action builds."; "A regression test covers lane grouping (same-repo vs cross-repo), the boundary computation stopping at each of the four named gate types, and token rollup arithmetic, using a fixture Plan rather than live production state.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-surface-batch-readiness-view-2026-09-22).

## 2026-09-22 — Completed arcadia/preserve-on-exit-and-integrate

- **Did:** Completed Action arcadia/preserve-on-exit-and-integrate from accepted evidence (Candidate afffc480da2896c7c5244edd71062077fce26c82).
- **Result:** Every declared acceptance criterion was accepted as met: "When a managed-production Session reaches a terminal process state, the host preserves that Session's candidate through the existing candidate-preservation machinery (runPreserveCommand / preserveCandidate) without requiring the agent to have requested preservation while alive; a candidate already preserved is never re-committed."; "The host validates the candidate with the Project's declared objective validation_commands run host-side where dependencies are available, refuses to preserve on a failed, skipped or absent check, and preserves all candidate files on refusal."; "Candidate integration happens only under the explicit authority recorded by Decision 0058, never inferred from this Action's acceptance criteria or from a standing production grant that delegates only validation, acceptance and pointer transitions. Before integrating, the mechanism verifies the grant is unexpired and names this Project, Plan, Action, agent-owned branch and governed base branch."; "Absent a valid grant the mechanism stops after preservation and reports the exact operator merge command; merge, deploy, publish, spend, credentials, messaging and destructive operations remain separate gates."; "Integration is a fast-forward or clean merge of the grant's own agent-owned branch into the governed base branch; a conflict, a non-agent-owned branch, a divergent base, or a candidate outside the grant scope stops integration, reports the exact blocker, and preserves all work."; "After integration the Action advances through the existing canonical completion and pointer writers, and the worker admits the next eligible Action with no operator command in between; repeated, concurrent or interrupted reconciliation is idempotent and never duplicates a commit, completion, Decision or pointer move."; "A deterministic fixture proves terminal-session detection, host-side validation, preservation, integration and admission of the next Action, plus refused-integration cases (a conflict, an expired or absent grant, and an out-of-scope candidate) that preserve all work, and an already-preserved candidate that is not duplicated."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR states the exact operator procedure, target and recovery command or why no runnable surface exists.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-preserve-on-exit-and-integrate-2026-09-22).

## 2026-09-22 — Completed arcadia/serialize-current-action-writes

- **Did:** Completed Action arcadia/serialize-current-action-writes from accepted evidence (Candidate 3ca7fb396cf49694fcbd817bd1b652a8929d54fa).
- **Result:** Every declared acceptance criterion was accepted as met: "settleAgentAsk's PROJECT.md/Plan pointer write for project_update and complete routes through transitionActionPointer (or reuses its fingerprint discipline: headBefore plus both documents' content hashes, verified fresh at write time) instead of its own independent readFileSync-then-writeFileSync-via-temp-file path."; "The retry rule preserves an explicitly resolved settlement target: project_update and complete can resolve an Action outside queue order, and a compare-and-set failure retries the pointer transition against that same resolved target, re-reading only the base content for a fresh diff -- it never re-derives current_action from fresh queue state, which could silently retarget a different Action."; "A compare-and-set failure retries under the same settlementRequestId, since that id is what the existing duplicate-settlement guard already keys idempotency on."; "writePairAtomically's existing pair-write (PROJECT.md and the Plan document, inside transitionActionPointer's db.transaction) covers the settlement path too, so a retry or a concurrent transition cannot interleave the two documents' renames or leave them pointing at different current_action values."; "A regression test reproduces two concurrent settlements for two different Actions racing to write current_action: the second settlement's compare-and-set fails against the first's already-applied change, retries against fresh state, and both pointer moves are preserved in the correct final order -- neither is silently discarded."; "pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-serialize-current-action-writes-2026-09-22).

## 2026-09-22 — Completed arcadia/plan-scoped-agent-ask-complete

- **Did:** Completed Action arcadia/plan-scoped-agent-ask-complete from accepted evidence (Candidate ea58900c6bce5128bae8efb99133549402f5b122).
- **Result:** Every declared acceptance criterion was accepted as met: "target_ref of the form plan/<plan-slug>#<action-id> resolves and completes that Action in the named plan, regardless of whether that plan is the Project's active_plan; plain action/<id> is unchanged and continues to mean the active plan."; "Completing an Action in a non-active plan does not write PROJECT.md and does not change the active plan's current_action or queue; the settlement records that the pointer and active plan were left untouched."; "A non-unique Action id across the Project's plans is refused with a clear error, matching the existing guard used by plan activation."; "Every other complete-intent validation is unchanged for both forms: evidence must cover every declared acceptance criterion verbatim and in order, all evidence must be met, candidate_revision must match HEAD, unresolved required review Decisions refuse completion, and the existing clean-tree/preview-fingerprint/replay-receipt/Mission-Log behavior is preserved."; "arcadia agent-ask contract's complete example and AGENTS.md's complete-intent description both document the plan/<slug>#<action-id> form, not only action/<id>."; "Regression tests cover: completing an Action in a non-active plan while a different plan stays active throughout, asserting the active plan's document and PROJECT.md are byte-for-byte unchanged; and refusing an ambiguous or unresolvable plan-scoped target_ref."; "pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-plan-scoped-agent-ask-complete-2026-09-22).

## 2026-09-22 — Completed arcadia/add-action-scoped-worktree-claim

- **Did:** Completed Action arcadia/add-action-scoped-worktree-claim from accepted evidence (Candidate c0d5160e98c1efb9ff1eb66195c0721925f64fbd).
- **Result:** Every declared acceptance criterion was accepted as met: "A new active-claim lookup keyed on (repository_path, project, action_id) coexists with the existing (repository_path, worktree_path) uniqueness on agent_worktree_reservations; neither constraint can be satisfied by breaking the other."; "The Action-id conflict lookup filters expires_at > now in the query itself, matching getActiveWorktreeReservation's existing discipline, not only via delete-on-insert cleanup."; "Each claim carries a generation (monotonic counter or fresh id per claim, matching how reserveAgentWorktree already replaces rather than reuses a row)."; "A settlement whose generation does not match the claim's current generation fails loudly and writes nothing; the generation check and the settlement's writes are the same atomic operation (inside transitionActionPointer's existing db.transaction, per the follow-up bound in dispatch-different-ready-action-per-session), never a check followed by a separate write."; "A claim is released only by a settlement that completes with apply: true, or by worktree/Session preparation that fails outright before returning its error; both release paths condition their delete atomically on (repository_path, project, action_id, generation) matching, and are no-ops on an already-released claim or a claim whose generation has since moved on."; "The 24-hour TTL remains as fallback cleanup only, for an owning process that genuinely died mid-work -- never primary cleanup for a normal completion or a normal preparation failure."; "Claiming an already-actively-claimed Action is a hard refusal (extending evaluateExistingCandidate's existing shape), never an advisory flag a caller can act past."; "Deterministic tests cover: two claims for the same Action racing (one wins, one refuses); claim release on successful settlement; claim removal on failed preparation; a stale-generation settlement refusing to write; an already-released or superseded-generation release being a no-op; and the worktree-path and Action-id uniqueness constraints being independently enforceable."; "pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-add-action-scoped-worktree-claim-2026-09-22).

## 2026-09-22 — Completed arcadia/bind-candidate-revision-in-action-settle

- **Did:** Completed Action arcadia/bind-candidate-revision-in-action-settle from accepted evidence (Candidate 67b7187fb38d6105535705d98685e734367cd5c7).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia action settle computes candidateRevision from the checkout settlement resolves (projectCheckoutFor over the Project repository and cwd), not from the configured main checkout, so completing from a candidate worktree whose HEAD differs from the base HEAD no longer refuses (fixes Issue #278)."; "A regression test completes an Action from inside a candidate worktree where the candidate branch HEAD differs from the main checkout HEAD and asserts success; the existing main-checkout flow is unchanged."; "The refusal message, when a revision genuinely does not match, names the actual mismatch rather than misdirecting to 'refresh evidence'."; "Existing action settle, Agent Ask settlement, and codex and claude behavior is unchanged; pnpm test and the core, Discord, and Dashboard builds pass."; "The Action closes GitHub Issue #278 when it merges.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-arcadia-bind-candidate-revision-in-action-settle-362df091a91b).

## 2026-09-22 — Completed arcadia/apply-answered-decision-consequences

- **Did:** Completed Action arcadia/apply-answered-decision-consequences from accepted evidence (Candidate b1891c7f5f5700478a81dab21016e13a90bc9612).
- **Result:** Every declared acceptance criterion was accepted as met: "When a Decision that governs an Action is answered, Arcadia applies the chosen option consequence to that Action checked-in plan record in the same transition (a deferral parks the Action so dispatch stops selecting it), or refuses the answer with a named reason and leaves the Decision and the Action unchanged."; "When the answer parks the current Action, the governed pointer advances to the next eligible Action in the existing explicit queue with no second operator command and no hand-edited plan field."; "The transition is previewable, idempotent and reversible: one receipt records the Decision, the Action field change and the pointer move, and a retry returns the same receipt without duplicate effects."; "An agent cannot perform this transition directly; Arcadia writes the canonical records, and no local script, second pointer writer or new queue is introduced."; "Preserve the proof Artifact: deterministic tests covering the deferral-applies, the refusal naming the missing apply path, the pointer advance, and the idempotent retry, plus the exact operator command in the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-apply-answered-decision-consequences-2026-09-22).

## 2026-09-23 — Completed arcadia/dispatch-different-ready-action-per-session

- **Did:** Completed Action arcadia/dispatch-different-ready-action-per-session from accepted evidence (Candidate 8b5640b6e5286732eb3c7f55cd8eb9763211706d).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia go's queue-walk-and-claim runs inside the same writeTransaction that already serializes evaluateExistingCandidate and worktree reservation (src/commands/go.ts), attempting an atomic conditional claim per candidate in the order buildAgentQueue already computes."; "Losing a claim race on one candidate continues the walk to the next dependency-ready, still-unclaimed entry rather than stopping or retrying the lost one."; "arcadia advance run inside a worktree that already holds a claim resolves that claim's Action directly and never consults the queue-walk fallback."; "current_action in PROJECT.md and the Plan document remains a single value; no reader of it (dashboard, docket, arcadia next's narrative brief) is required to change."; "arcadia agent-ask settle (project_update and complete) loads the settling worktree's own claim, verifies its action_id matches the Action settlement is about to resolve, and carries that claim's generation through the settlement's writes and release, per add-action-scoped-worktree-claim's generation fencing."; "Deterministic tests cover: two concurrent arcadia go invocations against the same current_action each landing on a different ready Action; a queue-walk correctly skipping a dependency-blocked or already-claimed entry; arcadia advance never reassigning an in-progress worktree; and a settlement refusing when its worktree's claim does not match the Action it is settling."; "pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Plan complete; every Action is done.
- **Blockers:** None recorded by this settlement (Agent Ask complete-dispatch-different-ready-action-per-session-2026-09-22).

## 2026-09-23 — Completed arcadia/make-go-total-across-plans

- **Did:** Completed Action arcadia/make-go-total-across-plans from accepted evidence (Candidate 8b0474a8d26b897fa544094d34687e8a04bb8f80).
- **Result:** Every declared acceptance criterion was accepted as met: "Arcadia Go, Action completion, and managed-production continuation use one shared total transition resolver for active work, completed Plans, absent active-Plan pointers, stale missing-Plan pointers, Decisions, external blockers, reconciliation, waiting, and Project milestone completion."; "When no active Plan can continue, Arcadia activates the Plan whose earliest eligible Action is highest in the existing explicit operator-owned queue and makes that Action current without another operator round trip; dependencies, Decisions, responsibility, and approval gates filter eligibility without changing queue priority."; "A stale or missing active-Plan pointer is repaired automatically only when checked-in documents and explicit queue order determine one eligible replacement without ambiguity; otherwise Arcadia emits one actionable Decision or named truth blocker and preserves all work."; "Approved legacy Actions lacking explicit order receive a previewed, reversible FIFO seed before automatic Plan selection; timestamps never silently reorder work after that seed and existing explicitly ordered work is unchanged."; "No separate urgency or priority field is introduced. Reordering the explicit queue remains the single way to change priority until a concrete accepted requirement cannot be represented there."; "Repeated, concurrent, interrupted, and lost-response transitions are idempotent: one Plan is activated, one Action becomes current, and retries return the same durable receipt without duplicate pointer or queue effects."; "Fixtures cover a completed active Plan, no active Plan, a dangling missing-Plan pointer, one eligible candidate, several candidates with explicit order, blocked higher candidates, unordered legacy candidates, a genuine ambiguity requiring one Decision, and a Project with no remaining work."; "The operator-facing QA plan gives the exact local Arcadia Go commands and observable pointer, queue, receipt, and refusal results; the end-user procedure is stated separately if it differs.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-make-go-total-across-plans-2026-09-23).

## 2026-09-23 — Completed arcadia/detect-hung-managed-production-sessions

- **Did:** Completed Action arcadia/detect-hung-managed-production-sessions from accepted evidence (Candidate 8154a887340975708b55c079838c4c85844ce5ea).
- **Result:** Every declared acceptance criterion was accepted as met: "Define an observable, deterministic signal for 'stalled' (e.g. no new tmux pane output, no new Run/receipt activity) and a bounded deadline before a live-but-stalled Session is flagged."; "A flagged stalled Session is surfaced as an explicit uncertain/needs-attention state, never silently reconciled as successful or silently relaunched."; "The existing repository lease and admission are preserved (not released) while a Session is only suspected stalled, pending operator or bounded automatic repair."; "False positives are bounded: a Session doing real long-running work is not flagged merely for being slow.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-detect-hung-managed-production-sessions-2026-09-22).

## 2026-09-23 — Completed arcadia/reference-constitution-without-duplicating-it

- **Did:** Completed Action arcadia/reference-constitution-without-duplicating-it from accepted evidence (Candidate 24cafda9f87e748f104ca5f020634be55d0af40c).
- **Result:** Every declared acceptance criterion was accepted as met: "A dispatch and agent brief identify the repository CONSTITUTION.md and its content fingerprint without embedding its full text more than once across the handoff path."; "An agent still receives or deterministically loads the canonical Constitution before performing an authority-sensitive action, and a changed or unreadable Constitution fails closed with an actionable remedy."; "Regression tests prove dispatch and session briefs remain bounded while constitution drift or unreadability cannot silently weaken the contract.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-reference-constitution-without-duplicating-it-2026-09-23).

## 2026-09-23 — Completed arcadia/guard-go-fallback-against-claimed-actions

- **Did:** Completed Action arcadia/guard-go-fallback-against-claimed-actions from accepted evidence (Candidate 884f7c34105c5633baaa6d9ac8abd89cfe16f76d).
- **Result:** Every declared acceptance criterion was accepted as met: "Every fallback candidate `arcadia go` considers is checked for an existing live worktree/Action claim in a loop before dispatch, not only the pointer Action."; "A fallback candidate already claimed by another live worktree is skipped and the walk continues to the next dependency-ready unclaimed Action; when none remains, `go` refuses with a named reason and a remedy."; "The final `resolveProjectTransition` dispatch is bound to the same reserved fallback Action as `dispatch` and `queueFallback`; a regression assertion proves `transition.dispatch.context.action.id` equals `dispatch.context.action.id` and `queueFallback.actionId`."; "A deterministic test runs two concurrent `go` invocations against the same pointer and asserts they either land on two different ready Actions or one refuses, never two sessions on one Action."; "A regression test reproduces the observed two-PR case (two prepared worktrees for one Action) and proves the second dispatch is refused."; "`pnpm test` and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-guard-go-fallback-against-claimed-actions-2026-09-23).

## 2026-09-23 — Completed arcadia/refresh-pointer-action-against-current-base

- **Did:** Completed Action arcadia/refresh-pointer-action-against-current-base from accepted evidence (Candidate e4b9d8334a21179305c0d6b8c7be360e159db132).
- **Result:** Every declared acceptance criterion was accepted as met: "`arcadia go` re-resolves the pointer Action from the current base branch before preparing or resuming its worktree, not only from the possibly-stale `projectRoot` checkout."; "When the current-base version of the pointer Action is `done`, or is no longer the `current_action`, `go` refuses or walks to the next eligible Action instead of preparing a duplicate candidate for already-completed work."; "A regression test starts from an older checkout whose pointer Action is already done on the base branch and asserts no new worktree or claim is created for it."; "`pnpm test` and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-refresh-pointer-action-against-current-base-2026-09-23).

## 2026-09-23 — Completed arcadia/prove-managed-production-fault-matrix

- **Did:** Completed Action arcadia/prove-managed-production-fault-matrix from accepted evidence (Candidate d6aae22e64c43693cc923c035a4b7a21bc9f86a4).
- **Result:** Every declared acceptance criterion was accepted as met: "The admission/launch, Off, capacity, and priority/authority race scenarios from the contract-20 boundary table each run at least 100 reproducible seeded interleavings against the real policy and claim store with zero invariant violations, retaining the failing seed and timeline for any violation."; "The harness is shown to reject injected defects: disabling each guard it covers in turn makes the matrix fail with a named seed, and any guard it cannot catch is recorded as such."; "A single release evidence index maps every contract-20 invariant and quality gate to pass/fail/unproven, revision, artifact, and reproduction procedure, with missing live evidence left unproven.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prove-managed-production-fault-matrix-2026-09-23).

## 2026-09-23 — Completed arcadia/give-zero-prompt-fixture-actions-a-build-packet

- **Did:** Completed Action arcadia/give-zero-prompt-fixture-actions-a-build-packet from accepted evidence (Candidate d4b054ad89e6669273bb7ce0b952c9f12df0d342).
- **Result:** Every declared acceptance criterion was accepted as met: "The Zero Prompt Rehearsal fixture Project's Actions carry a real build packet, so `arcadia session preview-launch` resolves them instead of reporting `planning_required`."; "The guarded session-launch path can launch the fixture's Action B with no manual packet step, while the existing manual runbook path remains available and unchanged."; "A deterministic test resolves the fixture's Action through the guarded launch path and asserts a launchable packet rather than `planning_required`."; "`pnpm test` and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-give-zero-prompt-fixture-actions-a-build-packet-2026-09-23-v2).

## 2026-09-23 — Completed arcadia/bind-preservation-checks-to-host-owned-code

- **Did:** Completed Action arcadia/bind-preservation-checks-to-host-owned-code from accepted evidence (Candidate e1a64a6fa7651dfba6ad75adde5d97e40037dcd3).
- **Result:** Every declared acceptance criterion was accepted as met: "A candidate can no longer pass protected preservation by rewriting the code its declared check executes: the check definition or its content digest is bound to the authorized packet, and a candidate that changes it is refused with a named reason."; "The chosen enforcing mechanism is a host-owned checker or a content digest bound to the authorized packet, recorded with its security boundary; documentation-only treatment is explicitly out of scope because it cannot refuse a rewritten check."; "Deterministic tests cover a candidate that neuters its check (refused, candidate files preserved) and an unchanged candidate (preserved), per contract 20's negative-case requirement."; "`pnpm test` and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-bind-preservation-checks-to-host-owned-code-2026-09-23b).

## 2026-09-23 — Completed arcadia/prove-fault-matrix-remaining-boundaries

- **Did:** Completed Action arcadia/prove-fault-matrix-remaining-boundaries from accepted evidence (Candidate da3f9cb093df5662293581ac3f02db83dc3e205b).
- **Result:** Every declared acceptance criterion was accepted as met: "The completion/pointer, process-health, and runtime race scenarios from the contract-20 boundary table each run at least 100 reproducible seeded interleavings with crash injection points specified in the harness, with zero invariant violations and retained failing-seed/timeline evidence for any violation found and fixed."; "A completion whose declared Artifact is absent is refused, with a test."; "docs/evidence/managed-production-release-evidence-index.md is updated with each new row's status, revision, and reproduction procedure.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prove-fault-matrix-remaining-boundaries-2026-09-23).

## 2026-09-23 — Completed arcadia/build-autonomous-defect-loop

- **Did:** Completed Action arcadia/build-autonomous-defect-loop from accepted evidence (Candidate a13d4f0da1f6ccb592431744bc2283a1a8433774). The Action was narrowed to the zero-model `arcadia defect` intake only; the periodic worker triage, capacity gate, promotion, stop-the-line escalation, and low-risk repair are split into the proposed Action `defect-bounded-triage-loop`, so this completion does not imply the triage loop is done.
- **Result:** Every declared acceptance criterion was accepted as met: "`arcadia defect <summary>` records a durable Back Burner defect signal with a stable id and automatically captured Project, source, time, repository revision when available, and optional evidence; successful intake makes zero model calls."; "Repeated intake is lossless and replay-safe: exact retries are idempotent, deterministic matching identifies likely duplicates without silently discarding distinct reports, and the reporter receives the durable record id."; "Deterministic tests cover zero-model intake, exact-retry idempotency, and duplicate candidates."; "The operator-facing QA plan names the exact CLI intake, Back Burner and defect-signal inspection steps, observable expected results, and whether the procedure is also the end-user procedure.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-build-autonomous-defect-loop-2026-09-23).

## 2026-09-23 — Completed arcadia/triage-decisions-before-opening

- **Did:** Completed Action arcadia/triage-decisions-before-opening from accepted evidence (Candidate 1f28c7338797d67f74e764f395e5e344c2a38588).
- **Result:** Every declared acceptance criterion was accepted as met: "Decision-intent settlement records which gate question fired, and refuses to open a Decision when neither fires and the move is reversible, converting it into a PR-reported assumption."; "Approval boundaries (merge, deploy, publish, spend, credentials, production, messaging) always open a Decision regardless of triage."; "A fixture shaped like Decision 0052 is reported, not opened.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-triage-decisions-before-opening-2026-09-23).

## 2026-09-23 — Completed arcadia/register-agent-workspace-trust

- **Did:** Completed Action arcadia/register-agent-workspace-trust from accepted evidence (Candidate 94d2c9ad0a8dfa6f9b1584baa40f54ab46276469).
- **Result:** Every declared acceptance criterion was accepted as met: "`go-broker install` records workspace trust for each configured Project repository at its repository root, using the agent's own trust mechanism (for Codex, a `[projects."<repo root>"] trust_level = "trusted"` entry in the operator's config)."; "Trust is granted only to repositories already configured as Arcadia Projects. A parent directory, a shared worktree root such as `~/.codex/worktrees`, and the home directory are never trusted, and a test proves each of those three is refused."; "`go-broker status` reports trust as a named check alongside the existing profile, executable and allowlist checks, and reports `ready: false` with the exact missing repository when trust is absent."; "Re-running `install` is idempotent: an existing trusted entry is neither duplicated nor downgraded, and unrelated entries in the operator's config are preserved byte-for-byte."; "A repository the agent has never seen dispatches a prepared worktree with zero trust prompts and zero approval prompts, proven on a disposable fixture rather than asserted."; "State explicitly whether Claude Code's equivalent workspace-trust gate needs the same treatment; if it does, cover it, and if it does not, record why in the Artifact."; "Preserve the proof Artifact: trust-scoping refusal tests, idempotence tests, and the zero-prompt fixture evidence; include the exact runnable target and operator QA steps in the pull request, or state why no runnable surface exists.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-register-agent-workspace-trust-2026-09-23).

## 2026-09-23 — Completed arcadia/escalate-nonrecoverable-launch-refusals

- **Did:** Completed Action arcadia/escalate-nonrecoverable-launch-refusals from accepted evidence (Candidate b8f4c7410625d9ada05c0e5c96042aa7056fde5d).
- **Result:** Every declared acceptance criterion was accepted as met: "production/tick.ts's conflict-refusal handling classifies planning_required, and any other refusal whose remedy requires an operator or agent action rather than the passage of time, separately from capacity/Off/stale-preview/lease conflicts."; "A non-self-resolving refusal is surfaced once per a bounded window (not on every tick) through a durable, operator-visible signal -- the existing /runs terminal-approvals surface or an equivalent named mechanism -- rather than appearing only as routine worker.out.log noise."; "A deterministic test reproduces both cases: a transient conflict (e.g. capacity) keeps retrying silently exactly as today; a planning_required refusal is surfaced once and does not repeat the same signal on every subsequent tick while it remains unresolved."; "pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-escalate-nonrecoverable-launch-refusals-2026-09-23).

## 2026-09-23 — Completed arcadia/preflight-provider-signin-before-launch

- **Did:** Completed Action arcadia/preflight-provider-signin-before-launch from accepted evidence (Candidate 18f5455b084389c7c35cd86fed580a68de342e2d).
- **Result:** Every declared acceptance criterion was accepted as met: "Before issueAdmission and before any worktree or lease is created, launchGuardedHostSession checks sign-in for the selected provider from the worker process context (claude-code-cli via claude auth status, or an equivalent documented check per provider) and refuses when it is not signed in."; "The refusal names the provider, says it is not signed in for the worker, gives the operator remedy, and appears in arcadia production status as the Project launch blocker rather than only in the worker log."; "A signed-out provider takes no repository lease and no concurrency slot, and the next tick retries without counting against the repair budget."; "Regression tests cover a signed-in launch, a signed-out refusal with no lease taken, and the surfaced status reason.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-preflight-provider-signin-before-launch-2026-09-23-v2).

## 2026-09-23 — Completed arcadia/auto-resolve-planning-required

- **Did:** Completed Action arcadia/auto-resolve-planning-required from accepted evidence (Candidate 23885c2b270d112f0d5c94e27cdf2072077954e1).
- **Result:** Every declared acceptance criterion was accepted as met: "Reproduces the observed failure: an Action reaching the front of the dispatch pointer with no packet does not require a human or a separately-dispatched agent session to run `arcadia work plan` by hand before it can launch."; "When completing the Action needs no Decision-gated planning run, its packet is prepared deterministically through the existing packets.ts template system -- no new or inconsistent prompt scheme is introduced."; "When the Action genuinely needs a real, Decision-gated planning run (CodexPlanningRunApproval), that run is requested automatically, and the existing approval gate is preserved -- this Action never bypasses it."; "A currently-open production_operator_escalations row for this exact Action (see src/production/tick.ts, PR #579) clears once the packet is prepared or the planning run is requested, through the tick's normal resolution path -- not a special case."; "A deterministic test reproduces both branches: the no-Decision-needed case resolves automatically within a bounded number of ticks; the Decision-gated case requests the planning run and stops there, never bypassing approval."; "pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-auto-resolve-planning-required-2026-09-23).
