---
arcadia: v1
type: plan
slug: decision-queue-reconciliation
project: arcadia
status: proposed
milestone: The operator is asked exactly one question a day, and it is never one already answered
token_impact: low
token_budget: "Reconciliation is pure document parsing and SQL — no model calls. The dashboard slice is deterministic React. Only the deferred recommendation work in 'If not now, then when?' would spend model tokens."
recommended_model: gpt-5.6-luna
recommended_reasoning_effort: medium
updated: 2026-08-30
open_questions: []
actions:
  - id: build-resolution-reconciler
    title: Match plan-document resolutions to open review items
    status: open
    responsibility: agent
    effort: short
    clarification: clarified
    confidence: high
    next_action: Add src/stewardship/reconcileResolutions.ts exporting a pure function that takes managed plans plus open review items and returns the items whose question now carries a resolution, with that resolution text as the proposed answer.
    expected_artifact: A pure, tested function returning the close-list — no database writes
    source: "Verified 2026-08-26 against workspaces/martianrover: 7 of 18 open review items (R95, R55-R60) already carried a written resolution."
    depends_on: []
    acceptance_criteria:
      - "A review item whose doc_ref names a plan question carrying a `resolution:` field appears in the close-list with that resolution as the answer text."
      - "Both YAML scalar forms parse — inline and block folded. R55/R56 use the first, R57-R60 the second."
      - A review item whose question has no resolution is never in the close-list.
      - A doc_ref naming a plan or question that no longer exists is reported as unmatched, not silently dropped.
      - The function performs no writes and no model calls.
  - id: add-review-reconcile-command
    title: Close already-answered decisions from the command line
    status: open
    responsibility: agent
    effort: short
    clarification: clarified
    confidence: high
    next_action: Add `arcadia review reconcile` calling build-resolution-reconciler, previewing by default and writing only under --apply, recording each plan's resolution as the decision note.
    expected_artifact: "`arcadia review reconcile` closing every already-answered decision in one run"
    source: "Done by hand 2026-08-26; the manual pass is the specification."
    depends_on: [build-resolution-reconciler]
    acceptance_criteria:
      - Running with no flags previews the close-list and writes nothing, per the constitution's preview-before-write rule.
      - "`--apply` closes each item via the existing approve path, so no second write path exists."
      - The recorded decision note names the plan and question the answer came from.
      - Unmatched doc_refs are listed separately as a repair task, not counted as closed.
      - Re-running immediately after --apply closes nothing and says so.
  - id: carry-answer-affordance-into-now
    title: Give the Now brief what it needs to be acted on
    status: open
    responsibility: agent
    effort: short
    clarification: clarified
    confidence: high
    next_action: Extend TheOneThing in src/northStar/types.ts and compute.ts with the decision's recommendation and a resolve href, and add the count of items reconciliation closed.
    expected_artifact: A Now brief carrying recommendation, resolve target, and closed-count
    source: "apps/dashboard/app/now/page.tsx renders OneThing as text only; the brief carries no target to link to."
    depends_on: []
    acceptance_criteria:
      - A decision-kind one thing carries its recommendation text when the review item has one, and null when it does not.
      - It carries a resolve target addressing the review item directly, including items with no work_item_id — R95 had none.
      - The brief reports how many items the last reconcile closed.
      - Briefs for action-kind and clarify-kind one things are unchanged.
  - id: make-the-now-card-answerable
    title: Answer the one thing without leaving the screen
    status: open
    responsibility: agent
    effort: short
    clarification: clarified
    confidence: medium
    next_action: Render Accept and Answer differently on the Now one-thing card when it is a decision, posting the recommendation as the answer and linking to the existing Resolve page respectively.
    expected_artifact: A Now card that closes a decision in one tap
    source: "OneThing() and FifteenMinutes() in apps/dashboard/app/now/page.tsx contain no href and no handler."
    depends_on: [carry-answer-affordance-into-now]
    acceptance_criteria:
      - Accept appears only when a recommendation exists, and posts exactly that text as the answer.
      - Answer differently links to the existing Resolve page rather than adding a second answer box.
      - After a successful answer the card advances to the next one thing without a manual reload.
      - A refusal from the server reverts the card and states the reason, matching how the gate toggle already behaves.
      - No Not now control ships in this Action — see the deferral below. A control that cannot keep its promise is not shipped.
decisions: []
---

# The operator is asked one question a day, and never an answered one

## What is actually broken

Measured against `workspaces/martianrover` on 2026-08-26, with 18 decisions open:

| Mechanism | Evidence |
| --- | --- |
| Answering never closes | 7 of 18 items (R95, R55–R60) carried a written `resolution:` in their own plan. R95 was answered 23 Aug, shipped in `wrangler.jsonc`, and was still the top item on Now on 26 Aug. |
| Now cannot act | `OneThing()` and `FifteenMinutes()` render `<p>` only — no `href`, no handler. Gate checkboxes post; the one thing does not. |
| Deferral is cosmetic | `listActionableReviewItems` returns open **plus** deferred (`src/db/repositories.ts:1511`), and `review_items` has no `trigger` column. |
| Questions arrive as homework | 11 of 14 open items had an empty `recommendation`. The column exists and is simply not filled. |

The first two are the root causes. The second two are structural and are deferred below,
with triggers.

## The 80/20 analysis

**The vital few: reconcile, then make the card answerable.**

Reconciliation removed 7 of 18 items by hand today — 39% of the queue, permanently,
with zero operator input. It is the cheapest possible win because it asks the operator
nothing: the answers already exist, in documents already checked in. Nothing else on
this list deletes work rather than reorganising it.

Making the card answerable is the other half, and it is cheap for the reason the 80/20
rule predicts: **the expensive part is already built and merely unreachable.** The
Resolve page (`app/path/resolve/[id]`) already takes one Action, its blocking question,
and one answer box, and running it completes the whole clarify loop. The approve
endpoint already works. This Action adds two controls and a link — it does not build an
answering surface, it connects one.

The remaining three candidates from the 2026-08-26 review are real and subordinate;
each is deferred below rather than dropped.

## The YAGNI analysis

Three things were cut from the original proposal, and the cuts are the point:

**A new `arcadia jam` command namespace — cut.** The original design proposed a
noun/verb pair for clearing jams. There is exactly one concrete caller, and
`arcadia review` already owns this domain, already has the help text, and is already
where the operator looks. A new namespace would be a second mental model serving one
function. It is `arcadia review reconcile`.

**A dedicated log-jam route — cut.** Now already declares itself the screen the
operator bookmarks, and its selection reasoning is sound. A sixth destination added to
ten the operator already cannot choose between makes the navigation problem worse while
leaving the cause untouched. Reconciliation runs *before* Now renders, so the queue is
true by the time it is read.

**The Not now control — cut from the first slice.** It cannot keep its promise until
`review_items` has a `trigger` column and deferred items leave the actionable list.
Shipping a button that silently does nothing is worse than not shipping it, so it waits
for the deferred item that makes it honest.

## The divide-and-conquer split

Four Actions, each finishable in one sitting, each shippable alone:

- `build-resolution-reconciler` is a pure function with no writes, so it can be tested
  against the seven known-stale items before anything can close the wrong thing.
- `add-review-reconcile-command` adds only the CLI shell and the preview/apply gate.
- `carry-answer-affordance-into-now` is a data change with no UI, so the brief can be
  verified as JSON before any pixel moves.
- `make-the-now-card-answerable` is the only Action that touches the dashboard.

The split is deliberately along the write boundary: the first two shrink the queue
without the operator present, the second two change what the operator sees. Either pair
delivers value if the other never ships.

## If not now, then when?

**Require a recommendation on every question.** Deferred. Eleven of fourteen open items
had none, which is what makes each one homework rather than a decision.
*Trigger: the first reconciled queue that still leaves more than three questions the
operator has not answered within a week.* If reconciliation and gate scoping cut the
queue to one or two, an unrecommended question is an annoyance rather than a jam, and
this becomes model-token spend buying very little.

**Give deferral a trigger and make it real.** Deferred, but expected to fire
immediately. Needs a `trigger` column on `review_items`, deferred items dropped from
`listActionableReviewItems`, and reactivation when the trigger fires.
*Trigger: the first reconcile run whose surviving queue contains a question whose work
is not the current North Star gate.* R53 and R54 are review-workspace questions that
block no gate today, so this will almost certainly fire on the first run — at which
point it becomes the next Action, and `Not now` ships with it.

**Scope the Now decision list to the current gate.** Deferred. `compute.ts:59-60`
filters `openReviews` by `project_id`, not by gate, so asset-library questions compete
with the one blocking the next gate.
*Trigger: a reconcile run after which more than one question survives for the target
project.* Not folded into the first slice because the gate-to-question mapping does not
exist yet and its cost is unknown; reconciliation may make the distinction moot.

## What was already done by hand

On 2026-08-26, R95 and R55–R60 were closed using their own plans' recorded resolutions.
That manual pass is the specification for `build-resolution-reconciler`: the function is
correct when it would have produced exactly that close-list. R53, R54, R61, R73 and R96
were left open as genuine operator judgment, R96 being the only one gating
`intake-reachable`.
