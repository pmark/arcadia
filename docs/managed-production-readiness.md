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

Rehearsal procedure, standard and failure catalog (runs 1 to 5, 2026-10-06):
[autonomous-production-rehearsal-runbook.md](autonomous-production-rehearsal-runbook.md).

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
checks are green; every rollup entry, CheckRun or StatusContext, is read by its
real state through the shared `normalizeStatusCheck`, an unrecognised entry
blocks by name, and only `ADVISORY_CHECK_CONTEXTS`, which is `CodeRabbit`
under Decision 0080, never gates), then `arcadia qa code-review` and on a later tick
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

### Three-Action rehearsal operator pairs — 2026-10-04 candidate

`prepare-three-action-rehearsal-operator-runbooks` drafts four pairs in
`artifacts/generated/operator-scripts/`: G1 fixture preparation (one
operator-supplied private repository, one ubuntu-latest CI job, Project
`three-action-rehearsal`, Plan `autonomous-three-action-rehearsal`, serial
Actions `write-start-marker`, `transform-start-marker`, `verify-final-rehearsal`,
provider `claude-code-cli`), G6 read-only preflight, the one-shot G7 Grant (12-hour
packet-approval and Decision 0058 expiries, `--remote-preservation`,
concurrency one, current revision and installed release, hermetic replay first),
and G8 terminal Off (governed deactivate first, only of G7's own policy with the
exact fixture scope, three quiet observations before
and after the hash-pinned `recover-arcadia-host-services` restart with its
override variables unset, work
reconciliation, restart receipt and intervention ledger).
This PR also publishes the reviewed `recover-arcadia-host-services` pair into
the tracked library at its exact existing bytes, because G8 pins and runs it.
G6 and G7 require a fresh bounded `git ls-remote` of origin main equal to local main.
`tests/three-action-rehearsal-operator-scripts.test.ts` covers the contract,
static safety and refusals against fake CLIs. They are unpublished candidate
files: none was run, no repository was created and no Grant exists. G6 observes
Codex capacity ignoring `capacityGateEnabled: false`, so an unmetered-only
observation refuses as unknown. Whether Decision 0058 covers PR readiness and
reviewer spend (#925) stays an operator acknowledgement stated in G7's
always-visible title and effect.

`fix-rehearsal-g1-plan-and-operator-guidance` (candidate, 2026-10-04): a
read-only smoke found G1's generated Plan invalid YAML, which docs sync would
only have reported after the repository was created, pushed and imported. G1
now renders the fixture into its run directory and runs the real `discoverDocs`,
a dry-run `syncProjectDocs` in a throwaway workspace and `resolveReadySet`
before any GitHub, push, import or manifest write, and reports a half-registered
earlier attempt with an exact recovery (no governed command removes a registered
Project, so that recovery is an Agent Ask). `recover-arcadia-host-services` needs
`ARCADIA_WORKSPACE=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover` inline,
never exported; G8's pin of its descriptor moved with the new text. G6 now
reports an unreadable check-runs read once and judges Codex availability by its
real enum. Still unrun live: no repository was created and no Grant exists.

### Three-Action rehearsal run 2 — 2026-10-05 candidate

`prepare-run-2-rehearsal-scripts` drafts the run-2 pairs. None was run. They
were tested only with `--describe` and against fakes. Run 1 left a passed
development attempt and a failed code review for `write-start-marker`, plus
its preserved candidate (branch `claude/write-start-marker-20261004T170245861Z`,
PR #1, tip `58bcd915…`). A passed attempt for an unchanged requirement input is
never relaunched. `requirementIdentity` hashes `next_action`, the acceptance
criteria, the responsibility and the execution; the title is not part of it.

- **Reset.** `reset-three-action-rehearsal-fixture-2026-10-05` is one-shot.
  It rewrites only that Action's `next_action` and adds a run-2 note. It also
  bumps the Plan's `updated:` date, because otherwise docs sync skips the
  change as older than the record.
- **Validation and evidence.** Before its single commit, the reset validates
  with G1's rules plus a requirementIdentity diff. It also reads the live
  lineage read-only. It refuses unless run 1's G8 succeeded and the branch and
  PR are still at their tip. It pushes fixture main without force, runs docs
  sync and records `previousMain`, `newHead`, `candidateTip` and `prTip`.
- **G6 and G7.** `preflight-three-action-rehearsal-2026-10-05` and
  `grant-production-three-action-rehearsal-2026-10-05` bind that head instead
  of genesis. Each takes it from the latest succeeded reset receipt for the
  exact repository. G7 has a new request id and keeps every 2026-10-04 G7
  property. Its card cites the operator's #925 answer (Log
  `operator-answers-rehearsal-run2-2026-10-05`). The 2026-10-04 G6 and G7 are
  retired from use; their files are unchanged.
- **Dispatch fix.** The pairs alone were not enough. Two runtime guards
  would have stopped the amended Action behind run 1's unmerged candidate:
  - The tick's terminal handoff deferred every admission.
  - The Action claim refused the dispatch.

  Both now skip a finished candidate only when its own passed development
  attempts were all for a superseded input. The candidate is never touched,
  and its claim stays while its worktree is dirty.
  `tests/rehearsal-run-2-amended-action.test.ts` proves it through
  `requirementIdentity`, the launch gate and the real tick.

The run-2 G8 variant is `restore-terminal-off-three-action-rehearsal-2026-10-05`.
It is the merged G8 (#955, settled-descendant reconciliation) with one change:
it also owns the run-2 request id, still only with the exact fixture scope. Its
reconciliation and hash pins are unchanged. Operator order: merge this pull
request → rerun run 1's G8 → reset → recover only if main moved again → G6 →
G7 within 30 minutes → G8 variant (START_HERE.md lists the commands).

### Three-Action rehearsal run 3 — 2026-10-05 candidate

`prepare-run-3-rehearsal-scripts` drafts the run-3 pairs. None was run; they
were exercised only with `--describe` and against fakes. Run 2 ended with
production Inactive at revision 33 and its G8 terminal Off proven (run
`20261005T160050Z-46759`). Fixture main is run 2's reset head `0d3d2ced…`. Run 2's
candidate is preserved on branch `claude/write-start-marker-20261005T155147519Z`
and PR #2 at `7f139037…`, beside run 1's PR #1 at `58bcd915…`. Every
2026-10-04 and 2026-10-05 pair is retired from use and left byte-unchanged.

- **Reset.** `reset-three-action-rehearsal-fixture-run3-2026-10-05` rewrites
  write-start-marker's `next_action` a third time. Its input revision moves
  from `959a3b12c686…` (original) and `7a8dd4f5960f…` (run 2) to a third. An
  equal `updated:` date applies in docs sync and only an older one is
  skipped, a rule a test proves with the real docs sync. So the Plan carries the
  reset's UTC date, and a host date before 2026-10-05 refuses. Before any
  commit, the reset also runs a read-only dry-run docs sync against the live
  workspace, which must report the Action as an update. A test proves the
  same-day sync reopens the record run 2 left `done`. The new text also names
  the completion request id `complete-write-start-marker-run3-2026-10-05`,
  because the packet template's `complete-<action-id>-<date>` would reuse run
  2's settled id on 2026-10-05 and stall completion. The reset refuses if that
  id is already used.
- **Issue #968.** In run 2, run 1's pending complete proposal naming the
  Action made `resolveProjectTransition` answer `decision` for 33 minutes, and
  nothing launched. The reset reads the gate through Arcadia's own
  `resolveOperatorGate`. It refuses on any pending fixture proposal or
  Decision except run 2's `complete-write-start-marker-2026-10-05`, which must
  match the descriptor's `agentAsk` declaration. Live, the tick accepted that
  one on run 2's candidate branch (fixture main untouched), so it no longer
  gates and the reset leaves it as it is. Only if it were still pending would
  the reset reject it through `arcadia agent-ask settle --disposition
  rejected`, preview then apply with that fingerprint, with
  `ARCADIA_WORKSPACE` inline on that one command, before the commit; the
  preview must write no document and place no queue entry. In every case the
  gate must then read clear.
- **Evidence.** The receipt records the new head, all six candidate tips
  before and after, and the superseded proposal with its fingerprint.
  `tests/rehearsal-run-3-amended-action.test.ts` proves the dispatch path with
  the real transition resolver and tick. With both earlier lineages present,
  the pending proposal blocks dispatch. After the rejection the run-3 input
  launches as development ordinal 1.
- **G6, G7 and G8.** The run-3 G6 and G7 bind the run-3 reset head: one commit
  on run 2's head, two on genesis. G6 adds the read-only `operator_gate` check.
  G7 is the run-2 G7 line for line apart from ids, binding and wording, which a
  test compares, and it carries the `next_after` hint. The run-3 G8 also owns
  the run-3 request id. Its reconciliation and hash pins are byte-identical to
  run 2's.
- **Order.** PR #969 merged and reinstalled → merge this pull request → reset →
  recover only if main moved on a runtime path → G6 → freeze (no push to main,
  reinstall, restart or G8) → G7 within 30 minutes → G8 from the Terminal panel
  or `/runs`.
- **Run 3 evidence to capture.** Keep the live QA reviewer's verdict on the
  "Operator QA plan" criterion for the run's pull request
  (`artifacts/qa/pull-requests/.../qa-report.md`). It proves the remainder
  Action `verify-operator-qa-plan-with-live-qa`.

Live state reported before the run: run 2's proposal is accepted, run 1's is
rejected, and `arcadia advance` answers `launch` for the fixture. The reset
re-reads all of this itself and refuses on any other pending fixture item.

### Three-Action rehearsal run 4 — 2026-10-05 candidate

`prepare-run-4-rehearsal-scripts` drafts the run-4 pairs. None was run; they
were exercised only with `--describe` and against fakes. Run 3 ended with its
G8 terminal Off proven (run `20261005T194025Z-26232`). Fixture main is run 3's
reset head `4375aafe…`, one commit on run 2's `0d3d2ced…` and two on genesis
`5e0e183f…`. Run 3's candidate is preserved on branch
`claude/write-start-marker-20261005T184707757Z` and PR #3 at `50d1eab8…`,
beside PR #2 at `7f139037…` and PR #1 at `58bcd915…`. Every 2026-10-04,
2026-10-05 and run-3 pair is retired from use and left byte-unchanged (a test
pins their sha256).

- **Reset.** `reset-three-action-rehearsal-fixture-run4-2026-10-05` clones the
  run-3 reset. It requires run 3's reset receipt (`newHead` `4375aafe…` on run
  2's head) and run 3's G8 terminal Off. It rewrites write-start-marker's
  `next_action` a fourth time: its input revision moves off `959a3b12c686…`,
  `7a8dd4f5960f…` and `e22c8cfadd0b…` with an unchanged criteria fingerprint.
  The text keeps the original sentence and names the unused completion id
  `complete-write-start-marker-run4-2026-10-05`. The reset refuses at
  `proposal_gate`, before any settle or commit, if that id already exists. It
  checks all three earlier candidates (local branch, GitHub branch and PR head
  each) before the push and after it. Run 3's date rule and the read-only
  live dry-run docs sync are kept, and a test proves the same-day sync reopens
  the record run 3 left `done`.
- **Issue #968.** Unchanged from run 3, with run 3's
  `complete-write-start-marker-run3-2026-10-05` as the one proposal the reset
  may reject (declared in its descriptor's `agentAsk`): pending → governed
  rejected settle before the commit; rejected or accepted elsewhere → left as
  it is, only with fixture main at run 3's reset head and the gate clear; any
  other pending fixture item (run 1's or run 2's included) → refuse. Live, run
  3's proposal is accepted.
- **Evidence.** The receipt records the new head, the three candidates' tips
  before and after, every fixture proposal's state before and after, and the
  superseded proposal. `tests/rehearsal-run-4-amended-action.test.ts` runs the
  real transition resolver and tick through three earlier runs and shows the
  run-4 input launching as development ordinal 1.
- **G6, G7 and G8.** The run-4 G6 and G7 bind the run-4 reset head: one commit
  on run 3's head, three on genesis. G6 keeps every run-3 check. G7 is the
  run-3 G7 line for line apart from ids, binding and wording, which a test
  compares, and its `next_after` voids on every rehearsal G8, reset, recover
  and reinstall. The run-4 G8 also owns the run-4 request id. Its
  reconciliation and hash pins are byte-identical to run 3's.
- **Order.** Validation-evidence repair PR merged and reinstalled by the
  release manager → merge this pull request → reset → G6 → freeze (no push to
  main, reinstall, restart or G8) → operator presses G7 within 30 minutes → G8
  from the Terminal panel or `/runs`.
- **Run 4 evidence to capture.** Keep the live QA reviewer's verdicts on the
  run's pull request (PR #4), in `artifacts/qa/pull-requests/.../qa-report.md`,
  especially the "Operator QA plan", "Tests and evidence" and "Approval
  boundaries" criteria.

### Three-Action rehearsal run 5 — 2026-10-06 candidate

`prepare-run-5-rehearsal-scripts` drafts the run-5 pairs. None was run; they
were exercised only with `--describe` and against fakes. Run 4 admitted
write-start-marker and rendered the Validation evidence section into PR #4,
then stalled about three hours at integration (#981): the agent's drafted
complete Ask was never archived, the worker's terminal-recovery preservation
committed it on top of the settlement, and the integration guard refused in a
silent loop. Its G8 proved terminal Off (run `20261006T011557Z-3871`, policy
revision 37). Fixture main is run 4's reset head `9642005f…`, one commit on run
3's `4375aafe…`, on run 2's `0d3d2ced…`, on genesis `5e0e183f…`. Run 4's
candidate is preserved on branch `claude/write-start-marker-20261005T220000438Z`
and PR #4 at `79c6bae9…`, beside PRs #3, #2 and #1. Every 2026-10-04,
2026-10-05, run-3 and run-4 pair is retired from use and left byte-unchanged
(a test pins the sha256 of all 30 files).

- **Reset.** `reset-three-action-rehearsal-fixture-run5-2026-10-06` clones the
  run-4 reset. It requires run 4's reset receipt (`newHead` `9642005f…` on run
  3's head) and run 4's G8 terminal Off. It rewrites write-start-marker's
  `next_action` a fifth time: its input revision moves off `959a3b12c686…`,
  `7a8dd4f5960f…`, `e22c8cfadd0b…` and `7843e2eb12f9…` with an unchanged
  criteria fingerprint. The text keeps the original sentence, names the
  unused completion id `complete-write-start-marker-run5-2026-10-06` (refused
  at `proposal_gate`, before any settle or commit, if it already exists) and
  tells the agent to leave `git status` clean after settling. It checks all
  four earlier candidates (local branch, GitHub branch and PR head each) before
  the push and after it. The date rule is run 4's: the reset writes its own
  UTC date and docs sync applies an equal or later one. Run 4's Plan says
  2026-10-05, so a reset on 2026-10-06 bumps the date; tests prove that bump
  with the real docs sync, including reopening a record run 4 left `done`.
- **Issue #968.** Unchanged, with run 4's
  `complete-write-start-marker-run4-2026-10-05` as the one proposal the reset
  may reject (declared in its descriptor's `agentAsk`): pending → governed
  rejected settle before the commit; rejected or accepted elsewhere → left as
  it is, only with fixture main at run 4's reset head and the gate clear; any
  other pending fixture item (runs 1 to 3 included) → refuse. Live, run 4's
  proposal is accepted.
- **Evidence.** The receipt records the new head, the four candidates' tips
  before and after, every fixture proposal's state before and after, the
  superseded proposal and the completion id.
  `tests/rehearsal-run-5-amended-action.test.ts` runs the real transition
  resolver and tick through four earlier runs and shows the run-5 input
  launching as development ordinal 1.
- **G6, G7 and G8.** The run-5 G6 and G7 bind the run-5 reset head: one commit
  on run 4's head, four on genesis. G6 keeps every run-4 check. G7 is the
  run-4 G7 line for line apart from ids, binding and wording, which a test
  compares, and its `next_after` voids on every rehearsal G8 (runs 1 to 5),
  reset (runs 2 to 5), recover and reinstall. Both also require the #983
  merge commit `bb83f70c…` (the #981 fix) on main beside #922 and #924, so
  they refuse until it is merged. The run-5 G8 also owns the run-5
  request id. Its reconciliation and hash pins are byte-identical to run 4's.
- **Order.** Stray-Ask archive fix (#981) merged and reinstalled by the
  release manager → merge this pull request → reset → G6 → main quiet (no push
  to main, reinstall, restart or G8) → operator presses G7 within 30 minutes
  → G8 from the Terminal panel or `/runs`.
- **Run 5 evidence to capture.** Keep the live QA reviewer's verdicts on the
  run's pull request (PR #5), in `artifacts/qa/pull-requests/.../qa-report.md`:
  "Operator QA plan", "Tests and evidence" and "Approval boundaries". If
  integration is refused, keep the new escalation text `arcadia production
  status` shows for it, with its blocker and remedy.

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

## Single-Action path: operating tips for agents — 2026-10-09

These are field notes from making one Action run headless from a confirmed Launch to a draft PR (#1131, #1138, #1141, #1145). The rest of this document has not yet been re-derived against them; refresh it under the contract below.

**The path.**
1. A confirmed Launch, from `/production` or `arcadia session launch --operator-launch` at a TTY, mints a one-shot authorization (Decision 0096).
2. A headless session runs.
3. On exit, the worker tick validates on the host, commits, pushes and reconciles, and opens one draft PR only on `accepted_completion`.

It never merges. Integration is refused for operator-launched candidates unless production itself delegates validation. Manual `arcadia session reconcile` records the exit only; it does not commit or push.

**Launch and observe.**
- Fingerprint launches are headless by default. `arcadia go --launch --interactive` keeps the old TUI.
- Every session writes `<workspace>/.arcadia/sessions/<id>.log` and records its exit code in `agent_sessions.exit_status`, with 128+n for a signal.
- Watch live sessions with `arcadia dashboard runs --sessions 8 --json`, the `/production` log tail, and `.arcadia/worker.log`.
- A preflight refuses a launch before reserving anything when the provider binary is missing (`provider_binary_missing`), the provider is not signed in (`provider_not_signed_in`), or the required headless flags are missing (`permission_posture_missing`).

**Models.**
- Every session starts on the light tier (`sessionStartTier`): Codex `gpt-6-luna`, Claude `haiku`. The brief names the plan's tier as the escalation target.
  - Claude escalates through an Agent-tool subagent.
  - Codex escalates through `spawn_agent` with a model override.
  - OpenCode drafts a relaunch proposal instead.
- An explicit `--model` wins, and a workspace can override the start tier in `config/coding-agent-models.json`.
- Light starts run at low effort even for `e3_deep` Actions. Expect more repair attempts.

**Provider quirks seen live.**
- **Codex** (`exec --json --sandbox workspace-write`):
  - Its sandbox keeps `.git` read-only, so a real repository's worktree usually cannot be committed by the agent. The host commits on exit; this is expected, not a failure.
  - If the worker's preservation heartbeat is stale (over 15s, or no worker at all), `arcadia-preserve-broker-codex` refuses. The agent then correctly drafts its completion Ask and leaves the candidate for the host.
  - Codex persists a project-trust entry for each new directory in `~/.codex/config.toml`. Decision 0099 rules that for experiment temp folders this is not a Decision 0082 stop condition.
- **Claude** (`--print --output-format stream-json --verbose --settings <per-session> --setting-sources ""`):
  - Only the per-session allow list (the Project's declared validation commands plus `arcadia agent-ask draft`) and managed policy apply.
  - It loads no user or project settings and no `CLAUDE.md`/`AGENTS.md`, and runs without the operator's OS sandbox (#1139).
- **OpenCode** (`opencode run`):
  - It auto-rejects any permission that would prompt.
  - The operator's config allowlists `~/.opencode/**`, where real worktrees live. A worktree elsewhere, such as a macOS temp folder, needs a per-process `OPENCODE_CONFIG_CONTENT` grant.

**Bounded lifetime.**
- The default limit is 120 minutes; override it per launch with `--time-limit-minutes`.
- A stuck session is stopped when the limit passes, or when an auth or provider-limit signal persists past the 20-minute stall deadline. Permission-prompt text is ignored for headless sessions.
- The stop only ends tmux. The worktree survives, and reconcile runs on the next tick.

**Prove cheaply before going live.**
1. Run the fast-rehearsal harness offline.
2. Press the `/runs` "Test headless Codex single-Action run, OpenCode on failure (experiment fixture)". It reports the agent part and the host part separately and diagnoses from the receipt.
3. Then launch one small real Action from `/production`.

Each live defect should be reproduced offline before it is fixed.

**Services.**
- The dev dashboard (:3020) runs `next dev`, so pre-load the pages after every restart.
- The stable demo (:3030, https://arcadia-1.alpine-rattlesnake.ts.net/) serves a prebuilt `rel-*` release, and dev restarts never touch it.
- Under heavy load, a restart can stop every service (#1129). Recover as `docs/agent-guidance/pull-requests.md` describes.

## Refresh contract

Refresh whenever a critical-path Action completes, a live run occurs, a Grant or Plan changes, or a new blocker is found. Read canonical Project/Plan state, policy, queue, relevant Decisions, Session receipts and retained run evidence. Run the applicable read-only checks, then revise the executive summary, gates, critical path, live-state table and Plan Action scoreboard from their results. For every live failure the replay could have predicted, add a hermetic replay scenario that reproduces the failure and passes after repair. Run the hermetic rehearsal before every live rehearsal, including rehearsals under an existing Grant, and before each new live Grant. Separate observed stages from unperformed criteria and preserve earlier failures.

The operator contract remains: Arcadia progresses deterministically, presents one genuine bounded decision through the existing operator surface, or reports a concrete external blocker. No terminal command, database inspection, receipt copy/paste or manual relay should be required. Do not adapt a refusing operator script by hand; follow its failure handoff for the safe recovery route.
