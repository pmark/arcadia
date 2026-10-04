# Managed production readiness

This derived document answers how far Arcadia is from running software production unattended. It grants no authority. Checked-in Plans and Decisions, canonical policy and Session receipts, and live evidence take precedence.

Latest derivation: **2026-10-02**, including the published #878 manual-preservation repair candidate in PR #888, verified prerequisite publication, and the subsequent bounded scope/custody preparation. The retained v6 B terminal recovery, installed #860, #865 and #866 repairs, and Issue #847 host-boundary experiments remain earlier evidence.

## Current answer

The renewed bounded v6 trial completed both candidate Actions. Canonical Session exit receipts record accepted completion for the resumed split Action and its dependent Off/restart Action. The candidate Plan records both done. The first Action integrated before the dependent Session launched automatically. During that dependent Session, the host action turned production Off and restarted services; the admitted Session finished afterward.

Production is **Inactive at revision 29, with zero live admissions**. The operator pressed the fresh exact `/runs` Grant for the retained B candidate. Host validation passed, preservation receipt `presv_af1defad33604b5893` binds terminal Session `session_b82d2b412265419482` to the unchanged candidate, and the fixture base advanced exactly once from `a6b539d` to settlement commit `c6b4c4e`. The eight-Session set remained unchanged; no replacement coding Session launched. Off was restored at revision 29. The preservation receipt is `LOCAL ONLY`, so this fixture commit is recoverable on this host but not claimed as remotely published. The [criterion assessment](reports/v6-two-action-evidence-assessment-2026-10-01.md) and retained `/runs` receipt separate this live result from the original seven-Session A sequence.

## Issue #878 manual-preservation repair — candidate versus installed state

Candidate commit `d45b2fb922438d3cca3bc00f7b305a05838ee037` was protected as
manual-local-only receipt `presv_a47d71b5cf6740669c`; its host validation ran
`node scripts/preservation-self-check.mjs`. The host then settled the repair's
six criterion-exact completion Ask in this candidate at `1db14018c` (receipt
`asksettle_5cd514e1fee94d4097`), selecting
`persist-inactive-production-configuration` as the next governed Action.

Host validation separately passed the repair's full test set (50 passed, 2
skipped), lint, TypeScript, and the retained hermetic replay at
`/tmp/878-fixed-launcher-replay-result.json`. That replay invoked the literal
installed no-argument preservation launcher against a disposable manual
reservation, captured an initial snapshot and retry, made a canonical Log
settlement plus candidate documentation revision, then captured the revised
snapshot and retry. It retained distinct snapshot request/receipt identities,
unchanged original receipt bytes, `LOCAL ONLY` outcomes, and zero managed
Sessions.

This is evidence for the **candidate** repair and its installed-launcher
interface, not evidence that the reviewed repair is installed in the live
worker. It does not authorize installation, a service restart, production,
PPN execution, or publication. The operator explicitly authorized bounded host recovery after protected
preservation refused an incompatible main advance and fixed Go refused a
second dirty manual candidate. Exact pending narrative bytes were preserved
at `86853e2e5`; canonical Log `log-pr888-bounded-host-recovery-authority-2026-10-02`
records that direct instruction. Merge `26fa3c333` retains both original
histories and both canonical Mission Log append sets. PR #888 still requires
review and exact-head checks before the separate reviewed-installation gate.
The reconciled candidate passed 53 tests (two existing skips), lint, TypeScript
and the core build. Restricted validation captured tree `ac159db5e706169d6fa3d821fb69b01ae508c9b0`,
but the older installed runtime refused its reservation-only request ID at
`preserve.replay`. The original protected receipt remains intact; subsequent
document preservation and reconciliation used the explicit host exception.
No new protected receipt or live installation is claimed.

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

The active Plan contains **154 Actions: 121 done and 33 open**, with zero Actions in other statuses at this derivation. This scoreboard counts each top-level `- id:` entry paired with its following `status:`. The original proof Action names its three proven criteria; its first remainder names the proven integration-evidence criterion; the new open remainder retains the other three and 19 dependents now wait for it.

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

## Three-Action rehearsal preparation — 2026-10-02

The prerequisite settlement `asksettle_92f59561766c40079e` confirms
`applied:true` and commit `a5a6844e751a6441576871b8b20ae8ccf2ab9d6e`.
Run `20261002T164449Z-98726/publication.json` now proves publication of that
settlement and `ec53674aaaad0148e3ed7e6f3da3a9bb75ab3d64`, with
`settlementReapplied:false`. Remote main independently matched the settlement
commit. The live one-shot button is succeeded and must not be offered again.
Both accepted prerequisite Actions remain unproved; the canonical pointer is
still `prove-literal-split-browser-and-ledger`. The retained run's
`production-before.json` observes Inactive revision 29, epoch 19, zero live
admissions. Publication grants no production or pointer authority.

The original publication refusal compared an untracked source Ask's canonical
before-image with a parent Git blob that did not exist. Plan before/after bytes
matched, and the tracked archive preserved the source Ask's exact SHA-256.
The reviewed publication-only retry passed twelve original and seven additional
narrative-custody/refusal cases, retained every failed run, and published only
the original two commits. It left the revised pair, Notes, derived readiness
and other preparation unpublished.

Read-only planning and adversarial helpers identified the smallest honest
three-record scope: keep saved configuration unchanged, append durable serial
execution to the existing enrollment identity while preserving its six criteria,
and add one installed-host rehearsal Action. The finite revised design uses an
actual disposable GitHub repository, CodeRabbit's actor/reviewed head and existing
independent PR QA rather than a new local reviewer supervisor. As of Decision 0080,
the independent review gate (`docs/agent-guidance/pull-requests.md`) replaces that
reviewer actor and CodeRabbit is advisory. With that route,
the adversary judges the combined enrollment/durability slice plausibly one
heavy/high session; this is an estimate, not completion evidence. Draft-to-ready
PR waiting, five fixed-role attempt lineage, host-derived QA identity and exact
integration fencing remain missing behavior. Repository publication, PR readiness
and bounded integration require the later fresh exact Grant. Verify the
independent review gate and required checks before live dispatch; a missing or
rate-limited CodeRabbit review never blocks it.

The current enrollment candidate adds the host-owned replay contract and its
additive five-role lineage store. Real-fixture host tests drive strict `go`
preparation and `launchGuardedHostSession` (issue/commit admission) through
enrollment: exact replay, changed identity/mode refusal, a claimed Action,
Off, a mid-launch Off/On epoch change, capacity, packet approval, spawn
failure and restart reconciliation leave no duplicate principal or live
orphan admission, lease or enrollment row. Native adoption refuses without a
host-observed adapter. Store-level tests cover one mutation owner per
requirement, independent reviewer/QA identities, bounded terminal retries,
two-connection ordinal allocation and exact-head invalidation.

The lineage is now wired into the real executors (candidate, not installed):
the guarded launcher allocates or resumes the one development attempt after
its deterministic prerequisites and before admission; exit reconciliation
finishes it in the receipt's transaction; the tick's planning resolution
records planner and packet-critique attempts; code review and QA attempts
require a deterministic readiness binding (head, criteria, preserved
evidence) before any reviewer runs; `arcadia qa code-review` and
`arcadia qa pr` record the exact-head code review and QA for a lineage-bound
managed PR through separate read-only reviewers, refusing a developer
directory or binding, a stale head and Off before any reviewer runs; and the
tick integrates only with current, independent code review and QA verdicts on
the exact head, with no operator merge, clearing its
`awaiting_independent_verdicts` escalation. The hermetic three-Action
rehearsal proves serial selection, between-Action Off fencing and one lineage
per role per Action through the real tick, with simulated reviewers;
`tests/code-review-verdict-recorder.test.ts` drives both host commands
against a real rehearsal candidate with stubbed GitHub and reviewer model.
Missing at that candidate: nothing ran those commands unattended (the
operator or a host step invoked them), and both need a ready, non-draft PR
whose head is the candidate's settled head; the 2026-10-04 candidate below
closes that gap in code. This is candidate evidence only: it is not installed-host enrollment
proof, production activation, a rehearsal, or completion evidence.

### Remote-preservation grant option — 2026-10-03 candidate

Before this candidate, `scope.remotePreservation` was validated and read by
both preservation paths, but no command could set it, so every managed
preservation stayed `LOCAL ONLY` and no draft PR could exist. The candidate for
`let-production-grant-request-remote-preservation` adds
`arcadia production preview|activate --remote-preservation`. It is the only way
to set the field; no other flag, environment variable or dashboard control can
turn it on. The option authorizes exactly two things for an Action in the
active scope: pushing the preserved candidate branch and opening (or updating)
its **draft** pull request. It does not authorize marking a PR ready, merging,
or pushing the base branch; those stay separate gates and later work
(`ready-pr-and-run-independent-reviews-from-the-tick`). Without the option,
preservation stays `LOCAL ONLY`.

The option is bound into the scope fingerprint, printed as
`Remote preservation: on|off` by the preview, `production status` and the
activation receipt, and a replayed request id under a different setting is
refused. Off clears it from the active policy immediately; the saved reviewed
configuration keeps it, so a fingerprint-bound reactivation (CLI or the
dashboard On switch) restores exactly what was granted and never adds it to a
configuration granted without it. Coverage: the `remote preservation
(--remote-preservation)` block in `tests/managed-production-policy.test.ts`,
`tests/production-reactivation.test.ts`, and the dashboard contracts in
`apps/dashboard/app/api/production-control/route.test.ts` and
`apps/dashboard/lib/production-reactivation.test.ts`. This is candidate code
only: it grants nothing, no live policy was activated with it, and the live
Grant for any rehearsal remains an operator decision.

### Tick-driven PR readiness and independent reviews — 2026-10-04 candidate

The candidate for `ready-pr-and-run-independent-reviews-from-the-tick`
(`src/production/independentReview.ts`) lets the worker tick take a preserved
managed candidate from its host-created draft PR to integration with no
operator step. While the verdict gate waits, and only where integration is
otherwise authorized and would fast-forward, each tick advances at most one
side effect: push exactly the settled head commit when a settlement commit
landed after preservation (the PR head must be that settled head or an
ancestor of it; anything else is `review_head_moved` and never gets a
verdict), `gh pr ready` once (a PR returned to draft afterwards escalates
`review_paused_as_draft` instead of being readied again), poll required checks
(once a minute, one-hour deadline after ready; `BLOCKED` counts only once
checks are green), then `arcadia qa code-review` and on a later tick
`arcadia qa pr`, each reviewer bounded to 15 minutes under the worker's
30-minute tick ceiling, which is re-stamped right before the reviewer starts.
State is re-derived from GitHub, the role lineage and one
`production_review_steps` row per exact head, so a restarted worker resumes
mid-step without a second `gh pr ready` or a second verdict attempt. Every side
effect re-reads the policy at the current time and is withheld on Off, a new
epoch or a lapsed grant; integration re-checks the policy and the grant expiry
against a fresh clock after the gate, so a reviewer that finishes under Off or
after expiry never lands. Three consecutive GitHub, push or reviewer
capacity/sandbox/timeout failures per head exhaust a budget that survives
restart (`review_budget_exhausted`; a success resets it, and a total of nine
per head caps failures that alternate between steps; reset with
`arcadia production reset-repair-budget`); a GitHub rate limit backs off 15
minutes without spending it and escalates `review_rate_limited` after six
unbroken hours. A non-pass verdict is re-run automatically only when its own
lineage receipt records `reviewerUnavailable`, which `arcadia qa pr` derives
from deterministic evidence only (never from model-written findings); a real non-pass
verdict is never retried automatically and never integrates
(`independent_verdict_failed`).

What authorizes each step: every step, including the push of the settled
head, requires `policyAuthorizesPullRequestReadiness`: an Active policy with
**both** `--remote-preservation` and a current Decision 0058 integration grant
naming the Action. This is stricter than `--remote-preservation` alone, which
still never readies a PR or runs a reviewer. Whether Decision 0058's grant
should be read to cover the push, readying a host-created PR and the
reviewer-model spend, or a separate grant option should exist, is an operator
question this candidate does not settle. Merging on GitHub and pushing the
base branch remain out of scope; integration stays the local fast-forward.

Coverage: `tests/tick-independent-review.test.ts` (exact head, settled head
pushed as an exact commit after preservation, moved head, pending/failed/
timed-out checks, BLOCKED while checks run, poll interval and stable
escalations, Off, epoch change and grant expiry mid-step, consecutive and
total failure budgets, rate-limit backoff, its escalation and replay of an open
escalation, reviewer timeout, exhaustion and reset, an unavailable-then-real
failed verdict, model-spoofed unavailability titles, a PR returned to draft,
no grant, LOCAL ONLY remedy, migration including an earlier table shape) and the `"tick"` variant of
`tests/rehearsal-three-action.test.ts`, which drives preserve, ready, both
reviews and local integration for three Actions through the tick with only the
GitHub CLI and reviewer model stubbed, Off between Actions, and in-process
aborts (thrown exceptions, not process death) after `gh pr ready` and inside a
code-review call, each resumed by a later tick on fresh connections from
persisted state. Candidate code only: it is not installed, and no live grant
was activated with it.

Fresh v2 amendment and rehearsal-creation Asks preserve the earlier drafts and
all twelve accepted prerequisite criteria. They are validated inputs, not
accepted scope. Optional preview is blocked by configured `martianrover`
workspace-write access; no alternate workspace, repeated same-proposal write or
direct database editing was used. The shared one-existing-Action Plan-amendment
runner, separate ordinary Action Ask and fingerprinted `advance queue make-next`
are the existing governed writers. None may infer authority from queue order or
silently rebind an immutable packet.

The first remaining preparation gate is custody of mixed dirty main. Protected
Go refuses the modified library pair, readiness, AGENTS/Notes and narrative
reports; its narrow Ask exemptions do not evacuate them. Preservation needs an
already registered candidate and the shared amendment runner requires entirely
clean primary state. The documented operator recovery playbook can preserve the
exact understood preparation on a recovery branch and publish its review PR;
it is operator-owned recovery, not a fabricated broker reservation or a new
implementation Action. Preserve the learning contribution and validated Log
Ask with that handoff. The five pre-existing unrelated library-contract failures
remain recorded; isolated valid pairs do not make the whole library green.

[The bounded scope/custody design](reports/three-action-managed-production-scope-design-2026-10-02.md)
records exact identities, coverage, seams, required external setup and writer
boundaries. After preparation is reviewed, obtain exact scope acceptance and
pointer transition, then use one protected candidate/Session per implementation
Action with compliant immutable provider/model/effort, deterministic checks,
independent exact-head verdicts, same-candidate completion, PR/check/merge and
installed-service evidence. Prepare/pass the hermetic three-Action rehearsal
before requesting its fresh exact Grant. No installed-host autonomous rehearsal
has run here, and the older literal split/browser/ledger Action stays open.

## Refresh contract

Refresh whenever a critical-path Action completes, a live run occurs, a Grant or Plan changes, or a new blocker is found. Read canonical Project/Plan state, policy, queue, relevant Decisions, Session receipts and retained run evidence. Run the applicable read-only checks, then revise the executive summary, gates, critical path, live-state table and Plan Action scoreboard from their results. For every live failure the replay could have predicted, add a hermetic replay scenario that reproduces the failure and passes after repair. Run the hermetic rehearsal before every live rehearsal, including rehearsals under an existing Grant, and before each new live Grant. Separate observed stages from unperformed criteria and preserve earlier failures.

The operator contract remains: Arcadia progresses deterministically, presents one genuine bounded decision through the existing operator surface, or reports a concrete external blocker. No terminal command, database inspection, receipt copy/paste or manual relay should be required. Do not adapt a refusing operator script by hand; follow its failure handoff for the safe recovery route.
