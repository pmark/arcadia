# Batch 6 test-stability Plan activation preparation

These are review snapshots of a shared-runner `arcadia-plan-activation-v1` action, not another runner. After review and merge, the live ignored library (`artifacts/generated/operator-scripts/`) receives these exact bytes. Generating, describing or publishing them activates nothing; the press is the operator's.

- **Operator words (record, Signal 10 transcript `67f5e9a4-65f4-490c-8bde-6b77f7a9e20d`):** "5A: batch 6" (line 3371, uuid `bcf40e11-09da-49b3-b71a-a8605cd7bbb2`, plain string, 2026-11-13T22:56:34.547Z) and "7A 6A" (line 3451, uuid `b3c96325-b7f5-4d2b-afd7-22cee29777cb`, 22:58:59.912Z), the runner tap. Verified by Rowan 13.
- **Contract:** the previous Plan, `burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production`, is `complete` and stays `complete`; `PROJECT.md` carries no `current_action` (absent, pinned as `null`).
- **The press:** selects `stabilize-coordinator-relay-pid-record-snapshot` at standard / medium and places this Project's queue segment at the top. It appends one Mission Log entry, archives the Ask `activate-batch-6-20261113` (sha256 `be10d4c7...034c7`, pinned to the bytes on `dca21ed60`) and pushes the canonical settlement commit.
- **Queue segment:** all three non-done Actions in Plan order: `stabilize-coordinator-relay-pid-record-snapshot`, `dashboard-live-allocate-free-smoke-port`, `harden-start-run-executor-calls-log-reader`. The runner refuses unless the pinned segment equals the Plan's live non-done Actions (Issue #2478), so the second Action cannot be left out without editing the Plan.
- **Known follow-up:** `dashboard-live-allocate-free-smoke-port` is already satisfied by merged PR #2593 and must not run. It is third-in-line only by being second in the Plan; it needs a governed completion or amendment (not part of this press) before the queue reaches it.
- **What it never does:** start a Session, Run or production policy; raise concurrency; grant spend, credentials or merge authority. Each Action's PR stays the operator's merge.
- **Validation:**
  - The descriptor is generated from the live before-images at `dca21ed60` and passes `validateOperatorScriptContract` with the canonical `planAmendmentLauncher` script; the contract refuses a wrong after-image.
  - The Ask is `intent: plan`, targets this Plan, and carries no Actions or Plan metadata.
- **Production:** observed Off. This is no future grant.
