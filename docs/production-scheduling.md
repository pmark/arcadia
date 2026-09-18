# Production scheduling and the GitHub board

The production scheduler decides which Action Arcadia runs next, keeps that
decision visible on a GitHub Project board, and reads exactly one thing back
from the board: the operator dragging cards. This document is the reference for
how that works, what is deliberately not built, and where the implementation
departs from the original MVP brief and why.

## Authority

| Store | Holds | Direction |
| --- | --- | --- |
| Managed documents (`PROJECT.md`, `docs/plans/*.md`) | What the Actions are, their dependencies, the governed pointer | Truth |
| SQLite (`action_queue_positions`, `scheduling_*`) | Queue positions and revision, scheduling class, discovery lineage, GitHub ids, the scheduling Log | Truth |
| GitHub Issues | One Issue per Action in the active Plan | Arcadia → GitHub |
| GitHub Project | One item per Issue, an `Arcadia status` single-select field, item position | Arcadia → GitHub, except item position which is read back |

GitHub is a projection. Nothing on it other than card order ever changes
Arcadia state, and card order changes it only through the canonical rule below.

## The rule

Every queued Action has a scheduling class: `interrupt`, `blocker`,
`corrective`, or `planned`. `follow_up` is backlog and never queues.

Canonical order is: highest class first, then lowest queue position inside the
class, then Plan declaration order. An Action is always held behind a
dependency that is not done, whatever its position or class. That is one
function, `canonicalOrder` in `src/scheduling/order.ts`, and the scheduler, the
reorder validator, and the board projection all call it.

The next runnable Action is the first Action in canonical order whose status
is `ready`. Statuses are derived from the documents and live Sessions:

| Status | Meaning |
| --- | --- |
| `ready` | Dependencies met, no open question, a coding agent may act |
| `running` | A live Session holds it |
| `blocked` | An unfinished dependency, or externally blocked |
| `needs_operator` | Open question, review required, unresolved Decision, or the Project is paused |
| `done` | The Plan records it done |
| `deferred` | Follow-up; backlog |

Across Projects, `arcadia schedule prioritize --order a b c` sets one ordered
list. The scheduler scans it and the first Project with runnable work is
selected. There is no fairness, weighting, or aging.

## Where it runs

`runSchedulingPass` (`src/scheduling/scheduler.ts`) runs at the top of every
managed-production tick while the standing policy is Active, and on demand via
`arcadia schedule reconcile --apply`. Per Project, in priority order, it:

1. reads the linked GitHub board (if any) and reconciles card order;
2. moves the governed pointer to the canonical next Action when the pointer
   names something else that is not running, using the same preview-then-apply
   transition and commit as `advance queue make-next`.

The production tick then launches whatever the pointer names, as it always
has. The scheduler never launches anything itself.

## Reconciliation

On each pass with a linked board:

1. Read the board's items in board order.
2. Map items to Actions through the stored item ids; keep only queued Actions.
3. Compare with the order Arcadia last projected. A difference is an operator
   reorder.
4. Run the observed order through the canonical rule. Intra-class moves are
   kept; a card dragged above a higher class or above its own dependency is
   put back.
5. Persist the accepted positions through the existing queue receipt path,
   which bumps `queue_revision`.
6. Write two Log entries when needed: what the operator moved
   (`github_operator`) and what was normalized and why (`arcadia`).
7. Re-project statuses and order to the board if the board differs from
   canonical, or if the queue revision moved since the last projection.
8. Record `last_projected_revision` and the projected order.

Invalid drags never open a Decision. The board simply goes back to canonical
and the Log says why.

## Discovery

`arcadia schedule discover --from <project/action> --kind <kind> --title ...
--acceptance ... --request-id ...` is what a coding Run calls when it finds work
it was not sent to do.

- **blocker**: written into the active Plan as a new Action, the origin Action
  gets `depends_on: [blocker]` so it becomes `blocked`, and the blocker takes
  the origin's slot. It is now the next runnable Action.
- **corrective**: written into the Plan and queued ahead of remaining planned
  work, behind any earlier corrective (FIFO by discovery). The current Run is
  not interrupted.
- **follow_up**: written into the Plan, classed `follow_up`, shown as backlog.
  The queue is untouched.

The Plan write lands in the Project's configured repository and is committed
there, never pushed. The repository must be clean; a dirty tree refuses the
discovery rather than mixing it with someone's uncommitted work.

Three fixed circuit breakers stop runaway branches: discovery depth 2,
three corrective descendants per root Action, eight discovered correctives per
Milestone. Crossing any of them opens a Decision carrying the proposed Action
and writes nothing to the Plan or queue.

## Execution budget

`recordFailedRun` counts failed Runs per Project and active Milestone. The
ninth failure pauses the Project (no pointer moves, no launches) and opens a
Decision. `arcadia schedule resume --project <slug> --reason ...` clears the
pause and the counter after the operator answers.

## The Log

Every scheduling mutation writes a row to `scheduling_log` with the time,
Project, Action, source (`arcadia`, `github_operator`, `coding_run`,
`decision`), previous and new state, and a one-sentence reason. `arcadia
schedule log` prints it. This is deliberately not `MISSION_LOG.md`: the tick
already established that routine machine telemetry does not belong in the
human narrative and that per-tick commits to the Log rewrite history nobody
asked for. The scheduling Log is the audit trail the brief asks for; the
Mission Log stays human-scale.

## GitHub mechanics

`src/scheduling/github.ts` drives `gh`:

- `gh project view/field-list/item-list/item-add/item-edit` for the board;
- `gh issue create` for Issues;
- one GraphQL mutation, `updateProjectV2ItemPosition`, for card order.

Status is carried on a single-select field named `Arcadia status` with options
`Needs operator`, `Ready`, `Running`, `Blocked`, `Done`, `Backlog`. The field is
created on link when missing. GitHub's built-in `Status` field is left alone
because its options cannot be renamed through the API; the operator groups the
board view by `Arcadia status`.

GitHub Project views cannot be created through the API either, so the
"execution" and "backlog" views are one manual step: in the board view, filter
`-Arcadia status:Backlog,Done`; add a second view filtered to
`Arcadia status:Backlog`.

Every board operation sits behind the `SchedulingBoard` interface, so the
tests drive an in-memory board and prove reconciliation without network
access.

## Departures from the brief

- **Positions live in the existing portfolio queue.** The brief asked for one
  queue per Milestone; the repository already had one ordered portfolio queue
  with a revision and receipts. Per-Project order is that queue restricted to
  the Project's keys, and `writeProjectOrder` rewrites only a Project's own
  slots. One store, no duplicate ordering system.
- **Statuses are derived, not stored.** `ready`, `blocked`, `needs_operator`
  and `running` fall out of the documents and Sessions that already carry the
  truth. Storing them would create a second truth store to reconcile.
- **Scheduling class lives in SQLite, not Plan frontmatter.** The document
  parser and every Plan in every adopting repository stay unchanged; a Plan
  Action defaults to `planned`.
- **No Milestone switching, interrupts are manual.** Nothing creates an
  `interrupt` automatically; `schedule classify --class interrupt` does.

## Not built

Global priority scoring, AI urgency, weighted fairness, automatic Milestone
switching, bidirectional sync of any field other than card position, webhooks,
capacity planning, token budgeting, label-driven reprioritization. Each is
triggered by observed need, not anticipated.
