---
id: prepared-recovery-worker-race
cost: unknown
fix: PR 1921 running-only worker exit guard and deterministic interleaving regression
status: source-merged-runtime-and-disposition-pending
---
# Issue #1920: worker reconciled a recovery before provider start

**Post-merge update, 2026-10-31:** PR #1921 merged as `42ecdeeb1ce3ee0345fbb77074c4d32316f45ca1` after independent exact-head review and all 15 CI jobs passed. The broker and worker remain at earlier installed revision `eb15d32cb3820caa649d532d4847fa3835d53ffa`; the false exit receipt and failed successor remain protected. See [the Claude Code continuation](../go-1921-claude-continuation-2026-10-31.md) for the pinned adoption and append-only disposition preparation. This update is not installed or live recovery proof; Production remains Off.

Operator-directed repair for [Issue #1920](https://github.com/pmark/arcadia/issues/1920), requested October 30, 2026 (Pacific). Rowan remains the operator contact in chat `01a18f8f-0e69-7642-8762-0b5bee402f27`; this bounded implementer is `01a1904e-2e49-77a1-835a-36ca3142d865`. No governed Action was assigned. The selected `fix-tidy-torn-tail-byte-offset` Action is unrelated and untouched.

## Live evidence, read only

The supplied recovery attempt prepared successor `session_85d12fec602444a2a7` at `2026-10-31T04:47:34.157Z`. A separate worker wrote exit receipt `exit_a0c03759925f4965ae`, request `worker-tick-reconcile-session_85d12fec602444a2a7`, at `04:47:54.028Z`. Its outcome was `successful_exit`, referencing the earlier Run `run_681774bbcfbd470da2`. The launcher then refused the now-terminal successor and marked it failed at `04:47:56.941Z`. Its `started_at` and `exit_status` remain null, and the supplied host check found no live tmux process. The worker receipt is not proof that this successor ran.

The original Session `session_0bc6dbe2bf4c43f4b4`, recovery request `recovery-after-1917-01a18f8f`, fingerprint `9816c6e39a43dc0cde8491cfdfa7878cdba5b3fc3389e1236d712f884a103658`, candidate `4bc278f07e34026ecb3e9ee6dae4cfc6dad8db5b`, and rotated claim `wtres_f91295b95a394c3187` remain retained. This session performed no live launch, reset, release, installation, merge, deployment or Production START.

## Cause and source proof

`runManagedProductionTick` treated any repository lease without a tmux process as a dead Session, including a lease still `prepared` between its durable insertion and provider start. Its exit processing raced the launcher's final recovery revalidation. That guard correctly requires the same successor to remain prepared; weakening it would hide the race.

The focused test `starts its prepared recovery exactly once when a worker tick observes it before provider start` inserts a real worker tick through the existing post-preparation hook. Before the source change it fails with the exact live `Terminal candidate recovery refused: this Session already has a recovery successor` error at `assertRecoveryReadyToStart`. After changing the worker's exit branch to require `status === "running"`, it passes. It checks one successor, one provider start for the recovery, idempotent request replay, foreign-request refusal, preserved original receipt, rotated claim and clean candidate.

Only that branch predicate changes. Prepared leases remain held; interrupted preparation is not automatically terminalized or retried. Existing running-session reconciliation remains covered by the worker suite. START_HERE explains the distinction. This is source proof with temporary fixture databases/Git repositories and a fake tmux adapter, not installed-worker or live-provider proof.

## Recovery proposal and limits

The source fix prevents recurrence; it does not reopen the already-consumed live request. Both current recovery routes refuse: the original has a consumed successor, and the successor is failed rather than completed exit-zero. No supported disposition for this exact state has been demonstrated. Keep Issue #1920 open for that remaining live-disposition acceptance criterion.

Registered proposal `issue-1920-fresh-recovery-disposition-20261030` (receipt `agentask_9c8109633756691531`, capture `capture_978e222f-0936-4c21-9e1a-ac65b8bbb7ab`; no conflicts/refusals, zero Project writes) asks Rowan to stage the next steps: complete source review/checks; separately approve merge and required worker installation/restart; verify the installed worker revision with Production Off; prepare an append-only supported disposition preserving all original and successor records. If that route is missing, authorize bounded source work and tests first. Only after a supported disposition and a fresh exact preview should a new one-attempt, ten-minute approval be requested. Installation, disposition and launch are separate gates. The old request and old live-attempt approval cannot be reused.

An independent Process Critic context reviewed this proposal and returned NO-GO for another live attempt, supporting the staged path. It specifically required session-state/start evidence alongside the worker exit receipt and visibility for abandoned prepared leases. No runtime model/effort evidence was available to that context. The receiving coordinator remains Rowan; this proposal grants no custody transfer or execution authority.

## Session evidence and prevention

Candidate: `codex/fix-1920-recovery-successor`, isolated at `/private/tmp/arcadia-issue-1920` from fetched main `7e73cdb664060338c5c4aeea748d908f2fe983e8`. Main checkpoints found no intervening governed changes. The initial work monitor completed before edits. No native-mail identity was assigned. The configured live workspace was resolved by Arcadia; no experimental live workspace was created.

Local receipts, failing-first and passing logs, instruction paths/byte counts and targeted retrieval sections are retained in the implementer's `issue-1920-evidence` artifact directory. Durable lesson `lesson_575e98c85b9e7f8d7032` records the verified cause. Prevention is the source guard and interleaving regression, rather than another workaround in Notes To Self.

Host friction: the first Git fetch was sandbox-denied on FETCH_HEAD; the first pinned-runtime invocation was denied its mise trust link; lesson capture was denied workspace writes. Each proceeded through ordinary host escalation on the same target. No automatic approval rejection or workspace substitution occurred.

## Validation and review snapshot

- Focused failing-first regression: exit 1 with the exact live refusal; unchanged test after the predicate repair: exit 0.
- Combined launch/worker/preview suites: 190 passed, five Go-parity failures at the inherited sandbox host-controller guard. Ordinary host execution of that seven-case subgroup passed all seven, without unsetting markers or weakening tests.
- `mise exec -- pnpm build`: exit 0 (repository lint, core and Discord builds).
- Independent review round 1 of `8b3ca3b549545ee9fc8bcc16c39f84a08c3c3694`: no actionable findings. [Signed published report](https://github.com/pmark/arcadia/pull/1921#issuecomment-6539369203). Primary reflog unchanged.
- Initial sandbox rehearsal: exit 1, 31 scenario reports retained. Failures included unavailable validation-descendant terminal proof and a real-tmux stub timeout. This was the wrong environment for the documented host rehearsal; the supported host run is separate evidence.
- Initial CI lint job passed ESLint but rejected this report's missing friction frontmatter. Added the required id/cost/fix/status metadata and ran `check:session-ledger` before the follow-up push; no validation rule was weakened.
- Final host-rehearsal, exact-head delta-review and CI results are recorded on [PR #1921](https://github.com/pmark/arcadia/pull/1921); this snapshot does not claim those pending results.
- Read-only production check at `2026-10-31T05:01:18.701Z`: inactive revision 83, epoch 46, zero live admissions.
