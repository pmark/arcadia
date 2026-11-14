# Batch 5 small-fixes Plan activation preparation

These are review snapshots of a shared-runner `arcadia-plan-activation-v1` action, not another runner. After review and merge, the live ignored library (`artifacts/generated/operator-scripts/`) receives these exact bytes. Generating, describing or publishing them activates nothing; the press is the operator's.

- **Operator words (record, Signal 10 transcript `67f5e9a4-65f4-490c-8bde-6b77f7a9e20d`):** "8A, Signal starts Rowan 14" (line 4622, uuid `c9787eeb-75a7-4a75-9775-5a960ce73584`, content block 1, 2026-11-14T02:04:55.144Z). Verified by Rowan 14 per Decision 0229; 8A is batch 5 (#2580). The tap is the operator's own act.
- **Contract:** the batch 6 Plan `draft-an-inactive-batch-6-test-stability-plan-of-three-verified-fixes-with` is `complete` and stays `complete`; `PROJECT.md` carries no `current_action` (pinned as `null`).
- **The press:** selects `fix-off-alarm-custodian-liveness-scope` (#2561) at standard / medium and places this Project's queue segment at the top. It appends one Mission Log entry, archives the Ask `activate-batch-5-20261113` (sha256 `4728aef2...c94e8f`, the bytes merged in #2604, `0a728a402`) and pushes the canonical settlement commit.
- **Queue segment:** the Plan's three non-done Actions in Plan order: `fix-off-alarm-custodian-liveness-scope`, `quote-flow-indicator-leading-yaml-scalars`, `tidy-detached-count-tolerates-unreadable-head` (the runner refuses unless this equals the Plan's live non-done Actions, Issue #2478).
- **What it never does:** start a Session, Run or production policy; raise concurrency; grant spend, credentials or merge authority.
- **Validation:** the descriptor passes `validateOperatorScriptContract` and the `.sh` equals `planAmendmentLauncher(id)`. There is no dry-run mode in the runner, so the live press is the first run; it refuses before mutation on drift.
- **Production:** observed Off. This is no future grant.
