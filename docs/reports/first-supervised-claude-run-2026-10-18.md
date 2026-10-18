# First supervised Claude production run, 2026-10-18

Report of the inaugural supervised Claude production run on Arcadia's own repository, with run record, operator touches and critical findings.

## Run stages and outcomes

| Stage | Result | Fixing PR or Issue |
| --- | --- | --- |
| **Activation** | `grant-production-first-supervised-claude-run-20261017` was refused at preconditions because go-broker `managedSkill` was stale after merges. Fixed by build + `go-broker ensure` with production Off, then re-press activated scope: 1 Action, `claude-code-cli`, concurrency 1, remote preservation, 24h packet-approval delegation, no integration grant. | Incorporated in operator re-run, 2026-10-17 |
| **Capacity** | The worker's read-only pre-admission refresh turned a 220-hour-old Claude reading fresh (5h 0%, 7d 11%) without a refresh-token exchange. The 80% cap admitted. | #1492 (pre-admission refresh) |
| **Selection** | The tick tried the out-of-scope pointer Action `first-supervised-claude-run` for about 40 minutes, auto-preparing a packet for it and escalating it. A governed `make-next` was reverted by the scheduler; a whole-queue `arrange` needed an explicit operator freeze-window override. | #1514 (selection fix, merged) |
| **Launch** | Two attempts failed with `tmux new-session failed (1). Cause: command too long` (the full brief went through tmux argv), exhausting the repair budget. Very likely the cause of the 2026-10-11 Codex red alert `ra-2bcf88b68759`. Fixed with a 0600 self-deleting launcher file (64 KiB replay). The fix needed STOP, a services restart, a repair-budget reset and a one-shot re-run card. | #1513 (launcher file fix, merged); #1515 (one-shot re-run card, merged) |
| **Session** | `session_1e0a375c65854c1daf` launched 00:28Z, completed 00:42Z, session probe passed, candidate preserved to draft PR #1517 (22-line test). | #1517 (candidate draft PR, merged) |
| **Completion** | The worker logged `accepted_completion` but the candidate carried no settlement: its Ask named the base as `candidate_revision`. The Release Manager settled a re-drafted completion inside the candidate. | #1518 (settlement naming issue, unmerged) |
| **Review & merge** | An independent review of the exact head and a delta review of the settlement were clean. CI went red on every PR when Decision 0128's real Scout expiry passed (test date rot). Fixed by test-only PR. The operator merged the candidate PR. | #1520 (Scout expiry fix, merged); #1517 (merged) |

## Operator touches

- Enable capacity gate (`enable-capacity-gate-20261017` card press)
- START press (refused at preconditions)
- START re-press (succeeded after `go-broker ensure`)
- Freeze-window override for whole-queue `arrange`
- STOP (twice: once after launch failure repair budget exhaustion, once after services restart)
- Merges of authority-adjacent PRs: #1479, #1480/#1491, #1496, #1497, #1501, #1514, #1515, #1517
- Decision 0130 answer (Claude usage cap)

## Critical findings

**Blocker for unattended production:** #1518 — the worker must settle completion in the candidate, not require Release Manager intervention. The settlement's `candidate_revision` field was incorrectly named, and reapplication from the Ask was required.

**Still unresolved for unattended runs:**
- The `worker-review-and-merge` opt-in is untested live; its allowlist admits only tests and docs (#1496)
- A multi-Action unattended run (`first-unattended-run`) has not been attempted

## Evidence

- Run record, stages and operator timeline: docs/managed-production-readiness.md, "Run record: first supervised Claude run on Arcadia's own repository (2026-10-17/18)"
- Session log: `.arcadia/sessions/session_1e0a375c65854c1daf.log`
- Candidate PR: #1517 (merged)
- Blocked follow-ups: #1516, #1519

## Outcome

The first supervised Claude production run reached a reviewed, merged PR, proving the end-to-end path for a single Action under operator supervision. Unattended production remains unproved; a multi-Action run with only activation and authority-adjacent merges as operator touches is the next gate.
