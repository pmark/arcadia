# Managed production readiness

This derived document answers how far Arcadia is from running software production unattended. It grants no authority. Checked-in Plans and Decisions, canonical policy and Session receipts, and live evidence take precedence.

Latest derivation: **2026-10-01**, after the first live v6 attempt and the operator's stop.

## Current answer

The host passed the full hermetic rehearsal replay (17 tests), activated the bounded v6 Grant, launched a real coding-agent Session, and automatically resumed its incomplete candidate in the same worktree and branch. That proves the handoff reaches a provider and preserves candidate identity across Sessions.

The attempt did **not** complete the first Action. Six Sessions left only the first marker line. The operator turned production Off to stop the retry loop. Policy is now **Inactive at revision 25, with zero live admissions**. The dependent Action's Off/restart proof remains unperformed. Production is not ready to leave unattended.

## Vital few repairs

1. Keep scheduling within the active Grant's Project scope. A fixture-only Grant nevertheless ran portfolio-wide scheduling and moved Arcadia's unrelated pointer. [PR #855](https://github.com/pmark/arcadia/pull/855) fixes this by passing the existing scheduler its Project allowlist. Its regression reproduced the incorrect pointer commit before the fix.
2. Tell a resumed Session that it is continuing prior work. The launch brief previously repeated the first-Session instruction without its canonical predecessor receipt. Render continuation context from the existing consumed handoff, scoped to the same Project, Plan, Action, worktree, and branch.
3. Bound unchanged resumptions. A successful process launch previously reset the repair budget even when the next exit made no candidate progress. Count a clean unchanged resumed exit against the existing two-attempt repair budget; retain its candidate and surface the existing escalation. Reset that count when candidate progress or completion is observed.

These are implementation defects found by the trial. Neither relaxing approval boundaries nor activating the full portfolio fixes them.

## What the evidence proves

| Stage | Live result |
| --- | --- |
| Host replay before Grant | Passed: 17 tests. |
| Bounded v6 activation | Applied, then revoked by the operator. |
| First Session exits incomplete with one marker | Observed. |
| Second Session reuses the exact candidate and branch | Observed. |
| Resumed Session appends the second marker and completes | Not achieved; repeated first-marker exits instead. |
| Competing candidate refused while the first is live | A preview was retained; no actual competing launch was attempted. This does not establish the full refusal criterion. |
| Dependent Action admitted before Off | Not reached. |
| Existing dependent Session survives Off and worker restart | Not performed. |
| No admission or reactivation after the actual stop | Policy Off and zero live admissions confirmed; longer observation remains part of the next bounded trial. |

Live run logs, policy receipts, marker observations, Session identities, and candidate paths remain in the local generated operator-script run evidence. They must be retained and assessed before settling any proof criterion. An exit code or a passing hermetic replay cannot stand in for missing live evidence.

## Governed and operator state

The active Plan remains `bootstrap-managed-production-to-build-flight-deck`. The scheduler moved its pointer to `limit-sessions-per-provider-account` during the faulty scope pass. This document does not repair that authoritative pointer or claim that `prove-two-action-unattended-production` is complete.

The operator rejected the five historical proposals through the existing host approval surface. Their earlier write-path blocker is superseded. The retained Flight Deck proposal `agentask_4777d744460a9f5fc0` waits for later review, revived only after the bounded production proof succeeds. Retention grants neither acceptance nor Plan activation. [Issue #852](https://github.com/pmark/arcadia/issues/852) records the operator UX improvement.

The original revision-23 Grant has been consumed. Its receipt must remain intact. A further trial needs a fresh request id, the current inactive revision, the same exact two-Action/provider/concurrency scope, and fresh canonical preview. Do not reset an old button or replay its activation receipt as new authority.

## Shortest path

1. Review, merge, and install the scope and continuation repairs; verify their actual merged revisions and file content.
2. Keep production Off while checking worker health, fixture/candidate state, retained evidence, and fresh revision-pinned authority.
3. Run the smallest renewed bounded trial using the supported host path. Reuse the incomplete candidate and continue the remaining acceptance criteria.
4. Observe the dependent Action's already-admitted Session through Off and worker restart, retaining every receipt and operator intervention.
5. Settle only criteria supported by the resulting live evidence, then assess wider production authority separately.

The operator should use the existing dashboard approval/control surfaces or a single bounded generated host action. No terminal command, database inspection, pasted receipt, or manual relay should be necessary. Flight Deck UI work remains deferred until this proof succeeds.

## Other gates

The operator-directed repair of Issues #848 and #847 found two further gates
on 2026-10-01. Protected manual preservation could block the worker synchronously
after validation. The candidate repair moves claimed execution into a bounded
host child with stage journals and retained validation evidence; real named-profile
fixtures prove both manual and managed preservation. A real post-validation
capture stall is terminated with its passing Seatbelt receipt intact. This
repair has not yet been merged or installed, and PPN's original cause remains
unestablished; its retained passing checks do not prove transport success.

The actual installed `arcadia-unattended` browser probe denies loopback HTTP
with EPERM and aborts headless Chrome even with a debugging pipe. Synthetic
credential reads and external sockets are also denied. The candidate adds a
pre-dispatch capability refusal. On operator direction to finish the recommended
preparation, the inactive host route now proves mobile/desktop HTTP rendering,
external/private/other-loopback and unrelated Unix-socket denial, synthetic
credential denial, and bounded post-launch stall cleanup on real host fixtures.
That preparation does not change the installed named profile or admit browser
measurement Actions. Reviewed integration and a separate scoped activation
remain required. PPN's final comparable mobile/desktop Lighthouse matrix remains
unmeasured and its verification Action remains open. The prepared Ask and
measured evidence are in `docs/reports/bounded-preservation-and-browser-audit-2026-10-01.md`.
The inactive host proof is in `docs/reports/restricted-host-browser-audit-2026-10-01.md`;
the other production observations above were not re-measured by this fixture run.


The earlier v5 rehearsal remains evidence of two dependent codex-cli Actions completing unattended. Board-surface and historical integration results were not rerun by this derivation. The remaining split-completion and Off/restart stages keep the live proof open. Cross-repository concurrency and same-repository pipelining remain later gates; the v6 trial keeps concurrency one.

## Refresh contract

Refresh this document whenever a critical-path Action completes, a live run occurs, a Grant or Plan changes, or a new blocker is discovered. Read the Project pointer and active Plan, canonical queue and production status, relevant open Decisions and Mission Log, worker/Session receipts, and bug/review state. Run the host hermetic rehearsal before each new live Grant. Separate observations from unperformed criteria; preserve the previous receipts rather than replacing failure with a success claim.

The 2026-10-01 repair follow-up was reconciled with landed PR #856: its host-only
static preview and async admission/claim-expiry behavior remain intact. PR #858
adds retained stage/evidence diagnostics, stage/native process limits and real
post-validation stall proof on that base. Both managed/manual installed-profile
fixtures passed after rebuilding. This is not a supported named-profile headless
audit executor, a fresh PPN capture, or a comparable PPN Lighthouse matrix.
