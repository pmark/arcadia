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
| `deferred` | Follow-up, or parked by an answered `defer` Decision; backlog either way, never queued |

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

The pointer is held, not moved, while any of these is true: the Project is
paused, the current Action is running, a Session holds the repository lease,
or **the current Action has a preserved candidate that has not landed on the
base branch**. That last one covers the window after a Session exits and
before its pull request merges. The completion settlement is already on the
candidate branch, where it has rewritten `current_action`; moving the pointer
in the base checkout during that window writes the same field from two places
and collides at merge. "Landed" is the test `arcadia go` uses for an
integrated branch, so a squash or rebase merge releases the hold too.

`--project <slug>` scopes the entire pass, not just which board is read. A pass
scoped to one Project reconciles only that Project's board and commits only
that Project's pointer move; no other Project is read or written. That is the
difference between a scoped command and a filtered report, and it matters
because a pointer move is a commit in someone's repository.

## What a pass costs

The worker ticks every two seconds, and GitHub's GraphQL budget is per
account and hourly — exhausting it would break every other `gh` call the
operator makes, not just Arcadia's. So a pass reads a board only when it has
a reason to:

| Situation | Board read? |
| --- | --- |
| Queue revision moved since the last projection | Yes, at once |
| An Action has no card yet | Yes, at once |
| A previous projection did not finish | Yes, at once |
| Nothing changed, last read under a minute ago | No |
| Nothing changed, last read over a minute ago | Yes, one poll |

Arcadia never has to poll to learn about its own changes; those bump the queue
revision and publish immediately. Polling exists only to notice an operator's
drag, so `DEFAULT_BOARD_POLL_INTERVAL_MS` (60s) buys a minute of latency on a
human action in exchange for two orders of magnitude fewer calls. A settled
board costs about sixty reads an hour rather than several thousand.

The board's node id, status field id and option ids are cached on
`scheduling_projects` and reused, so a poll is one GraphQL query rather than
that plus a `project view` and a `field-list`. Any board error clears that
cache, so a renamed or recreated field re-resolves on the next pass instead of
failing the same way forever.

## Reconciliation

On each pass with a linked board:

1. Read the board's items in board order (a GraphQL query; see below).
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

**An unfinished projection is not a drag.** A projection marks the Project
`projection_in_flight` before its first write and clears it only after the
last one succeeds. If a write fails partway — a rate limit, a network drop —
the board is left in an intermediate state that matches neither the canonical
order nor the last projected one. Without the flag the next pass would read
that difference as an operator drag and persist a half-applied order as their
intent, silently reverting part of an `advance queue` reorder and logging it
against them. While the flag is set, operator detection is skipped and the
pass re-projects instead.

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

Discovery writes these Actions into the Plan directly rather than through an
Agent Ask. Decision 0059 ratified that as a bounded exception: only the three
classes above, each with acceptance criteria, committed and never pushed,
refused on a dirty repository, every one logged with its origin, and capped by
the breakers below. A blocker has to become the next runnable work inside the
same Run, and an Ask waits for operator settlement, so routing it that way
would stall the Run on the thing the blocker was raised to clear. Every other
governance write still requires an Ask.

Three fixed circuit breakers stop runaway branches: discovery depth 2,
three corrective descendants per root Action, eight discovered correctives per
Milestone. Crossing any of them opens a Decision carrying the proposed Action
and writes nothing to the Plan or queue.

## Execution budget

`recordFailedRun` counts failed Runs per Project and active Milestone. The
ninth failure pauses the Project (no pointer moves, no launches) and opens a
Decision, whose id is stored on the Project's scheduling row.

`arcadia schedule resume --project <slug> --reason ...` clears the pause and
the counter, and **refuses while that Decision is still open or deferred**. The
pause exists to force exactly one judgment — whether this Milestone deserves
more attempts — so a resume that could clear it without an answer would be a
way to skip the judgment rather than make it. Answer the Decision first
(`arcadia review approve <id>` or `arcadia review reject <id>`); either answer
unblocks resume, because either one is a judgment.

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

- `gh project view` and `field-list` to resolve the board and its status field;
- `gh issue create` for Issues, `gh project item-add` to put one on the board,
  `gh project item-edit` to set a status;
- GraphQL for reading items and for `updateProjectV2ItemPosition`.

Status is carried on a single-select field named `Arcadia status` with options
`Needs operator`, `Ready`, `Running`, `Blocked`, `Done`, `Backlog`. GitHub's
built-in `Status` field is left alone because its options cannot be renamed
through the API; the operator groups the board view by `Arcadia status`.

**Reading items is a GraphQL query, not `gh project item-list`.** `item-list
--format json` flattens custom fields into camelCased keys derived from the
field's title, so "Arcadia status" arrives under a spelling this code would
have to guess. Guessing wrong is not a visible failure: every status reads as
absent, so the projection believes no card has a status and rewrites all of
them on every tick, forever. GraphQL's `fieldValueByName` takes the name
verbatim and answers for that field alone. `tests/scheduling-github-adapter.test.ts`
holds a `CommandRunner` fake that proves a second projection over a healthy
board issues no writes at all.

**Only `schedule github link` changes the board's schema.** It calls
`ensureBoardStatusField`, which creates the `Arcadia status` field when the
Project has none. Every other path — `schedule reconcile` with or without
`--apply`, and every worker tick — opens the board through `createGitHubBoard`,
which reads and refuses a board with no status field rather than creating one.
A preview therefore performs no GitHub mutation of any kind, including schema.

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
