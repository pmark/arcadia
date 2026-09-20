# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document. It asserts nothing on its own — every line is a
reading of `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, and the live `arcadia schedule status` / `arcadia production
status` output. When those disagree with this file, they are right and this
file is stale. "Refreshing this document" at the bottom says how to re-derive it
in about a minute.

Last derived: **2026-09-20**, after the pivot-cleanup settlements (`352ffeb9`).

---

## Executive summary

**The board half is done. The unattended half is not.**

GitHub Projects is already the live surface: board `pmark/3` is linked to the
Arcadia Project, every Action in the active Plan has an Issue and a card, the
six `Arcadia status` values are projected from the documents, and a card drag is
read back and reconciled against the canonical order. That was the Flight Deck
job, and GitHub does it now.

What is missing is the part behind the board. Managed production is switched
**Active** and admits **no work**, because the chain from "the board says this
card is next" to "an agent finished it and the next card started" still breaks
in several named places. Each break is a governed Action, and most are small.

**Distance: 14 Actions — 13 open plus the 1 deferred proof — out of the Plan's
27 unfinished Actions, and 2 operator steps.** Of the 14: **9 are ordinary
code sessions** and **5 are proof or hardening runs** that cost provider
capacity rather than code. The other 13 unfinished Actions are real work, but
the unattended claim does not depend on them; "What is *not* on the critical
path" below names them.

Everything here counts individual Action ids, never grouped work items.

**The nearest milestone is not "unattended production" — it is the preflight
for it.** `prove-zero-prompt-production-loop` proves the chain end to end with
*no permission relay*: Action A prepared, executed, validated, preserved, its
pointer advanced, Action B prepared. It is not a fully unattended run, and its
own acceptance criteria say so — it permits a predeclared, visible
host-controller invocation ("not autonomous execution") and requires a
separately authorized integration grant, because `preserve-on-exit-and-integrate`
is still open when it runs. Call it an **assisted zero-prompt preflight**.
**Three code Actions plus one operator credential step** stand between here
and attempting it.

**The unattended claim belongs to `prove-two-action-unattended-production`**
— two dependent Actions from one activation with no operator step between
them — and nothing before it in this document should be read as making that
claim.

---

## The gates

Six gates, in dependency order. A gate is closed until every line under it is
checked.

### Gate 1 — The board is the surface ✅ **closed**

| | |
| --- | --- |
| ✅ | Board created and linked (`pmark/3`, repo `pmark/arcadia`) |
| ✅ | One Issue + card per Action in the active Plan (#339–#418) |
| ✅ | `Arcadia status` projected from documents, not set by hand |
| ✅ | Card drags read back, normalized against tier + dependency rules |
| ✅ | Cross-Project priority order (`schedule prioritize`) |
| ✅ | Mid-build discovery writes blockers/correctives/follow-ups to the Plan (Decision 0059) |
| ✅ | Discovery circuit breakers (depth 2, 3 per root, 8 per Milestone) |
| ✅ | Failure budget: 9 failed Runs pauses the Project and opens a Decision |
| ✅ | Audit trail (`schedule log`) with source attribution |
| ⚠️ | Board *views* are manual — GitHub's API cannot create them |
| ⚠️ | One board per Project; no portfolio board |

Reference: [`docs/github-board-guide.md`](github-board-guide.md) (operator),
[`docs/production-scheduling.md`](production-scheduling.md) (engineering).

### Gate 2 — Work reaches an agent with no operator ⬜ **open — 3 Actions**

The worker ticks, sees the pointer, and refuses to launch.

| | Action | Why it blocks |
| --- | --- | --- |
| ✅ | `gate-prepared-dispatch-on-transport-readiness` | Landed 2026-09-20 in PR #438: `arcadia go --agent --apply` now refuses before any Git change when the profile cannot write the workspace database or either heartbeat is stale. |
| ⬜ | `verify-worker-recovery-before-success` ← **current pointer** | The worker control path reports success on a launchd load it never verified. A "running" worker that is not running is the silent version of every other failure here. |
| ⬜ | `fix-packet-lifecycle-latest-planning-decision` | `resolvePacketLifecycle` picks the *oldest* planning Decision. The worker then refuses launch forever (Issue #404). |
| ⬜ | `translate-reasoning-effort-at-launch` | An abstract effort key is handed to `codex`/`claude` verbatim and rejected at spawn. |
| ✅ | `fix-accepted-plan-to-build-packet-path` | Accepting a validated plan now prepares a build packet. |
| ✅ | `deliver-session-brief` | A launched Session gets its task, not session metadata. |
| ✅ | `add-opencode-production-provider` | Third provider exists in the launch path. |

### Gate 3 — A finished Session lands with no operator ⬜ **open — 4 Actions on the critical path, 1 beside it**

| | Item | Why it blocks |
| --- | --- | --- |
| ✅ | **Decision 0058** — delegate bounded candidate integration? | **Approved** (R212, 2026-09-19): bounded integration is delegated under a named, expiring grant. The document lagged the canonical record until 2026-09-20 — itself an instance of `approval-must-apply-or-refuse` below. `preserve-on-exit-and-integrate` now has its authority. |
| ⬜ | `preserve-on-exit-and-integrate` | Without it, every Action needs one operator merge before the next dependent Action can start. This single item is the difference between "assisted" and "unattended" — which is exactly why the proof that precedes it in the queue can only be the assisted one. |
| ⬜ | `bind-candidate-revision-in-action-settle` | `action settle` derives the wrong revision, so the documented candidate-worktree completion path fails. |
| ⬜ | `approval-must-apply-or-refuse` | Approval can consume an item without applying its effect — a silent loss of the thing being approved. |
| ⬜ | `apply-answered-decision-consequences` | An answered Decision does not move the Action it governs, so answering one changes nothing until a human acts on it. |
| ⬜ | `auto-settle-pending-completions-before-dispatch` | Not blocking; a clean drafted completion should settle deterministically with no LLM session before the next dispatch. Off the critical path. |

### Gate 4 — It keeps going without help ⬜ **open — 2 Actions on the critical path, 3 beside them**

| | Action | Why it matters |
| --- | --- | --- |
| ⬜ | `make-go-total-across-plans` | When the active Plan finishes, Go stops instead of activating the next Plan. Unattended production ends at the Plan boundary without it. |
| ⬜ | `detect-hung-managed-production-sessions` | The worker notices a dead tmux, not a live tmux making no progress. A hung Session stalls production indefinitely. |
| ⬜ | `divide-instead-of-stall` | Not blocking; a Session that cannot finish should ship the finishable slice and queue the rest, so the pointer always advances. Off the critical path. |
| ⬜ | `triage-decisions-before-opening` | Not blocking; Decisions that fail the Constitution gate test still stop the line and wait for you. Off the critical path. |
| ⬜ | `cut-managed-production-tick-cost` | Not blocking; the tick re-parses the whole document tree every two seconds. |

### Gate 5 — Proof ⬜ **open — 5 Actions, all on the critical path, provider capacity required**

Nothing here is code. These are live runs that either happen or do not.

| | Action | Scope |
| --- | --- | --- |
| ⬜ | `prove-zero-prompt-production-loop` | **The nearest milestone, and an assisted one.** Hand off, execute, validate, preserve, advance, prepare the next — no permission relay, but a predeclared visible host-controller step and a separately authorized integration grant are both permitted. Not a claim of unattended execution. |
| 🟡 | `prove-two-action-unattended-production` | `status: deferred`. Two dependent Actions from one activation, one Action split across two Sessions, no operator step in between. **This is where the unattended claim is actually earned.** It blocks three other Actions while deferred (see below). |
| ⬜ | `prove-multi-provider-production-recovery` | Continuous production across providers and capacity exhaustion. |
| ⬜ | `prove-managed-production-fault-matrix` | The contract-20 fault-injection matrix before any unattended handoff. |
| ⬜ | `harden-zero-prompt-production-loop` | Only after the happy path runs clean twice. |

### Gate 6 — The operator surface ⬜ **open — scope changed by the pivot**

| | Action | Pivot effect |
| --- | --- | --- |
| ⬜ | `surface-terminal-operator-approvals-in-runs` | Still needed and still correct. Board cards show *that* you are needed; they do not carry the evidence, options and consequences you answer with. |
| 🔶 | `expose-bootstrap-production-controls` | Acceptance criterion 5 — "extract the production control for reuse by **Flight Deck**" — is now stale. The Off switch and capacity/status readout are still wanted; the Flight Deck extraction is not. |
| 🔶 | `freeze-production-runtime-and-handoff-flight-deck` | Its whole premise — freeze the runtime and hand it Flight Deck as the first real workload — needs a new first workload. |

---

## The critical path, in order

Everything else can wait. This is the shortest honest route from here to
unattended production on the board.

1. `verify-worker-recovery-before-success` ← the pointer is already here
2. `fix-packet-lifecycle-latest-planning-decision`
3. `translate-reasoning-effort-at-launch`
4. **Operator:** restore provider auth (see External blockers)
5. `prove-zero-prompt-production-loop` — assisted zero-prompt preflight, not an unattended claim
6. `preserve-on-exit-and-integrate` — authorized by Decision 0058
7. `bind-candidate-revision-in-action-settle`
8. `apply-answered-decision-consequences`
9. `approval-must-apply-or-refuse`
10. **Operator:** un-defer `prove-two-action-unattended-production`
11. `prove-two-action-unattended-production` — the unattended claim is earned here
12. `make-go-total-across-plans`
13. `detect-hung-managed-production-sessions`
14. `prove-multi-provider-production-recovery`
15. `prove-managed-production-fault-matrix`
16. `harden-zero-prompt-production-loop`

**Sixteen numbered entries: 14 Action ids and 2 operator steps.** One id per
entry, so the list and the totals agree.

- **Code sessions (9):** entries 1, 2, 3, 6, 7, 8, 9, 12, 13.
- **Proof and hardening runs (5):** entries 5, 11, 14, 15, 16. These cost
  provider capacity, not code.
- **Yours (2):** entries 4 and 10. Minutes each.

### What is *not* on the critical path

Real work, none of it required before the unattended claim holds:

- `auto-settle-pending-completions-before-dispatch` — saves an LLM session per
  completion; completion already rides in the Action's PR.
- `triage-decisions-before-opening`, `divide-instead-of-stall` — both reduce
  how often production stops for you. Production runs without them; it just
  interrupts more.
- `cut-managed-production-tick-cost` — cost, not capability.
- `expose-bootstrap-production-controls`, `surface-terminal-operator-approvals-in-runs`,
  `freeze-production-runtime-and-handoff-flight-deck` — Gate 6, the operator
  surface, and the first two are partly stale from the pivot.
- The remaining open Actions in the Plan that are not about production at all
  (`build-autonomous-defect-loop`, `build-agent-agnostic-learning-loop`,
  `register-agent-workspace-trust`, `detect-duplicate-ids-and-dangling-refs`,
  `combine-advance-monitor-next-into-one-brief`, and others).

### The one knot worth naming

`prove-two-action-unattended-production` is `deferred`, and three Actions
declare `depends_on` it: `expose-bootstrap-production-controls`,
`prove-multi-provider-production-recovery`, and
`freeze-production-runtime-and-handoff-flight-deck`. All three read `blocked`
on the board right now for that one reason. Nothing else unblocks them.

**Decision 0057** deferred it on 2026-09-18, and its trigger is narrower than
"capacity came back." Read it exactly: the Action *"revives when the operator
begins the live rehearsal with `--provider opencode-cli`, after the further
managed-production defects are fixed."* Two conditions, both unmet — the
defects are items 1–3 and 6–10 of the critical path, and opencode still
returns `Unexpected server error`.

So the knot does not untie on its own, and it should not be untied early: the
proof's runbook restricts the rehearsal to the operator's own terminal, which
is why dispatching it to a coding agent was the problem 0057 solved. Clearing
the critical path ahead of it *is* the work that fires its trigger.

---

## What the Flight Deck → GitHub Projects pivot changed

**Done, 2026-09-20.** Three Agent Asks retargeted everything the contract can
reach:

- `rename-milestone-off-flight-deck-2026-09-20` — the Milestone is now
  **"Bootstrap managed production to run unattended from the GitHub board"** in
  both `PROJECT.md` and the Plan.
- `retire-flight-deck-scope-from-bootstrap-plan-2026-09-20` — rewrote
  `expose-bootstrap-production-controls` criterion 5 (the production control is
  now justified by what a board cell *cannot* hold, rather than by reuse in
  Flight Deck) and made all of
  `freeze-production-runtime-and-handoff-flight-deck` workload-neutral, adding
  a criterion that the first workload must be **named and agreed** before any
  handoff step.
- `retire-flight-deck-from-fault-matrix-2026-09-20` — the fault matrix now
  gates "any unattended production handoff" rather than a Flight Deck one.

**Not done, and not hand-editable.** Four things have no field in the Ask
contract, so `docs/proposals/amend-action-title-and-plan-identity.md` asks for
them rather than this repository writing them by hand:

- **Two Action `title:` fields still name Flight Deck**, because
  `desired_result` writes `next_action` and nothing writes `title`.
  `freeze-production-runtime-and-handoff-flight-deck` now contradicts itself —
  its title names Flight Deck as the first workload, its next action says the
  workload is undecided. **The next action is the current one.** Same for
  `prove-managed-production-fault-matrix`.
- **The Plan slug and filename** still read
  `bootstrap-managed-production-to-build-flight-deck`, as does the
  `freeze-…-flight-deck` Action id. Cosmetic, but there is no supported rename.
- **The draft Flight Deck plan** —
  `docs/plans/flight-deck-board-carries-the-whole-portfolio-on-one-surface.md`,
  `status: draft` — proposed swimlanes, pipeline columns and drag reordering on
  a built-in route. GitHub Projects provides all of it, but no intent sets a
  Plan's status and the only Decision effect is `defer`, so nothing can retire
  it. It stays `draft`.
- **The Plan's `#` heading** was stale too; that one is repairable by hand
  under Decision 0044 and was repaired.

**Still open, and a real choice:** what the *first real production workload*
is. Flight Deck was it. Nothing replaced it, and this document does not guess —
the amended Action now requires the answer before any handoff step. It is not
urgent: that Action is blocked behind the deferred proof.

**Still wanted from the dashboard, and not delivered by GitHub.** A board cell
cannot hold an approval with its evidence, options and consequences; it cannot
be an Off switch; it cannot show capacity age. That is exactly
`surface-terminal-operator-approvals-in-runs` plus the non-Flight-Deck half of
`expose-bootstrap-production-controls`. The pivot shrinks the dashboard's job to
*deciding*, and gives GitHub the job of *seeing*.

**An open question the pivot creates:** the board guide already lists
"comment-driven input" — answering a Decision by replying to its Issue — as a
future enhancement. If answering from the board is wanted, it competes with
`surface-terminal-operator-approvals-in-runs` rather than adding to it.

Every governed change above went through an Agent Ask and was settled on
2026-09-20. Nothing in this section was hand-written into a Plan, and
un-deferring `prove-two-action-unattended-production` was deliberately *not*
done: Decision 0057's trigger has not fired (see "The one knot worth naming").

---

## External blockers (not code)

Verified 2026-09-19; re-check before trusting.

| Blocker | State | Clears by |
| --- | --- | --- |
| Claude CLI auth | `OAuth session expired` killed Run R220 | `claude /login` on the host |
| opencode | `Unexpected server error` on every opencode-go model; also hit a ~36h usage limit | Credential/account fix, then a live smoke run |
| Codex capacity | Exhausted; window resets on its own cadence | Waiting |
| Local-only pointer commits | Settlement commits land locally and are pushed by hand | `arcadia work monitor`, then push |

Provider auth is the single most common reason a proof run burns capacity and
proves nothing. Check it before every proof Action, not after.

---

## Scoreboard

| | Count |
| --- | --- |
| Actions in the active Plan | 66 |
| Done | 39 |
| Open | 26 |
| Deferred | 1 |
| Unfinished (open + deferred) | 27 |
| **On the critical path** | **14** (13 open + 1 deferred) + 2 operator steps |
| Unfinished but off the critical path | 13 |
| Open Decisions repo-wide | 2 (0041, 0052) |

---

## Refreshing this document

Run these four, then update the gate tables and the "Last derived" line:

```bash
mise exec -- pnpm arcadia schedule status --project arcadia
```

```bash
mise exec -- pnpm arcadia production status
```

```bash
mise exec -- pnpm arcadia review
```

```bash
grep -l "^status: open" docs/decisions/*.md
```

An Action's truth is its `status:` in the Plan document. A gate's truth is
whether every Action under it is `done`. If you find this file claiming
something the Plan does not, fix this file — never the other way round.
