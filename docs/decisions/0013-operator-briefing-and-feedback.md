---
arcadia: v1
type: decision
id: "0013"
slug: operator-briefing-and-feedback
project: arcadia
status: open
question: The operator has to read every open pull request across every managed Project to learn what is actually at stake in them. Should Arcadia produce that briefing itself, and capture the operator's response to it as governed feedback?
gap_type: missing-decision
recommendation: Yes, but build almost none of it. `work pull-requests` already inventories open pull requests across monitored Projects, and `review`/`feedback` already capture an operator verdict with a note. Neither reads what a pull request contains. Add one interpretation layer over the existing inventory — undisclosed content, forced merge order, control-document pointer moves, schema migrations, approval-boundary crossings, and open Decisions that collide — and route the operator's answer into the review-feedback path that already exists. One connection and one new read view, not a new subsystem.
confidence: medium
updated: 2026-08-09
---

# Decision 0013: The operator briefing, and taking the operator's answer back

## Context

On 2026-08-09 the operator had six open pull requests across two Projects and
asked, in effect, *what happens if I merge these, and what do I need to know
first?* Answering it required reading every pull request body, every diff
stat, every changed control document, and the CI history — by hand, in one
session, at a cost the operator should not pay again every time work
accumulates.

What that read surfaced is the point. None of it was visible from the pull
request list, and four of the five findings were not visible from the pull
request **descriptions** either:

1. **Undisclosed content.** Arcadia #43, described as digest scheduling,
   also contained `docs/decisions/0012-the-session-primitive.md` and
   `docs/operating-model.md` — 420 lines of governance material the body never
   mentioned.
2. **A forced merge order.** Arcadia #44 was based on #43's branch rather than
   `main`. Merging it first was not possible and closing #43 would have
   orphaned it. Nothing in either title said so.
3. **Colliding open Decisions.** 0011 (in #40) and 0012 (inside #43) propose
   the same primitive with materially different shapes. Ratifying either
   without the other in view would have committed the operator to a design the
   other argues against.
4. **A schema migration against real operator data.** #43 rebuilds the
   `narrative_digests` table because SQLite cannot drop `NOT NULL` in place.
5. **A new outward-facing behavior.** After #43, digests post to Discord on a
   cadence with no further prompting — and `CONSTITUTION.md` names sending
   messages as an approval boundary.

A merge-order constraint and an approval-boundary crossing are exactly the
class of thing this system exists to stop the operator from discovering late.

### Three quarters of this is already built

Before proposing anything, the same discipline Decisions 0009, 0010, and 0011
applied to themselves: read what exists rather than assume a green field.

- **`arcadia work pull-requests`** (`src/commands/workPullRequests.ts`) already
  calls `listOutstandingPullRequests` over `listMonitoredProjects` and returns
  an `OutstandingPullRequestsSnapshot`. **Cross-Project pull request inventory
  is done.**
- **`arcadia review`** (`src/commands/review.ts`) already has review items,
  `listActionableReviewItems`, `buildWeeklyReviewData`, and
  `createReviewFeedback`. **A governed operator verdict with a note is done.**
- **`arcadia feedback record`** (`src/commands/feedback.ts`) already writes an
  `AskFeedback` row — decision plus note, tied to an ask. **Feedback capture
  is done.**
- **`arcadia docket`** already reports outcome, milestone, active action,
  blockers, and Decisions as a read-only view. **The reporting idiom is
  established and should be matched, not reinvented.**

This is the same shape Decision 0011 found: *the gap is one missing
connection, not three missing systems.* What no existing command does is
**read what is inside a pull request and say what it means.** The inventory
knows a pull request is open; it does not know that it moves `active_plan`,
carries an undisclosed Decision, or cannot merge before another one.

## Decision (proposed)

Add **`arcadia briefing`** — a read-only view, in the same family as
`docket`, that answers "what is at stake in the open work right now" across
every monitored Project, and accepts the operator's answer back.

### 1. Read-only, like `docket`

`briefing` never merges, closes, approves, comments, or dispatches. It is a
lens over records that already exist plus the diffs of open pull requests.
This keeps it outside every approval boundary in `CONSTITUTION.md` and means
it can be run freely, including on a schedule, without authorization.

### 2. Reuse the inventory, add only interpretation

`listOutstandingPullRequests` supplies the set. For each entry, the briefing
computes a small fixed list of **material facts** — chosen because each one is
a thing the operator would have had to read a diff to learn:

| Fact | Why it earns its place |
| --- | --- |
| Base is another open pull request | A forced merge order, invisible in the title |
| Touches `PROJECT.md` or a plan's `current_action` | The work pointer moves; the next session's priority changes |
| Adds or changes a `type: decision` document | Governance content, especially when the body does not mention it |
| Changes `src/db/schema.ts` or any migration | Operator data is rewritten |
| Introduces outward-facing behavior | Posting, sending, deploying — approval boundaries |
| Files changed but unmentioned in the body | The undisclosed-content check that found 0012 |
| CI conclusion on the head commit | Whether the claim of green is current, not stale |

**The undisclosed-content check is the highest-value item and the cheapest.**
It is a set difference between changed paths and paths named in the pull
request body. It would have caught finding 1 with no model call at all.

### 3. Deterministic first, model second

Every fact above is computed by rule, not narrated. A model call is used only
to write the short prose gist over already-computed facts, and only when the
operator asks for it. This keeps a routine briefing at `token_impact: none`
and matches `AGENTS.md`: prefer deterministic workflows, prefer local scripts
before AI.

### 4. Collision detection across open Decisions

Two open Decisions that name the same primitive is a state the operator must
be told about, because ratifying one silently constrains the other. The
briefing lists open Decisions across all in-flight branches, not only `main`,
and flags overlap. This is the finding that has no equivalent anywhere in the
current system.

### 5. Feedback routes into what already exists

The operator's answer — *merge this, hold that, this decision supersedes that
one* — is recorded through `createReviewFeedback`, the same path
`arcadia review` already uses, so it lands where Decisions and review history
already live. **The briefing does not act on the answer.** It records it, and
the acting stays with the operator or with a later, separately authorized
dispatch step.

## What this explicitly does not do

- **No new inventory, feedback store, or reporting idiom.** All three exist.
- **No acting on its own findings.** No merge, no close, no comment, no
  dispatch. A briefing is evidence, not authorization — the same boundary
  #44's QA sign-off draws.
- **No replacement for `docket`.** `docket` answers "what should I do next";
  `briefing` answers "what is at stake in what is already in flight." If they
  converge in practice, merge them then, on evidence.
- **No pull request writing.** It reads GitHub; it does not post to it.

## Open questions for the operator

1. **Cadence.** On demand only, or also on the digest schedule #43 introduces?
   Scheduled briefings are the reason to keep the deterministic path free of
   model calls.
2. **Delivery.** Terminal only, or also Discord — given a phone is often where
   the operator actually is, and #43 is already building that channel?
3. **Does the undisclosed-content check become a rule rather than a report?**
   It could be a pre-merge warning, or eventually a convention that a pull
   request body must account for every changed path. The second is a stronger
   guarantee and a real constraint on every coding agent, including this one.
4. **Scope of "material fact."** The seven above are the ones a real session
   needed. Adding more is easy and each one dilutes the signal; this list
   should grow only from findings a briefing actually missed.

## Consequences if approved

- The operator stops paying a full-session read to answer "what happens if I
  merge these," and stops relying on pull request descriptions being complete.
- Three built-but-unconnected systems get their first shared consumer, which
  is a real test of whether their boundaries hold.
- Arcadia gains a habit of reporting what is *at stake* rather than only what
  is *ready* — the operator-facing half of the same discipline `next` and
  `docket` already apply to dispatch.

## Revisit triggers

- A briefing misses a finding the operator then hits at merge time — the
  material-fact list is incomplete and should grow by exactly that fact.
- The briefing and `docket` are consistently read together, suggesting one
  view rather than two.
- Pull request bodies become reliably complete, which would retire the
  undisclosed-content check rather than keep paying for it.
