# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document. It asserts nothing on its own — every line is a
reading of `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, `MISSION_LOG.md`, and the live `arcadia schedule status` /
`arcadia production status` / `arcadia production capacity` output. When those
disagree with this file, they are right and this file is stale. "Refreshing
this document" at the bottom says how to re-derive it in about a minute.

Last derived: **2026-09-22**, re-derived while completing
`self-heal-hung-worker-heartbeat`, which closes the worker-hang defect this
document filed as Issue #485. The earlier derivation the same day covered
`formalize-two-phase-planning-process`,
`refresh-managed-production-readiness-2026-09-22`, the Decision 0064 fix to
`prove-zero-prompt-production-loop`'s wrongful dispatch to coding agents
(PR #481), and `substitute-unavailable-provider-before-binding` (PR #482,
landed *while that document was being written* — proof of the concurrency this
document has to account for, not just describe).

---

## Executive summary

**The board half is done, Gate 2 is closed, and the worker can no longer hang
un-owned. The most consequential open question is back to the one this Plan was
written around: can a finished Session land without an operator?**

GitHub Projects is the live surface (Gate 1, unchanged since 2026-09-20).
Since the last derivation, **Gate 2 fully closed**: the three Actions blocking
"work reaches an agent with no operator" (`verify-worker-recovery-before-success`,
`fix-packet-lifecycle-latest-planning-decision`,
`translate-reasoning-effort-at-launch`) are all `done`. That is real, verified
progress, not a projection.

The previous derivation found a **more fundamental defect the old critical path
never named**: the worker daemon could hang — silently stop refreshing its own
heartbeat — and not self-heal. `arcadia worker start` reported "already running"
against a hung process, `arcadia worker stop` sent a SIGTERM the hung process
ignored, and only `kill -9` followed by launchd's respawn recovered it (Issue
#485). **That is now fixed, not deferred.**
`self-heal-hung-worker-heartbeat` is `done`: `arcadia worker status` classifies
an alive process with a heartbeat past the shared 15s freshness window as
unhealthy; `arcadia worker start` terminates that process — SIGTERM, then
SIGKILL — and takes ownership itself, refusing to signal any PID whose command
line does not identify this workspace's own worker; and `arcadia worker stop`
escalates the same way instead of reporting success over a process it never
stopped. What is *not* fixed, and is deliberately out of scope, is why the
original process accumulated 159 minutes of CPU time and ignored SIGTERM — see
"The worker-hang defect" below for the standing trigger that reopens it.

**`prove-zero-prompt-production-loop` is no longer a dispatch hazard**, but it
is also not proven. Two separate things happened to it this session:

1. **Governance fix (done):** it was being dispatched to coding-agent sessions
   although its own runbook forbids that — an agent stepping around the
   `go`-launcher sandbox boundary would invalidate the very proof under test
   (Issue #453). PR #481 widened `agent-ask settle --responsibility` to accept
   `requires_review`, and this session reclassified the Action to it. Confirmed
   live: `arcadia next` no longer resolves it as agent-dispatchable.
2. **Real progress, still incomplete:** on 2026-09-21, the rehearsal's **Action
   A actually succeeded** in the operator's own terminal with the `opencode`
   provider — `opencode exit 0`, zero permission-denial lines, the marker
   file correct, branch pushed, fixture PR open (`MISSION_LOG.md`,
   2026-09-21). What's still missing to finish the full two-action loop is
   narrow and named: **Issue #460** — `go-broker` without `--launch` creates
   no Session record, so `session reconcile` has nothing to reconcile. The
   fixture's PR #2 (in `pmark/arcadia-zero-prompt-rehearsal`) is also still
   open/unmerged.

**Distance: 11 filed Actions — 10 open plus the 1 deferred proof — out of the
Plan's 24 unfinished Actions, plus 2 operator steps.** Of the 11 filed Actions:
**6 are ordinary code sessions**, all ready today with no blocking dependency,
and **5 are proof or hardening runs** (4 open, 1 deferred) that cost provider
capacity rather than code. The other 13 unfinished Actions are real work, but
the unattended claim does not depend on them; "What is *not* on the critical
path" below names them.

Everything here counts individual Action ids, never grouped work items.

**The nearest milestone is still the preflight, not the unattended claim
itself.** `prove-zero-prompt-production-loop` proves the chain end to end
with *no permission relay* — assisted, not fully unattended, and its own
acceptance criteria say so.

**The unattended claim belongs to `prove-two-action-unattended-production`**
— two dependent Actions from one activation with no operator step between
them — and nothing before it in this document should be read as making that
claim.

---

## The gates

Six gates, in dependency order. A gate is closed until every line under it is
checked.

### Gate 1 — The board is the surface ✅ **closed**

Unchanged since 2026-09-20. See the prior derivation or
[`docs/github-board-guide.md`](github-board-guide.md) /
[`docs/production-scheduling.md`](production-scheduling.md).

### Gate 2 — Work reaches an agent with no operator ✅ **closed, 2026-09-22**

| | Action | State |
| --- | --- | --- |
| ✅ | `gate-prepared-dispatch-on-transport-readiness` | Done (PR #438). |
| ✅ | `verify-worker-recovery-before-success` | **Done.** Was the pointer at last derivation. |
| ✅ | `fix-packet-lifecycle-latest-planning-decision` | **Done.** |
| ✅ | `translate-reasoning-effort-at-launch` | **Done.** |
| ✅ | `fix-accepted-plan-to-build-packet-path` | Done. |
| ✅ | `deliver-session-brief` | Done. |
| ✅ | `add-opencode-production-provider` | Done. |

**The worker-hang defect is no longer a Gate 2 finding.** It is a governed,
completed Action — `self-heal-hung-worker-heartbeat`, filed from Agent Ask
`file-worker-heartbeat-recovery-2026-09-22` and closed in this derivation. It
was never a Gate 2 Action; it is listed here only because it was found next to
Gate 2. See "The worker-hang defect" below for what shipped and what remains
open.

### Gate 3 — A finished Session lands with no operator ⬜ **open — 3 Actions, all now dependency-clear**

| | Item | Why it blocks |
| --- | --- | --- |
| ✅ | **Decision 0058** — delegate bounded candidate integration? | Approved (R212, 2026-09-19). `preserve-on-exit-and-integrate` has its authority. |
| ⬜ | `preserve-on-exit-and-integrate` | Ready, no open prerequisites. It was the dispatch pointer two derivations ago; `self-heal-hung-worker-heartbeat` then held the pointer and completed, advancing it to `surface-batch-readiness-view` on queue order rather than on this list's ranking. Without this Action every Action needs one operator merge before the next dependent Action can start — the difference between "assisted" and "unattended." |
| ⬜ | `bind-candidate-revision-in-action-settle` | No dependencies; ready. `action settle` derives the wrong revision, so the documented candidate-worktree completion path fails. |
| ✅ | `approval-must-apply-or-refuse` | Done (PR #447). |
| ⬜ | `apply-answered-decision-consequences` | No dependencies; ready. An answered Decision does not move the Action it governs, so answering one changes nothing until a human acts on it. |
| ⬜ | `auto-settle-pending-completions-before-dispatch` | Not blocking; off the critical path (see below). |

### Gate 4 — It keeps going without help ⬜ **open — 2 Actions on the critical path, both now dependency-clear**

| | Action | Why it matters |
| --- | --- | --- |
| ⬜ | `make-go-total-across-plans` | Its dependency (`isolate-agent-asks-from-production-handoff`) is `done`; ready. When the active Plan finishes, Go stops instead of activating the next Plan. |
| ⬜ | `detect-hung-managed-production-sessions` | Its dependency (`feed-and-supervise-managed-production`) is `done`; ready. The worker notices a dead tmux, not a live tmux making no progress. **This covers a hung agent Session, not a hung worker daemon — the hung-worker gap it used to be confused with is now closed by `self-heal-hung-worker-heartbeat`.** |
| ⬜ | `divide-instead-of-stall` | Not blocking; off the critical path. |
| ⬜ | `triage-decisions-before-opening` | Not blocking; off the critical path. |
| ⬜ | `cut-managed-production-tick-cost` | Not blocking; off the critical path. |

### Gate 5 — Proof ⬜ **open — 5 Actions, all on the critical path, provider capacity required**

Nothing here is code. These are live runs that either happen or do not.

| | Action | Scope |
| --- | --- | --- |
| ⬜ | `prove-zero-prompt-production-loop` | **Reclassified `requires_review` this session (Decision 0064) — no longer a dispatch hazard.** Action A succeeded live on 2026-09-21 with `opencode`. Remaining gap: Issue #460 (no Session record without `--launch`, so `session reconcile` has nothing to reconcile), plus the fixture's own unmerged PR #2. Still an operator-terminal run, by design. |
| 🟡 | `prove-two-action-unattended-production` | `status: deferred`. **This is where the unattended claim is actually earned.** Blocks three other Actions while deferred (see "The one knot worth naming"). |
| ⬜ | `prove-multi-provider-production-recovery` | Continuous production across providers and capacity exhaustion. |
| ⬜ | `prove-managed-production-fault-matrix` | The contract-20 fault-injection matrix before any unattended handoff. |
| ⬜ | `harden-zero-prompt-production-loop` | Only after the happy path runs clean twice. |

### Gate 6 — The operator surface ⬜ **open — unchanged since 2026-09-20**

| | Action | State |
| --- | --- | --- |
| ⬜ | `surface-terminal-operator-approvals-in-runs` | Still needed. |
| ⬜ | `expose-bootstrap-production-controls` | Still needed, workload-neutral. |
| 🔶 | `freeze-production-runtime-and-handoff-flight-deck` | First real production workload still undecided; blocked behind the deferred proof regardless. |

---

## The worker-hang defect (Issue #485) — symptom closed, cause open

Discovered 2026-09-22 while preserving an unrelated Action's candidate:
`arcadia-preserve-broker-claude` refused with a stale heartbeat error.
`arcadia worker status` reported the launchd-managed process unhealthy — alive,
but not refreshing its heartbeat, after accumulating 159 minutes of CPU time
(consistent with a hang or busy-loop, not a clean idle daemon). `arcadia worker
start` refused to help ("already running"); `arcadia worker stop`'s SIGTERM was
ignored. Only `kill -9` plus launchd's automatic respawn recovered it. Filed as
Issue #485.

**What shipped.** `self-heal-hung-worker-heartbeat` is `done`. The stale
threshold is now one exported constant shared with the preservation transport,
so `arcadia worker status` and `arcadia-preserve-broker-*` can never disagree
about the same process:

- `arcadia worker status` classifies a live PID whose heartbeat is past the 15s
  window as `unhealthy`, and names the heartbeat's age against the limit.
- `arcadia worker start` classifies the same state as `recover` rather than
  `already-running`, terminates that process (SIGTERM, bounded grace, then
  SIGKILL), and takes ownership itself. A hung process never exits, so no
  respawn would otherwise ever reach this code — this is the step that makes the
  failure self-healing.
- `arcadia worker stop` escalates identically, instead of reporting a SIGTERM it
  cannot know was honoured. It re-reads the record after the grace period and
  refuses to escalate if the worker refreshed its heartbeat or handed the
  workspace on in the meantime; a worker whose heartbeat is *still fresh* keeps
  the ordinary SIGTERM and is reported as mid-tick, because a long tick is not a
  hang.
- The worker re-stamps its **own** record from the same between-Projects point
  that already re-stamps the preservation projection, so a long
  managed-production tick no longer ages a healthy worker's heartbeat past the
  limit — which would otherwise make `start` replace a worker that was merely
  busy.
- Before signalling anything, both callers read the PID's command line and
  refuse unless it names this workspace explicitly on an Arcadia CLI
  `worker start` invocation. A pidfile outlives a worker killed with SIGKILL,
  and the kernel may reuse that PID; a refusal names the PID, the pidfile, and
  the exact remedy rather than killing a stranger. A default-workspace
  invocation names no path and is refused, which costs nothing unattended: the
  launch agent always passes `--workspace`.

**Why it mattered enough to rank at the top of this document:** every gate above
assumes the worker keeps running. `detect-hung-managed-production-sessions`
(Gate 4) detects a hung *agent Session* inside a tmux the worker is watching —
it says nothing about the watcher itself hanging. That gap is now closed.

**What is deliberately still open.** Nobody has root-caused why the original
process spun for 159 minutes or ignored SIGTERM; the Action's own acceptance
criteria put that out of scope, and this document will not claim it. One
exposure also remains, and it is pre-existing rather than introduced here: a
**single** synchronous step with no boundary to re-stamp at — a long provider
launch, or a legacy `executeApprovedReview` Run — can still outlast the 15s
window, so a worker busy inside one unbroken step is indistinguishable from a
hung one. Reopen this when it is observed rather than assumed: a
`Recovered hung worker:` line that coincides with an in-flight Run.
The deferral has a named trigger: **reopen the root-cause investigation when a
second `Recovered hung worker:` line appears in `.arcadia/worker.log`**, since
one hang is now a recovered event and two are a pattern. If the recovery itself
ever fails, the non-zero exit names the stale PID, the pidfile, and the remedy,
so it fails loudly rather than silently leaving the process in place.

---

## The critical path, in order

Everything else can wait. This is the shortest honest route from here to
unattended production on the board.

1. `preserve-on-exit-and-integrate` — ready now, no dependencies
2. `bind-candidate-revision-in-action-settle` — ready now, no dependencies
3. `apply-answered-decision-consequences` — ready now, no dependencies
4. ✅ `self-heal-hung-worker-heartbeat` — **done**, closing the worker-hang
   defect (Issue #485)
5. **Operator:** resolve Issue #460 (or file the Action for it) so the
   zero-prompt rehearsal's Action B → completion can actually be attempted
6. `prove-zero-prompt-production-loop` — assisted zero-prompt preflight, not
   an unattended claim; Action A already proven live, finish the loop
7. **Operator:** un-defer `prove-two-action-unattended-production`
8. `prove-two-action-unattended-production` — the unattended claim is earned
   here
9. `make-go-total-across-plans` — ready now (dependency cleared)
10. `detect-hung-managed-production-sessions` — ready now (dependency cleared)
11. `prove-multi-provider-production-recovery`
12. `prove-managed-production-fault-matrix`
13. `harden-zero-prompt-production-loop`

**Thirteen numbered entries: 11 filed Action ids and 2 operator steps — 11
Action-shaped entries in total.**

- **Code sessions, ready today with no blocking dependency (6):** entries
  1, 2, 3, 4 (done), 9, 10. Entries 1, 2, 3, 9, and 10 are the fastest place to
  spend a session right now.
- **Needs filing first: none.** The worker-hang Action this section used to
  list as unfiled is now filed and done.
- **Proof and hardening runs (5):** entries 6, 8, 11, 12, 13 (4 open, 1
  deferred). These cost provider capacity, not code, and several are
  operator-terminal by design.
- **Yours (2):** entries 5 (or delegate it as a filed Action) and 7. Minutes
  each, once their preconditions are actually true.

### What is *not* on the critical path

Real work, none of it required before the unattended claim holds:

- `auto-settle-pending-completions-before-dispatch`, `triage-decisions-before-opening`,
  `divide-instead-of-stall`, `cut-managed-production-tick-cost` — all reduce
  friction or cost; production runs without them.
- `expose-bootstrap-production-controls`, `surface-terminal-operator-approvals-in-runs`,
  `freeze-production-runtime-and-handoff-flight-deck` — Gate 6, the operator
  surface.
- `register-agent-workspace-trust` — open, no dependencies, not on the path.
- The remaining open Actions in the Plan that are not about production at all:
  `build-autonomous-defect-loop`, `build-agent-agnostic-learning-loop`,
  `detect-duplicate-ids-and-dangling-refs`,
  `combine-advance-monitor-next-into-one-brief`,
  `reference-constitution-without-duplicating-it`, and others.

### The one knot worth naming

Unchanged since 2026-09-20. `prove-two-action-unattended-production` is
`deferred`, and three Actions declare `depends_on` it:
`expose-bootstrap-production-controls`, `prove-multi-provider-production-recovery`,
and `freeze-production-runtime-and-handoff-flight-deck`. **Decision 0057**
deferred it on 2026-09-18; its trigger is narrower than "capacity came back" —
read Decision 0057/0061 directly before assuming it has fired. The proof's own
runbook restricts the rehearsal to the operator's terminal, which is why
dispatching it to a coding agent was the defect Decision 0064 fixed this
session for the *related* Action, `prove-zero-prompt-production-loop` — the
two are easy to conflate and are not the same Action.

---

## External blockers (not code)

Re-verified 2026-09-22 via `arcadia production capacity`; re-check before
trusting further out than a session or two.

| Blocker | State | Clears by |
| --- | --- | --- |
| Provider capacity gating | All three providers (`claude-code-cli`, `codex-cli`, `opencode-cli`) report `admitted: true` — capacity gating is currently disabled by workspace config (`codingAgent.capacityGateEnabled: false`), an operator standing choice, not proof of real headroom. | Re-attest before trusting for a long unattended run; incapacity is discovered when work actually runs, not before admission. |
| opencode functional health | **Corrected from the 2026-09-20 note.** opencode is not broken: Action A of the zero-prompt rehearsal ran clean with it on 2026-09-21 (`opencode exit 0`, zero denials). The earlier "Unexpected server error" was a point-in-time condition, not a standing defect. | Already clear; keep verifying per-run since it is not standing proof. |
| The worker daemon itself | **Fixed for the symptom.** A hung worker is now detected, terminated, and replaced by `arcadia worker start`, with a loud non-zero refusal instead of a silent no-op. The root cause of the original 159-minute spin is still unexplained. | Closed by `self-heal-hung-worker-heartbeat`; reopens when a second `Recovered hung worker:` line appears in `.arcadia/worker.log`. |
| Local-only pointer commits | Settlement commits land locally and are pushed by hand. This session hit this repeatedly and pushed manually each time. | `arcadia work monitor`, then push — every session, not just at the end. |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 72 |
| Done | 48 (`self-heal-hung-worker-heartbeat` completed this derivation) |
| Open | 23 |
| Deferred | 1 |
| Unfinished (open + deferred) | 24 |
| **On the critical path (filed)** | **11** (10 open + 1 deferred) |
| **On the critical path (not yet filed)** | **0** |
| **Operator steps on the critical path** | **2** |
| Unfinished but off the critical path | 13 (24 unfinished − 11 filed on the path) |
| Open Decisions repo-wide | 2 (0041, 0052) — unrelated to production readiness: 0041 is about reactivating a guided-understanding session; 0052 is about `isolate-agent-asks-from-production-handoff`'s acceptance. Decision 0064 (production-dispatch related) is already answered. |

---

## Refreshing this document

Run these, then update the gate tables, critical path, and scoreboard:

```bash
mise exec -- pnpm arcadia schedule status --project arcadia
mise exec -- pnpm arcadia production status
mise exec -- pnpm arcadia production capacity
mise exec -- pnpm arcadia review
grep -l "^status: open" docs/decisions/*.md
mise exec -- pnpm arcadia session preview-launch   # what the current pointer is actually blocked on
tail -80 MISSION_LOG.md                            # recent completions and real-run evidence, not projection
```

An Action's truth is its `status:` in the Plan document. A gate's truth is
whether every Action under it is `done`. If you find this file claiming
something the Plan, a Decision, or `MISSION_LOG.md` does not, fix this file —
never the other way round. **Refresh this document whenever a critical-path
Action completes or a new blocker is discovered** — that is what keeps it
canonical rather than a one-time snapshot.
