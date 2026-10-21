---
arcadia: v1
type: decision
id: "0132"
slug: record-the-operator-s-2026-10-21-choice-on-whether-the-release-manager-agent
project: arcadia
status: approved
question: Record the operator's 2026-10-21 choice on whether the Release Manager agent may merge fix PRs for managed-production run defects that touch src/production or src/sessions (the Decision 0098 gate list), only while production is Off.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Release Manager may merge run-defect fix PRs while production is Off
options:
  - label: Release Manager may merge run-defect fix PRs while production is Off
    consequence: The Release Manager agent may merge a PR that fixes a defect found by a managed-production run, its replay or its pre-mortem, even when it touches src/production or src/sessions (the Decision 0098 gate list), but only when `arcadia production status` shows production Off, an independent read-only review of the exact head has no unresolved blocking finding, every required check is green, and the merge is clean (merge commit). A push resets this proof. PRs that change authority, Decisions, governance records, CONSTITUTION.md or AGENTS.md, a grant card's scope, budget or capacity limits, or agent permissions are excluded and stay operator merges. While production is On, and for every other PR class, nothing changes. Run defects reach main without waiting for you, at the cost of an agent merging launch-path code unattended while production is Off.
    recommended: true
  - label: Keep operator merges for src/production and src/sessions
    consequence: Nothing changes. Every PR on the Decision 0098 gate list, including run defect fixes, waits for your merge, so each run-defect repair adds an operator step and a further run cannot start until you merge.
    recommended: false
confidence: high
plan: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
updated: 2026-10-21
answer: Release Manager may merge run-defect fix PRs while production is Off
decided: 2026-10-21
---

# Decision 0132: Record the operator's 2026-10-21 choice on whether the Release Manager agent may merge fix PRs for managed-production run defects that touch src/production or src/sessions (the Decision 0098 gate list), only while production is Off.

## Options

- **Release Manager may merge run-defect fix PRs while production is Off** (recommended): The Release Manager agent may merge a PR that fixes a defect found by a managed-production run, its replay or its pre-mortem, even when it touches src/production or src/sessions (the Decision 0098 gate list), but only when `arcadia production status` shows production Off, an independent read-only review of the exact head has no unresolved blocking finding, every required check is green, and the merge is clean (merge commit). A push resets this proof. PRs that change authority, Decisions, governance records, CONSTITUTION.md or AGENTS.md, a grant card's scope, budget or capacity limits, or agent permissions are excluded and stay operator merges. While production is On, and for every other PR class, nothing changes. Run defects reach main without waiting for you, at the cost of an agent merging launch-path code unattended while production is Off.
- **Keep operator merges for src/production and src/sessions**: Nothing changes. Every PR on the Decision 0098 gate list, including run defect fixes, waits for your merge, so each run-defect repair adds an operator step and a further run cannot start until you merge.

## Rationale

Operator answer, 2026-10-21, Release Manager session (Remote Control), chosen in chat with the verbatim reply "1, 2 and 3" to three options; this is option 2, offered as: "You could authorize me to merge fix PRs for run defects myself, but only while production is Off, after independent review of the exact head and green CI. Merges that change authority or Decisions would stay yours." This Ask only records that chat answer as a Decision for the operator to answer by button; the Release Manager and this proposal grant nothing until the operator answers. Decision 0060/0080 conditions (independent review of the exact head without unresolved blocking finding, required checks green, clean merge) and Decision 0098's gate list otherwise stay as written.

Proposed by Agent Ask decide-rm-merge-run-defect-fixes-while-off-20261021.
