# Plan 3 (20 test pins) activation preparation

Review snapshots of a shared-runner `arcadia-plan-activation-v1` action, not another runner. After review and merge, the live ignored library (`artifacts/generated/operator-scripts/`) receives these exact bytes. Generating, describing or publishing them activates nothing.

- **Operator words (record, Signal 10 transcript `67f5e9a4-65f4-490c-8bde-6b77f7a9e20d`):** "9A 10A 11A" (line 5665, uuid `e206f464-e6f2-4f26-9a2a-013e66106959`, content block 1, 2026-11-14T05:57:28.653Z; 30-minute Decision 0229 window to 06:27:28Z). Verified by Rowan 14; 11A is activate Plan 3.
- **Who presses:** Decision 0232 option A (answered by the same words, merged in #2613) lets the coordinator execute this published action when its conditions hold: the operator's choice is verified and cited, the descriptor merged on gate and the published bytes equal the merged blob, production is Off, and Signal verifies the receipt and main afterwards. If the 0229 window has lapsed at press time, a fresh operator verification is required.
- **The press:** selects `pin-requires-review-value` at standard / medium and places this Project's queue segment at the top. It appends one Mission Log entry, archives the Ask `activate-plan-3-20261114` (sha256 `a8ed5fbb...babec`, the bytes merged in #2614, `51eeb70ab`) and pushes the canonical settlement commit.
- **Queue segment:** all 20 Plan 3 Actions, all open, in Plan order (the runner refuses unless this equals the Plan's live non-done Actions, Issue #2478).
- **Contract:** the batch 5 Plan stays `complete`; `PROJECT.md` carries no `current_action`.
- **What it never does:** start a Session, Run or production policy; raise concurrency; grant spend, credentials or merge authority.
- **Validation:** passes `validateOperatorScriptContract`; the `.sh` equals `planAmendmentLauncher(id)`. No dry-run exists, so the live press is the first run; it refuses before mutation on drift.
- **Production:** observed Off. This is no future grant.
