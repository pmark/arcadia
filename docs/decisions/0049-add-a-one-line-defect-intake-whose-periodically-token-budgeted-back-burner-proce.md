---
arcadia: v1
type: decision
id: "0049"
slug: add-a-one-line-defect-intake-whose-periodically-token-budgeted-back-burner-proce
project: arcadia
status: open
question: Add a one-line defect intake whose periodically token-budgeted Back Burner process investigates, deduplicates, prioritizes, promotes, and when safely authorized repairs defects without requiring the reporter to author a formal Action first.
gap_type: missing-decision
recommendation: Bounded autonomous defect triage
options:
  - label: Bounded autonomous defect triage
    consequence: Add `arcadia defect <summary>` as a thin Back Burner intake with captured Project, source, revision, context, and optional evidence. A periodic process receives a fixed token allowance, investigates and deduplicates, then closes noise, enriches the item, promotes a formal Action, or fixes low-risk reversible work under standing authority. Stop-the-line defects bypass cadence; consequential effects still require the operator.
    recommended: true
  - label: Triage and promote only
    consequence: The periodic process investigates, deduplicates, and creates formal Actions but never edits code. This reduces authority risk but leaves even obvious, reversible repairs waiting for another production cycle.
    recommended: false
  - label: Intake without automation
    consequence: Add the one-line defect inbox but require the operator to review and promote every item. Capture becomes easier, but prioritization and repair remain another recurring operator chore.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-13
---

# Decision 0049: Add a one-line defect intake whose periodically token-budgeted Back Burner process investigates, deduplicates, prioritizes, promotes, and when safely authorized repairs defects without requiring the reporter to author a formal Action first.

## Options

- **Bounded autonomous defect triage** (recommended): Add `arcadia defect <summary>` as a thin Back Burner intake with captured Project, source, revision, context, and optional evidence. A periodic process receives a fixed token allowance, investigates and deduplicates, then closes noise, enriches the item, promotes a formal Action, or fixes low-risk reversible work under standing authority. Stop-the-line defects bypass cadence; consequential effects still require the operator.
- **Triage and promote only**: The periodic process investigates, deduplicates, and creates formal Actions but never edits code. This reduces authority risk but leaves even obvious, reversible repairs waiting for another production cycle.
- **Intake without automation**: Add the one-line defect inbox but require the operator to review and promote every item. Capture becomes easier, but prioritization and repair remain another recurring operator chore.

## Rationale

Decision 0037 explicitly used an open Decision as the defect-record stopgap until recurrence justified a dedicated path; repeated Arcadia Go, Agent Ask, pointer, and review-application defects have now fired that trigger. Back Burner already preserves deferred items and evaluates conditions, while the provider-capacity plan already proposes bounded use of otherwise-expiring included agent capacity. Reuse both rather than create another backlog or scheduler. A simple defect report is evidence, not proof of severity or authority. Deterministic deduplication and reproduction come before model triage; automatic fixes stay limited to reversible, validated, explicitly policy-authorized repository work.

Proposed by Agent Ask back-burner-defect-intake-2026-09-12. This Decision remains open until the operator answers it.
