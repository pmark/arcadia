# Managed production release evidence index

Contract 20 (`docs/plans/mission-control-view/20-production-quality-and-reliability.md`)
requires one index mapping every required invariant and quality gate to
pass/fail/unproven, revision, artifact, and reproduction procedure. This is that
index. **Missing live evidence stays `unproven`; any `fail` or `unproven` row
blocks unattended Flight Deck handoff.**

Revision: every `pass` below was observed at commit `3cd8586d` (tested
code; later commits on its branch change only documentation), on base
`764411b8`, on 2026-09-22. A `pass` is invalidated by any later change to the
code it covers — rerun its reproduction on the release revision.

Status: **not releasable.** Stage 1 is partly proven. Stages 2–4 and 6 are
unproven, because each one needs a live run or an operator action.

## Stage 1 — deterministic race matrix (contract 20 table)

Reproduce any row:

```sh
ARCADIA_FAULT_MATRIX_EVIDENCE_DIR=${TMPDIR:-/tmp}/fault-matrix \
  mise exec -- npx vitest run tests/production-fault-matrix.test.ts
```

Each scenario runs 100 seeds × 60 steps. Two workers use separate SQLite
connections and the operator uses a third, all against one real workspace
database. Operations are the real store calls, so interleavings happen at
transaction granularity. A violation writes
`violation-<scenario>-<seed>.json` (seed plus full timeline) to the evidence
directory. Passing runs write `summary-<scenario>.json`.

| Boundary | Status | Seeds / violations | Evidence | What is and is not covered |
| --- | --- | --- | --- | --- |
| Admission and launch | **pass** (store layer) | 100 / 0 (289 admitted, 76 committed) | `tests/production-fault-matrix.test.ts` `admission-launch`; `tests/session-launch.test.ts` lost-response, pre-/post-spawn crash, lease race | Covered: two workers, repeated requests, lost-response replay, and crash before or after commit. No two live executions of one Action, no duplicate request rows, concurrency never exceeded. Not covered: the git worktree and tmux spawn inside a single seeded run (the session-launch tests prove those one fault at a time). |
| Completion and pointer | **unproven** | — | `tests/session-reconciliation.test.ts` (single-transaction receipt), `tests/candidate-preservation.test.ts` (crash after commit / push) | Individual crash points are tested. The seeded interleaving across evidence → document write → commit → queue projection → receipt is not built. |
| Off | **pass** (store layer) | 100 / 0 (206 fenced) | `off` scenario | Off racing claim and commit, stale workers, and reactivation all covered: no commit while Inactive or across an epoch, no issued admission survives Off. Not covered: slow provider or blocked execution during Off, and the 2 s acknowledgement target measured on the recorded host. |
| Process health | **unproven** | — | `tests/worker-tick.test.ts` (hung *worker* recovery, Issue #485) | A hung *agent Session* (live tmux, no progress) is `detect-hung-managed-production-sessions`, still open. Full-disk or write-failure injection is not built. |
| Capacity | **pass** (store layer) | 100 / 0 | `capacity` scenario; `tests/provider-capacity-admission.test.ts` | Covered: unknown, refused, and mismatched-provider observations never admit, and fresh capacity resumes admission. Capacity is simulated here; real provider exhaustion and reset is a Stage 3 row. |
| Priority and authority | **pass** (store layer) | 100 / 0 (257 fenced) | `priority-authority` scenario | Covered: a rescope or reorder during in-flight work fences stale admissions by epoch, and nothing is admitted outside scope or on an unpermitted provider. Not covered: a changed packet or base, or an unaccepted dependency (the session-launch preview tests prove these one case at a time). |
| Runtime | **unproven** | — | `tests/runtime-pinning.test.ts` (worker restarts only on crash) | Candidate-build, controller-upgrade-failure, and schema-incompatibility injection are not built. |

### The harness rejects real defects (negative cases)

Each guard below was disabled in turn in `src/production/policy.ts`, the matrix
was rerun, and the guard was restored:

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
| Missing artifact | **unproven** | No test rejects a completion whose declared Artifact is absent. |
| False agent completion claim | **unproven** | Completion requires verbatim per-criterion `met` evidence and a matching candidate revision, but no test or live artifact yet shows a *false* `met` being rejected. |

## Stages 2–6 — live evidence

| Stage | Status | Blocked on |
| --- | --- | --- |
| 2. Two-dependent-Action rehearsal from one activation | **unproven** | `prove-two-action-unattended-production` (deferred). |
| 3. Both providers complete real bounded Actions; real vs simulated capacity named | **unproven** | `prove-multi-provider-production-recovery`, plus provider capacity. |
| 4. Bounded real soak (≥10 Actions, 2 Projects, both providers, 2 restarts, Off/reactivate, 1 injected failure) | **unproven** | Contract 20 requires the operator to grant the soak's exact scope and capacity authority first. |
| 5. This index | **present** | Refresh on every proof. |
| 6. Operator exercises status/Off and recovery on the pinned runtime | **unproven** | Operator action after stages 1–4. |
