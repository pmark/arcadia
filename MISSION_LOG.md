---
arcadia: v1
type: log
slug: arcadia-mission-log
project: arcadia
updated: 2026-10-10
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

## 2026-09-24 — Completed arcadia/pass-managed-claude-token-into-sessions

- **Did:** Completed Action arcadia/pass-managed-claude-token-into-sessions from accepted evidence (Candidate 4bf98372aa8dffe93255f75d32776f3eac7dd7d9).
- **Result:** Every declared acceptance criterion was accepted as met: "At claude-code-cli Session launch the worker reads the token from one documented file under the workspace config directory and passes it only into that Session process environment as CLAUDE_CODE_OAUTH_TOKEN; no other child process receives it."; "The worker refuses to use the file, with a named remedy, when it is readable by group or others, is empty, or is a symlink out of the workspace config directory."; "The token value never appears in logs, receipts, events, command lines visible to ps, packets, or error messages."; "The sign-in preflight from preflight-provider-signin-before-launch treats a valid token file as signed in for claude-code-cli."; "START_HERE documents the one-time operator setup (claude setup-token, then writing the file with 0600 permissions) and rotation, and a /runs operator button performs the write-and-verify step without the agent ever handling the value."; "Regression tests cover token pass-through, each refused file state, and absence of the value from logs and the tmux command line.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-pass-managed-claude-token-into-sessions-2026-09-24).

## 2026-09-24 — Agent Ask log-manual-two-phase-planning-independent-review-2026-09-24

- **Did:** Ran docs/planning-process.md's two phases by hand in one Claude Code session for provider-based pre-PR code review, amending the draft independent-review Plan. This is a recorded manual use toward the deferred trigger for routing arcadia ask into Phase 1.
- **Result:** The operator asked whether the Ask capture utility could start this planning. It could not: after #595 an imperative Ask becomes a Planning Request with a packet, but nothing runs the Outcome Alignment Interview, and route-execution-shaped-asks-to-planning is queued after managed production. Lessons for that routing: (1) the planning-process template's intent outcome and milestone Asks would overwrite the Project Outcome and Milestone, so a Plan-scoped Outcome belongs on the Plan; (2) a Plan amendment cannot set Milestone and Actions in one Ask, so Phase 2 needs two Asks; (3) the interview found existing machinery (src/qa/prReview.ts, an inactive draft Plan, and a Private Practice Now proposal) that a capture-only path would have missed.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-24 — Completed arcadia/divide-instead-of-stall

- **Did:** Completed Action arcadia/divide-instead-of-stall from accepted evidence (Candidate de3ef94988bc98ad69e5fde04468ddd1fcc9b013).
- **Result:** Every declared acceptance criterion was accepted as met: "A split settlement marks the finished slice done and places remainder Actions immediately after it in the queue.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/go-refuses-stale-session-without-question-or-blocker immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-divide-instead-of-stall-2026-09-24).

## 2026-09-24 — Completed arcadia/auto-settle-pending-completions-before-dispatch

- **Did:** Completed Action arcadia/auto-settle-pending-completions-before-dispatch from accepted evidence (Candidate d6a18ded2859ea42457c909d6444b09e226e121e).
- **Result:** Every declared acceptance criterion was accepted as met: "Given a repository whose current pointer Action already has a drafted complete Ask in .arcadia/asks/, and whose evidence criteria match the Action's declared acceptance criteria verbatim, and whose candidate_revision differs from HEAD only because later commits landed after the draft, go/advance settles it deterministically and re-resolves the pointer without launching any coding-agent process."; "The same path refuses to auto-settle (and falls through to normal dispatch) when the preview reports any conflict, any required Decision, or evidence that does not verbatim-cover every declared acceptance criterion."; "A repository with no drafted complete Ask for the current pointer, or no locally resolvable Arcadia workspace, dispatches exactly as it does today with no behavior change."; "A test proves the auto-settle path end-to-end against a fixture repo: stale candidate_revision, clean re-preview, settled commit, pointer advanced -- and a second test proves the fallthrough when evidence is incomplete or a conflict exists."; "docs/agent-continuation-protocol.md and AGENTS.md's 'One session completes one Action' section are updated to describe when a session's settlement instead happens automatically before that session is ever launched.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-auto-settle-pending-completions-before-dispatch-2026-09-24-v2).

## 2026-09-24 — Completed arcadia/go-refuses-stale-session-without-question-or-blocker

- **Did:** Completed Action arcadia/go-refuses-stale-session-without-question-or-blocker from accepted evidence (Candidate 8a96ac97517ef2420647af8bf8b229e0b1a19416).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia go refuses to end a session with the current Action unchanged unless it records an operator question or external blocker.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask go-refuses-stale-session-without-question-or-blocker-2026-09-24).

## 2026-09-24 — Completed arcadia/combine-advance-monitor-next-into-one-brief

- **Did:** Completed Action arcadia/combine-advance-monitor-next-into-one-brief from accepted evidence (Candidate a7f949da3625bc82c0bcb57bedf2918a9605f8fe).
- **Result:** Every declared acceptance criterion was accepted as met: "A new broker operation (extending scripts/arcadia-go-broker.ts and src/goBroker.ts) runs the existing advance logic, the existing work-monitor preflight, and the existing next dispatch resolution in one process invocation from the prepared worktree, and returns one combined JSON response including the exact rendered dispatch-brief text the operator must see -- no separate `pnpm arcadia next` invocation is needed to produce that text."; "The existing standalone advance, work-monitor, and next commands are unchanged and keep working exactly as they do today for any other caller; this adds one new combined entry point rather than removing or altering the individual ones."; "A failure at any one of the three stages (for example: dispatch not resolvable, or work-monitor finding a preservation blocker) is reported with the same field-level specificity the standalone command would give for that stage, not swallowed or genericized by the combination."; "No model or AI call is introduced anywhere in the combined path; it remains exactly as deterministic as the three calls it replaces."; "arcadia-go.SKILL.md's step 3 is rewritten to issue exactly one launcher call from the prepared worktree and paste its returned brief verbatim as the opening chat message, replacing the current three-call sequence (advance broker, work-monitor broker, pnpm arcadia next); step 4's standalone work-monitor guidance is removed or marked redundant accordingly."; "Deterministic tests cover: the combined success path returns all three results including the rendered brief text; a failure injected at each of the three stages individually is reported with that stage's exact failure; and the standalone advance/work-monitor/next commands are proven unaffected by the change."; "Preserve a runnable operator QA artifact showing the exact before/after command and round-trip count from a prepared worktree.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-combine-advance-monitor-next-into-one-brief-2026-09-24).

## 2026-09-24 — Completed arcadia/cut-managed-production-tick-cost

- **Did:** Completed Action arcadia/cut-managed-production-tick-cost from accepted evidence (Candidate c2eb23af76079761126d55a458006fde27e7545d).
- **Result:** Every declared acceptance criterion was accepted as met: "The per-tick managed-production iteration no longer re-walks and re-parses unchanged Project trees every tick (observed cost drops from ~85s to seconds in a profiled run, with a before/after measurement recorded as evidence), and per-Project detection semantics are unchanged."; "A determinism-failing base-branch observation such as the living-songbook one is logged once and retried only when its inputs could have changed, rather than every ~70s tick, with an existing named failure log line retained."; "pnpm test and the core, Discord, and Dashboard builds pass, and codex/claude launch, refusal, and reconciliation behavior is unchanged.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-cut-managed-production-tick-cost-2026-09-24).

## 2026-09-24 — Completed arcadia/detect-duplicate-ids-and-dangling-refs

- **Did:** Completed Action arcadia/detect-duplicate-ids-and-dangling-refs from accepted evidence (Candidate d45ac13a1426ea2150b8ec51836bc210b1611dee).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia docs sync refuses to create a Decision whose numeric id already exists in docs/decisions/ and reports the collision as a named validation issue, so a new duplicate 0004/0005 can no longer be written (fixes Issue #268)."; "arcadia docs sync detects and reports as a named validation issue any open review item whose sourceInput or docRef points at a document that does not exist on disk, reproducing R195's dangling reference to a non-existent 0053 document (fixes Issue #267)."; "Historical duplicate Decision ids are not renumbered by this Action: the migration choice (renumber the later duplicates versus make the slug the canonical handle) is recorded as an open Decision before any renumbering is applied, and R195's disposition (re-point or reject) is decided there."; "Deterministic tests cover the duplicate-id refusal and the dangling-reference detection, including a clean corpus that stays accepted; existing docs sync ingestion of well-formed documents is unchanged; pnpm test and the core, Discord, and Dashboard builds pass."; "The Action closes GitHub Issues #267 and #268 when it merges.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-detect-duplicate-ids-and-dangling-refs-2026-09-24b).

## 2026-09-24 — Completed arcadia/surface-terminal-operator-approvals-in-runs

- **Did:** Completed Action arcadia/surface-terminal-operator-approvals-in-runs from accepted evidence (Candidate 9e9c0be3597e4a869fda69e600f1790c1f19c96a).
- **Result:** Every declared acceptance criterion was accepted as met: "/runs lists every pending Agent Ask and other terminal operator-only approval that blocks managed production, while excluding mechanics agents may safely perform."; "Each queue item offers one minimal recommended action plus an expandable details view that states evidence, cost, consequence, alternatives, and what the canonical settlement will change."; "Choosing an option invokes the existing fingerprinted canonical settlement path, preserves approval boundaries, and records one durable receipt.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/generate-operator-scripts-for-runs-approvals immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-surface-terminal-operator-approvals-in-runs-2026-09-24-v3).

## 2026-09-24 — Completed arcadia/release-committed-admissions-on-session-end

- **Did:** Completed Action arcadia/release-committed-admissions-on-session-end from accepted evidence (Candidate 74e339b3b8986d9278af4f088a9134e71af45d7c).
- **Result:** Every declared acceptance criterion was accepted as met: "When a Session backed by a committed production admission is reconciled to any terminal outcome (accepted completion, incomplete-resumable exit, failure, or operator stop), its admission is released through the existing releaseAdmission writer in the same transaction as the reconciliation."; "countLiveAdmissions no longer counts a committed admission whose Session is terminal; already-leaked committed admissions on an existing workspace stop counting without a manual database edit."; "A deterministic test reproduces Issue #610: with maxConcurrentSessions 1, one Session launches, completes, and a second Action is then admitted on the next tick instead of being refused concurrency_limit."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #610.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-release-committed-admissions-on-session-end-2026-09-24).

## 2026-09-25 — Completed arcadia/gate-dispatch-on-blocking-operator-items

- **Did:** Completed Action arcadia/gate-dispatch-on-blocking-operator-items from accepted evidence (Candidate ab893d28fc9e13cf2278381ae414f3dfaa755c2b).
- **Result:** Every declared acceptance criterion was accepted as met: "One shared function classifies every pending operator-only item (unsettled Agent Ask proposals, open Decisions) as blocking or alert, reusing the exact data surface-terminal-operator-approvals-in-runs already built rather than re-deriving it."; "An item is blocking when it names, or its Decision's action: field names, an Action the current dispatch resolution would otherwise select, or when it is the reason no Action in the current queue segment is eligible; every other pending item is an alert."; "When one or more blocking items exist, arcadia go/advance/next refuses to hand off a dispatch brief for agent work and instead prints each blocking item's title, recommended option and consequence, and the exact command to settle it — matching the existing per-Action blocker/operatorQuestion contract, not a second one."; "When only alert items exist, dispatch proceeds normally and the resolution additionally lists each alert's title and one-line consequence, newest first, capped at a small fixed count with a count of any remainder."; "This one gate is shared by the CLI (go, advance, next), the dashboard's equivalent status calls, and the Discord bot's dispatch-brief posting — none of them re-implements its own copy."; "Regression tests cover: a blocking item suppresses dispatch and is named exactly; an alert-only state dispatches normally with the alert list attached; zero pending items adds neither section; an item blocking one Project does not suppress dispatch for an unrelated Project.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-gate-dispatch-on-blocking-operator-items-2026-09-24-v2).

## 2026-09-25 — Completed arcadia/withhold-worker-lifecycle-from-sessions

- **Did:** Completed Action arcadia/withhold-worker-lifecycle-from-sessions from accepted evidence (Candidate 395ae7b5b8b827e0201743200a0f1a7e3b9d9e8a).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia worker stop, start, restart and install refuse, with a named reason, when the caller descends from a managed coding-agent Session, determined by a non-forgeable host-side check (such as the Session's recorded process tree or tmux server) rather than caller environment variables or working directory."; "The operator's own terminal and the launchd agent can still run every worker command unchanged."; "A deterministic test proves the refusal from a Session process even after it clears its environment and changes directory to the host workspace, and proves the unchanged operator and launchd paths."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #611 together with name-failing-preservation-check-and-bound-retries or refs it if that Action has not merged.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-withhold-worker-lifecycle-from-sessions-2026-09-25).

## 2026-09-25 — Completed arcadia/stop-killing-busy-workers

- **Did:** Completed Action arcadia/stop-killing-busy-workers from accepted evidence (Candidate 77d7e778bf07b3f086d63e12a7c6f79b824152d8).
- **Result:** Every declared acceptance criterion was accepted as met: "Hung-worker recovery in arcadia worker start and stop is driven by a liveness signal that no synchronous tick step can starve (for example a beat from a separate thread or process), not by lengthening the heartbeat threshold alone."; "A deterministic test holds the worker inside a synchronous step for longer than 26s and proves start neither signals nor replaces it, and that stop sends only its ordinary SIGTERM and reports the worker mid-tick without escalating to SIGKILL; a worker that stops progressing entirely is still recovered by both."; "The 170s and 292s stalls recorded in Issue #617 are investigated and their cause recorded in the PR, or recorded as not reproducible with the evidence gathered."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #617.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-stop-killing-busy-workers-2026-09-25).

## 2026-09-25 — Agent Ask activate-mc-site-tooling-plan-2026-09-25

- **Did:** Activated give-the-mission-control-site-repository-currently-ungoverned-no-agents-md at onboard-mission-control-site-tooling.
- **Result:** Operator-settled Plan transition. Previous Plan bootstrap-managed-production-to-build-flight-deck remains draft with completion state preserved. The operator picked 'Activate the draft Plan' from the prior handoff picker. No Action content changes; this Ask exists only to carry the settle-time --activate flag against the already-created draft Plan.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-25 — Completed arcadia/onboard-mission-control-site-tooling

- **Did:** Completed Action arcadia/onboard-mission-control-site-tooling from accepted evidence (Candidate 66106aa751e02c461718d9f4dbd4fd501849164a).
- **Result:** Every declared acceptance criterion was accepted as met: "The mission-control-site repository is registered as its own Project in the existing shared martianrover Arcadia workspace, with no new workspace created."; "The repository has an AGENTS.md/CLAUDE.md pair wired the same way as the arcadia repository."; "PROJECT.md and a first plan are committed in the mission-control-site repository."; "A coding-agent session opened in the mission-control-site repository can run arcadia next and receive a dispatch brief.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-onboard-mission-control-site-tooling-2026-09-25).

## 2026-09-25 — Completed arcadia/place-session-naming-screenshot

- **Did:** Completed Action arcadia/place-session-naming-screenshot from accepted evidence (Candidate f0f490ad0802a28d3fc7763d6a553b943dc7523e).
- **Result:** Every declared acceptance criterion was accepted as met: "The image file is committed into the mission-control-site repository under a clearly named asset path (no third-party asset-service dependency)."; "It is referenced from an answers page with descriptive alt text and a caption naming the session-naming feature, tagged/categorized in that page's frontmatter or nearby content so its subject is discoverable."; "It renders correctly on the deployed Cloudflare staging URL.".
- **Next:** Plan complete; activated Plan agent-ask-execution-queue from the explicit queue at arcadia/make-a-natural-language-agent-ask-propose-the-concrete-canonical-effect-when-the.
- **Blockers:** None recorded by this settlement (Agent Ask complete-place-session-naming-screenshot-2026-09-25-v2).

## 2026-09-25 — Agent Ask reactivate-bootstrap-production-plan-2026-09-25

- **Did:** Activated bootstrap-managed-production-to-build-flight-deck at name-failing-preservation-check-and-bound-retries.
- **Result:** Operator-settled Plan transition. Previous Plan agent-ask-execution-queue remains draft with completion state preserved. Operator instruction 2026-09-25: arcadia go should choose only Actions on the critical path to automated production. activate-mc-site-tooling-plan-2026-09-25 returned this Plan to draft, and when that Plan finished, cross-Plan Go selected agent-ask-execution-queue, which is off the path. No Action content changes; this Ask carries the settle-time --activate flag, starting at name-failing-preservation-check-and-bound-retries.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-25 — Completed arcadia/preserve-candidates-across-base-advance

- **Did:** Completed Action arcadia/preserve-candidates-across-base-advance from accepted evidence (Candidate bf99dd992b1e6120563e2e4ad6f9dec800c5c5b8).
- **Result:** Every declared acceptance criterion was accepted as met: "Manual and protected preservation accept a candidate whose base branch advanced after preparation when the candidate still merges cleanly onto the new base, and refuse with a message naming the old base, the new base and the recovery when it does not."; "Preservation compares the candidate's Action definition against the Session's own dispatched Action, not resolveDispatch's pointer Action, so a non-pointer Session can be preserved."; "Deterministic tests cover a base that advanced cleanly (preserved), a conflicting advance (named refusal), and a non-pointer Action (preserved)."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #539.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-preserve-candidates-across-base-advance-2026-09-25).

## 2026-09-25 — Completed arcadia/make-a-natural-language-agent-ask-propose-the-concrete-canonical-effect-when-the

- **Did:** Completed Action arcadia/make-a-natural-language-agent-ask-propose-the-concrete-canonical-effect-when-the from accepted evidence (Candidate c441d9152903e08cea36b28103cb00ec3ad025c4).
- **Result:** Every declared acceptance criterion was accepted as met: "When natural text names an existing plan slug, Action id, or Decision id that resolves in the destination Project, the preview proposes the specific create or amend effect against that target rather than a bare interpretation effect."; "Resolution is deterministic and makes zero model calls; only exact identifiers already present in checked-in documents are matched, and no priority, date, dependency, approval, or Project ownership is inferred."; "When no identifier resolves, or more than one resolves ambiguously, the existing interpretation Decision path is preserved unchanged, and the receipt names the candidates it considered and rejected."; "A resolved proposal still requires operator acceptance and still opens a focused Decision whenever it would materially change Project ownership, acceptance criteria, authority, or queue position."; "Focused tests cover a resolved plan reference, a resolved Action reference, a resolved Decision reference, an unresolvable reference, an ambiguous reference, and byte-stable replay of each.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-natural-ask-target-resolution-2026-09-25-v3).

## 2026-09-25 — Completed arcadia/name-failing-preservation-check-and-bound-retries

- **Did:** Completed Action arcadia/name-failing-preservation-check-and-bound-retries from accepted evidence (Candidate 587877f182a5f8b3f7c3d99237315b8618622496).
- **Result:** Every declared acceptance criterion was accepted as met: "The 'Declared preservation validation failed or was skipped.' refusal returned by the preserve broker carries non-empty details naming each failing or skipped check, its command, and its exit status or skip reason."; "The preserve broker or Session controller, not only the Session brief, enforces a bounded number of identical preservation refusals per Session; when the limit is reached it records the refusal and the Session is reconciled as an incomplete exit."; "Deterministic tests cover a failing check (details name it), a skipped check (details name the skip reason), and a Session that reaches the identical-refusal limit and is recorded incomplete."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR refs Issue #611.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-name-failing-preservation-check-and-bound-retries-2026-09-25).

## 2026-09-25 — Completed arcadia/honor-policy-providers-at-launch

- **Did:** Completed Action arcadia/honor-policy-providers-at-launch from accepted evidence (Candidate 5562e6e3ae6ee7e625c6c53c792dd99ed3897bbd).
- **Result:** Every declared acceptance criterion was accepted as met: "While a standing production policy is active, every build-packet preparation path (work plan, ask, planning promotion) selects only among the policy scope.providers when a compliant permitted provider exists, and records why when none does."; "buildLaunchPreview reports a named prerequisite when the selected or packet-bound provider is not in the active policy scope.providers, naming the provider, the permitted list, and the remedy (re-grant or re-prepare the packet)."; "The managed-production tick logs a launch refusal with its named prerequisites instead of the generic not-ready message, and does not repeat an identical refusal line on every tick."; "Regression tests cover a packet bound to a forbidden provider, a permitted-provider packet preparation under an active policy, and the deduplicated refusal log.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-honor-policy-providers-at-launch-2026-09-25).

## 2026-09-25 — Completed arcadia/refuse-packets-without-validation-commands

- **Did:** Completed Action arcadia/refuse-packets-without-validation-commands from accepted evidence (Candidate 525bc9c1ccb584f4e8f2b65ebe4ecddaa8085689).
- **Result:** Every declared acceptance criterion was accepted as met: "Build-packet preparation refuses, naming the remedy arcadia project metadata <project> --validation-command <command>, when the Project's validation_commands list is empty."; "buildLaunchPreview reports the same condition as a named prerequisite, and the managed-production tick escalates it once through production_operator_escalations instead of launching."; "A deterministic test covers the empty-list refusal and an unchanged launch for a Project with declared commands."; "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #572.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-refuse-packets-without-validation-commands-2026-09-25-v2).

## 2026-09-25 — Completed arcadia/fix-decision-approve-missing-commit

- **Did:** Completed Action arcadia/fix-decision-approve-missing-commit from accepted evidence (Candidate 37e3f28af1dba783856003e337fa3791b49d715e).
- **Result:** Every declared acceptance criterion was accepted as met: "Answering a Decision with a plain (non-defer) effect via arcadia decision approve leaves the repository clean (no uncommitted changes) immediately after the command returns, with the Decision file change committed locally and not pushed."; "A test covers a plain-answer decision approve and asserts the working tree is clean after the command runs."; "The pull request that lands this fix includes Closes #645 in its body.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-decision-approve-missing-commit-2026-09-25).

## 2026-09-26 — Completed arcadia/resolve-cross-plan-dependency-ids

- **Did:** Completed Action arcadia/resolve-cross-plan-dependency-ids from accepted evidence (Candidate 11ce4586adae545515d8189c728db13ba272f929).
- **Result:** Every declared acceptance criterion was accepted as met: "canonicalOrder (src/scheduling/order.ts) resolves a depends_on id first within the same Plan, then across the same Project's Plans as plan/<slug>#<action-id>; an id that resolves to a done Action on the base branch is satisfied."; "A depends_on id that does not resolve to any known Action within the same Project produces a dependency_unresolved wait reason instead of being treated as satisfied, and the Action does not enter the ready set."; "Deterministic tests cover: a same-Plan dependency, a cross-Plan dependency, a dependency that lands after being unresolved on an earlier tick, and an id that never resolves; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-resolve-cross-plan-dependency-ids-2026-09-26-r2).

## 2026-09-26 — Completed arcadia/resolve-ambiguous-and-cross-project-dependency-ids

- **Did:** Completed Action arcadia/resolve-ambiguous-and-cross-project-dependency-ids from accepted evidence (Candidate 4257e6bc1404ee1d6f6bc197113e8acb33201fee).
- **Result:** Every declared acceptance criterion was accepted as met: "A depends_on id may name another Project; an id that resolves to more than one Action across Plans or Projects is reported as dependency_unresolved (ambiguous) and never resolved to either, in both collectUnmetDependencies (src/docs/dispatch.ts) and canonicalOrder (src/scheduling/order.ts)."; "The plan parser (src/docs/parse.ts) detects and reports a dependency cycle that spans Plans, not only one confined to a single Plan."; "An Action that stays dependency_unresolved for more than one worker tick is surfaced as an operator escalation (src/production/tick.ts) naming the unresolved id, instead of waiting silently."; "Deterministic tests cover: cross-Project resolution, an ambiguous id refused across Plans or Projects, a cross-Plan cycle detected and reported at parse time, and an unresolved dependency escalated after one tick; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-resolve-ambiguous-and-cross-project-dependency-ids-2026-09-26).

## 2026-09-26 — Completed arcadia/enforce-concurrency-gate-at-admission

- **Did:** Completed Action arcadia/enforce-concurrency-gate-at-admission from accepted evidence (Candidate 9094f1c616ea1fece16f8eb4fd4261f8872c0e5c).
- **Result:** Every declared acceptance criterion was accepted as met: "issueAdmission (src/production/policy.ts) caps effective concurrency at 1 on every admission, whatever maxConcurrentSessions the stored scope carries, unless plan/bootstrap-managed-production-to-build-flight-deck#prove-two-action-unattended-production and plan/bootstrap-managed-production-to-build-flight-deck#prove-concurrent-ready-set-admission are both done on the base branch; a refused admission names both ids."; "The check runs on every admission and names both Actions by Plan-qualified id, so reopening either Action restores the cap without deactivating the policy, and a later change of active Plan neither lifts nor permanently locks the gate."; "production preview and activate with --concurrency greater than 1 report the effective cap and its reason while the gate is closed, instead of silently recording a limit that will not be honoured."; "The only way to exceed the cap before both proofs are done is an explicit, expiring rehearsal exception on the operator-granted policy scope that names prove-concurrent-ready-set-admission; it lapses at its expiry or on deactivation, and nothing else lifts the cap."; "Deterministic tests cover: the cap holding for a stored scope above 1 while the gate is closed, including a scope written directly without passing through activation; the cap lifting once both Actions are done; the cap returning when one is reopened; and the rehearsal exception being honoured only before its expiry; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-enforce-concurrency-gate-at-admission-2026-09-26-v2).

## 2026-09-27 — Completed arcadia/rewire-dependents-on-split

- **Did:** Completed Action arcadia/rewire-dependents-on-split from accepted evidence (Candidate f670910d53356146ad081f0753ccf583f6f727ef).
- **Result:** Every declared acceptance criterion was accepted as met: "When a split settles (src/ask/settlement.ts), every Action whose depends_on names the split Action also gains the remainder Action ids, so no dependent becomes ready while any remainder is still open."; "Any readiness or gate check that requires a named Action to be done, including enforce-concurrency-gate-at-admission, also requires every remainder Action split from it to be done."; "Deterministic tests cover: a dependent that stays blocked after a split until its remainder is done, and the concurrency gate staying closed when one of its proof Actions is split with an open remainder; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-rewire-dependents-on-split-2026-09-27-v2).

## 2026-09-27 — Completed arcadia/fix-action-intent-target-ref-amendments

- **Did:** Completed Action arcadia/fix-action-intent-target-ref-amendments from accepted evidence (Candidate 7550b46b1874cb8d53fa8366a789427dcce65dbe).
- **Result:** Every declared acceptance criterion was accepted as met: "Settling an intent: action Ask with no envelope target_ref amends every child that carries target_ref: action/<id> and creates only children without one, in src/ask/settlement.ts, exactly as its draft preview reports."; "A child target_ref naming an Action that does not exist is refused at preview with a named reason, never settled as a creation."; "Deterministic tests cover a mixed bundle of amended and created children settling to the previewed effects, and the refused missing target; Closes #654; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-action-intent-target-ref-amendments-2026-09-27-v2).

## 2026-09-27 — Completed arcadia/release-admission-on-every-launch-failure

- **Did:** Completed Action arcadia/release-admission-on-every-launch-failure from accepted evidence (Candidate cd949a9594dcceef44eb933bdbc3b350aff62ce5).
- **Result:** Every declared acceptance criterion was accepted as met: "Every failure path in src/sessions/launch.ts after issueAdmission -- worktree preparation, prepareSession, tmux start, and the commitAdmission recheck -- calls releaseAdmission for that admission, not only the lease-race path."; "A crash between issue and commit leaves at most one uncommitted admission, which expires within the existing 30-second receipt TTL and is then not counted by countLiveAdmissions."; "Deterministic tests inject a failure at each path and show the live admission count back at its prior value immediately afterwards; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-release-admission-on-every-launch-failure-2026-09-27).

## 2026-09-27 — Completed arcadia/add-fixture-coding-agent-provider

- **Did:** Completed Action arcadia/add-fixture-coding-agent-provider from accepted evidence (Candidate 11b4451468264316fbae8c4d0cb9b20184e85ca5).
- **Result:** Every declared acceptance criterion was accepted as met: "A fixture provider launches through the same adapter, tmux and admission path as real providers, sleeps for a configured duration, edits one declared file in its candidate, and exits with a configured outcome (completed, failed, stalled with no output, or crashed)."; "The fixture provider is never selected automatically: production admits it only when the active policy scope names it in providers, and every receipt, Session and completion it produces is marked simulated so it can never be cited as live proof."; "Deterministic tests cover each configured outcome reaching the matching reconciliation result, and the refusal when the policy scope does not name the fixture provider; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-add-fixture-coding-agent-provider-2026-09-27).

## 2026-09-27 — Completed arcadia/tidy-quarantine-instead-of-delete

- **Did:** Completed Action arcadia/tidy-quarantine-instead-of-delete from accepted evidence (Candidate c00646d73654386bdbeade39671b464460787fd3).
- **Result:** Every declared acceptance criterion was accepted as met: "Branch retirement is one git update-ref --stdin transaction that verifies the tip, creates refs/arcadia/tidy/<run>/heads/<branch>, and deletes refs/heads/<branch>, with the branch reflog preserved; the git branch -d shortcut and new archive/tidy tags are no longer used."; "Worktree retirement pins HEAD under refs/arcadia/tidy/<run>/worktrees/<id>, then renames the worktree directory and its .git/worktrees/<id> admin directory into .git/arcadia-tidy/quarantine/<run>/, refusing (never copying) across filesystems."; "A missing worktree has its admin directory quarantined and HEAD pinned rather than being removed by git worktree prune, and tidy refuses when its path sits under an unmounted volume."; "arcadia tidy undo <run> restores the exact prior git worktree list, refs, and file trees including gitignored files, and a test proves it."; "A test proves gitignored files and a detached HEAD whose commits no ref contains both survive tidy --apply."; "START_HERE.md describes quarantine, undo, and the listing command.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-tidy-quarantine-instead-of-delete-2026-09-27).

## 2026-09-27 — Completed arcadia/tidy-harden-merge-and-liveness-verdicts

- **Did:** Completed Action arcadia/tidy-harden-merge-and-liveness-verdicts from accepted evidence (Candidate 7d9147c693cb3f7f727b2995502618a59a905702).
- **Result:** Every declared acceptance criterion was accepted as met: "The pull-request proof requires the local branch tip to be an ancestor of the PR headRefOid, ignores cross-repository PRs, and fails closed when headRefOid is not in the local object store."; "A worktree whose branch reflog holds only its creation entry, or that saw activity inside a configurable grace window, or that is the cwd of a live process, or that is git-worktree-locked, is reported protected."; "Under the apply interlock every branch is re-assessed with evaluateMerge and skipped if it is now checked out in any worktree."; "Regression tests cover branch-name reuse after merge, a fork PR name collision, a fresh desktop-agent worktree at the base tip, and a branch checked out between preview and apply.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-tidy-harden-merge-and-liveness-verdicts-2026-09-27).

## 2026-09-28 — Completed arcadia/tidy-journal-recovery-and-conservation-tests

- **Did:** Completed Action arcadia/tidy-journal-recovery-and-conservation-tests from accepted evidence (Candidate 000062bb5b144a328e9949eea9b9821af852cc03).
- **Result:** Every declared acceptance criterion was accepted as met: "Each quarantine step is written to an fsynced journal before it runs, and tidy startup rolls an interrupted run forward or back deterministically."; "A seeded generator of repository states (squash, rebase, detached HEADs, ignored files, missing directories, reused names, injected races) asserts that every reachable commit and every worktree file byte before tidy --apply is still reachable or quarantined after it."; "The same generator asserts that undo restores the exact prior state and that a second tidy --apply is a no-op.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-tidy-journal-recovery-and-conservation-tests-2026-09-28).

## 2026-09-28 — Agent Ask pr-opened-arcadia-pr750

- **Did:** Shipped! Every future Arcadia PR now gets a Discord shout the moment it opens, and again the moment it truly needs your call: https://github.com/pmark/arcadia/pull/750
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-28 — Agent Ask pr-opened-arcadia-pr751

- **Did:** The Way now says it out loud: "Nothing is ever lost" joined the Constitution and AGENTS.md as the principle beneath defect capture, deferral triggers, and settle-before-push. Constitution change, so this one is yours to merge: https://github.com/pmark/arcadia/pull/751
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-28 — Agent Ask pr-ready-arcadia-pr750-approval-boundary-2026-09-27

- **Did:** Ready for your call: PR 750 adds the standing rule authorizing these very Discord PR pings, so it counts as changing agent authority -- Merge on green wont touch it. CodeRabbit approved, all checks green. https://github.com/pmark/arcadia/pull/750
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-28 — Agent Ask pr-ready-arcadia-pr751-constitution-change-2026-09-27

- **Did:** Ready for you: PR 751 adds "Nothing is ever lost" to the Constitution and the Way. CodeRabbit approved, all 8 checks green, and it is yours to merge because it touches the Constitution. One open call is folded in: CodeRabbit questioned whether the Constitution bullet meets Decision 0020's admission test; keep it as written, or ask to drop it to Way practice only. Merge button is near the bottom of the Conversation tab: https://github.com/pmark/arcadia/pull/751
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-28 — Completed arcadia/load-test-workspace-db-contention

- **Did:** Completed Action arcadia/load-test-workspace-db-contention from accepted evidence (Candidate 70153e206286778a66712204e0b5a2d342892caa).
- **Result:** Every declared acceptance criterion was accepted as met: "A repeatable test starts at least eight separate processes against one WAL workspace database, each running production admission issue/commit/release, Action claim reserve/release, and settlement-sized write transactions in a loop."; "The test reports surfaced SQLITE_BUSY errors, the longest write-lock wait, and the longest single write transaction; it passes only with zero surfaced errors and a longest wait under the busy_timeout set in src/db/connection.ts."; "The measured writer count and waits are recorded in docs/production-scheduling.md as the tested basis for maxConcurrentSessions; any write transaction that holds the lock across a git or filesystem call is named and filed as a bug Issue; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-load-test-workspace-db-contention-2026-09-28).

## 2026-09-28 — Agent Ask pr-opened-arcadia-pr758

- **Did:** Load-tested the workspace DB with 8-32 concurrent writer processes: zero SQLITE_BUSY, worst lock wait 394 ms vs a 15 s timeout, so maxConcurrentSessions now has a measured basis — https://github.com/pmark/arcadia/pull/758
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/fix-rehearsal-fixture-validation-command

- **Did:** Completed Action arcadia/fix-rehearsal-fixture-validation-command from accepted evidence (Candidate b9ea24c5fad60a9cc0e25d7f9c5b45d1eed3e1d5).
- **Result:** Every declared acceptance criterion was accepted as met: "#726: The v5 fixture declares scripts/check-marker.mjs (committed at genesis) as its validation command instead of a file that does not exist yet for Action A.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-rehearsal-fixture-validation-command-2026-09-29).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr762

- **Did:** Closed out the rehearsal-fixture validation-command defect (#726): the v5 fixture already ships a check that can pass for both Actions, so the pointer moves on to unattended Claude launch — https://github.com/pmark/arcadia/pull/762
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/enable-unattended-claude-session-launch

- **Did:** Completed Action arcadia/enable-unattended-claude-session-launch from accepted evidence (Candidate 43eb17b26ceb053d28d43b27e5aef06c87e71a04).
- **Result:** Every declared acceptance criterion was accepted as met: "#727: A Claude Session launched by the worker runs non-interactively and exits on its own, with no approval bypass."; "#698: go-broker install pre-trusts Claude Code's global worktree root so a fresh Session never hits the interactive 'trust this folder' dialog.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-enable-unattended-claude-session-launch-2026-09-28).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr764

- **Did:** Unattended Claude Sessions now launch headless with --print and the global worktree root is pre-trusted — no more hung trust dialogs: https://github.com/pmark/arcadia/pull/764
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Agent Ask pr-ready-arcadia-pr764-permission-posture-2026-09-28

- **Did:** PR 764 is green and CodeRabbit-approved, but it sets unattended Claude Sessions to run with acceptEdits, so the permission posture is your call before it merges: https://github.com/pmark/arcadia/pull/764 (merge button is near the bottom of the Conversation tab).
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/keep-action-claim-while-candidate-unmerged

- **Did:** Completed Action arcadia/keep-action-claim-while-candidate-unmerged from accepted evidence (Candidate c57bbf352a79cf3aa9ca2ff27d976ea8ba8ffc55).
- **Result:** Every declared acceptance criterion was accepted as met: "An Action claim whose worktree reservation (AGENT_WORKTREE_RESERVATION_MS, src/sessions/index.ts) has passed its 24-hour window is kept while its candidate branch or pull request is unmerged, and is released when the candidate merges or is explicitly abandoned."; "Both launch paths (launchGuardedHostSession and arcadia go) refuse to dispatch an Action whose claim is held this way, and name the unmerged candidate."; "Deterministic tests cover a claim older than 24 hours with an unmerged candidate refusing re-dispatch, and releasing once the candidate merges; Closes #549; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-keep-action-claim-while-candidate-unmerged-2026-09-28).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr769

- **Did:** PR #769 is up: an Action claim now holds past 24 hours while its candidate PR is unmerged, so neither arcadia go nor production can dispatch the same Action twice (Closes #549). https://github.com/pmark/arcadia/pull/769
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/harden-agent-ask-settlement-races-and-state

- **Did:** Completed Action arcadia/harden-agent-ask-settlement-races-and-state from accepted evidence (Candidate f414d243a45b92ce7478cb2f871e41c8a1a0ecb6).
- **Result:** Every declared acceptance criterion was accepted as met: "#296: settle --revision only hard-fails on genuinely stale input, matching what --preview's fingerprint already reported."; "#304: agent-ask draft refuses to produce a completion Ask that is un-applicable at its own recorded candidate_revision."; "#320: decision approve --dry-run replay of an applied deferral receipt is covered by a test and behaves correctly."; "#321: An archived complete Ask's candidate_revision matches what the Mission Log records, not the settle commit."; "#505: applyDecisionDeferral writes the pointer pair under a lock or compare-and-set so it cannot clobber a concurrent write."; "#507: arcadia action settle prints the correct Next action under concurrent settlement."; "#512: agent-ask settle --apply's auto-commit succeeds because it no longer stages its own gitignored archive file."; "#592: agent-ask draft does not report an already-settled .arcadia/asks file as an auto-discover failure."; "#598: agent-ask settle bumps a Plan's updated date when it amends that Plan."; "#609: production activate's --expect-revision flag matches preview's expectedRevision field name."; "#639: attemptSettleOneDraft only refreshes a stale candidate_revision when the refreshed evidence still verbatim-covers every criterion, not by ancestry alone."; "#663: review approve --no-execute routes the packet's sourceInput correctly instead of through the general intent classifier.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-harden-agent-ask-settlement-races-and-state-2026-09-28).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr770

- **Did:** Twelve Agent Ask settlement bugs squashed in one go: stale-revision refusals, unlocked deferral writes, wrong Next action, ignored-archive commit failures and more are fixed in https://github.com/pmark/arcadia/pull/770
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/harden-dispatch-and-claim-lifecycle

- **Did:** Completed Action arcadia/harden-dispatch-and-claim-lifecycle from accepted evidence (Candidate b001ee3df011e3683b97df48adfdf22c4fa96ae8).
- **Result:** Every declared acceptance criterion was accepted as met: "#459: go's refusal message's allowedPrefixes list includes opencode/, matching what SAFE_TASK_BRANCH actually allows."; "#464: selectCompliantCodingAgent's capacityRefusals parameter receives capacity refusals, not launch-adapter refusals."; "#494: resolveDispatch reports an Action with status: blocked as not dispatchable, matching the ready set and scheduler."; "#549: An Action claim does not expire at 24h while its candidate is still unmerged, so arcadia go cannot re-dispatch a live Action."; "#621: arcadia go's worktree-preparation branching is gated by the same resolveOperatorGate classification as launch, so it never prepares a worktree for an Action a pending operator item blocks."; "#625: An Action claim (agent_worktree_reservations) is released once its worktree no longer exists, instead of outliving it and refusing dispatch."; "#733: An Action claim is released once the claiming worktree's PR is confirmed merged (landed)."; "#608: Base-branch-advance does not silently revert a manual git reset on a DB-active Project.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-harden-dispatch-and-claim-lifecycle-2026-09-28).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr771

- **Did:** PR #771 is up: stale Action claims now release themselves when their worktree vanishes or their PR merges, go refuses to prepare gated worktrees, and the worker stops silently undoing your manual resets. https://github.com/pmark/arcadia/pull/771
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/improve-agent-ask-settle-usability

- **Did:** Completed Action arcadia/improve-agent-ask-settle-usability from accepted evidence (Candidate e9c41b1d90e4e7cda3067d2a65d0dc7ec271fef1).
- **Result:** Every declared acceptance criterion was accepted as met: "#718: agent-ask settle's documentation or error output shows a combined usage example covering the required flag combination and preview-fingerprint requirement."; "#722: split settlement chooses its next_action pointer after the compare-and-set retry, not before, so it cannot reflect a stale dependent set.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-improve-agent-ask-settle-usability-2026-09-29).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr772

- **Did:** Opened a PR that makes agent-ask settle self-explaining and fixes split settlement picking a stale next pointer: https://github.com/pmark/arcadia/pull/772
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/soak-rehearsal-harness-until-clean

- **Did:** Completed Action arcadia/soak-rehearsal-harness-until-clean from accepted evidence (Candidate 83470e71c8154ef2b90bc6676125e4a27150141b).
- **Result:** Every declared acceptance criterion was accepted as met: "A single documented command runs tests/rehearsal-two-action.test.ts repeatedly against a freshly prepared fixture each iteration, and refuses to start when the fixture shows leftover repair budget, stale handoffs, live claims or a reused request_id."; "The loop stops on any of: N consecutive clean iterations (default 5), a configured iteration or token budget, or the same failure recurring after three fix attempts; each stop reason is printed and recorded."; "Every failing iteration files or updates one bug Issue in the owning repository with evidence and file:line, and only a failure that blocks the loop becomes a fix; non-blocking failures stay Issues."; "The loop never merges a change to the concurrency gate, admission policy or approval boundaries; such a fix is left as an open pull request for the operator."; "Deterministic tests cover the clean-fixture refusal, each stop condition, and the gate-file merge refusal; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-soak-rehearsal-harness-until-clean-2026-09-29).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr804

- **Did:** A bounded soak loop for the hermetic rehearsal harness just landed in a PR: it stops on clean streaks, budgets or repeat failures and files one Issue per failing iteration. https://github.com/pmark/arcadia/pull/804
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/stabilize-test-and-build-infra

- **Did:** Completed Action arcadia/stabilize-test-and-build-infra from accepted evidence (Candidate 905db62e240b334ac7e289c831daf61d0b9bb763).
- **Result:** Every declared acceptance criterion was accepted as met: "#452: pnpm test does not flake into 30s timeouts on CLI/discord subprocess tests under file parallelism."; "#480: eslint's type-aware rules do not report false positives in a prepared worktree that are absent on the main checkout."; "#514: The packageBoundary beforeAll build completes within vitest's 10s hook timeout on a clean checkout."; "#557: Preservation check binding resolves dotted local Python submodule imports.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-stabilize-test-and-build-infra-2026-09-29).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr805

- **Did:** PR opened: test timeouts stabilized and dotted Python imports now bound in preservation checks - https://github.com/pmark/arcadia/pull/805
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/fix-worker-and-dashboard-operational-bugs

- **Did:** Completed Action arcadia/fix-worker-and-dashboard-operational-bugs from accepted evidence (Candidate 3472f047d41cc73c8095f4e84c9ed8df796df883).
- **Result:** Every declared acceptance criterion was accepted as met: "#392: The dashboard's production toggle does not re-derive scope.actions on reactivation."; "#430: services.sh restart does not tear down all services when a single 2s health probe times out."; "#450: The recovery script does not report failure before worker transports are actually ready."; "#560: Worker install tests do not write to the real ~/Library/LaunchAgents/com.arcadia.worker.plist."; "#569: add-arcadia-push-field-to-board.sh does not write a pnpm warning line into schedule-status.json."; "#582: The dashboard /runs page reports the worker's actual running/stopped state, matching the real pidfile format.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-worker-and-dashboard-operational-bugs-2026-09-29).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr807

- **Did:** Six operational bugs (production reactivation scope, restart retry, recovery readiness, install-test isolation, schedule JSON, /runs worker state) are fixed and up for review: https://github.com/pmark/arcadia/pull/807
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/prove-contract-20-completion-gate

- **Did:** Completed Action arcadia/prove-contract-20-completion-gate from accepted evidence (Candidate 1f28e68fe5755e79e4ede4307b34ff5129e8d8cc).
- **Result:** Every declared acceptance criterion was accepted as met: "#555: Contract-20's false-agent-completion quality gate is proven by a test, with an owning Action recorded.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prove-contract-20-completion-gate-2026-09-29).

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr810

- **Did:** Contract-20 false-agent-completion gate now has a proving test and an owner, closing #555: https://github.com/pmark/arcadia/pull/810
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Agent Ask pr-opened-arcadia-pr812

- **Did:** Session signal catalog and pure classifier are up for review: Arcadia can now tell a rate limit, login failure or approval prompt from a real stall. https://github.com/pmark/arcadia/pull/812
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-29 — Completed arcadia/session-signal-catalog-and-classifier

- **Did:** Completed Action arcadia/session-signal-catalog-and-classifier from accepted evidence (Candidate cb80d8a4fc29d5fde69063780d3916e8735628db).
- **Result:** Every declared acceptance criterion was accepted as met: "A regex catalog recognizes provider rate/usage limits, auth or scope failures, permission prompts, sandbox denials, context exhaustion, and repeated-command loops from pane text."; "A pure classifier combines process, pane, git, Run, preservation, drafted-Ask, PR and claim signals into one state from a documented closed set, each state mapped to one action."; "The classifier documents an explicit precedence order for overlapping signals, so a provider limit, auth failure, or permission prompt is never classified as a stall when pane or process signals also overlap.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/replay-real-pane-transcripts-through-classifier immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-session-signal-catalog-and-classifier-2026-09-29).

## 2026-09-30 — Completed arcadia/raise-red-alert-on-stop-the-line-failures

- **Did:** Completed Action arcadia/raise-red-alert-on-stop-the-line-failures from accepted evidence (Candidate fc8ddd4f30db64804f3fa35b3f26fd6112d78597).
- **Result:** Every declared acceptance criterion was accepted as met: "docs/arcadia-semantics.md defines a red alert as a managed-production failure that meets the Stop the line test, and lists the triggers: an admission refused on consecutive ticks, a Session past its stall window, a failed reconcile, and a failure repeating after the repair budget."; "The worker tick detects each trigger with no model call and records one red alert per distinct failure, with the Project, Action, Session id, trigger, first-seen time, and the log or artifact path that shows the cause; a repeat of the same failure updates the alert instead of creating another."; "Each new red alert posts once to the configured notification channel with its request id, the Action, the trigger and a link to the evidence, and production status lists open red alerts before every other section."; "Deterministic tests cover each trigger raising exactly one alert, a repeat updating it, and an alert clearing when the failure resolves; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-raise-red-alert-on-stop-the-line-failures-2026-09-29).

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr815

- **Did:** Red alerts are coming: the worker tick now raises one deduplicated alert with evidence when production hits a stop-the-line failure. https://github.com/pmark/arcadia/pull/815
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Completed arcadia/diagnose-red-alerts-and-propose-the-fix

- **Did:** Completed Action arcadia/diagnose-red-alerts-and-propose-the-fix from accepted evidence (Candidate e98f28a4fc132121e07241dfc0966d5582141e12).
- **Result:** Every declared acceptance criterion was accepted as met: "An open red alert starts at most one bounded diagnosis with a declared token budget, which reads the alert evidence, files or updates one bug Issue with file:line evidence, and records a proposed fix Action through an Agent Ask."; "A diagnosis whose fix touches the concurrency gate, admission policy, approval boundaries or credentials stops at an open pull request for the operator and is never merged automatically."; "A diagnosis that exceeds its budget or finds no cause records that fact on the alert and leaves it open and visible; it does not retry."; "Deterministic tests cover the single-diagnosis limit, the budget stop, and the safety-gate refusal; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-diagnose-red-alerts-and-propose-the-fix-2026-09-29).

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr816

- **Did:** Red alerts can now get one bounded, budget-capped diagnosis that files the Issue and drafts the fix Action (off by default, so no model spend until you flip the flag): https://github.com/pmark/arcadia/pull/816
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Completed arcadia/prove-red-alert-with-injected-failures

- **Did:** Completed Action arcadia/prove-red-alert-with-injected-failures from accepted evidence (Candidate 0d52080596eb239bce374dcc7236c81495a97015).
- **Result:** Every declared acceptance criterion was accepted as met: "tests/rehearsal-two-action.test.ts or a sibling suite injects a stalled Session, a refused admission on consecutive ticks and a failed reconcile through tests/helpers/rehearsalHarness.ts, and asserts each raises its red alert with evidence."; "The suite asserts the alert posts one notification and starts one bounded diagnosis, and that resolving the failure clears the alert."; "The suite runs in the standard pnpm test run with no live production grant and no network; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prove-red-alert-with-injected-failures-2026-09-29).

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr817

- **Did:** Red alerts now have an end-to-end proof: stalled Sessions, refused admissions and failed reconciles are injected into the rehearsal harness, each raising one alert, one notification and one bounded diagnosis, then clearing. https://github.com/pmark/arcadia/pull/817
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr818

- **Did:** A Decision PR is open to revive prove-two-action-unattended-production now that the codex-cli v5 rehearsal ran both Actions unattended: https://github.com/pmark/arcadia/pull/818
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Completed arcadia/fix-docs-sync-paused-project-handling

- **Did:** Completed Action arcadia/fix-docs-sync-paused-project-handling from accepted evidence (Candidate 8fce4896a14e0a11def405839718c310b3c078ee).
- **Result:** Every declared acceptance criterion was accepted as met: "#298: Agent Ask v1 can set a Project's status, so pausing/reactivating no longer requires a hand edit of PROJECT.md."; "#299: docs sync --all has a defined, tested scope for whether it ingests paused Projects."; "#300: Ask routing (resolveProjectReference / resolveProjectContextFromRequest) does not resolve a paused Project."; "#455: arcadia docs sync no longer silently omits documents whose frontmatter declares an unrecognized type; it reports them."; "#662: docs sync --project cannot mutate another project's work_item when a plan slug and action id collide.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-docs-sync-paused-project-handling-2026-09-30).

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr821

- **Did:** The phone dashboard redesign now has a mapped architecture and a three-slice governed draft, with Flight Deck kept standalone: https://github.com/pmark/arcadia/pull/821
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Agent Ask pr-ready-arcadia-pr821-plan-acceptance-2026-09-29

- **Did:** The phone dashboard architecture passed CodeRabbit and CI; it carries Decision 0077 and needs your merge and separate draft-Plan acceptance. The bounded acceptance button is available on Runs: https://github.com/pmark/arcadia/pull/821
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr824

- **Did:** Your approved phone dashboard Plan is now recorded after recovering the stale-preview refusal; the three build slices remain inactive: https://github.com/pmark/arcadia/pull/824
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Agent Ask keep-provider-cap-before-dashboard-2026-09-30

- **Did:** Record the operator's priority choice: keep bootstrap-managed-production-to-build-flight-deck active and finish limit-sessions-per-provider-account first; the accepted three-slice phone dashboard Plan remains inactive. Reconsider dashboard activation after that Action is complete, through an explicit governed choice; do not auto-activate or reorder the queue.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Completed arcadia/fix-auto-settle-eligibility-docs

- **Did:** Completed Action arcadia/fix-auto-settle-eligibility-docs from accepted evidence (Candidate fdc78d990e704e5021f0eccb9bccc759cbc9f7b9).
- **Result:** Every declared acceptance criterion was accepted as met: "#640: docs/agents-context.md's auto-settle eligibility text states the per-criterion met requirement the code actually enforces."; "#641: docs/agents-context.md states the exact settle invocation for the no-workspace draft-only case.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-auto-settle-eligibility-docs-2026-09-30-v2).

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr832

- **Did:** PR #832 adds one deterministic Plan-amendment runner with pinned scope, fresh preview validation, durable recovery, and hermetic proof: https://github.com/pmark/arcadia/pull/832
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr838

- **Did:** Plan-amendment buttons now have mandatory runner instructions, CI checks and runtime bypass guards. Review https://github.com/pmark/arcadia/pull/838.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Completed arcadia/close-ask-traceability-and-cli-portability-gaps

- **Did:** Completed Action arcadia/close-ask-traceability-and-cli-portability-gaps from accepted evidence (Candidate 443687912550e6934109ecc5cbe5d1209c6f9d49).
- **Result:** Every declared acceptance criterion was accepted as met: "#591: Every resulting Ask record carries its originating capture_id."; "#591: arcadia ask show <capture_…|request id> maps a capture or request to the Ask, back-burner item, or Action it produced."; "#591: The dashboard exposes a receipt link for each capture-to-result trace."; "#591: Objective tests cover capture_id propagation, capture/request lookup, dashboard receipt links, and every resulting record type."; "#716: The arcadia-go skill’s node_modules bridge step works on a target repo that is not Arcadia’s own monorepo.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-close-ask-traceability-and-cli-portability-gaps-v5-2026-09-30).

## 2026-09-30 — Completed arcadia/harden-tidy-quarantine-safety-and-docs

- **Did:** Completed Action arcadia/harden-tidy-quarantine-safety-and-docs from accepted evidence (Candidate 2cb1b97a7406fc40ab5961aad15d8daeed3b6906).
- **Result:** Every declared acceptance criterion was accepted as met: "#735: START_HERE.md states that current tidy quarantines branch refs under refs/arcadia/tidy/<run>/heads/<branch> and restores them with arcadia tidy undo <run>; it does not describe archive/<branch> as an active recovery path."; "#739: tidy does not retire a live non-Arcadia agent worktree that has not committed yet."; "#740: tidy --apply does not retire branches on preview-time verdicts, and never runs update-ref -d on a branch checked out in another worktree.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-harden-tidy-quarantine-safety-and-docs-2026-09-30).

## 2026-09-30 — Agent Ask pr-opened-arcadia-pr843

- **Did:** Grant descriptor contract and /runs badge are preserved for review in https://github.com/pmark/arcadia/pull/843; the current Plan criterion needs an operator-approved scope amendment before completion.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-09-30 — Agent Ask record-production-only-priority-2026-09-30

- **Did:** Record the operator's explicit production-only priority on 2026-09-30: focus exclusively on autonomous production and blockers to it. Keep bootstrap-managed-production-to-build-flight-deck active and prove-two-action-unattended-production as the current Action; keep the accepted dashboard redesign Plan inactive. The immediate proof is the v6 same-candidate Session continuation and Off/worker-restart observation, with receipts and acceptance evidence. This priority selection grants no new production activation, Session termination, service restart, concurrency increase, or completion authority. Issue #844 records the unsupported Agent Ask deferral path and the intended account-cap reactivation trigger (before authorizing unattended concurrency above one Session); the cap remains open, not canonically deferred. Reconsider dashboard activation only on a later explicit operator direction.

## 2026-09-30 — Completed arcadia/define-grant-operator-action-pattern

- **Did:** Completed Action arcadia/define-grant-operator-action-pattern from accepted evidence (Candidate bd65e8c4b00c651b918e7836803d9b0bf5af4d86).
- **Result:** Every declared acceptance criterion was accepted as met: "docs/arcadia-semantics.md defines Grant as a one-shot operator action that delegates bounded authority, and states what every Grant must do: pin the policy revision it was built against, cover a named scope only, carry an expiry, refuse on any precondition drift, and record a receipt."; "The arcadia-operator-script-v1 descriptor contract accepts an optional kind field with the value grant; descriptors without it keep listing exactly as before, and a test proves both."; "AGENTS.md operator-step guidance (via docs/agents-context.md and regeneration) tells agents to tag an authority-delegating script as kind grant and points at the semantics definition."; "The existing grant-production-two-action-v6-remaining-stages-2026-09-30 descriptor is tagged kind grant and /runs shows its Grant tag; neither absent v5 nor regrant descriptor is recreated or changed; pnpm test and the core, Discord and Dashboard builds pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-define-grant-operator-action-pattern-2026-09-30).

## 2026-10-01 — Agent Ask pr-opened-arcadia-pr858

- **Did:** PR #858 now bounds protected preservation and retains exact-stage failure evidence; the restricted browser-audit route still needs its boundary Decision: https://github.com/pmark/arcadia/pull/858
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-01 — Agent Ask pr-ready-arcadia-pr858-approval-boundary-2026-10-01

- **Did:** PR #858 has passed protected-preservation fixture proof and CI; review its inherited operator transition and choose the restricted browser-audit boundary before further work: https://github.com/pmark/arcadia/pull/858
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-01 — Agent Ask pr-opened-arcadia-pr863

- **Did:** PR #863 prepares isolated mobile/desktop host audit fixtures with retained denial and timeout proof; review and the explicit preparation answer remain gated: https://github.com/pmark/arcadia/pull/863
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-01 — Agent Ask pr-ready-arcadia-pr863-decision-answer-2026-10-01

- **Did:** PR #863 has packaged fixture proof, 13 focused tests and CodeRabbit approval on 98cbe0d3. Decision 0078 still needs the exact operator preparation answer; latest-head CI remains unscheduled even after reopening the same PR: https://github.com/pmark/arcadia/pull/863
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-01 — Completed arcadia/prove-two-action-unattended-production

- **Did:** Completed Action arcadia/prove-two-action-unattended-production from accepted evidence (Candidate 1f7d4a6a57111844e9a8173235142fd95d0e6970).
- **Result:** Every declared acceptance criterion was accepted as met: "Provide a disposable or explicitly approved real Project with two small dependent Actions and a reachable existing production control (CLI or dashboard) before requesting live execution."; "Under bounded rehearsal authority activate once: Action A launches, validates, records canonical completion/pointer, and B launches without manual session setup or launch confirmation in between."; "Complete this vertical proof before broad rail, capture, navigation polish or default-home cutover; reuse existing review/proof specialists as needed.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/finish-two-action-unattended-production-proof immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-v6-two-action-proof-supported-criteria-2026-10-01).

## 2026-10-01 — Agent Ask pr-opened-arcadia-pr865

- **Did:** PR #865 opens the governed terminal recovery: a completed candidate can resume its exact fast-forward after an interrupted handoff while production remains Off. https://github.com/pmark/arcadia/pull/865
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-01 — Agent Ask correct-pr-opened-arcadia-pr865-off-gate-2026-10-01

- **Did:** Correct the PR #865 opening log: terminal recovery preserves the completed candidate while production is Off; its fast-forward resumes only after a current Active policy and exact in-scope, unexpired integration Grant authorize it. https://github.com/pmark/arcadia/pull/865
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-01 — Completed arcadia/recover-terminal-integration-after-reconcile

- **Did:** Completed Action arcadia/recover-terminal-integration-after-reconcile from accepted evidence (Candidate 1274e73c576c0565c9ff1979d50d2f303287b312).
- **Result:** Every declared acceptance criterion was accepted as met: "A later worker tick rediscovers a canonically completed, validated and preserved terminal candidate after an injected integration failure, integrates its unchanged settlement HEAD through the existing fast-forward path exactly once, and launches no replacement coding Session."; "Production Off, expired or drifted exact Grant or scope, missing validation or preservation, changed candidate HEAD or branch, and divergent base each refuse integration while preserving a recoverable handoff receipt."; "Focused fault and refusal tests pass, followed by the required full test and build checks; the reviewed change states the installed revision and remaining live-proof boundary.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-recover-terminal-integration-after-reconcile-2026-10-01).

## 2026-10-01 — Agent Ask pr-opened-arcadia-pr866

- **Did:** PR #866 opens the governed repair for the v6 candidate completed while production was Off: after separate exact approval, host validation and preservation can precede its existing integration path. https://github.com/pmark/arcadia/pull/866
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-01 — Completed arcadia/recover-off-completed-candidate-preservation

- **Did:** Completed Action arcadia/recover-off-completed-candidate-preservation from accepted evidence (Candidate eb959d54d66063580f402aded406225f61d888e0).
- **Result:** Every declared acceptance criterion was accepted as met: "A later worker tick, under a fresh exact Active policy and integration Grant, validates and preserves the unchanged completed v6-style candidate whose prior Off state withheld preservation, then integrates its settlement HEAD exactly once without another coding Session."; "Off, expired or drifted exact authority, missing accepted completion or passing validation, changed candidate HEAD or branch, conflicting live lease, and divergent base each refuse before integration and leave the candidate and canonical receipts recoverable."; "Focused fault and refusal tests pass, followed by the required full test and build checks; the reviewed change identifies its installed revision, the v6 live-proof boundary and the separate operator approval needed for a fresh Grant.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-off-terminal-preservation-recovery-2026-10-01).

## 2026-10-01 — Agent Ask pr-opened-arcadia-pr868

- **Did:** The installed terminal recovery is now canonically settled, and PR #868 carries its readiness record and the exact remaining v6 live-proof boundary: https://github.com/pmark/arcadia/pull/868
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-02 — Agent Ask pr-opened-arcadia-pr869

- **Did:** 🧭 Drafted the Flight Deck execution-tree Plan (Selected vs Running vs Needs-you, three Actions, nothing runs until you approve) plus Decision 0079 on pointer-vs-running: https://github.com/pmark/arcadia/pull/869
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-02 — Agent Ask pr-ready-arcadia-pr869-decision-answer-2026-10-01

- **Did:** 🟢 Flight Deck tree Plan is CodeRabbit-approved and green — it needs your answer on Decision 0079 (Selected vs Running indicators) and your merge; nothing runs until you approve the Plan: https://github.com/pmark/arcadia/pull/869
- **Result:** Recorded the accepted Agent Ask as Project history.
## 2026-10-02 — Completed arcadia/finish-two-action-unattended-production-proof

- **Did:** Completed Action arcadia/finish-two-action-unattended-production-proof from accepted evidence (Candidate 959550f5ff90ac8d9baa9850302def294893abb9).
- **Result:** Every declared acceptance criterion was accepted as met: "Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/prove-literal-split-browser-and-ledger immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-v6-b-recovery-evidenced-slice-2026-10-01).

## 2026-10-02 — Agent Ask pr-ready-arcadia-pr873-scoped-container-decision-2026-10-02

- **Did:** The bounded Docker route passes real synthetic Lighthouse, denials, containment and immutable-authority proof in PR #873; CodeRabbit approved code revision 7a304cc1 and all CI passed. Please merge the preparation PR, then separately decide whether to authorize Decision 0079’s one preserved-baseline audit; the route remains inactive and PPN/production untouched. https://github.com/pmark/arcadia/pull/873
- **Result:** Records Issue #847 evidence and its proposed named-profile wording reconciliation through open Decision 0079. The retained receipts and exact scope are concrete; this notification grants no approval or activation. The protected preservation launcher refused the inherited worktree because no active Session or manual handoff registers it; the reviewed branch is pushed and that refusal is retained in the report.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-02 — Agent Ask pr-ready-arcadia-pr873-review-cap-2026-10-02

- **Did:** The Docker route passes real synthetic proof and 52 focused tests, but PR #873 is blocked at CodeRabbit’s three-round cap. Choose the one-shot /runs action “Authorize one additional bounded #847 review pass” to withdraw stale scope previews and finish current-host review; merging, activation, PPN audits and production remain gated. https://github.com/pmark/arcadia/pull/873
- **Result:** Records the precise operator question required by the review cap, not consent to another pass. Stale Ask inputs are tracked in #875; the fixed-host socket portability finding is left for operator judgment. The protected preservation launcher also refuses this unregistered inherited worktree; the branch and proof are retained remotely.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-02 — Agent Ask pr-opened-arcadia-pr882

- **Did:** Compact Way startup and indexed delivery guards are ready for review in https://github.com/pmark/arcadia/pull/882; fresh native-agent acceptance traces remain outstanding.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-02 — Agent Ask pr-ready-arcadia-pr882-fresh-agent-qa-2026-10-02

- **Did:** PR #882 has compact Way startup and validated delivery guards; the remaining fresh Codex/Claude QA needs explicit launch/profile authorization, and CodeRabbit approval is rate limited: https://github.com/pmark/arcadia/pull/882
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-02 — Completed arcadia/repair-manual-preservation-snapshot-identity

- **Did:** Completed Action arcadia/repair-manual-preservation-snapshot-identity from accepted evidence (Candidate d45b2fb922438d3cca3bc00f7b305a05838ee037).
- **Result:** Every declared acceptance criterion was accepted as met: "The fixed no-argument protected preservation launcher successfully captures an initial manual candidate, then captures a revised candidate after a canonical governance commit plus documentation changes in the same reservation with a distinct request id and a distinct immutable preservation receipt."; "An unchanged retry of either captured snapshot reuses that snapshot's request id and returns its original preservation outcome without creating a duplicate preservation commit or overwriting the earlier receipt."; "Changed consequential inputs under a reused request id still refuse; reservation, Action, repository, branch, base, policy, validation-command and exact validated-tree bindings remain enforced, with no caller-supplied success assertion or preservation bypass."; "Deterministic regression tests reproduce the two-capture failure sequence and cover identical retries, replay drift refusal, and recoverable failure or interrupted-attempt retry using the existing manual and candidate preservation architecture."; "The repair preserves manual local-only authority and the no-public-arguments launcher contract; it starts no managed Run and does not accept, integrate, complete or advance the interrupted PPN Action, alter PR #207's draft state, discard its pending files or mark Nagel verification complete."; "Objective validation evidence covers the repair and regression tests, protected preservation records the final tested candidate, and a runnable handoff states the exact reviewed broker installation and same-worktree PPN resume procedure without exercising those downstream authority gates.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-repair-manual-preservation-snapshot-identity-878-2026-10-02).

## 2026-10-02 — Agent Ask log-pr888-bounded-host-recovery-authority-2026-10-02

- **Did:** Record the operator's direct instruction "Authorize a bounded host recovery exception" for PR #888: preserve the reviewed three pending narrative files in the exact repair candidate, merge pinned main ad87e69514d983858bf6ef2c3d17f60154e34ac4 while retaining both canonical MISSION_LOG append sets and original published commits, validate and push only the existing agent branch, then run the ordinary PR review/check gates. No installation, restart, production, PPN, history discard or review bypass is authorized.
- **Result:** The operator selected the concrete exception after protected preservation refused incompatible base drift and fixed Go refused a second candidate while narratives were dirty. This Log records the human authorization; it neither substitutes for it nor grants new authority. Canonical application waits until the authorized documentation preservation makes the candidate clean.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-02 — Agent Ask pr-opened-arcadia-pr888

- **Did:** Manual preservation snapshot identity repair is published for review in draft PR https://github.com/pmark/arcadia/pull/888; protected final narrative preservation is blocked by base drift.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/persist-inactive-production-configuration

- **Did:** Completed Action arcadia/persist-inactive-production-configuration from accepted evidence (Candidate ec2b24e281214ef702c8d99ecc14a505b4ec598e).
- **Result:** Every declared acceptance criterion was accepted as met: "Off atomically revokes active authority and fences pending admissions while retaining separately labelled DB-owned configuration across worker and dashboard restart; a migration and named revision/fingerprint preserve its provenance."; "The /runs On path previews the saved exact Project/Plan/Action/provider bounds and current effective concurrency, refuses stale policy/configuration revisions, and never re-derives scope.actions from a moved queue or pointer."; "An authorized On transition records fresh activation authority and epoch; old fenced admissions stay fenced, committed work remains identifiable, and restart or duplicate toggles never launch a duplicate worker."; "Consumed or expired integration Grants, rehearsal exceptions and packet delegation never revive. Missing current authority returns the exact actionable gate; any changed On delegation semantics remain inactive pending the required explicit Decision."; "Effective production-worker concurrency remains one until the existing concurrency proof gate permits more; native helpers cannot bypass principal ownership or admission accounting."; "Deterministic policy and dashboard tests cover absent configuration, migration, Off/On, consumed/expired grants, moved pointers, concurrent toggles, restart and in-flight work; required checks pass and the operator guide describes saved configuration separately from active permission.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-persist-inactive-production-configuration-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr893

- **Did:** Production Off no longer forgets its reviewed scope: PR #893 saves it apart from authority and lets On replay it into a fresh epoch or refuse with the exact reason. https://github.com/pmark/arcadia/pull/893
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr894

- **Did:** ✅ Landing your Decision 0079 answer (Separate Selected and Running indicators) so the Flight Deck tree Actions unblock: https://github.com/pmark/arcadia/pull/894
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/fix-preserve-launcher-git-timeout-and-index-mutation

- **Did:** Completed Action arcadia/fix-preserve-launcher-git-timeout-and-index-mutation from accepted evidence (Candidate bc995e4fe4558b60474efb55a5642cbe45ef005a).
- **Result:** Every declared acceptance criterion was accepted as met: "A forced failure at `preserve.recheck-binding` (and every other stage before the commit) leaves the candidate's real index bytes, `git status --porcelain` output and `.git` locks exactly as they were, with no `index.lock` and no staged change; a successful preserve still ends with a clean status."; "A git timeout in any preserve, binding or validation call (raw `execFileSync` in the snapshot code, `git()`, `tryGit`, `isAncestor`, `mergesCleanly`, `commitTreeAt`) raises a typed retryable error whose details name the git subcommand, arguments, working directory, timeout budget, stage and a retry remedy; it is never a bare `UNEXPECTED_ERROR`, "base branch could not be resolved" or "not a forward advance", and `tryGit` and `isAncestor` never turn a timeout into a negative answer."; "The per-call git timeout is configurable and defaults below the stage idle limit, snapshot steps emit progress so a large candidate cannot trip the stage watchdog, retryable timeouts do not consume the identical-refusal budget, and a retry after a timeout reuses the same request id and creates exactly one preservation commit; the failed-attempt journal is documented as safe to retry."; "Regression tests cover a hung-git shim at each stage, index-bytes-before-and-after equality, three consecutive timeouts not exhausting the refusal budget, and timeout-then-retry producing one commit; the notes and operator guidance describe the failure receipt and the separate reviewed broker reinstall that makes the fix live, with no install, restart or production action taken, and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-preserve-launcher-git-timeout-889-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr895

- **Did:** Preservation stops staging your files and names its git timeouts: PR #895 keeps the candidate index untouched until the commit lands and types every git/gh timeout as retryable. https://github.com/pmark/arcadia/pull/895
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/resolve-agent-ask-draft-file-from-caller-worktree

- **Did:** Completed Action arcadia/resolve-agent-ask-draft-file-from-caller-worktree from accepted evidence (Candidate c04a68c07b2b1a5b97d5804f0213774333b7048e).
- **Result:** Every declared acceptance criterion was accepted as met: "A relative `--file` passed to `agent-ask draft` or `preview` from a linked candidate worktree is read from that worktree, validated and previewed as that exact file; the main checkout is untouched and nothing is copied into it."; "A nonexistent path, a path or symlink resolving outside the caller's repository, and a reused request id with different content each fail closed with no read or write outside the caller's repository."; "Regression tests drive the real CLI parser for the main checkout, a linked worktree and a different Project repository, and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-resolve-agent-ask-draft-file-886-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr897

- **Did:** Prepared sessions can now validate their own Ask drafts: PR #897 makes agent-ask --file resolve from the caller worktree instead of the main checkout. https://github.com/pmark/arcadia/pull/897
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/retire-legacy-operator-script-descriptors

- **Did:** Completed Action arcadia/retire-legacy-operator-script-descriptors from accepted evidence (Candidate 0f6797de1eb7cba7f0a48a907af68ca5352f3d46).
- **Result:** Every declared acceptance criterion was accepted as met: "A tracked retirement manifest names exactly the five legacy descriptors with the sha256 of each descriptor and script and a stated reason; the checker skips an id only when both hashes match, so any new, renamed or changed file still gets full validation."; "`pnpm check:operator-scripts` against the live local library exits 0, and `validateOperatorScriptContract` and runtime settlement enforcement are unchanged; a new undeclared Agent Ask script, a retired id with different bytes and a Plan with a non-null target still fail."; "No ignored local descriptor, script, run state or receipt is modified, deleted or moved; one-shot and repeatability behavior is unchanged; the retirement path is documented in the operator-actions guidance and covered by tests, and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-retire-legacy-operator-script-descriptors-887-2026-10-03-v2).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr898

- **Did:** The operator-script check goes green again: PR #898 retires exactly the five legacy descriptors through a hash-pinned manifest without loosening validation. https://github.com/pmark/arcadia/pull/898
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/bound-fixed-brief-broker-with-structured-receipt

- **Did:** Completed Action arcadia/bound-fixed-brief-broker-with-structured-receipt from accepted evidence (Candidate 18dbd0846a4f2683c08780c19c1451fd31a63183).
- **Result:** Every declared acceptance criterion was accepted as met: "Every fixed brief invocation returns within a bounded deadline: the literal dispatch brief with its bytes and hash unchanged, or a structured failure on a single stream naming the stage, a correlation id and the safe recovery; a stalled dependency is reproduced in an integration test through the real entrypoint and kills the whole process group."; "A healthy brief creates no claim, admission or dispatch telemetry and does not mutate the candidate; repeated calls and a worker restart neither hang nor duplicate telemetry, and a late child write after the deadline never produces a second receipt."; "Installed-broker status proves the brief is usable rather than merely installed, the notes and operator guidance record the new failure receipt, and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-bound-fixed-brief-broker-885-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr902

- **Did:** The fixed brief launcher can no longer hang silently: PR #902 supervises it with a deadline and a structured receipt, and broker status now proves the brief actually runs. https://github.com/pmark/arcadia/pull/902
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/recover-draft-only-never-launched-candidates

- **Did:** Completed Action arcadia/recover-draft-only-never-launched-candidates from accepted evidence (Candidate 01e2864d82d510b2f78e79540cf016a3f08b9de5).
- **Result:** Every declared acceptance criterion was accepted as met: "Go distinguishes a draft-only linked candidate from a tracked or code-bearing one; every draft is preserved by exact sha256 and origin in an idempotent receipt before any resume or disposition, and no draft is settled, copied, moved or deleted."; "A draft-only never-launched candidate resumes in the same worktree and branch with no duplicate claim or worktree; a draft naming another Project stays in place; one narrow operator disposition is exposed only when resuming is unsafe."; "Tracked changes, non-Ask or unknown files, symlinks, renames, a changed hash and a concurrent Go attempt fail closed or converge on one receipt, recovery survives restart, the dispatch-launch path agrees with Go, and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-recover-draft-only-candidates-884-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr905

- **Did:** Go no longer gets stranded by a never-launched candidate that only holds Ask drafts: PR #905 preserves each draft by hash and resumes the same worktree. https://github.com/pmark/arcadia/pull/905
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/reset-managed-preservation-timeout-history-on-success

- **Did:** Completed Action arcadia/reset-managed-preservation-timeout-history-on-success from accepted evidence (Candidate 8490600f4cc9fc236283c9c3bf3368ecece5c133).
- **Result:** Every declared acceptance criterion was accepted as met: "A regression test reproduces, before the fix, that a managed tick timeout followed by a successful preservation leaves timeout:<session.id> uncleared."; "After the fix, timeout then successful managed preservation then timeout counts the second timeout as the first consecutive one, while ten identical consecutive timeouts still stop automatic retries."; "The managed tick and the CLI use one shared budget; index_locked is counted separately from timeouts, bounded retry behavior is unchanged and the stop condition is not weakened."; "A malformed or live preservation lock yields a typed bounded error with preserved diagnostics instead of an unhandled exception."; "The actual managed handoff is exercised in a temporary repository and its structured receipts are retained; the original candidate commits and index remain recoverable."; "Merge and install are not claimed; the exact reviewed install step and host-path verification are named as the next gate.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-reset-managed-preservation-timeout-history-896-2026-10-03-v2).

## 2026-10-03 — Completed arcadia/make-pr-review-verdict-truthful-for-current-head

- **Did:** Completed Action arcadia/make-pr-review-verdict-truthful-for-current-head from accepted evidence (Candidate c67f9c19047f0578ae633a69c5ea0a0ad870946c).
- **Result:** Every declared acceptance criterion was accepted as met: "Regression tests reproduce, before the fix, that a `Review paused` success status with an old APPROVED head and a `Review rate limited` success with no review each wrongly yield verdict done."; "After the fix, paused or skipped success plus an old approval is not a completed review, and rate-limited success with no review is not a completed review."; "A genuinely completed review without approval is reported as completed-not-approved, and a genuine approval of the exact current head by the actual reviewer identity is reported as approved; an approval of an earlier head never approves a changed head."; "Unresolved review findings keep the verdict not done, and a push invalidates all earlier review evidence for that PR."; "Decision 0060 and the exact-head independent review, QA and required-check gates are unchanged, and no gate, test or branch protection is weakened."; "Show by test or code trace that the rehearsal and managed path consume the corrected classification, and state explicitly that installed verification is not claimed until the separate reviewed install.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-make-pr-review-verdict-truthful-for-current-head-2026-10-03-v2).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr907

- **Did:** Review rules are now written down for every coding agent, not just one: PR #907 makes an independent review the merge gate and CodeRabbit advisory, and opens Decision 0080 for your answer. https://github.com/pmark/arcadia/pull/907
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Agent Ask pr-ready-arcadia-pr907-decision-answer-2026-10-03

- **Did:** Your call needed: Decision 0080 and PR #907 write the independent-review merge rule into the Constitution for every coding agent (CodeRabbit becomes advisory). Three review rounds are clean; answer the Decision, then merge the PR. https://github.com/pmark/arcadia/pull/907
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/align-code-review-messages-with-advisory-coderabbit

- **Did:** Completed Action arcadia/align-code-review-messages-with-advisory-coderabbit from accepted evidence (Candidate 56e8fca3649bf6cc94fd19df0bd010a3c20533b1).
- **Result:** Every declared acceptance criterion was accepted as met: "`arcadia pr code-review` and its runtime messages (`src/stewardship/codeRabbitReview.ts`, `src/cli.ts`) no longer say a completed CodeRabbit review is required or to wait for a limit to reset; they say a rate limit or missing review never blocks a merge and that the independent review gate governs, with tests updated."; "The bootstrap names conflict-free base merges beside the governed-record commits; the PR procedure tells the reviewer to confirm the settle receipt id for an exempt commit and says branch protection on main now requires the seven CI jobs (lint, unit-1..4, dashboard, e2e); the regenerated AGENTS.md and guidance fingerprints agree and `check:agent-guidance` passes."; "The CodeRabbit-dependent rehearsal text in `docs/managed-production-readiness.md` is revised so CodeRabbit is advisory rather than a required reviewer actor, with the independent review gate named; lint, tsc and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-align-code-review-messages-908-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr910

- **Did:** Messages now match the rule you set: PR #910 makes pr code-review and the guidance say CodeRabbit is advisory and that a rate limit never blocks a merge. https://github.com/pmark/arcadia/pull/910
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/clear-preservation-timeout-count-and-harden-index-lock-checks

- **Did:** Completed Action arcadia/clear-preservation-timeout-count-and-harden-index-lock-checks from accepted evidence (Candidate da9443fb1d8249327e6ef12353b55a2b0d3a363a).
- **Result:** Every declared acceptance criterion was accepted as met: "The managed-production tick path (`src/production/sessionHandoff.ts`) counts preserve-stage timeouts toward the same identical-timeout cap as `arcadia preserve` and clears the count after a successful preservation, with a deterministic test that fails when either is removed."; "Stale `index.lock` removal no longer rests on mtime alone: a lock is removed only when it is older than the threshold and a fail-closed probe finds no process holding it open (an unreadable probe refuses with the typed retryable error); a directory lock, a symlinked lock and a dangling symlink raise the typed error instead of an untyped failure after the commit; tests cover each shape."; "`index_locked` has its own error code, is not counted against the timeout budget, and the cap message no longer suggests tuning the timeout for a locked index; notes and START_HERE describe it; lint, tsc and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-clear-preservation-timeout-count-896-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr912

- **Did:** Preservation stops guessing about a stale index.lock: PR #912 refuses a lock a process still holds, and gives a locked index its own retryable error that no longer burns the timeout budget. https://github.com/pmark/arcadia/pull/912
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/restore-readiness-evidence-and-report-spoofed-coderabbit-status

- **Did:** Completed Action arcadia/restore-readiness-evidence-and-report-spoofed-coderabbit-status from accepted evidence (Candidate 1c2d1da37fd0ead3462ddec9bb2ff9c382e54b9c).
- **Result:** Every declared acceptance criterion was accepted as met: "`docs/managed-production-readiness.md` again carries the original historical sentence about what the read-only helpers and the adversary judged (the CodeRabbit-actor route), with a short 'as of Decision 0080' note after it saying the independent review gate now replaces that reviewer actor; no other claim in the document changes."; "The `unverified_reporter` remedy in `src/stewardship/codeRabbitReview.ts` again tells the agent to check who posted the status named CodeRabbit and to report a possible spoof, while still saying the status is advisory and never blocks a merge; a test asserts both statements."; "Verdict codes, error codes and the JSON shape of `arcadia pr code-review` are unchanged, and lint, tsc and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-restore-readiness-evidence-911-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr914

- **Did:** Two small wording slips from the CodeRabbit-advisory change are being undone: PR #914 restores a historical evidence sentence and the spoofed-status check. https://github.com/pmark/arcadia/pull/914
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/close-index-lock-probe-races-and-fd-matching-gaps

- **Did:** Completed Action arcadia/close-index-lock-probe-races-and-fd-matching-gaps from accepted evidence (Candidate edc23b932eb3202c3749d4a1276123fd2ce5d84c).
- **Result:** Every declared acceptance criterion was accepted as met: "Stale `index.lock` removal re-`lstat`s the lock and compares its `ino` and `mtimeMs` immediately before `rmSync` and refuses with the typed retryable error if either changed since the holder probes, with a deterministic test that swaps the lock between the probe and the removal."; "The Linux `/proc/<pid>/fd` holder probe matches by device and inode via `stat` on each fd link rather than by path string (so bind mounts and mount namespaces cannot read as 'none'), keeping its fail-closed handling of unreadable pids, with tests using injected readers including a differing-path-same-inode case."; "An `lsof` warning on stderr is carried into the typed error details so the operator can see why the answer was 'unknown'; the docs say plainly that the held-open probe covers only Git's brief write and non-Git holders and that an editor-based commit is protected only by the Git-cwd probe; lint, tsc and required checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-close-index-lock-probe-gaps-913-2026-10-03).

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr915

- **Did:** Stale-lock cleanup gets safer: PR #915 re-checks the lock right before deleting it, matches holders by inode on Linux, and shows probe warnings. https://github.com/pmark/arcadia/pull/915
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Agent Ask pr-opened-arcadia-pr917

- **Did:** Any helper can now ask the host for governed preparation or a managed worker without gaining authority: PR #917 adds the protected enrollment request (criteria 1-6 done, 7-9 queued as a split). https://github.com/pmark/arcadia/pull/917
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/enroll-session-through-governed-host-request

- **Did:** Completed Action arcadia/enroll-session-through-governed-host-request from accepted evidence (Candidate 2329b0e1c4d94a4ea336b152c9213231ed5cce0c).
- **Result:** Every declared acceptance criterion was accepted as met: "A fixed host enrollment request resolves the configured workspace and exact governed Project/Plan/Action, canonical brief, required operator gates, packet provider/model/effort, and existing worktree claim; the request accepts no caller-supplied executable or arbitrary shell command."; "An exact request replay returns its original prepared-principal or managed-Session receipt; changed Action, caller identity or mode under the same request id refuses before mutation."; "Preparation returns the canonical candidate and fenced ownership receipt; a production launch reuses issueAdmission, commitAdmission and launchGuardedHostSession. Preliminary helper execution and prompt text establish no ownership, completion or production authority."; "Concurrent enrollment, Off, stale policy epoch, unavailable capacity, missing packet approval and transport refusal leave no duplicate principal or orphan admission, claim or candidate; existing pending work remains recoverable."; "Native durable adoption refuses with native_runtime_not_supervisable unless a host-observable adapter verifies stable identity, liveness, terminal outcome and recovery; the refusal supplies the supported managed-worker launch route."; "Focused enrollment, admission and claim refusal/replay tests pass, followed by the repository's required checks; the operator guide and portable skill instructions explain how an unleased helper requests enrollment and proves success.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/wire-requirement-attempt-lineage-into-session-roles-and-tick immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-enrollment-protected-request-from-attempt-lineage-2026-10-03).

## 2026-10-03 — Agent Ask enrollment-scope-owner-conflict-2026-10-03

- **Did:** Operator input needed on one scope/owner conflict: this chat was instructed to keep enrollment current until all nine criteria were proved; another session merged PR #917 for criteria 1–6 and split 7–9 into the now-current lineage Action. Reply 1 to retain that split and its existing sole Claude writer (this root remains read-only); reply 2 to restore the original nine-criterion enrollment Action through a governed handoff, preserving every commit and candidate (the original Codex runtime resumes with gpt-5.6-sol/high only after the other writer releases ownership; no Desktop or service restart). https://github.com/pmark/arcadia/pull/917
- **Result:** Record and notify this actual scope/ownership conflict under the operator's explicit direction that real input requests use the configured default notification/messaging channel. This Log creates no Plan, Action, Decision, Grant, installation, activation or ownership transfer. Root's state is waiting_for_operator for source mutation while the existing lineage writer and independent non-mutating work can continue; the full original nine-criterion acceptance is not claimed. Nearest orchestrator has been informed.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-03 — Completed arcadia/wire-requirement-attempt-lineage-into-session-roles-and-tick

- **Did:** Completed Action arcadia/wire-requirement-attempt-lineage-into-session-roles-and-tick from accepted evidence (Candidate d7fded21746dced1398d18ef46848a79b5611f60).
- **Result:** Every declared acceptance criterion was accepted as met: "Route only one mutation-owning principal; helpers are separately identified and read-only. Deterministic readiness precedes inference, and push/criteria/evidence changes invalidate dependent verdicts."; "A three-Action Plan always selects only its next dependency-ready Action; restart resumes or reconciles its current attempt without duplication; Off fences a between-Action launch; independent review/QA cannot be supplied by the developer; focused migration/race/replay/restart/Off tests pass.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/record-code-review-verdicts-for-unattended-integration immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-lineage-code-review-recorder-2026-10-03-v2).

## 2026-10-03 — Completed arcadia/record-code-review-verdicts-for-unattended-integration

- **Did:** Completed Action arcadia/record-code-review-verdicts-for-unattended-integration from accepted evidence (Candidate 6d011d093e3ac0b729bf14c8090e1b7aa424d2dd).
- **Result:** Every declared acceptance criterion was accepted as met: "Persist a requirement identity/input revision and distinct attempt ordinal/request ID for planner, critique, development, exact-head code review and independent QA. Transport replay returns the same receipt; an explicitly authorized retry after terminal failure atomically allocates the next bounded ordinal."; "A host command or worker step records a passed or failed exact-head code-review verdict through beginIndependentVerdict/finishIndependentVerdict for a preserved managed candidate, refuses any developer-supplied or stale-head verdict, and the production tick then integrates a candidate with both current code-review and QA verdicts with no operator merge; the awaiting_independent_verdicts escalation clears; focused replay/stale/independence/Off tests and the three-Action rehearsal pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-record-code-review-verdicts-2026-10-03).

## 2026-10-04 — Completed arcadia/let-production-grant-request-remote-preservation

- **Did:** Completed Action arcadia/let-production-grant-request-remote-preservation from accepted evidence (Candidate dce2d98967251ba904da2caa71b8ef55b7613457).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia production preview and activate accept a remote-preservation option that sets scope.remotePreservation, shows it in the preview, status and receipt, and binds it into the scope fingerprint so an activation cannot differ from its preview; reactivation preserves it from the saved reviewed configuration."; "An activation without the option leaves preservation local only; no other flag, environment variable or dashboard control can turn it on; and tests in tests/managed-production-policy.test.ts and the dashboard production-control contract cover the preview fingerprint, replay, Off clearing authority, and refusal without the option."; "START_HERE.md and docs/managed-production-readiness.md document the option and that it authorizes only push and draft PR creation, not merge or marking a PR ready.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-let-production-grant-request-remote-preservation-2026-10-04).

## 2026-10-04 — Completed arcadia/ready-pr-and-run-independent-reviews-from-the-tick

- **Did:** Completed Action arcadia/ready-pr-and-run-independent-reviews-from-the-tick from accepted evidence (Candidate 391fd6367a52ab552f7debc52e1f9b722634d540).
- **Result:** Every declared acceptance criterion was accepted as met: "For an Action awaiting verdicts the tick (or worker step) marks the exact-head PR ready, waits a bounded time for required checks, then runs arcadia qa code-review and arcadia qa pr against that PR; every step is idempotent by request id, bounded by a retry budget that survives restart, fenced by Off and the policy epoch, and escalates with an accurate remedy when the budget, checks or reviewer capacity are exhausted."; "The PR head is proven equal to the settled candidate head before verdicts are requested, with a hermetic assertion covering a settlement commit that lands after preservation; a head that moved never receives a verdict, and a failed verdict never integrates."; "A hermetic three-Action rehearsal drives preserve, ready, both reviews and local fast-forward integration through the tick with only the GitHub CLI and reviewer model stubbed, with no operator step, the awaiting_independent_verdicts escalation clearing, Off fencing between Actions, and restart resuming mid-step without duplicate PR readiness or duplicate verdicts; GitHub-side merge and base push stay out of scope and are documented as such.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-ready-pr-and-run-independent-reviews-from-the-tick-2026-10-04).

## 2026-10-04 — Completed arcadia/prepare-three-action-rehearsal-operator-runbooks

- **Did:** Completed Action arcadia/prepare-three-action-rehearsal-operator-runbooks from accepted evidence (Candidate c8d70f5e866e60ba18bdc5e6f2ba84ac73357aea).
- **Result:** Every declared acceptance criterion was accepted as met: "A G1 paired operator descriptor and script accept one exact operator-supplied disposable private GitHub repository identifier, verify it is safe to create or reuse, create only the minimal CI/check-rollup fixture, import and sync one Project with Plan autonomous-three-action-rehearsal and serial Actions write-start-marker, transform-start-marker and verify-final-rehearsal, and never preview or activate production."; "A G6 paired preflight descriptor and script make only bounded observations: current production status/release, Claude worker-context token verdict without token disclosure, Codex capacity evidence, and explicitly authorized GitHub readiness; unknown, stale, paid, or unavailable evidence refuses with a receipt and no activation."; "A fresh G7 paired descriptor and script run the hermetic three-Action rehearsal check before a current-revision production preview and one-shot activation; they bind the exact fixture, provider, concurrency one, packet approval expiry, --remote-preservation, and an unexpired Decision 0058 integration Grant naming each Action, and state that they authorize only the reviewed scope, draft preservation, readiness/review integration where the Grant permits, never GitHub merge or base push."; "A G8 paired descriptor and script use only the reviewed host-service path to restore and prove terminal Off: an inactive receipt, zero live admissions and leases across repeated observations, preserved/reconciled committed work, a restart receipt, and an intervention ledger; they never kill a raw PID or discard a candidate."; "The pairs have bounded waits, fail-closed preconditions, timestamped receipts and failure handoffs, pass the operator-script checker and focused three-Action/preflight tests, and are independently reviewed at their frozen head before publication; unrelated existing library failures are retained as named blockers rather than weakened or hidden.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prepare-three-action-rehearsal-operator-runbooks-2026-10-04).

## 2026-10-04 — Agent Ask enrollment-scope-owner-resolved-2026-10-04

- **Did:** Record the operator's answer to enrollment-scope-owner-conflict-2026-10-03: option 1, retain the split. enroll-session-through-governed-host-request stays done at criteria 1-6 (PR #917) and criteria 7-9 stay with their follow-up Actions, now merged as #919 (attempt lineage), #920 (code-review verdict recorder) and #924 (tick-driven PR readiness and independent reviews). The original Codex enrollment session stays read-only as reviewer and coordinator; no scope restoration, handoff or ownership transfer occurs.
- **Result:** The operator replied '1' on 2026-10-04 to the Log-only attention Ask enrollment-scope-owner-conflict-2026-10-03, which offered 1 retain the split or 2 restore the nine-criterion Action. This Log records that answer and creates no Plan, Action, Decision, Grant, installation, activation or ownership change.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-04 — Completed arcadia/normalize-check-contexts-in-review-readiness

- **Did:** Completed Action arcadia/normalize-check-contexts-in-review-readiness from accepted evidence (Candidate 6ec340e41ee76707bec42ebb8ffa6da228eec8f5).
- **Result:** Every declared acceptance criterion was accepted as met: "classifyPullRequestChecks and every caller (the tick's independent review step, assertPullRequestReadyForQa and evaluateDeterministicEvidence) pass the statusCheckRollup through the existing normalizeCheck (src/workMonitoring/pullRequests.ts) or one shared normalizer, so a StatusContext entry (context, state, targetUrl, description) is read by its real state: SUCCESS passes; PENDING and EXPECTED wait; FAILURE and ERROR block; and an unrecognised entry shape is reported by name as unknown rather than silently pending."; "The CodeRabbit context is treated as advisory under Decision 0080 and never gates readiness, whatever its state (including rate limited, pending or failed), while every other check, including required GitHub Actions jobs, still gates exactly as before; the exemption is one named list with a test and a docs line, not a general bypass."; "Tests use real payload shapes captured from this repository's pull requests (a CheckRun-only list, a CheckRun plus CodeRabbit StatusContext list, a pending StatusContext, a failed non-advisory StatusContext, an empty list) through classifyPullRequestChecks, the tick step in tests/tick-independent-review.test.ts, and qa pr readiness; the empty-rollup refusal is unchanged; focused suites, lint, tsc, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-normalize-check-contexts-in-review-readiness-2026-10-04).

## 2026-10-04 — Completed arcadia/fix-rehearsal-g1-plan-and-operator-guidance

- **Did:** Completed Action arcadia/fix-rehearsal-g1-plan-and-operator-guidance from accepted evidence (Candidate 645b0c8a594f1962646b53e925e1eae6775b3a94).
- **Result:** Every declared acceptance criterion was accepted as met: "G1 renders the fixture Plan and runs Arcadia's real discovery/validation (the same code docs sync uses, with zero errors and Actions write-start-marker, transform-start-marker and verify-final-rehearsal resolving serially by depends_on) in a scratch directory BEFORE gh repo create, any push, project import or manifest write; an invalid generated fixture refuses with a receipt and failure handoff having made no external mutation; the acceptance-criterion line is valid YAML."; "A regression test generates the fixture from the script's own heredocs and runs the real discoverDocs/docs-sync validation on it (no faked errorCount), and fails on the pre-fix script; it also asserts G1 refuses before any create, push or import when the generated Plan is invalid, and that a half-registered earlier attempt is reported with an exact recovery instruction rather than a silent refusal."; "G1's next-step text, its descriptor, START_HERE.md and the recover-arcadia-host-services descriptor state that recovery must be run with ARCADIA_WORKSPACE=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover inline (never exported in the shell, because exporting makes the other scripts refuse), and give the exact command; the cosmetic G6 defects (double 'none' after an HTTP error; a codex availability check that cannot fail) are fixed with tests; pnpm check:operator-scripts, the focused operator-script tests, lint, tsc, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-rehearsal-g1-plan-and-operator-guidance-2026-10-04).

## 2026-10-04 — Completed arcadia/code-review-not-applicable-criteria

- **Did:** Completed Action arcadia/code-review-not-applicable-criteria from accepted evidence (Candidate 41efa94a142b57eaaa637531940d8de598d59c3b).
- **Result:** Every declared acceptance criterion was accepted as met: "The reviewer schema, parser, receipts, lineage binding and persisted-receipt reading accept a not-applicable check status that is non-blocking only when it carries concrete evidence that the change cannot affect that criterion; the correctness criterion can never be not-applicable; a deterministic check on the files the patch touches refuses not-applicable for a criterion the patch demonstrably affects (for example failure handling, state, security or compatibility claimed not-applicable on a diff that changes executable code, configuration, or authority-bearing documents); an all-not-applicable-but-correctness verdict on a marker/docs-only patch passes, and not-checked still blocks as needs-follow-up."; "The reviewer prompt distinguishes not-applicable (the change cannot affect the criterion) from not-checked (the change affects it but the evidence cannot show it), and states that commits carrying Arcadia-Preservation-Request or Arcadia-Candidate-Fingerprint trailers or a 'Written by arcadia agent-ask settle' body are governed records to judge only for consistency with the stated Action, not for how they were generated; qa pr's own role is unchanged except for any shared schema."; "Tests use the real captured result from the rehearsal (the exact patch and model verdict for PR #1 head 58bcd9155: five not-checked criteria, zero findings) as a fixture, plus a pass/fail matrix (marker-only patch passes with all-not-applicable-but-correctness; not-applicable on a changed executable file is refused; missing evidence text is refused; a real finding still fails), the hermetic three-Action tick rehearsal with a marker-only candidate integrates without an operator step, and persisted receipts from before this change still read; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-code-review-not-applicable-criteria-2026-10-04).

## 2026-10-04 — Completed arcadia/code-review-not-applicable-naming

- **Did:** Completed Action arcadia/code-review-not-applicable-naming from accepted evidence (Candidate 41b38f73bf71464086d07d01957b1c9c545d7783).
- **Result:** Every declared acceptance criterion was accepted as met: "The per-claim 'names a touched file' check is replaced by a verdict-level rule: the not-applicable claims are accepted only if every claim's evidence is substantive (existing length rule) and at least one not-applicable claim names a touched file path or basename (or, for a docs-only patch, the review summary names one); the deterministic per-file classification of the patch remains the sole decision on whether a claim can be accepted, every refusal for touched executable, configuration, authority or unknown files is unchanged, and correctness is still never not-applicable."; "The code-review prompt's not-applicable rule tells the model that each not-applicable check's own evidence should name every touched file by exact path (for example MARKER.md, PROJECT.md) and must not refer to files only generically ('all touched files', 'the marker', 'governed records'); tests lock the new rule and keep all of #934's refusal tests passing."; "A regression test uses the real model-verdict from the live smoke (five not-applicable claims where state-and-concurrency, security-and-authority and tests evidence names no file, copied from the smoke's out-exact receipt under /private/tmp/claude-501/-Users-pmark-Dev-MR-Arcadia-arcadia/8b3c388d-2a2c-4a1b-bfb8-165c1289534c/scratchpad/na-smoke/) and shows it now derives to pass on the captured patch while a code, workflow, config or docs/ patch with the same wording is still refused; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-code-review-not-applicable-naming-2026-10-04).

## 2026-10-04 — Completed arcadia/code-review-tests-criterion-stability

- **Did:** Completed Action arcadia/code-review-tests-criterion-stability from accepted evidence (Candidate 3311e24623dd5168ffab1595d5d40334b4396afe).
- **Result:** Every declared acceptance criterion was accepted as met: "The code-review prompt's rule for the Tests criterion states that when the patch touches no executable or test files the Tests criterion is not-applicable (with evidence naming the touched files) rather than pass or not-checked, that a successful required CI check named in the evidence counts as concrete validation evidence for a patch that does change code, and that missing CI command output alone is never a reason for not-checked or a finding on a patch that adds no executable behavior; QA's prompt and every deterministic classifier rule are unchanged and the #934 and #935 refusal tests still pass."; "Tests lock the new prompt sentences and show that the deterministic gate still refuses a Tests not-applicable claim on a patch that touches an executable or test file."; "A live measurement with the real codex reviewer on the exact captured rehearsal patch (at least five runs, recorded in the PR with per-run verdicts and Tests statuses; stubbing only gh as the earlier smokes did) shows at least four of five pass with no medium or higher finding, a code-change control still does not pass, and the numbers and receipt paths are in the pull request body; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-code-review-tests-criterion-stability-2026-10-04).

## 2026-10-04 — Completed arcadia/define-agent-peer-watch-contract

- **Did:** Completed Action arcadia/define-agent-peer-watch-contract from accepted evidence (Candidate c3c04adae82148795c2a0d864bc8e994287d448b).
- **Result:** Every declared acceptance criterion was accepted as met: "A checked-in contract (docs/agent-guidance/ procedure registered in index.json plus a typed schema in code) defines the evidence an agent publishes and a watcher reads, using only channels every supported agent already has: Git commits on its candidate branch (a machine-readable trailer such as Arcadia-Agent, Arcadia-Action and Arcadia-Heartbeat on commits and on an optional empty heartbeat commit), GitHub issue comments on the coordination issue (one fenced machine-readable block per comment), the existing session/lease rows, and the coding-agent capacity telemetry; it names which of these each of Claude Code, Codex and OpenCode can produce today."; "The contract classifies each watched agent as healthy, idle, stalled, exhausted (out of tokens or capacity), or unknown from that evidence with explicit freshness windows, and states in code and prose that a coding turn ending, a missing process, a preserved local head, or silence alone is never proof of released ownership; takeover is requested through the existing claim/ownership recovery with the old principal proven terminal or released, and a watcher may only offer help, escalate to the operator, or continue work the owner has released."; "Tests cover the schema, trailer and comment-block parsing with malformed, forged and stale input, the classification table including the 2026-10-03 enrollment-collision case (turn ended, no process, local head preserved, orchestrator still owning) classified as not released, and the agent-guidance index and fingerprint checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-define-agent-peer-watch-contract-2026-10-04).

## 2026-10-04 — Completed arcadia/agents-know-names-and-teammates

- **Did:** Completed Action arcadia/agents-know-names-and-teammates from accepted evidence (Candidate ab493c6e1fb5a9dcaed12ba4cea606f831ae3908).
- **Result:** Every declared acceptance criterion was accepted as met: "src/codingAgents/agentIdentity.ts exposes a pure roster (every platform's given name, tier surnames, critic title and local address) and a teammates function that, for a resolved identity, lists the other platforms' identities and roles, the operator as a non-agent principal who never signs as an agent, and the rule that the resolved identity for the session's own model tier is authoritative; `arcadia identity resolve` prints the agent's own signature string and its teammates, and a new `arcadia identity roster` prints the whole roster; both agree with resolveAgentIdentity and refuse to fall back to the operator's identity."; "Every session prompt and brief Arcadia generates for Claude Code, Codex and OpenCode (go, brief, enroll, the managed worker packet and reviewer/critic launches) includes one Identity block built from that function: 'You are <name> <<email>> (platform, tier, role); sign every comment and commit exactly so, never as another tier or name; your teammates are ...; your current partners on this Project, from live claims and Sessions, are ...', where partners come from existing session and claim rows when they can be read and are omitted (not guessed) when they cannot; tests cover each provider, the critic role, an unknown tier refusing, no live partners, and a partner with a different platform."; "The operator and agent guidance (docs/agent-guidance/git-identity.md and the instructions the brief links) state the signature rule and the roster once, agent-agnostically; a deterministic test fails if a generated prompt for any platform lacks the Identity block or names a self identity that differs from resolveAgentIdentity for that session's tier and role; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-agents-know-names-and-teammates-2026-10-04).

## 2026-10-04 — Completed arcadia/guard-experiment-workspaces

- **Did:** Completed Action arcadia/guard-experiment-workspaces from accepted evidence (Candidate 1430404de74171bb2b5fcd40003e3dde6e250592).
- **Result:** Every declared acceptance criterion was accepted as met: "`arcadia init --profile experiment` creates a workspace flagged experimental in its config (with an allowed repository root under the workspace), refuses the name martianrover and any existing database, and never seeds the real Arcadia Project; `config set defaultWorkspace` refuses an experiment workspace; a Project registered in an experiment workspace must have a repository path inside its allowed root and equal to no path registered in the live workspace."; "A single guard module is called by every command that can touch host-global or production state (production activate, grants and reactivation, go-broker install and ensure, worker, dashboard and ingress service install or restart, GitHub PR and issue posting, notification and Discord senders, trust writes to the Codex and Claude configuration) and refuses with a named reason and the exact supported alternative when the resolved workspace is experimental; a test enumerates the command registry so a newly added command that is not classified (allowed, guarded or exempt) fails the build."; "The activity recorder stores an error code with each failed command so contention (SQLITE_BUSY, queue-revision conflicts, dirty-checkout refusals, stale preview fingerprints) can be measured; a leak-check command or script compares the live workspace's project count and queue revision, the user config and Codex/Claude configuration hashes and the launchd plist list before and after a session and reports any change; the guidance (docs/agent-guidance/arcadia-repository.md 'Experiment workspaces', and docs/agents-context.md regenerated into AGENTS.md within its budget) states the bounded exception and the rule that experiment workspaces are addressed only inline and never exported; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-guard-experiment-workspaces-2026-10-04).

## 2026-10-05 — Completed arcadia/keep-exempt-commands-out-of-activity-log

- **Did:** Completed Action arcadia/keep-exempt-commands-out-of-activity-log from accepted evidence (Candidate ccce420ecbe4caebb38e2a031bd38317b69043c8).
- **Result:** Every declared acceptance criterion was accepted as met: "Every command classified exempt in src/workspace/experimentGuard.ts COMMAND_CLASSIFICATION, and any other command that reads no workspace state (init including --profile experiment, config get defaultWorkspace, identity resolve and roster, workspace resolve, workspace guard, workspace leak-check, audit host-preview), is run with activity recording off (the runCliAction recordActivity 'never' setting or a classification-driven equivalent) and never resolves, opens or writes a workspace database to record it; a test runs each of them with an uninlined environment whose user-config default points at a temporary live-like workspace and asserts zero activity rows and no database open there, and a test enumerates the command registry so a newly exempt command that still records activity fails the build."; "`arcadia workspace leak-check` additionally records and compares, as separate attributed fields that do not by themselves count as a leak, the live workspace's activity_events row count and newest row id (read-only) and the live repository's ref list (heads, remotes, tags and refs/codex/* by name and target), prints them in its human output with a note on attributing them, and the guidance in docs/agent-guidance/arcadia-repository.md ('Experiment workspaces') states that a command run with no inline workspace is a command against the live workspace, that exempt commands record nothing, and fixes the sqlite read-only recipe for a fresh database (use immutable=1); focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-keep-exempt-commands-out-of-activity-log-2026-10-05).

## 2026-10-05 — Completed arcadia/define-agent-comms-role

- **Did:** Completed Action arcadia/define-agent-comms-role from accepted evidence (Candidate 753682f23dc5c201556ed538492c169a8c79fec0).
- **Result:** Every declared acceptance criterion was accepted as met: "docs/agent-guidance/agent-comms.md, registered in docs/agent-guidance/index.json with its triggers (comms, coordination issue, sub-issue, relay, peer sessions), defines the Comms role on top of docs/agent-guidance/agent-peer-watch.md: exactly one Comms session per platform (Claude Code, Codex, OpenCode); Comms may observe, relay, ask, offer help, escalate and launch read-only information-gathering subagents, and never dispatches, assigns, claims, releases or takes over work, which stays with the queue, claims and `arcadia go`; an Issue comment is a signal and never authority; awareness of other sessions reads Arcadia session and claim rows first, and each platform's native session listing (stated as verified or unknown for each of the three platforms) only as a fallback reported as unknown when unreadable."; "The procedure fixes the channel: one coordination Issue per round, named by an approved posting Decision (initially pmark/arcadia#944, once an approved Decision such as 0083 covers it); each Comms comment is signed with the exact resolved identity signature line and carries a short human summary plus at most one arcadia-peer-watch-v1 block; a sub-issue is opened only when one Action needs multi-agent discussion or the operator asks, and a round ends with a summary comment and a successor Issue named by a new Decision; Comms posts only through the main checkout (never from an experiment workspace) and only while a posting Decision is approved and unexpired, and otherwise writes the same text as a local draft."; "The procedure makes waiting cost no model tokens: a shell watcher polls with a comment-id watermark, an exact-signature self filter and rate-limit back-off below 500 remaining core requests, and is re-armed before the two-hour background limit; the Comms model wakes only on a comment from another signature, a peer classification change or an escalation; a checked-in launch brief for each of Claude Code, Codex and OpenCode starts a Comms session under these rules with its resolved identity; check:agent-guidance and the guidance index fingerprint checks pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-define-agent-comms-role-2026-10-05).

## 2026-10-05 — Agent Ask pr-opened-arcadia-pr951

- **Did:** The Comms role is drafted: one event-driven coordination session per coding-agent platform, with launch briefs and a token-free Issue watcher, ready for review at https://github.com/pmark/arcadia/pull/951
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Completed arcadia/require-inline-workspace-mode

- **Did:** Completed Action arcadia/require-inline-workspace-mode from accepted evidence (Candidate 9ed662aedec8842509a483517f926bf45a3eb958).
- **Result:** Every declared acceptance criterion was accepted as met: "With ARCADIA_REQUIRE_INLINE_WORKSPACE set to a truthy value, workspace resolution (src/workspace/resolve.ts and every caller path, including the activity recorder) refuses to use the user-config defaultWorkspace or the .arcadia-workspace marker and fails with a named error code (for example INLINE_WORKSPACE_REQUIRED) whose message states the exact fix (pass --workspace <path> or set ARCADIA_WORKSPACE inline on that command); --workspace, an ARCADIA_WORKSPACE value and the cwd config/arcadia.json walk-up keep resolving as before; commands that resolve no workspace (the no-record set, help, version) are unaffected; with the variable unset or falsy behaviour is byte-for-byte unchanged, so the live launchd services and operator scripts keep working; `arcadia workspace resolve` reports whether the mode is on."; "Arcadia-launched agent sessions (the launch environment built in src/sessions/ for Claude Code, Codex and OpenCode) set the variable when the launch environment already pins the workspace explicitly, so launched sessions' own arcadia commands keep working and cannot fall back silently; where a launch path does not pin the workspace the Action does not set it there and records exactly why in the pull request; the Identity block and docs/agent-guidance/arcadia-repository.md ('Experiment workspaces') state the mode, who sets it and how a native session turns it on for its own shell."; "Tests (temporary directories and a temporary user config only) cover each resolution source with the mode on and off, the error code and remedy text, the recorder not falling back, the no-record commands and help staying usable, a launched-session environment containing the variable only when the workspace is pinned, and a regression that a command run inside the mode against a temp default workspace writes nothing there; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-require-inline-workspace-mode-2026-10-05-v2).

## 2026-10-05 — Completed arcadia/run-multi-workspace-experiment-trial

- **Did:** Completed Action arcadia/run-multi-workspace-experiment-trial from accepted evidence (Candidate f532a4a95b03dcf2f263d32debce2cf5d965b397).
- **Result:** Every declared acceptance criterion was accepted as met: "The Claude Code step ran against the contract agreed in issue #940: workspace exp-claude-20261004 created with arcadia init --profile experiment and addressed inline, a no-remote one-Action fixture inside it advanced and settled with receipts, the leak check run before and after, guarded refusals shown with exact messages, and the evidence and friction posted to issue #940 (comment 5986088702) and kept under the workspace's evidence directory."; "The Decision 0082 stop condition event (an uninlined config get defaultWorkspace wrote one activity row into the live workspace) is recorded with its cause and its fixes merged and installed (#948 keeps workspace-independent commands out of the activity log and makes the leak check report live activity and refs; #950 adds the opt-in ARCADIA_REQUIRE_INLINE_WORKSPACE mode), the Codex step stopped without advancing (issue #940 comments 5986077838 and 5986555763) and the OpenCode step never started."; "The operator ended the trial on 2026-10-05: no further experiment commands run, the preserved workspaces exp-claude-20261004 and exp-codex-20261004 are kept until the operator says to delete them (exp-owen-20261004 was never created), the unrun scope (concurrent three-agent settle overlap and the error-rate comparison against the live baseline) is recorded as not run, the friction is catalogued in issues #947 and #949, and the recommendation is recorded: narrow.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-end-multi-workspace-trial-2026-10-05).

## 2026-10-05 — Completed arcadia/adopt-rehearsal-freeze-window

- **Did:** Completed Action arcadia/adopt-rehearsal-freeze-window from accepted evidence (Candidate 5ec9d640773f4f8b57a11dcef0a521daeff2a4a3).
- **Result:** Every declared acceptance criterion was accepted as met: "Agent guidance (a 'Rehearsal freeze window' procedure registered in docs/agent-guidance/index.json with triggers such as rehearsal, freeze, production active, reinstall, restart, install) defines the window as running from a successful production activation until the terminal production Off receipt, observed with read-only `arcadia production status`; lists what is forbidden inside it (reinstall-go-broker.sh and `go-broker install|ensure`; recover-arcadia-host-services.sh and `scripts/services.sh restart|stop` except through the run's own Off-first G8 step; `production activate|deactivate|reactivate` outside the run's own G-steps; workspace config and provider-registry edits; editing, pausing, docs-syncing or tidying the in-scope fixture Project; whole-queue arrange or moving in-scope queue keys; fast-forwarding or dirtying the main checkout across commits that touch runtime paths: src, scripts, apps, package.json, pnpm-lock.yaml, tsconfig.json) and what continues (worktree commits, PRs and reviews; merges on origin, with the main checkout not fast-forwarded past runtime-path commits until the window ends; Arcadia-only Ask settles from the main checkout when the fast-forward range is docs-only; read-only commands; `arcadia go` sessions in their own worktrees; modest gh reads); and names who runs the batched install after the window ends (the release-manager or orchestrator session: reinstall-go-broker.sh, then recover-arcadia-host-services.sh when services need it) and how agents learn the window opened or closed (the coordination Issue and production status), without changing any authority."; "`arcadia go-broker install` and `arcadia go-broker ensure` (src/commands/goBrokerInstall.ts), reinstall-go-broker.sh before it installs, and `scripts/services.sh restart|stop` refuse with a named reason (for example production_active_freeze) and the exact supported alternative when read-only production status reports the managed-production policy Active, and proceed when it is Inactive or Off; a documented inline operator override (for example ARCADIA_FREEZE_OVERRIDE=<reason>) bypasses the refusal and records the reason; G8's Off-first restart path is unaffected; the CLI checks fail closed when status cannot be read while services.sh fails open with a warning as its existing comment requires; recover-arcadia-host-services.sh and its descriptor stay byte-identical, or G8's RECOVER_* sha256 pins and their tests are re-pinned in the same change."; "Hermetic tests cover Active refusal, Inactive and Off success, the override with its recorded reason and unreadable status for each guarded entry point, and the G8 Off-then-restart path still passing; focused suites, lint, tsc, pnpm build, check:agent-guidance, check:operator-scripts and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-adopt-rehearsal-freeze-window-2026-10-05-r2).

## 2026-10-05 — Agent Ask pr-opened-arcadia-pr952

- **Did:** Agents can now work in parallel with a live rehearsal: the freeze window refuses broker reinstalls and service restarts while production is Active, with an operator override; review at https://github.com/pmark/arcadia/pull/952

## 2026-10-05 — Agent Ask pr-opened-arcadia-pr946

- **Did:** Decision 0083 is open for review on bounded GitHub messaging for one three-agent Issue conversation: https://github.com/pmark/arcadia/pull/946
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Agent Ask operator-answers-rehearsal-run2-2026-10-05

- **Did:** Operator answers for rehearsal run 2, given directly to Claudia Atlas in chat on 2026-10-05: #925 — yes, Decision 0058 covers `gh pr ready`, the settled-head push and the reviewer model's spend during a managed rehearsal; agents may run the reset and read-only G6 tonight (the fixture-reset script pushing one reviewed commit to pmark/arcadia-three-action-rehearsal-20261004, no force push, and the read-only G6 preflight) so only the G7 press remains for the operator; reuse that fixture repository and reset it by amending Action write-start-marker's text; G7 press window mid-morning, about 9–10am local; Decision 0083 approved (recorded in 9e1ee2f0b).
- **Result:** The release-manager session correctly declined to act on these answers relayed through a peer session; this Log entry is the governed record they cite. The operator gave the answers in the orchestration session (Claudia Atlas, claude heavy) in response to numbered pickers with stated consequences. This entry records answers only and grants nothing beyond them: G7 activation, Grant creation, spend beyond Decision 0058, credentials and deletion remain operator-only.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Agent Ask operator-authorizes-g8-rerun-2026-10-05

- **Did:** Operator authorization, given directly to Claudia Atlas in chat on 2026-10-05: once the G8 reconciliation repair (accept-settled-descendant-in-g8-reconciliation) is reviewed, merged and installed, agents may rerun the existing G8 (restore-terminal-off-three-action-rehearsal-2026-10-04: terminal Off confirmation, pinned recover restart and reconciliation of rehearsal run 1's preserved PR #1) tonight, before the fixture reset; production is already Inactive.
- **Result:** Complements Log entry operator-answers-rehearsal-run2-2026-10-05 (reset and read-only G6). Ordering agreed on #940 by the release-manager session and Cody: G8 repair, install, G8 rerun for run 1, fixture reset, G6, operator G7 press 9–10am. Records an answer only; production activation, Grants, spend beyond Decision 0058, credentials and deletion remain operator-only.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Agent Ask clarify-operator-answer-source-2026-10-05

- **Did:** Clarification of Log entries operator-answers-rehearsal-run2-2026-10-05 and operator-authorizes-g8-rerun-2026-10-05: the operator gave those answers in the Claude Code session titled "Arcadia orchestrator prompt refinement" (Claudia Atlas, orchestration role), not in the release-manager session "Arcadia autonomous-production release", which also signs as Claudia Atlas; that session received them only as a peer relay and correctly will not act on them until the operator confirms directly in its own chat.
- **Result:** Two sessions of the same platform and tier share one signature, so "given directly to Claudia Atlas" was ambiguous; recorded so the evidence names its exact source session.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Completed arcadia/accept-settled-descendant-in-g8-reconciliation

- **Did:** Completed Action arcadia/accept-settled-descendant-in-g8-reconciliation from accepted evidence (Candidate acc8b9a06c567b3899859ff9e16b20fb3d78b5d8).
- **Result:** Every declared acceptance criterion was accepted as met: "G8's work reconciliation (restore-terminal-off-three-action-rehearsal-2026-10-04 and any code it calls) classifies a preserved candidate as reconciled when its tip equals the preservation receipt's commit, or when all of these hold: the tip is clean; the receipt commit is an ancestor of the tip; every commit between them is a genuine accepted-completion settlement for that candidate's Action (a `Written by arcadia agent-ask settle --apply (asksettle_...)` receipt line, touching only .arcadia/asks/, MISSION_LOG.md, PROJECT.md, docs/plans/ and docs/decisions/, completing the claimed Action); and the same branch and pull request are remotely preserved at that exact tip. It keeps refusing a dirty tip, an arbitrary or code-changing descendant, a local-only tip, a missing or invalid settlement, and a remote or pull-request mismatch, each with a named reason."; "The change keeps every operator-script pin coherent: recover-arcadia-host-services.{sh,json} stay byte-identical; any changed G8 script or descriptor bytes are re-pinned with their tests in the same change; `pnpm check:operator-scripts` passes; and a read-only classification of rehearsal run 1's real evidence (receipt commit 9ed639d, PR #1 tip 58bcd915 on pmark/arcadia-three-action-rehearsal-20261004) reports reconciled without mutating anything."; "Hermetic tests cover the exact-tip case, the settled-descendant case, and each refusal (dirty, code-changing descendant, two settlements or a non-completion settlement, forged receipt line, local-only, remote or PR mismatch); the G8 operator-scripts suite, focused suites, lint, tsc, pnpm build, check:operator-scripts and the preservation self-check pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-accept-settled-descendant-in-g8-reconciliation-2026-10-05).

## 2026-10-05 — Agent Ask pr-opened-arcadia-pr955

- **Did:** G8 can now reconcile a preserved candidate whose tip is exactly one verified completion settlement past its preservation commit, unblocking terminal proof for rehearsal run 1; review at https://github.com/pmark/arcadia/pull/955
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Completed arcadia/prepare-run-2-rehearsal-scripts

- **Did:** Completed Action arcadia/prepare-run-2-rehearsal-scripts from accepted evidence (Candidate 63fdbf3cbb462343073e0290cb28f72920e01ac4).
- **Result:** Every declared acceptance criterion was accepted as met: "A fixture-reset operator pair (descriptor and script, repeatable only in its refusing form) takes the exact operator-supplied fixture repository (validated as G1 does: owner is the gh user, safe name, private, not archived, not a fork, the registered Project's repository), requires production Inactive with zero live admissions and leases, rewrites only the Action text of write-start-marker in the fixture Plan so its requirement input revision changes (the implementer proves in a test through src/sessions/roleLineage.ts requirementIdentity and the tick's launch gate that the amended Action gets a fresh lineage and is dispatchable even though the old attempts exist), commits and pushes it to fixture main without force after validating the amended fixture with Arcadia's real discovery before any push, runs docs sync, and writes a receipt carrying the new fixture head sha; it never touches production, Grants, other Actions, the old candidate branch or PR #1."; "The G7 Grant has a NEW pair with a new request id and descriptor (the existing pair is left unchanged and retired from use by its documentation), reads the reset receipt and binds the new fixture head instead of genesis, keeps every existing G7 safety property (G6 receipt freshness and matching, hermetic replay, double preview with identical fingerprint, scope exactly the three fixture Actions, remote preservation, Decision 0058 integration grant naming each Action with the same 12-hour expiries, cleanup that turns only its own Grant Off on any failure, the #925 acknowledgement visible on the /runs card); G8 gains a variant (or accepts both ids) that deactivates only a policy whose request id is the new G7's (or the old one's) with the exact fixture scope and keeps its other behaviour and hash pins; G6 (a new pair or a parameterised successor) pins the reset head and the current installed revision and keeps every existing check."; "Tests with fake gh, git and arcadia shims as in tests/three-action-rehearsal-operator-scripts.test.ts (no live system) cover the refusals and the happy path of each pair, the reset's no-push-before-validation guarantee, the new fixture head binding in G6 and G7, G8's ownership check for the new id and still refusing an unrelated policy; the operator-script checker passes with the new pairs (retirement manifest entries only if the guidance requires them); START_HERE.md and docs/managed-production-readiness.md give the exact operator order for run 2; every script is run only with --describe or against fakes; independent authority review rounds are recorded on the pull request; lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prepare-run-2-rehearsal-scripts-2026-10-05).

## 2026-10-05 — Agent Ask rehearsal-run2-ready-for-g7-2026-10-05

- **Did:** Rehearsal run 2 is ready for your 9–10am press: run 1 is terminal-proven, the fixture is reset (main 0d3d2ced), #959 is installed (6d93c90b9) and G6 passed 18/18 overnight; in the morning run a fresh G6 (preflight-three-action-rehearsal-2026-10-05) and then press G7 (grant-production-three-action-rehearsal-2026-10-05) within 30 minutes, both on /actions.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Completed arcadia/isolate-next-operator-action

- **Did:** Completed Action arcadia/isolate-next-operator-action from accepted evidence (Candidate 2e5e4da7f8087e0eee207d0f446476e5cb35d15d).
- **Result:** Every declared acceptance criterion was accepted as met: "The /actions page (and the operator-actions view on /runs if it lists the same cards) shows at most one 'Do this next' action, isolated at the top in a visually distinct panel above everything else, with a one-sentence plain-language instruction, the exact card name, and, when a time window applies (for example G7 within 30 minutes of a passing G6 receipt), the local deadline and a live countdown; it is derived deterministically from published descriptors, live production status and run receipts (never from an agent's message), and when nothing needs the operator the panel says so plainly."; "Every other action is visually separated below the panel and de-emphasized; pressing an action that is not the current next action, or one whose effect would invalidate the next action (for example a G8 or a host restart while a fresh G6 receipt awaits its G7), first shows a confirmation that names the current next action and what the press would undo, without removing or weakening any action's existing gates or refusals."; "Works one-handed at phone width; component and route tests cover the next-action derivation (G6 then G7 with its window, an expired window falling back to G6, nothing pending, a failed run) and the confirm-on-off-path behaviour; pnpm dashboard:build, lint, tsc and focused suites pass, and a live read-only smoke of the page is captured as a screenshot in the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-isolate-next-operator-action-2026-10-05).

## 2026-10-05 — Agent Ask pr-opened-arcadia-pr966

- **Did:** Your next button on /actions now stands alone: a Do this next panel with a countdown, and a Keep my place check before any other press; review at https://github.com/pmark/arcadia/pull/966 (merge held until run 2 G8)
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Completed arcadia/add-operator-qa-plan-to-preserved-pr-body

- **Did:** Completed Action arcadia/add-operator-qa-plan-to-preserved-pr-body from accepted evidence (Candidate 1822e790e680abf44c408a4ab72a62d7e459a50b).
- **Result:** Every declared acceptance criterion was accepted as met: "The host preservation path (src/production/sessionHandoff.ts qaPlan and any other place a preserved candidate pull request body is written, such as src/commands/preserve.ts) renders a deterministic 'Operator QA plan' section from the Action's declared acceptance criteria and the candidate's changed files: for each criterion a concrete step (what to open, run or inspect, using exact paths, branch and commit) and its observable expected result, plus the Action id, candidate commit and base; it is built only from governed records and Git facts, never from model output, escapes Markdown safely, stays within GitHub's body limits, and keeps QA's no-not-applicable rule unchanged."; "Hermetic tests cover rendering for one and several criteria, inert-document and code patches, Markdown injection in criterion text, long bodies, and an Action with no criteria (which refuses rather than writing a placeholder); focused suites, lint, tsc, pnpm build, the preservation self-check and check:agent-guidance pass.".
- **Next:** Split: narrowed to the finished slice and queued arcadia/verify-operator-qa-plan-with-live-qa immediately after. Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask split-add-operator-qa-plan-to-preserved-pr-body-2026-10-05-r2).

## 2026-10-05 — Completed arcadia/prepare-run-3-rehearsal-scripts

- **Did:** Completed Action arcadia/prepare-run-3-rehearsal-scripts from accepted evidence (Candidate 637f357a73f2febc58a1ecec736bbc1f98eb48ab).
- **Result:** Every declared acceptance criterion was accepted as met: "A run-3 fixture-reset operator pair (descriptor and script, repeatable only in its refusing form) reuses the run-2 reset's fixture validation and no-push-before-validation guarantees and additionally: requires a succeeded, Off-confirmed run-2 G8 receipt (restore-terminal-off-three-action-rehearsal-2026-10-05, run 20261005T160050Z-46759 or a later succeeded one) and fixture main exactly at the run-2 reset head 0d3d2cedc5548da41896201688a1dc0210208ea4; requires run 1's branch and PR #1 at 58bcd9155cf64836994045ca63a7707d8b9ebe75 and run 2's branch claude/write-start-marker-20261005T155147519Z and PR #2 at 7f1390376f4d49215cd29fd98145d40198475613, local and remote, before and after the push; rewrites only write-start-marker's next_action to a third distinct text (and the Plan's updated: date if docs sync needs it, proven in a test with real docs sync that the amendment is applied, not skipped as older) so its requirement input revision differs from both earlier ones; and closes the Issue #968 gap: it refuses unless no pending Agent Ask proposal gates the amended Action, or it supersedes exactly run 2's pending complete proposal (complete-write-start-marker-2026-10-05) through the governed settle (disposition rejected, preview then apply with the exact fingerprint) before the commit, never touching other proposals. It writes a receipt carrying the new fixture head, the three candidate tips and the superseded proposal id; it never touches production, Grants, other Actions, run 1's or run 2's branches or PRs. A test proves, through src/sessions/roleLineage.ts requirementIdentity and the tick's launch gate on fakes, that the amended Action gets a fresh lineage and is dispatchable with run 1's and run 2's attempts and candidates present, and that the pending-proposal gate no longer blocks it."; "The run-3 G7 Grant has a NEW pair with a new request id and descriptor (the 2026-10-04 and 2026-10-05 pairs are left unchanged and retired from use by their documentation), reads the run-3 reset receipt and binds its new fixture head, keeps every run-2 G7 safety property (G6 receipt freshness, matching arcadiaHead and brokerRevision, hermetic replay, double preview with identical fingerprint, scope exactly the three fixture Actions, remote preservation, Decision 0058 integration grant naming each Action with the same 12-hour expiries, cleanup that turns only its own Grant Off, the #925 acknowledgement on the /runs card) and carries the optional next_after field exactly as the run-2 G7 JSON does (prerequisite G6 within 30 minutes; voided_by G8, recover, reinstall and reset) so check-operator-scripts validates it and the panel isolates it; the run-3 G6 (a new pair) pins the run-3 reset head and keeps every existing check; the run-3 G8 accepts the run-3, run-2 or run-1 G7 request id with the exact fixture scope and otherwise keeps the merged G8 behaviour and hash pins byte-identical (a test compares the normalized scripts)."; "Tests with fake gh, git and arcadia shims as in tests/three-action-rehearsal-run-2-operator-scripts.test.ts (no live system) cover the refusals and happy path of each pair, the reset's no-push-before-validation guarantee, the proposal-supersede behaviour and its refusal for any other pending proposal, the reset-head binding in G6 and G7, G8's ownership check for each accepted id and its refusal of an unrelated policy, and the reset to G6 to G7 chain; check:operator-scripts passes; START_HERE.md and docs/managed-production-readiness.md give the exact operator order for run 3 (including that main must not move between G6 and the G7 press and that G8 must be run from the Terminal panel or /runs, never a plain shell); every script is run only with --describe or against fakes; independent authority review rounds are recorded on the pull request; lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prepare-run-3-rehearsal-scripts-2026-10-05).

## 2026-10-05 — Completed arcadia/verify-operator-qa-plan-with-live-qa

- **Did:** Completed Action arcadia/verify-operator-qa-plan-with-live-qa from accepted evidence (Candidate 9ed85eb8ef66316612ef7b17404a83851483cec6).
- **Result:** Every declared acceptance criterion was accepted as met: "The configured independent QA reviewer (arcadia qa pr) has judged a real pull request that Arcadia's own host preservation created with the rendered Operator QA plan in its body, and its report records the 'Operator QA plan' criterion as pass; the evidence names the pull request, its exact head, the verdict artifact paths and the reviewer provenance. Rehearsal run 3's pmark/arcadia-three-action-rehearsal-20261004#3 at 50d1eab84e385a5566119831c82f5a6d32e752fd (two live verdicts, 2026-10-05T18:51Z and 19:38Z) satisfies this.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-verify-operator-qa-plan-with-live-qa-2026-10-05).

## 2026-10-05 — Completed arcadia/prepare-run-4-rehearsal-scripts

- **Did:** Completed Action arcadia/prepare-run-4-rehearsal-scripts from accepted evidence (Candidate dc0db8a6174a8f184c11c3b2cda0543f3a002932).
- **Result:** Every declared acceptance criterion was accepted as met: "A run-4 fixture-reset operator pair (ids ending -run4-2026-10-05; descriptor and script, repeatable only in its refusing form) reuses the run-3 reset's fixture validation, no-push-before-validation and proposal-state handling, and: requires a succeeded, Off-confirmed run-3 G8 receipt (restore-terminal-off-three-action-rehearsal-run3-2026-10-05, run 20261005T194025Z-26232 or a later succeeded one) and fixture main exactly at the run-3 reset head 4375aafeef38f0ee339a300406c8a865dbb916dc; requires run 1's branch and PR #1 at 58bcd9155cf64836994045ca63a7707d8b9ebe75, run 2's branch claude/write-start-marker-20261005T155147519Z and PR #2 at 7f1390376f4d49215cd29fd98145d40198475613 and run 3's branch claude/write-start-marker-20261005T184707757Z and PR #3 at 50d1eab84e385a5566119831c82f5a6d32e752fd, local and remote, before and after the push; rewrites only write-start-marker's next_action to a fourth distinct text (and the Plan's updated: date only if docs sync needs it) so its input revision differs from 959a3b12c686, 7a8dd4f5960f and e22c8cfadd0b, and that text names the unused completion request id complete-write-start-marker-run4-2026-10-05 (the reset refuses before any settle or commit if that id already exists in agent_ask_proposals); handles any pending proposal for the Action exactly as the run-3 reset does (pending own: governed rejected settle; rejected or accepted elsewhere: proceed only if the real gate is clear; foreign pending: refuse); and writes a receipt with the new fixture head, the four candidate tips and the proposal states. It never touches production, Grants, other Actions or any earlier run's branches or PRs. A test with the real transition resolver and tick proves the amended Action gets a fresh lineage and is dispatchable with the earlier runs' attempts and candidates present."; "The run-4 G7 Grant has a NEW pair with a new request id (grant-production-three-action-rehearsal-run4-2026-10-05), reads the run-4 reset receipt and binds its new fixture head, keeps every run-3 G7 safety property (G6 receipt freshness, matching arcadiaHead and brokerRevision, hermetic replay, double preview with identical fingerprint, scope exactly the three fixture Actions, remote preservation, Decision 0058 integration grant naming each Action with the same 12-hour expiries, cleanup that turns only its own Grant Off, the #925 acknowledgement) and the next_after field (voided_by now also lists the run-3 and run-4 resets and G8s); the run-4 G6 pins the run-4 reset head and keeps every run-3 check; the run-4 G8 accepts the run-4, run-3, run-2 or run-1 G7 request id with the exact fixture scope and otherwise stays byte-identical in reconciliation and hash pins to the run-3 G8 (tested), and says in its descriptor that it must run from the Terminal panel or /runs. All earlier pairs stay byte-unchanged and are retired from use."; "Tests with fake gh, git and arcadia shims as in tests/three-action-rehearsal-run-3-operator-scripts.test.ts (no live system) cover the refusals and happy path of each pair, no push before validation, the proposal-state cases and the used-completion-id refusal, the reset-head binding in G6 and G7, G8's ownership of each accepted id and refusal of an unrelated policy, the reset to G6 to G7 chain, and a real same-day docs-sync test of an already-done work item; check:operator-scripts passes; START_HERE.md and docs/managed-production-readiness.md give the exact run-4 operator order (reset, G6 within 30 minutes, no main movement or reinstall or restart or G8 between G6 and the G7 press, the Terminal-panel rule for G8) and a run-4 evidence-to-capture line (the live QA verdicts on PR #4 including the Tests and evidence criterion); every script is run only with --describe or against fakes; independent authority review rounds are recorded on the pull request; lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prepare-run-4-rehearsal-scripts-2026-10-05).

## 2026-10-05 — Agent Ask pr-opened-arcadia-pr977

- **Did:** New `arcadia intelligence narrate` command ships in PR #977 — it turns text, a file, or a GitHub issue's full commentary into one podcast WAV through the local speech route. https://github.com/pmark/arcadia/pull/977
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-05 — Completed arcadia/embed-validation-evidence-in-preserved-pr-body

- **Did:** Completed Action arcadia/embed-validation-evidence-in-preserved-pr-body from accepted evidence (Candidate b7948facc6ed0e4ec1c64a339405a912ef9b28da).
- **Result:** Every declared acceptance criterion was accepted as met: "The host-rendered Operator QA plan in a preserved candidate's pull-request body gains a 'Validation evidence' section built only from the preservation receipt and governed records (no model): for each declared validation command it renders the command, its working directory, exit code, duration and a bounded (fixed byte cap per stream, last lines kept), escaped stdout/stderr tail; a failed, timed-out or missing validation renders an explicit status and the PR is still preserved as today; hostile output (markdown or HTML injection, ANSI and control characters, very long lines, binary) is neutralised; it also renders one fixed line stating that a candidate's own governed completion-settlement commit is the record Arcadia expects before independent review and is not an approval-boundary crossing. Unit tests with fixtures cover passing, failing, timed-out, missing, oversized and hostile-output cases and prove the body stays deterministic and bounded."; "A live read-only smoke (the configured independent QA reviewer through `arcadia qa pr`'s evidence assembly with only GitHub writes stubbed, never editing any PR) judges rehearsal run 3's PR #3 exact patch at 50d1eab84e385a5566119831c82f5a6d32e752fd with the newly rendered body substituted, twice, and records both verdicts with the report paths on the pull request: neither verdict cites missing validation evidence or the completion-settlement commit as a finding; if either does, the Action iterates on the rendering within three review rounds and records every attempt. QA's own criteria and rules are unchanged."; "Lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request; the change is installed through the governed reinstall path after merge by the release manager (not by the implementer).".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-embed-validation-evidence-in-preserved-pr-body-2026-10-05).

## 2026-10-06 — Agent Ask pr-opened-arcadia-pr991

- **Did:** Podcast narration safety fixes are ready for review in https://github.com/pmark/arcadia/pull/991; the PR prevents narration-key collisions and corrupt PCM rewrites.
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.
## 2026-10-05 — Agent Ask pr-opened-arcadia-pr975

- **Did:** New: `arcadia ping` lets any agent send you a quick read-only Discord nudge, with optional channel routing; Decision 0084 asks whether agents may use it unprompted. https://github.com/pmark/arcadia/pull/975
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-06 — Agent Ask pr-opened-arcadia-pr982

- **Did:** Docs-only PR: interim guidance for work you ask an agent to start right now, plus a proposal to make it a tracked parallel Plan once parallel Plans land. https://github.com/pmark/arcadia/pull/982
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-06 — Completed arcadia/archive-settled-ask-by-canonical-name

- **Did:** Completed Action arcadia/archive-settled-ask-by-canonical-name from accepted evidence (Candidate aea8849b2a0bdb6d527f8aa1e7a333106e7d4ea9).
- **Result:** Every declared acceptance criterion was accepted as met: "Settlement archives the settled Agent Ask file even when the proposal recorded no sourcePath: `settle --apply` (src/ask/settlement.ts archiveSettledAskFile) falls back to the canonical drafted name `.arcadia/asks/agent-ask-<request_id>.yaml` under the repository being settled and moves it to `.arcadia/asks/archive/` inside the same settlement commit, only when that file's content matches the proposal (same request id and fingerprint), never touching any other file; a settle with neither a sourcePath nor a canonical file behaves exactly as today. Unit tests reproduce the run-4 shape (a complete Ask previewed without a recorded path, settled in a candidate worktree: the settle commit includes the archived file and git status is clean afterwards), the matching-content guard, and the unchanged no-file case."; "The worker no longer fails silently when a terminal candidate cannot integrate: a repeated identical `integration refused` outcome for the same candidate head (the tick.ts 'differs from its exact canonical completion settlement' class and its siblings) is logged once per head, not every tick, and is recorded once as an operator escalation shown in `arcadia production status` with the exact blocker and a remedy (for the run-4 shape: the stray untracked file and what to do), clearing when the candidate integrates or production goes Off; the existing refusal logic and guards are unchanged. Tests cover the dedupe, the escalation text and its clearing."; "The candidate brief (Action packet) tells a completing agent to leave `git status` clean after settlement and not to commit or keep a copy of the Ask file; lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request; after merge the release manager reinstalls (not the implementer).".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-archive-settled-ask-by-canonical-name-2026-10-06).

## 2026-10-06 — Completed arcadia/prepare-run-5-rehearsal-scripts

- **Did:** Completed Action arcadia/prepare-run-5-rehearsal-scripts from accepted evidence (Candidate ae323573a11da82d9c4f284a668cb4eb9c6c333a).
- **Result:** Every declared acceptance criterion was accepted as met: "Run-5 operator pairs (ids ending -run5-2026-10-06 or -run5-2026-10-05 per the host date at build time; descriptor id == file stem) are cloned from the merged run-4 pairs (#973): the reset requires the run-4 reset receipt (9642005f2fdca40a4c8859d64ee28e3361df0056 on run 3's head 4375aafeef38f0ee339a300406c8a865dbb916dc) and a succeeded Off-confirmed run-4 G8 (restore-terminal-off-three-action-rehearsal-run4-2026-10-05, run 20261006T011557Z-3871 or later), checks runs 1-4 branch and PR tips before and after (run 4: branch claude/write-start-marker-20261005T220000438Z, PR #4, tip 79c6bae9 which includes the preservation commit; read the exact full sha from the repo at build time), writes a fifth distinct next_action (input revision differs from 959a3b12c686, 7a8dd4f5960f, e22c8cfadd0b and 7843e2eb12f9) naming the unused completion id complete-write-start-marker-run5-2026-10-06 (or the date variant matching the host date) and telling the agent to leave git status clean after settlement; handles run 4's own proposal as run 3's reset handled run 3's; G6/G7/G8 follow the same derivation rules as run 4's (G8 owns the run-5, run-4, run-3, run-2 and run-1 G7 ids; hash pins byte-identical to run-4's G8; G7's next_after voided_by extended)."; "Tests and docs follow run 4's (fake shims, refusals and happy paths, proposal-state cases, used-id refusal, chain binding in G6/G7, G8 ownership, reset to G6 to G7 chain, real same-day docs-sync of a done work item, lineage test with the real transition resolver and tick through four earlier runs, sha256 pin of every earlier pair file); START_HERE.md and docs/managed-production-readiness.md give the run-5 order including that main must be quiet from G6 to the G7 press; check:operator-scripts, lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass; every script runs only with --describe or against fakes; independent authority review rounds are recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prepare-run-5-rehearsal-scripts-2026-10-06).

## 2026-10-06 — Completed arcadia/document-rehearsal-runbook

- **Did:** Completed Action arcadia/document-rehearsal-runbook from accepted evidence (Candidate 8a6bafdba019705ade68e8255a379d33f7b83d3a).
- **Result:** Every declared acceptance criterion was accepted as met: "docs/autonomous-production-rehearsal-runbook.md exists and gives, in one checked-in document written for the next release manager and any coding agent: (1) the minimum-viable-production standard stated as observable exit criteria (the proof ladder: current exact source installed and inactive, a fresh one-shot Grant pressed by the operator, one serial three-Action run with zero operator steps between the G7 press and G8, every Action preserved with the host-rendered QA plan and validation evidence, code-review and QA both passing on the exact head, local fast-forward integration, terminal Off and reconciliation proven, then a clean repeat, then one escalated dimension); (2) roles and authority (what the operator alone does: G7 press, Decisions, activation, spend; what the release manager, implementers and reviewers may do; standing permissions Mark has granted and their limits); (3) the exact optimal step-by-step procedure for a rehearsal run from orientation through WINDOW OPEN, with the real commands, the order, the timing observed, who does each step and the observable check after each (governed Action creation, broker candidate, implementer and independent review, merge on green, merge-window announcement, single reinstall, reset, immediately G6, operator ping, G7 deadline, watchdog, verdict handling, G8 from the Terminal panel, evidence capture); (4) the failure catalog: every symptom seen in runs 1-5 with its cause, the fix that shipped or the Issue that tracks it, and what to do if it recurs; (5) the operational gotchas (REST over GraphQL for gh, unsandboxed gh/git/arcadia, inline workspace, runner-capacity CI cancellations and the one-rerun rule, untracked Ask files blocking installs and settlements, G8 refusing non-interactive shells, macOS sed, the freeze window rule from G6 to the G7 press, no-progress watchdog); (6) the open gaps that still stand between the rehearsals and a minimum viable production standard (Issue #987 serial-Action base, #986, #984, #976, #972 follow-ups, the one-hour cost of cloning run-N script pairs and the proposal to parameterise them) with the exact next step for each."; "START_HERE.md and docs/managed-production-readiness.md each gain a short pointer to the runbook (where an agent starts before critical-path production work); every command, path, Issue number, receipt id and timing quoted in the runbook was checked against the repository or the recorded evidence (the release manager's retro lists the sources) and nothing in it claims capability that has not been proven live; docs/agent-guidance remains unchanged (no new hash pin) unless the guidance index requires otherwise."; "lint, tsc, check:agent-guidance and the preservation self-check pass; the focused documentation tests pass; an independent read-only reviewer reads the runbook against the repository and the recorded evidence, reports unsupported claims and gaps, and its rounds are recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-document-rehearsal-runbook-2026-10-06-v2).

## 2026-10-06 — Completed arcadia/build-checkpoint-replay-and-base-check

- **Did:** Completed Action arcadia/build-checkpoint-replay-and-base-check from accepted evidence (Candidate e80775a98c5a5ebd5473651df808c71b4a6aaa46).
- **Result:** Every declared acceptance criterion was accepted as met: "A checkpoint replay tool (a documented script or test helper in the repository) loads a preserved rehearsal candidate read-only (its branch, base revision, the preservation receipt and validation record, the QA evidence JSON and patch the reviewer saw) into an isolated copy and re-renders the host Operator QA plan with the repository's real renderer, then runs a deterministic consistency check between the plan and the pull-request metadata as GitHub reports it: the plan's base revision and changed-file list must equal the PR's base and file list; a mismatch is reported with the exact differing values. It needs no model and no GitHub write, and runs in seconds."; "The tool reproduces Issue #987 from rehearsal run 5's preserved PR #6 (fixture pmark/arcadia-three-action-rehearsal-20261004, candidate branch claude/transform-start-marker-20261006T032821535Z at 69eb7d62, QA evidence under the live workspace artifacts/qa/pull-requests/pmark-arcadia-three-action-rehearsal-20261004/6/): the plan names base f68ec48ed4ff while the PR's metadata names 7214de28da2745c66f89d81e124e2ab2de05b2ca and lists seven changed files against the plan's six; a checked-in test captures a minimal synthetic copy of that state (no live data in the repository) and asserts the mismatch as an expected failure (`it.fails` or an equivalent documented marker) so the Issue's fix flips it; the same test file shows run 5's PR #5 (first Action, no mismatch) passes the check."; "lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request; the change adds no runtime path that executes in production (test and script only) so no reinstall is needed.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-build-checkpoint-replay-and-base-check-2026-10-06).

## 2026-10-06 — Completed arcadia/build-fast-rehearsal-harness

- **Did:** Completed Action arcadia/build-fast-rehearsal-harness from accepted evidence (Candidate 1d6ff1f503f4845b43beafebbcb1a5897970aa44).
- **Result:** Every declared acceptance criterion was accepted as met: "A checked-in fast scenario harness (tests/fast-rehearsal/ with shared helpers and a `pnpm fast-rehearsal` script) runs a serial two-Action scenario in an isolated temporary Project repository and workspace through the REAL production lifecycle code: the worker tick (admission, policy and Grant scope), the session launch and terminal-recovery path with a scripted executor standing in for the coding agent, candidate preservation, tick-driven PR readiness and the review steps (with a fake `gh` and a local bare remote that models the PR's base and head the way GitHub reports them, and stubbed reviewer verdicts), integration by local fast-forward, and queue and pointer advancement; it finishes in under five minutes; it reimplements none of the lifecycle and a short document in the harness lists exactly which seams are faked (tmux, gh, model reviewers) and why those and no others. Per-phase timings (queue wait, agent execution, validation, Git finalization, review, integration, advancement) and exact errors (command, working directory, exit code, sanitised stderr) are recorded to a report the command prints."; "The scripted executor drives the same execution contract the coding agent uses (the brief, the candidate worktree, the completion Ask and settle) and has selectable behaviours: clean; leaves its drafted Ask file untracked and unarchived (run 4's defect, which #983 fixed); edits the draft after an inline preview; leaves an extra uncommitted file; commits an extra file after settling. Failure injection at the completion boundary (a failing Git command, an interruption after the commit and before completion is recorded, a worker restart between preservation and readiness) verifies that recovery preserves the work and advances exactly once. A scenario test shows run 4's shape integrates with the #983 fix and that, when the guard refuses, `production status` carries one escalation naming the blocker."; "docs/autonomous-production-rehearsal-runbook.md gains Phase 1 step 'run `pnpm fast-rehearsal` before any live run' and records the key learning (measure loop cost and time-to-detect and time-to-fix per defect; two consecutive live runs that each find a new offline-reproducible defect are the trigger to build the cheap experiment first; the live run is the integration check, not the debugger); docs/notes-to-self.md gets the matching entry; lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-build-fast-rehearsal-harness-2026-10-06).

## 2026-10-06 — Completed arcadia/operator-timeline-phase-1

- **Did:** Completed Action arcadia/operator-timeline-phase-1 from accepted evidence (Candidate fa5a68d483517c02cd76a944e12c9d43802eda2f).
- **Result:** Every declared acceptance criterion was accepted as met: "A written design (docs/proposals/operator-timeline.md) states the operator problem in the operator's words (disorientation across multiple session histories, projects and three native agent tools: OpenCode, Claude Code, Codex; wanting to know what kind of work any agent or subagent is doing; monitor everything active; rewind and play back significant events for a whole workspace and all its Projects), inventories the REAL event sources that exist today in this repository and workspace (verified by reading the code and the data: git activity across the main checkout, every agent worktree under ~/.claude, ~/.codex and ~/.opencode, fixture repositories and PR/branch activity; the Sessions and role-attempt tables; Agent Asks, proposals and settlements; Decisions; Actions, Plans, Milestones, Missions and Projects as checked-in records and their commits; the events table; managed-production policy, admissions and escalations; operator-script run receipts; Discord pings), defines ONE unified event schema (stable id, UTC time, source, kind, subject refs for workspace/project/plan/action/session/ask/decision/PR/commit, actor identity with agent tool (opencode, claude-code, codex, operator, host worker) and semantic name and tier where derivable, a controlled `work_kind` taxonomy answering 'what kind of work is this' (for example plan/design, implement, review, verify, integrate, govern, operate, observe), a short human summary, evidence pointers, and provenance of how it was derived), explains how each field is derived (including how an agent tool and a semantic name are recovered from worktree paths, commit author emails and Session rows), and records the open questions that need the operator."; "Phase 1 is proven on real data: a collector layer and a command (for example `arcadia timeline`, with `--since`, `--until`, `--project`, `--tool`, `--kind`, `--json` / NDJSON, and a `--follow` mode that streams new events) in this repository read the live workspace and repositories READ-ONLY and emit the unified stream, merged and deterministically ordered across all Projects, de-duplicated, with provenance per event, tolerant of missing or unreadable sources (a collector failure is reported as a stream event and never aborts the stream), and fast enough to be practical (the design records measured timings on this workspace); at least these collectors exist: git (commits, branches, merges and worktrees across the repositories the workspace knows), sessions and role attempts, Agent Asks and settlements, Decisions, Actions/Plans/Milestones/Projects record changes, the events table, managed-production activity, and operator-script receipts; a point-in-time query shows the workspace's recent history as of a past timestamp (the 'rewind' read model; interactive playback is Phase 2). The command writes nothing to any repository or database."; "Tests (fixtures built in temp repositories and temp workspaces, no live data committed) cover each collector, the schema and `work_kind` classification including agent tool and semantic-name recovery from a worktree path, a commit author email and a Session row, ordering and de-duplication, source failure tolerance, the time-window and `--follow` behaviour; a short sample of real stream output from this workspace (sanitised, bounded, no secrets) is attached to the design as evidence that the data can be collected and presented as a stream; a Phase 2 section of the design offers two or three UX directions (a live 'what is happening now' view by project and agent tool, a scrubbable timeline for replay, an at-a-glance 'what kind of work' lens) with the practical data each needs from Phase 1, as options for the operator to choose, without building UI; lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; an independent authority review of the design and the code is recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-operator-timeline-phase-1-2026-10-06-v2).

## 2026-10-06 — Agent Ask pr-opened-arcadia-pr1005

- **Did:** New PR: the Discord bot can now route alerts, briefings and routine log messages to their own channels (needs your channel ids set after merge). https://github.com/pmark/arcadia/pull/1005
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-06 — Completed arcadia/fix-serial-pr-base-stacking

- **Did:** Completed Action arcadia/fix-serial-pr-base-stacking from accepted evidence (Candidate ed013043928331668afc72dd7dd78b04dd8021b7).
- **Result:** Every declared acceptance criterion was accepted as met: "Remote preservation opens a serial Action's draft PR **stacked**: when the candidate's base revision is not the tip of the Project's base branch on the remote (an earlier Action integrated locally and GitHub's base did not advance), the PR's base branch is the remote branch whose tip equals the candidate's base revision (the previous candidate's branch, found deterministically, for example by `git ls-remote`/`for-each-ref --points-at` on the remote and the Project's candidate branch naming), with a clear refusal and an escalation naming the exact blocker and remedy when no such branch exists (deleted or never pushed); the first Action and any candidate whose base equals the remote base behave exactly as today; no GitHub base push, merge or force push ever happens, and nothing in the Grant or Decision 0058 changes. The reason a stacked base was chosen is recorded on the receipt."; "The host-rendered Operator QA plan (Base, Candidate and the Step 2 changed-file list) describes the PR's real base so the plan, the PR's GitHub diff and the reviewers' evidence agree for stacked Actions; `scripts/qa-plan-consistency.ts` reports CONSISTENT for the serial case; the `it.fails` markers for Issue #987 in tests/fast-rehearsal/serial-two-action.test.ts and tests/qa-plan-pr-consistency.test.ts flip to passing (updated deliberately, with the companion pins revised to the new behaviour); the fast harness's fake gh models a PR whose base is a branch (three-dot diff against that branch, `baseRefOid` the branch tip) exactly as GitHub reports it."; "Readiness, both review steps, the settled-head push and integration remain correct with stacked bases, proven through the real lifecycle in the fast harness: the serial two-Action scenario integrates both Actions and a new three-Action chain scenario integrates all three with each PR stacked on the previous candidate branch, each PR's QA plan consistent with its GitHub diff, Action N admitted exactly once, no commit lost and the remote base never pushed; edge cases covered: the previous candidate's branch deleted on the remote (refusal plus one escalation), the previous PR closed or merged, a candidate whose base equals the remote base (unchanged), and the fault-injection scenarios still pass; `pnpm fast-rehearsal`, lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; the runbook (section 8 item 1 and the failure catalog) and Issue #987 are updated; independent authority review rounds are recorded on the pull request; the governed reinstall after merge is the release manager's.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-serial-pr-base-stacking-2026-10-06).

## 2026-10-06 — Completed arcadia/fix-qa-plan-check-wording

- **Did:** Completed Action arcadia/fix-qa-plan-check-wording from accepted evidence (Candidate 6eec48a93600d831dbf1a470e499d766a1a2782f).
- **Result:** Every declared acceptance criterion was accepted as met: "In src/sessions/operatorQaPlan.ts a criterion that is satisfied by running a declared validation command, or that names a script or command that must pass, renders as an inspection step whose Expected line is limited to what inspection shows (the file exists and what it contains) and points the proof of 'passes' explicitly at the declared-validation step and its exit-zero result; no QA criteria, reviewer prompts or other plan steps change; a unit test pins that the rendered step never claims source display proves a pass."; "A read-only check with the real QA reviewer on a plan rendered for run 5's Action 1 shape (as done for #974, recording the command and both verdict reports) shows no 'Operator QA plan' finding in two verdicts; if the reviewer cannot be run read-only from the candidate, the pull request says so plainly and the next live run's first QA verdict is named as the check."; "Lint, tsc, `pnpm fast-rehearsal` and the focused suites pass; the runbook failure catalog and Issue #986 are updated; independent review rounds are recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-qa-plan-check-wording-2026-10-06-v2).

## 2026-10-06 — Completed arcadia/fix-pending-completion-gate

- **Did:** Completed Action arcadia/fix-pending-completion-gate from accepted evidence (Candidate 2b5c7e0d16111959a540ccde436548b8523204c1).
- **Result:** Every declared acceptance criterion was accepted as met: "When the worker tick skips a launch because resolveProjectTransition answers `decision` for an Action in the active Grant's scope (a pending unsettled Agent Ask proposal or open Decision), `arcadia production status` shows exactly one operator-gate entry for it within one tick (gate kind, Action, proposal or Decision id, and the exact governed settle command or the reason it cannot settle, for example 'Action is already done'), deduplicated like `terminal_candidate_not_integrable` (one escalation and one deduplicated worker log line, not one per tick), and cleared when the proposal is settled or rejected or the Decision answered; tests pin it, including run 2's shape (a stale pending proposal for an amended Action) and the #994 and #995 scenarios."; "Issue #994: an agent that leaves an extra uncommitted file or an extra commit after its completion settlement no longer stalls silently: the Action either integrates (only where the governed settlement and every guard stay intact; unreviewed extra work is never integrated) or stops on exactly one visible, actionable entry in production status; a continuation Session never loops on 'Action is already done'; the `it.fails` marker in tests/fast-rehearsal/settle-then-dirty.test.ts flips to `it` with its companion pin revised deliberately."; "Issue #995: an agent that dies after its settlement commit and before the settlement is recorded is recovered deterministically by the tick (no coding-agent process and no LLM call; for example recognising the candidate's own canonical completion settlement or auto-settling the drafted complete Ask whose evidence verbatim-covers every criterion, as attemptAutoSettlePendingCompletion already does before dispatch), and the Action integrates and the next Action is admitted exactly once; the `it.fails` marker in tests/fast-rehearsal/completion-faults.test.ts flips to `it` with its companion pin revised deliberately."; "No authority widens: no proposal is accepted whose evidence does not verbatim-cover the Action's declared criteria with every entry met, nothing outside the Grant's scope is launched or settled, and Decision 0058 and the Grant model are unchanged; `pnpm fast-rehearsal`, lint, tsc, check:agent-guidance and the focused suites pass; the runbook (failure catalog and section 8 item 6), tests/fast-rehearsal/README.md and Issues #994, #995 and #997 are updated; independent review rounds are recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-pending-completion-gate-2026-10-06).

## 2026-10-06 — Completed arcadia/build-chain-rehearsal-run-scripts

- **Did:** Completed Action arcadia/build-chain-rehearsal-run-scripts from accepted evidence (Candidate 2fae8cec54f73a30c9eebeef7bf0f5c1a368a3f3).
- **Result:** Every declared acceptance criterion was accepted as met: "One operator script set (reset, G6 preflight, G7 grant, G8 terminal Off) with descriptors in artifacts/generated/operator-scripts/ takes the run id, the Action count N (3 to 12), the previous run's receipts and the required Arcadia commits from one small reviewed per-run parameter file, so a new run is a reviewed parameter change and not a clone; each script keeps every authority bound of the run-5 set (fail-closed preconditions, refusing-form-only and one-shot where the run-5 script is, receipts and failure handoffs, never exporting the workspace, never touching earlier candidates or pull requests, never force-pushing, deleting or rewriting history); `scripts/check-operator-scripts.ts` and the operator-script tests pass; parameter files for run 6 (N=3) and the overnight run (N=9) are included, with the latter's previous-run bindings left to be filled from run 6's receipts."; "The reset handles run 5's terminal state without losing work or pushing a base other than its single validated reset commit: it verifies that the fixture clone's local main f68ec48 is preserved on run 5's remote candidate branch and pull request #5 (and Action 2's work on #6) before moving only the clone's local main back to GitHub's main, and refuses otherwise; it then renders the fixture Plan as a serial chain of N tiny dependent Actions (the existing three amended and new ones appended, each reading its predecessor's output so the chain is genuinely ordered), each with a fresh requirement input revision, a fresh unused completion request id and the leave-git-status-clean instruction; it validates with Arcadia's own discovery and a dry-run docs sync (every Action an update or create, no error, only Action 1 ready), handles every pending fixture proposal by state, commits once and pushes without force, runs docs sync and writes a receipt naming the new head, the starting head, every earlier candidate's tip and the N Action ids and completion ids."; "G6 binds the reset receipt, the main head and the installed broker revision exactly as the run-5 preflight does and requires the parameterised commits (the merged #987 stacking fix and the #997 gate fix, filled in when they merge); G7's one-shot Grant names exactly the N fixture Actions, with remote preservation and the Decision 0058 integration grant scoped to those Actions and the existing 12-hour expiry, and its descriptor tells the operator plainly what one press authorises for N Actions (if Decision 0058 or Issue #925's answer is limited to three Actions, the descriptor says so and the change stops for the operator instead of widening it); G8 proves terminal Off, reconciles all N candidates as integrated, preserved or empty, and copies the worker log into the run's evidence folder before its reviewed restart."; "Offline proof: the pure parts (parameter validation, Plan rendering for N=3 and N=9, completion-id freshness, previous-head checks) are unit-tested, and a read-only dry-run mode of the reset prints the exact planned fixture change and refusals against the real fixture state without writing anything; the runbook (sections 4, 5 and 8 items 1 and 4) names the new set and how to start a run from it; independent review rounds are recorded on the pull request; running the reset, G6, G7 and G8 remains the release manager's and the operator's, not this Action's.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-build-chain-rehearsal-run-scripts-2026-10-06-v2).

## 2026-10-06 — Completed arcadia/set-run6-nine-action-chain

- **Did:** Completed Action arcadia/set-run6-nine-action-chain from accepted evidence (Candidate 08961a6ce1fc3fb75fed379bee357a05dad2815e).
- **Result:** Every declared acceptance criterion was accepted as met: "artifacts/generated/operator-scripts/rehearsal-chain/params/run6-2026-10-06.json declares actionCount 9 with its notes updated; the run-6 launchers and descriptors are re-rendered with no drift (`render-rehearsal-chain-operator-scripts.ts --check`), the run-6 G7 descriptor states that one press authorises exactly nine named fixture Actions, and run 7's parameter file remains a nine-Action repeat whose run-6 bindings stay UNFILLED and refusing; every other run-6 binding and required commit is unchanged."; "G8 (`rehearsal-chain/restore-terminal-off.sh`) chooses as its ownership basis the latest G7 receipt for this Grant that activated or succeeded, falling back to the latest receipt with actionIds only when none did, and a test proves that a later refused G7 attempt with different actionIds does not stop G8 from turning the run's Grant Off."; "The rehearsal-chain tests, `check:operator-scripts`, lint and tsc pass, the runbook's run-6 description says nine Actions, and an independent review round is recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-set-run6-nine-action-chain-2026-10-06).

## 2026-10-06 — Completed arcadia/add-long-chain-fast-rehearsal

- **Did:** Completed Action arcadia/add-long-chain-fast-rehearsal from accepted evidence (Candidate de38b828d3c9f7295b359c34aa952bc29287d934).
- **Result:** Every declared acceptance criterion was accepted as met: "A new fast-rehearsal scenario drives a serial chain of nine tiny dependent Actions (three batches of three, each reading its predecessor's output) under one Grant through the real worker tick, preservation, stacked draft PRs, readiness, both review steps and local fast-forward integration, with simulated time spanning several hours inside the Grant's 12-hour expiry; it asserts every Action is admitted exactly once and integrated in order, each PR is stacked on the previous candidate branch with a QA plan consistent with its GitHub diff, no commit is lost, the remote base is never pushed, production status names the progress, and after the last Action the chain ends with nothing admitted and no silent stall."; "The scenario also covers, in the same or a sibling test, a chain that hits a blocker midway (a failing verdict on Action 5 and, separately, the Grant expiring before the chain finishes): the chain stops on exactly one named, visible entry in production status and never admits a later Action or stalls silently; any behaviour that does not hold today is either fixed in this Action or pinned as an `it.fails` expected failure naming a new Issue with a revival trigger."; "`pnpm fast-rehearsal` still finishes in a few minutes and passes; lint, tsc and the focused suites pass; tests/fast-rehearsal/README.md and the runbook name the scenario and what it proves; independent review rounds are recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-add-long-chain-fast-rehearsal-2026-10-06-v2).

## 2026-10-06 — Completed arcadia/fix-chain-scope-order-compare

- **Did:** Completed Action arcadia/fix-chain-scope-order-compare from accepted evidence (Candidate 424fc2ae9bd258fbb2f157bda19f158dfb66adae).
- **Result:** Every declared acceptance criterion was accepted as met: "`rehearsal-chain/grant.sh` accepts the preview when `scope.actions` and `scope.integrationGrant.actions` each contain exactly the run's N fixture Actions in any order (same set, same length, no duplicates, nothing extra) and still refuses a missing, extra or duplicated Action; `rehearsal-chain/restore-terminal-off.sh` owns and turns Off the run's Grant when the stored policy's `scope.actions` equal the G7 receipt's actionIds as a set, and still refuses a different set; no other check is loosened."; "`tests/rehearsal-chain-operator-scripts.test.ts` pins both: a faked preview (and stored policy for G8) returning the nine Actions in the live order observed in run 6's refused G7 (transform-start-marker, verify-final-rehearsal, write-start-marker, chain-step-04 to 09) passes G7 and lets G8 turn Off exactly once, while an extra or missing Action still refuses; the rehearsal-chain tests, `check:operator-scripts`, render `--check`, lint and tsc pass; an independent review round is recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-fix-chain-scope-order-compare-2026-10-06).

## 2026-10-06 — Completed arcadia/prepare-run7-chain

- **Did:** Completed Action arcadia/prepare-run7-chain from accepted evidence (Candidate aba9145d5a4c9c5a742bb53534c96c77940a9ce0).
- **Result:** Every declared acceptance criterion was accepted as met: "`rehearsal-chain/params/run7-2026-10-06.json` binds run 6's receipts exactly: reset run `20261006T141854Z-41044` (newHead 162f5b19), terminal Off run `20261006T160825Z-24828` (fixtureMain 6fbae8d6) and one candidate entry per integrated or preserved line of that G8's work-reconciliation (including PR #7 and stacked PR #8), with no UNFILLED value left; required commits include #1017 (3c67b0a8); descriptors re-render with no drift; the run-7 reset dry run is expected to plan moving the clone's local main from 6fbae8d6 back to GitHub main 162f5b19 only after verifying both run-6 candidates are preserved on GitHub, and never to push a base other than its single reset commit."; "The chain reset positions every reopened or created fixture Action in chain order through the governed `arcadia advance queue arrange` after its docs sync (keeping every other key's relative order), records the queue receipt in its receipt, and refuses if the queue is not `orderValid` with zero unpositioned afterwards; G6 refuses unless `orderValid` is true and `unpositionedCount` is 0; tests pin both (Issue #1015)."; "G6's Codex capacity check performs a fresh live read with a bounded retry before observing, and when the live read fails it names the failure (exit status or timeout) in the refusal instead of silently judging a stale cache (Issue #1016); tests pin both the success and the named-failure paths; the rehearsal-chain tests, `check:operator-scripts`, render `--check`, lint and tsc pass; the runbook names run 7; an independent review round is recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prepare-run7-chain-2026-10-06).

## 2026-10-06 — Completed arcadia/bound-variance-verdict-reruns

- **Did:** Completed Action arcadia/bound-variance-verdict-reruns from accepted evidence (Candidate 97c45f0662ec9121513a5d21b78a630c2b5349cc).
- **Result:** Every declared acceptance criterion was accepted as met: "The independent-review step classifies a non-PASS code-review or QA verdict as variance only when it has no finding other than refused not-applicable claims and no criterion judged fail (every non-pass criterion is not-applicable-refused or not-checked); for a variance verdict on the exact head the tick runs a fresh review of that same verdict kind at most 2 more times (3 attempts in total per verdict kind per head), recording each attempt and its classification; a verdict with any real finding or any criterion judged fail stops immediately with the existing `independent_verdict_failed` entry; a new head restarts the count; nothing else in review, readiness, integration, the Grant or Decision 0058 changes."; "`production status` and the worker log name each automatic rerun once (verdict kind, attempt n of 3, reason) and, when the bound is exhausted, one `independent_verdict_failed` entry that says the reruns are spent; the fast harness covers: a variance verdict then PASS integrates with no operator step; three variance verdicts stop on one visible entry; a real finding stops on the first attempt with no rerun; the stubbed reviewer counts prove no extra reviewer call beyond the bound."; "`pnpm fast-rehearsal`, lint, tsc, check:agent-guidance and the focused review suites pass; the runbook (sections 1 criterion 4, 3, 6 and the failure catalog) records the operator's 2026-10-06 choice and the new bound; Issue #1018 is updated; independent review rounds are recorded on the pull request, and the merge waits for the operator because it changes the repair budget.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-bound-variance-verdict-reruns-2026-10-06-v2).

## 2026-10-06 — Completed arcadia/prepare-run8-coherent-chain-fixture

- **Did:** Completed Action arcadia/prepare-run8-coherent-chain-fixture from accepted evidence (Candidate cb9cc8a854db92620f50188da29cf1b3570c053f).
- **Result:** Every declared acceptance criterion was accepted as met: "The chain reset renders every fixture managed-document statement of the chain's size and purpose for the run's N (at least the fixture PROJECT.md outcome or mission text and the Plan title, goal, milestone and token_budget lines; a rendered Plan title such as 'Autonomous nine-Action rehearsal chain'), validated by Arcadia's own discovery and the dry-run docs sync exactly as today, changing no Action criteria, statuses, responsibilities or the genesis check, and committing it in the reset's single commit; if fixture PROJECT.md must change, its governed pointer and status fields are left untouched."; "A deterministic coherence guard, run in both the reset (real and dry run) and G6, refuses when any fixture managed document (PROJECT.md, the Plan, the Actions' text) states a number of Actions or a rehearsal size other than the run's N (for example 'three-Action' or 'three dependent Actions' with N=9), naming the file, line and text; unit tests pin it for N=3 and N=9 and against run 7's actual fixture state at f478438 (which must refuse for N=9)."; "`params/run8-2026-10-06.json` (N=9) binds run 7's receipts exactly: reset `20261006T173810Z-40687` (newHead f478438a), terminal Off `20261006T175308Z-12860` and one candidate per integrated or preserved line of its work-reconciliation (including run 7's PR #9), with required commits including #1019 (c26f3a9e) and #1020 (98b532a1); descriptors render with no drift; the rehearsal-chain tests, `check:operator-scripts`, render `--check`, lint and tsc pass; the runbook names run 8 and the coherence guard; an independent review round is recorded on the pull request.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-prepare-run8-coherent-chain-fixture-2026-10-06).

## 2026-10-06 — Completed arcadia/record-rehearsal-findings-ledger

- **Did:** Completed Action arcadia/record-rehearsal-findings-ledger from accepted evidence (Candidate 45fd846e4a88f032ff7c3ec9ff72ae4257882c03).
- **Result:** Every declared acceptance criterion was accepted as met: "docs/autonomous-production-rehearsal-runbook.md gains a findings ledger (one row per live run and per pre-flight smoke since run 1, each with stop point, failure class, time to detect, fix PR or Issue, and the prevention that now guards it), records runs 6 and 7 and the run-8 reviewer smoke with their receipts and PRs, and states the protocol every future run follows to append its row before the session ends."; "The runbook gains a handoff section naming the exact current state (production Off, last receipts, next run id and its parameter file, open Issues blocking success) and the ranked recommendations for the next run, so a fresh session can start from it alone."; "The reviewer pre-flight smoke harness used for #986 and the run-8 check is preserved under docs/reports/rehearsal-reviewer-smoke/ with a README saying what it simulates, what is not faithful, how to run it read-only, and that it is reference code not yet wired into the operator scripts.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-record-rehearsal-findings-ledger-2026-10-06).

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1040

- **Did:** The seven-file baseline-symlink preservation repair is published in draft PR1040; independent review and required CI are running: https://github.com/pmark/arcadia/pull/1040
- **Result:** Required PR lifecycle notification; source delivery under approved Decision0091. No runtime or production change.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-ready-arcadia-pr1040-packet-safety-correction-2026-10-07

- **Did:** PR1040 preserves the approved seven-file repair and all seven CI checks pass, but independent review reproduced a validation bypass (Issue1041). It remains draft; the original delivery approval is fulfilled. A narrow changed-packet correction is needed to reject symlinked executable checks safely: https://github.com/pmark/arcadia/pull/1040
- **Result:** Required PR blocker notification; no original approval is reasked, no installation, production or new writer is authorized.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1042

- **Did:** The operator to-do list Plan is now a governed draft: 9 Actions in 3 parallel batches, with supervisors waiting for your green light. https://github.com/pmark/arcadia/pull/1042 (tracking Issue https://github.com/pmark/arcadia/issues/1043)
- **Result:** PR lifecycle notification on open, per docs/agent-guidance/pull-requests.md. Signed: Claudia Atlas <claudia.atlas@agents.arcadia.local> (claude/heavy).
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1048

- **Did:** A blog-style guide to Arcadia's planned harness engineering, ready to adapt into an AMC Guide page, is up for review: https://github.com/pmark/arcadia/pull/1048
- **Result:** PR lifecycle notification on open, per docs/agent-guidance/pull-requests.md. Signed: Claudia Atlas <claudia.atlas@agents.arcadia.local> (claude/heavy).
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Completed arcadia/record-standard-harness-rule

- **Did:** Completed Action arcadia/record-standard-harness-rule from accepted evidence (Candidate 61778a2649699cb91e0308dabe244cb7394ade7d).
- **Result:** Every declared acceptance criterion was accepted as met: "A short indexed procedure docs/agent-guidance/standard-harness.md states: a standard harness runs unmodified with Arcadia as its state, tools and instruction files; a new workflow is one checked-in instruction file plus existing commands, not orchestration code; every response Arcadia needs from the operator is raised through a source arcadia todo reads, and operator input enters through Ask or Ingress; judged outputs get a separate grader; handoffs go to files; and this Plan's deferrals with their revival triggers. It grants no new authority."; "The procedure contains a section 'Session protocol (by convention today)' of at most 40 lines that links docs/agent-guidance/agent-peer-watch.md rather than restating its grammar, covering: identity (one Session per <project>/<actionId>; declare the agent/tier identity from arcadia identity resolve in the session title, PR comments and commits); lease (work only from the claim arcadia go or the host gave; takeover only by an arcadia-peer-takeover-request-v1 with basis claim_released or principal_proven_terminal; release_requested and silence release nothing); reportable states (working, needs_input, handed_off, done; healthy, idle and stalled are watcher inferences, not declarations); heartbeat (hand-written Arcadia-Agent, Arcadia-Action and when known Arcadia-Claim and Arcadia-Heartbeat trailers on every commit, at least every 10 minutes while working); inactivity ping (before any turn that leaves supervised or claimed work inactive without a PR, picker or completion, run arcadia ping send '<agent/tier> <project>/<actionId> <needs_input|handed_off|blocked>: <reason>; resume: <command>' --kind attention --agent <agent/tier> --link <the related GitHub Issue URL, else the PR>, and a needs_input state also raises an item arcadia todo reads); handoff by file or Agent Ask naming agent/tier, claim generation and candidate revision, never chat; receipts (completion is a complete Ask with per-criterion evidence and candidate_revision; a PR, green CI or launched process proves nothing); and honesty (agents are surrogates for future deterministic processes and decision systems and follow the protocol as if enforced)."; "docs/agent-guidance/index.json gains one entry with a correct sha256 and triggers that do not duplicate existing entries (harness, orchestration, new workflow, instruction file, session, inactive, ping, handoff); a test or the existing guidance check fails if the Session protocol section is missing or its trailer keys differ from PEER_WATCH_TRAILERS; AGENTS.md and bootstrap budgets are unchanged; pnpm test passes. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-record-standard-harness-rule-20261008).

## 2026-10-08 — Completed arcadia/render-plan-progress-as-todo

- **Did:** Completed Action arcadia/render-plan-progress-as-todo from accepted evidence (Candidate 7335aaa926f083f58846a95400a3cd615de1a8f2).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia plans --plan <slug> [--all] [--json] prints, derived on every call from the Plan document with no store: a counts line (done, in progress, blocked, deferred, open, total), the current Action, the next five unfinished Actions, and blocked Actions with their recorded reason, as a Markdown checklist (- [x], - [ ], - [!]); --all prints every Action. The current Action is PROJECT.md current_action for the active Plan; otherwise the first unfinished Action in document order whose depends_on are done, or 'none (Plan not active)'. Ordering is plan-document order constrained by depends_on and is stated as not the dispatch queue. Output states that done means the recorded Action status, not re-proven acceptance. --json emits a stable PlanProgress shape for later Flight Deck and GitHub projections."; "countActions in src/commands/plans.ts is exported and extended with a deferred bucket and reused rather than duplicated; the command stays workspace-free; arcadia path, arcadia now, the Flight Deck page and every GitHub surface are untouched."; "--json output carries schema 'arcadia-plan-progress-v1' and source { planSlug, planPath, updated } from the Plan's frontmatter. Each Action entry carries key <project>/<actionId> (the same key schedule uses), status (the Plan document's recorded status, unmapped) and dependsOn. The output states it is a derived one-way view whose statuses are the Plan document's, not the scheduler's board statuses, and nothing in it is read back. A test asserts key equals actionKeyOf(project, actionId) for every Action in a fixture Plan."; "Fixture tests cover a large Plan, deferred and blocked Actions, active versus inactive current-Action rules, dependency ordering and the JSON golden; type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-render-plan-progress-as-todo-20261008-r2).

## 2026-10-08 — Completed arcadia/raise-stale-triage-decision

- **Did:** Completed Action arcadia/raise-stale-triage-decision from accepted evidence (Candidate f0da4769316a935e51a470465ad02efa88976998).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia todo --stale --json for the Arcadia Project is saved as a list Artifact with each item's staleReason evidence, its sha256, and counts of stale, non-stale and unclassifiable items (intents that name no Action, and other Projects' items, which need their own Project's Decision and are named as a revival trigger). Superseded proposals agentask_3b07406ec8dc13e410 and agentask_58f7a77c2a4de8eab7 are included through the 'Supersedes:' line in the rationale of the settled Ask operator-todo-ask-pivot-20261008-v6."; "One Decision raised through the existing Decision writer asks whether to reject or resolve exactly the listed ids bound to that sha256, with each option's consequence; it appears in arcadia todo. Nothing is settled by this Action, and no Action status, pointer or queue changes.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-raise-stale-triage-decision-20261008).

## 2026-10-08 — Completed arcadia/apply-approved-stale-triage

- **Did:** Completed Action arcadia/apply-approved-stale-triage from accepted evidence (Candidate 0fec44bd0b06c00f792d55e64416169cae50d118).
- **Result:** Every declared acceptance criterion was accepted as met: "Only after the triage Decision is answered approving the list: each listed Agent Ask is settled rejected with the existing two-phase agent-ask settle and each listed review_item is resolved with the existing review writer, batched and serialized against fresh main per the settlement-conflict procedure, with one receipt per item; items whose state changed since the list's sha256 are skipped and reported. If the answer declines, nothing is settled and the answer is recorded."; "The before and after arcadia todo counts are recorded; no Action status, pointer or queue changes.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-apply-approved-stale-triage-20261008).

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1068

- **Did:** Stale triage is closed out: all 52 stale Asks are rejected (#1067 merged), and #1068 records both triage Actions done. The operator to-do Plan is now at 4 of 9. https://github.com/pmark/arcadia/pull/1068
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1069

- **Did:** arcadia todo now surfaces open Decisions first, newest on top, so a fresh Decision never hides behind old Asks again. https://github.com/pmark/arcadia/pull/1069
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1070

- **Did:** Discord free-text now honors DISCORD_ALLOWED_USER_IDS (fail-open with a warning when unset), and replies record the Discord author as actor. Needs a bot restart by Mark after merge. https://github.com/pmark/arcadia/pull/1070
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1071

- **Did:** Your morning packet will now open its to-do with counts and every blocking item plus the command to answer it, and escalations go first. https://github.com/pmark/arcadia/pull/1071
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1072

- **Did:** arcadia todo now also lists open review items, including clarification questions with a ready-to-run answer command, so they stop hiding in a separate queue. https://github.com/pmark/arcadia/pull/1072
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1073

- **Did:** New arcadia ask show --coverage reports, per surface, how much operator input reached Ask or Ingress, and says plainly that direct chat is not measured. https://github.com/pmark/arcadia/pull/1073
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1076

- **Did:** arcadia todo now shows stalled-production escalations first and waiting operator tasks, so the morning packet can say exactly what stopped overnight. https://github.com/pmark/arcadia/pull/1076
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Completed arcadia/capture-operator-decision-replies-as-asks

- **Did:** Completed Action arcadia/capture-operator-decision-replies-as-asks from accepted evidence (Candidate b647e35663a472661a0ec28c3fe2b8e8e929b7e5).
- **Result:** Every declared acceptance criterion was accepted as met: "One fail-open helper calls the existing captureAskEnvelope for free-text operator replies at review resolve-reply (src/commands/review.ts), decision approve when free text accompanies the answer (src/commands/decision.ts), and the dashboard work-question route; Discord replies to Decision notifications reach the same helper through those commands. requestId is <surface>:<entity-id>:<sha256(text) first 12 hex>, originalText is the exact reply, and ingressSource comes from a small documented vocabulary in which each source is marked intake or provenance-only; these replies are provenance-only. The helper is skipped when the caller already holds a capture id (the arcadia ask reply path), so one reply yields one envelope. Capture failure is logged and never blocks or changes the canonical write. The capture id goes into the existing event or receipt payload; an existing capture_id column is never overwritten. The helper accepts optional actor ({ id }, set only when the calling surface authenticates a principal, today the Discord author id passed through a new --actor option on review resolve-reply) and optional project (slug, only where the call site already holds it). Both are stored in envelope_json only and excluded from the fingerprint, so replay returns the first stored envelope and never throws on an actor mismatch; CLI and dashboard replies record actor null and no id is invented."; "The Discord free-text message path newly enforces DISCORD_ALLOWED_USER_IDS in messageCreate isAllowedMessage when it is configured, with the router's refusal reaction; when it is empty the bot keeps guild and channel gating and logs a startup warning, so the operator is never locked out by an unset value."; "A read-only coverage report (ask show --coverage or an ask-trail aggregate over existing tables, no new store) states, for a time window and per surface, captured operator inputs over canonical operator writes for surfaces with an independent countable canonical record (review and Decision replies, Ingress files). The numerator counts only sources marked operator intake; agent.ask and codex.* envelopes are excluded and reported separately. Discord messages, chat and other surfaces without an independent record are reported as captured N with denominator unknown, and the report headline states 'direct chat: not measured' so the metric cannot be read as the share of all operator input."; "Tests prove each wrapped surface creates exactly one envelope per distinct reply, replay is idempotent, a capture failure leaves the canonical write unchanged, the allowlist behaves as specified when set and unset, and the coverage math, and that a replay of the same reply with a different actor returns the original envelope unchanged; type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-capture-operator-decision-replies-as-asks-20261008).

## 2026-10-08 — Completed arcadia/grade-next-actions-before-actionable

- **Did:** Completed Action arcadia/grade-next-actions-before-actionable from accepted evidence (Candidate 1e64e712286c859e66f82f0dff455cade65a326c).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia ask marks the work_items it creates unclarified, and the clarify generator schema gains a doneCondition field that is required on the clarified branch, enforced by normalizeVerdict and the deterministic lint rather than by schema validation (a schema-invalid reply would become a failed job that the idempotency key keeps reusing); normalizeVerdict (src/clarify/engine.ts) downgrades a clarified verdict lacking one to question_open with the existing gapType missing-success-criteria and exactly one question."; "Before recording clarified, a deterministic lint (non-empty doneCondition; nextAction starts with a verb; every file path, Action or Decision id and command name it mentions appears in the source material, which includes the prior clarification answer) and then a separate grader run. The grader is its own instruction file .agents/skills/next-action-grader/SKILL.md (symlinked from .claude/skills, reported as an external boundary if the sandbox blocks the link, and listed in docs/using-arcadia-skills.md) executed as its own local-preferred Intelligence call with a different prompt that never receives the generator's confidence, using a distinct model profile when one is configured and otherwise documenting that only prompt independence is claimed. It checks: concrete verb; first physical step startable by the named actor in under 15 minutes; observable done-condition; no invented facts; and when information is missing, a request for exactly that one item. Only a pass records clarified; a fail records question_open through the existing clarify --apply path (an ActionClarification review_item), so the single question appears in arcadia todo."; "When the operator answers an ActionClarification at the CLI with review approve <id> --answer <text> --clarify or review resolve-reply <reply> --id <id> --clarify (a new opt-in flag that arcadia todo prints in its answer command), the answer is made durable and then clarify --work <id> --apply runs once; without the flag, and on the Discord and dashboard paths (which re-clarify themselves), no clarification is triggered, so nothing runs twice. When a passing verdict's actor is a coding agent and the work_item has a capture_id, clarify --apply drafts one strict v1 Agent Ask (intent action, request_id handoff-<work_item_id>-<first 12 hex of sha256(nextAction + doneCondition)>, rationale naming the capture envelope and work_item ids, acceptance from the done-condition) into the Project repository's .arcadia/asks/ through the existing draft writer (runAgentAskDraftCommand). Drafting is skipped, with the reason reported, when the work_item's Project has no repo_path or a proposal with that request_id already exists, including one already settled and archived. That draft is the file handoff; it appears in arcadia todo as a pending proposal, and clarify itself writes no Action status, pointer or queue."; "Each grader verdict is stored as a receipt in the existing clarification record (no new table) with grader identity (model profile id or agent reference), prompt sha256, input sha256 and verdict, and the golden set's README states it is the contract any deterministic replacement grader must pass. A checked-in golden set of at least 10 hand-written cases (next action, done-condition, source, expected pass or fail with reason) runs in tests against the lint and a stubbed grader; tests also cover ask marking unclarified, missing done-condition, grader fail-with-question, grader-unavailable leaving the item unclarified, CLI answer re-clarify, and idempotent handoff Ask drafting. Dry run stays the default and grading never escalates to a paid model. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-grade-next-actions-before-actionable-20261008).

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1077

- **Did:** The /runs approvals section is now the To-do list fed by arcadia todo, with stale items folded away and every settle control unchanged. https://github.com/pmark/arcadia/pull/1077
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Agent Ask pr-opened-arcadia-pr1081

- **Did:** arcadia todo now also surfaces Plan Actions waiting on you and unclarified captures with a ready clarify command. https://github.com/pmark/arcadia/pull/1081
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-08 — Completed arcadia/point-operator-surfaces-at-todo

- **Did:** Completed Action arcadia/point-operator-surfaces-at-todo from accepted evidence (Candidate 21027ee3290b936b8927ad6d2ce620f049dd8559).
- **Result:** Every declared acceptance criterion was accepted as met: "The dashboard approvals page reads arcadia todo --json --all: Decision and Agent Ask rows keep today's settle controls and POST paths unchanged, while review, ledger and Action rows appear read-only with their answer command, so the phone-friendly dashboard shows the one list. The Flight Deck page and needs-you scoring are untouched. Parity tests prove every Decision and Ask the old loaders returned still appears with its options."; "The morning orientation packet gains an optional operatorTodoLines input fed the way workSafetyLines is (src/orientation/composer.ts, src/commands/orientation.ts), showing the to-do counts and each blocking item with its answer, escalation items first so the packet states what stopped production overnight, degrading to 'to-do unavailable: <reason>'; it is delivered through the packet's already-live path with no new message type, channel or schedule."; "Tests cover the approvals reader and the packet line including degradation; the PR includes runnable operator QA steps; type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-point-operator-surfaces-at-todo-20261008).

## 2026-10-08 — Completed arcadia/build-operator-todo-list

- **Did:** Completed Action arcadia/build-operator-todo-list from accepted evidence (Candidate e71bee31914f2c44a047a6527fe6e57e904a3da8).
- **Result:** Every declared acceptance criterion was accepted as met: "arcadia todo [--json] [--all] [--stale] [--project <slug>] is a read-only derived view with no new store and never mutates anything. Per Project it computes the selected Action and ready set the way arcadia next does (resolveDispatch, resolveReadySet and resolveOperatorGate under a read-only database), then composes: open Decisions and pending Agent Ask proposals classified blocking or alert by the existing classifyOperatorItems/resolveOperatorGate; open and deferred review_items (covering ActionClarification); waiting operator-task ledger items; production_operator_escalations rows read-only (one item per Action, kind escalation:<kind>, title from message, answer from remedy, always blocking, createdAt from first_detected_at, deduped against a listed Decision named in the message), so a stalled production loop appears even when no Decision or Ask exists; non-done work_items with clarification_status unclarified, a capture_id and no open review_item, as alert items of kind clarify whose answer is arcadia clarify --work <id> --apply; and Plan Actions only when requires_review, question_open or a readiness blocker names an operator step, excluding Project-pause states. It dedupes review_items by work_item_id and by doc_ref against open Decision documents, ledger items and Actions against the Decision or review_item that already represents them."; "Blocking is true only for an item that is the selected Action's operator gate (a blockingDecisionId, a requiredDecisionId or deferringDecisionId of a ready-set candidate, the selected Action's own operator reason, or a review_item or ledger item linked to one of these); everything else is an alert. Each item carries key <kind>:<source-id>, kind, title from the source's own field (nothing synthesized), project, blocking, origin, createdAt, staleReason when stale, and answer: the exact existing canonical command (for an Agent Ask, the two-phase settle preview command) and, where one exists, the existing Discord reply or dashboard path. --json output carries schema 'arcadia-todo-v1' and asOf (ISO timestamp and workspace name), and every item carries sourceRef (the canonical file path, or table and id). Blocking comes from resolveOperatorGate or the escalation row and is never recomputed. Decision and Agent Ask items also carry gateQuestion, options with consequences, and evidence. The doneWhen rule per kind is documented in help and START_HERE.md, not stored."; "Stale means positive evidence only: an Agent Ask of intent complete, split, or action with a target_ref is stale when every Action it targets exists in a Plan of its Project with status done; an Ask naming only absent Actions is an un-adopted proposal and never stale; supersession counts only through an explicit line 'Supersedes: <proposal ids>' in the rationale of an Agent Ask, read from its stored proposal; a Decision is stale when its action is done; a review_item is stale when its work_item is done or its doc_ref names an answered Decision. The default view prints a counts line (blocking, other, stale hidden, per kind), every blocking item, then at most 5 other items ordered with open Decisions first, newest first, then every other item oldest first; --all and --stale show the rest, and the default view ends with 'N more: --all'. Projects without a repo_path and fixture Projects whose slug contains 'rehearsal' or whose repo_path lies under the OS temp directory or ~/tmp appear only as a counts line, except that their blocking items are still listed and counted, so a stalled production loop is never hidden. With no resolvable workspace it prints the repo-local sources plus one explicit 'workspace sources unavailable: <remedy>' line, never a silently partial list; Decisions raised only on unmerged candidate branches are a documented limit."; "Fixture tests cover one item per kind (including one operator_gate_pending and one repair_budget_exhausted escalation, and an escalation whose gate is also a listed Decision shown once), all dedup rules, positive-evidence staleness including an un-adopted proposal that stays visible, the blocking rule, ordering and cap, fixture-Project grouping, the degraded no-workspace output and a JSON golden; type, lint and build pass; START_HERE.md documents arcadia todo. A pushed PR with exact-head independent review and all required checks is the delivered Artifact; LOCAL ONLY or an unresolved blocker is labelled explicitly.".
- **Next:** Advanced to the next eligible Action in the explicit queue order.
- **Blockers:** None recorded by this settlement (Agent Ask complete-build-operator-todo-list-20261008).

## 2026-10-09 — Agent Ask pr-opened-arcadia-pr1094

- **Did:** PR #1094 is up: go-broker install now keeps a top-level default_permissions when it retires sandbox_mode, so Codex never again refuses to load your config, and status flags it if missing (Closes #1093). https://github.com/pmark/arcadia/pull/1094
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-09 — Completed arcadia/stop-asks-vanishing

- **Did:** Completed Action arcadia/stop-asks-vanishing from accepted evidence (Candidate e776d359a0c3dd94bd6f70abfad9539e66276e54).
- **Result:** Every declared acceptance criterion was accepted as met: "Behind a config flag ask.routing.v2, which defaults on and can be turned off to restore today's routing, an operator Ask that matches no execution pattern goes to Clarify First instead of the Back Burner. Clarify First means a review_item that arcadia todo lists, carrying an ask-origin answer command. The Back Burner still receives an Ask only when the intake classification is Idea or the operator passes --back-burner. A Review Response with no resolvable reference also goes to Clarify First. Agent-sourced Asks (agent.ask envelopes) keep today's routing. Only a whole message that exactly matches a closed acknowledgement list ('thanks', 'thank you', 'ok', 'okay', 'got it', 'ack', or emoji only; a bare 'done' is not suppressed because it may be a completion report), after trimming whitespace and punctuation and ignoring case, creates no new question. So does an exact duplicate of an open Ask question within 24 hours. Their receipts say why, and the report counts them as suppressed, apart from the vanish rate. A message such as 'ok, ship X' is never suppressed."; "The intake patterns in src/intake/index.ts recognise 'I should be able to', 'I want (to be able) to', 'let me' and 'it would be good if'. With these, the operator's example 'I should be able to Ask Arcadia to schedule a recurring action' is captured as work. Intake also records two deterministic flags in extractedFields. recurrence is set when the text says every, daily, weekly, monthly, recurring or schedule. planning is set when the existing planningRecommended pattern matches. ask_requests stores both flags so the report can count them."; "arcadia todo renders two section headers. 'Yours' holds the existing operator items and a 'Your Asks need one answer (N)' group: the newest 5 Ask-originated questions, with the full count always shown and never hidden by the other-items cap. 'Agents are doing' is one count line of in-flight agent work, naming arcadia todo --agents, which this Action adds to list that work. A counts line reads 'Back Burner: N incubating (M new in 7 days)'. The morning packet counts the Ask questions. Existing Back Burner items are not moved or changed. With no resolvable workspace, the degraded output states that Ask questions and Ask-origin tasks are unavailable."; "Tests cover:
- the routing change for each classification;
- the review-reply fallback;
- the new phrasings;
- the recurrence and planning flags;
- trivial-acknowledgement and duplicate suppression;
- an agent-sourced Ask keeping its route;
- the flag-off rollback;
- both todo sections and the counts line.
Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.".
- **Next:** Next ready Action in this inactive Plan: prove-operator-request-to-started-work.
- **Blockers:** None recorded by this settlement (Agent Ask complete-stop-asks-vanishing-20261009).

## 2026-10-09 — Completed arcadia/ask-receipt-and-one-reply-correction

- **Did:** Completed Action arcadia/ask-receipt-and-one-reply-correction from accepted evidence (Candidate 100087cb70ea4d72136d240282d84442eb63241c).
- **Result:** Every declared acceptance criterion was accepted as met: "Every arcadia ask result, from the CLI and in the Discord bot's reply, opens with one line before any detail: 'Heard: <type> (<confidence>, <rule|memo|model>) -> <what was created and where> . wrong? reply type: work|idea|answer|status'. The stewardship detail stays available with --verbose or --json."; "arcadia ask correct <ask_id> --type <work|idea|answer|status> [--project <slug>] re-routes the Ask only through the existing governed writers: create a work_item, create a review_item, or promote or archive a Back Burner item. It links the new record to the old as superseded and never deletes the original capture or record. In Discord, a reply to an Ask receipt that starts with 'type:' or 'project:' calls the same command. A correction to 'answer' requires an explicit reference to a pending item. That reference goes through the existing review resolve-reply writer and its validation, and from Discord is accepted only when DISCORD_ALLOWED_USER_IDS is configured and includes the author. Otherwise the correction is refused, so a correction never answers a Decision by inference or for an unverified author. The 'task' target is added by ask-do-for-me-operator-tasks."; "ask-trail (arcadia ask show) displays the supersession. Tests cover each correction target, the refusal of an answer correction with no reference or an unverified author, and the Discord reply path. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.".
- **Next:** Next ready Action in this inactive Plan: prove-operator-request-to-started-work.
- **Blockers:** None recorded by this settlement (Agent Ask complete-ask-receipt-and-one-reply-correction-20261009).

## 2026-10-09 — Completed arcadia/ask-corrections-stick

- **Did:** Completed Action arcadia/ask-corrections-stick from accepted evidence (Candidate 2bc7376b1937f84b2dabbec96249d40644fb5518).
- **Result:** Every declared acceptance criterion was accepted as met: "An additive migration creates ask_corrections with columns ask_request_id, normalized_text, text_hash, predicted_type, corrected_type, corrected_project, source and created_at, with no cascade delete. It also adds nullable confidence and corrected_type columns to ask_requests. Each correction row is written in the same transaction as the re-route, so a correction cannot exist without its memo."; "A memo stage runs before the intake patterns. An operator Ask whose normalized text exactly matches a stored correction routes to the corrected type and Project, and its receipt says '(memo <date>)'. There is no fuzzy matching. An answer to an ask-origin clarification question also writes a correction row. Only operator corrections (source cli, discord or answer) are used as memos. Rows recorded from a model re-route are never used as memos. Raw Ask text stays in the workspace database and is never written to any repository."; "Tests cover the transactional write, a memo hit on the identical Ask, a miss on different text, and the no-cascade guarantee. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.".
- **Next:** Next ready Action in this inactive Plan: prove-operator-request-to-started-work.
- **Blockers:** None recorded by this settlement (Agent Ask complete-ask-corrections-stick-20261009).

## 2026-10-09 — Agent Ask pr-opened-arcadia-pr1120

- **Did:** The North Star stops claiming production is live: PR #1120 makes gates follow split remainders (now 3/4, with the open proof step named) and shows the target's why on /now and /path. https://github.com/pmark/arcadia/pull/1120
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-09 — Agent Ask pr-opened-arcadia-pr1147

- **Did:** PR #1147 makes /production feel instant: the queue now says "Reading the queue… N s" instead of blank grey bars, core polls answer in milliseconds instead of 2.5-5 s, and a services restart pre-warms the page. https://github.com/pmark/arcadia/pull/1147
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-09 — Agent Ask pr-opened-arcadia-pr1153

- **Did:** /runs is officially retired: PR #1153 records that /production, /actions, /review and the coming /todo replace it, so no agent builds there again. https://github.com/pmark/arcadia/pull/1153
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-09 — Agent Ask pr-opened-arcadia-pr1157

- **Did:** Every step on the path now says why it matters and links to its Action: PR #1157 adds an optional why on Actions plus derived reasons like Unblocks X. https://github.com/pmark/arcadia/pull/1157
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-09 — Agent Ask pr-opened-arcadia-pr1170

- **Did:** The governed-roles plan is up: PR #1170 opens 13 Decisions (role name, delegation broker, supervisors, burn budget, operator reserve, /agents) and an 18-Action draft Plan that passed 3 critic rounds. https://github.com/pmark/arcadia/pull/1170
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-09 — Agent Ask pr-ready-arcadia-pr1170-decision-answer-2026-10-09

- **Did:** Your call: PR #1170 carries Decisions 0100-0114, so it waits for your merge. Answer 0112 (role name), 0100 (taxonomy) and 0114 (who delegates) first to unblock Action 1. Note: 0105 and 0108 were older drafts I opened by mistake; answer or ignore. https://github.com/pmark/arcadia/pull/1170
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-10 — Agent Ask pr-opened-arcadia-pr1174

- **Did:** Your 13 governed-roles answers are recorded: PR #1174 approves every recommendation (Lead role, depth-1 delegation, 20% reserve, Discord presence proof). https://github.com/pmark/arcadia/pull/1174
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-10 — Agent Ask pr-ready-arcadia-pr1174-approval-boundary-2026-10-09

- **Did:** Merge is yours: PR #1174 records approved Decisions on approval boundaries (reserve, broker, presence proof, delegation), so it is not merged on green. Once checks are green, merging unblocks define-governed-role-registry for arcadia go. https://github.com/pmark/arcadia/pull/1174
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-10 — Agent Ask pr-opened-arcadia-pr1183

- **Did:** From now on every PR logs who did the work and what it cost: PR #1183 adds the 80/20 arcadia-work-metadata block (role, tier, size, gate, actual tokens and minutes). https://github.com/pmark/arcadia/pull/1183
- **Result:** Recorded the accepted Agent Ask as Project history.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.

## 2026-10-10 — Agent Ask activate-governed-agent-roles-2026-10-09

- **Did:** Activated governed-agent-roles-one-real-action-and-one-interactive-session-each-run-as-a at define-governed-role-registry.
- **Result:** Operator-settled Plan transition. Previous Plan bootstrap-managed-production-to-build-flight-deck remains draft with completion state preserved. The operator explicitly requested activation. Preserve the unfinished work in the existing active Plan and use the exact activation preview before applying.
- **Next:** Continue from the governed Project pointer and execution queue.
- **Blockers:** None recorded by this settlement.
