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

**Agent help kinds.** Decision 0297 amends Decision 0288 rule 2 in the words
the operator answered "1A 2A" to (2026-11-26T03:43:49Z). It was first merged as
Decision 0296 (#3100), and #3106 renumbered it to 0297 because main already had
a different 0296 (#3108). A clean run means no touch from the operator after the press, with any agent help being only the
logged mechanical kinds, and every report also shows the strict, nobody-touched
count beside it. Still clean, and logged: the worker fixing something itself
(C0); an agent re-running a check where every test passed (at most once per
version) (C1); an agent clearing a host snag that changes no files or records
(C2). Not clean: an agent editing code or content by hand (C3); a governance
step mid-run, such as switching production off and on (C4); any touch from the
operator after the press (C5). A cause recurring twice must get a real fix. If
it happens a third time without one, it no longer counts as clean. Decision
0298 (the operator's "2A", 2026-11-26T04:28:43Z) adds that a touch means acting
on that run itself (its jobs, its PRs, or switching production), so his answers
about other work while it runs don't count. Any wider term needs a separate
question to the operator.

**Status values:** `not reached`, `ready to celebrate` (its test passes,
waiting for the operator), `declared` (the operator declared it, with the date
and the operator's words).

**Plans that move a Milestone.** The last column points to Ellis's draft Plan
proposals of 2026-11-26 (host-local, `workspaces/ellis-plans-20261126/`, not yet
registered): **A** One stop never ends the card, **B** Production runs clean by
itself, **C** Nights never run empty, **D** Coordinator and refusals recover
without the operator. A pointer is a proposal, not a commitment, until the
operator approves that Plan.

## The list

Milestones 4 and 5 can be worked beside 1 to 3; the rest are in order.

| # | Milestone | Done when | Status | Evidence, 2026-11-26 | Plans that move it |
|---|---|---|---|---|---|
| 1 | Three clean supervised runs | Three per-card runs of one shape each finish every step with no operator touch after the press, and any agent help only the logged mechanical kinds (Decision 0288 rule 2 as amended by Decision 0297). | ready to celebrate | **5 qualifying runs of one shape, 3 of them strict clean.** The shape is the Track 2 shape: start-run card path, test-only jobs, one at a time. Track 3 counts as the same kind of run under Decision 0297 (2A).<br>• Track 2 card A `start-run-track-2-standby-pins-20261125a`: strict clean, 4 of 4 merged ("4 merged, 0 escalated" at 07:38:58Z).<br>• Track 2 card B `start-run-track-2-standby-pins-20261125b`: one C1, an agent CI re-run on #3072 after unit-shard-1's 10-minute timeout with no test failure (cause #3073).<br>• Track 2 card C `start-run-track-2-standby-pins-20261125c`: strict clean, 2 of 2 ("2 merged, 0 escalated" at 22:41:09Z).<br>• Track 3 card A `start-run-track-3-standby-pins-20261125a` (run 20261126T024306Z-53685): 3 of 3 merged by the worker (#3093, #3094, #3096). Its one C1 was a re-run on #3094 with all 791 tests passing. The operator's three answers about other work during the run are not touches (Decision 0298). The #3073 cause got its real fix: #3095 (15-minute limit) and #3099 (test split).<br>• Track 3 card C `start-run-track-3-standby-pins-20261125c` (run 20261126T073729Z-80200): strict clean, 2 of 2 merged by the worker (#3111, #3112; "2 merged, 0 escalated" at 08:26:04Z), with no touch of any kind after the press. It completed the Track 3 Plan (8 of 8).<br>**Runs that do not count:**<br>• Track 3 card B `start-run-track-3-standby-pins-20261125b` (run 20261126T045159Z-81479) is NOT clean. It had a C4, a mid-run settle and Off. It merged 2 of 5 (#3102, #3103), and Action 6 later landed on the operator's word (#3109). This does not reduce the count: the test needs three runs, not consecutive ones.<br>• Earlier small-source card c `start-run-timeline-ask-supersessions-20261124a` (strict clean) is a different shape.<br>The operator alone declares it reached. | B keeps the count growing (C1/C2 become worker C0); A stops one stuck Action from ending a card |
| 2 | Dress rehearsal passes unstubbed | A full rehearsal of the standing-grant self-press runs every stage in a disposable clone without stubs, and passes (Decision 0288 rule 1). | not reached | Per-card rule-1 rehearsals ran before Track 2 card C and Track 3 cards A to C (for example, `workspaces/rehearsals/track3-cardC-20261125.noindex/receipt.md`: rule-1 PASS). Those rehearsals stubbed the provider CLI at P4 and stopped P4 at launchctl, and none rehearsed the **standing-grant self-press**. So no rehearsal meeting this test is on record. | None of A to D targets this directly; it is a coordinator rehearsal, not a build. C's Action 4 adds a rule-1 replay of the timer's next-Plan press (inference: the first natural carrier) |
| 3 | First self-pressed night | The timer presses under the standing grant (Decision 0241) and that night (9 PM to 8 AM Pacific) merges at least one Action, with no operator step, not even the 9 PM press. | not reached | The self-press has never run live. The open grant `standing-grant-20261123b` is pinned to the engine Plan, which is now complete, and its successor step ended on 11-24 (`PREFLIGHT_FAILED`; `workspaces/track2-readiness-20261125.md`). All of 11-24's and 11-25's merges followed operator presses. | C (the timer has an approved next Plan), A (the timer issues the Off), D (a refused press costs one tap) |
| 4 | Coordinator never dies silently | A Rowan that runs out of context or stalls during a night is replaced within minutes, with an alert and no operator action. | not reached | On 11-22, 3 h 13 min was lost to a dead coordinator (host-local `serial-wait-log-20261122.md`). Merged on 11-25 (checkpoint-admitted): #3033, under which the host timer stops a handed-off predecessor's tmux. Held for the checkpoint: #3080 (M4a, a page when the custodian dies or hits its limit, #3077). Its review passed, but non-blocking N2 must be repaired before merge. The replacement half (M4b) needs Plan H and its Decision. | D (paging and the 0284 handoff lines); M4b deferred to Plan H |
| 5 | Refusals retry themselves | A refused press that consumed nothing is retried by one operator tap, and automatically after three clean runs (Decision 0289 D). | not reached | Decision 0289 D was approved on 11-24 and is not built. No Action existed until Plan D's draft. | D (one-tap retry; the automatic half waits for Milestone 1's declaration) |
| 6 | One failure never ends the night | A night with one failed step parks it and still merges the rest (North Star gate 2). | not reached | **Correction:** Plan F's `park-and-continue` module exists (#2948), but at main `a558014ca` `src/production/parkAndContinue.ts` has no importer outside tests (#3047), so it is not wired. Live counter-evidence came on 11-25: in Track 3 card B, Action 6 went `terminal_candidate_not_integrable`, and the independent Actions 7 and 8 were never admitted (#3107). Track 3 card C then ran Actions 7 and 8 to merge (#3111, #3112), so those two Actions were not lost; the stall cost one Off and a second card. The cause is that the scheduler passes only "held" kinds (`src/production/terminalCandidates.ts:65`). | A |
| 7 | Nights never run empty | A Plan finishing mid-night starts the next approved Plan with no touch, and the 8 AM report shows zero empty nights in a week (North Star gate 3). | not reached | Plan F's `queue-approved-plans-and-start-the-next` is still open (#2774).<br>• Nights 11-22 and 11-23 had no worker merge.<br>• The night of 11-24 had 4 worker merges (#3060 to #3063, Track 2 card A, operator-pressed).<br>• The night of 11-25 had 2 (#3102 at 9:24 PM and #3103 at 9:41 PM PST, Track 3 card B, operator-pressed).<br>No 8 AM report counts empty nights today (see 8). | C |
| 8 | Merges rechecked each morning | The 8 AM report re-verifies every overnight merge on main (North Star gate 4). | not reached | **Correction:** Plan F's `verify-overnight-merges-at-8am` is marked done, but at main `a558014ca` `src/production/overnightVerify.ts` has no importer outside tests. So no 8 AM report runs (playbook B5, #2939). | C (Action 1 wires it; Action 2 refuses future unwired "done" modules) |
| 9 | Real work runs unattended | A night of source-changing Actions, run under Decision 0290 A's model rule, merges through the worker gate with no operator touch (North Star gate 1). | not reached | Plan F's `worker-applies-standing-merge-conditions` (gate 1) is built and wired: `workerMerge.ts` imports `standingMerge.ts`. The live proof is missing. On 11-24, three small source Actions merged through the worker gate, but in pressed daytime runs. **New gap:** production launches do not apply Decision 0290 A's model rule (#3049). | B (Action 4: the model rule; Actions 1 and 2: fewer stops), A |
| 10 | **Unattended Production Fully Achieved** | Three clean nights in a row on real work, with all four North Star gates live (`docs/strategy/current.md`). | not reached | 0 of 3 nights. Gates 2 and 4 are not wired (see 6 and 8), and gate 3 is not built (see 7). | A, B, C, D together |

## Forecast

Mira's forecast of 2026-11-24 (an estimate, not a measurement): a clean
supervised run in 1 to 4 days, a first zero-touch night in 1 to 3 weeks, and a
reliable week in 6 to 12 weeks.

Ellis's inferences of 2026-11-26 (not measurements):
- The first estimate came true within 1 day.
- Two North Star gates that read as built (2 and 4) are not wired. That adds build work before Milestones 6 and 8 can be proven, but each fix is small (size M).
- Milestones 4 and 5 still remove the most lost time per the 11-22 serial-wait log. Milestone 6 (Plan A) removes the failure seen most recently.

## Sources

- `NORTH_STAR.md`, `docs/strategy/current.md`, `docs/roadmap.md`,
  `docs/managed-production-readiness.md`
- Decisions 0241, 0274, 0282, 0284, 0288, 0289, 0290, 0297 and 0298
- Issues #3047, #3049, #3073, #3077, #3105, #3107 and #3108
- PRs #3080, #3095, #3099, #3102, #3103, #3106 and #3109
- `git grep` for importers at main `a558014ca`
- the START card receipts, the worker log, and the host-local
  `workspaces/checkpoint-inputs-20261125.md` (sections 9 and 10)
