# Managed production readiness

This derived document answers how far Arcadia is from running software production unattended. It grants no authority. Checked-in Plans and Decisions, canonical policy and Session receipts, and live evidence take precedence.

Latest derivation: **2026-10-02**, after the retained v6 B terminal recovery under the fresh exact Grant. The renewed trial, installed #860, #865 and #866 repairs, and Issue #847 host-boundary experiments remain the earlier evidence.

## Current answer

The renewed bounded v6 trial completed both candidate Actions. Canonical Session exit receipts record accepted completion for the resumed split Action and its dependent Off/restart Action. The candidate Plan records both done. The first Action integrated before the dependent Session launched automatically. During that dependent Session, the host action turned production Off and restarted services; the admitted Session finished afterward.

Production is **Inactive at revision 29, with zero live admissions**. The operator pressed the fresh exact `/runs` Grant for the retained B candidate. Host validation passed, preservation receipt `presv_af1defad33604b5893` binds terminal Session `session_b82d2b412265419482` to the unchanged candidate, and the fixture base advanced exactly once from `a6b539d` to settlement commit `c6b4c4e`. The eight-Session set remained unchanged; no replacement coding Session launched. Off was restored at revision 29. The preservation receipt is `LOCAL ONLY`, so this fixture commit is recoverable on this host but not claimed as remotely published. The [criterion assessment](reports/v6-two-action-evidence-assessment-2026-10-01.md) and retained `/runs` receipt separate this live result from the original seven-Session A sequence.

The scope repair (#855) and continuation/retry repair (#857) were merged and installed before the renewed trial. The original six incomplete split Sessions preceded a seventh that completed in the same candidate; this proves eventual continuation but not the fixture's literal second-Session completion. The [criterion assessment](reports/v6-two-action-evidence-assessment-2026-10-01.md) identifies the supported and missing parent-proof stages.

PR #860 merged at `953e41590b33f3437acf57a80168e9a5f8dcbdda` and is present in checkout HEAD `1f7d4a6a57111844e9a8173235142fd95d0e6970`. The supported service restart completed at 13:16 PDT; the new worker PID 44138 started from that checkout at 13:16:58 PDT and its status resolved `martianrover`. #860 is therefore installed in the running worker. `arcadia go-broker ensure` subsequently passed from the clean main checkout, including its host probe, candidate build, dashboard build and Vitest checks. No new Grant is claimed here.

PR #865 merged at `650fc23e339fdf541090f5dd58788b52ee09a824`. The supported restart completed after that merge; worker PID 56539 ran the merged checkout's `src/cli.ts`, and intelligence, dashboard and Discord services passed readiness. Policy read after that restart showed Inactive revision 27, epoch 18. The later exact B recovery exercised this installed integration path.

PR #866 merged at `eb959d54d66063580f402aded406225f61d888e0`. CodeRabbit approved head `185f54aa0`; all required lint, dashboard, four unit shards and e2e checks passed. Focused terminal recovery/refusal tests passed 25/25 and the core build passed. The supported restart installed #866 in worker PID 67663; all four services passed readiness. At that point policy remained Inactive revision 27, epoch 18 with zero live admissions. The repair Action's three criteria were settled through Agent Ask `complete-off-terminal-preservation-recovery-2026-10-01`; the later exact B recovery exercised the installed repair.

## Vital few next steps

1. Keep B's completed recovery closed: the exact Grant was consumed, the candidate integrated once, and production is Off. Reassess the remaining parent criteria without repeating B or reusing the succeeded button. The literal two-Session A completion remains unproven; browser closure and a complete operator-intervention ledger are also not established by current receipts.
2. Preserve the completed terminal repair and live evidence separately. #866 bound the accepted exit and exact settlement, validated the unchanged candidate, and created the canonical preservation receipt without reviving a Session; #865's pinned path integrated it. The recorded validation command exited 0, fixture main and candidate both resolve to `c6b4c4e`, and the one base-advance receipt records the transition.
3. Keep the present single-Project scope. The concrete restriction in `tests/production-tick.test.ts` passed in the full suite: a Project removed from the active policy receives no scheduling, pointer commit or new launch, even while its prior terminal Session is reconciled. This is fixture proof of that restriction, not authority or evidence to widen the live Grant to multiple Projects. Address any qualified-target gate inconsistency only if full-dispatch impact reproduces.
4. The governed `split-v6-b-recovery-evidenced-slice-2026-10-01` settlement marked only the integration-evidence criterion done and selected `prove-literal-split-browser-and-ledger` for the other three. A fresh live trial is warranted only for an exact still-missing criterion, with its own hermetic replay and exact Grant. Do not ask the operator to relay a receipt or inspect a database.

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
| Dependent candidate preservation and final integration | Passed under the fresh one-shot Grant: host validation exited 0; `presv_af1defad33604b5893` pins the terminal candidate; fixture base advanced `a6b539d` → `c6b4c4e` once; no new Session; Off revision 29, zero live admissions. |
| Original parent proof split | The first split settled three criteria. The second settled only live integration evidence after PR #870; the literal split, browser/Off proof and exhaustive ledger remain open under `prove-literal-split-browser-and-ledger`. |

Exact identities, revisions, host/provider, receipts and refusal evidence remain in the local generated-script run evidence. A complete ledger of every earlier operator intervention has not been verified. Tests and source analysis are separate from live proof. Neither process exit nor a passing generic check proves arbitrary acceptance criteria.

## Governed state and deferrals

The active Plan remains `bootstrap-managed-production-to-build-flight-deck`. The first repair's canonical completion settlement marked `recover-terminal-integration-after-reconcile` done. After #865 merged, queue reorder revision 176 and pointer commit `f28fb2868` selected `finish-two-action-unattended-production-proof`. Discovery of B's missing preservation receipt led to accepted Agent Ask `recover-completed-candidate-unpreserved-after-off-2026-10-01`; queue revision 177 placed its Action first and pointer commit `eec7cf657` selected it. After #866 was installed, completion settlement commit `33c4dfb8e` marked that repair done and returned the pointer to `finish-two-action-unattended-production-proof`. After PR #870 merged, settlement commit `532691fb8` narrowed that Action to the proven integration-evidence criterion, marked it done, created `prove-literal-split-browser-and-ledger`, rewired 19 dependents and moved the pointer there. Provider concurrency remains deferred; no Plan was activated by inference.

The active Plan contains **151 Actions: 120 done and 31 open**, with zero Actions in other statuses at this derivation. This scoreboard counts each top-level `- id:` entry paired with its following `status:`. The original proof Action names its three proven criteria; its first remainder names the proven integration-evidence criterion; the new open remainder retains the other three and 19 dependents now wait for it.

The five historical proposals were rejected through the existing host approval surface. The retained Flight Deck proposal waits for later review after the narrow production proof succeeds. Retention grants neither acceptance nor activation. [Issue #852](https://github.com/pmark/arcadia/issues/852) records the operator UX improvement.

The original, renewed, and exact B-recovery one-shot Grants are consumed/revoked. A future live trial requires a fresh exact request and current revision preview under the existing authority contract; never reset an old succeeded button or treat its receipt as a new activation. The B-recovery operator action itself returned its own Grant to Off, as its reviewed descriptor specified; the Grant did not start a Session, restart a worker, merge, deploy, change credentials, or widen its scope.

The [hardening proposal](reviews/2026-10-01-production-hardening.md) and paired Agent Ask are a draft, not activated work or widened authority. Provider concurrency, independent approvers and Flight Deck expansion remain deferred under their recorded triggers.

## Literal-split receipt audit — 2026-10-02

The retained v6 B recovery is closed and was not replayed. A direct receipt
audit leaves all three criteria of `prove-literal-split-browser-and-ledger`
open: the split history contains seven A Sessions rather than a literal A1/A2
continuation; the retained Off/restart observation has no actual browser-close
event; and the receipt set identifies known interventions without proving an
exhaustive chronological operator ledger. Production remains **Inactive at
revision 29 with zero live admissions**.

Any new proof must use a fresh disposable single-Project fixture and a fresh
one-shot Grant. The Grant has to run its hermetic replay first and preview the
new fixture's exact candidate against the current inactive policy revision;
the succeeded v6 buttons and B candidate are consumed evidence, not reusable
authority. The present CLI-only production control does not emit a browser
close event, so a literal browser-close proof requires a supported reviewed
observation route before the conjunctive Off/browser criterion can close.

## Preservation and browser-audit gates

Merged PR #858 extends the #856 host preservation transport with stage and native-process limits, retained journals and partial validation receipts. Its real named-profile fixtures passed for manual and managed preservation, including a post-validation capture stall that retained passing Seatbelt evidence. This is candidate evidence: the repair has not been installed, and the cause of PPN's original stall remains unestablished. Merged PR #863 carries a follow-up 22-minute total bound to fit ten declared two-minute checks and preservation. The proof and limits are recorded in [the preservation and browser-audit report](reports/bounded-preservation-and-browser-audit-2026-10-01.md).

The installed `arcadia-unattended` profile still denies loopback HTTP and aborts headless Chrome; synthetic credential reads and external sockets are also denied. The merged repair retains a pre-dispatch capability refusal. No fresh PPN capture or comparable mobile/desktop Lighthouse matrix is claimed, and its verification Action remains open.

Merged PR #863 prepared an inactive host-owned alternative. Its fixed synthetic fixture rendered mobile and desktop HTTP pages while denying external, private and other-loopback TCP, unrelated Unix sockets, synthetic credential-file reads and external browser navigation. A deliberate post-launch stall stopped the supervised browser group without changing the fixture source. A separate probe found that native detached children can escape that group; the fixture's `ready` result does not establish containment for a live route. The operator selected Decision 0078's inactive preparation option; its canonical answer is committed on the new Issue #847 candidate branch, not yet integrated. Follow-up host experiments found that denying process creation also prevents Chrome launch, enabling Chrome's own sandbox fails during setup, and a temporary exact-loopback Codex profile override still aborts Chrome. The installed profile and production dispatch remain unchanged. [The host-browser report](reports/restricted-host-browser-audit-2026-10-01.md) retains the proof and limits, including platform-service review, broker integration, exact source/revision/expiry authority and native-descendant containment. Live activation and PPN Lighthouse measurement remain separate gates.

## Refresh contract

Refresh whenever a critical-path Action completes, a live run occurs, a Grant or Plan changes, or a new blocker is found. Read canonical Project/Plan state, policy, queue, relevant Decisions, Session receipts and retained run evidence. Run the applicable read-only checks, then revise the executive summary, gates, critical path, live-state table and Plan Action scoreboard from their results. For every live failure the replay could have predicted, add a hermetic replay scenario that reproduces the failure and passes after repair. Run the hermetic rehearsal before every live rehearsal, including rehearsals under an existing Grant, and before each new live Grant. Separate observed stages from unperformed criteria and preserve earlier failures.

The operator contract remains: Arcadia progresses deterministically, presents one genuine bounded decision through the existing operator surface, or reports a concrete external blocker. No terminal command, database inspection, receipt copy/paste or manual relay should be required. Do not adapt a refusing operator script by hand; follow its failure handoff for the safe recovery route.
