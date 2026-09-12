---
arcadia: v1
type: proposal
project: arcadia
question: Should Arcadia render an operator procedure as a guided surface — one step at a time, with resumable state and a place to supply the judgment, evidence, and approvals only the operator can give — instead of handing over prose the operator must hold in their head?
---

# The operator procedure surface

## Why this project needs it

On 2026-09-11 the operator, part way into a multi-hour day, said: *"I feel
scattered and ran out of time before getting the work done."* The work in
question was a procedure Arcadia had already specified completely — an
eight-step rehearsal with exact commands and observable results, sitting in a
correct, thorough runbook.

The runbook was not the problem. **Prose was.** Reading a 300-line document to
find the next physical move, on a tired afternoon, is the "morning archaeology
session" that
[`docs/operator-demo-and-release-contract.md`](../operator-demo-and-release-contract.md)
already says the operator does not owe this Project. That contract states the
obligation plainly — Arcadia owes "one exact next thing" — and then leaves the
delivery of it entirely to prose.

A throwaway guided surface was built as a stopgap and worked immediately:
<https://claude.ai/code/artifact/12f5ee1c-a867-4a3f-a23a-d09d3622e5d3>

The operator's response — *"I love the rehearsal runbook wizard UI ... it should
be templatized so that Arcadia Operators can provide their directed input with
excellent UX"* — is this proposal's origin.

## What made the prototype work

Not decoration. Five specific properties, each of which the prose version also
technically had, and none of which it *delivered*:

- **One step fills the screen; everything else is put away.** The page names
  what it is excluding and where that lives, so excluded work stops competing
  for attention instead of merely being elsewhere.
- **Each step carries its own command, expected result, and known trap** — so
  starting requires no decision. The operator's own finding from the day before:
  *"Every block today started with the move already chosen."*
- **State survives the session.** Closing the tab, or the day, loses nothing.
  This is what makes a procedure resumable rather than restartable — the
  difference between "ran out of time" and "stopped at step 5."
- **Advancement can be gated.** The boundary-confirmation step will not release
  the next button until every box is genuinely ticked. A rendered gate enforces
  what a prose checklist can only request.
- **Remaining cost is always visible.** "Step 4 of 8, ~40 min left" is the
  number that decides whether to start, and prose never carries it.

## The shape this generalizes

Arcadia already produces this exact structure — an ordered procedure with
observable checkpoints — in at least three places, and renders all three as
prose:

| Where | What it already requires |
| --- | --- |
| PR QA plans | [`AGENTS.md`](../../AGENTS.md) mandates "numbered operator steps with observable expected results" on **every** pull request at a stopping point |
| Operator runbooks | `docs/reports/*-runbook.md` — ordered steps, expected output, fill-in evidence blanks |
| Action acceptance criteria | Per-criterion observable completion, which open proposal **R168** already asks `focus` to render |

Three names for one shape. A single renderer would serve all three, and R168 is
the nearest existing home: it asks whether acceptance criteria should carry
per-criterion state "so progress inside a single Action is legible to the
operator without being narrated in prose." This proposal is that question asked
about whole procedures rather than single Actions, and with the operator's
*input* included rather than only their progress.

## "Directed input" is the part that is not a checklist

The operator's phrasing matters. `PROJECT.md` describes their role as supplying
"the scarce human inputs — product judgment, feedback, credentials, and
consequential approvals." Today every one of those arrives by reading prose and
then typing a CLI command with flags discovered one refusal at a time.

A procedure surface is where those inputs could be *collected*:

- a Decision answered by choosing a stated option with its consequence, rather
  than by hand-writing a Decision document;
- evidence captured per acceptance criterion as the step completes, instead of
  reconstructed afterwards into an `evidence:` block whose exact schema is
  itself a source of refusals;
- an approval given against the specific boundary it applies to, at the moment
  it applies;
- a blocker recorded where it was hit, with its context already attached.

This is the difference between a checklist that tracks the operator and a
surface that *serves* them. It is also where this proposal earns its keep: the
portfolio currently holds 20 Decisions awaiting an answer, and their cost is not
the deciding — it is the archaeology required before each one can be decided.

## Relationship to work already planned

- **`operator-attention-routing`** routes attention *to* the operator — GitHub,
  Discord, each meaningful next action once. This proposal is about what the
  operator arrives at. Complementary; neither substitutes for the other.
- **R168 (`focus`)** is the nearest existing request and may be the right home;
  see the open questions.
- **`docs/operator-demo-and-release-contract.md`** already establishes the
  obligation. This is a delivery mechanism for it, not a new promise.

## What we would build locally

Nothing, per Decision 0025. The stopgap is a hand-authored page per procedure,
which is exactly what was done today and does not scale past one.

Its costs, stated plainly: every step was transcribed by hand from the runbook,
so the two diverge the moment either changes; the page cannot read Arcadia state,
so it cannot tick a step that Arcadia could verify itself (the broker revision,
the fixture's cleanliness, the pointer's position — all machine-checkable, all
ticked by hand); and nothing it collects flows back into Arcadia.

## What would make this answerable

Judgments for the operator, not the agent:

1. Does this belong inside R168's `focus`, or is it a separate surface that
   `focus` feeds?
2. What is the procedure's source of truth — a new document type, the PR QA
   plan's numbered steps, an Action's acceptance criteria, or a runbook parsed
   into steps?
3. Should steps Arcadia can verify deterministically tick **themselves**? Nearly
   every step in today's rehearsal was machine-checkable from existing read-only
   commands. This is the largest single improvement available and also the
   largest build.
4. Where does it render — the existing dashboard, a published artifact, or the
   terminal? The prototype was a published page because the operator wanted it
   reachable from a phone, mid-task.
