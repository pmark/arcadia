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
0298 (the "2A" of the operator's "1A 2A", 2026-11-26T04:28:43Z) adds that a
touch means acting on that run itself (its jobs, its PRs, or switching
production), so his answers about other work while it runs don't count. Any wider term needs a separate
question to the operator.

**Status values:** `not reached`, `ready to celebrate` (its test passes,
waiting for the operator), `declared` (the operator declared it, with the date
and the operator's words).

**Plans that move a Milestone.** The last column points to Ellis's Plans of
2026-11-26, which the operator approved ("Approve plans A through D") and #3114
registered as inactive drafts in `docs/plans/`: **A** One stop never ends the
card, **B** Production runs clean by itself, **C** Nights never run empty, **D**
Coordinator and refusals recover without the operator. A draft Plan is not
active: none of its Actions is dispatched until it is activated. Activation does
not admit engine-path PRs through the engine freeze (`docs/strategy/current.md`);
those still merge only under its phase-cause rule or a checkpoint verdict.

## The list

Milestones 4 and 5 can be worked beside 1 to 3; the rest are in order.

| # | Milestone | Done when | Status | Evidence, 2026-11-27 | Plans that move it |
|---|---|---|---|---|---|
| 1 | Three clean supervised runs | Three per-card runs of one shape each finish every step with no operator touch after the press, and any agent help only the logged mechanical kinds (Decision 0288 rule 2 as amended by Decision 0297). | declared | **Declared 2026-11-26 by the operator:** "Separately, let's definitely celebrate milestone 1. Good job." (Signal 20 transcript e1a83b65, line 4847, human-origin, 2026-11-26T16:40:06Z, 8:40 AM PST).<br>**5 qualifying runs of one shape, 3 of them strict clean.** The shape is the Track 2 shape: start-run card path, test-only jobs, one at a time. Track 3 counts as the same kind of run under Decision 0297 (2A).<br>- Track 2 card A `start-run-track-2-standby-pins-20261125a`: strict clean, 4 of 4 merged ("4 merged, 0 escalated" at 07:38:58Z).<br>- Track 2 card B `start-run-track-2-standby-pins-20261125b`: one C1, an agent CI re-run on #3072 after unit-shard-1's 10-minute timeout with no test failure (cause #3073).<br>- Track 2 card C `start-run-track-2-standby-pins-20261125c`: strict clean, 2 of 2 ("2 merged, 0 escalated" at 22:41:09Z).<br>- Track 3 card A `start-run-track-3-standby-pins-20261125a` (run 20261126T024306Z-53685): 3 of 3 merged by the worker (#3093, #3094, #3096). Its one C1 was a re-run on #3094 with all 791 tests passing. The operator's three answers about other work during the run are not touches (Decision 0298). The #3073 cause got its real fix: #3095 (15-minute limit) and #3099 (test split).<br>- Track 3 card C `start-run-track-3-standby-pins-20261125c` (run 20261126T073729Z-80200): strict clean, 2 of 2 merged by the worker (#3111, #3112; "2 merged, 0 escalated" at 08:26:04Z), with no touch of any kind after the press. It completed the Track 3 Plan (8 of 8).<br>**Runs that do not count:**<br>- Track 3 card B `start-run-track-3-standby-pins-20261125b` (run 20261126T045159Z-81479) is NOT clean. It had a C4, a mid-run settle and Off. It merged 2 of 5 (#3102, #3103), and Action 6 later landed on the operator's word (#3109). This does not reduce the count: the test needs three runs, not consecutive ones.<br>- Earlier small-source card c `start-run-timeline-ask-supersessions-20261124a` (strict clean) is a different shape.<br>**Runs since the declaration (Tracks 4 to 6, the same shape; each Plan is now 8 of 8).** The records are comments on Issue #1929; a "clean so far" verdict is Rowan's, with Signal's operator-touch check still pending.<br>- Track 4 card a2 `start-run-track-4-standby-pins-20261126a2` (run 20261126T192658Z-83366): strict clean, 4 of 4 merged by the worker (#3131 to #3134; "4 merged, 0 escalated" at 20:39:48Z). Card A was refused at P4 after the press was consumed (#3122), so it is a refused press, not a run ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7202978211)).<br>- Track 4 card B `start-run-track-4-standby-pins-20261126b` (run 20261126T230916Z-75300): 4 of 4 merged (#3140 to #3143), each Action on `claude-opus-5-5` under Decision 0290 A's rule. NOT clean: an agent re-ran `unit-shard-7` on #3141 after the CI step "Install tmux for tmux-gated unit tests" failed before any test ran, which is outside C1 ("every test passed"). No operator touch after the press ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7206487856)).<br>- Track 5 card A `start-run-track-5-standby-pins-20261126a` (run 20261127T013318Z-92093): 4 of 4 merged (#3153, #3155, #3156, #3157), clean so far, with no CI re-run, hand-settle or intervention ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7208426549)).<br>- Track 5 card B `start-run-track-5-standby-pins-20261126b` (run 20261127T054515Z-57268): 4 of 4 merged (#3162, #3163, #3164, #3166). NOT clean: #3164 escalated `required_checks_failed` at the same tmux install step, and Rowan re-ran the failed jobs once, under the #3141 precedent. The recurring cause is #3165 ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7212808831)).<br>- Track 6 card A `start-run-track-6-standby-pins-20261127a` (run 20261127T145934Z-72215): 4 of 4 merged (#3179, #3180, #3181, #3183), clean so far. The operator's only touch was the press, per Rowan. #3183's first independent review failed, and the worker's own repair round fixed it, which is C0 ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7223391618)).<br>- Track 6 card B `start-run-track-6-standby-pins-20261127b` (run 20261127T235854Z-49045): 4 of 4 merged (#3185 to #3188), clean so far, with no CI re-run, hand-settle or intervention ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7231582948)).<br>- Of these six runs, 4 are clean per their records (a2, 5A, 6A, 6B) and 2 are not (4B, 5B), both for the tmux install cause.<br>**Worker merges on 11-26 (Pacific day, 08:00Z to 08:00Z): 18.** Method: `gh pr list --state merged` with `merged:2026-11-26T08:00:00Z..2026-11-27T08:00:00Z`, keeping head branches `claude/<action>-<timestamp>Z`: Track 3 card C 2 (#3111, #3112), Track 4 card a2 4, Track 4 card B 4, Track 5 card A 4, Track 5 card B 4. This matches Signal's count of 18. Branches `rowan9/`, `rowan9-build/` and other `claude/` branches without a timestamp are excluded (10 other PRs merged in that window).<br>**Operational fixes merged on 11-27:**<br>- #3160: a 36 s P4 sign-in lead wait (it fixes #3122, the cause of Track 4 card A's refused press). Its first live run was Track 6 card B, which found a fresh beat in 3 polls.<br>- #3167: the unit shards' tmux install now tolerates an unrelated apt source failing (it fixes #3165).<br>- PR #3159 and its Issue #3158: the strategy admission "Yes, A", which admitted the small #3122 fix through the freeze. #3158 carries the `phase-cause` label. | B keeps the count growing (C1/C2 become worker C0); A stops one stuck Action from ending a card |
| 2 | Dress rehearsal passes unstubbed | A full rehearsal of the standing-grant self-press runs every stage in a disposable clone without stubs, and passes (Decision 0288 rule 1). | not reached | Per-card rule-1 rehearsals ran before Track 2 card C and Track 3 cards A to C (for example, `workspaces/rehearsals/track3-cardC-20261125.noindex/receipt.md`: rule-1 PASS). Those rehearsals stubbed the provider CLI at P4 and stopped P4 at launchctl, and none rehearsed the **standing-grant self-press**. So no rehearsal meeting this test is on record. | None of A to D targets this directly; it is a coordinator rehearsal, not a build. C's Action 4 adds a rule-1 replay of the timer's next-Plan press (inference: the first natural carrier) |
| 3 | First self-pressed night | The timer presses under the standing grant (Decision 0241) and that night (9 PM to 8 AM Pacific) merges at least one Action, with no operator step, not even the 9 PM press. | not reached | The self-press has never run live. The open grant `standing-grant-20261123b` is pinned to the engine Plan, which is now complete, and its successor step ended on 11-24 (`PREFLIGHT_FAILED`; `workspaces/track2-readiness-20261125.md`). All of 11-24's and 11-25's merges followed operator presses. | C (the timer has an approved next Plan), A (the timer issues the Off), D (a refused press costs one tap) |
| 4 | Coordinator never dies silently | A Rowan that runs out of context or stalls during a night is replaced within minutes, with an alert and no operator action. | not reached | On 11-22, 3 h 13 min was lost to a dead coordinator (host-local `serial-wait-log-20261122.md`). Merged on 11-25 (checkpoint-admitted): #3033, under which the host timer stops a handed-off predecessor's tmux. Held for the checkpoint: #3080 (M4a, a page when the custodian dies or hits its limit, #3077). Its review passed, but non-blocking N2 must be repaired before merge. The replacement half (M4b) needs Plan H and its Decision. | D (paging and the 0284 handoff lines); M4b deferred to Plan H |
| 5 | Refusals retry themselves | A refused press that consumed nothing is retried by one operator tap, and automatically after three clean runs (Decision 0289 D). | not reached | Decision 0289 D was approved on 11-24 and is not built. No Action existed until Plan D's draft. | D (one-tap retry; the automatic half waits for Milestone 1's declaration) |
| 6 | One failure never ends the night | A night with one failed step parks it and still merges the rest (North Star gate 2). | not reached | **Correction:** Plan F's `park-and-continue` module exists (#2948), but at main `a558014ca` `src/production/parkAndContinue.ts` has no importer outside tests (#3047), so it is not wired. Live counter-evidence came on 11-25: in Track 3 card B, Action 6 went `terminal_candidate_not_integrable`, and the independent Actions 7 and 8 were never admitted (#3107). Track 3 card C then ran Actions 7 and 8 to merge (#3111, #3112), so those two Actions were not lost; the stall cost one Off and a second card. The cause is that the scheduler passes only "held" kinds (`src/production/terminalCandidates.ts:65`). **Update, 11-26 and 11-27:** both Plan A fixes merged. #3118 (Action 1) wires the night breaker into the production tick, and at main `5c25caa92` `src/production/nightBreaker.ts` imports `parkAndContinue.js` and `tick.ts` calls `applyNightBreaker`. #3136 (Action 2, fixes #3107) parks a stopped Action and admits the next independent one. Track 5 card B was the first live run of #3136's engine code, and it had no park, no withheld admission and no breaker trip ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7212808831)). So this is live, but not yet proven on a failure. | A |
| 7 | Nights never run empty | A Plan finishing mid-night starts the next approved Plan with no touch, and the 8 AM report shows zero empty nights in a week (North Star gate 3). | not reached | Plan F's `queue-approved-plans-and-start-the-next` is still open (#2774).<br>- Nights 11-22 and 11-23 had no worker merge.<br>- The night of 11-24 had 4 worker merges (#3060 to #3063, Track 2 card A, operator-pressed).<br>- The night of 11-25 had 4, all operator-pressed: #3102 at 9:24 PM and #3103 at 9:41 PM PST (Track 3 card B), then #3111 at 12:04 AM and #3112 at 12:25 AM PST on 11-26 (Track 3 card C, pressed 11:37 PM).<br>- The night of 11-26 had 4, operator-pressed at 9:45 PM PST (Track 5 card B): #3162 at 10:45 PM, #3163 at 11:01 PM, #3164 at 11:22 PM and #3166 at 11:45 PM.<br>No 8 AM report counts empty nights today (see 8). | C |
| 8 | Merges rechecked each morning | The 8 AM report re-verifies every overnight merge on main (North Star gate 4). | not reached | **Correction:** Plan F's `verify-overnight-merges-at-8am` is marked done, but at main `a558014ca` `src/production/overnightVerify.ts` has no importer outside tests. So no 8 AM report runs (playbook B5, #2939). | C (Action 1 wires it; Action 2 refuses future unwired "done" modules) |
| 9 | Real work runs unattended | A night of source-changing Actions, run under Decision 0290 A's model rule, merges through the worker gate with no operator touch (North Star gate 1). | not reached | Plan F's `worker-applies-standing-merge-conditions` (gate 1) is built and wired: `workerMerge.ts` imports `standingMerge.ts`. The live proof is missing. On 11-24, three small source Actions merged through the worker gate, but in pressed daytime runs. **New gap:** production launches do not apply Decision 0290 A's model rule (#3049). **Update, 11-26:** #3119 (Plan B Action 4) merged, so production launches now use the rule. Track 4 card B ran each of its 4 Actions on `claude-opus-5-5` under it ([record](https://github.com/pmark/arcadia/issues/1929#issuecomment-7206487856)). Those were test-only Actions in a pressed run, so the live proof is still missing. | B (Action 4: the model rule; Actions 1 and 2: fewer stops), A |
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
- Issues #3047, #3049, #3073, #3077, #3105, #3107, #3108, #3122, #3158 and #3165
- PRs #3080, #3095, #3099, #3102, #3103, #3106, #3109, #3118, #3119, #3136, #3159, #3160 and #3167
- `git grep` for importers at main `a558014ca`
- Issue #1929 comment 7186627436 (Track 3 card C result)
- Issue #1929 comments 7202978211, 7206487856, 7208426549, 7212808831, 7223391618 and 7231582948 (Track 4 to 6 results)
- the START card receipts, the worker log, and the host-local
  `workspaces/checkpoint-inputs-20261125.md` (sections 9 and 10)
