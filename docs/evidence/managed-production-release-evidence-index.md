# Managed production release evidence index

Contract 20 (`docs/plans/mission-control-view/20-production-quality-and-reliability.md`)
requires one index mapping every required invariant and quality gate to
pass/fail/unproven, revision, artifact, and reproduction procedure. This is that
index. **Missing live evidence stays `unproven`; any `fail` or `unproven` row
blocks unattended Flight Deck handoff.**

Revision: the Stage 1 rows for completion/pointer, process health, and
runtime, and the missing-artifact quality gate, were proven at commit
`32b20d7d` on base `0b2246c4`, on 2026-09-23, by
`prove-fault-matrix-remaining-boundaries`. The remaining Stage 1 rows
(admission/launch, Off, capacity, priority/authority) and their negative-case
table were re-observed at the same revision as part of that Action's own
regression run (`tests/production-fault-matrix.test.ts` unchanged, rerun
clean). The prior observation (`3cd8586d` on base `764411b8`, 2026-09-22) was
invalidated by #527 and #540, which changed the covered policy and
claim-store code. A `pass` is invalidated by any later change to the code it
covers — rerun its reproduction on the release revision.

Status: **not releasable.** Stage 1 is fully proven. The false-agent-completion
quality gate and Stages 2–4 and 6 remain unproven, because each needs a live
run, an operator action, or a governance decision assigning an owner.

## Stage 1 — deterministic race matrix (contract 20 table)

Reproduce any row:

```sh
ARCADIA_FAULT_MATRIX_EVIDENCE_DIR=${TMPDIR:-/tmp}/fault-matrix \
  mise exec -- npx vitest run tests/production-fault-matrix*.test.ts
```

Each of the four files under that glob is independently runnable (e.g.
`vitest run tests/production-fault-matrix-completion.test.ts` for just the
completion/pointer row) and each writes its own `summary-<scenario>.json` /
`violation-<scenario>-<seed>.json` into the evidence directory.

Every scenario runs 100 seeds; steps per seed and the exact harness shape vary
by boundary (60 for the four in `production-fault-matrix.test.ts`; 24, 50, and
seed-scoped single-run for completion/pointer, process health, and runtime
respectively — each file's own doc comment says why). Where two workers are
part of the scenario they use separate SQLite connections against one real
workspace database, or, for completion/pointer, one shared Git repository.
Operations are the real store calls, so interleavings happen at transaction
granularity. A violation writes `violation-<scenario>-<seed>.json` (seed plus
full timeline) to the evidence directory. Passing runs write
`summary-<scenario>.json`.

| Boundary | Status | Seeds / violations | Evidence | What is and is not covered |
| --- | --- | --- | --- | --- |
| Admission and launch | **pass** (store layer) | 100 / 0 (289 admitted, 76 committed) | `tests/production-fault-matrix.test.ts` `admission-launch`; `tests/session-launch.test.ts` lost-response, pre-/post-spawn crash, lease race | Covered: two workers, repeated requests, lost-response replay, and crash before or after commit. No two live executions of one Action, no duplicate request rows, concurrency never exceeded. Not covered: the git worktree and tmux spawn inside a single seeded run (the session-launch tests prove those one fault at a time). |
| Completion and pointer | **pass** | 100 / 0 (each seed: propose/settle/retry/race/advance-head over 24 steps) | `tests/production-fault-matrix-completion.test.ts` `completion-pointer`; `tests/session-reconciliation.test.ts` (single-transaction receipt), `tests/candidate-preservation.test.ts` (crash after commit / push) | Covered: two workers interleaving `settleAgentAsk`'s `complete` intent (evidence → document write → commit → queue projection → receipt) with crash injection at all three `AgentAskSettlementTestHooks` points, a `beforeDocumentWrite` race landing a second worker's completion of a different Action inside the first worker's write window, idempotent retry, and a stale-candidate-revision refusal from an interleaved commit. Found and fixed: `current_action` can point at an Action a concurrent completion just finished (the pointer target is resolved once and pinned before `beforeDocumentWrite` by design, never re-derived); the invariant now verifies `resolveDispatch`'s documented safety net (refuse a done pointer, never redispatch it) holds instead of asserting the pointer is never momentarily stale. Not covered: `preserveCandidate`/`reconcileSessionExit`'s own session/tmux pipeline interleaved with completion — those keep their single-fault coverage in the tests named above; full-disk/write-failure injection during the Git commit itself is not built. |
| Off | **pass** (store layer) | 100 / 0 (206 fenced) | `off` scenario | Off racing claim and commit, stale workers, and reactivation all covered: no commit while Inactive or across an epoch, no issued admission survives Off. Not covered: slow provider or blocked execution during Off, and the 2 s acknowledgement target measured on the recorded host. |
| Process health | **pass** | 100 / 0 (each seed: 3 sessions × 50 steps) | `tests/production-fault-matrix-process-health.test.ts` `process-health`; `tests/worker-tick.test.ts` (hung *worker* recovery, Issue #485) | Covered: `observeSessionActivity` interleaved across two workers and three sessions in the exact `writeTransaction` shape `src/production/tick.ts` wraps it in — pane/run signal baseline, progress, no-progress stall flagging, recovery, tmux-capture-failure isolation (null and throwing), and a crash injected between the stall flag write and its event insert, proving that transaction's atomicity and that a retry afterward commits both cleanly. A hung *agent Session* is `detect-hung-managed-production-sessions` (PR #527, merged); this scenario proves the store function it added. Not covered: full-disk/write-failure injection (no `fs` dependency-injection seam exists on this path today) and the dead-tmux → `reconcileSessionExit` branch, which is the completion/pointer boundary's concern. |
| Capacity | **pass** (store layer) | 100 / 0 | `capacity` scenario; `tests/provider-capacity-admission.test.ts` | Covered: unknown, refused, and mismatched-provider observations never admit, and fresh capacity resumes admission. Capacity is simulated here; real provider exhaustion and reset is a Stage 3 row. |
| Priority and authority | **pass** (store layer) | 100 / 0 (257 fenced) | `priority-authority` scenario | Covered: a rescope or reorder during in-flight work fences stale admissions by epoch, and nothing is admitted outside scope or on an unpermitted provider. Not covered: a changed packet or base, or an unaccepted dependency (the session-launch preview tests prove these one case at a time). |
| Runtime | **pass** | 100 / 0 (failure injected at one of 7 steps, or none, per seed) | `tests/production-fault-matrix-runtime.test.ts` `runtime`; `tests/runtime-pinning.test.ts` (worker restarts only on crash) | Covered: `runWorktreeRuntimeProbe` (the candidate-build host probe `arcadia go-broker install` runs) with seeded failure injection at each of its 7 `run()`-driven steps — including `candidate-build` itself — verifying the thrown error names the right step and that `retireCandidate()`'s cleanup always runs, including when cleanup itself fails. This boundary does not fit the two-SQLite-worker transaction model the other scenarios use (no database, no concurrent callers); the file documents why. Not covered: `candidate-root-write`/`source-write` (plain `fs` writes, not through the injectable seam) and `validateExistingRelease`/`inspectInstalledBroker` manifest/schema-mismatch checks, which are module-private to `goBrokerInstall.ts` and remain covered only via `tests/go-broker-agent-setup.test.ts`. |

The three previously-unproven Stage 1 rows above (completion/pointer, process
health, runtime) and the missing-artifact quality gate below were closed by
`prove-fault-matrix-remaining-boundaries`. The false-agent-completion quality
gate is still unproven and has no owning Action: its assignment is a
governance change to another Action's settled acceptance criteria, not a
hand-edit here. Until an Action closes it, its `unproven` status below is what
keeps it blocking unattended handoff.

### The harness rejects real defects (negative cases)

Each guard below was disabled in turn in `src/production/policy.ts`, the matrix
was rerun, and the guard was restored. Re-verified at `2332be48` on 2026-09-23:
each row failed at the same named seed recorded here, and the equivalent-mutant
row still passed the whole matrix.

| Injected defect | Caught by |
| --- | --- |
| `commitAdmission` ignores the epoch | `off` seed 10, `priority-authority` seed 6 |
| `deactivateProduction` does not fence issued admissions | `off` seed 1, `priority-authority` seed 1 |
| `issueAdmission` skips the capacity check | `capacity` seed 1 |
| `issueAdmission` skips the concurrency limit | all four scenarios, seed 1 |
| `commitAdmission` ignores Inactive | **not caught — equivalent mutant.** Off fences every issued row in the same transaction, so no interleaving reaches this check while Inactive. It is defense in depth, and the "Off left issued admissions" invariant catches the combined defect. |

## Quality gate negative cases (contract 20, "Excellent output")

| Required rejection | Status | Evidence |
| --- | --- | --- |
| Deliberately failing criterion | pass | `tests/agent-ask-complete.test.ts` "refuses completion evidence that does not mark every criterion met" |
| Skipped required check | pass | same file, "refuses evidence that skips a declared criterion" |
| Stale commit evidence | pass | same file, "refuses a stale Candidate revision"; `tests/session-reconciliation.test.ts` stale candidate revision |
| Unresolved blocking review | pass | same file, "refuses completion while a required review Decision is unresolved" |
| Missing artifact | pass | `tests/agent-ask-complete.test.ts` "refuses completion when the declared expected Artifact was not produced" / "accepts completion when the declared expected Artifact (a real path) exists" / "does not refuse completion when the declared expected Artifact is prose, not a path". `expected_artifact` is checked only when it reads as a repo-relative path (contains `/` or a file extension, no spaces) — most Plans use prose ("First proof") there, which is never checked. |
| False agent completion claim | **unproven** | Completion requires verbatim per-criterion `met` evidence and a matching candidate revision, but no test or live artifact yet shows a *false* `met` being rejected. |

## Stages 2–6 — live evidence

| Stage | Status | Blocked on |
| --- | --- | --- |
| 2. Two-dependent-Action rehearsal from one activation | **unproven** | `prove-two-action-unattended-production` (deferred). |
| 3. Both providers complete real bounded Actions; real vs simulated capacity named | **unproven** | `prove-multi-provider-production-recovery`, plus provider capacity. |
| 4. Bounded real soak (≥10 Actions, 2 Projects, both providers, 2 restarts, Off/reactivate, 1 injected failure) | **unproven** | Contract 20 requires the operator to grant the soak's exact scope and capacity authority first. |
| 5. This index | **present** | Refresh on every proof. |
| 6. Operator exercises status/Off and recovery on the pinned runtime | **unproven** | Operator action after stages 1–4. |
