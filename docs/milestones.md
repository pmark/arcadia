# Arcadia Milestones: the route to unattended production

This is the canonical list of Arcadia's Milestones, from 2026-11-24 to
**Unattended Production Fully Achieved**. It was accepted from Agent Ask
`ellis-canonical-milestones-to-unattended-production-20261124` (settlement
receipt `asksettle_2d7fd65a7a604bc9ad`), on the operator's words in Ellis's
session on 2026-11-25: "Settle the milestone list proposal".

**What a Milestone is.** Decision 0274 A: a celebrated achievement where new
capabilities are obvious and usable, a big state change on the way to the North
Star. **Only the operator declares a Milestone reached.** A view or an agent may
say "ready to celebrate" when its test passes; nothing else. A Plan's
`milestone:` field is not a Milestone: Decision 0274 A renames it to a
Checkpoint (build Action `build-the-checkpoint-field` in Plan F, Issue #2916).

**How this file changes.** Status and evidence are updated by the agent keeping
the tracker (Ellis today) in a docs-only PR that cites its evidence. A change to
a Milestone's name, order or "done when" test needs the operator's words or a
Decision. The stopgap tracker page is private to the operator and refreshed by
hand until the Roadmap page (`/workspace/roadmap/arcadia`) reads this file.

**Status values:** `not reached`, `ready to celebrate` (its test passes,
waiting for the operator), `declared` (the operator declared it, with the date
and the operator's words).

## The list

Milestones 4 and 5 can be worked beside 1 to 3; the rest are in order.

| # | Milestone | Done when | Status | Evidence, 2026-11-25 |
|---|---|---|---|---|
| 1 | Three clean supervised runs | Three per-card runs of one shape each finish every step with no escalation and no operator touch beyond the press (Decision 0288 rule 2). | not reached | Two runs clean on the strict reading, of two different shapes: card c `start-run-timeline-ask-supersessions-20261124a` (small source, 1 of 1 merged) and `start-run-track-2-standby-pins-20261125a` (test-only, 4 of 4 merged, worker log "4 merged, 0 escalated" at 07:38:58Z). One of three for each shape. |
| 2 | Dress rehearsal passes unstubbed | A full rehearsal of the standing-grant self-press runs every stage in a disposable clone without stubs, and passes (Decision 0288 rule 1). | not reached | No unstubbed rehearsal on record. |
| 3 | First self-pressed night | The timer presses under the standing grant (Decision 0241) and that night (9 PM to 8 AM Pacific) merges at least one Action, with no operator step, not even the 9 PM press. | not reached | Grant `standing-grant-20261123b` is open (`arcadia start-run grant-status`); the self-press has never run live. The night of 11-24 merged 4 Actions after the operator's press. |
| 4 | Coordinator never dies silently | A Rowan that runs out of context or stalls during a night is replaced within minutes, with an alert and no operator action. | not reached | 11-22 lost 3 h 13 min to a dead coordinator (`workspaces/serial-wait-log-20261122.md`). Related fix PR #3033 is open. |
| 5 | Refusals retry themselves | A refused press that consumed nothing is retried by one operator tap, and automatically after three clean runs (Decision 0289 D). | not reached | Decision 0289 D approved 11-24; not built. |
| 6 | One failure never ends the night | A night with one failed step parks it and still merges the rest (North Star gate 2). | not reached | Plan F `park-and-continue` is built (#2948); not yet proven on a live night. |
| 7 | Nights never run empty | A Plan finishing mid-night starts the next approved Plan with no touch, and the 8 AM report shows zero empty nights in a week (North Star gate 3). | not reached | Plan F `queue-approved-plans-and-start-the-next` is open. Nights 11-22 and 11-23 had no worker merge. |
| 8 | Merges rechecked each morning | The 8 AM report re-verifies every overnight merge on main (North Star gate 4). | not reached | Gate 4's Action is not done. |
| 9 | Real work runs unattended | A night of source-changing Actions, run under Decision 0290 A's model rule, merges through the worker gate with no operator touch (North Star gate 1). | not reached | 11-24: three small source Actions merged by the worker gate, but in pressed daytime runs. |
| 10 | **Unattended Production Fully Achieved** | Three clean nights in a row on real work, with all four North Star gates live (`docs/strategy/current.md`). | not reached | 0 of 3 nights. |

## Forecast

Mira's forecast of 2026-11-24 (an estimate, not a measurement): a clean
supervised run in 1 to 4 days, a first zero-touch night in 1 to 3 weeks, and a
reliable week in 6 to 12 weeks. Ellis's inference, not a measurement:
Milestones 4 and 5 remove the most lost time, judging by the 11-22 serial-wait
log.

## Sources

`NORTH_STAR.md`, `docs/strategy/current.md`, `docs/roadmap.md`,
`docs/managed-production-readiness.md`, Decisions 0241, 0274, 0288, 0289 and
0290, git history on main, the START card receipts, and the worker log.
