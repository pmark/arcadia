---
arcadia: v1
type: proposal
project: arcadia
question: Can Agent Ask amend execution profiles and token budgets on existing managed Plans and Actions without hand-editing governance state?
---

# Preserve execution sizing in governed plan amendments

## Why this project needs it

The Flight Deck expansion proposes twenty bounded Actions, including sensitive
process-launch and lifecycle integration. The active Plan's token_budget still
says one implementation pass. Agent Ask's live contract accepts child id,
desired_result, acceptance, dependencies, references and target_ref; it cannot
amend token_budget, execution, model/effort hints or expected_artifact. The
supplemental delivery guide preserves sizing and named proof, but the canonical
metadata cannot yet represent that amendment through the documented Ask schema.

## What we would build locally

A script rewriting managed frontmatter to insert execution profiles and update
token_budget. We have not built that workaround or changed governed metadata by
hand. The supported plan amendment remains usable: created Actions are agent
owned and session-sized, acceptance names the real proof, references point at
the sizing guide, and the current configured model pin remains intact.

## Requested boundary

Support explicit, previewable metadata amendments through the canonical Ask
contract with current parser validation and operator settlement. No arbitrary
frontmatter patches, approval changes or provider-routing invention. Revisit
when an operator accepts this capability request; do not block Flight Deck's
supported Action amendments on it.
