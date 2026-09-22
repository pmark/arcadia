# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document. It asserts nothing on its own — every line is a
reading of `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, `MISSION_LOG.md`, and the live `arcadia schedule status` /
`arcadia production status` / `arcadia production capacity` output. When those
disagree with this file, they are right and this file is stale. "Refreshing
this document" at the bottom says how to re-derive it in about a minute.

Last derived: **2026-09-22**, after `formalize-two-phase-planning-process` and
`refresh-managed-production-readiness-2026-09-22` (this Action) landed, and
after this session fixed `prove-zero-prompt-production-loop`'s wrongful
dispatch to coding agents (Decision 0064, PR #481).

---

## Executive summary

**The board half is done. Gate 2 just closed. The single most important open
question is no longer "will an agent launch" — it's "can the worker itself
be trusted to stay alive."**

GitHub Projects is the live surface (Gate 1, unchanged since 2026-09-20).
Since the last derivation, **Gate 2 fully closed**: the three Actions blocking
"work reaches an agent with no operator" (`verify-worker-recovery-before-success`,
`fix-packet-lifecycle-latest-planning-decision`,
`translate-reasoning-effort-at-launch`) are all `done`. That is real, verified
progress, not a projection.

But this session found a **new, more fundamental defect that the old critical
path never named**: the worker daemon itself can hang — silently stop
refreshing its own heartbeat — and does not self-heal. `arcadia worker start`
reports "already running" against a hung process; `arcadia worker stop` sends
a SIGTERM the hung process ignores; only `kill -9` followed by launchd's
respawn recovered it. Filed as **Issue #485**. For the standing goal of
*indefinite* unattended production, this is the most consequential open item
in this document: every other gate assumes a worker that stays up, and right
now that assumption needs a human's `kill -9` to hold.

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

**Distance: 10 filed Actions — 9 open plus the 1 deferred proof — plus one
not-yet-filed Action for the worker-hang defect (#485), out of the Plan's 25
unfinished Actions, plus 2 operator steps.** Of the 10 filed Actions: **5 are
ordinary code sessions**, all ready today with no blocking dependency, and
**5 are proof or hardening runs** (4 open, 1 deferred) that cost provider
capacity rather than code. The other 15 unfinished Actions are real work, but
the unattended claim does not depend on them; "What is *not* on the critical
path" below names
them.

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

**New finding, not a Gate 2 Action but adjacent to it:** the worker daemon
can hang and not self-heal (Issue #485, filed 2026-09-22). It is not listed
as a gate item because no existing Action owns it — see "The worker-hang
defect" below.

### Gate 3 — A finished Session lands with no operator ⬜ **open — 3 Actions, all now dependency-clear**

| | Item | Why it blocks |
| --- | --- | --- |
| ✅ | **Decision 0058** — delegate bounded candidate integration? | Approved (R212, 2026-09-19). `preserve-on-exit-and-integrate` has its authority. |
| ⬜ | `preserve-on-exit-and-integrate` | Its only dependency (`deliver-session-brief`) is now `done`, so it is ready to start. Without it, every Action needs one operator merge before the next dependent Action can start — the difference between "assisted" and "unattended." |
| ⬜ | `bind-candidate-revision-in-action-settle` | No dependencies; ready. `action settle` derives the wrong revision, so the documented candidate-worktree completion path fails. |
| ✅ | `approval-must-apply-or-refuse` | Done (PR #447). |
| ⬜ | `apply-answered-decision-consequences` | No dependencies; ready. An answered Decision does not move the Action it governs, so answering one changes nothing until a human acts on it. |
| ⬜ | `auto-settle-pending-completions-before-dispatch` | Not blocking; off the critical path (see below). |

### Gate 4 — It keeps going without help ⬜ **open — 2 Actions on the critical path, both now dependency-clear**

| | Action | Why it matters |
| --- | --- | --- |
| ⬜ | `make-go-total-across-plans` | Its dependency (`isolate-agent-asks-from-production-handoff`) is `done`; ready. When the active Plan finishes, Go stops instead of activating the next Plan. |
| ⬜ | `detect-hung-managed-production-sessions` | Its dependency (`feed-and-supervise-managed-production`) is `done`; ready. The worker notices a dead tmux, not a live tmux making no progress. **This covers a hung agent Session, not a hung worker daemon — Issue #485 is a distinct, currently unowned gap.** |
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

## The worker-hang defect (Issue #485)

Discovered live in this session, 2026-09-22, while preserving an unrelated
Action's candidate: `arcadia-preserve-broker-claude` refused with a stale
heartbeat error. `arcadia worker status` reported the launchd-managed process
unhealthy — alive, but not refreshing its heartbeat, after accumulating 159
minutes of CPU time (consistent with a hang or busy-loop, not a clean idle
daemon). `arcadia worker start` refused to help ("already running"); `arcadia
worker stop`'s SIGTERM was ignored. Only `kill -9` plus launchd's automatic
respawn recovered it.

**Why this belongs at the top of this document, not buried in a gate table:**
every gate above assumes the worker keeps running. `detect-hung-managed-production-sessions`
(Gate 4) detects a hung *agent Session* inside a tmux the worker is watching —
it says nothing about the watcher itself hanging. Nothing in the current Plan
owns "the worker can hang and cannot restart itself." Until something does,
*indefinite* unattended production has a human-shaped single point of
failure baked in, no matter how many of the other gates close.

No Action exists for this yet. It needs one — sized to at minimum make
`arcadia worker start`/`status` treat a stale heartbeat as "needs restart"
rather than "already running," and ideally to root-cause why the process
hung and ignored SIGTERM in the first place.

---

## The critical path, in order

Everything else can wait. This is the shortest honest route from here to
unattended production on the board.

1. `preserve-on-exit-and-integrate` — ready now (dependency cleared)
2. `bind-candidate-revision-in-action-settle` — ready now, no dependencies
3. `apply-answered-decision-consequences` — ready now, no dependencies
4. *(new, unfiled)* an Action for the worker-hang defect (Issue #485) — sizing
   and filing this is itself the next concrete step
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

**Thirteen numbered entries: 10 filed Action ids, 1 not-yet-filed Action, and
2 operator steps — 11 Action-shaped entries in total.**

- **Code sessions, ready today with no blocking dependency (5):** entries
  1, 2, 3, 9, 10 — all five have zero open prerequisites as of this
  derivation. This is the fastest place to spend a session right now.
- **Needs filing first (1):** entry 4, the worker-hang Action.
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
| The worker daemon itself | Can hang silently; see "The worker-hang defect" above. | Issue #485; no Action owns the fix yet. |
| Local-only pointer commits | Settlement commits land locally and are pushed by hand. This session hit this repeatedly and pushed manually each time. | `arcadia work monitor`, then push — every session, not just at the end. |

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 70 |
| Done | 45 |
| Open | 24 |
| Deferred | 1 |
| Unfinished (open + deferred) | 25 |
| **On the critical path (filed)** | **10** (9 open + 1 deferred) |
| **On the critical path (not yet filed)** | **1** (worker-hang defect, #485) |
| **Operator steps on the critical path** | **2** |
| Unfinished but off the critical path | 15 (25 unfinished − 10 filed on the path) |
| Open Decisions repo-wide | 2 (0041, 0052) — unrelated to production readiness: 0041 is about reactivating a guided-understanding session; 0052 is about `isolate-agent-asks-from-production-handoff`'s acceptance. Decision 0064 (this session, production-dispatch related) is already answered. |

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
