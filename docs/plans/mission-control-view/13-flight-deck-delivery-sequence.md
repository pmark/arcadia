# Flight Deck: delivery sequence and continuation guide

This is the readable companion to the exact Agent Ask in 14. It proposes 20
session-sized Actions: four amendments preserving existing ids and sixteen new
Actions. It is not a second managed plan and does not change the current pointer.

## Milestone and order

Current governed Milestone: Flight Deck board carries the whole portfolio on one
surface. Completion of this expanded feature additionally requires the full loop
in 12 and acceptance matrix in 15; a board alone does not satisfy the proposal.

Build the truthful shell and reused controls first, then launch/observe/prove,
then integrate, rehearse and make it home. The existing current Action remains
first and independently executable. Dependencies below are required prerequisites,
not permission to start parallel sessions. At each stopping point the governed
pointer selects the next accepted Action, not this table or document order.

| Order | Action | Prerequisites | Execution sizing | Proof Artifact |
| --- | --- | --- | --- | --- |
| 1 | `project-plan-lanes-and-pipeline-columns` | None; current pointer | `routine_implementation`; medium effort | Projection/state fixtures and first route desktop screenshot |
| 2 | `focus-the-board-on-active-work` | `project-plan-lanes-and-pipeline-columns` | `routine_implementation`; medium effort | Cold-open orientation fixture and visible/hidden count evidence |
| 3 | `open-the-object-detail-rail` | `project-plan-lanes-and-pipeline-columns` | `routine_implementation`; medium effort | Keyboard/deep-link test and typed relationship fixtures |
| 4 | `expose-planned-portfolio-work` | `open-the-object-detail-rail` | `routine_implementation`; medium effort | Multi-Project planned-work fixture with empty and dormant Plans |
| 5 | `reuse-queue-steering-controls` | `open-the-object-detail-rail` | `routine_implementation`; medium effort | Two-route queue parity, conflict and undo tests |
| 6 | `reuse-contextual-decision-controls` | `open-the-object-detail-rail` | `routine_implementation`; medium effort | Decision journey parity with rejection, deferral and conflict cases |
| 7 | `carry-the-dispatch-command` | `open-the-object-detail-rail` | `systems_change`; high effort | Selection and launch-preview contract fixtures including both providers |
| 8 | `connect-action-to-launch-packet` | `carry-the-dispatch-command` | `systems_change`; high effort | Packet lifecycle and authority-boundary integration fixtures |
| 9 | `support-selected-codex-and-claude-sessions` | `connect-action-to-launch-packet` | `systems_change`; high effort | Provider adapter, lease conflict and backward-compatibility tests |
| 10 | `expose-guarded-host-session-launch` | `support-selected-codex-and-claude-sessions` | `systems_change`; high effort | Launch boundary, replay, crash-window and conflict integration tests |
| 11 | `launch-selected-agent-from-flight-deck` | `expose-guarded-host-session-launch`, `reuse-queue-steering-controls`, `reuse-contextual-decision-controls` | `routine_implementation`; medium effort | Browser launch journeys for both adapter fixtures and lost response |
| 12 | `observe-portfolio-agent-sessions` | `launch-selected-agent-from-flight-deck` | `systems_change`; high effort | Active-history truncation, reconnect and lifecycle fixtures |
| 13 | `reconcile-session-exits-to-next-move` | `observe-portfolio-agent-sessions` | `systems_change`; high effort | Exit-to-evidence-to-next-move lifecycle integration tests |
| 14 | `reuse-proof-and-delivery-controls` | `open-the-object-detail-rail`, `reconcile-session-exits-to-next-move` | `routine_implementation`; medium effort | Proof-state and exact-revision QA parity fixtures |
| 15 | `capture-and-correct-work-in-context` | `open-the-object-detail-rail` | `routine_implementation`; medium effort | Capture replay, attachment and correction browser fixtures |
| 16 | `surface-operational-exceptions-and-changes` | `observe-portfolio-agent-sessions`, `expose-planned-portfolio-work` | `routine_implementation`; medium effort | Failure, fired-trigger and evidence-linked change fixtures |
| 17 | `complete-flight-deck-mobile-and-navigation-parity` | `focus-the-board-on-active-work`, `expose-planned-portfolio-work`, `launch-selected-agent-from-flight-deck`, `reuse-proof-and-delivery-controls`, `capture-and-correct-work-in-context`, `surface-operational-exceptions-and-changes` | `routine_implementation`; medium effort | Desktop/phone screenshots and keyboard/navigation Playwright evidence |
| 18 | `verify-flight-deck-operational-loop` | `complete-flight-deck-mobile-and-navigation-parity`, `reconcile-session-exits-to-next-move` | `systems_change`; high effort | Frozen Candidate QA pack and full journey/failure matrix |
| 19 | `dogfood-flight-deck-as-operations-home` | `verify-flight-deck-operational-loop` | `routine_implementation`; medium effort | Dated real-week operator rehearsal and acceptance record |
| 20 | `make-flight-deck-the-default-entrance` | `dogfood-flight-deck-as-operations-home` | `routine_implementation`; medium effort | Default-entry and legacy-link smoke evidence plus rollback note |

## Recommended agent, effort and budget

The active plan currently pins `claude-sonnet-5`; retain that configured coding
agent as the routine handoff rather than invent a new provider choice. Use medium
effort for ordinary UI integration and high for the Session/authorization slices
and end-to-end failure verification. These are execution-sizing recommendations,
not claims about measured provider quota. Resolve actual installed support before
launch; an unsupported effort or model is a visible preparation refusal.

The portable profile names above describe the smallest suitable work: ordinary
UI work is `routine_implementation`; cross-system execution/lifecycle work is
`systems_change`. Flight Deck runtime selection must use the existing portable
profile and adapter mapping. A plan's legacy recommended_model is not a universal
provider-selection algorithm and must not override immutable packet provenance.

Budget one bounded coding session per Action, deterministic checks before model
review, and one independent review where the authority boundary warrants it.
No speculative token totals, new weekly allowance model, continuous agent loop,
or narration on browsing. The active plan's existing one-pass token_budget text
predates this expanded scope; the estimate here is twenty bounded sessions,
subject to splitting a leaf if actual evidence makes it too large.

The Agent Ask v1 child schema cannot set execution, effort, expected_artifact,
model or plan token_budget fields. It creates session-sized agent Actions and a
generic expected_artifact; each Action's acceptance explicitly names its real
proof and references this guide. Do not hand-edit governed metadata to work
around that schema. Preserve the existing model pin and use a supported explicit
session effort override when launching. A separate capability proposal records
the metadata amendment gap; it does not block these supported Action amendments.

## Each arcadia go session

1. Read current main and the repository's `PROJECT.md`/active plan through the
   normal continuation skill and dispatch command. Name the exact scope.
2. Read only the current Action's references, the relevant audit rows, contract
   clauses and acceptance scenarios. Verify the named reusable mechanism still
   exists before changing it. Do not rebuild an adjacent specialist.
3. Work in one isolated worktree/branch. Bridge dependencies and distinguish
   source tests from package imports resolving another checkout's built output.
4. Deliver one usable increment and its named proof. For shared extractions,
   exercise the old surface as well as Flight Deck. For execution, prove refusal
   and replay cases deterministically before requesting a real model run.
5. Open/update the PR with the exact target, reachability, start/recovery command,
   change description and numbered QA steps. Update START_HERE for actual changed
   flows; do not advertise an unimplemented or unreachable route.
6. Record completion/evidence and advance through the established approved
   governance mechanism. If judgment or external input is needed, preserve one
   precise question and stop; never infer acceptance from elapsed time or exit.
7. End the session at a merge, ratification or completed Milestone. The next
   session opens with `arcadia go`; its pointer, not a conversational task list,
   supplies the next scope. Recommend the effort appropriate to that next Action.

## Settlement and preservation

Run `arcadia agent-ask preview --file docs/plans/mission-control-view/14-flight-deck-plan-amendment.yaml --json`.
Inspect every refusal and the exact amendment references. Obtain a settlement
preview with Responsibility agent and an explicit queue placement. Recommend
placing the dependency-safe Flight Deck bundle at the top because the operator
has made it the active operational priority; this is a proposed portfolio move,
not authority inferred from plan activation. Other Projects' pointers stay intact.

The operator settles the exact preview. Settlement resolves the configured
Project repository, not necessarily the invoking worktree: verify its absolute
path, clean branch and current revision before apply. Do not assume running the
command in a documentation worktree redirects canonical writes. Settlement commits
locally and does not push. Preserve/push the actual settlement branch under the
repository's explicit approval rules and inspect resulting queue/pointer readiness.

Do not claim these Actions are canonical or ready for iterative dispatch until
settlement succeeds and the expanded plan is in the source used by continuation.
The documentation PR itself does not settle the Ask, approve implementation,
launch a provider, or authorize merge/deployment.

## Preview result and prerequisite

The live proposal was accepted by the schema with twenty effects and zero
Project writes. The first settlement preview refused because the four existing
Flight Deck Actions are unpositioned. Omitting placement also refuses because
new active-plan Actions must be explicitly positioned. A separate queue arrange
preview at revision 17 succeeds: place the existing four at the top in order
projection, focus, detail, dispatch; preserve the relative order of the other
47 keys. It reports the projection Action as next and applies nothing.

The exact current handoff is in [16](./16-flight-deck-settlement-handoff.md).
Approve/apply the queue prerequisite before generating a fresh full settlement
fingerprint; a proposal fingerprint is not a settlement fingerprint. Neither
preview has been applied, and no canonical plan Actions were changed here.
