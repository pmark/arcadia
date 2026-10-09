---
arcadia: v1
type: decision
id: "0108"
slug: decide-whether-arcadia-may-introduce-a-supported-observed-browser-close-route
project: arcadia
status: open
question: Decide whether Arcadia may introduce a supported observed browser-close route solely to prove the literal browser-close conjunct of prove-literal-split-browser-and-ledger, or must leave that criterion open until an already-governed production UI supplies such an event.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Keep the criterion open until an existing governed production UI records browser closure
options:
  - label: Keep the criterion open until an existing governed production UI records browser closure
    consequence: No browser instrumentation or provider/browser-audit work is added now; v6 evidence remains honest, production stays Off, and this Action can only close the browser conjunct after a separately governed observable route exists.
    recommended: true
  - label: Authorize a minimal observed browser-close route for this proof
    consequence: A future scoped implementation may record one real browser close and post-close production observation without changing provider support or reusing v6 authority; it still needs a fresh disposable rehearsal and one-shot Grant before live execution.
    recommended: false
  - label: Amend the criterion to accept worker restart without a browser event
    consequence: The Action acceptance wording would need a separately governed Plan amendment; existing Off/restart receipts could then be reassessed, but no literal browser-close proof would be claimed.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0108: Decide whether Arcadia may introduce a supported observed browser-close route solely to prove the literal browser-close conjunct of prove-literal-split-browser-and-ledger, or must leave that criterion open until an already-governed production UI supplies such an event.

## Options

- **Keep the criterion open until an existing governed production UI records browser closure** (recommended): No browser instrumentation or provider/browser-audit work is added now; v6 evidence remains honest, production stays Off, and this Action can only close the browser conjunct after a separately governed observable route exists.
- **Authorize a minimal observed browser-close route for this proof**: A future scoped implementation may record one real browser close and post-close production observation without changing provider support or reusing v6 authority; it still needs a fresh disposable rehearsal and one-shot Grant before live execution.
- **Amend the criterion to accept worker restart without a browser event**: The Action acceptance wording would need a separately governed Plan amendment; existing Off/restart receipts could then be reassessed, but no literal browser-close proof would be claimed.

## Rationale

The retained v6 receipts prove Off and worker restart but contain no browser-close event. Treating the CLI restart as a browser closure would change the literal acceptance criterion; adding a browser observation route would extend the current action scope. Either choice needs operator judgment.

Proposed by Agent Ask decide-literal-browser-close-proof-route-2026-10-02.
