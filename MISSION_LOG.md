---
arcadia: v1
type: log
slug: arcadia-mission-log
project: arcadia
updated: 2026-08-30
---

# Mission Log: Arcadia

## 2026-08-30 — Made every open Decision findable by its governed number

- **Action:** `idea-to-managed-build#build-operator-attention-board`
- **Did:** Added a simple Needs you search across focused, parked,
  lower-priority, and historical items; projected the governed numeric id from
  document-backed Decisions; and displayed the Decision number on the detail
  card, compact queue rows, and excluded rows.
- **Result:** A synchronized Decision such as 0038 is findable by `0038`, its
  question, recommendation, or Project even when review focus excludes it.
  Database-native Decisions keep their existing `R…` number. Focused tests,
  both TypeScript builds, and the production Dashboard build pass. The live
  browser surface was unavailable on this host, so no visual-runtime result is
  claimed.
- **Next:** Answer Decision 0038 and the remaining open governed Decisions.
- **Blockers:** The app's native multiple-choice picker failed before rendering
  in this session; the same bounded choices must be collected through the
  documented text fallback unless the picker becomes available.

## 2026-08-30 — Built the governed tmux Session launch boundary

- **Action:** `idea-to-managed-build#launch-tmux-backed-session`
- **Did:** Added the thin workspace-owned Session receipt, immutable promoted
  packet and authority rechecks, one-repository lease, explicit Claude Code
  `--launch` path through Arcadia-owned worktrees and tmux, read-only Session
  view, and one total Project-transition resolver shared by `go`, bare
  `advance`, and the Agent Queue. Kept preview and manual launch non-spawning.
- **Result:** Both TypeScript builds, smoke, and all 1,117 tests pass. Focused
  fixtures prove launch, planning, operator Decision, repair, wait, and
  reconciliation behavior; tmux missing/collision/spawn failures; stable
  identifiers; liveness; exact reattach/resume instructions; stale packet,
  provider, authority, and base-revision refusal; and cross-repository leases.
  No real coding-agent process, transcript inspection, credential use, merge,
  deployment, publication, or messaging occurred.
- **Next:** Answer Decision 0038. If approved, run exactly one bounded real
  Claude Code detach/reattach/exit/resume rehearsal and record its evidence.
- **Blockers:** The remaining empirical dogfood criterion requires configured
  provider credentials, which Decision 0012 deliberately did not authorize.

## 2026-08-30 — Let the operator reassess stale Needs you questions

- **Action:** `idea-to-managed-build#build-operator-attention-board`
- **Did:** Added **Reassess** to document-backed clarification Decisions on
  Needs you and the matching `arcadia review reassess <id>` command. The
  transition checks the source plan, question id, plan status, and Project
  active-plan pointer before changing attention state. Added **Flag for agent
  review** and `arcadia review flag-agent <id>` to park still-declared questions
  in a dedicated Agent Queue lane without launching an agent.
- **Result:** A disconnected question such as PPN R53 leaves active operator
  attention while its Decision and reassessment receipt remain preserved in
  history. A question found in the active plan is labeled **Still declared**,
  not semantically validated, and can be moved out of operator attention for a
  later coding-agent assessment. Both actions make zero model calls and start
  no Run.
- **Next:** Review the Candidate through its pull request QA plan.
- **Blockers:** None.

## 2026-08-30 — Focused Needs you on current operator priorities

- **Action:** `idea-to-managed-build#build-operator-attention-board`
- **Did:** Added workspace-configured Review focus, bounded the visible set,
  moved explicitly parked Projects behind the history control, archived
  non-current packet and Run attempts after 30 days, collapsed superseded
  attempts for the same Action, and stopped showing a Run beside its canonical
  Review Decision. Added a compact page control for choosing primary and
  secondary Projects and parking distractions, with atomic workspace-backed
  auto-persistence rather than a Save step or browser-local state.
- **Result:** The operator workspace now focuses five items in Project order:
  Private Practice Now first, Arcadia second, with Rebuster parked. The real
  projection falls from 45 equally competing items to five focused items;
  every remaining open or historical record stays reachable through one
  explicit control and no evidence is deleted.
- **Next:** Use the focused PPN Decisions to remove the next concrete blocker;
  change the page's Focus control only when the operator changes priorities.
- **Blockers:** None. This changes presentation and priority only; it grants no
  execution, merge, deployment, or outbound authority.

## 2026-08-30 — Completed governed prepared-plan decisions on Needs you

- **Action:** `idea-to-managed-build#build-plan-approval-surface`
- **Did:** Projected each validated planning Artifact into a readable phone-width
  plan with its original idea, Milestone, ordered proposed Actions, Token Impact
  and Budget, target repository, and SHA-256 revision. Kept approval on the
  existing idempotent promotion path, required a named trigger for plan
  deferral, and replaced generic rejection with feedback-backed Send back.
- **Result:** Approve prepares the promoted build packet without starting a Run.
  Defer records its revival condition. Send back preserves the Artifact and
  returns the planning Action to the Codex queue with the operator's feedback.
  Every outcome records the judged Artifact id, path, and content hash on the
  Decision. Focused command and phone-width Playwright coverage pass; a 390px
  browser check found no horizontal overflow.
- **Next:** Advance `launch-tmux-backed-session`, using the promoted immutable
  packet and Decision provenance as the Session boundary.
- **Blockers:** None. Merge, deployment, release, credentials, spending,
  production access, and outbound messaging remain separately gated.

## 2026-08-29 — Ratified the thin, packet-bound Session primitive

- **Action:** `idea-to-managed-build#launch-tmux-backed-session`
- **Did:** Approved Decision 0012 after testing its proposed boundary against
  Arcadia, Private Practice Now, Rebuster, and the idea-to-new-Project path.
  Strengthened the answer so a Session is bound to the exact immutable packet,
  authority set, provider profile, and base revision; one repository has only
  one prepared or running Session lease by default; and `go`, `advance`, and
  the Agent Queue consume one exhaustive deterministic transition resolver.
- **Result:** A Project transition must now produce exactly one of launch,
  plan, Decision, repair, reconcile, wait, or Milestone completion. Refusing
  unsafe execution is no longer sufficient if Arcadia cannot also name or
  prepare the governed step that permits progress. tmux remains only the first
  reattachable terminal transport, and process success never accepts an Action.
- **Next:** Complete the current plan-approval surface, then implement the
  shared transition resolver and packet-bound repository lease as the first
  part of `launch-tmux-backed-session` before adding tmux process launch.
- **Blockers:** None in the Session definition. The three empirical provider-UI
  questions in Decision 0012 remain dogfood checks rather than architecture
  choices.

## 2026-08-29 — Closed the accepted-plan-to-build handoff

- **Action:** `idea-to-managed-build#promote-accepted-plan`
- **Did:** Added a deterministic promotion path specifically for software ideas
  captured through `arcadia project prepare`. Acceptance revalidates the exact
  planning packet and Artifact, extracts the already-required smallest useful
  follow-up goal, marks the planning Action done, writes one clarified current
  Codex Action into the authoritative plan, syncs it, and prepares one immutable
  build packet without starting a Run.
- **Result:** The receipt preserves the source idea, planning Artifact,
  Validation result, acceptance Decision, repository, selected build profile,
  packet hash, and exact explicit build trigger. Re-acceptance is idempotent;
  changed output fails closed; and a persistence failure restores both managed
  pointers. Focused promotion, project preparation, and legacy planning
  acceptance tests pass.
- **Next:** Build `build-plan-approval-surface`, now that its promotion
  dependency and the Needs you board are both complete. The tmux-backed Session
  slice follows the same prepared build packet after Decision 0012 is resolved.
- **Blockers:** Decision 0012 still gates tmux Session implementation. It does
  not block the current plan-approval surface Action.

## 2026-08-29 — Ordered tmux-backed Sessions into the managed-build path

- **Action:** `idea-to-managed-build#promote-accepted-plan`
- **Did:** Refined the open Session primitive Decision around a direct tmux
  transport and added two bounded Actions to the active plan: explicitly launch
  one thin recorded Session in Arcadia's existing isolated worktree, then
  reconcile its exit into the resulting Log, Decisions, Artifacts, Candidate,
  and next governed state without reading the transcript. Updated the
  orchestration vision and operating model to show where this fits. This is
  operator-directed follow-on planning, not claimed implementation progress on
  the current Action.
- **Result:** The dependency order is explicit: accepted-plan promotion first;
  tmux launch and reattachment second; post-exit reconciliation third; the
  phone plan-approval surface can then join that execution path before the full
  Candidate-and-QA loop. Decision 0012 remains open and gates both Session
  Actions, so planning does not silently authorize implementation.
- **Deferred:** Worker queueing reactivates after one real tmux-backed Session
  succeeds and a second Action needs unattended launch. Notifications
  reactivate when a completed or needs-input Session waits unnoticed or must
  be manually relayed. Analytics reactivate only when enough thin receipts
  exist to change planning or provider choice. Transcript capture, prompt
  injection, live progress, default-on launch, and a new supervisor are out of
  scope.
- **Next:** Complete `promote-accepted-plan`; then ask the operator to resolve
  Decision 0012 before dispatching `launch-tmux-backed-session`.
- **Blockers:** None for the current Action. The planned Session Actions are
  intentionally gated by open Decision 0012.

## 2026-08-29 — Completed the Needs you operator attention board

- **Action:** `idea-to-managed-build#build-operator-attention-board`
- **Did:** Extended the board's two-step consequence preview and receipt to
  standalone `codex_packet` and `run` items. Packet commands are no longer
  presented as if displaying a command granted authority: confirmation states
  that it records no Decision and starts no Run, then leaves the exact guarded
  command. Run handoffs state that they neither retry nor resolve the Run, then
  link to its durable detail record. Both item kinds now show the dominant
  ranking reasons when selected. Updated the normal-use guide and added focused
  browser tests that prove each confirmation leaves the underlying packet or
  failed Run unchanged.
- **Result:** `pnpm build`, `pnpm dashboard:build`, all 1,088 unit tests, and
  all 18 Playwright tests pass. The Action's acceptance criteria are met and it
  is `done`; `PROJECT.md` now points to `promote-accepted-plan`.
- **Deferred:** A reverse dependency-graph walk could make significance more
  precise than the current expected-Artifact unlock. Build it when an active
  attention item has at least two downstream dependent Actions whose relative
  ranking would change; until that trigger fires, the visible expected Artifact
  is the cheaper and truthful 80/20 measure.
- **Next:** Promote an accepted validated planning Artifact into the smallest
  governed build Action and immutable build packet without starting a Run.
- **Blockers:** None.

## 2026-08-28 — Closed the Needs you board's UI test-coverage gap

- **Action:** `idea-to-managed-build#build-operator-attention-board`
- **Did:** Added `tests/e2e/needs-you-board.spec.ts`, five focused Playwright
  tests exercising the confirm/consequence-preview/receipt flow this
  Action's acceptance criteria named: the empty state, a consequence preview
  that can be cancelled before it fires, a confirmed outcome (Reject) leaving
  a receipt naming the Decision and transition, a defer refused without a
  trigger and persisted with one, and confirmation that the dashboard's own
  older quick-defer lane still works untriggered. Also fixed the ranking
  regression the last entry's CI run surfaced: a resolvable Decision was
  losing to the failed run's own "blocked" status flag on score alone.
- **Result:** All 16 e2e tests (11 existing + 5 new) and the full 1088-test
  unit suite pass locally with the monorepo and dashboard both built. The
  approve-and-execute path still has no inline receipt by design -- it
  navigates straight to the started Run's own detail page, which is that
  path's existing durable record, already covered by
  `tests/e2e/mission-control.spec.ts`.
- **Next:** `codex_packet`/`run`-kind attention items still render via the
  older generic `AttentionCard` without the confirm/receipt treatment; their
  current actions are link/command-only rather than live approve buttons, so
  this remains a live but lower-priority gap. Downstream-dependency-based
  significance is still approximated by `expectedArtifact` presence.
- **Blockers:** None.

## 2026-08-28 — Built the Needs you board's ranking and typed confirmation

- **Action:** `idea-to-managed-build#build-operator-attention-board`
- **Did:** Still open — this is a partial slice. Added a pure ranking module (`apps/dashboard/lib/needs-you.ts`) that
  turns the existing attention-item feed into one dominant item plus a ranked
  queue, with visible urgency/relevance/significance/attention-cost reasons
  per item, and excludes deterministic `blocked_work` repairs from the active
  board with a stated reason. Rebuilt the `/review` route as the `Needs you`
  board on top of it and renamed the nav entry. Extended `ReviewCard` with a
  two-step confirm: every outcome now previews its consequence and the
  confirm control repeats the outcome, with a durable receipt shown after.
  Made Decision-defer require a named trigger end to end (API refusal, CLI
  `--trigger` flag, persisted into the Decision's own record) without
  touching Discord or dogfood's existing untriggered defer paths.
- **Result:** The core ranking/exclusion logic is real and unit-tested (5
  passing tests), the board renders and typechecks cleanly, and all 115
  existing review/CLI/dogfood/adapter tests still pass unmodified. Not done:
  focused tests for the UI's typed responses, consequence preview, receipt,
  and empty/failure states named in the acceptance criteria; codex_packet and
  run-kind attention items still render via the older generic `AttentionCard`
  without the new confirm/receipt treatment (their current actions are
  link/command-only, not live approve buttons, so this is a smaller gap than
  it sounds); and downstream-dependency-based "significance" is approximated
  by `expectedArtifact` presence rather than a real dependency graph walk.
- **Also judged:** The operator's proposal-signal folded-in scope (surfacing
  unresolved `type: proposal` `ask` signals on this same board) is out of
  scope for this Action. Decision 0025 explicitly reserves proposal
  ingestion/surfacing to `accept-upstream-proposals` on `way-delivery`
  (`status: draft`, not dispatchable), and this Action's own clarification is
  anchored to Decisions 0034/0036, which describe the Review-queue-to-board
  seam, not a new document signal taxonomy. Widening it here would exceed a
  clarified Action's scope without its own Decision. Recommend ratifying
  `way-delivery`'s planning status (or a new Decision) before that work
  starts; PPN's filed proposals (0001, 0003, 0004) remain visible today via
  `docs sync`'s existing foreign-document report, just not yet on this board.
- **Next:** Either continue this Action with UI-level test coverage for the
  confirm/receipt flow, or take the proposal-signal work through its own
  Decision/clarification before folding it in.
- **Blockers:** None for continuing this Action. The folded-in proposal-signal
  scope is blocked on a Decision, not on missing information.

## 2026-08-27 — Put the operator attention board first

- **Action:** `idea-to-managed-build#build-operator-attention-board`
- **Did:** Recorded Decision 0036 from explicit operator direction, promoted
  the existing blocking-question Review slice into the broader 80/20 `Needs
  you` board, and moved the Project pointer ahead of
  `promote-accepted-plan`. The clarified Action now requires one dominant
  operator-only item, a short ranked queue, visible urgency and temporal
  trigger, Outcome and release relevance, unlock significance, operator-minute
  and Token Impact estimates, recommendation and evidence, outcome-specific
  choices, consequence preview, and a durable state-transition receipt.
- **Result:** The attention board is now Arcadia's sole current Action and is
  dispatchable. Accepted-plan promotion, prepared-plan approval, Ask active
  sessions, and the remaining queue are preserved. Custom scoring, analytics,
  drag-and-drop, Kanban views, and general workflow abstractions remain outside
  the first slice.
- **Next:** Reuse the current Review projection and shared dispatch-readiness
  resolver to build and test the minimal phone-reachable `Needs you` board,
  updating `START_HERE.md` with the changed operator flow.
- **Blockers:** None. The operator authorized this documentation-only priority
  change and its local integration. It does not start an implementation Run or
  authorize push, deployment, publication, credentials, spending, production
  access, or outbound messaging.

## 2026-08-25 — Planned guided Arcadia Ask sessions from real Songbook friction

- **Did:** Converted the operator's Arcadia Ask direction into
  `docs/plans/arcadia-ask-active-sessions.md`: visible exact-prefix routing and
  processing receipts, one text/link/attachment capture envelope, the guided
  understanding session, preview-first rule management, and end-to-end
  `songbook` dogfood. Recorded Decision 0035 for the only unresolved issue —
  whether this plan activates immediately after living-system v1 review or
  after the previously promised `idea-to-managed-build` restoration.
- **Result:** The work now has five dependency-ordered Actions, observable
  acceptance criteria, bounded model use, explicit authority, an 80/20 first
  slice, and measured triggers for the expensive tail. It preserves a real
  routing-precedence failure as a regression case and makes the operator-liked
  guided understanding session the product anchor. The Arcadia work pointer is
  unchanged on `living-system-v1#dogfood-living-system-v1`; no implementation,
  model Run, workspace rule write, foreign-repository edit, merge, deployment,
  publication, credential use, spending, or messaging occurred.
- **Next:** The operator resolves the current living-system walkthrough, then
  answers Decision 0035. The recommendation is to activate Ask active sessions
  before restoring `idea-to-managed-build/promote-accepted-plan`.
- **Blockers:** Implementation is not authorized while the current Action is
  `requires_review` and Decision 0035 is open. The plan itself is complete as a
  draft Artifact.
## 2026-08-25 — Accepted the living-system v1 operator review

- **Action:** `living-system-v1#dogfood-living-system-v1`
- **Did:** The operator explicitly accepted living-system v1. Arcadia and Private Practice Now retain their authoritative, isolated manifests and generated Arcadia1-vault presentations; the established preview/apply, link, source-reference, frontmatter, Canvas, test, build, and no-model proof remains the acceptance evidence. The operator identified that the Dashboard has no acceptance control for this document-owned `requires_review` Action; that product gap is not represented as a v1 living-system miss or silently added to its scope.
- **Result:** `living-system-v1` is complete. Its `current_action` is removed, `dogfood-living-system-v1` is done, and the sole Project pointer resumes `idea-to-managed-build#promote-accepted-plan`.
- **Next:** Promote an accepted planning Artifact into one governed build Action and immutable build packet without a manual document translation.
- **Blockers:** None for the pointer transition. A dashboard control for accepting document-owned operator reviews requires separately governed product work.

## 2026-08-25 — Decided what the Review page and the QA verdicts are for

- **Did:** The operator reported that clicking Pass, Fail, or Needs follow-up changes nothing visible on a QA card, and that the Review page has never earned a visit. Both are true and both are structural. `loadQaCandidates` builds cards from `config/qa-targets.json` plus git freshness and never reads a recorded verdict back, so a card is byte-identical before and after judgment; `runQaRecordCommand` resolves its review item in the same transaction, so it enters no queue; Fail and Needs follow-up both resolve to the demo hero's `qa_failed`, differing by one sentence; and the QA note reaches only the narrative digest composer. `/review` renders all 24 open items flat — every one an `ActionClarification`, none stating what it blocks. Recorded Decision 0034 with the operator's two choices, and queued four Actions: `bind-qa-cards-to-verdicts` and `give-qa-verdicts-consequences` in `demo-first-delivery`, `scope-review-to-blocking-questions` and `build-plan-approval-surface` in `idea-to-managed-build`.
- **Result:** Decision 0034 approved and validated; both plans parse; `docs sync` applied 9 created records with 220 unchanged. Documentation only — no code changed, no implementation started, and the work pointer was deliberately left on `living-system-v1#dogfood-living-system-v1`.
- **Next:** Not this. `arcadia next --project private-practice-now` names `populate-pilot-record-from-notes`, responsibility `requires_review` — the operator must run `apps/intake` locally and fill the worksheet from real consultation notes. PPN's two ready Codex Actions are starved for that record until it exists, and none of the four Actions queued here sit on PPN's launch path.
- **Blockers:** None for this change. PPN's critical path is blocked on operator action, not on any agent or decision.

## 2026-08-24 — Gave Decisions a validated authoring command instead of hand-written frontmatter

- **Did:** Two Decisions this week (0014, 0033) shipped with invalid frontmatter — one approved with no `answer`, one with an out-of-enum `gap_type` — both caught only after the fact by a full `docs sync`/`next` run. Added `arcadia decision new`, `arcadia decision approve`, and `arcadia decision validate` (`src/commands/decision.ts`), which write or edit exactly one `docs/decisions/*.md` file and validate it with the same single-file `parseDoc` the dispatch path already trusts, before anything touches disk. `new` auto-assigns the next sequential id and quotes any field containing a colon; `approve` sets `status`/`answer`/`decided` in place without disturbing other fields or their order; `validate` checks a hand-edited file with no write and no full crawl. Extracted the frontmatter-quoting helper (`yamlScalar`) out of `project.ts` into `src/docs/frontmatter.ts` so both callers share one implementation.
- **Result:** 10 new focused tests (`tests/decision-command.test.ts`) cover auto-incrementing ids, colon-quoting, kebab-case slug rejection, out-of-enum `gap_type` rejection, in-place approval, slug-or-id lookup, missing-answer refusal, and validation of a hand-broken file — all passing. Full suite passes 985 tests with 6 skipped; typecheck and core+Discord builds pass. No model call anywhere in the path.
- **Next:** None required; this is a standalone tooling addition. Future Decisions should be authored through this command rather than by hand.
- **Blockers:** None. No merge, deployment, credential use, or production access; this only changes how Decision markdown files get written.

## 2026-08-23 — Repaired the Decision 0014 frontmatter blocking dispatch

- **Action:** `living-system-v1#dogfood-living-system-v1`
- **Did:** Repaired the control document blocking dispatch of that Action; the Action itself is untouched and still awaits operator review. `arcadia advance queue` and `arcadia next` both refused with one blocker: `docs/decisions/0014-tappable-operator-questions.md` carried `status: approved` with no `answer` field, so ratification lived only in the document's prose Resolution and not in the field the validator reads. Added `answer` (the ratified recommendation plus the named deferral trigger, quoted so the embedded colon parses) and `decided: 2026-08-22` to match the house frontmatter shape used by Decisions 0031 and 0032, and retitled the now-stale `## Decision (proposed)` and `## Consequences if approved` headings to match the approved state.
- **Result:** `arcadia next` validates cleanly; its remaining line is `Not dispatchable: responsibility is "requires_review"`, which is the correct state rather than a defect. Documentation-only change; no code, schema, or command behavior touched, and no model call made.
- **Next:** The operator opens `docs/living-system-v1-demo.md` and performs its two-minute Arcadia and Private Practice Now walkthrough, recording whether the ten-second, one-click, two-minute, and auditability bar is met. Nothing a coding agent may do advances `dogfood-living-system-v1`.
- **Blockers:** Operator perceptual acceptance, unchanged. No merge, deployment, publication, credential use, or production access.

## 2026-08-21 — Delivered both living-system stories for perceptual acceptance

- **Action:** `living-system-v1#dogfood-living-system-v1`
- **Did:** Added the real Arcadia manifest and a bounded Private Practice Now manifest on its own isolated branch and draft PR #54; preserved PPN's current pointer while adding explicit source references for its current calibration Action; made legacy optional-source parse failures visible as validation Signals; generated both presentations in the configured Arcadia1 vault; installed and enabled the Decision-authorized Mindmap NextGen 1.16.0 release with checksums and a preserved rollback record; and wrote the exact morning walkthrough in `docs/living-system-v1-demo.md`.
- **Result:** Arcadia presents 8 Topics, 63 Action episodes, 70 Signals, and 81 files. PPN presents 10 Topics, 61 episodes, 97 Signals, and 80 files. Both previews agreed with apply and subsequent refreshes rewrote nothing. Deterministic QA resolved 880 WikiLinks, 168 existing source links, 4 transclusions, both Canvas files, all generated markers, and both current-Action impact paths with zero failures. Arcadia's full suite passes 957 tests with 6 skipped; core, Discord, and optimized Dashboard builds pass; PPN typecheck passes across 16 workspace projects.
- **Next:** The operator opens `docs/living-system-v1-demo.md`, performs its two-minute walkthrough, and records whether the ten-second orientation, one-click navigation, primary-journey comprehension, and auditability bar is met. On acceptance, restore the exact `idea-to-managed-build/promote-accepted-plan` pointer required by Decision 0032.
- **Blockers:** Only operator perceptual acceptance remains. Automated screen capture returned a black frame under the current macOS permission context, so no screenshot is misrepresented as proof. No merge, deployment, publication, production access, credential use, or launch state changed.

## 2026-08-21 — Integrated free living-system refresh into normal operation

- **Action:** `living-system-v1#integrate-living-system-sync`
- **Did:** Added `arcadia memory system sync` with required one-Project or all-active-Project scope, preview by default, explicit apply, standard JSON receipts, independent skips/refusals, and deterministic vault projection. Added best-effort refresh after explicit Action completion and accepted planning transitions, plus operator and generated guidance for authority, manifests, explicit Log links, Markmap, transclusions, Canvas, freshness, fallback, and rollback.
- **Result:** Preview performs no writes and agrees with apply; unchanged input does not rewrite bytes; one invalid Project does not stop `--all`; disabled memory stays silent; enabled refresh failures warn without reversing the completed transition. The focused integration tests pass 2/2, the full suite passes 956 tests with 6 skipped, core and Discord builds pass, and the optimized Dashboard build passes. Routine sync makes no model, network, paid-service, or plugin-installation call.
- **Next:** Dogfood governed Arcadia and Private Practice Now manifests, generate both stories, validate navigation and trust evidence, and prepare the morning demo proof.
- **Blockers:** Operator perceptual QA remains for the final Action. Foreign-repository edits and plugin installation retain their existing authority boundaries.

## 2026-08-21 — Made the capability map and Action timeline a real presentation

- **Action:** `living-system-v1#build-living-system-map-and-timeline`
- **Did:** Built the deterministic Obsidian projector for a Project Home, whole capability map, declared submaps, evolution timeline, Current Work, reciprocal Topic and episode notes, generated guide, and side-by-side Canvas. Added progressive glance/orient/understand/audit navigation, portable source links, provenance and freshness labels, and explicit gaps.
- **Result:** Preview and apply agree; unchanged models preserve exact bytes; changed files update atomically; unmarked and foreign collisions refuse before writes; removed generated content stays visible as stale; traversal and symlink escape fail; Canvas JSON and WikiLinks resolve; and Arcadia plus Private Practice Now remain isolated under their own Project subtrees. The focused projector suite passes 4/4, the full suite passes 954 tests with 6 skipped, and core, Discord, and optimized Dashboard builds pass.
- **Next:** Expose projection through preview-first `arcadia memory system sync`, add safe all-Project refresh and accepted-transition warning behavior, and document the operator path.
- **Blockers:** None. The projector does not install plugins, edit `.obsidian`, touch existing Arcadia memory Records/Ideas, merge, deploy, or edit the Private Practice Now repository.

## 2026-08-21 — Derived trustworthy living-system state without guessing

- **Action:** `living-system-v1#derive-living-system-state`
- **Did:** Added a deterministic assembler over the Project pointer, managed plans and Actions, explicit Log links, Decisions, and typed operational receipts for Runs, Artifacts, pull requests, Git, and validation. Implemented declared, observed, one-hop downstream, and unmapped Topic impact plus explicit missing, stale, conflicting, and unlinked-history states.
- **Result:** Arcadia and Private Practice Now fixtures prove current and prior Actions, continuation, linked and unlinked history, every impact provenance class, absent evidence, stale evidence, and contradictory evidence without a clock, network call, model call, or inferred history. Unknown Actions, unsafe changed paths, and duplicate Signals fail legibly. Focused tests pass 20/20; the full suite passes 950 tests with 6 skipped; core, Discord, and optimized Dashboard builds pass.
- **Next:** Project the normalized model into equal, cross-linked capability-map and Action-timeline views with a useful Home, Topic and episode notes, Current Work, and side-by-side Canvas.
- **Blockers:** None. Merge, plugin installation, and foreign-repository edits retain their existing approval boundaries.

## 2026-08-21 — Defined and proved the living-system v1 contract

- **Action:** `living-system-v1#define-living-system-v1-contract`
- **Did:** Added a zero-model parser and canonical serializer for Project-owned `docs/living-system.yaml`; normalized Project-defined Topics, Relationships, and Views; defined the derived Episode, Signal, source/freshness receipt, impact-provenance, and unlinked-history target types; added safe explicit `Action: plan-slug#action-id` Log links; documented the complete contract; and built distinct Arcadia and Private Practice Now proof fixtures.
- **Result:** Validation now aggregates and rejects unsupported versions, Project-slug mismatch, duplicate ids and Relationships, missing values, dangling references, ambiguous or empty selectors, unsafe or missing sources, symlink escape, and attempts to duplicate operational truth. Unchanged inputs serialize byte-identically, arbitrary Topic and Relationship vocabulary needs no code change, unlinked Log history stays explicitly null, 947 tests pass with 6 skipped, and the core, Discord bot, and optimized Dashboard builds pass. [Draft PR #93](https://github.com/pmark/arcadia/pull/93) carries the source revision and operator-facing QA plan.
- **Next:** Derive Episodes, Signals, Topic impact, freshness, gaps, and unlinked history from the manifest, managed documents, and available operational evidence without guessing.
- **Blockers:** None. Projection, synchronization, plugin installation, and Private Practice Now repository edits remain in their later governed Actions.

## 2026-08-21 — Made the living system's map and timeline equal v1 surfaces

- **Action:** `living-system-v1#define-living-system-v1-contract`
- **Did:** Recorded Decision 0032 after refining the original architecture-map proposal around what a person repeatedly needs: rapid orientation to a Project's purpose and current work, capability-first structural navigation, and an Action-centered causal history. Extracted the work from `demo-first-delivery` into a dedicated `living-system-v1` plan with five Pareto Actions covering the extensible contract, trustworthy state derivation, paired projection, free sync integration, and governed Arcadia plus Private Practice Now dogfood.
- **Result:** The next `arcadia advance` now implements `docs/living-system.yaml` with Project-defined Topics, Relationships, and Views plus deterministically derived Episodes and Signals. Pages, Models, Workflows, and Persistence are examples rather than imposed categories. Routine generation remains zero-model and no-cost; Home, map, timeline, Current Work, Topic notes, episode notes, and Canvas have observable cross-navigation, provenance, freshness, fallback, and usability requirements. Local AI and the expensive visualization tail are deferred behind measured-use triggers.
- **Next:** Implement and validate the versioned manifest parser and stable target types, including safe paths, the explicit Action-linked Mission Log convention, and Arcadia plus Private Practice Now fixtures; operational state derivation follows as its own bounded Action.
- **Blockers:** None. Private Practice Now repository edits must still follow its own governed pointer or an explicitly approved cross-Project Action, and all existing merge, plugin-installation, and external-effect boundaries remain in force.

## 2026-08-20 — Made reusable Obsidian architecture maps the next governed work

- **Did:** Recorded Decision 0031, inserted five clarified and dependency-ordered Actions into `demo-first-delivery`, pointed the Project at `define-architecture-map-contract`, and removed the competing pointer from `idea-to-managed-build` without changing its open Action. The plan covers a versioned Project-owned manifest, deterministic vault projection, preview/apply CLI, optional local-only enrichment, real Arcadia dogfood, plugin setup, QA, and exact restoration of the displaced pointer.
- **Result:** `Arcadia go` now has one intended documentation-defined target for building the complete capability through normal Action-by-Action continuation. Every managed software Project with a repository path and manifest can receive the same generated Obsidian structure; the normal create/update path is specified to make zero model calls, and optional AI interpretation is local-only and isolated from architecture truth.
- **Next:** Implement and validate the `docs/architecture-map.yaml` v1 contract and parser, then advance through the projector, CLI, local enrichment, and dogfood Actions in dependency order.
- **Blockers:** None. Merge, external plugin installation effects, and any other gated operation remain subject to their existing authority and QA boundaries; `idea-to-managed-build/promote-accepted-plan` resumes after accepted dogfood proof.

## 2026-08-20 — Completed the Astro idea-to-staging golden path

- **Did:** Implemented exact suffix-shaped Astro proposal intake; Incubating Project metadata and Dashboard setup; Discord Project-detail links; one-click proposal approval; Codex/Claude scaffold dispatch with `$create-astro-site`; scoped Codex network access; deterministic build validation; Cloudflare Workers Static Assets deployment to the named Wrangler `staging` environment; persisted staging URL and live-link Artifact; CLI fallback metadata fields; and the operator demo runbook.
- **Result:** A synthetic worker-level end-to-end test completes the exact request through a staging `workers.dev` URL without a second approval, Git push, production deployment, or invented result. Focused proposal/Discord/Dashboard regressions pass, the full suite passes with 928 tests and 6 skips, the core/Discord TypeScript build passes, and the optimized Dashboard build passes.
- **Next:** Promote an accepted validated planning Artifact into the one governed build Action and immutable build packet.
- **Blockers:** None for the implementation. A real demo rehearsal still requires the operator's empty GitHub repository URL, installed `create-astro-site` skill for the selected agent, working agent login, and Wrangler-authenticated Cloudflare account.

## 2026-08-20 — Scoped the tomorrow idea-to-staging demonstration

- **Did:** Recorded Decision 0030 and inserted `demo-astro-staging-loop` as the current Action ahead of the general planning-to-build promotion seam.
- **Result:** The demo has one honest golden path: exact Astro blog intent, populated Incubating Project, Discord Project-detail link, entered GitHub URL, one Project-scoped approval, one Codex or Claude Code scaffold Run using Create Astro Site, and one Cloudflare Workers staging URL returned through Discord. Approval explicitly excludes production, merge, push, custom domains, publication, spending, and deletion.
- **Next:** Implement and validate the exact proposal, approval, build, staging, and notification loop.
- **Blockers:** None. A real live-link proof will still require the operator's empty GitHub repository URL, installed generator skill, selected coding-agent login, and Cloudflare Wrangler authentication at demonstration time.

## 2026-08-20 — Made a project idea approval-ready in one command

- **Did:** Added `arcadia project prepare <name> <idea> [--path]`. It performs
  an explicit Project-work classification, creates the Active Project and
  planning Action, preserves the idea verbatim, writes and binds a valid
  managed pointer chain, adopts the repository context, checks dispatch, and
  prepares the existing immutable read-only planning packet and Decision.
- **Result:** The command reports Project Work, Plan First, Codex responsibility,
  every receipt, and the exact approval trigger. It invokes no model and starts
  no Run. Occupied names, registered repositories, `PROJECT.md`, managed plans,
  and the bootstrap plan path fail before creation or overwrite. Three focused
  tests cover the direct function, real CLI JSON envelope, dispatch readiness,
  full-idea preservation, packet/Decision receipts, zero Runs, and refusals.
  The root build passes; the full suite passes 923 tests with 6 skipped.
- **Next:** Promote an accepted planning Artifact into the managed plan's one
  current coding-agent build Action and prepare its immutable build packet.
- **Blockers:** None.

## 2026-08-20 — Prioritized the direct idea-to-managed-build path

- **Did:** Recorded the operator's request to state a project idea once, have
  Arcadia classify and plan it, and then let Arcadia manage the coding-agent
  build. Mapped the request against the existing target development loop and
  found the two missing seams: explicit project ideas fall into Back Burner,
  and accepting a validated planning Artifact ends with a manual instruction to
  choose the implementation Action.
- **Result:** Decision 0029 activates `idea-to-managed-build`. The first Action
  is the smallest usable entry point: one command that creates the Incubating
  Project, preserves the idea, establishes a valid planning pointer, and
  prepares the exact read-only planning Decision without invoking a model. The
  second Action promotes the accepted plan into governed build work; the third
  carries that work through Candidate and independent QA.
- **Next:** Implement `prepare-project-idea` in an isolated worktree.
- **Blockers:** None. Consequential transitions remain separately gated.

## 2026-08-20 — Adoption stopped one document short of working

- **Did:** The operator registered a repository path for Martian Rover, ran
  `arcadia project setup-context`, and the Project page still refused: "No
  PROJECT.md declaring slug martian-rover was found." Traced it — setup wrote
  every governance file (`.arcadia/*`, `AGENTS.md`, `CONSTITUTION.md`,
  `CLAUDE.md`, the continuation protocol) and never a `PROJECT.md`. The only
  code that wrote one was `project create`, into the workspace, not into a
  repository. So every adopted repository resolved to the same refusal, with no
  command that would produce the document it named — while the four Actions it
  needed sat in the database the whole time, untranslated.
- **Result:** `seedControlDocuments` writes that translation: a `PROJECT.md`
  and a first plan carrying the Project's real Actions, milestone, and
  responsibilities. Nothing is invented. The one adjustment is on the Action
  the pointer names, which the schema requires to be `clarified` with
  acceptance criteria or `question_open` with a question — it derives at most
  one criterion, and only from `expected_artifact`, something that either
  exists or does not; where even that is absent the Action is emitted as the
  open question it already was, so the page shows one operator question rather
  than criteria nobody agreed to. The pointer is set only when one Action is
  unambiguous; otherwise it is left unset and the blocker names every candidate
  id. Neither document is ever overwritten. `--repo` now resolves the Project
  registered at that path — it and a project identifier used to adopt the same
  repository and produce different results — and still works with no workspace.
  The Project page offers the same adoption where the refusal is read. Verified
  live: martianrover-com2 went from the refusal to "Ready to prepare — Implement
  the next code change" without leaving the page. 8 new tests; full suite 883
  passing, root and dashboard `tsc --noEmit` clean.
- **Next:** `make-test-action-state-aware` on `demo-first-delivery` — unchanged;
  this was operator-directed work outside the active plan and recorded on
  `way-delivery`.

## 2026-08-20 — Closed the demo hero Action, and labelled the demo that only works on this Mac

- **Did:** `arcadia go` dispatched `build-demo-hero-vertical-slice`, but the
  Action was already built and merged: PR #77 landed on 2026-08-17 and the
  2026-08-17 log entry had deliberately left the Action `open` "until the PR
  merges." Nothing closes an Action when a PR merges, so the condition expired
  silently and the pointer sat on finished work for three days. Verified the
  merged implementation against all six acceptance criteria rather than
  trusting that entry — hero above the control record with exactly one primary
  action, six-state resolver, full target contract, Stable shown separately
  from Candidate, control record intact below, no gated operation performed.
- **Result:** Verification found one real gap. The hero's primary button and
  each target card linked straight to the configured URL with nothing saying
  where that URL resolves, and PPN's Candidate is `http://127.0.0.1:4321` —
  correct on the Mac, a silent dead end from the phone-reachable Mission
  Control the operator actually demos from. The card carried `Access:
  local-only` as a passive field two rows below the button and `START_HERE.md`
  documented it in prose, but a button reading "Test Candidate" that goes
  nowhere still implies a demo exists. Now labelled "Mac only — not reachable
  from a phone" on both the hero action and the card, guarded so it never
  attaches to the `/qa` link, which a phone can reach. Action marked `done`;
  pointer moves to `make-test-action-state-aware` over `automate-proof-artifacts`
  because it names this exact gap ("rather than presenting localhost to a
  phone") and is session-sized against the other's project-sized scope.
  Also added `recommended_model: claude-opus-5` and
  `recommended_reasoning_effort: high` to the plan: `arcadia go --apply`
  refuses to launch an unpinned session, and this plan declared neither, so
  every continuation on it required a manual `--model` override.
  `tests/proof-targets.test.ts` 12/12, root and dashboard `tsc --noEmit` clean.
- **Next:** `make-test-action-state-aware` on `demo-first-delivery`.
- **Blockers:** None.

## 2026-08-18 — Documented the cwd-aware launcher and tidy for operators

- **Did:** Operator asked for the new cwd-aware launcher, `tidy`, and `go`'s
  clutter nudge to be explained in the appropriate user-facing documents, with
  how to use them and why they matter, not just the mechanical flag reference
  already added to `START_HERE.md` during implementation. Found and fixed a
  real defect while restructuring: an earlier edit had left a paragraph about
  `docket`'s "Standing constraints" output stranded after the unrelated
  `tidy`/`go` content, because it was pushed down when that content was
  inserted above it without moving it back.
- **Result:** `START_HERE.md`'s three mechanical sections now nest under one
  new "Working across many projects without losing the thread" heading, with
  an opening paragraph naming the actual failures this fixes — a bare
  `arcadia docket` silently answering for the wrong project, and 15 worktrees
  plus 54 branches accumulating for weeks with nothing surfacing it — rather
  than describing the features in the abstract. `docs/working-copy-safety.md`,
  the canonical safety document `AGENTS.md` points to, gained a "Retiring
  safely landed work" section: it previously covered only the danger side
  (`work monitor`, preserving `UNSAVED`/`LOCAL ONLY` work) and said nothing
  about `LANDED` work that nobody ever retires, which is the failure mode that
  actually occurred. The `LANDED` row in its safety-states table now points to
  that section instead of reading "nothing required."
- **Next:** Nothing dispatched. Pointer unchanged.
- **Blockers:** None.

## 2026-08-18 — Cleaned up 14 worktrees and 45 branches, and made the state visible

- **Did:** Operator, away from their machine, asked for the accumulated
  worktrees and branches to be resolved now and made safe from here on.
  Investigated the three branches `tidy` had flagged as "the only copy" before
  touching anything, and all three were false alarms:
  `preserve/local-main-before-pr38` held a Claude Code executor commit whose
  file is byte-identical on `main`; `codex/reliable-arcadia-service-restart`
  documented `.nvmrc`, which the mise migration deleted, so merging it would
  have regressed PR #79's ABI fix; `codex/agent-session-queue-proposal` was an
  older copy of Decision 0011, `status: open`, which would have un-superseded a
  Decision 0012 already resolved. Zero work at risk, and two of the three would
  have damaged `main` if merged — the danger ran opposite to the warning.
- **Result:** Added `git cherry` patch-equivalence as a third merge proof
  alongside ancestry and pull-request verification. It is local, needs no
  credentials, and catches cherry-picks, rebases, and amended commits — the
  cases that made the report untrustworthy. Each proof catches what the others
  miss, so a branch is only called unmerged once all three decline it. When
  `git branch -d` refuses (squash/rebase merges, and branches whose remote
  counterpart still exists — git compares against the upstream, not the base),
  `tidy` now writes an `archive/<branch>` tag before forcing and prints the
  restore command, so no deletion is ever unrecoverable. Ran it: **15 worktrees
  to 1, 54 branches to 9**, 49 items retired across two passes. Five archive
  tags pushed to `origin`, covering every commit not reachable from `main`.
  For prevention, `arcadia go` now closes by stating extra worktrees and
  already-merged branches and pointing at `tidy` — local counts only, no fetch,
  no GitHub call, because the accumulation that caused all this sat unnoticed
  for weeks with nothing ever surfacing it. 6 new tests (23 for `tidy`); full
  suite 890 passing, same 4 pre-existing failures.
- **Next:** Nothing dispatched. Pointer unchanged.
- **Blockers:** None. Two branches remain by design —
  `codex/reliable-arcadia-service-restart` and
  `codex/agent-session-queue-proposal` genuinely diverge from `main`, so `tidy`
  correctly refuses them; both are archived as pushed tags and are obsolete
  rather than valuable, but deleting them is the operator's call, not a
  cleanup tool's.

## 2026-08-18 — Added arcadia tidy, then made it verify what it can't see by ancestry

- **Did:** Operator asked for a safe cleanup command for accumulated worktrees
  and branches, plus help reconciling which held live work. Built `arcadia
  tidy` reusing `go`'s existing safety primitives (`SAFE_TASK_BRANCH`,
  `assertClean`, ancestry checks), extracted into `src/git/worktrees.ts` so the
  two commands cannot disagree about what is safe to delete. A dry run against
  this actual repository found 43 retirable items and flagged 6 branches as
  genuinely unmerged. Operator pushed back on two of those six, unwilling to
  manually review branches merely because their commits were not literal
  ancestors of `main`, and asked for the smarter check rather than a
  workaround. Investigating turned up something more fundamental than the
  squash-merge case predicted: this repository's shared `main` ref was two
  merged pull requests behind `origin/main`, with nothing anywhere flagging
  it. Every worktree shares one set of refs, so that staleness was silently
  degrading every ancestry check in every worktree at once.
- **Result:** `tidy` now fetches `origin` before comparing (default on,
  `--no-fetch` to skip), and separately checks GitHub for merged pull requests
  when `gh` is available (default on, `--no-github` to skip) — verifying a
  PR's `mergeCommit` ancestry rather than trusting its "merged" label, which
  is what actually detects a squash or rebase merge, since those rewrite
  history and never make the branch itself an ancestor. Re-run against this
  repository: retirable count rose from 43 to 46, and the "genuinely unmerged"
  count fell from 6 to 3 — the two reclassified now read `PR #36 merged
  (squash/rebase)` and `PR #66 merged (squash/rebase)`, both verified against
  real commits on `main`, not merely GitHub's word for it. 6 new tests,
  including two that reproduce the actual staleness bug end-to-end with real
  bare-repo clones (one merges and pushes from a second clone while a `--repo`
  target's local `main` never learns of it) and two that exercise the
  squash-merge verification directly. 17 tests total for `tidy`; full suite at
  884 passing, same 4 pre-existing failures.
- **Next:** Nothing dispatched. The pointer is unchanged.
- **Blockers:** None. `mergedPullRequests` degrades to null — ancestry-only,
  clearly labelled as such in the output — when `gh` is unavailable,
  unauthenticated, or the remote is not GitHub; never a hard failure.

## 2026-08-18 — Made `arcadia` mean the project you are standing in

- **Did:** Decision 0028's recorded trigger fired: the operator ruled that the
  global bare-`arcadia` command should either work correctly from any directory
  or be removed. It was worth keeping, and the fix was smaller than expected
  once the actual cause was isolated. `docket` and `go` already defaulted
  `--repo` to `process.cwd()` — the launcher's `cd` into Arcadia's checkout was
  what destroyed that context, so every repo-scoped command answered for
  Arcadia regardless of where it was asked. Only two `process.cwd()` call sites
  existed in the whole CLI, which made the correction narrow.
- **Result:** `scripts/arcadia` now lives in this repository, versioned and
  reviewable, and `~/.local/bin/arcadia` points at it instead of at an
  unversioned Codex skills directory — a script that decides which project
  every command reaches should not sit where no review, test, or drift report
  can see it. It records `ARCADIA_INVOKED_FROM` before changing directory.
  `src/cli/invocation.ts` reads it, falling back to `process.cwd()` when it is
  absent, empty, or names a directory that no longer exists. Both `--repo`
  defaults use it, and `resolveProjectAndRepo` now resolves the Project whose
  `repo_path` contains the invocation directory before falling back to
  sole-active, preferring the most specific match when checkouts nest. Verified
  all four cases: `docket` and `next` from PPN return PPN; from this repository
  return Arcadia; from `/tmp` return a blocker naming the searched directory
  rather than a substituted answer. Also fixed a fragility inherited from the
  old launcher — it refused outright when `main` was not checked out in a
  worktree, which is the ordinary state during any agent session, so
  orientation broke exactly when it was most needed. It now falls back to the
  primary checkout and says on stderr which branch it ran from. 9 new tests;
  suite at 867 passing.
- **Next:** Nothing dispatched. The pointer is unchanged at
  `build-demo-hero-vertical-slice`.
- **Blockers:** None. One inert leftover, not deleted: the superseded launcher
  at `~/.codex/skills/arcadia-go/scripts/arcadia` is now unreferenced — no
  `SKILL.md` names it — but still on disk outside either repository.

## 2026-08-17 — Reconciled what PPN built locally, and proved Decision 0025 works

- **Did:** Operator identified the root cause of PPN's shim directly: they had
  described capabilities they wanted *Arcadia* to have to coding agents working
  in PPN, and the agents built them where they were standing rather than in
  Arcadia or through a formal request — because until Decision 0025 there was
  no formal request path. Asked for immediate reconciliation. Audited all 21
  capabilities PPN declares: 10 implemented, 11 declared with full invocation
  strings and never built. Checked each against Arcadia's real command surface
  rather than assuming, which changed two conclusions — Arcadia's
  `back_burner_items` table already has `surface_kind` / `surface_predicate`
  trigger columns, so the trigger gap is narrower and more specific than
  "Arcadia has no triggers": it evaluates captured database items and cannot
  evaluate a deferral declared in a governed document. Likewise `attention`
  covers Decisions awaiting review, which is adjacent to but not the same as
  the operator task ledger.
- **Result:** Filed [PPN proposal 0001](https://github.com/pmark/private-practice-now/pull/52)
  under Decision 0025 — the first document ever filed through that mechanism,
  and it worked on the first attempt: committed in PPN, then discovered and
  ingested by `arcadia docs sync` run from this repository, with no new
  channel. It also demonstrated the gap `accept-upstream-proposals` exists to
  close, landing as a bare `proposal` record with its question invisible.
  Decision 0028 written as the ruling: promote three (document-level trigger
  evaluation, the operator task ledger, the demo proof-target registry), retire
  four from PPN as already provided here (`docket`, `advance`, `report`, `go`),
  strike nine as never-built, defer `capabilities`. Two receiving Actions added
  to `way-delivery`. The demo promotion needed no new Action — the active
  Action `build-demo-hero-vertical-slice` is already specified to build that
  contract, so PPN's working prior art was added to its `references` instead,
  and now prints in the dispatch brief where its agent will actually read it.
  Nine of Arcadia's own governed documents declare deferrals nothing can
  evaluate, which is why trigger evaluation is sequenced first.
- **Next:** Nothing dispatched. Decision 0028 needs ratification; the pointer is
  unchanged at `build-demo-hero-vertical-slice`, and `way-delivery` is still
  `draft`.
- **Blockers:** The bare-`arcadia` name collision is deliberately not settled by
  0028 and recorded there as a trigger. `/Users/pmark/.local/bin/arcadia`
  symlinks to a Codex skill script that unconditionally runs Arcadia's CLI, so
  `docket`, `advance`, and `report` invoked from PPN return Arcadia's answer
  silently. Deleting PPN's copies removes one half; the name itself is the
  operator's call.

## 2026-08-17 — Removed the permanent engine warning; fixed Arcadia's own self-reported drift

- **Did:** Operator asked whether the recurring `[WARN] Unsupported engine`
  line could be fixed once and for all, and separately why `arcadia way`
  reported Arcadia itself as stale on `docs/agent-continuation-protocol.md`
  right after ratifying three Decisions. Investigated both rather than
  patching around them. The warning: confirmed empirically that
  `engine-strict=false` in `.npmrc` changes nothing (pnpm was already
  non-strict; strict mode only controls whether the mismatch is fatal, not
  whether it prints), then confirmed that removing `engines.node` from
  `package.json` eliminates the warning outright with no CI dependency on the
  field. The self-drift: reproduced directly by running
  `arcadia project setup-context --repo` against Arcadia's own checkout on a
  branch and diffing the result -- it added exactly one `ARCADIA_CONTEXT_*`
  marker pair around the unchanged body, matching PR #73's Mission Log claim
  precisely. That verified state had apparently only ever existed in a test
  worktree and was never committed to the tracked file.
- **Result:** `package.json`'s `engines` field removed. It never enforced
  anything -- `mise exec --` already re-resolves the real Node version for
  every `pnpm arcadia` invocation regardless of what the ambient `pnpm`
  process was running under, and the ABI mismatch it was meant to guard
  against is separately self-healed by `postinstall`. The field only ever
  produced an unactionable warning on literally every command. `mise.toml`
  is now the sole declaration of the pinned version.
  `tests/toolchain-config.test.ts`, which had asserted the now-removed field's
  value, is updated to assert its absence instead, with the reasoning inlined
  as a comment so the next reader does not reintroduce it. `CLAUDE.md` updated
  so a coding agent that sees a Node-version-shaped error knows this specific
  warning no longer exists and a real one is worth investigating.
  `docs/agent-continuation-protocol.md` regenerated via the same command
  against Arcadia's own repository, confirmed idempotent on a second run
  (marker count stays at one), and committed. `arcadia way` now reports
  3 current, 0 stale, 1 unknown (Martian Rover, pre-existing, no `repo_path`
  configured) -- Rebuster's staleness also cleared independently in the
  interim, unrelated to this work. Full suite: 857 passing, 4 pre-existing
  failures in `tests/narrative-digest-schedule.test.ts` reconfirmed identical
  on `main` with this branch's changes stashed.
- **Next:** Nothing dispatched. The pointer is unchanged:
  `build-demo-hero-vertical-slice` on `demo-first-delivery`.
- **Blockers:** None. The operator's shell-alias question (whether a personal
  `alias arcadia=...` is still needed) is now moot for the warning specifically,
  since there is nothing left to alias around; coexisting Homebrew/nvm/Volta
  Node installs on `PATH` remain a fact of this machine but no longer surface
  as noise.

## 2026-08-17 — Fixed PPN's drift and ratified three governance Decisions from one menu

- **Did:** Operator asked whether PPN was current on the Way. Verified with
  `arcadia way`, then independently confirmed two of its three claims by
  diffing the raw files by hand rather than trusting the tool blind:
  `CONSTITUTION.md` byte-identical (confirmed), continuation protocol
  correctly tolerated as differing (PPN wraps the shared text with its own
  preserved section below, which `adoptContinuationProtocol` is designed to
  allow), AGENTS.md region genuinely stale (confirmed) — missing the
  six-condition executability test and two stopping obligations added
  2026-08-16. Also reproduced a real anomaly while verifying: `arcadia way`
  reports Arcadia's own repository stale on its continuation protocol, and
  the committed file has zero marker pairs despite PR #73's Mission Log entry
  claiming a verified byte-identical run with exactly one marker pair —
  flagged, not chased down further, since it was outside what was asked. Ran
  `/menu` over the PPN fix and Decisions 0025, 0026, 0027.
- **Result:** Regenerated PPN's AGENTS.md region with `arcadia project
  setup-context --repo`, run manually rather than through the not-yet-built
  automated propagator, scoped to what Decision 0024 already classifies as
  the mechanical tier. Diffed the result against the drift found by hand —
  matched exactly. Only `AGENTS.md` and `.arcadia/repo-context.md`'s
  timestamp changed; `CONSTITUTION.md`, `CLAUDE.md`, and the continuation
  protocol are byte-identical before and after.
  [private-practice-now#49](https://github.com/pmark/private-practice-now/pull/49)
  opened; nothing merged. Decision 0025 approved as recommended, including
  treating PPN's six shim capabilities as retroactively filed proposals.
  Decision 0026 approved **on its definition only** — Milestone as a named
  outcome owned by the Project, current Milestone derived — with the schema
  change and migration explicitly not authorized and not scheduled; a new
  trigger row records what would revive it. Decision 0027 approved as
  recommended (`prime_directive` and `horizon` adopted, `vision` rejected),
  proceeding on the understanding that `horizon`'s ranking value stays
  theoretical until 0026's deferred migration is separately scheduled.
- **Next:** `accept-upstream-proposals` on `way-delivery` is now unblocked by
  0025's approval but the plan is still `draft` and does not displace
  `demo-first-delivery`. Implementing 0026's schema/migration is not
  scheduled and awaits its own trigger.
- **Blockers:** None recorded. Noted, not chased: Arcadia's own
  self-reported drift on `docs/agent-continuation-protocol.md` (see above),
  and `build-demo-hero-vertical-slice` still shows `status: open` in
  `docs/plans/demo-first-delivery.md` despite a same-day Mission Log entry
  titled "Built the demo-first Project Detail hero and PPN proof targets" —
  not reconciled here, since it belongs to whichever session is actually
  running that Action.

## 2026-08-17 — Built the demo-first Project Detail hero and PPN proof targets

- **Did:** Dispatched `build-demo-hero-vertical-slice` from `demo-first-delivery`.
  Built a checked-in Stable/Candidate proof-target contract
  (`config/proof-targets.json`), a deterministic reachability check
  (`arcadia proof-target check`, persisted to a new `proof_target_checks`
  table), and a pure hero-state resolver
  (`src/proofTargets/hero.ts`) implementing the six-state priority order from
  `docs/operator-demo-and-release-contract.md`. Configured Private Practice
  Now's Stable target as Juniper, the sample-portfolio staging site
  (`https://juniper.sites-staging.privatepracticenow.com`), separate from the
  existing River Copy Studio Candidate; the Candidate reuses its QA queue id
  so a recorded QA Decision (`arcadia qa record`) feeds the hero automatically.
  Wired a new hero card plus per-target cards onto Project Detail, with
  `Show Stable`/`Test Candidate` links and a live `Check now` action.
  Verified against real targets in a worktree-local dashboard instance: both
  configured PPN targets returned healthy, `Check now` round-tripped through
  the API route, CLI, live HTTP probe, SQLite persistence, and UI refresh.
  `pnpm exec vitest run tests/proof-targets.test.ts` (12/12) and full `tsc
  --noEmit` (root + dashboard) pass; the full `pnpm test` run has the same 4
  pre-existing, unrelated `narrative-digest-schedule` failures confirmed
  present on `main` before this change.
- **Result:** [PR #77](https://github.com/pmark/arcadia/pull/77) opened with
  an operator QA plan, awaiting review and merge. `build-demo-hero-vertical-slice`
  stays `open` in `demo-first-delivery` until the PR merges — a screenshot
  proof gallery, automatic GitHub/Cloudflare target discovery, and a release-
  Decision workflow remain separately specified, unbuilt follow-on work in the
  same plan.

## 2026-08-17 — Named the four governance gaps behind the PPN shim

- **Did:** Operator raised four concerns: that a project's next action should be
  distinguishable from the portfolio's, that every project must share code and
  policy controlled by this repository, that no formal path exists for a
  project's agent to request a Way change, and that `vision`, `horizon`,
  `prime_directive`, and a real definition of Milestone are missing. Verified
  each before answering. One was a misread — `demo-first-delivery` is
  `project: arcadia`, so the Action shown was Arcadia's own, though its
  acceptance criteria are written almost entirely in PPN nouns, which is why it
  read otherwise. The other three are real, and running `arcadia portfolio`
  surfaced a fourth nobody had named: `portfolio` and `next` report **different
  current milestones for the same Project**, because the DB carries a
  project-level milestone matched on ingest while dispatch reads the plan's.
  Ran `/menu` over all four.
- **Result:** Decision 0025 drafted on the operator's own redirect — a Way-change
  request travels as a `type: proposal` document committed in the project's own
  repository and arrives via `docs sync`, needing no new channel, which is
  consistent with Decision 0022's git-only rule. `proposal` is already a valid
  `DOC_TYPES` entry, `discoverDocs` already scans the whole repository, sync
  already matches documents to their project, and `portfolio` already renders
  "Waiting on you" — the pipe runs end to end and only the last inch is
  missing. Decision 0026 drafted defining a Milestone as a named outcome that
  outlives the plan pursuing it, owned by the Project and referenced by id, with
  the current Milestone derived rather than stored so the two commands cannot
  disagree. Decision 0027 drafted admitting `prime_directive` and `horizon` and
  **rejecting** `vision`, because `ProjectDoc.outcome` already carries it. New
  `way-delivery` plan created at `status: draft`, holding the rehomed
  `open-way-sync-pull-requests` — stranded since yesterday in a `complete`
  plan — and a new `accept-upstream-proposals` Action.
- **Next:** Nothing dispatched. Three Decisions await ratification, and
  `way-delivery` does not displace `demo-first-delivery` unless the operator
  moves the pointer.
- **Blockers:** None. Noted for a later pass: `arcadia portfolio` reports 11
  Decisions waiting for Arcadia and 10 for PPN, plus two malformed review items
  (R36 carries a bare code fence as its title), and Martian Rover still has no
  `repo_path` configured.

## 2026-08-17 — Answered three governance questions from one menu

- **Did:** Built a `/menu` skill that gathers pending operator items — open
  Decisions, plan questions, recorded blockers, stale pull requests — into one
  multiple-choice pass with each option's consequence stated, then acts on the
  selections. Ran it against this repository's actual state. Four items were
  pending; the operator answered all four.
- **Result:** Decision 0022 approved in its strict form: git is the only channel
  between Arcadia installations, a hosted Arcadia is rejected, and committed
  coordination records stay available but unadopted. Decision 0023 approved
  within that narrower space: `current_action` stays stored, one dispatched
  agent per repository becomes an enforced precondition, deriving the pointer is
  rejected, and parallel dispatch in one repository is an accepted limit.
  Decision 0024 written and approved for `propagation-authority`, unblocking
  `open-way-sync-pull-requests` after two days: mechanical tiers auto-merge,
  governing tiers always need a human, and Arcadia's new write authority over
  other repositories is scoped to generated paths by six stated guardrails.
  `open-way-sync-pull-requests` moved from `blocked`/`question_open` to
  `open`/`clarified` with acceptance criteria. None of the three authorizes
  code.
- **Next:** Rebase PR #74 onto `main` per the operator's fourth answer, recording
  the workspace-free `arcadia docket` as ad-hoc work rather than an Action on the
  now-complete `arcadia-way-propagation`.
- **Blockers:** `open-way-sync-pull-requests` is now clarified but lives in a
  plan whose status is `complete`, so it needs rehoming before it can dispatch.
  Not invented here — recorded for the operator.

## 2026-08-17 — Drafted the two Decisions that gate running agents in the cloud

- **Did:** Operator asked what Arcadia's architecture becomes under growing
  adoption, given that coding agents commonly run in cloud containers while
  Arcadia is local-first. Two questions came out of that discussion as the ones
  that change shape depending on when they are answered, and both were drafted
  as Decisions rather than left in conversation. Not a plan Action — operator-
  directed architecture work, and `demo-first-delivery` is untouched.
- **Result:** Decision 0022 asks whether an Arcadia installation ever
  coordinates directly with another, recommending that git is the only channel
  and rejecting a hosted Arcadia other installations call. Decision 0023 asks
  whether `current_action` survives concurrency as a stored value,
  recommending it stays stored with one dispatched agent per repository
  enforced as a dispatch precondition — reusing the unmerged-branch signal
  `arcadia work monitor` already computes — and rejecting a derived pointer
  because a tiebreak rule is an ordering heuristic standing in for the
  operator's judgment, which the continuation protocol forbids. 0023 depends on
  0022 and says so. Both `status: open`; neither authorizes code.
- **Next:** Nothing dispatched. Both Decisions need operator ratification, and
  0022 must be answered before 0023 is meaningful.
- **Blockers:** PR #74 (`arcadia docket`, workspace-free) is still open and now
  conflicts with `main`, which took #73 first and closed
  `arcadia-way-propagation`. Its plan Action and log entry target a plan that
  is now `complete`.

## 2026-08-16 — Closed arcadia-way-propagation: fixed the drift `arcadia way` found in Arcadia itself

- **Did:** Completed `stop-duplicating-a-canonical-protocol-on-adopter-zero`.
  `adoptContinuationProtocol` now treats an unmarked existing file whose body
  already equals the canonical text as the managed region itself rather than
  a project-authored section to double below it. Proving that against
  Arcadia's own worktree surfaced a second, worse defect the acceptance
  criteria's "twice" existed to catch: the canonical continuation-protocol
  source is read from Arcadia's own repository root, which is also the
  adopted target whenever setup runs against Arcadia itself, so after the
  first run the "canonical" copy already carried the markers this function
  was about to add again -- every later run nested another pair around the
  previous run's own output.
- **Result:** Fixed by unwrapping one layer of markers from the canonical
  body before rewrapping it, so the body used for adoption is always plain
  text regardless of self-reference. Verified for real: three consecutive
  `setup-context` runs against a fresh worktree checkout now produce a
  byte-identical `docs/agent-continuation-protocol.md` (confirmed by md5),
  with exactly one marker pair and no TRIAGE section. A repository whose
  protocol genuinely differs still gets it preserved under TRIAGE, unchanged.
  3 new tests in `tests/arcadia-way-propagation.test.ts`. This closes
  `arcadia-way-propagation`'s milestone -- `arcadia way` makes staleness
  visible rather than silent, and this was the one defect it found.
  `open-way-sync-pull-requests` stays open, genuinely blocked on the
  unanswered `propagation-authority` question; it does not gate the
  milestone as written. The pointer returns to `demo-first-delivery` /
  `build-demo-hero-vertical-slice`.
- **Next:** `build-demo-hero-vertical-slice` on `demo-first-delivery` -- a
  large, `session`-effort, cross-system dashboard Action, not started here.
- **Blockers:** None for this Action. `open-way-sync-pull-requests` remains
  blocked on the operator answering `propagation-authority`.
## 2026-08-16 — Gave a project the ability to answer its own docket

- **Did:** Way-verification testing in PPN put a session in a cloud container,
  where `pnpm arcadia docket` failed. Diagnosed it as structural rather than a
  bad path: PPN's `scripts/arcadia.mjs` shells `pnpm arcadia next` with `cwd`
  set to the Arcadia checkout and `--workspace` set to the martianrover
  database, neither of which exists in a container, while its sibling
  `triggers` is pure-local and worked fine. Confirmed `resolveDispatch` in
  `src/docs/dispatch.ts` imports only `node:fs`/`node:path` and computes the
  entire answer from checked-in documents — the database was doing a slug
  lookup, a back-burner count, and journaling, none of them load-bearing.
  Operator directed fixing it once in Arcadia for every project rather than
  patching PPN. Recorded as ad hoc operator-directed work, not a plan Action:
  it was written against `arcadia-way-propagation`, which closed in #73 before
  this landed, and the operator chose on 2026-08-17 to rehome it here rather
  than reopen a plan whose milestone was already met.
- **Result:** `arcadia docket [--repo <path>]` resolves the pointer,
  executability fields, and blockers with no workspace and no database.
  `next` and `docket` share one renderer, so they cannot describe the same
  state differently. Verified against PPN with no workspace flags: resolves
  `intake-to-deployed-site-integration` / `record-integration-verdict`,
  responsibility `codex`, zero blockers. Five new tests build a repository in a
  temp directory with nothing beside it. Also recorded that this plan's own
  `repo-context.md` deferral named "a second machine or a CI job needs to read
  these files" as its trigger — that trigger fired here, so the item is now
  overdue rather than deferred.
- **Next:** The pointer was not moved by this work. Packaging Arcadia so the
  command exists in a container at all is deferred behind a stated trigger on
  `arcadia-way-propagation`.
- **Blockers:** None.

## 2026-08-16 — Made the recurring Node ABI mismatch self-healing

- **Did:** Operator hit `SQLITE_NATIVE_ABI_MISMATCH` again running
  `pnpm arcadia docs sync --apply` right after merging #71, against Homebrew's
  node 25.6.1 rather than the mise-pinned 22.23.1 -- the same class of failure
  a freshly created worktree hit earlier the same session, fixed there only by
  a manual `mise install && mise exec -- pnpm rebuild better-sqlite3`. Asked
  how to avoid it forever rather than re-running the documented manual fix
  each time. Diagnosed that this machine has Homebrew node, nvm, and volta all
  coexisting on `PATH`, so which `node` a plain `pnpm arcadia` resolves to is
  not reliable. Not a plan Action -- ad hoc operator-directed infrastructure
  work.
- **Result:** `postinstall` now runs `mise exec -- pnpm rebuild better-sqlite3`
  after every `pnpm install`, and the `arcadia` package.json script runs under
  `mise exec --`, so `pnpm arcadia ...` always executes with the pinned Node
  regardless of ambient shell `PATH` state. Verified by forcing Homebrew's
  node to the front of `PATH` and confirming `pnpm arcadia way` still ran
  clean. #72.
- **Next:** `stop-duplicating-a-canonical-protocol-on-adopter-zero`, unchanged
  by this fix.
- **Blockers:** None.

## 2026-08-16 — A read-only way to tell whether a project is stale on the Way

- **Did:** Completed `report-way-drift`. Added `arcadia way`, a noun command
  that reports per registered project whether its adopted `CONSTITUTION.md`,
  `AGENTS.md` managed region, and `docs/agent-continuation-protocol.md` still
  match Arcadia's own canonical text, and what its `.arcadia/arcadia-way/adoption.json`
  `upgrade_policy` declares. It reuses `setup-context`'s own pure generator
  functions (`updateAgentsMarkdown`, `adoptContinuationProtocol`) to detect
  drift rather than writing a second definition of "adopted": a file is
  current exactly when regenerating it from the canonical source reproduces
  its own bytes. A project with no `repo_path`, or an unreachable one, is
  reported `unknown` rather than assumed current.
- **Result:** `src/projects/wayDrift.ts` and `src/commands/way.ts`, wired into
  the CLI as `arcadia way`. Run against Arcadia itself it correctly reported
  `CONSTITUTION.md` and the shared region as current and the continuation
  protocol as drifted — exactly the still-open
  `stop-duplicating-a-canonical-protocol-on-adopter-zero` defect, not a false
  positive, which is the first real evidence the tool works. 6 new tests in
  `tests/way-status.test.ts`; full suite otherwise unaffected (826 passing, 4
  pre-existing failures in `tests/narrative-digest-schedule.test.ts`
  reconfirmed failing identically on `main`, untouched by this change).
- **Next:** `stop-duplicating-a-canonical-protocol-on-adopter-zero` — fix the
  drift `arcadia way` just found in Arcadia's own repository.
- **Blockers:** None. `open-way-sync-pull-requests` stays parked behind its
  open question (`propagation-authority`); this Action does not resolve it.

## 2026-08-16 — Ran the Way's own generator at Arcadia, and it broke three ways

- **Did:** Completed `give-arcadia-its-own-context-files` by running
  `arcadia project setup-context` against this repository. The command failed
  outright, then damaged the repository on its second attempt, so the Action
  became a repair as much as an adoption. Committed `.arcadia/`'s three context
  files — the ones the shared `AGENTS.md` region has been telling every agent to
  read before broad exploration, and that Arcadia alone did not have. Fixed
  `readAdoptedFile`, which resolved Arcadia's own repository root with a fixed
  `../..`: right for `src/projects/`, wrong for `dist/src/projects/`, so the
  built CLI read every governance file back as `null` and setup refused,
  claiming `docs/agents-context.md` was missing from the repository that
  authors it. Fixed `thinClaudeWrapper`, which read the presence of
  `@AGENTS.md` as proof a `CLAUDE.md` was entirely generated and so replaced
  this repository's own with the bare wrapper; it now strips only what the
  generator writes and returns `null` when anything survives.
- **Result:** Adopter zero holds the context files it prescribes, and the two
  defects that reached that conclusion are fixed with two regression tests
  pinning the destructive one — including one asserting that setup declines to
  overwrite Arcadia's actual `CLAUDE.md`. A real `setup-context` run now reports
  `claude: null` and leaves the file byte-identical. The adopter-zero suite is
  17 passing. Four failures in `tests/narrative-digest-schedule.test.ts` are
  pre-existing and were confirmed failing at the base commit with this change
  reverted; they are untouched by it.
- **Next:** `report-way-drift` — a read-only command reporting which adopting
  projects are stale, and the first thing that would have caught all of this
  without a write.
- **Blockers:** None. The third defect found — first adoption appending a
  second copy of a continuation protocol Arcadia itself authored — is
  non-destructive and recorded as
  `stop-duplicating-a-canonical-protocol-on-adopter-zero` rather than fixed
  beside a data-loss bug.

## 2026-08-16 — Made Arcadia adopter zero and found the Way had no way back

- **Did:** A fresh-session orientation test against Private Practice Now, run to
  check whether the adopted protocol is legible to a cold agent, surfaced that
  the shared managed `AGENTS.md` region was a string literal in
  `src/projects/contextSetup.ts` while Arcadia's own `AGENTS.md` was hand-written
  and exempt from the generator entirely. That is how the noun/verb naming rule
  came to exist in every adopting repository and nowhere in Arcadia. Opened
  PR #65 stating the rule here, then PR #66 moving the shared text to
  `docs/agents-context.md`, read by `readAdoptedFile()` exactly as
  `CONSTITUTION.md` and `docs/agent-continuation-protocol.md` already were, and
  putting Arcadia's own `AGENTS.md` between the same markers every adopter uses.
- **Result:** One statement of the shared contract, in a reviewable document
  rather than a code diff, with a test asserting Arcadia's managed region equals
  the canonical file byte for byte. Two rules already canonical in the protocol
  document are promoted into the always-loaded region: the executable-Action
  conditions including `open` is executable, and naming the session, model, and
  effort the next batch needs. Adopter zero immediately earned its keep — the
  shared region tells agents to read three `.arcadia/` context files Arcadia does
  not have.
- **Next:** `docs/plans/arcadia-way-propagation.md` carries three Actions: give
  Arcadia its own context files, report Way drift without writing, and propagate
  Way changes as pull requests rather than merges. Activated on operator
  direction the same day: `active_plan` is now `arcadia-way-propagation` and
  `current_action` is `give-arcadia-its-own-context-files`.
  `demo-first-delivery` stays `active` with every Action intact, but its
  `current_action` was removed, since exactly one Action may be current across
  the project and a second declaration is reported as a competing objective.
  Resuming it is a pointer change: restore
  `current_action: build-demo-hero-vertical-slice`, which is still `open`.
- **Blockers:** `open-way-sync-pull-requests` is `question_open` on
  `propagation-authority`: which tiers of Way change may propagate automatically,
  and whether Arcadia's CI gets push access to every project repository. Settled
  already and recorded in the plan: generation is safe and automatic application
  is not, so the automatic unit is a pull request per repository, never a merge.

## 2026-08-15 — Dogfooded Arcadia Now and captured its first vertical slice

- **Did:** Used a manual Arcadia Now briefing to orient the operator through
  unusual open work across Arcadia and Private Practice Now. The operator
  reviewed and merged PPN PR #39, then selected the desired product shape: the
  same concise explanation in a phone-friendly web view or Discord, followed
  by a dynamic option menu whose consequences are explicit and whose common
  case is one button that safely advances governed state. Recorded approved
  Decision 0017 and made Arcadia Now the Pareto-first Action in the existing
  draft portfolio continuity plan.
- **Result:** The experience now has a controlled implementation contract:
  deterministic orientation, one primary option only when live state earns
  one, typed and allowlisted operations, invocation-time revalidation,
  idempotency, receipts, and preserved approval gates. Web is first; Discord
  carries the summary and deep link; native Discord buttons are deferred until
  the shared transition contract survives one live trial.
- **Next:** Activate `portfolio-continuity-view` at
  `build-arcadia-now-vertical-slice` when the operator explicitly prioritizes
  it over `demo-first-delivery`, or when the current demo-first Action is
  accepted.
- **Blockers:** None in definition. Implementation remains intentionally
  undispatched so this capture does not silently move Arcadia's active work
  pointer.

## 2026-08-15 — Turned missed attention and portfolio disconnection into governed future work

- **Did:** Recorded approved Decisions 0015 and 0016 and drafted two separate
  managed plans without moving Arcadia's active work pointer. Decision 0015
  uses GitHub pull requests and one `arcadia:attention` issue per external
  operator task as the durable bridge from disconnected cloud Projects into
  Arcadia's existing Discord delivery path. Decision 0016 defines one
  portfolio continuity projection—Past, Now, Next, and Later—and a visible
  capture receipt whenever tangential work appears in conversation. The plans
  preserve the Pareto slices and name the expensive YAGNI tail explicitly.
- **Result:** The Private Practice Now copy-review and Cloudflare-setup misses
  now have a controlled implementation path, while the broader inability to
  see planned, active, deferred, and Incubating work is preserved as its own
  Outcome rather than being smuggled into notification code. Both plans are
  draft, carry no `current_action`, and therefore cannot displace or dispatch
  around `demo-first-delivery`'s current `build-demo-hero-vertical-slice`.
  Each plan names the condition that should cause it to be reconsidered.
- **Next:** Review both draft plans after the current demo-first Action is
  accepted, or explicitly reprioritize sooner if another operator-attention
  miss or the portfolio-disconnection pain becomes the dominant constraint.
- **Blockers:** None in planning. Implementation remains intentionally
  undispatched; activating either plan is a separate priority choice.
## 2026-08-15 — Removed avoidable model calls from pull-request QA

- **Did:** Merged the independently approved minimal PR-QA Candidate in PR #55,
  then completed Decision 0019's streamlining slice. `arcadia qa pr` now refuses
  draft, unchecked, pending, non-successful, conflicting, dirty, or blocked
  Candidates before patch retrieval, reviewer selection, sandbox preflight,
  model invocation, Artifact creation, or Decision creation. It revalidates the
  full mutable evidence snapshot immediately before the model call and skips
  judgment if the snapshot moved. The CLI workspace-precedence regression now
  runs from a unique temporary directory instead of assuming the repository
  root cannot contain the dogfood `.arcadia-workspace`. Captured the durable
  Arcadia-led development vision and evidence-triggered increments in
  `docs/arcadia-development-orchestration-vision.md`.
- **Result:** Twelve focused PR-QA tests and the 88-test combined QA/CLI suite
  pass. Managed-document validation and the dogfood suite pass. The production
  build succeeds, and the CI-equivalent UTC suite covers 804 passing tests with two
  intentional skips. Running the full suite in Pacific time also exposed a
  pre-existing digest-fixture assumption about UTC date labels and Log windows;
  that unrelated repair is deferred until the next digest scheduling change or
  a non-UTC CI lane is introduced.
- **Next:** Publish and independently QA this exact Candidate, then resume
  `build-demo-hero-vertical-slice` for Private Practice Now.
- **Blockers:** None. Automatic invocation and notifications, richer proof,
  managed QA Runs, GitHub posting, patch staging, token telemetry, automatic
  repair, and consequential transitions remain deferred under Decision 0019's
  observable triggers and existing approval boundaries.

## 2026-08-15 — Arcadia QA independently reviewed its first real pull request

- **Did:** Implemented `arcadia qa pr <github-pr-url>`. The command resolves a
  configured Project, pins the initial head SHA, captures the PR body, changed
  files, complete patch, merge state, and every GitHub check, selects the
  least-cost compliant read-only reviewer through Arcadia's provider adapters,
  requires a strict structured verdict, revalidates the SHA, and persists a QA
  report Artifact plus a revision-bound Decision. Added deterministic fixtures
  for contradictory evidence, Pass gating, and same-revision receipt reuse.
- **Result:** Dogfooding against Arcadia PR #54 at `82b50cf` produced Needs
  follow-up, Artifact `art_3b368492148c4f639c`, and Decision `R44`. The report
  found the planning scope and approval boundaries coherent but refused Pass
  because the duplicate `fast` checks conflict and current database-backed
  validation remains incompletely evidenced. Repeating the command returned
  the same hardened receipts in 1.1 seconds without another model call. The
  first implementation Candidate then correctly failed its own review on PR
  #55 instead of being promoted: that failure drove an evidence-only sandbox
  that denies home and network access, exact-SHA patch retrieval, complete
  evidence revalidation, and SHA-verified reusable receipts. The second
  Candidate also correctly failed: its structurally shallow verdict validation
  and unconstrained criterion coverage could still admit an unsupported Pass.
  The resulting contract now proves its sandbox at runtime, validates every
  nested verdict field, and requires exactly one result for each of seven fixed
  review criteria before Pass is possible. The third Candidate found one more
  fail-open path: a coordinated edit could alter both cached receipt data and
  its colocated hashes. The cache now contains no verdict data; reuse rebuilds
  the result from the independent Decision context and cross-checks its
  Artifact, status, source, fingerprint, paths, and hashes before trusting it.
  The fourth Candidate exposed ambiguity in a failed network probe: ordinary
  connectivity failure could look like sandbox denial. The preflight now first
  proves that exact auth, Git control, and GitHub network controls are readable
  by the host, then requires the configured sandbox to deny those same controls
  while reading evidence; either baseline or sandbox mismatch fails closed. The
  fifth Candidate passed every substantive criterion but required direct test
  evidence for the host-baseline failure branch, which now proves that neither
  the sandbox nor reviewer runs and the observed baseline failure is preserved.
- **Next:** Resume `build-demo-hero-vertical-slice`. For PR #54, resolve the
  pull-request-event workspace isolation failure, then explicitly rerun QA on
  the unchanged revision or let a repaired revision receive a fresh automatic
  identity.
- **Blockers:** None in minimal PR QA. Dashboard/Discord delivery, local test
  reruns, browser proof, repair, GitHub posting, managed Run integration, and
  release automation remain deferred under Decision 0018's evidence triggers.

## 2026-08-15 — Promoted minimal independent PR QA from expectation to current work

- **Did:** Recorded the operator's explicit decision to build critical Arcadia
  capabilities when Private Practice Now naturally needs them. Added approved
  Decision 0018, split the immediately useful pull-request review path from the
  later browser- and release-oriented Arcadia QA program, and moved the active
  pointer to `establish-minimal-pr-qa`.
- **Result:** The current Action now requires one CLI command that freezes a PR
  revision, gathers deterministic GitHub evidence, runs a separate read-only
  structured review, and persists a QA report Artifact and revision-bound
  Decision. Arcadia PR #54 is the first real Candidate. Dashboard, Discord,
  repair, release, merge, browser proof, and managed Run integration remain
  deferred against concrete evidence triggers.
- **Next:** Implement and dogfood `arcadia qa pr` against PR #54, which must
  report the contradictory push and pull-request CI results without claiming
  Pass.
- **Blockers:** None. The operator explicitly reprioritized this Action; the
  demo hero resumes after it is accepted.

## 2026-08-08 — Digests now compose and post themselves, for every Project

- **Did:** Closed `schedule-portfolio-digests`, the last Action in
  `narrative-digests`. Added `src/digests/schedule.ts` (the one place that
  decides which window is due), `arcadia digest run --if-due` and
  `arcadia digest mark-posted`, portfolio-scoped composition alongside the
  existing per-Project composer, and `apps/discord-bot/src/digests/scheduler.ts`
  to deliver the results. Migrated `narrative_digests` to carry a scope, a
  nullable `project_id`, a NULL-safe `scope_key` deduplication identity, and a
  delivery record — a table rebuild, since SQLite cannot drop a NOT NULL or add
  a UNIQUE key in place.
- **Result:** Answered the plan's open `digest-window-boundaries` question the
  only way the acceptance criteria permit: calendar-aligned, local, and always
  the period that has already finished. A rolling lookback would move the same
  day's activity between digests depending on restart timing, and digesting the
  period in progress would compose it near-empty and never revisit it, because
  the once-per-period guard would already be satisfied. The guard itself is the
  stored `(scope, period, window)` row rather than a second schedule ledger, so
  there is nothing that can disagree with it — that one choice gives
  idempotency, missed-tick catch-up, and pending-delivery retry for free.
  Failure isolation is per subject and per cadence: one Project's unreachable
  local model costs that Project's digest and nothing else, and a failed vault
  export is a warning on a digest that still posts. 21 focused tests cover each
  acceptance criterion; full suite otherwise green, with two pre-existing
  failures untouched by this change (`tests/obsidian-memory.test.ts` atomic-write
  case, and `apps/dashboard/lib/intelligence.test.ts` which needs a built
  `dist/`).
- **Next:** None in this plan — it is complete, and so is its milestone. The
  work pointer moves to `demo-first-delivery`, activated at
  `build-qa-queue-vertical-slice`; it was already drafted from operator
  direction on 2026-08-01 under approved Decision 0007, so this follows a
  recorded decision rather than choosing a milestone on the operator's behalf.
  `portfolio-docs-protocol`'s `narrative-summarization` was explicitly not
  picked up: it is deferred under Decision 0004 against a trigger that has not
  fired, and taking it would have routed around that deferral just to keep a
  pointer non-empty.

## 2026-08-07 — Pinned the model on every agent handoff

- **Did:** Added Decision 0010 and made `recommended_model`/
  `recommended_reasoning_effort` real, parsed plan fields instead of decorative
  ones only one plan ever used. `arcadia go --apply --agent <x>` now resolves
  the launch model from `--model`, else the plan's recommendation, and refuses
  to launch a session unpinned when neither exists. Effort follows the same
  precedence but stays optional. Added `--model`/`--effort` CLI overrides.
- **Result:** The gap this closes was found live: an operator asked `go` to
  hand off to a new session, then asked which model it would use — and the
  honest answer was that nothing chose one, and the plan being handed off
  didn't declare a preference either. Now every `--agent` handoff carries a
  stated, recorded model choice or refuses with a named remedy. The model
  check deliberately runs after the fast-forward, since a plan's own
  recommendation must be read from its state *after* the merge that may have
  just introduced it — proven true immediately: the calling project's plan
  had no recommendation until a commit inside the very merge being
  reconciled added one. That ordering means an unresolved model does not
  roll back an already-completed worktree retirement; Decision 0009 already
  treats retiring the source and preparing the next worktree as independent
  outcomes, and the refusal message says explicitly nothing needs to be
  undone. Full suite green (760 passed, 2 skipped, 74 files) after the change.
- **Next:** None queued for this decision. The operator separately raised a
  larger request — a managed coding-agent job queue with monitored execution
  and Discord alerting on activity needing input — which is out of scope here
  and needs its own investigation before any design.

## 2026-08-05 — Made coding-agent continuation one safe command

- **Did:** Added the preview-first `arcadia go` command and approved Decision
  0009. It validates a named finished worktree, strict fast-forward ancestry,
  agent-owned branch identity, and the repository's exact Arcadia dispatch
  before changing anything. On `--apply` it advances the local base, retires
  only the clean merged source, and can prepare a uniquely named Codex or
  Claude Code worktree from that updated local base. Created one personal
  Agent Skills-compatible `arcadia-go` skill shared by Codex and Claude Code.
- **Result:** The branch-already-attached failure no longer requires manual Git
  recovery. Dirty, detached, divergent, non-agent-owned, and ceremonially
  blocked repositories refuse without mutation. Seven temporary-repository
  tests cover preview, safe linked and primary-worktree cleanup, next-agent
  preparation, and the important refusal paths.
- **Next:** Invoke `arcadia go` in either agent after a completed task; the
  skill previews, applies only a safe reconciliation, and enters or launches
  the prepared worktree with `arcadia advance`.
- **Blockers:** None in the command or shared skill. `arcadia go` deliberately
  surfaces blockers from the target Project instead of repairing unrelated
  documents or active work automatically.

## 2026-08-03 — Made the morning narrative durable and added AI perspective

- **Did:** Added an ownership-checked Obsidian projection for Morning Packets,
  an explicit `orientation packet export` backfill command, and a bounded
  unpaid local-preferred AI headline plus paragraph after the deterministic
  narrative. Composition checks the once-per-day row before model work and
  keeps Discord delivery intact when AI or vault memory is unavailable.
- **Result:** Today's already-sent packet now exists as a real portfolio Record
  under `Arcadia/Records/Orientation/2026/`, including a generated AI
  perspective and provenance. Focused request, composition, and vault tests
  pass.
- **Next:** Schedule calendar-aligned daily, weekly, and monthly Project and
  portfolio digests so the broader stories arrive unattended.
- **Blockers:** None in the feature. The local text route had drifted to a
  retired MLX endpoint; its operator configuration was corrected to the
  installed Ollama model.

## 2026-08-02 — Turned the morning Orientation Packet into a work narrative

- **Did:** Added a deterministic narrative lead to the existing catch-up-safe
  Discord morning packet. It draws from persisted Logs, completed Actions,
  ready Artifacts, pending Decisions, and blocked Actions to highlight recent
  changes, compare seven-day completion velocity with the preceding week,
  identify visible friction, and suggest the strongest next coding-agent
  handoff before the existing daily slate.
- **Result:** Tomorrow's normal scheduled message can provide orientation,
  motivation, and honest operational analysis without adding a model call that
  could prevent delivery. Focused packet and narrative tests and both
  TypeScript builds pass.
- **Next:** Observe tomorrow's first narrative packet, then refine its signal
  density from the operator's reaction before expanding daily/weekly/monthly
  digest scheduling.
- **Blockers:** None for tomorrow's packet.

## 2026-08-02 — Exported narrative digest Artifacts into Obsidian safely

- **Did:** Added `arcadia digest export <digest-id>`, which projects a composed
  `narrative_digest` Artifact into `Arcadia/Records/Narrative Digests/` in the
  configured Obsidian vault. It uses the established atomic-write,
  vault-containment, ownership-key, and content-hash no-op protections from
  Progress Reviews. The Record removes source Artifact frontmatter, has one
  readable title, and clearly identifies the story as AI-narrated through the
  local-preferred Intelligence route.
- **Result:** Focused narrative-digest and Progress Review memory tests (13)
  pass, as do both TypeScript builds. Re-exporting an unchanged Artifact does
  not churn the vault; disabled memory makes no vault mutation.
- **Next:** `schedule-portfolio-digests` — make daily, weekly, and monthly
  Project stories and the collective portfolio story arrive unattended.
- **Blockers:** Calendar-aligned versus rolling scheduled boundaries remains
  the one explicit policy question; it does not prevent implementing the
  scheduler's idempotent structure.

## 2026-08-01 — Put the QA queue ahead of autonomous QA

- **Did:** Refined the draft `demo-first-delivery` plan after the operator
  needed to test three active pull requests but had to reconstruct every demo
  path manually. Added `build-qa-queue-vertical-slice` as the plan's first
  Action and made the earlier Project Detail hero depend on it. The first
  Artifact is one Arcadia QA tab for configured Candidates: Project, revision,
  PR, Test link, short procedure, evidence freshness, and a pass/fail/needs-
  follow-up operator Decision bound to that revision.
- **Result:** The Pareto scope is explicit: no provider discovery, process
  scraping, screenshot automation, LLM visual judgment, autonomous QA, merge,
  deployment, or delivery in the first slice. The queue is deterministic and
  has no runtime LLM Token Impact; later capture and independent QA remain
  sequenced behind it.
- **Next:** The operator may activate `demo-first-delivery` when ready to make
  `build-qa-queue-vertical-slice` the current Action.
- **Blockers:** The plan remains draft; implementation still needs the priority
  Decision that activates it instead of displacing the current narrative-
  digests Action implicitly.

## 2026-08-01 — Added “Make it real” and enforceable Token Impact budgets

- **Did:** Added “Make it real” beside the Pareto and “If not now, then when?”
  guidelines: each Action should end in the most direct honest form a person or
  system can use, without crossing an approval boundary. Recorded Decision
  0008 and added a required plan-level `token_impact` T-shirt size plus a
  plain-language `token_budget`. Updated all six managed Arcadia plans, the
  managed-document parser, `arcadia next`, Project Detail, the authoring guide,
  semantic contract, Constitution, Start Here guide, and focused tests.
- **Result:** The current Action now reports its plan's Token Impact and Budget
  in both CLI continuation data and the Dashboard contract. The demo-first plan
  includes a routine-by-routine budget table: builds, tests, health probes,
  Playwright capture, metadata sync, and pixel comparison use no LLM tokens;
  interpretation, agentic QA judgment, implementation, and failure diagnosis
  carry the model cost. Ninety-one focused parser/dispatch tests and root
  TypeScript validation pass; `docs sync` reports zero errors or rejections.
- **Next:** Activate `demo-first-delivery` if the operator accepts the earlier
  priority recommendation; its first Action will now arrive with an explicit
  `xlarge` program impact and staged budget rather than hidden cost.
- **Blockers:** The Dashboard production build compiled and passed type
  validation, then failed page-data collection for three existing API routes
  while the live Dashboard was using the same build directory. This does not
  affect the plan/parser validation or running Dashboard, but a clean isolated
  Dashboard build remains follow-up evidence.

## 2026-08-01 — Planned demo-first handoff, Arcadia QA, and release management

- **Did:** Reviewed the operator's Private Practice Now Project Detail screen
  and found the concrete orientation failure: its summary named a stale failed-
  validation next action while Continuation named the real River Copy Studio
  trial, leaving the operator to reconcile control records before finding the
  product. Recorded approved Decision 0007, a human-readable operator demo and
  release contract, and the draft `demo-first-delivery` plan. The contract
  separates a known-good Stable target from the current Candidate, requires a
  demo before document archaeology, and makes the operator's own duties
  explicit: exercise the candidate, then read the relevant Log and QA evidence
  before acceptance, merge, release, or client delivery. The plan sequences a
  PPN demo-hero vertical slice, proof automation, a state-aware Test action,
  independent Arcadia QA, governed release management, and portfolio rollout.
- **Result:** `docs sync` parses the new managed plan and Decision with zero
  errors or rejections. Cloud-hosted previews are confirmed as viable Candidate
  targets: Cloudflare Pages supplies per-PR hash URLs and branch aliases;
  Workers supplies versioned and aliased previews. The plan treats previews as
  public unless Access protection is proved, starts screenshot capture with
  local Playwright, and retains Cloudflare Browser Rendering as an optional
  later runner. The current `narrative-digests` pointer was not changed by a
  planning-only request.
- **Next:** The operator should decide whether to activate
  `demo-first-delivery` now. Recommendation: yes; make
  `build-demo-hero-vertical-slice` current before completing scheduled digest
  work, because it directly removes the operator's present inability to find
  and show usable work.
- **Blockers:** Implementation is intentionally not authorized by “Plan it.”
  Activating this draft plan is the one priority Decision required before the
  first build Action.

## 2026-07-31 — Delivered one-Project narrative digest composition

- **Did:** Added an explicit-window Project digest composer. It gathers only
  in-window mission-Log rows, dispatch journal entries, and Decision activity;
  submits the structured fact snapshot to the unpaid local-preferred
  Intelligence route with a narration-without-invention contract; and writes a
  ready `narrative_digest` Artifact under the Arcadia workspace. Added the
  `narrative_digests` identity table so the exact Project, period label, start,
  and end tuple updates in place. Added `arcadia digest compose` with explicit
  inclusive `--from` and exclusive `--to` boundaries rather than silently
  answering the open calendar-versus-rolling question.
- **Result:** Focused digest, docs-sync, dispatch, and dispatch-journal coverage
  passes 94 tests; the full deterministic suite and both TypeScript builds also
  pass. Empty windows override model prose with an honest deterministic
  "nothing happened" account, and generated files never touch a managed
  Project repository. The full run also exposed and repaired one macOS
  `/var`-versus-`/private/var` assertion in the newly merged progress-review
  test; the production path was already correctly canonicalized.
- **Next:** `export-digest-to-obsidian` — reuse the existing progress-review
  atomic write, ownership check, and content-hash dedup for this AI-narrated
  Artifact shape.
- **Blockers:** None. Portfolio roll-up and scheduled-window boundary policy
  remain deliberately open and are not required by the next Action.

## 2026-07-31 — Scoped narrative digests as a plan, not a feature request

- **Did:** The operator asked for automatic daily/weekly/monthly narrative
  digests, for Arcadia's own project and every Project Arcadia manages.
  Grounded the ask in what already exists before drafting anything: the
  Discord bot's orientation scheduler (interval tick, idempotent per local
  period, self-catches-up after a miss) is the proven pattern for
  "automatic"; `exportProgressReview` already writes deterministic,
  non-Decision records into the Obsidian vault with atomic writes and
  content-hash dedup; `mission_logs` and the dispatch journal, both landed
  this session, are the structured substrate a digest reads from. Three
  genuine forks were the operator's to decide, not mine to infer: how a
  digest gets written (deterministic template, local AI narration, or a
  hybrid), where it goes (Artifact, Discord, Obsidian, or some combination),
  and what "automatic" runs inside (the existing bot process, or new
  infrastructure). Asked directly; recorded the answers as Decision 0006
  rather than silently deciding. Wrote `docs/plans/narrative-digests.md`
  with three ordered Actions and two genuinely open questions (a
  portfolio-wide roll-up digest, and calendar-aligned vs. rolling windows),
  and noted explicitly that this is adjacent to, but does not satisfy, the
  already-deferred `narrative-summarization` Action -- different subject
  matter, kept separately scoped rather than merged.
- **Result:** `active_plan` moves to `narrative-digests`, `current_action` to
  `compose-project-digest` -- the one piece worth building in isolation,
  since it answers the real open risk (can local AI narrate this honestly,
  without inventing outcomes the data doesn't support) before anything is
  wired to a schedule or a delivery surface.
- **Next:** Build the composer: gather one Project's mission_logs,
  dispatch_events, and Decision activity for a window, queue a
  local-preferred Intelligence job to narrate them, store the result as a
  new `narrative_digest` Artifact.
- **Blockers:** none

## 2026-07-31 — Fixed compute-ready-set: it required the pointer it exists to fix

- **Did:** Dogfooding `arcadia next --ready` against this repository, right
  after moving `active_plan` to a plan with no `current_action` set, caught a
  real defect: `resolveReadySet` called `resolveDispatch` outright, which
  itself requires a `current_action` to already resolve before returning
  anything usable. A plan declaring none refused the whole ready set for the
  same reason `next` refuses -- exactly the case this Action exists to help
  with, and exactly backwards from its own acceptance criterion ("suggests a
  `current_action` without writing one"). Extracted `resolveActivePlan` in
  `src/docs/dispatch.ts` -- the Project-and-plan resolution `resolveDispatch`
  already did, stopping short of anything about `current_action` -- and
  shared it between both functions. `resolveDispatch` still requires
  `current_action`; `resolveReadySet` no longer does, and enumerates every
  Action in the resolved plan regardless.
- **Result:** `arcadia next --ready` now correctly lists Actions, or names the
  nearest-to-ready one, even when no `current_action` is set at all -- verified
  against this repository's own real state. All 17 pre-existing
  `resolveDispatch` tests still pass unchanged, confirming the extraction
  preserved its exact behavior. 2 new regression tests cover the absent- and
  dangling-current_action cases specifically, so this exact defect cannot
  return silently.
- **Next:** None; folded into compute-ready-set's delivery before it shipped.
- **Blockers:** none

## 2026-07-31 — Delivered surface-dispatch-journal; dispatch-contract-enforcement complete

- **Did:** Added `dispatchJournal` to `DashboardSnapshot`
  (`src/dashboard/snapshot.ts`): total resolutions, how many were refused, and
  the single most frequent blocking field, computed via the existing
  `summarizeDispatchEvents` rather than a new read. Stays inside the
  snapshot's existing `withReadOnlyDatabase` transaction -- no write, no AI
  call, matching the Action's own acceptance criteria. Rendered in the CLI's
  human-readable `dashboard snapshot` output too, not only the JSON.
- **Result:** All four Actions in `dispatch-contract-enforcement` are now
  done. Its milestone -- managed plans governing work from dispatch through
  acceptance -- is reached, so the plan moves to `status: complete` with no
  `current_action`. `active_plan` moves back to `portfolio-docs-protocol`,
  the only other active plan, though it has no ready Action either: both its
  remaining increments are deferred against named triggers by Decision 0004.
  This is the honest state of the whole portfolio right now -- nothing is
  currently dispatchable anywhere -- recorded rather than papered over with
  an invented pointer. The plan-level `criteria-judgment` question stays
  open; no Action depended on its answer, so closing the plan does not close
  the question.
- **Next:** Whichever of Decision 0004's two named triggers fires first, or a
  new outcome the operator states.
- **Blockers:** none of the kind a document can repair -- there is genuinely
  no ready work queued right now.

## 2026-07-31 — Delivered compute-ready-set

- **Did:** Built `resolveReadySet` in `src/docs/dispatch.ts` and wired it to
  `arcadia next --ready`. It resolves the structural question (project,
  active_plan, real plan document) once through `resolveDispatch` and reuses
  its refusal verbatim rather than re-deriving it; every unfinished Action in
  the resolved plan is then checked individually through
  `resolveActionReadiness` -- the same function a single-action lookup
  already uses -- so the ready set can never disagree with what `next` says
  about any one Action. Deliberately does not additionally refuse the whole
  set over pointer-level blockers (an inactive Project, a competing
  current_action elsewhere) that describe the pointer rather than any one
  Action's readiness, since reporting what would be ready dispatches nothing
  and is not itself unsafe. The suggested current_action is deliberately
  unambitious: the current pointer if it is itself ready, otherwise the first
  ready Action in the plan's own declaration order -- no invented scoring,
  and never written. An empty ready set still names the unfinished Action
  with fewest readiness blockers rather than printing nothing.
- **Result:** `arcadia next --ready` against this repository correctly lists
  `compute-ready-set` and `surface-dispatch-journal` as the ready set (both
  other Actions in the plan are done), and suggests `compute-ready-set`
  unchanged since it was already current_action. 13 new tests: 11 unit tests
  on `resolveReadySet` covering each exclusion rule, the suggestion logic in
  both directions, the nearest-to-ready fallback, and agreement with
  `resolveDispatch`; 2 integration tests exercising the real CLI command
  against a docs-synced project, confirming nothing is journalled.
- **Next:** `surface-dispatch-journal` is now `current_action` -- the last
  Action in `dispatch-contract-enforcement`, exactly where the plan's own
  ordering said it should land.
- **Blockers:** none

## 2026-07-31 — Cross-referenced the "OK to go" reporting signal

- **Did:** Added a fixed `OK to go: <verb-first next step>` line to
  `AGENTS.md`'s "Always identify" list: whenever a message resolves to
  exactly one concrete, unblocked next step, end it with that exact line as
  the last thing in the message; omit it entirely otherwise. The full
  specification lives in Private Practice Now's
  `docs/agent-continuation-protocol.md`, since the rule governs every coding
  agent's reports across every project operating under the Arcadia Way, not
  only this repository -- this entry is the pointer, not a second copy.
- **Result:** A single vocabulary for "ready to execute" now spans both
  repositories rather than each inventing its own phrasing.
- **Next:** None; this is a standing reporting behavior, not a tracked
  action.
- **Blockers:** none

## 2026-07-31 — Delivered verify-acceptance-criteria

- **Did:** Built `src/stewardship/acceptanceCriteria.ts`, evaluating each of a
  plan's declared acceptance criteria against the accepted planning Artifact's
  text. Deliberately narrow: nothing here can verify a free-text English claim
  is true, only whether the Artifact addressed the topic at all, so the
  checker produces only `unmet` (the criterion's terms are absent -- real
  negative evidence) or `unchecked` (present, but truth unverifiable
  mechanically). It never produces `met` -- inventing that judgment now would
  pre-empt this plan's own open `criteria-judgment` question about whether
  local Intelligence should ever rule on what a script cannot. Wired into
  `review.ts`'s `CodexPlanningArtifactAcceptance` approval: the report lands
  in the Decision's `decisionNote` in the plan author's own words, and the
  structured per-criterion results merge into `context_json` via a new
  `mergeReviewItemContext` repository function. An Action whose plan declared
  no criteria is untouched -- the check runs only when criteria exist, so
  `decisionNote` is byte-for-byte what it was before this landed.
- **Result:** Accepting a Run's planning Artifact now reports each declared
  criterion by name, rather than accepting silently regardless of what was
  promised. 8 new unit tests cover the checker directly; 2 new integration
  tests exercise the full pipeline (packet approval through Run through
  acceptance) and confirm both the populated and untouched-when-no-criteria
  cases.
- **Next:** `compute-ready-set` remains `current_action` and is the
  dispatchable Action -- `arcadia next --ready`, listing every Action with no
  unmet prerequisite, unanswered Decision, or open question.
- **Blockers:** none

## 2026-07-31 — Answered recheck-readiness-at-approval as a hybrid

- **Did:** Traced the actual gap before answering the question: approval
  checked packet content (a sha256 digest) and link consistency, but never
  re-asked whether the plan document still said the Action was ready.
  Recorded Decision 0005 -- recheck readiness at approval only when the plan
  document's own `updated:` field has moved since the packet was built, the
  same staleness signal `docs sync` already trusts elsewhere. Implemented it:
  `ActionReadiness` now carries `planUpdated`; the planning Decision's context
  snapshots it at build time; `queueApprovedPlanningRun` compares the two
  before its transaction opens (not inside it -- a refusal that journals its
  own resolution and then rolls that journal entry back with everything else
  answers nothing, the same reason `work plan`'s guard runs before its own
  transaction). Moved `parseActionDocRef` from a private helper in
  `work.ts` to `docs/types.ts` as the inverse of `actionDocRef`, so build-time
  and approval-time checks share one implementation.
- **Result:** A packet approved long after a dependency regresses or a
  required Decision reopens is now refused, naming the blocker, provided the
  document's `updated:` moved -- which is the one signal the rest of the
  protocol already relies on. A packet approved while nothing changed pays no
  extra cost. Four new tests in `tests/dispatch-journal.test.ts` cover
  unchanged / moved-but-fine / moved-and-regressed / moved-without-a-blocker,
  plus the hybrid's one accepted, deliberately undocumented-as-a-bug gap: a
  regression whose author forgot to bump `updated:` is not caught.
- **Next:** `verify-acceptance-criteria` is next in this plan's own stated
  ordering, now that the review-and-acceptance surgery it was waiting to avoid
  duplicating is done. `compute-ready-set` remains `current_action` and is
  still the dispatchable Action.
- **Blockers:** none

## 2026-07-31 — Settled Decision 0004 and added "if not now, then when?"

- **Did:** Answered Decision 0004 rather than leaving it open: neither remaining
  increment now, both `deferred` against conditions that can actually fire —
  dependency persistence when a database-backed view must show ordering without
  re-crawling, narrative summarization when a second foreign repository is
  onboarded or a summary is genuinely wanted. Followed the consequence the
  Decision itself had recorded and moved `active_plan` to
  `dispatch-contract-enforcement`, promoting it from draft with
  `compute-ready-set` as `current_action` per that plan's own ordering note.
  Added **"If not now, then when?"** to `AGENTS.md` beside the 80/20 rule, and
  two lines to `CONSTITUTION.md`.
- **Result:** `arcadia next` now resolves a dispatchable Action with zero
  blockers and no operator question, for the first time since 2026-07-25 — the
  pointer had spent six days returning a question. `deferred` is deliberately
  not counted as resolved by `dispatch.ts`, so the two deferred Actions stay
  blocked without pretending to be startable, and neither is waiting on a person.
- **Next:** Implement `compute-ready-set` — `arcadia next --ready`, computed
  through `resolveActionReadiness` rather than a second copy of the rules.
- **Blockers:** none

## 2026-07-31 — Ingested mission Logs as rows

- **Did:** Resolved the work pointer, which returned its one operator question
  rather than a dispatch. Read the three candidate increments in code before
  surfacing it, which changed what the question was worth answering with:
  mission-Log ingestion needed only an upsert, and dependency persistence turned
  out to be half delivered already. The operator selected mission-Log ingestion
  as Decision 0003. Implemented it — a `doc_ref` column on `mission_logs`
  through the existing migration, and per-entry create/update/unchanged/skipped
  reporting matching every other document type. Keyed entries on the date alone
  at first; running it against this repository refused five of nine entries,
  because five of them are dated 2026-07-25. Rekeyed on the whole heading.
- **Result:** `docs sync` no longer reports Log files as skipped. A full apply
  against Arcadia's own repository reports 42 creates, 0 skips, and 0 errors,
  and a second apply reports everything unchanged. Narrative docs are now the
  only intentional skip a conforming repository produces. Recorded that
  `persist-dependencies` already meets its enforcement criterion, so the plan
  stops claiming work that is done. Found but did not fix an unrelated
  non-convergence: `syncProject` treats `name` as drift while `updateProject`
  cannot write it, so a renamed Project reports an update on every sync forever.
- **Next:** Answer Decision 0004 — dependency persistence, narrative
  summarization, or neither, in which case move `active_plan` to
  `dispatch-contract-enforcement` rather than leaving a pointer nobody intends
  to advance.
- **Blockers:** `persist-dependencies` is `question_open` on Decision 0004, so
  `arcadia next` will keep returning that question rather than dispatching.

## 2026-07-26 — Made Private Practice Now dispatchable again

- **Did:** Repaired Private Practice Now's control documentation. Retyped seven
  research and guide documents onto the shipped narrative vocabulary, added the
  plan and Project milestone, replaced the dangling `current_action: none` with
  the action carrying the open question, and recorded the unmade milestone choice
  as ADR 0012 rather than deciding it. Fixed a defect introduced earlier the same
  day where a plan question naming a decision raised a second Decision alongside
  the decision's own.
- **Result:** `arcadia next` went from eight blockers and no resolvable objective
  to one Project-level question for the operator. The seven refused documents
  were the larger problem: every discovery error is a dispatch blocker, so
  out-of-vocabulary `type:` values had made the entire Project undispatchable
  rather than merely unindexed. PPN now syncs with zero validation errors and
  re-runs as 0 created, 0 updated, 19 unchanged. Full suite passed 638 tests with
  2 skipped and both TypeScript builds passed. No deployment, publish, commit,
  push, credentials, or production access occurred.
- **Next:** Answer ADR 0012 to choose between `define-shared-inquiry-service` and
  `define-first-pilot-success`. Whichever wins still needs `acceptance_criteria`
  before it is dispatchable.
- **Blockers:** None. One duplicate Decision row created by the same-day defect
  was deleted from the workspace database after the code fix; it was minutes old,
  document-derived, and an exact duplicate of the surviving decision record.
  Deciding PPN's milestone order remains the operator's and was left open.

## 2026-07-26 — Cleared the open Decisions and fixed milestone lifecycle

- **Did:** Answered the three standing questions — Decision 0004 (docs sync stays
  strictly one-way, with execution history allowed only in a generated namespace
  ingestion never reads), Decision 0005 (a plan may span milestones through an
  optional per-action `milestone:` override), and Private Practice Now's ADR 0006
  (defer the editor-hosting choice until three clients are live concurrently).
  Implemented the milestone-status derivation, the per-action override, and
  question-to-decision resolution.
- **Result:** The Decision queue is empty across both Projects, down from three.
  Milestone status is now derived from plan status, so `arcadia portfolio`
  reports Arcadia's milestone as "docs sync ingests a real project's markdown"
  instead of one belonging to a completed plan — the old value was selected by a
  two-millisecond gap in insertion order, because `current_milestone` takes the
  newest active milestone and no plan ever ended one. A plan question naming its
  `decision:` inherits that decision's resolution, which is how an answered
  question leaves the queue without ingestion ever deleting. Full suite passed
  637 tests with 2 skipped, up from 633, and both TypeScript builds passed. No
  deployment, publish, commit, push, credentials, production access, or
  destructive action occurred.
- **Next:** `ingest-mission-logs` remains the current Action, now fully specified
  by Decision 0004: the entry key is the heading date plus a title slug, because
  Arcadia may not stamp an id into a human-authored file.
- **Blockers:** None for Arcadia. Two findings in Private Practice Now, reported
  and not fixed: its active plan declares no `milestone:`, so Arcadia fell back
  to the plan slug as a milestone title, and seven of its documents use `type:`
  values outside the vocabulary and were refused. Both are that repository's to
  resolve.

## 2026-07-26 — Made depends_on ordering constrain dispatch

- **Did:** Implemented `persist-dependencies` on the parallel local history.
  Added a `work_item_dependencies` edge table, a second `docs sync` pass that
  replaces each Action's document-declared edges, and a dispatch blocker for
  any unfinished prerequisite.
- **Result:** `depends_on` now constrains what Arcadia hands a coding agent and
  survives a sync round trip. Sync applied 14 real edges across three plans and
  re-ran as 0 created, 0 updated, 42 unchanged; deleting a document-owned edge
  removes it while an edge recorded outside ingestion survives. The full suite
  passed 633 tests with 2 skipped, and TypeScript passed.
- **Next:** `ingest-mission-logs` remained the next protocol Action at the time;
  it was subsequently selected and delivered under Decision 0003.
- **Blockers:** None. This parallel implementation was retained when the local
  and remote histories merged on 2026-07-31.

## 2026-07-26 — Made project continuation actionable

- **Did:** Pulled `main` to the latest merge, then added a project-scoped
  continuation API and Project view panel. The panel resolves the current
  Milestone and Action from the repository's managed documents, displays the
  source plan, expected Artifact, responsibility, resolved execution profile,
  acceptance evidence, operator questions, and deterministic document
  blockers. Added guarded **Get to work** preparation for the exact current
  Action and inline project Decision responses.
- **Result:** Private Practice Now no longer appears idle merely because its
  docs-authoritative Action is `in_progress` and therefore not eligible for the
  portfolio-wide Daily Advantage query. Its valid `systems_change` continuation
  is visible and can prepare a planning Decision without modifying PPN code or
  starting a Run. Refusal remains explicit when a pointer, question, required
  field, or responsibility prevents dispatch.
- **Next:** Keep `ingest-mission-logs` as Arcadia's authoritative current
  Action; this UX increment does not silently change protocol priority. Resolve
  the PPN planning profile only when an approved provider mapping satisfies its
  declared capability and locality requirements.
- **Blockers:** PPN's `systems_change` profile currently refuses preparation:
  no configured planning provider satisfies `c3_systems/e3_deep` while honoring
  `local_only`. Arcadia names every rejected mapping and makes no weaker
  substitution. Narrative and mission-Log persistence plus dependency
  persistence remain documented protocol gaps.

## 2026-07-25 — Made clarification Decisions conversational

- **Did:** Repaired the shared Decision-response contract, Mission Control
  Review flow, and Discord reply flow so a clarification question can be
  answered in natural language. Added immediate durable acknowledgment,
  automatic re-clarification, and an explicit AI-advice-to-editable-draft
  handoff.
- **Result:** Free-form Discord replies now resolve the exact referenced
  `ActionClarification` Decision instead of falling through to generic Ask.
  Mission Control shows **Your answer** and **Answer & continue**, removes
  approval-style execution affordances for clarification, clears the answered
  Decision immediately, and then surfaces either the concrete next Action or
  one focused follow-up. Answering never authorizes execution. Browser
  dogfooding verified the durable acknowledgment in about 1.5 seconds while a
  roughly 28-second local clarification completed independently. Focused CLI
  and Discord tests passed; the full suite passed 628 tests with 2 skipped,
  both TypeScript builds passed, and the production Dashboard build passed.
- **Next:** Keep `ingest-mission-logs` as the authoritative current Action and
  ask the operator which protocol increment to prioritize. Monitor real
  clarification replies before adding a non-threaded Discord fallback.
- **Blockers:** Automatic continuation requires local Intelligence; when it is
  unavailable, Arcadia preserves the answer and leaves the Action ready to
  continue. Dogfooding also exposed a queued no-step Run and the absence of a
  canceled Run state; its Decision was rejected and its audit record was marked
  failed before any executor ran. No deployment, publish, commit, push,
  production access, credentials, or destructive action occurred.

## 2026-07-25 — Validated docs sync and continuation against Private Practice Now

- **Did:** Read both repositories' instructions and bounded context; previewed
  then applied Arcadia workspace sync for
  `/Users/pmark/Dev/PrivatePracticeNow/platform`; resolved its milestone and
  `define-shared-inquiry-service` Action; and tested execution-profile parsing
  plus deterministic refusal of weaker capability/effort requirements.
- **Result:** Foreign sync preview found 15 managed creates, 14 intentional
  narrative/Log skips, and zero validation errors. The minimum PPN managed-doc
  patch was a `systems_change` execution declaration on the current Action and
  its plan-level milestone. Re-sync applied one milestone update with zero
  errors. Arcadia focused tests passed 49/49; PPN `pnpm typecheck` passed.
  No implementation code, deployment, publish, commit, push, credentials,
  production access, or destructive action was used.
- **Next:** Answer the one continuation question: choose mission-Log ingestion,
  narrative summarization, or dependency persistence as the next protocol
  increment. Arcadia will not infer priority from backlog order.
- **Blockers:** None for the completed validation. Narrative/Log ingestion and
  dependency persistence remain known protocol gaps, not foreign-repository
  blockers.

## 2026-07-25 — Selected the first foreign repository for protocol validation

- **Did:** Recorded Decision 0002 and selected
  `/Users/pmark/Dev/PrivatePracticeNow/platform` for the first non-Arcadia
  `docs sync` validation. Promoted `second-project-validation` to the current
  clarified Action with a cross-system execution profile and bounded acceptance
  criteria.
- **Result:** The continuation procedure now has one operator-resolved target,
  a concrete next Action, and an explicit Artifact requirement. Validation will
  remain documentation- and workspace-only; Private Practice Now application
  code, deployment, publishing, credentials, production access, and commits
  are out of scope.
- **Next:** Preview and apply the minimum managed-document changes, then run
  `docs sync`, `arcadia next`, profile resolution, and deterministic refusal
  probes against both repositories.
- **Blockers:** None after Decision 0002; any provider, credential, production,
  destructive, or unauthorized product boundary remains a stop condition.

## 2026-07-25 — Added the authoritative work pointer

- **Did:** Implemented the Arcadia Coding-Agent Continuation Contract's control fields — `active_plan`, `current_action`, per-action `acceptance_criteria`, `decisions`, and `references` — plus `arcadia next`, which resolves the objective from the repository or refuses with a named remedy per blocker.
- **Result:** Arcadia's own documents now carry a resolvable pointer. `arcadia next` reports the current action as `second-project-validation`, blocked on open decision 0002, and returns exactly one operator question instead of a request for direction.
- **Next:** Answer decision 0002 — which non-Arcadia repository to validate the protocol against — then dispatch `second-project-validation`.
- **Blockers:** Decision 0002 is open; choosing the repository is an operator call and materially changes direction, so no implementation proceeded past it.

## 2026-07-25 — Dogfooded the docs protocol against Arcadia itself

- **Did:** Built `docs sync` (frontmatter parser, vocabulary validator, repo crawler, doc_ref-keyed upsert) and `arcadia portfolio`, then converted Arcadia's own PROJECT.md, MISSION_LOG.md, and both plan documents into managed documents.
- **Result:** Arcadia's own repository is the first project ingested by the protocol it defines; the clarification-pass plan's five actions and one open question now exist as real rows.
- **Next:** Run `docs sync --apply` against a second, non-Arcadia project to test the protocol against documentation nobody wrote with the schema in mind.
- **Blockers:** none

## 2026-07-24 — Shipped the clarification loop end to end

- **Did:** Implemented Phases 1–4 of the clarification pass: CLI plumbing, five structured clarification columns, clarification Decisions plus Action subtasks, and the `arcadia clarify` orchestrator over local Intelligence.
- **Result:** Capture no longer pretends to clarify. An Action is explicitly unclarified until the rubric names a concrete next action or opens exactly one Decision.
- **Next:** Use the loop on real captured work before scoping further automation.
- **Blockers:** none

## 2026-07-23 — Established the operator-agnostic data model

- **Did:** Collapsed `needs_mark` into `requires_review` and renamed the `mark` executor type to `operator`.
- **Result:** No personal name remains in the persisted vocabulary or CLI output.
- **Next:** Begin the clarification pass.
- **Blockers:** none
