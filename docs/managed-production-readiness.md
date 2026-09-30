# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

This is a *derived* document, not a source of authority. Its inputs are
`PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
the relevant Decisions and Mission Log entries, the live worker/workspace
state, `arcadia advance queue`, `arcadia production status`, and the hermetic
rehearsal replay (`tests/rehearsal-two-action.test.ts`). If one of those
disagrees with this document, it is right and this document is stale.

Last derived: **2026-09-30T19:56Z**, against `origin/main`
`4eeac8f2a605e87f81ec7a310dc5ae2ef445d589`.

---

## Executive summary

Arcadia has evidence that the earlier codex-cli v5 rehearsal ran two dependent
Actions unattended; Decision 0057 was reopened on that basis. That is not yet
the complete live proof. The remaining proof stages are deliberately separate:

1. one Action must resume across two managed Sessions in the same candidate;
2. an already-admitted dependent Action must survive an observed Off and worker
   restart without a later admission, duplicate, or reactivation; and
3. the resulting live receipts, Session identities, fixture history, and
   operator interventions must be retained as the proof evidence.

Production is currently **Inactive · Idle**. No live rehearsal is running and
no live authority is implied by this document. The v6 preparation and bounded
Grant actions are available on `/runs`, but neither has been pressed or run;
there is no v6 fixture receipt, active v6 policy, Session, or proof result to
claim.

The short path is therefore operational rather than another implementation
project: use the reviewed v6 procedure when the operator is ready, preserve
the evidence, and assess the proof honestly. The current implementation Action
`close-ask-traceability-and-cli-portability-gaps` is separately open in a
candidate; its scope amendment was operator-settled and published, but it is
not complete and does not count as production-proof evidence.

---

## Evidence that changed this derivation

| Evidence | What it establishes | What it does **not** establish |
| --- | --- | --- |
| Decision 0057, reopened 2026-09-29 | The codex-cli v5 rehearsal ran its two Actions end to end unattended, both reconciled `accepted_completion`. | The split-session, Off, and restart stages. |
| PR #820 | The reviewed, versioned v6 prepare action, one-shot bounded Grant, and `morning-runbook.md` are on main. | That preparation, activation, a fixture, a Session, Off, or restart has happened. |
| PR #825 | The auto-settle eligibility documentation now states the actual candidate/evidence constraints. | Any new live completion. |
| PRs #827–#829 and #832 | `/runs` Plan-amendment settlement now uses one shared runner with fresh preview, semantic envelope checks, durable receipts, recovery, and real-workspace tests. | A production Grant or the live rehearsal. |
| Settlement `asksettle_3366f84237344e8d9d` at `4eeac8f2` | The exact traceability Action amendment was accepted and published without changing the Plan activation, pointer, or queue position. | Completion of that Action or any production transition. |

The hermetic replay remains necessary before each live rehearsal. It proves
many component and cross-stage behaviors but cannot substitute for observing a
real provider process, an actual Off/restart, or the live evidence chain.

---

## Before the remaining live rehearsal

The executable procedure is
[`artifacts/generated/operator-scripts/morning-runbook.md`](../artifacts/generated/operator-scripts/morning-runbook.md).
It is intentionally sequenced and bounded:

1. Verify the checkout is current and clean, the worker is healthy, and
   production remains Inactive.
2. Run **Prepare the v6 remaining-stages rehearsal fixture (no Grant)** from
   `/runs`; inspect its receipt and pinned inactive policy revision.
3. Review and press **Grant v6 remaining-stage rehearsal (split, Off, restart;
   24h)** once. It refuses drift and grants only the v6 fixture's two Actions,
   `codex-cli`, and effective concurrency one.
4. Observe the split Action's first Session exit incomplete after its first
   marker, then the worker resume it in the same candidate/worktree/branch.
   Preserve the concurrent-candidate refusal.
5. While the dependent Action is already admitted, turn production Off through
   the supported control and restart the worker through the supported service
   control. Leave policy Off and prove the absence of a later admission,
   duplicate, or reactivation.
6. Preserve the run directory, receipts, fixture Git history, worker-log slice,
   policy revisions/epochs, Action and Session identities, candidate paths, and
   every operator intervention. Only then settle the proof criteria that the
   evidence actually satisfies.

Do not adapt the scripts by hand when they refuse. Their failure handoff names
the safe recovery route. The Grant itself never starts a Session, turns
production Off, restarts a worker, merges, deploys, changes credentials, or
widens its scope.

---

## Gates

| Gate | Current state |
| --- | --- |
| 1 — The board is the surface | ✅ Previously closed; this derivation did not re-run board reconciliation. |
| 2 — Work reaches an agent with no operator | 🟡 Demonstrated by the earlier v5 codex-cli rehearsal; the remaining split-session observation is still live-proof work. |
| 3 — A finished Session lands with no operator | 🟡 Demonstrated in the earlier v5 path and hermetic replay; the resumed-session path remains to be observed live. |
| 4 — It keeps going without help | 🟡 The v5 dependent transition is evidence, but Off/restart behavior under an already-admitted Session remains unproven live. |
| 5 — Proof | ⬜ `prove-two-action-unattended-production` is open and is the current governed pointer. The v6 procedure is prepared, not performed. |
| 6 — The operator surface | 🟡 `/runs` exposes bounded prepare and Grant actions, but the live operator procedure and its evidence have not been completed. |
| B — Cross-repository concurrency | ⬜ Admission remains capped at one while either named proof Action is open, unless an unexpired rehearsal exception names `prove-concurrent-ready-set-admission`; that exception raises the cap to the configured maximum. The v6 Grant still uses concurrency one and cannot lift the gate. |
| B′ — Same-repository pipelining | ⬜ Still follows the single-repository proof and the cross-repository gate. |

A gate closes only when the live system does what it says. A passing replay,
an available script, a drafted fixture, or an unpressed Grant is not closure.

---

## Live state at derivation

| Signal | Reading at 2026-09-30T19:56Z |
| --- | --- |
| Managed production | **Inactive · Idle.** Desired state `inactive`; revision **23**; epoch **16**; revoked **2026-09-30T06:03Z**. |
| v3 approval | Still requires an operator, but is fenced by `production_off`; it cannot create a live launch while policy is inactive. |
| Current Plan pointer | `bootstrap-managed-production-to-build-flight-deck` / `prove-two-action-unattended-production`. |
| Current proof Action | `open`, `agent`, and `clarified`; it requires the live split-session and Off/restart stages described above. |
| v6 fixture and Grant | Scripts/descriptors and runbook are present on main. Neither prepare nor Grant has run, so there is no prepared fixture or active v6 authorization. |
| Traceability Action | `close-ask-traceability-and-cli-portability-gaps` remains open in an isolated candidate. Its exact scope amendment is published at `4eeac8f2`; no completion is claimed. |

---

## Scoreboard

| Measure | Count / state |
| --- | --- |
| Actions in the active Plan | 147 |
| Done | 113 |
| Open | 34 |
| Remaining live proof Action at the governed pointer | 1 — `prove-two-action-unattended-production` |
| Prepared-but-unexecuted v6 operator actions | 2 — repeatable prepare and one-shot Grant |
| Active live v6 policy / v6 Sessions | 0 / 0 |
| Effective admission concurrency before both named proofs close | 1 |

---

## Refreshing this document

Run these read-only checks, then revise the executive summary, gates, critical
path, live-state table, and scoreboard from their results:

```bash
grep -E "^(active_plan|current_action):" PROJECT.md
active_plan="$(grep "^active_plan:" PROJECT.md | head -1 | cut -d " " -f2)"
sed -n "1,220p" "docs/plans/${active_plan}.md"
mise exec -- pnpm arcadia advance queue --json --workspace <arcadia-workspace>
mise exec -- pnpm arcadia production status --workspace <arcadia-workspace>
grep -l "^status: open" docs/decisions/*.md
tail -80 MISSION_LOG.md
grep -E "Launched Session|Reconciled Session|Recovered hung worker|Escalated" <workspace>/.arcadia/worker.log | tail -30
gh issue list --label bug --state open
# Run from a plain terminal because Seatbelt cannot nest.
ARCADIA_PRESERVATION_HOST_TEST=1 mise exec -- pnpm exec vitest run tests/rehearsal-two-action.test.ts
```

Run the replay before every live rehearsal and add a scenario for every live
failure it could have predicted. Count Plan Actions by pairing each top-level
`- id:` with its following `status:`; do not grep every `status:` string in the
file. Refresh this document whenever a critical-path Action completes, a live
run happens, a Plan is activated, a Grant changes policy, or a new blocker is
found.
