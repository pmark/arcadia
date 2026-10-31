---
arcadia: v1
type: decision
id: "0160"
slug: where-should-sustained-design-briefs-live
project: arcadia
status: open
question: Where should sustained design briefs live?
gap_type: missing-decision
gate_question: reasonable_disagreement
recommendation: Default experiments Project
options:
  - label: Default experiments Project
    consequence: "Briefs live in their Project; work not ready for or tied to a Project goes in a default experiments Project that Arcadia keeps in a local git repository it maintains, and the operator is encouraged to add a remote origin. The operator can create a dedicated Project at any time. Arcadia commits locally only: adding the remote and pushing stay the operator's actions, and until then the briefs exist on one disk. An experiment that earns its own Project moves there, with the original kept linked. Creating and maintaining the repository is new capability built by the brief-home Action."
    recommended: true
  - label: Existing Projects only
    consequence: Briefs live only in existing Projects, with no default experiments Project. Cheapest; a design that is not tied to a Project cannot keep a brief until the operator creates one.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
---

# Decision 0160: Where should sustained design briefs live?

## Options

- **Default experiments Project** (recommended): Briefs live in their Project; work not ready for or tied to a Project goes in a default experiments Project that Arcadia keeps in a local git repository it maintains, and the operator is encouraged to add a remote origin. The operator can create a dedicated Project at any time. Arcadia commits locally only: adding the remote and pushing stay the operator's actions, and until then the briefs exist on one disk. An experiment that earns its own Project moves there, with the original kept linked. Creating and maintaining the repository is new capability built by the brief-home Action.
- **Existing Projects only**: Briefs live only in existing Projects, with no default experiments Project. Cheapest; a design that is not tied to a Project cannot keep a brief until the operator creates one.

## Rationale

Supersedes Decision 0153, whose options did not include the operator's answer given in Claude Code on 2026-10-31. The recommended option is that answer in the operator's confirmed words, with refinements the operator accepted. Gates establish-design-brief-home in Plan unify-how-arcadia-agents-identify-themselves-and-their-teammates-and-make. Replaces an earlier draft whose wording dropped two of the operator's phrases.

Proposed by Agent Ask decision-design-brief-home-experiments-project-v2-2026-10-31.
