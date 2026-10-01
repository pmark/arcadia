# Managed production readiness

This derived document answers how far Arcadia is from running software production unattended. It grants no authority. Checked-in Plans and Decisions, canonical policy and Session receipts, and live evidence take precedence.

Latest derivation: **2026-10-01**, after the renewed v6 trial, merged #860, the retained terminal-recovery probe, and the Issue #847 host-boundary experiments.

## Current answer

The renewed bounded v6 trial completed both candidate Actions. Canonical Session exit receipts record accepted completion for the resumed split Action and its dependent Off/restart Action. The candidate Plan records both done. The first Action integrated before the dependent Session launched automatically. During that dependent Session, the host action turned production Off and restarted services; the admitted Session finished afterward.

Production is **Inactive at revision 27, with zero live admissions**. The dependent Action's completed candidate has not been integrated into the fixture base after Off. This is a distinct stage: candidate completion is observed; final base integration is not claimed. Off correctly withholds integration authority. Arcadia settled a `split` Ask against the original parent proof: exactly three of seven criteria are recorded met, while the remaining four are a new open remainder Action. This does not claim the whole proof is complete.

The scope repair (#855) and continuation/retry repair (#857) were merged and installed before the renewed trial. The original six incomplete split Sessions preceded a seventh that completed in the same candidate; this proves eventual continuation but not the fixture's literal second-Session completion. The [criterion assessment](reports/v6-two-action-evidence-assessment-2026-10-01.md) identifies the supported and missing parent-proof stages.

PR #860 merged at `953e41590b33f3437acf57a80168e9a5f8dcbdda` and is present in checkout HEAD `1f7d4a6a57111844e9a8173235142fd95d0e6970`. The supported service restart completed at 13:16 PDT; the new worker PID 44138 started from that checkout at 13:16:58 PDT and its status resolved `martianrover`. #860 is therefore installed in the running worker. `arcadia go-broker ensure` subsequently passed from the clean main checkout, including its host probe, candidate build, dashboard build and Vitest checks. No new Grant is claimed here.

## Vital few next steps

1. Keep installed #860 and production Off while the terminal recovery Candidate receives review and CI. The worker has been refreshed from the merged checkout, but the new repair is not installed and no new live run is authorized.
2. Review and land the governed terminal integration repair. The reproduced source gap was followed by an accepted narrow Agent Ask and a pointer transition to `recover-terminal-integration-after-reconcile`; the inactive four-slice hardening proposal was not activated. The Candidate reuses existing exit, preservation and completion settlement receipts, pins the unchanged settlement commit for fast-forward, and rechecks current exact authority. Focused tests passed 20/20, including Off, expiry/scope drift, absent validation, changed candidate and divergent base. The full isolated suite passed 2672 tests (21 skipped), and the core build passed. This is deterministic fixture evidence, not installed or live recovery proof.
3. Keep the present single-Project scope. The concrete restriction in `tests/production-tick.test.ts` passed in the full suite: a Project removed from the active policy receives no scheduling, pointer commit or new launch, even while its prior terminal Session is reconciled. This is fixture proof of that restriction, not authority or evidence to widen the live Grant to multiple Projects. Address any qualified-target gate inconsistency only if full-dispatch impact reproduces.
4. Reassess the existing parent two-Action proof against all live evidence and independently required validation. Missing authority remains one genuine bounded approval; do not ask the operator to relay a receipt or inspect a database.

## What the evidence proves

| Stage | Renewed live result |
| --- | --- |
| Host replay before Grant | Passed: 17 hermetic tests. |
| Exact resumed candidate and branch | Reused the prior split candidate. |
| Resumed Action completion | Canonical accepted completion observed. |
| Concurrent candidate protection | Canonical competing preparation actually refused while the Session lease was live. |
| Dependent Action | Admitted automatically after first candidate integration, with a fresh candidate. |
| Off and supported worker restart during dependent work | Performed by the bounded host action; no duplicate or reactivation in its recorded observation window. |
| Dependent candidate completion after Off | Canonical accepted completion observed. |
| Final dependent candidate integration | Pending; Inactive policy supplies no integration authority. |
| Original parent proof split | Three supported criteria settled through Arcadia's canonical split path; four remain open under `finish-two-action-unattended-production-proof`. |

Exact identities, revisions, host/provider, receipts, refusal evidence and every operator intervention remain in the local generated-script run evidence. Tests and source analysis are separate from live proof. Neither process exit nor a passing generic check proves arbitrary acceptance criteria.

## Governed state and deferrals

The active Plan remains `bootstrap-managed-production-to-build-flight-deck`. The repair Candidate's canonical completion settlement marks `recover-terminal-integration-after-reconcile` done and advances its pointer to the next eligible queued Action, `limit-sessions-per-provider-account`. That queue default is deferred by the present production-proof priority; no concurrency work is authorized here. The installed main checkout still points at the repair until PR #865 merges, after which the next governed pointer move must select `finish-two-action-unattended-production-proof`. The split settlement, narrow Action settlement, queue repair and initial pointer transition were committed and pushed through canonical commands; no Plan was activated by inference.

The repair Candidate's active Plan contains **149 Actions: 118 done and 31 open**, with zero Actions in other statuses at this derivation. This scoreboard counts each top-level `- id:` entry paired with its following `status:`. The `done` original proof Action names only its three narrowed criteria; its open remainder retains the other four and 19 dependents were rewired to wait for that remainder. Main retains the previous 117/32 count until the PR merges.

The five historical proposals were rejected through the existing host approval surface. The retained Flight Deck proposal waits for later review after the narrow production proof succeeds. Retention grants neither acceptance nor activation. [Issue #852](https://github.com/pmark/arcadia/issues/852) records the operator UX improvement.

The original and renewed one-shot Grants are consumed/revoked. A future live trial or integration requires a fresh exact request and current revision preview under the existing authority contract; never reset an old succeeded button or treat its receipt as a new activation. A Grant never starts a Session, turns production Off, restarts a worker, merges, deploys, changes credentials, or widens its scope.

The [hardening proposal](reviews/2026-10-01-production-hardening.md) and paired Agent Ask are a draft, not activated work or widened authority. Provider concurrency, independent approvers and Flight Deck expansion remain deferred under their recorded triggers.

## Preservation and browser-audit gates

Merged PR #858 extends the #856 host preservation transport with stage and native-process limits, retained journals and partial validation receipts. Its real named-profile fixtures passed for manual and managed preservation, including a post-validation capture stall that retained passing Seatbelt evidence. This is candidate evidence: the repair has not been installed, and the cause of PPN's original stall remains unestablished. Merged PR #863 carries a follow-up 22-minute total bound to fit ten declared two-minute checks and preservation. The proof and limits are recorded in [the preservation and browser-audit report](reports/bounded-preservation-and-browser-audit-2026-10-01.md).

The installed `arcadia-unattended` profile still denies loopback HTTP and aborts headless Chrome; synthetic credential reads and external sockets are also denied. The merged repair retains a pre-dispatch capability refusal. No fresh PPN capture or comparable mobile/desktop Lighthouse matrix is claimed, and its verification Action remains open.

Merged PR #863 prepared an inactive host-owned alternative. Its fixed synthetic fixture rendered mobile and desktop HTTP pages while denying external, private and other-loopback TCP, unrelated Unix sockets, synthetic credential-file reads and external browser navigation. A deliberate post-launch stall stopped the supervised browser group without changing the fixture source. A separate probe found that native detached children can escape that group; the fixture's `ready` result does not establish containment for a live route. The operator selected Decision 0078's inactive preparation option; its canonical answer is committed on the new Issue #847 candidate branch, not yet integrated. Follow-up host experiments found that denying process creation also prevents Chrome launch, enabling Chrome's own sandbox fails during setup, and a temporary exact-loopback Codex profile override still aborts Chrome. The installed profile and production dispatch remain unchanged. [The host-browser report](reports/restricted-host-browser-audit-2026-10-01.md) retains the proof and limits, including platform-service review, broker integration, exact source/revision/expiry authority and native-descendant containment. Live activation and PPN Lighthouse measurement remain separate gates.

## Refresh contract

Refresh whenever a critical-path Action completes, a live run occurs, a Grant or Plan changes, or a new blocker is found. Read canonical Project/Plan state, policy, queue, relevant Decisions, Session receipts and retained run evidence. Run the applicable read-only checks, then revise the executive summary, gates, critical path, live-state table and Plan Action scoreboard from their results. For every live failure the replay could have predicted, add a hermetic replay scenario that reproduces the failure and passes after repair. Run the hermetic rehearsal before every live rehearsal, including rehearsals under an existing Grant, and before each new live Grant. Separate observed stages from unperformed criteria and preserve earlier failures.

The operator contract remains: Arcadia progresses deterministically, presents one genuine bounded decision through the existing operator surface, or reports a concrete external blocker. No terminal command, database inspection, receipt copy/paste or manual relay should be required. Do not adapt a refusing operator script by hand; follow its failure handoff for the safe recovery route.
