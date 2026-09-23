# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document. It asserts nothing on its own — every line is a
reading of `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, `MISSION_LOG.md`, and the live `arcadia schedule status` /
`arcadia production status` / `arcadia production capacity` output. When those
disagree with this file, they are right and this file is stale. "Refreshing
this document" at the bottom says how to re-derive it in about a minute.

Last derived: **2026-09-23 (evening)**, while running a strategy session on
multi-repository concurrency and correcting drift the prior same-day
derivation below had already accumulated by the time this one started:
`make-go-total-across-plans`, `detect-hung-managed-production-sessions`, and
`prove-fault-matrix-remaining-boundaries` had all completed (see
`MISSION_LOG.md`) but this document still showed them open — **Gate 4 is now
closed**, and Gate 5 has one fewer open item than the prior text below states.
This derivation also found, live, that the single production lane had been
silently retry-looping on its pointer Action for over an hour
(`register-agent-workspace-trust`, `planning_required`, no packet prepared —
Issue #576) with no operator-visible signal, and filed
`escalate-nonrecoverable-launch-refusals` to stop that class of stall from
being invisible. See "Concurrency: how many Sessions run at once" below for
the scope decision this session produced (Decision 0066) on when
same-repository parallel Sessions are worth building.

Earlier same-day derivation: **2026-09-23**, re-derived while completing
`prove-managed-production-fault-matrix`. Contract 20's Stage 1 was re-proven at
`2332be48` — admission/launch, Off, capacity, and priority/authority at 100 seeds
each, zero violations, the harness mutation-verified against four injected
defects plus one recorded equivalent mutant — and
`docs/evidence/managed-production-release-evidence-index.md` was refreshed to
that revision. The live criteria the Action could never satisfy in an agent
session were split into their own Actions: `prove-fault-matrix-remaining-boundaries`
(completion/pointer, process-health, runtime, and the missing-artifact gate —
**now done**) and
`run-managed-production-live-soak` (contract-20 stages 2-4, under operator-granted
scope). Previous derivation: **2026-09-22**, while completing
`apply-answered-decision-consequences` (PR #515, `arcadia decision reverse`). An
answered Decision's deferral can now be applied *and reversed* in one governed
transition, so the "an answer changes nothing until a human acts" gap this
document named is closed. With `bind-candidate-revision-in-action-settle`
(PR #508) also already done, **Gate 3's critical path is now closed**: nothing
on it stands between a finished Session and its landing except the live proof. The derivation this one
replaces covered `preserve-on-exit-and-integrate` (Decision 0058), which closed
the A-to-B seam the document had named as the most consequential open question.
Before that, `self-heal-hung-worker-heartbeat` closed the worker-hang defect
(Issue #485), and the same day `formalize-two-phase-planning-process`,
`refresh-managed-production-readiness-2026-09-22`, the Decision 0064 fix to
`prove-zero-prompt-production-loop`'s wrongful dispatch to coding agents
(PR #481), and `substitute-unavailable-provider-before-binding` (PR #482,
landed *while that document was being written* — proof of the concurrency this
document has to account for, not just describe).

---

## Executive summary

**The board half is done, Gates 2 and 4 are closed, Gate 3's critical path is
closed, and the worker can no longer hang un-owned. The unattended claim now
rests entirely on the proof (Gate 5) — and every remaining step on that proof's
critical path is an operator step, not a coding-agent Action. There is no
freely-dispatchable code session left on the critical path right now.**

**Gate 3's critical path is now closed.** `preserve-on-exit-and-integrate`
made the worker
preserve a terminal Session's candidate host-side and, under Decision 0058's
separately recorded expiring grant, fast-forward the Session's own agent-owned
branch onto the governed base so the next dependent Action is admitted in the
same tick; `bind-candidate-revision-in-action-settle` fixed the candidate
revision `action settle` compares against; and `apply-answered-decision-consequences`
applies — and now reverses — an answered Decision's consequence in one governed
transition. **Gate 4 is now also closed**: `make-go-total-across-plans` and
`detect-hung-managed-production-sessions` are both `done` (this document
previously showed them open — corrected this derivation). What remains before
the unattended claim is the *proof* (Gate 5) alone.

GitHub Projects is the live surface (Gate 1, unchanged since 2026-09-20).
**Gate 2 fully closed** on 2026-09-22 (`verify-worker-recovery-before-success`,
`fix-packet-lifecycle-latest-planning-decision`,
`translate-reasoning-effort-at-launch`, `fix-accepted-plan-to-build-packet-path`
all `done`), and **Gate 3's critical path closed this derivation**
(`preserve-on-exit-and-integrate`, `bind-candidate-revision-in-action-settle`,
`approval-must-apply-or-refuse`, and `apply-answered-decision-consequences` all
`done`). That is real, verified progress, not a projection.

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

**Distance: 5 filed Actions — 4 open plus the 1 deferred proof — out of the
Plan's 25 unfinished Actions, plus 2 operator steps.** All 5 filed Actions are
**proof or hardening runs** that cost provider capacity, not code — after this
derivation's correction, `make-go-total-across-plans`,
`detect-hung-managed-production-sessions`, and
`prove-fault-matrix-remaining-boundaries` moved from "open" to "done," which
removes what used to be the two ordinary code sessions this section named as
ready today. **Nothing on the critical path is a freely-dispatchable coding
session right now** — every remaining filed Action is blocked on the deferred
proof (directly or transitively), and the deferred proof's own trigger
requires the operator to run it personally. The other 20 unfinished Actions
are real work, but the unattended claim does not depend on them; "What is
*not* on the critical path" below names them.

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

Six gates, in dependency order. A gate is closed when every critical-path line
under it is checked; a line the table explicitly marks off the critical path does
not hold the gate open.

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

### Gate 3 — A finished Session lands with no operator ✅ **critical path closed, 2026-09-22; only the off-path `auto-settle-pending-completions-before-dispatch` remains**

| | Item | Why it blocks |
| --- | --- | --- |
| ✅ | **Decision 0058** — delegate bounded candidate integration? | Approved (R212, 2026-09-19). `preserve-on-exit-and-integrate` had its authority. |
| ✅ | `preserve-on-exit-and-integrate` | **Done.** The worker preserves a terminal Session's candidate host-side through the existing machinery and, only under Decision 0058's separately recorded expiring grant, fast-forwards the Session's own agent-owned branch onto the governed base so the next dependent Action is admitted in the same tick. Absent a valid grant it stops after preservation and prints the exact operator merge command; a conflict, divergent base, non-agent branch, or out-of-scope candidate does the same. |
| ✅ | `bind-candidate-revision-in-action-settle` | **Done (PR #508).** `action settle` binds the candidate revision to the checkout it compares against, so the documented candidate-worktree completion path works. |
| ✅ | `approval-must-apply-or-refuse` | Done (PR #447). |
| ✅ | `apply-answered-decision-consequences` | **Done (PR #515).** An answered Decision's consequence is applied in one governed transition, and its deferral is reversed in one (`arcadia decision reverse`) — a parked Action now has a first-class revival. |
| ⬜ | `auto-settle-pending-completions-before-dispatch` | Not blocking; off the critical path (see below). |

### Gate 4 — It keeps going without help ✅ **closed, corrected this derivation**

Both critical-path Actions are `done` in the Plan document; this table
previously showed them open.

| | Action | Why it matters |
| --- | --- | --- |
| ✅ | `make-go-total-across-plans` | **Done.** When the active Plan finishes, Go activates the Plan whose earliest eligible Action is highest in the explicit queue instead of stopping. |
| ✅ | `detect-hung-managed-production-sessions` | **Done.** The worker now notices a live tmux making no progress, not only a dead one. **This covers a hung agent Session, not a hung worker daemon — that gap is closed separately by `self-heal-hung-worker-heartbeat`.** |
| ⬜ | `divide-instead-of-stall` | Not blocking; off the critical path. |
| ⬜ | `triage-decisions-before-opening` | Not blocking; off the critical path. |
| ⬜ | `cut-managed-production-tick-cost` | Not blocking; off the critical path. |

### Gate 5 — Proof ⬜ **open — 4 Actions, all on the critical path, provider capacity required, and now 100% operator-gated**

Nothing here is code. These are live runs that either happen or do not.

| | Action | Scope |
| --- | --- | --- |
| ⬜ | `prove-zero-prompt-production-loop` | **Reclassified `requires_review` this session (Decision 0064) — no longer a dispatch hazard.** Action A succeeded live on 2026-09-21 with `opencode`. Remaining gap: Issue #460 (no Session record without `--launch`, so `session reconcile` has nothing to reconcile), plus the fixture's own unmerged PR #2. Still an operator-terminal run, by design. |
| 🟡 | `prove-two-action-unattended-production` | `status: deferred`. **This is where the unattended claim is actually earned.** Blocks three other Actions while deferred (see "The one knot worth naming"). |
| ⬜ | `prove-multi-provider-production-recovery` | Continuous production across providers and capacity exhaustion. |
| ✅ | `prove-managed-production-fault-matrix` | The contract-20 fault-injection matrix before any unattended handoff. **Done.** Stage 1 is proven for 4 of 7 boundaries (admission/launch, Off, capacity, priority/authority: 100 seeds each, zero violations, harness mutation-verified against four injected defects and one recorded equivalent mutant), re-proven at `2332be48` on 2026-09-23. The release evidence index is at `docs/evidence/managed-production-release-evidence-index.md`. The live criteria the Action could never meet in an agent session were divided out by the settled Agent Ask `divide-prove-managed-production-fault-matrix-2026-09-22` into the two rows below. |
| ✅ | `prove-fault-matrix-remaining-boundaries` | **Done** (per `MISSION_LOG.md`; this table previously showed it open). Completion/pointer, process-health, and runtime boundaries, plus the missing-artifact quality gate, are proven. |
| ⬜ | `run-managed-production-live-soak` | Contract-20 live stages 2-4 under operator-granted scope and capacity authority. Its `prove-fault-matrix-remaining-boundaries` dependency is now clear; still blocked on `prove-two-action-unattended-production` and `prove-multi-provider-production-recovery`. |
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
  refuse unless it is an Arcadia CLI `worker start` invocation bound to *this*
  workspace — either by an exactly-matching `--workspace`, or, for the
  workspace-less invocations this host's own launch agent uses, by this
  workspace being the one a default invocation resolves to here. A pidfile
  outlives a worker killed with SIGKILL, and the kernel may reuse that PID; a
  refusal names the PID, the pidfile, and the exact remedy rather than killing a
  stranger. The first shipped cut of this refused the workspace-less shape
  outright, which made the whole recovery unreachable on the one host where
  Issue #485 had actually happened; Issue #492 records that and the fix.

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

1. ✅ `preserve-on-exit-and-integrate` — **done**, closing the A-to-B seam
2. ✅ `bind-candidate-revision-in-action-settle` — **done** (PR #508)
3. ✅ `apply-answered-decision-consequences` — **done** (PR #515)
4. ✅ `self-heal-hung-worker-heartbeat` — **done**, closing the worker-hang
   defect (Issue #485)
5. **Operator:** resolve Issue #460 (or file the Action for it) so the
   zero-prompt rehearsal's Action B → completion can actually be attempted
6. `prove-zero-prompt-production-loop` — assisted zero-prompt preflight, not
   an unattended claim; Action A already proven live, finish the loop
7. **Operator:** un-defer `prove-two-action-unattended-production`
8. `prove-two-action-unattended-production` — the unattended claim is earned
   here; its own runbook restricts the rehearsal to the operator's terminal
9. ✅ `make-go-total-across-plans` — **done** (corrected this derivation)
10. ✅ `detect-hung-managed-production-sessions` — **done** (corrected this
    derivation)
11. `prove-multi-provider-production-recovery` — blocked on entry 8
12. ✅ `prove-managed-production-fault-matrix` — **done** (Stage 1 re-proven at
    `2332be48`)
13. ✅ `prove-fault-matrix-remaining-boundaries` — **done** (corrected this
    derivation; completion/pointer, process-health, runtime, and the
    missing-artifact gate are proven)
14. `run-managed-production-live-soak` — contract-20 live stages 2-4, under
    operator-granted scope and capacity authority; blocked on entries 8 and 11
15. `harden-zero-prompt-production-loop` — blocked on entry 6

**Fifteen numbered entries: 13 filed Action ids and 2 operator steps. Eight
Actions are done; five remain, and every one of the five is blocked, directly
or transitively, on an operator step.**

- **Code sessions, ready today with no blocking dependency: none.** This
  section previously named entries 9 and 10 as the fastest place to spend a
  session; both are now done, and nothing has replaced them. Every remaining
  filed Action funnels through entry 7 (un-defer) and entry 8 itself, which by
  design only the operator can run.
- **Needs filing first: none.**
- **Proof and hardening runs (5):** entries 6, 8, 11, 14, 15 (4 open, 1
  deferred). These cost provider capacity, not code, and are operator-terminal
  by design or by dependency.
- **Yours (2):** entries 5 (or delegate it as a filed Action) and 7. Minutes
  each, once their preconditions are actually true. **These two operator
  minutes are the entire remaining critical path's bottleneck** — nothing a
  coding-agent session can pick up moves this further until they happen.

### What is *not* on the critical path

Real work, none of it required before the unattended claim holds:

- `auto-settle-pending-completions-before-dispatch`, `triage-decisions-before-opening`,
  `divide-instead-of-stall`, `cut-managed-production-tick-cost` — all reduce
  friction or cost; production runs without them.
- `expose-bootstrap-production-controls`, `surface-terminal-operator-approvals-in-runs`,
  `freeze-production-runtime-and-handoff-flight-deck` — Gate 6, the operator
  surface.
- `register-agent-workspace-trust` — open, and currently stalled on a missing
  build packet (`planning_required`); see "Concurrency" below. Not on the
  unattended-claim path either way.
- `escalate-nonrecoverable-launch-refusals` — filed this derivation (Issue
  #576). Improves legibility of any future stall like the one above; does not
  gate the unattended claim itself.
- The remaining open Actions in the Plan that are not about production at all:
  `detect-duplicate-ids-and-dangling-refs`,
  `combine-advance-monitor-next-into-one-brief`,
  `defect-bounded-triage-loop`, and others. (`build-autonomous-defect-loop`,
  previously listed here, is now `done`.)

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

## Concurrency: how many Sessions run at once

Added 2026-09-23, from a strategy session evaluating cross-repository and
same-repository parallelism. **Short answer: one Session per repository,
deliberately, and that is not the bottleneck today** — see "The critical
path, in order" above, where every remaining Action is blocked on an operator
step, not on throughput.

**What exists today.** The repository lease
(`idx_agent_sessions_repository_lease` in the workspace database) admits at
most one `prepared`/`running` Session per `repository_path`, structurally,
independent of the standing policy's `maxConcurrentSessions` (currently 2).
Two Sessions at once is possible today only across two different
repositories, and the standing policy's Project scope currently covers
`arcadia` and `zero-prompt-rehearsal`. `agent_sessions` has exactly one row,
ever: `session_e7748a398de14978b4` (zero-prompt-rehearsal's Action B,
2026-09-23, `claude-code-cli`, prepared 16:08:37, completed 18:17:39 — 2h9m
for one Action, landing via `accepted_completion` after five separate
operator touches per the rehearsal's own record: permission re-grant,
workspace-trust prompt, `/login`, manual completion settlement because the
Project had no validation checks — Issue #572 — and the operator's own
merge).

**Why cross-repository parallelism (raising the Project scope or the
concurrency limit) is not recommended yet, even though it is nearly free to
turn on.** The single lane that exists has never landed a zero-touch Session,
and was found silently stalled for over an hour during this same evaluation
(`register-agent-workspace-trust`, Issue #576) with no operator-visible
signal. Widening scope before the one lane is legible multiplies exposure to
the same class of invisible stall, not just to real work.

**Why same-repository concurrent Sessions (a secondary queue lane, or a
ready-set scheduler dispatching several Actions from one Plan at once) is not
recommended yet.** The primitives a second lane would have to share are
currently reported racy: `serialize-decision-deferral-pointer-write` (#505,
the pointer read-modify-write has no lock or compare-and-set),
`arcadia action settle` printing the wrong `Next` under concurrent settlement
(#507), and a Session claim expiring after 24h while its candidate is still
unmerged (#549). All three are filed and queued — ready, not yet started, at
positions 19-20 in the arcadia lane and tracked separately for #549. Building
a second consumer of these primitives now means racing to ship on top of code
already scheduled to change out from under it. The Plan already encodes this
exact reasoning for *provider* concurrency:
`prove-multi-provider-production-recovery` explicitly defers its dual-provider
concurrent soak proof "until single-provider single-repository production ...
has run cleanly in real operator use." **Decision 0066** (filed this session,
open) extends that same logic, explicitly, to session/repository concurrency,
naming the trigger: same-repository parallelism becomes worth building once
`prove-two-action-unattended-production` has run cleanly in real operator use
and the #505/#507/#549-class fixes have landed — at that point the shared
primitives are no longer known-buggy and a second lane is cheap to build
safely.

**What this means for "continuous production":** given the operator's own
scope for this evaluation — Arcadia only, best-effort rather than strict
24/7, rare hiccups acceptable if caught within a day — the highest-leverage
path to more continuous production right now is not concurrency architecture.
It is: (1) the two operator minutes on the critical path above, (2) landing
the already-queued packet-prep, sign-in, and token-passing Actions ahead of
the pointer, and (3) letting the already-queued concurrency-safety fixes
(#505, #507, #549-class) land in their existing queue order before any new
concurrency surface is built on top of them.

---

## External blockers (not code)

Re-verified 2026-09-23 via `arcadia production capacity`; re-check before
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
| Actions in the active Plan | 89 (precisely counted this derivation by parsing each `- id:`/`status:` pair, not by a whole-file `status:` grep — the naive grep overcounts because acceptance-criteria text quotes status values) |
| Done | 64 (+4 since the last scoreboard: `prove-managed-production-fault-matrix`, `make-go-total-across-plans`, `detect-hung-managed-production-sessions`, `prove-fault-matrix-remaining-boundaries` — the last three were already true and this document had not caught up) |
| Open | 24 (includes `escalate-nonrecoverable-launch-refusals`, filed this derivation) |
| Deferred | 1 (`prove-two-action-unattended-production`) |
| Unfinished (open + deferred) | 25 |
| **On the critical path (filed)** | **5** (4 open + 1 deferred) — down from 8, now that entries 9/10/13 are done |
| **On the critical path (not yet filed)** | **0** |
| **Operator steps on the critical path** | **2** — and now the only thing standing between here and further filed-Action progress; see "The critical path, in order" |
| Unfinished but off the critical path | 20 (25 unfinished − 5 filed on the path) |
| Open Decisions repo-wide | 3 (0041, 0052, 0066) — 0041 and 0052 are unrelated to production readiness (a guided-understanding session; `isolate-agent-asks-from-production-handoff`'s acceptance). **Decision 0066** (new) is production-readiness-relevant: when to widen beyond one Session per repository. Decision 0064 (production-dispatch related) is already answered. |

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
scripts/logs.sh worker                             # or grep the LOG_DIR it names directly for a non-blocking read
gh issue list --label bug --state open              # cross-check against what this document calls "fixed"
```

**Do not trust a global `grep -c '^ *status:' file | wc -l` style count for the
Plan's Action totals** — this derivation found it overcounts, because several
Actions' own acceptance-criteria text quotes a literal `status: blocked` or
similar as descriptive prose, not as a real field. Pair each `- id:` with the
`status:` line that immediately follows it instead.

An Action's truth is its `status:` in the Plan document. A gate's truth is
whether every Action under it is `done`. If you find this file claiming
something the Plan, a Decision, or `MISSION_LOG.md` does not, fix this file —
never the other way round. **Refresh this document whenever a critical-path
Action completes or a new blocker is discovered** — that is what keeps it
canonical rather than a one-time snapshot.
