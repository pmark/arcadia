# Managed production readiness

**The one question this document answers:** how far is Arcadia from running
software production unattended, steered from a GitHub Project board?

It is a *derived* document. It asserts nothing on its own — every line is a
reading of `PROJECT.md`, `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`,
`docs/decisions/`, and the live `arcadia schedule status` / `arcadia production
status` output. When those disagree with this file, they are right and this
file is stale. "Refreshing this document" at the bottom says how to re-derive it
in about a minute.

Last derived: **2026-09-20**, at `d11050ae`.

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

**Distance: 12 of the 27 open Actions sit on the critical path, plus the one
deferred proof Action** — thirteen in all — alongside one operator credential
step. Nine of the thirteen are ordinary code sessions; four are proof runs that
cost provider capacity rather than code.

**The nearest honest milestone is not "unattended production." It is one Action
launched, finished, landed and followed by the next one, with nobody typing
anything.** That is `prove-zero-prompt-production-loop`, and five code Actions
stand between here and attempting it.

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

### Gate 2 — Work reaches an agent with no operator ⬜ **open — 4 Actions**

The worker ticks, sees the pointer, and refuses to launch.

| | Action | Why it blocks |
| --- | --- | --- |
| ⬜ | `gate-prepared-dispatch-on-transport-readiness` ← **current pointer** | Preparation must refuse before launch when the profile cannot reach the workspace DB or the Go/preservation heartbeats are stale. Today it launches into a dead transport. |
| ⬜ | `verify-worker-recovery-before-success` | The worker control path reports success on a launchd load it never verified. A "running" worker that is not running is the silent version of every other failure here. |
| ⬜ | `fix-packet-lifecycle-latest-planning-decision` | `resolvePacketLifecycle` picks the *oldest* planning Decision. The worker then refuses launch forever (Issue #404). |
| ⬜ | `translate-reasoning-effort-at-launch` | An abstract effort key is handed to `codex`/`claude` verbatim and rejected at spawn. |
| ✅ | `fix-accepted-plan-to-build-packet-path` | Accepting a validated plan now prepares a build packet. |
| ✅ | `deliver-session-brief` | A launched Session gets its task, not session metadata. |
| ✅ | `add-opencode-production-provider` | Third provider exists in the launch path. |

### Gate 3 — A finished Session lands with no operator ⬜ **open — 4 Actions**

| | Item | Why it blocks |
| --- | --- | --- |
| ✅ | **Decision 0058** — delegate bounded candidate integration? | **Approved** (R212, 2026-09-19): bounded integration is delegated under a named, expiring grant. The document lagged the canonical record until 2026-09-20 — itself an instance of `approval-must-apply-or-refuse` below. `preserve-on-exit-and-integrate` now has its authority. |
| ⬜ | `preserve-on-exit-and-integrate` | Without it, every Action needs one operator merge before the next dependent Action can start. This single item is the difference between "assisted" and "unattended." |
| ⬜ | `bind-candidate-revision-in-action-settle` | `action settle` derives the wrong revision, so the documented candidate-worktree completion path fails. |
| ⬜ | `approval-must-apply-or-refuse` | Approval can consume an item without applying its effect — a silent loss of the thing being approved. |
| ⬜ | `apply-answered-decision-consequences` | An answered Decision does not move the Action it governs, so answering one changes nothing until a human acts on it. |
| ⬜ | `auto-settle-pending-completions-before-dispatch` | A clean drafted completion should settle deterministically with no LLM session before the next dispatch. |

### Gate 4 — It keeps going without help ⬜ **open — 4 Actions**

| | Action | Why it matters |
| --- | --- | --- |
| ⬜ | `make-go-total-across-plans` | When the active Plan finishes, Go stops instead of activating the next Plan. Unattended production ends at the Plan boundary without it. |
| ⬜ | `detect-hung-managed-production-sessions` | The worker notices a dead tmux, not a live tmux making no progress. A hung Session stalls production indefinitely. |
| ⬜ | `divide-instead-of-stall` | A Session that cannot finish should ship the finishable slice and queue the rest, so the pointer always advances. |
| ⬜ | `triage-decisions-before-opening` | Decisions that fail the Constitution gate test still stop the line and wait for you. |
| ⬜ | `cut-managed-production-tick-cost` | Not blocking; the tick re-parses the whole document tree every two seconds. |

### Gate 5 — Proof ⬜ **open — 4 Actions, provider capacity required**

Nothing here is code. These are live runs that either happen or do not.

| | Action | Scope |
| --- | --- | --- |
| ⬜ | `prove-zero-prompt-production-loop` | **The nearest real milestone.** One Action: hand off, execute, validate, preserve, advance — no permission relay. |
| 🟡 | `prove-two-action-unattended-production` | `status: deferred`. Two dependent Actions from one activation, one Action split across two Sessions. **It blocks three other Actions while deferred** (see below). |
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

1. `gate-prepared-dispatch-on-transport-readiness` ← the pointer is already here
2. `verify-worker-recovery-before-success`
3. `fix-packet-lifecycle-latest-planning-decision`
4. `translate-reasoning-effort-at-launch`
5. **Operator:** restore provider auth (see External blockers)
6. `prove-zero-prompt-production-loop` — first real proof
7. `preserve-on-exit-and-integrate` — authorized by Decision 0058
8. `bind-candidate-revision-in-action-settle`
9. `apply-answered-decision-consequences`
10. `approval-must-apply-or-refuse`
11. **Operator:** un-defer `prove-two-action-unattended-production`
12. `prove-two-action-unattended-production` — the "unattended" claim becomes true here
13. `make-go-total-across-plans`
14. `detect-hung-managed-production-sessions`
15. `prove-multi-provider-production-recovery`, `prove-managed-production-fault-matrix`, `harden-zero-prompt-production-loop`

Items 1–4 and 7–10 are ordinary sessions. 6, 12 and 15 cost provider capacity.
5 and 11 are yours and take minutes.

### The one knot worth naming

`prove-two-action-unattended-production` is `deferred`, and three Actions
declare `depends_on` it: `expose-bootstrap-production-controls`,
`prove-multi-provider-production-recovery`, and
`freeze-production-runtime-and-handoff-flight-deck`. All three read `blocked`
on the board right now for that one reason. Nothing else unblocks them.

It was deferred when Codex and Claude were out of capacity and opencode was
broken. That is a capacity condition, not a scope decision — so it is a
deferral whose trigger is "a provider has capacity again," and that trigger
may already have fired.

---

## What the Flight Deck → GitHub Projects pivot changed

**Superseded.** `docs/plans/flight-deck-board-carries-the-whole-portfolio-on-one-surface.md`
(`status: draft`) proposed swimlanes, pipeline columns and drag reordering on a
built-in route. GitHub Projects now provides all of it. The plan should be
closed rather than left drafting.

**Renamed but not rescoped.** The active Milestone is still "Bootstrap managed
production to build Flight Deck," and the Plan slug still carries it. The
*bootstrap* work is entirely unaffected by the pivot — only its stated
destination changed. The Milestone needs a new name and, more importantly, a
new first workload.

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

None of the above is a governance edit. Changing the Milestone name, closing
the Flight Deck plan, un-deferring the proof Action, and amending the two stale
acceptance criteria all go through an Agent Ask.

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
| Done | 38 |
| Open | 27 |
| Deferred | 1 |
| **On the critical path** | **13** (12 open + 1 deferred) |
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
