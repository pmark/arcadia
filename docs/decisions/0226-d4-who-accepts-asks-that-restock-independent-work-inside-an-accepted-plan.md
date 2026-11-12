---
arcadia: v1
type: decision
id: "0226"
slug: d4-who-accepts-asks-that-restock-independent-work-inside-an-accepted-plan
project: arcadia
status: open
question: "D4: Who accepts Asks that restock independent work inside an accepted Plan?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A
options:
  - label: A
    consequence: Rowan and Flynn propose one bounded batch of evidenced, worthwhile independent Actions; you accept the batch. Immediate supply without inventing settlement authority or accepting new Plans silently. Costs one daily answer for each batch.
    recommended: true
  - label: B
    consequence: Separately authorize Rowan to settle a narrow, named class of Plan amendment from verified Issues, with unchanged Milestone and acceptance semantics, no authority paths, no new Plan and no self-approval. Less restocking delay, but a real settlement change that needs implementation and operator merge.
    recommended: false
  - label: C
    consequence: No restocking change. When accepted work is blocked or finished, production may have nothing permitted to do and goes idle.
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-12
---

# Decision 0226: D4: Who accepts Asks that restock independent work inside an accepted Plan?

## Options

- **A** (recommended): Rowan and Flynn propose one bounded batch of evidenced, worthwhile independent Actions; you accept the batch. Immediate supply without inventing settlement authority or accepting new Plans silently. Costs one daily answer for each batch.
- **B**: Separately authorize Rowan to settle a narrow, named class of Plan amendment from verified Issues, with unchanged Milestone and acceptance semantics, no authority paths, no new Plan and no self-approval. Less restocking delay, but a real settlement change that needs implementation and operator merge.
- **C**: No restocking change. When accepted work is blocked or finished, production may have nothing permitted to do and goes idle.

## Rationale

The ready list can run empty, and triage counted 234 open Issues but no accepted, ready Action. Sources: agentask_93d0170cd186a88db7 and agentask_b99a3e8db0ae4c862f. Codex base supersedes: its recommendation is an operator-accepted batch. Tests-only or docs-only labels are not safe authorization predicates. This decision grants no START and preserves Constitution gates: no authority path, Milestone or acceptance semantics change, and no self-approval.

Proposed by Agent Ask decision-d4-who-accepts-restocking-asks-20261112.
