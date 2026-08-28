---
arcadia: v1
type: decision
id: "0037"
slug: project-to-arcadia-signal-channel
project: arcadia
plan: null
action: null
status: open
question: How does an agent working in an adopting project send Arcadia something that needs Arcadia's own governance — a Way change, a defect in Arcadia's own code, or a finding worth recording — and have it actually reach the operator, rather than sitting in a document type that is recognized but never surfaced?
gap_type: missing-decision
recommendation: >-
  Stop routing every project-to-Arcadia signal through `type: proposal`, and
  stop hand-writing `.arcadia/ingress/*.txt` notes to compensate for the ones
  that need attention. Both are misfiled: `proposal` is correctly `reported,
  never dispatched` for something that is genuinely read-only, but a request
  needing the operator's Approve/Reject/Defer is a `type: decision` document,
  which already syncs, already surfaces on the portfolio's "Waiting on you",
  and already carries every field this needs (`question`, `recommendation`,
  `confidence`, `status`). An agent that determines a Way change requires
  Arcadia's own governance should author that Decision directly, in the
  Arcadia repository, `status: open`, with no `answer` — the same shape as
  every existing Decision, not a new envelope. Retire the ingress convention
  once one such Decision is confirmed reaching the board this way. Treat a
  reproducible defect in Arcadia's own code the same way until a dedicated
  defect record exists: a Decision whose question is "should Arcadia fix X,"
  which is honest about today's tooling rather than inventing a second
  channel for a case that has not yet recurred. Leave `type: proposal`
  exactly as it is for genuine evidence — a finding that would inform a
  future decision but obliges no answer now.
confidence: high
updated: 2026-08-28
---

# Project-to-Arcadia signal channel

## Context

Private Practice Now has filed four `type: proposal` documents since
2026-08-17. One reached a Decision — 0028, written by a human doing by hand
the step Decision 0025 deferred to `accept-upstream-proposals`, which remains
`status: open` on `way-delivery`, itself `status: draft`. The other three —
0002 (superseded by its own follow-up work), 0003, and 0004 — have no Decision
and do not appear in `arcadia portfolio`'s "Waiting on you", which lists 19
items across five projects and zero proposals.

The cause is in the type system, not a bug: `proposal` is one of four
`SUPPORTING_DOC_TYPES`, whose own comment states projects of this kind are
"recognized and reported, never dispatched." That is correct for what a
supporting document is for. It is wrong for a request that needs an answer,
which is what three of PPN's four proposals are.

PPN's compensating behaviour is the tell. It has written five
`.arcadia/ingress/*.txt` files — plain prose, addressed "Arcadia," summarizing
a proposal and stating what must not be assumed — because filing the governed
document type produced no visible result. This is exactly the failure mode
Decision 0025 exists to name: *"there has never been a way for an agent in an
adopting project to ask for a capability, so when one was needed the only
available move was to build it locally."* The shim moved from code
(`scripts/arcadia.mjs`) to prose (`.arcadia/ingress/`), but the underlying gap
— no channel that reliably reaches the operator — is the same one.

## What already exists and is not being used

`type: decision` is not a supporting type. It is one of the primary
document types `docs sync` ingests (`src/docs/sync.ts:162`:
`mine.filter((doc): doc is DecisionDoc => doc.type === "decision")`), and
`arcadia portfolio`'s "Waiting on you" is built directly from open decisions.
Every field a request needs already exists on it:

```ts
// src/docs/types.ts:192
export interface DecisionDoc {
  id: string; slug: string; project: string;
  status: "open" | "approved" | "rejected" | "deferred";
  question: string;
  gapType: GapType | null;
  recommendation: string | null;
  confidence: ClarificationConfidence | null;
  decided: string | null;
  answer: string | null;
}
```

Ownership is per-document, not per-repository: `sync.ts` filters by
`doc.project === project.slug`, not by which repository the file lives in.
Every existing Decision happens to declare `project: arcadia`, including
0028, which is *about* PPN's capabilities — because the authority to decide
what Arcadia promotes belongs to Arcadia, regardless of which project raised
the question. That is the precedent this decision generalizes: **a Decision
lives wherever the deciding authority lives**, and an adopting project that
needs Arcadia's authority writes the Decision into Arcadia's own repository,
the same way 0028 was written about PPN without living in PPN.

Nothing needs to be built for this. It needs to be named as the answer.

## What this settles

Three kinds of signal exist, distinguished by what they oblige — not by a new
schema field, but by which already-implemented document type carries them:

| Signal | Obliges | Vehicle | Status |
| --- | --- | --- | --- |
| Needs Arcadia's decision | Approve / reject / defer | `type: decision`, authored directly in this repository, `project: arcadia`, `status: open` | **Works today** |
| Defect in Arcadia's own code | A fix or a recorded won't-fix | Same vehicle, framed as "should Arcadia fix X" — until recurrence justifies a dedicated record | Works today, as a stopgap |
| Evidence worth recording | Nothing. Read on demand | `type: proposal` in the filing project's own repository | **Already correct** |

Rules of use, so this does not become a second improvisation:

- An agent may **author** a Decision. It may not set `status: approved` or
  write an `answer` — those remain the operator's, exactly as every existing
  Decision already enforces by convention.
- A Decision authored this way must state, in its own body, **what the filing
  project did instead** while the question is open — the same discipline
  PPN's ingress notes already practiced, now inside the document that
  actually surfaces.
- `type: proposal` stays exactly as specified. Nothing here reduces its
  scope; it is confirmed as the right vehicle for the one signal it was
  always right for.
- Filing a Decision does not authorize implementing its recommendation. That
  remains a separately dispatched Action, as 0025 and every Decision since
  already require.

## What this does not settle

- Whether `accept-upstream-proposals` on `way-delivery` should still be built.
  It should — this decision does not retire the plan, only stops routing
  urgent requests through the channel that plan was meant to eventually fix.
  Once it exists, `proposal` may become a legitimate second path for an
  `ask`-shaped request; until then, `decision` is the one that reaches the
  operator.
- Whether a dedicated defect record is worth building. Recorded as a
  deferred item with its trigger stated, per the Way's own rule that a
  deferral must name a condition rather than a date: **a second reproducible
  Arcadia defect from an adopting project**, which would make "frame it as a
  Decision" visibly the wrong shape twice.
- Any change to `AskRequest` (`arcadia ask`), which is a distinct, existing,
  unrelated primitive — an operator's live natural-language request to
  Arcadia, not a project's filed signal. This decision does not touch it, and
  deliberately avoids naming anything here "ask" to keep the two apart.

## Why now

Two proposals are waiting on exactly this: 0003 (per-criterion acceptance
state and implementing `focus`) and 0004 (renaming the `codex` work
classification). Both are read, both are reasoned, and both have been
sitting unanswered because they arrived through a document type that cannot
carry them to a decision. Confirming this decision and re-filing them as
Decisions is the fastest way to find out whether the diagnosis is right.
