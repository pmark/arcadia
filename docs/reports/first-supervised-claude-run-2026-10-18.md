# First supervised Claude run — 2026-10-17/18

Standalone record of the first supervised Claude production run on Arcadia's own repository.

## Run stages

| Stage | Observed |
| --- | --- |
| Activation | `grant-production-first-supervised-claude-run-20261017` was refused at preconditions because go-broker `managedSkill` was stale after merges. Fixed by build + `go-broker ensure` with production Off. The re-press activated scope: 1 Action, `claude-code-cli`, concurrency 1, remote preservation, 24h packet-approval delegation, no integration grant. |
| Capacity | The worker's read-only pre-admission refresh (#1492) turned a 220-hour-old Claude reading fresh (5h 0%, 7d 11%) without a refresh-token exchange. The 80% cap (#1495) admitted. |
| Selection | The tick tried the out-of-scope pointer Action `first-supervised-claude-run` for about 40 minutes, auto-preparing a packet for it and escalating it (#1512). A governed `make-next` was reverted by the scheduler. A whole-queue `arrange` needed an explicit operator freeze-window override. Fixed in #1514, merged and live. |
| Launch | Two attempts failed with `tmux new-session failed (1). Cause: command too long` (the full brief went through tmux argv), exhausting the repair budget. This is very likely the cause of the 2026-10-11 Codex red alert `ra-2bcf88b68759`. Fixed in #1513 (0600 self-deleting launcher file; 64 KiB replay). The fix needed STOP, a services restart, a repair-budget reset and a one-shot re-run card (#1515). |
| Session | `session_1e0a375c65854c1daf` launched 00:28Z, completed 00:42Z, session probe passed, candidate preserved to draft PR #1517 (22-line test). |
| Completion | The worker logged `accepted_completion` but the candidate carried no settlement: its Ask named the base as `candidate_revision` (#1518). The Release Manager settled a re-drafted completion inside the candidate. |
| Review & merge | An independent review of the exact head and a delta review of the settlement were clean. CI went red on every PR when Decision 0128's real Scout expiry passed (test date rot, fixed by test-only #1520). The operator merged #1517. |

## Failures and fixing PRs

- **Activation**: `grant-production-first-supervised-claude-run-20261017` refused at preconditions (go-broker stale) → Fixed in #1514
- **Selection**: Out-of-scope pointer and queue arrange issues → Fixed in #1514
- **Launch**: Command-too-long tmux failure → Fixed in #1513
- **Launch recovery**: Needed repair-budget reset and re-run → #1515
- **Completion**: Candidate carried no settlement, missing `candidate_revision` → Fixed in #1518
- **CI failures**: Scout date rot in Decision 0128 → Fixed in test-only #1520

## Operator touches

- Enable capacity gate
- START (refused)
- START (re-run)
- Freeze-window override for queue arrange
- STOP (twice)
- Merges of authority-adjacent PRs: #1479, #1480/#1491, #1496, #1497, #1501, #1514, #1515, #1517
- Decision 0130 answer

## Blocking issue for unattended production

- #1518: The worker must settle completion in the candidate

## Next steps

- `worker-review-and-merge` opt-in is untested live; allowlist admits only tests and docs
- Follow-up issues: #1516, #1519
- Multi-Action unattended run (`first-unattended-run`) not yet attempted
