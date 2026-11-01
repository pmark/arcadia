---
arcadia: v1
type: decision
id: "0162"
slug: remove-the-once-per-day-ceiling-on-claude-sign-in-renewal-and-worker-check
project: arcadia
status: open
question: Remove the once-per-day ceiling on Claude sign-in renewal and worker-check sequences (Decisions 0141 and 0161), so a claimed, failed or refused sequence never delays the next START card or press?
gap_type: missing-decision
gate_question: approval_boundary
options:
  - label: Remove the daily ceiling; one sequence per press (recommended)
    consequence: "Supersedes only the per-America/Los_Angeles-day ceiling in Decision 0141, as restated in Decision 0161 option A, for every sequence in this class: START cards and Rowan's standing Decision 0143 sequences alike. A START card press runs its one sign-in sequence only if no fresh retained receipt from the bound worker exists, as in Decision 0161, regardless of any earlier sequence that day. A claimed, consumed, failed or refused earlier sequence never blocks or delays a later card or press. Each press runs at most one sequence, with no automatic retry inside that press. Every other bound stays: one reviewed Haiku one-turn no-tools call of at most 60 seconds, which may rotate the shared sign-in and uses small included usage; only on its success, one bound-worker usage check of at most 30 seconds under a fresh nonce grant of at most 5 minutes; no paid fallback, credential export or interactive sign-in. Rowan's sequences keep every other Decision 0143 bound, including that a sequence must be needed and supported by new diagnostic evidence or a verified correction, and no unchanged opaque-failure retry. The ledger stays the durable, exclusive per-sequence claim: it still refuses a second sequence overlapping an in-flight one, and each press consumes its own sequence record. It no longer refuses on the calendar day. Each failed press may rotate the shared sign-in and use small included usage, with no daily cap; only the per-press bounds and the 0143 need rule limit it. Agents must not add a calendar-day or cool-down limit on renewal and check sequences without a new Decision."
    recommended: false
  - label: Keep the daily ceiling
    consequence: "No change: after any claimed sequence, the next renewal waits for the next America/Los_Angeles day."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-11-01
---

# Decision 0162: Remove the once-per-day ceiling on Claude sign-in renewal and worker-check sequences (Decisions 0141 and 0161), so a claimed, failed or refused sequence never delays the next START card or press?

## Options

- **Remove the daily ceiling; one sequence per press (recommended)**: Supersedes only the per-America/Los_Angeles-day ceiling in Decision 0141, as restated in Decision 0161 option A, for every sequence in this class: START cards and Rowan's standing Decision 0143 sequences alike. A START card press runs its one sign-in sequence only if no fresh retained receipt from the bound worker exists, as in Decision 0161, regardless of any earlier sequence that day. A claimed, consumed, failed or refused earlier sequence never blocks or delays a later card or press. Each press runs at most one sequence, with no automatic retry inside that press. Every other bound stays: one reviewed Haiku one-turn no-tools call of at most 60 seconds, which may rotate the shared sign-in and uses small included usage; only on its success, one bound-worker usage check of at most 30 seconds under a fresh nonce grant of at most 5 minutes; no paid fallback, credential export or interactive sign-in. Rowan's sequences keep every other Decision 0143 bound, including that a sequence must be needed and supported by new diagnostic evidence or a verified correction, and no unchanged opaque-failure retry. The ledger stays the durable, exclusive per-sequence claim: it still refuses a second sequence overlapping an in-flight one, and each press consumes its own sequence record. It no longer refuses on the calendar day. Each failed press may rotate the shared sign-in and use small included usage, with no daily cap; only the per-press bounds and the 0143 need rule limit it. Agents must not add a calendar-day or cool-down limit on renewal and check sequences without a new Decision.
- **Keep the daily ceiling**: No change: after any claimed sequence, the next renewal waits for the next America/Los_Angeles day.

## Rationale

Operator's direct instruction in Rowan's chat, 2026-11-01, after the second START press refused on a code defect (#1958) after its renewal succeeded and so consumed the day: "No way - remove that totally worthless and unacceptable delay restriction and make sure it never happens again". This records an already-given operator choice, not authority inferred by an agent. Implementation is a source change gated on this Decision being on main.

Proposed by Agent Ask decision-remove-daily-renewal-ceiling-20261101.
