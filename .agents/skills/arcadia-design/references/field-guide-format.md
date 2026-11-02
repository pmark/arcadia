# Field guide format

A field guide is data: an expert's knowledge of one field, with the provenance of
every entry. A new field needs a new guide, not a code change or a change to the
record method. Guides live in this skill's `field-guides/` directory, one YAML file
per field, so every Project and harness gets the same copy.

`arcadia design check <guide.yaml>` validates a guide. A check catches missing
labels, not wrong advice. Catch weak advice with source checks, counterexamples,
competing frameworks, independent critique and observed results.

```yaml
schema: arcadia-design-field-guide-v1
field: software-architecture     # the file name without .yaml
title: Software architecture
revision: 1
review_date: 2026-11-02          # when the content was last revised
review: null                     # or { date: 2026-12-01, by: Name, ref: "PR or Decision" }
scope:
  applies: What the guide covers.
  limits: Where it stops applying.
frameworks:                      # competing approaches; choosing one is a Decision
  - id: F1
    name: Name
    use_when: The conditions that favor it.
    provenance: { kind: inference, confidence: medium, reason: Why. }
entries:
  - id: E1
    kind: element                # element | question | probe | attack
    text: The advice.
    applies_when: When it applies.
    limits: Where it does not.
    provenance:
      kind: imported             # operator_statement | observation | inference | imported
      confidence: high           # high | medium | low
      reason: Why this confidence.
      source: Required for imported and operator_statement.
validation_examples:
  - given: A situation.
    expect: What the guide should lead to.
```

The provenance kinds and confidence levels reuse the terms of `arcadia learn`.

## Rules

- Every entry and framework needs `provenance` with `kind`, `confidence` and
  `reason`. **An entry missing any of them fails validation.**
- `imported` and `operator_statement` entries need `source`.
- `scope.applies`, `scope.limits`, `revision`, `review_date`, at least one entry and
  at least one validation example are required.
- IDs are unique, and `field` matches the file name.
- `review: null` means unreviewed. Advice from it is exploratory, and no answer may
  claim conformance to it (Decision 0159). Only the operator or someone the operator
  names fills in `review`.
- Advice an owner merely repeats ("someone on a podcast said") is an idea for the
  brief, not a guide entry.
- Summarize sources in your own words, and never paste third-party text into a guide.
