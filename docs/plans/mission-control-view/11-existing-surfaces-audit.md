# Flight Deck: existing surfaces and reuse audit

Evidence date: 2026-09-05. Source baseline: `ff59851` (main). This is a
supporting design Artifact, not an implementation or acceptance record.

## Operator problem and scope

Flight Deck is the first place the operator visits to learn what is happening,
what is planned, what needs judgment, and how to change execution. It must close
this loop: orient → choose → preview → act → observe → prove → choose again.
The valuable first increment is a truthful portfolio view with existing controls
within reach; the indispensable next increment is operator-triggered execution
with automatic coding-agent selection and a durable Session receipt.

The current Project pointer is `flight-deck-board-carries-the-whole-portfolio-on-one-surface`
/ `project-plan-lanes-and-pipeline-columns`. The existing four Actions describe
an active-plan board and terminal handoff, not the entire operator experience.
The proposed amendment is in 14; it preserves those four identifiers.

## Audit method and limits

Inspected dashboard route inventory, page requests and navigation, shared UI,
CLI adapters, queue and Decision routes, plan inventory, snapshot derivation,
execution selection, Session preparation and launch, continuation, and the
operator guide. The matrix distinguishes reusable domain contracts from page
components that need extraction. This is source analysis, not a claim that every
mutation has been exercised successfully.

A browser visit to `http://127.0.0.1:3020/` redirected to `/now` and rendered
North Star, gate distance, next move, a short alternative, and attention counts.
Work Queue and Review remained at loading/Waiting for Arcadia on subsequent
observations. Mission Control initially rendered its shell only, then a later observation
showed 42 ready entries and 64 needing attention, with repeated-looking titles
and several ready-but-waiting-for-pointer entries. These are live view counts,
not a deduplicated portfolio census; doc 09's 54-object capture is historical.
Do not deduplicate different canonical ids merely because their titles match. Separate,
concurrent GET probes with a 12-second timeout returned:

| Route | Observed result |
| --- | --- |
| `/api/health` | HTTP 200, 1.6 seconds |
| `/api/qa` | HTTP 200, 4.9 seconds |
| `/api/admin/status` | HTTP 200, 4.7 seconds |
| `/api/work-queue` | Timed out after 12 seconds |
| `/api/snapshot` | Timed out after 12 seconds |
| `/api/mission-control` | Timed out after 12 seconds |

These are bounded observations, not a diagnosis or performance benchmark; the
parallel requests may themselves contribute load. No live mutations, launches,
QA verdicts, service restarts, or repository repairs were performed. Phone and
tailnet reachability were not tested. The guide's documented tailnet address is
not fresh evidence. The new feature has no live target yet.

## Existing surfaces: retain the capability, consolidate the entrance

Paths below are repository-relative source references. API implementations are
under `apps/dashboard/app/api/`; pages under `apps/dashboard/app/`.

| Surface | Existing value and evidence | Flight Deck disposition |
| --- | --- | --- |
| `/now` | `now/page.tsx`, `/api/now`, `/api/now/gate`: North Star, gates, next move, alternative, attention allocation. Page requests deterministic data then optional narration automatically. | Reuse deterministic target/gate summary; link to full focus view. Never run narration merely because Flight Deck opens or polls. |
| `/path`, `/path/resolve/[id]` | Path projection carries dependency-ordered steps and explicit unplanned gaps; work-question route resolves clarification. | Show planned work and gaps, link to the existing focused path/resolution. Do not compute a second critical path. |
| `/mission-control`, `/mission-control/[id]` | Recursive Life/Projects/Decisions overview, attention/recent entries, Agent Queue, What fits, timeline, effort updates and scoped replies. | Retain Life and time-oriented specialists. Reuse links and appropriate context; do not import spatial urgency as execution priority. |
| `/work-queue` | `work-queue/page.tsx`, `lib/work-queue-types.ts`, `/api/work-queue`: explicit order, selected next, filters, move/arrange/undo, separate Make next, revision and fingerprint checks. | Extract current controls and receipt UI for a second real caller. Preserve one queue and its core contracts. No browser-owned order. |
| `/review` | `review/page.tsx`, `lib/needs-you.ts`, `lib/review-search.ts`: dominant judgment, exclusions, search, replies, reassessment, flag-for-agent, rejection feedback, trigger-required deferral. | Extract complete Decision interaction and invoke existing routes. Keep all unresolved judgments discoverable even when their work is in Proving or dormant. |
| `/projects`, `/projects/[id]` | Snapshot Project cards; detail has mission/outcome, continuation, setup, plans, proof, Decisions, Runs, Artifacts, activity. | Project/Plan lane identity and rail reuse these facts; specialist setup stays here, with return to Flight Deck. |
| `/projects/[id]/plans` | `components/plans-list.tsx`, `lib/plans-types.ts`, `/api/projects/[id]/plans`, `src/commands/plans.ts`: all plan statuses, counts, active identity, dormant activation notes, source links. | Reuse for Planned, including plans with zero queue cards. Extend the canonical read contract only for missing Action detail. |
| Project “Get to work” | `/api/projects/[id]/continuation`: rechecks exact Action and dispatchability, refuses stale docs, prepares planning Decision. | Reuse preparation/readiness. It does not start a coding Session; do not relabel it Launch. |
| `/runs`, `/runs/[id]` | `RunCard`, `/api/runs/[id]`, `/api/run-action`: Run evidence, output polling, follow-up reviews, retry Decision. | Reuse Run detail and retry flow; Session is separately identified and linked, never equated with a Run. |
| `/qa` and Project proof hero | `proof-hero.tsx`, `qa-project-strip.tsx`, `lib/qa.ts`, `lib/qa-project-state.ts`, QA/proof APIs: Stable/Candidate, reachability, exact revision, Pass/Fail/Needs follow-up; separate fetch/pull/restart/switch controls. | Reuse proof and verdict components. Expose product testing from the rail; keep repository/service maintenance on its established surface. |
| `/admin/pull-requests` | `/api/pull-requests`: portfolio PR inventory, source/check facts and deterministic briefing. | Show linked delivery state and review destination, not another merge workflow. |
| `/capture`, `/dashboard` Ask | `/api/ask`, `/api/ingress`, `/api/feedback`: text/files, stable request identity, capture receipt, feedback. | Extract scoped capture composer and receipt; entered intent is not automatically approved executable work. |
| `/ingress` | Ingress inventory and description flows with file provenance and derivations. | Link from capture receipt; preserve specialist inspection. |
| `/dashboard` | Today's Advantage, attention, milestones, Runs, Artifacts, activity, Blogging and Rebuster sections. | Reuse constituents, leave domain-specific tools accessible; do not duplicate its whole layout. |
| `/back-burner` | Snapshot and `/api/back-burner-action`: incubation and fired conditions. | Collapsed Planned context plus fired-trigger attention and direct action link. Dormant is not forgotten. |
| `/momentum`, `/reports` | Recent activity, feedback, Artifacts; daily/weekly activity reports and time logging. | Use deterministic recent changes with source links; retain narrative/time reporting here. |
| `/admin/status` | `/api/admin/status`, `lib/system-status.ts`: dependencies, workers, capability readiness. | Compact operational exception and recovery link. A healthy HTTP server does not prove queue or agent readiness. |
| `/admin/dispatch-journal` | Dispatch-refusal counts and blocking fields. | Reuse reason/remedy links when dispatch fails. No new diagnostic history store. |
| `/admin/intelligence` | Existing Intelligence job, usage, capability, artifact and retry tools. | Specialist link for failures; this usage is not interchangeable with coding-provider weekly allowance. |
| Discord | `apps/discord-bot`, CLI snapshot poller and review reply routing. | Preserve existing notifications/deep links. Default-route migration must not break them; no new notification engine. |

## Shared code: reuse facts before extracting presentation

- `components/dashboard-ui.tsx` supplies cards, badges, empty/error/loading
  states and review interactions. Extract only components with two concrete
  callers, and cover parity at those callers. Avoid a universal node renderer.
- `components/chrome.tsx` and `components/sidebar.tsx` contain different nav
  lists. `/` redirects to `/now`; the desktop chrome calls `/` Today, while
  the sidebar has Now, Mission Control and Full Dashboard. A new tab alone
  would create a fourth competing home. Cutover must update both shells,
  root routing, manifest entry behavior and `START_HERE.md` together.
- `hooks/use-arcadia-snapshot.ts` refreshes every 5 seconds with active Runs,
  otherwise 45 seconds. It retains old data on failure but has no request
  cancellation/deadline. Flight Deck needs one bounded refresh owner per
  source; a shared extractor should improve both actual callers, not add
  overlapping pollers to each card and rail.
- `lib/arcadia-cli.ts` is the established process boundary. API handlers mostly
  call this instead of manipulating SQLite. Continuation contains direct core
  imports: treat that as existing code to understand, not a reason to grow
  another domain implementation in the dashboard.

## Domain mechanisms already built

| Concern | Owner | Reuse and gap |
| --- | --- | --- |
| Governed dispatch | `src/docs/dispatch.ts` | Reuse current pointer and `resolveActionReadiness`; queue priority never supplies authority. |
| Queue order | `src/dispatch/queue.ts`, `src/dispatch/order.ts`, `src/commands/advance.ts` | Reuse explicit keys, revision, exact previews and undo. `selected`, readiness and `pointerAuthorized` are distinct. |
| Automatic agent selection | `src/codingAgents/providerAdapters.ts`, `src/execution/profiles.ts` | Filters requirements and availability, sorts capability then effort then cost/profile. Reuse; do not write a dashboard recommendation algorithm. No weekly quota promise. |
| Planning/build packets | `src/execution/planningPreparation.ts`, `planningAuthorization.ts`, `src/stewardship/artifactValidator.ts` | Preserve immutable packet, scoped approval and accepted-plan promotion. A clarified Action may still lack a launchable build packet. |
| Session | `src/sessions/index.ts`, `src/commands/advance.ts` | Stores Action/packet/binding/branch/worktree/native id; repository lease and tmux observation. Preparation and launch are currently Claude-specific. Extend for Codex instead of creating a second Session ledger. |
| `arcadia go` | `src/commands/go.ts` | Worktree preparation and handoff exist, but apply also fetches, fast-forwards and may reconcile prior work. Do not shell out to generic go/apply as a browser launch shortcut. |
| Completion | `src/sessions/index.ts`, Run review, accepted Artifact and managed docs | Observed exit is not accepted completion. Session view maps absence to exited; reconciliation and evidence linkage must become an explicit, tested round trip. |
| Governance proposals | `src/ask/agentAsk.ts`, `src/ask/settlement.ts` | Preview/settlement, canonical writes, queue placement and receipt exist. Reuse for changing planned work. Proposal text cannot approve itself. |

## Findings that change the old build specification

1. `src/dashboard/snapshot.ts` defaults to 10 Runs and 10 Artifacts; activeRuns
   is calculated from that Run slice. Counts can miss older still-running work.
   Add authoritative active-execution coverage; label history windows and totals.
2. Work Queue represents active-plan Actions, while plan inventory includes
   non-active plans. The two original endpoint payloads cannot alone satisfy
   “what is planned,” especially empty lanes and dormant Actions.
3. The dashboard WorkQueueEntry type does not declare `repositoryRoot`, although
   the core queue carries it. Fix the contract at its boundary; derive trusted
   launch repository identity on the server, never from browser path text.
4. Needs you currently excludes all blocked_work as deterministic repair and
   excludes/deduplicates some historical packets/Runs. Reuse its explanations,
   but do not assume all failures need an operator or hide all repair blockers.
5. QA Decisions belong in Proving but still need the operator. Stage and who
   owes the next move must be separate properties.
6. Artifact existence proves neither accepted completion nor merge/release.
   Use a Results area with honest proof states until Landed is evidenced.
7. Session launch checks packet/provider/model consistency; selection alone
   cannot guarantee launch. Codex adapter parity and no-packet handling are
   required, not optional polish.
8. The app has no general auth layer. Adding host process launch to a browser
   requires a bounded operator-action request guard, trusted Project resolution,
   server-owned arguments, duplicate prevention and current authority checks.
   Do not turn the endpoint into a shell or widen network exposure.
9. The current linear Project → Plan → Action → Decision → Artifact chain is
   incomplete: work may have multiple Decisions, dependencies and Outputs.
   Render an evidence-backed neighborhood with typed edges and honest gaps.
10. The live waiting states make bounded source isolation part of the first
    slice. Do not claim a root cause without a separate measured diagnosis.

## Keep deferred, with triggers

3D/force layout: revisit only after the complete operational loop works and a
recorded navigation task remains materially hard with board/list/search.
Weekly provider budgeting: retain doc 10's existing telemetry/operator-request
trigger. Continuous managed production is now required by the operator; see the source
audit and scope in 17. Arbitrary terminal streaming/control,
transcript interpretation and agent chat injection: revisit when a documented
operator task cannot be completed through one explicit Session plus native
reattach/resume. Deleting specialist routes: only after real-week parity proof
and explicit retirement approval. None gates automatic selection and launch.

## Existing plan overlap and continuation hazards

- `docs/plans/idea-to-managed-build.md#launch-tmux-backed-session` remains
  open with its next move narrowed to a real disposable-repository rehearsal.
  The Claude implementation exists. Flight Deck must reuse it and preserve
  its pending live proof, not rebuild it or claim that fixture tests close it.
- The same Plan's `reconcile-session-exit` is open and already specifies thin
  terminal receipts and next-state resolution. Flight Deck's reconciliation
  slice implements/integrates that existing contract in the same core module;
  link the proof back through governance instead of adding a second reconciler.
  Recheck its status at dispatch: if another session delivers it, do integration
  and parity proof only. Neither plan is silently activated or marked done.
- `agent-ask-execution-queue` has completed the queue and Dashboard controls;
  its unresolved natural Ask quality and question reconciliation tail is not
  authority to redesign Ask in Flight Deck. Reuse the completed capture path
  and show an honest unresolved question when interpretation is incomplete.
- `provider-capacity-harvesting` remains proposed; the Session Unit ledger is
  deferred. Availability-based selection is already real; weekly budgeting is
  a separate unresolved telemetry capability.
- `work done` calls `completeWorkItem`, which updates database status. It is
  not evidence that checked-in managed Action completion or pointer advancement
  has occurred. Session reconciliation must verify canonical records and expose
  any missing completion path as an explicit review, never fabricate completion.

## Confirmed missing review surface

The operator could not locate this very Flight Deck proposal in the web UI.
A targeted search found no Agent Ask proposal/settlement integration in
`apps/dashboard` or `src/dashboard`. `agent-ask preview` stores a capture and
a row in `agent_ask_proposals`; it does not create an ordinary dashboard
Decision. The existing `/review` interaction is therefore insufficient. Add
a canonical pending-proposal projection and reuse `settleAgentAsk` behind a
contextual review interaction. Never suggest `review approve` for a proposal
id or assume every operator obligation is already in snapshot attention.
