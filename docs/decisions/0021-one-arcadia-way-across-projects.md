---
arcadia: v1
type: decision
id: "0021"
slug: one-arcadia-way-across-projects
project: arcadia
status: approved
question: Arcadia and Private Practice Now each ratified a constitution, and they restate many of the same rules in different words. Which one governs an adopting repository, what happens to the principles only one of them has, and how does the Arcadia Way reach a project without being hand-copied into it?
gap_type: missing-decision
recommendation: Arcadia's `CONSTITUTION.md` is the single constitution for every adopting repository. Retire the six PPN principles that restate it, promote `truthful uncertainty` into it as a thirteenth bullet, move the rest into Arcadia Way practice or the semantics guide, and propagate all of it through the existing `contextSetup` marker block in `AGENTS.md` rather than by copying files.
confidence: high
decided: 2026-08-16
answer: "Approved by the operator on 2026-08-16. Arcadia's CONSTITUTION.md is the single constitution for every adopting repository; PPN's constitution-v1.md is superseded but retained with its ratification history. Truthful uncertainty is promoted into the Truth section, taking the Constitution from 13 bullets to 14. The six restating principles retire into the bullets they duplicate. PPN's command-naming rules -- nouns read, verbs mutate within declared authority; name a command what the operator already called the job; aliases are first-class; say the next step in the operator's words -- are adopted into docs/arcadia-semantics.md and bind new commands in every adopting repository. Propagation runs through the existing contextSetup marker block, which now also writes CONSTITUTION.md and a thin CLAUDE.md wrapper, and never writes outside the marked region or over project-authored content. Constitution version pinning and drift reporting, the capability registry and alias enforcement, PPN's machine artifacts, and operator-owned docket work all remain deferred behind their stated triggers."
updated: 2026-08-16
---

# One Arcadia Way across projects

## Context

Decision 0020 replaced `CONSTITUTION.md` with 13 bullets grouped as Purpose,
Authority, Truth, and Economy, and adopted an admission test for what may live
there. That work assumed one constitution.

There are two. Private Practice Now carries a separately ratified Arcadia Way
at version 1.2.0 — `docs/arcadia-way/constitution-v1.md`, twelve numbered
principles, with machine artifacts under `.arcadia/arcadia-way/` — ratified by
the operator on 2026-08-14. It is not a stale copy. It is a parallel governance
document that grew in the project where the Way was actually being used, and in
the areas it covers best (command vocabulary, operator-owned work) it is more
developed than Arcadia's own.

Two ratified constitutions restating the same rules in different words is
itself a violation of the rule both of them contain: each fact has one
authoritative home. It is also the concrete form of the operator's stated goal
that every project speak the same language.

This Decision does not treat PPN's document as noise to be overwritten. It
applies Decision 0020's admission test to all twelve principles and routes each
one somewhere specific.

## Decision proposed

### 1. One constitution, and it is Arcadia's

`CONSTITUTION.md` in the Arcadia repository is the constitution for every
adopting repository. An adopting project does not ratify its own; it adopts
this one and records the adoption. Projects keep full authority over their own
`PROJECT.md`, plans, Decisions, and Mission Log — the constitution governs the
operating method, never the work.

PPN's `docs/arcadia-way/constitution-v1.md` is superseded on approval. It is
not deleted: it becomes a `strategy` document marked superseded, pointing at
the adopted constitution, so its ratification history stays legible.

### 2. Where each PPN principle goes

Applying Decision 0020's admission test. Six restate bullets Arcadia already
has and retire into them:

| PPN principle | Already in `CONSTITUTION.md` as |
| --- | --- |
| 2. Operator authorship | Approval boundaries are hard stops; capability never grants authority |
| 3. One governed work pointer | Checked-in managed documentation is authoritative for governed work |
| 5. Visible effects and receipts | Completion is a proven state, not a claim |
| 6. Progressive disclosure | Operator attention is a budget; ascending-order spend |
| 7. One state, many views | Each other fact has one authoritative home; every other surface is a projection |
| 10. Secure amendment | Approval boundaries, applied to governance itself |

Principle 10 deserves a note: it is not merely covered, it was demonstrated.
Decision 0020 was proposed by two coding agents across four rounds and ratified
only by the operator, with `CONSTITUTION.md` untouched until approval. The rule
already binds in practice.

**One principle is promoted into the Constitution.** Principle 8, truthful
uncertainty, has no Arcadia equivalent and passes the admission test on two
recorded incidents: Decision 0001 (`null` versus `unclarified` — uncertainty
that could not be distinguished from absence) and Decision 0014 (operator
questions disappearing when a session ended). Add one bullet to **Truth**:

> - Uncertainty stays visible. Open questions, blockers, assumptions, and
>   unresolved disagreement remain legible until they are answered, and are
>   never closed by silence or by an agent's confidence.

That takes the Constitution from 13 bullets to 14. Growth is a real cost, so it
is worth stating why this one earns it: every other bullet governs what may
happen, and this is the only one that governs what may be left unsaid.

**Five move to Arcadia Way practice or the semantics guide**, revisable without
constitutional change:

| PPN principle | Destination |
| --- | --- |
| 1. Shared outcome | Already structural — Mission and Outcome on `PROJECT.md`. Semantics guide. |
| 4. Read and action are distinct | `docs/arcadia-semantics.md` — nouns read, verbs may mutate within declared authority. |
| 9. Durable, efficient memory | Arcadia Way practice; overlaps Decision 0012's thin receipt. |
| 11. The operator is in the system | Arcadia Way practice. Partly structural already via `requires_review` and `blocked` responsibility; the untracked part is that a declined item must be recorded rather than removed. |
| 12. Adaptability | `docs/arcadia-semantics.md`, with its naming rules. |

### 3. Adopt PPN's naming rules as shared vocabulary

PPN's Way contains command-vocabulary conventions Arcadia has nowhere: nouns
for looking and verbs for acting so the part of speech carries the authority
boundary; commands named after the word the operator already used; aliases as
first-class registry entries; and a command that ends without saying the next
step has offloaded its last step onto the operator.

These are the operator's "everything speaks the same language" requirement
stated precisely, and they were written from real use. Move them into
`docs/arcadia-semantics.md`, which already owns canonical vocabulary, and make
them binding on new commands in every adopting repository.

### 4. Propagate by mechanism, not by copy

`src/projects/contextSetup.ts` already writes a marker-delimited block into an
adopting repository's `AGENTS.md`, between `<!-- ARCADIA_CONTEXT_START -->` and
`<!-- ARCADIA_CONTEXT_END -->`. Today that block carries only context-policy
pointers. It is the right mechanism and the wrong payload.

Extend it to write, into every adopting repository:

- `CONSTITUTION.md` — the adopted constitution, verbatim, so `arcadia next`
  has standing constraints to print. PPN has no `CONSTITUTION.md` today, which
  means the dispatch brief prints nothing for it.
- the `AGENTS.md` marker block — pointing at the constitution, the managed
  document guide, and the semantics guide.

Two boundaries on the mechanism:

- **It writes `AGENTS.md`, never `CLAUDE.md`.** Under the vendor-neutral split,
  `CLAUDE.md` is a thin wrapper that imports `AGENTS.md`. PPN's `CLAUDE.md`
  currently carries a duplicated copy of the injected block, which is the drift
  this rule prevents. Adopting repositories get the same thin wrapper.
- **It never writes outside the marked region or the adopted files.** A
  project's own `AGENTS.md` content below the block is the project's, and
  PPN's intake-field protocol section must survive untouched.

Propagation is deterministic and costs no model tokens.

### 5. Adoption is recorded, and drift is visible

An adopting repository records the constitution version it adopted. When the
adopted copy differs from the source, `arcadia docs sync` reports it as drift
rather than silently rewriting the project's file, because an unexplained
overwrite of a governance document is exactly the kind of silent mutation the
Constitution forbids.

## 80/20 adoption sequence

### Do first after approval

1. Add the truthful-uncertainty bullet to `CONSTITUTION.md`.
2. Add the naming rules and the read/act distinction to
   `docs/arcadia-semantics.md`.
3. Extend `contextSetup` to write `CONSTITUTION.md` and the enriched marker
   block, and to leave `CLAUDE.md` as a thin wrapper.
4. Run it against PPN. Mark PPN's `constitution-v1.md` superseded, pointing at
   the adopted constitution.

### Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Constitution version pinning and drift reporting in `docs sync` | A second repository adopts, or PPN's adopted copy is edited locally. |
| Capability registry and alias enforcement | A command ships whose name the operator did not already use for that job. |
| Machine artifacts (`adoption.json`, `capabilities.json`, `events.jsonl`) promoted from PPN into Arcadia | Two repositories need the same registry, or the portfolio view needs adoption state. |
| Operator-owned work tracked in the docket | A declined or operator-only item is lost because it lived only in prose. |

## Consequences

- One constitution governs every project, and the twelve PPN principles are
  accounted for individually rather than discarded.
- The Constitution grows by one bullet, for a rule with two recorded incidents
  behind it.
- PPN gains standing constraints in its dispatch brief, which it has never had.
- Arcadia gains the command-vocabulary discipline PPN developed, which is the
  part of the shared language most likely to keep projects speaking it.
- Propagation becomes a deterministic command rather than a copy that drifts
  the moment either side is edited.

## What this Decision does not authorize

- It does not edit `CONSTITUTION.md`, `docs/arcadia-semantics.md`, or any file
  in the PPN repository; approval is the gate for each.
- It does not delete PPN's ratified document or its ratification history.
- It does not create a capability registry, an adoption schema, an event
  stream, or a portfolio adoption view.
- It does not change any project's `PROJECT.md`, plans, Decisions, or pointer.
- It does not displace the active demo-first Action.

## Review test

Approve only if each retirement in section 2 genuinely says what its Arcadia
bullet already says — read them side by side, and move any that does not into
practice instead. Reject the truthful-uncertainty promotion if the two cited
incidents do not convince you, and it becomes practice with the rest.
