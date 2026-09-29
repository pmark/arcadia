# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document and asserts nothing on its own. Every line reads
from `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, `MISSION_LOG.md`, the live worker log, the workspace
database, the live `arcadia advance queue` and `arcadia production status`
output, and the hermetic rehearsal replay (`tests/rehearsal-two-action.test.ts`).
When those disagree with this file, they are right and this file is stale.
"Refreshing this document" at the bottom says how to re-derive it.

Last derived: **2026-09-27T05:10Z**, against `origin/main` `f670910d` plus the
fixes in the pull request that carries this revision. Arcadia's own target is
`NORTH_STAR.md` at the repository root, and its gates are the critical path
below.

---

## What this derivation found

**Every live rehearsal attempt so far stopped on a defect nobody had seen,
because no test ever ran the pipeline the way the rehearsal does.** Each stage
had unit tests, but the tests that crossed stages fed them state no real
Session produces. The clearest example: every test of "a finished Session
completes and integrates" inserted a passing `execution_runs` row by hand. A
Session launched by the worker never writes one.

This derivation adds a **hermetic replay of the operator's rehearsal**
(`tests/rehearsal-two-action.test.ts`, harness in
`tests/helpers/rehearsalHarness.ts`). It builds the fixture exactly as
`prepare-two-action-rehearsal-2026-09-26.sh` does, through the same command
functions the operator's `pnpm arcadia …` lines call: `project import`,
`project metadata`, `docs sync --apply`, `work plan --agent-profile`,
`review approve --no-execute`, `production preview`/`activate`/`deactivate`.
Then it drives the real `runManagedProductionTick` with the workspace's own
registries, exactly as `arcadia worker` does, including the worker's pre-tick
preservation-request pass.

Only three things are simulated:

- tmux (a launch is recorded, and "exit" is the pane dying);
- the coding agent's keystrokes;
- provider capacity and sign-in.

Preservation validation runs the real Seatbelt validator on the host
(`ARCADIA_PRESERVATION_HOST_TEST=1`); on CI it runs the same declared commands
under the same bindings without Seatbelt. Reconciliation,
integration and settlement run real Git and write real managed documents.

It found six rehearsal-stopping defects. Four are fixed in this pull request,
along with the codex launch shape. One is a fixture change, and one only
matters for a Claude-provider rehearsal. **The operator chose `codex-cli` for
the rehearsal (2026-09-27).**

| # | Defect | Where the live run stops | Status |
| --- | --- | --- | --- |
| 1 (#724) | **A Session that finishes by the brief's own completion protocol is never recognized as complete.** It settles `complete` inside its candidate, as `renderActionBrief` tells it to. Reconciliation read "done" only from the base checkout, and automatic completion needs a Run that guarded Sessions never write. So the exit was classified `incomplete_resumable`, integration waited forever, and the worker relaunched the finished Action every tick. | Step 5: A finishes, B never launches, A relaunches repeatedly | **Fixed here.** `findCandidateSettledCompletion` (`src/sessions/reconciliation.ts`) accepts a completion only when all of these hold: the candidate is clean; its Plan says done; an accepted, applied `complete` settlement for exactly this Action exists; and that settlement's `candidate_revision` is in the candidate's history. A hand-edited `status: done` or a rewritten candidate is refused (unit tests + replay). |
| 2 (#725) | **A Session that dies before changing anything keeps its Action claim.** Reconciliation recorded `missing_evidence` but left the claim live, so every relaunch was refused as "already claimed by a live worktree" and two refusals exhausted the repair budget. This is the #695 class, for the non-resumable case. | Step 3, whenever the agent crashes at start-up (auth, provider outage — both happened on 2026-09-26) | **Fixed here.** Reconciliation releases the claim for `missing_evidence`/`failed_execution` exits with no candidate changes. The worktree reservation row is kept, so `tidy` still protects the worktree. |
| 3 (#726) | **Every fixture declared a validation command that can never pass for A.** v2, v3 and v4 declare `node --test tests/marker.test.mjs`. At A's candidate that file does not exist yet, so host preservation validation fails and A is never integrated (#717 saw this live). At B's candidate, check-binding refuses it anyway, because B creates the file its own check runs. The command is frozen into each fixture's approved build packet, so none of them can be repaired in place. | Step 5: A preserved-refused, never integrated | **Fixture decision.** The replay's fixture commits a self-contained `scripts/check-marker.mjs` at genesis and declares `node scripts/check-marker.mjs`. The operator prepare script (`artifacts/generated/operator-scripts/prepare-two-action-rehearsal-2026-09-26.sh`, gitignored) carries the same change: it commits the byte-identical check at genesis and passes `--validation-command 'node scripts/check-marker.mjs'` for the fresh `-v5` fixture. Preparing that fixture is still the live rehearsal's first step below. |
| 4 (#727) | **Standing-policy Sessions were launched as interactive TUIs, for both Claude and Codex.** An interactive TUI never exits after its turn, so the tick never reconciles it. `claude --help` also documents that the workspace trust dialog is skipped only in non-interactive mode (`-p`), so an interactive Claude Session hangs at it in every fresh candidate (#698). **No Claude or Codex Session has ever been launched by the worker**: the workspace database holds exactly one worker-launched Session, and it was opencode (headless `opencode run`). | Step 3: A launches and never ends | **Fixed here for codex-cli.** An admission-bound Codex Session launches as `codex exec --sandbox workspace-write --cd <worktree>`. That is Codex's non-interactive entry point, in the same sandbox an interactive trusted Session gets, with no approval bypass; operator-attended launches stay interactive. **Claude stays open.** Its fix changes unattended agents' permission posture, and an agent's attempt at it was refused. It is recorded as an expected failure, and it does not block the codex rehearsal. |
| 5 (#731) | **A sandboxed agent's completion is never settled.** Inside Codex's `workspace-write` (or Claude's) sandbox a Session can write only its worktree. It cannot commit (a linked worktree's commits write the main repository's `.git`) or settle (that writes the workspace database). It can only `agent-ask draft` its completion and exit. Host preservation commits the draft, but nothing settled it, so the exit read `incomplete_resumable` and A relaunched every tick. | Step 5: A finishes, never integrates | **Fixed here.** Reconciliation settles the drafted Ask on the candidate through the existing deterministic settler: evidence verbatim-covering every criterion as `met`, a revision still in the candidate's history, a clean candidate. The Action brief now tells a sandboxed agent to draft and exit. |
| 6 (#732) | **JSON-drafted completions were never auto-settled.** The settler rewrote `request_id`/`candidate_revision` with a YAML-line regex. AGENTS.md tells agents to write compact JSON, which that regex never matches, so settlement looked up the wrong proposal and failed silently — before dispatch too, not only here. | Step 5, behind defect 5 | **Fixed here.** JSON drafts are parsed and re-serialized; block YAML is still edited line by line. |

**What the replay proves now** (16 scenarios, all green, plus the one expected
Claude failure), mapped to the proof Action's acceptance criteria.

- **On codex-cli, with a realistically sandboxed agent** (it edits, drafts and
  exits; it never commits or settles):
  - A is preserved, settled on its candidate, integrated, and the pointer moves.
  - B launches, and completes the same way.
  - Every launch is `codex exec` in `workspace-write`, never bypassing approvals.

The remaining scenarios use the default provider fixture:

- **Preparation and activation (criterion 1):** import, sync and seed name A
  as dispatchable with one open packet approval. One activation grants both
  Actions, the Decision 0058 integration grant and `packet_approval`. A
  replayed request id is a no-op with a warning.
- **Two dependent Actions from one activation (criteria 2 and 3):**
  - A1 launches on the first tick.
  - A concurrent second execution is refused.
  - A1 is killed mid-edit and reconciled `incomplete_resumable` with its work
    preserved.
  - The worker resumes A2 in the same worktree and branch, and A2 sees A1's
    edit.
  - A2 settles. A is integrated onto the fixture's `main` and the pointer moves.
  - B's packet is prepared and approved under the standing grant.
  - B launches on a fresh candidate from the new base, with no operator step.
  - B completes, and nothing further launches.
  - The brief's full protocol (validate, preserve through the host, settle,
    exit) integrates too.
- **Turn Off mid-work (criterion 4):**
  - Off never kills the live Session and never launches again.
  - The Session's exit is reconciled visibly.
  - Integration is refused while Off.
  - Ticks after a restart launch and reactivate nothing.
  - The Session's finished output is still on its branch.
- **Guards:** a hand-edited `done` is never accepted. A committed but unsettled
  exit resumes, then integrates once settled. A Session that dies with no
  changes relaunches on a fresh candidate. An `origin` the tick fetches from
  never rewinds an integrated, unpushed `main`.
- **Fixture decisions:** without the integration grant, B never launches.
  Without `packet_approval`, B waits on a named approval in `production status`
  and launches the tick after the operator approves it. The v2–v4 validation
  command stops A.

What the replay cannot prove, and so stays the operator's live rehearsal:

- that a real `codex exec` process does the work and exits (defect 4 was
  exactly this class);
- that the `arcadia` CLI and the preserve broker work from inside Codex's
  sandbox;
- real provider capacity;
- the real `arcadia worker` process lifecycle across a restart.

Everything upstream and downstream of the provider process is now proven,
including the case where the agent can do nothing but edit, draft and exit.

---

## Executive summary

**Lane A (unattended): no code Actions left in the Plan. Once this PR merges,
one fresh codex fixture stands between here and the proof run.** Decision
0072 is approved and its `packet_approval` delegation is merged (#714), so
criterion 2 ("B launches without … launch confirmation in between") is
reachable. The replay shows it on codex-cli with this PR's fixes.

**Lane B (concurrent):** unchanged from the prior derivation. The concurrency
gate (`enforce-concurrency-gate-at-admission`) and cross-Plan dependency
resolution have landed. Six Lane B Actions are ready now and need no proof
(`fix-action-intent-target-ref-amendments`, the queue's selected Action;
`release-admission-on-every-launch-failure`, `add-fixture-coding-agent-provider`,
`load-test-workspace-db-contention`, `keep-action-claim-while-candidate-unmerged`,
`limit-sessions-per-provider-account`). Ready-set admission itself waits on
Lane A's proof. §5 "Build map" of
`docs/proposals/portfolio-parallel-execution.md` is still the plan.

---

## Before the next live rehearsal

The standing policy is **Active right now** (revision 20, epoch 15), scoped to
`two-action-rehearsal-v3`. It waits only on v3 A's packet approval
(`review_8029859d4b744913ad`). **Do not approve it.** v3 carries defect 3, and
on `main` without this PR it would also hit defects 1 and 2.

In order:

1. Merge this PR (defects 1, 2, 5 and 6, plus the codex launch shape), and
   restart the worker so it runs the merged code.
2. Deactivate the v3 grant.
3. Prepare a fresh `-v5` fixture with these settings:
   - validation command: the committed `scripts/check-marker.mjs` (defect 3);
   - `PROVIDER="codex-cli"` and `AGENT_PROFILE="codex_build"`;
   - `GO_BROKER_LAUNCHER="arcadia-go-broker-codex"`.
4. Activate with `--provider codex-cli` and
   `--transitions validation,acceptance,pointer,packet_approval`, plus
   `--packet-approval-expires-at` and the Decision 0058 integration grant.
5. Follow the generated `next-steps.md`. A's packet approval is then the only
   operator intervention.

---

## The gates

| Gate | State |
| --- | --- |
| 1 — The board is the surface | ✅ closed 2026-09-20 |
| 2 — Work reaches an agent with no operator | 🟡 Launch is proven hermetically. The codex launch is now non-interactive (defect 4); opencode already was. Claude cannot run unattended yet (#727). |
| 3 — A finished Session lands with no operator | 🟡 Proven hermetically with this PR (defect 1 was the gap). Provisional until the proof run. |
| 4 — It keeps going without help | 🟡 Proven hermetically with this PR (defect 2 was the gap), including B's packet approval under Decision 0072. Provisional until the proof run. |
| 5 — Proof | ⬜ `prove-two-action-unattended-production` is deferred. Every code prerequisite is in the Plan or this PR; see "Before the next live rehearsal". |
| 6 — The operator surface | ⬜ Off the critical path, held behind the proof. |
| **B — Cross-repository concurrency** (Decision 0071) | ⬜ The gate is enforced at admission. Ready-set admission waits on gate 5 and `prove-concurrent-ready-set-admission`. |
| **B′ — Same-repository pipelining** (Decisions 0071 + 0070) | ⬜ Gated by B and gate 5. |

A gate is closed when the live system does what the gate says, not when its
Actions are marked done, and not when a hermetic replay passes. Gates 3 and 4
were once marked closed on status alone, and the first real runs reopened them.

---

## The critical path, in order

1. **This PR** — defects 1, 2, 4 (codex), 5 and 6, the hermetic replay, and
   this derivation.
2. **Prepare-script edit** — a `-v5` codex fixture with the committed check
   (#726).
3. **Operator:** deactivate the v3 grant, reverse Decision 0057's deferral,
   and run `prove-two-action-unattended-production` on codex-cli per its
   runbook. **This is where the unattended claim is earned.**
4. `prove-multi-provider-production-recovery` (this is where #727, the Claude
   launch, becomes blocking), then `run-managed-production-live-soak`.

Lane B continues in parallel on its six ready Actions (see the executive
summary). Each is an ordinary `claude-sonnet-5` session at medium effort.

### Rehearsal hazards still open

- **#608:** while the standing policy is Off, the worker fast-forwards every
  DB-active Project's checkout to `origin/main`. The replay proves this never
  rewinds an integrated, unpushed `main`, but a manual `git reset --hard` on a
  fixture is still silently undone.
- **#717:** the preserve broker strips validation failure details to `{}`, so an
  agent cannot diagnose its own refusal. Defect 3's fix removes the known
  trigger. The host-side `validation.json` under `artifacts/preservation/` still
  names the cause.
- **Stale admissions listing.** `production status` still lists
  `zero-prompt-rehearsal` admissions as `committed` and v2 admissions as
  `fenced`. They do not count toward concurrency (#610); only the listing lags.
- **Capacity gating is off** (`codingAgent.capacityGateEnabled: false`), so
  "admitted" is an operator choice, not observed headroom.
- **GitHub board reconciliation fails every tick.** The worker log shows
  `your authentication token is missing required scopes [read:project]`. It
  does not block a fixture rehearsal. Gate 1 needs `gh auth refresh -s read:project`.

---

## Component proof map

Each production stage, the tests that prove it alone, and the replay scenarios
that prove it in combination with its neighbours. A stage with no
combination proof is where the next surprise lives.

| Stage | Code | Proven alone by | Proven in combination by (`rehearsal-two-action.test.ts`) |
| --- | --- | --- | --- |
| Fixture import, metadata, docs sync | `commands/project.ts`, `commands/docs.ts` | `cli-response-contracts`, `docs-sync` | Steps 1-2 |
| Build-packet seeding | `runWorkPlanCommand` | `execution-runner-build-failure`, `policy-permitted-packet-preparation` | Steps 1-2 |
| Activation, replay, scope | `production/policy.ts`, `commands/production.ts` | `managed-production-policy`, `production-fault-matrix` | Steps 1-2 (replay no-op) |
| Scheduling pass, dispatch | `scheduling/`, `docs/dispatch.ts` | `worker-tick`, `advance-queue` | every scenario |
| Admission and concurrency gate | `issueAdmission` | `production-fault-matrix`, `dispatch-admission` | Steps 3-5 (concurrent refusal) |
| Automatic packet preparation | `attemptAutomaticPlanningResolution` | `production-tick` | Steps 3-5 (B's packet) |
| Delegated packet approval | `attemptDelegatedPacketApproval` | `production-tick` (Decision 0072 cases) | Steps 3-5; the "without `packet_approval`" scenario |
| Guarded launch, worktree, claim, brief | `sessions/launch.ts`, `sessions/index.ts`, `actionBrief.ts` | `session-launch`, `launch-preview`, `action-brief` | Steps 3-5; the brief-protocol scenario; the provider scenarios |
| Provider launch command | `buildProviderLaunch` | `session-launch` | the provider and codex scenarios (codex `exec` and opencode `run` proven; Claude expected-fail, #727) |
| Stall detection | `production/stallDetection.ts` | `production-tick` (stall cases) | not combined (needs real pane output) |
| Agent-initiated preservation | `runPreserveCommand`, preservation transport | `manual-preservation`, `preservation-heartbeat-freshness` | the brief-protocol scenario |
| Host preservation and validation | `preserveSessionCandidate`, Seatbelt validator | `preserve-on-exit-and-integrate` | every completion scenario; the v2-v4 validation command scenario |
| Reconciliation | `sessions/reconciliation.ts` | `session-reconciliation` (5 new cases here) | every exit scenario; the guards |
| Claim release and resumption | `reconcileSessionExit`, `prepareSession` | `session-reconciliation` | the split-session scenario; the dies-before-changes scenario |
| Completion settlement | `ask/settlement.ts` | `agent-ask-settlement`, `agent-ask-complete` | every completion scenario |
| Host settlement of a sandboxed agent's draft | `settleCandidateDraftedCompletion`, `attemptAutoSettlePendingCompletion` | `session-reconciliation`, `auto-settle-before-dispatch` (JSON drafts) | the codex scenario |
| Candidate integration (Decision 0058) | `integrateSessionCandidate` | `preserve-on-exit-and-integrate` | every completion scenario; the "without grant" scenario |
| Base-branch observation | `detectBaseBranchAdvance` | `production-tick` | the `origin` scenario |
| Turn Off, restart | `deactivateProduction`, tick | `managed-production-policy`, `production-fault-matrix` | Step 6 |
| Auto-settle before dispatch | `attemptAutoSettlePendingCompletion` | `auto-settle-before-dispatch`, `production-tick` | not combined (a Session-less path) |

---

## Concurrency

Unchanged in substance since the prior derivation:

- **Cross-repository concurrency (Decision 0071, supersedes 0023)** follows §5
  "Build map" of `docs/proposals/portfolio-parallel-execution.md`.
  `enforce-concurrency-gate-at-admission` has landed. It caps concurrency at 1
  on every admission until both `prove-two-action-unattended-production` and
  `prove-concurrent-ready-set-admission` are done, and `production status`
  reports it ("Concurrency gate: closed — effective cap 1").
  `admit-ready-set-across-repositories` depends on the proof and on Decision
  0070's host settler.
- **Same-repository concurrency (Decision 0066)** still waits until
  `prove-two-action-unattended-production` and the #549-class fixes have
  landed (#505 and #507 landed with `harden-agent-ask-settlement-races-and-state`).

---

## Live state at derivation

| Signal | Reading (2026-09-27 ~05:05Z) |
| --- | --- |
| Managed production | **Active · No admitted work.** Revision 20, epoch 15, granted 2026-09-26T19:46Z. Scope: `two-action-rehearsal-v3`, provider `claude-code-cli`, concurrency 1, transitions acceptance, pointer and validation (no `packet_approval`). Integration grant: Decision 0058, expires 2026-09-27T07:44Z. |
| Waiting on the operator | `two-action-rehearsal-v3/write-marker-a` `build_packet_approval_pending` (`review_8029859d4b744913ad`), and the unrelated `private-practice-now/calibrate-river-specialty-prompt-chain` `planning_required`. |
| Worker | Running (PID 3222). No `Launched Session` line since 2026-09-26T05:34Z. Board reconciliation fails every tick on a missing `read:project` scope. |
| Worker-launched Sessions, ever | **One:** `session_f3fce839e9a74ef1bc`, v2 `write-marker-a`, opencode, reconciled `incomplete_resumable` 54 seconds after launch. No Claude Session has ever been launched by the worker. |
| Rehearsal fixtures | v2, v3 and v4 all declare `node --test tests/marker.test.mjs` (defect 3). v4 was prepared 2026-09-26T21:20Z; its A approval `review_686ba07c6f5c49479c` is open. |
| Pointer (`PROJECT.md` at `f670910d`) | `bootstrap-managed-production-to-build-flight-deck` / `rewire-dependents-on-split`. The live queue's selected Action is `fix-action-intent-target-ref-amendments`. |
| Open Decisions | 0041, 0052. Neither concerns production readiness. Decision 0072 is approved ("Delegate packet approval inside the grant scope"). |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 124 (each `- id:` paired with the `status:` line that follows it) |
| Done | 89 |
| Open | 34 |
| Deferred | 1 (`prove-two-action-unattended-production`) |
| **Rehearsal-stopping defects found by the replay** | **6.** Four fixed here, plus the codex launch; one is a fixture change; Claude's launch (#727) waits for a Claude rehearsal. |
| **On the critical path, code, Lane A** | **0** in the Plan, plus this PR |
| **On the critical path, operator** | **1** (deactivate v3, prepare the `-v5` codex fixture, start the rehearsal) |
| **On the critical path, proof, Lane A** | **1** (`prove-two-action-unattended-production`) |
| **Ready now, Lane B** | **6** |

---

## Refreshing this document

Run these, then update the findings, gates, critical path and scoreboard:

```bash
grep -E "^(active_plan|current_action):" PROJECT.md   # is the bootstrap Plan still active?
mise exec -- pnpm arcadia advance queue --json         # ready set: only critical-path Actions?
mise exec -- pnpm arcadia production status
grep -l "^status: open" docs/decisions/*.md
tail -80 MISSION_LOG.md
grep -E "Launched Session|Reconciled Session|Recovered hung worker|Escalated" <workspace>/.arcadia/worker.log | tail -30
gh issue list --label bug --state open
# The hermetic rehearsal replay, with real Seatbelt preservation validation.
# sandbox-exec will not nest inside another Seatbelt sandbox, so run it from a
# plain terminal (CI runs it without the flag, on an unsandboxed validator):
ARCADIA_PRESERVATION_HOST_TEST=1 mise exec -- pnpm exec vitest run tests/rehearsal-two-action.test.ts
```

**Run the replay before every live rehearsal**, and add a scenario for every
live failure it did not predict. A live failure the replay could have caught
is a missing scenario, and adding it is part of the fix.

**Check the active Plan first, then read the worker log, not only the Plan.**
Count Actions by pairing each `- id:` with the `status:` line that follows it.
A whole-file `status:` grep overcounts, because acceptance-criteria text quotes
status values.

An Action's truth is its `status:` in the Plan. A gate's truth is whether the
live system does what the gate says. **Refresh this document whenever a
critical-path Action completes, a live run happens, a Plan is activated, or a
new blocker is found.**
