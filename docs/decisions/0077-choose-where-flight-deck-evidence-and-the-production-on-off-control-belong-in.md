---
arcadia: v1
type: decision
id: "0077"
slug: choose-where-flight-deck-evidence-and-the-production-on-off-control-belong-in
project: arcadia
status: open
question: Choose where Flight Deck evidence and the Production On/Off control belong in the phone-first dashboard redesign.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Evidence under Runs; On/Off visible on Runs
options:
  - label: Evidence under Runs; On/Off visible on Runs
    consequence: Flight Deck becomes /runs/evidence with /flight-deck redirected; a persistent production status strip keeps the stop control beside active work and cannot forget a pending toggle. Queue steering moves to /runs/queue. The three build slices follow this architecture.
    recommended: true
  - label: Keep Flight Deck; On/Off visible on Runs
    consequence: Flight Deck keeps its standalone read-only portfolio page under More; Runs links to it without duplicating the evidence board. A persistent production strip keeps start/stop beside active work and fixes pending-toggle loss. Queue steering moves to /runs/queue.
    recommended: false
  - label: Evidence under Runs; dedicated Production page
    consequence: Flight Deck becomes /runs/evidence with /flight-deck redirected; Runs shows read-only production status and a link to /runs/production. Starting or stopping needs one additional navigation. Queue steering moves to /runs/queue.
    recommended: false
  - label: Keep Flight Deck; dedicated Production page
    consequence: Flight Deck keeps its standalone portfolio page under More. Runs links to that evidence board and shows read-only production status; start/stop lives at /runs/production, one extra navigation away. Queue steering moves to /runs/queue.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-30
---

# Decision 0077: Choose where Flight Deck evidence and the Production On/Off control belong in the phone-first dashboard redesign.

## Options

- **Evidence under Runs; On/Off visible on Runs** (recommended): Flight Deck becomes /runs/evidence with /flight-deck redirected; a persistent production status strip keeps the stop control beside active work and cannot forget a pending toggle. Queue steering moves to /runs/queue. The three build slices follow this architecture.
- **Keep Flight Deck; On/Off visible on Runs**: Flight Deck keeps its standalone read-only portfolio page under More; Runs links to it without duplicating the evidence board. A persistent production strip keeps start/stop beside active work and fixes pending-toggle loss. Queue steering moves to /runs/queue.
- **Evidence under Runs; dedicated Production page**: Flight Deck becomes /runs/evidence with /flight-deck redirected; Runs shows read-only production status and a link to /runs/production. Starting or stopping needs one additional navigation. Queue steering moves to /runs/queue.
- **Keep Flight Deck; dedicated Production page**: Flight Deck keeps its standalone portfolio page under More. Runs links to that evidence board and shows read-only production status; start/stop lives at /runs/production, one extra navigation away. Queue steering moves to /runs/queue.

## Rationale

The operator explicitly asked to decide these product choices before they are assumed. Inspection confirms Flight Deck is a read-only queue/evidence projection with a 1050px minimum grid, Work Queue holds unique mutation safeguards, and Runs currently hides the Production toggle in a disclosure that unmounts pending state (#809). Outcome and three-slice order are stated in docs/proposals/runs-page-information-architecture.md. This question precedes the Staff Planning Architect pass under docs/planning-process.md; it changes no Project pointer, queue, authority or production state.

Proposed by Agent Ask choose-runs-page-information-architecture-2026-09-29.
