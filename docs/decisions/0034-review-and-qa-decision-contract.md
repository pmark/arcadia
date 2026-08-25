---
arcadia: v1
type: decision
id: "0034"
slug: review-and-qa-decision-contract
project: arcadia
status: approved
question: The QA queue records three verdicts that produce no visible change and a note nothing reads, and /review lists every open question with no ordering or consequence. What are these two surfaces for?
gap_type: missing-decision
recommendation: Bind QA cards to their own recorded verdicts and give Fail and Needs follow-up distinct consequences; scope /review to questions blocking dispatchable work, then grow it into the plan approval surface where a prepared plan is approved now or deferred against a named trigger.
confidence: high
updated: 2026-08-25
answer: "Both: /review becomes the plan approval surface where a prepared plan is read, refined, and approved now or deferred against a named trigger, with a blocking-questions filter as its independently shippable first slice; and QA cards read their own last verdict back, with Fail creating an open Action, Needs follow-up creating an open question, and the note becoming that item's body. Sequenced behind Private Practice Now's launch path, which does not run through either surface."
decided: 2026-08-25
---

# Decision 0034: What the Review page and the QA verdicts are for

## Problem

Two operator-facing surfaces record operator judgment and then drop it.

**The QA queue.** `loadQaCandidates` (`src/commands/qa.ts:83`) builds each card
from `config/qa-targets.json` plus git freshness, and never reads a recorded
verdict back. A card is therefore byte-identical before and after a verdict is
recorded, which is why nothing appears to happen when Pass is clicked.
`runQaRecordCommand` creates a review item and resolves it in the same
transaction, so it never enters any queue either. Its one downstream reader is
`getLatestQaDecisionForCandidate` (`src/commands/proofTargets.ts:46`), which
feeds the demo hero on a different page that the QA card does not link to.

Within that hero, **Fail and Needs follow-up resolve to the same state**
(`qa_failed`), differing only in one sentence of detail. The optional QA note is
written to `context_json` and `decision_note` and is read by nothing except the
narrative digest composer (`src/digests/composer.ts:79`), which may mention it
in a roll-up days later. Careful QA notes therefore create no work and change
nothing.

**The Review page.** `/review` renders every open review item flat. As of
2026-08-25 that is 24 open items, all `ActionClarification`, spanning two
Projects, in no order, none stating what it blocks. Answering one does write the
answer and continue the Action, but the page never says so. The operator reports
never using it, which is rational: `arcadia next` delivers the one blocking
question with its plan, objective, and standing constraints attached, and a flat
list of 24 detached questions cannot compete with that.

## Why

Both surfaces were built to *record* judgment, and neither was given a consumer
that makes the recording visible where it was made. A queue has value only when
acting on an item changes what happens next; a verdict vocabulary has value only
when its terms have different consequences. Neither condition currently holds.

## Fix

**QA cards become stateful.** `loadQaCandidates` reads each target's latest
`CandidateQaSignoff` — the query already exists — and returns the verdict, its
revision, and when it was recorded. The card shows its own last verdict, decided
cards sort below undecided ones, and a verdict recorded against an older
revision reads as stale rather than as a current pass.

**The three verdicts get three consequences**, which is what makes the note
load-bearing:

- **Pass** records evidence bound to the revision and settles the card. It still
  does not merge, deploy, or release.
- **Fail** creates an open Action on that Project. Something is broken and
  someone must fix it; the note becomes the Action's stated problem.
- **Needs follow-up** creates an open question. Something is unclear and someone
  must decide; the note becomes the question.

Carrying two verdicts that mean the same thing is the queue overstating its own
precision. If the distinct consequences are not built, one of the two buttons is
removed instead.

**`/review` becomes the plan approval surface.** Its destination is the job that
is genuinely operator-only and genuinely better away from a terminal: read a
prepared plan, refine it, then approve it now or defer it against a named
trigger. That is the operator half of `promote-accepted-plan`, and Decision 0029
already built the half in front of it (`arcadia project prepare`).

The first slice is smaller and ships independently: filter the flat list to
questions standing in front of currently dispatchable work, ranked by what they
release, each naming the Action it unblocks. `arcadia next --ready` already
computes that set. Answering then visibly moves work, which is the property the
page lacks today.

## Resolution

Approved on operator direction, 2026-08-25. Both recommendations were selected
explicitly: `/review` becomes the plan approval surface with the
blocking-questions filter as its first slice, and the QA cards get read-back plus
distinct per-verdict consequences.

Sequencing is deliberately *not* set by this Decision. Private Practice Now's
launch is the operator's live priority, and its critical path runs through PPN's
own `pilot-one-consultation-to-site` plan, not through either surface here.
These Actions are queued behind that work rather than ahead of it.

Out of scope: reworking the QA verdict vocabulary beyond the three existing
terms, adding drag-and-drop or column layouts to either page, and any change to
what a QA verdict authorizes — recording QA still never merges, deploys, or
releases.

## Revisit triggers

- The blocking-questions filter ships and the operator still does not open
  `/review` within two weeks of normal use — meaning the plan approval slice
  should be reconsidered or the page retired outright rather than extended.
- A second operator or a delegate begins performing QA, at which point Fail
  creating an Action needs an assignee concept this Decision does not define.
- `promote-accepted-plan` lands with an approval path that is already adequate
  from the terminal, meaning the plan approval surface is solving a problem that
  no longer exists.
