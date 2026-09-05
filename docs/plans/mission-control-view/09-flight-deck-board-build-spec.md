# Flight Deck Board — Build Specification

> Scope update proposed 2026-09-05: read [the reuse audit](./11-existing-surfaces-audit.md),
> [operations contract](./12-flight-deck-operations-contract.md), and
> [delivery sequence](./13-flight-deck-delivery-sequence.md) before implementation.
> The operator now requires direct launch with automatic agent selection and a
> complete operational home. The [Agent Ask](./14-flight-deck-plan-amendment.yaml)
> proposes replacing the copy-only launch boundary and incomplete coverage
> assumptions below; its expanded Actions require operator settlement.

The buildable slice of this series. Docs 00–08 settled the recursive node
shape, the urgency model, the camera, and the eventual spatial view. This one
specifies the surface that has to exist before any of that pays off: **one
board carrying every governed object in the portfolio.**

Governed by plan
[`flight-deck-board-carries-the-whole-portfolio-on-one-surface`](../flight-deck-board-carries-the-whole-portfolio-on-one-surface.md),
filed as Agent Ask `flight-deck-board-2026-09-04b`.

## Why this and not the next page

A live capture on 2026-09-04 held **54 governed objects across 5 Projects** —
13 Actions, 21 Decisions, 10 Runs, 10 Artifacts — spread across 13 Plans of
which only 3 are an active plan. Three findings shaped the design:

1. **The backlog is mostly dormant, not urgent.** Decisions sat against
   `imagery-first-class`, `pilot-one-consultation-to-site`,
   `client-site-growth-platform` and `arcadia-ask-active-sessions` — plans
   that are not active. Mixing them with active-plan work is most of the
   overwhelm.
2. **Missing context is a missing field, not a missing panel.**
   `DashboardReviewItem.context` is `"<intent>: " + proposedAction` — a
   restatement. Only **2 of 21** review items carry a structural link to an
   Action; a further 6 name their Plan in prose only; 13 name none.
3. **Nothing connects the queue to a session.** A queue entry knows its
   `repositoryRoot`, and `--launch` is documented in `src/commands/go.ts` as
   the only flag that authorizes process creation — but no dashboard surface
   shows the command.

Everything the board needs already ships in `advance queue --json` and
`dashboard snapshot --json`. This is a projection, not new state.

## Data sources

| Source | Route | Carries |
| --- | --- | --- |
| `advance queue` | `/api/work-queue` | Actions with `planSlug`, `planPath`, `repositoryRoot`, `milestone`, `outcome`, `effort`, `tokenImpact`, `tokenBudget`, `acceptanceCriteria`, `dependencies`, `decisions`, `blockers`, `orderKey`, `position` |
| `dashboard snapshot` | `/api/snapshot` | `requiresReviewItems`, `attentionItems`, `recentRuns`, `recentArtifacts`, `projects` |

No new CLI command. No new table.

## Lanes

A lane is **one Plan within one Project**. It is the Arcadia object that
already does what Jira calls an epic: ordered Actions under one Milestone with
one declared token budget.

Lane assignment, in order:

1. An Action from the queue → `projectSlug::planSlug`. The queue only ever
   carries a Project's active plan, so every lane it produces is active.
2. A Decision → the lane of the Action named by the `attentionItem` whose
   `relatedReviewId` matches it. This is the only structural link available.
3. A Decision with no such link → the Plan named in its prose, if one is
   named. Recovered 6 of the 21 in the capture. Mark the edge as
   `named in prose`, never as a structural relation.
4. Anything left → that Project's **unattached lane**, labeled as such.

The unattached lane is not a failure state to hide. It is the honest display
of finding 2, and it is where the eventual "attach this Decision to an Action"
affordance will live.

Lane ordering: active plans first, then by Project, then unattached last.

## Columns

Five, and they are Arcadia's own gates rather than generic board states. A
card only moves by satisfying the gate it sits behind.

| Column | Holds | Gate |
| --- | --- | --- |
| **Needs you** | Decisions requiring judgment; Actions whose `blockers` are non-empty; failed Runs | Operator judgment |
| **Ready to dispatch** | Queue entries in state `ready` | Clarified, authorized, verb-first `next_action` |
| **Running** | Runs in flight | One session per Project — one branch, one worktree (`docs/working-copy-safety.md`) |
| **Proving** | QA signoff and artifact-validation Decisions; Runs awaiting review | Evidence |
| **Landed** | Recent Artifacts | Recorded against the Log |

`CandidateQaSignoff`, `IndependentPullRequestQa` and
`codex_planning_artifact_validation` belong in **Proving**, not Needs You:
they are about verifying delivered work, not unblocking it. In the capture
that alone moves 7 items out of the Needs You column.

## Cards

Entity types stay named. A card is never a generic ticket.

- Type chip: `ACTION` · `DECISION` · `RUN` · `ARTIFACT`, each with its own tint.
- Title, then the one line that says what happens next (`next_action` for an
  Action, `decisionNeeded` for a Decision).
- Badges: responsibility, effort, token impact, blocker count.
- The pointer-authorized next Action is marked `NEXT`; queue position is shown
  where one exists.
- A left stripe carries the column's semantic colour so state reads at a glance.

## Detail rail

Selection opens a rail, not a new page.

**The chain** is the fix for finding 2: `Project ▸ Plan ▸ Action ▸ Decision ▸
Artifact`, each node labeled with its Arcadia type, each edge labeled with its
relation — `requires`, `depends on`, `will produce`, `blocks`, `evidence`,
`named in prose`. Where the chain cannot be derived, the rail says so in place
of guessing.

**The record** below it: expected Artifact, acceptance criteria, dependencies,
required Decisions, token budget, and every blocker with its `remedy` string.
For a Decision: decision needed, options, recommendation, prompt packet path.

Escape closes it and returns focus to the card that opened it.

## The command

Every card that can move carries the literal invocation that moves it.

- Ready Action → `arcadia go --repo <repositoryRoot> --agent <agent> --apply --launch`
- Decision → `arcadia review approve <id>`

The board never spawns a process. `--launch` is the only flag that authorizes
process creation and it stays in the operator's terminal — a copy button is
the whole feature. Where the clipboard is unavailable, select the text instead
so it can still be copied by hand.

## Defaults at rest

Opening the board must show the work that can move today, not the portfolio's
total size:

- Active-plan lanes expanded; every other lane collapsed to a labeled row with
  its object count.
- Filtered to Projects that have an active plan.
- Both the visible count and the portfolio total shown, so nothing appears
  hidden.

In the capture this is **16 cards instead of 54**, with the other 38 one click
away.

Expanding, collapsing and filtering are view state only. They never write.

## Deliberately out of scope

| Not building | Why |
| --- | --- |
| Drag-and-drop reordering | `advance queue reorder` already previews, applies and leaves an undoable receipt; dragging means re-implementing that contract in the browser |
| Launching tmux from the browser | `--launch` authorizes process creation; that boundary stays with the operator |
| The 3D / force-directed view | Docs 02–04 own it. Doc 05 already establishes the list view as permanent parity, not a fallback |
| Retiring `/review`, `/work-queue`, `/now` | Prove the board carries a real week first |
| Weekly token budgeting | Independent of this board — see [10](./10-session-unit-ledger-deferred.md) |

## Verification

- Column derivation and lane assignment are pure functions over the two
  endpoint payloads, covered by fixture tests. Fixtures should include a
  Decision with a structural link, one with only a prose link, and one with
  neither.
- Nothing in the board issues a write; the QA plan proves the queue revision
  is unchanged after a full session of browsing.
