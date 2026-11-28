---
arcadia: v1
type: decision
id: "0307"
slug: clarify-decision-0297-s-an-agent-re-running-a-check-where-every-test-passed-at
project: arcadia
status: open
question: "Clarify Decision 0297's \"an agent re-running a check where every test passed (at most once per version)\": record the operator's answer \"A (recommended): yes\", under which a re-run where setup failed before any test ran still counts as clean, from now on, once per version and logged."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. yes, from now on, once per version and logged
options:
  - label: A. yes, from now on, once per version and logged
    consequence: Yes, from now on, once per version and logged. Repeated causes still need a real fix.
    recommended: true
  - label: B. yes, and also recheck the two earlier runs marked not clean
    consequence: Yes, and also recheck the two earlier runs marked not clean.
    recommended: false
  - label: C. no change
    consequence: No change.
    recommended: false
confidence: high
plan: track-6-standby-test-pins-20261127
updated: 2026-11-28
---

# Decision 0307: Clarify Decision 0297's "an agent re-running a check where every test passed (at most once per version)": record the operator's answer "A (recommended): yes", under which a re-run where setup failed before any test ran still counts as clean, from now on, once per version and logged.

## Options

- **A. yes, from now on, once per version and logged** (recommended): Yes, from now on, once per version and logged. Repeated causes still need a real fix.
- **B. yes, and also recheck the two earlier runs marked not clean**: Yes, and also recheck the two earlier runs marked not clean.
- **C. no change**: No change.

## Rationale

Operator words, verified per Decision 0229 A by Rowan g12 (read-only) and re-read read-only by Claudia Mason (governance-records helper under Rowan g12) from Signal 21's session transcript f9f4b2e7-c7c1-43fe-9335-bebc4d66be2d (/Users/pmark/.claude/projects/-Users-pmark-Dev-PrivatePracticeNow-platform/f9f4b2e7-c7c1-43fe-9335-bebc4d66be2d.jsonl). QUESTION, the only source of this record's terms: the optional question in Signal 21's digest, the assistant message at file line 1029, 2026-11-28T04:31:38.363Z (8:31 PM PST Fri 11-27), uuid d8a04b27-e4d8-4582-bb1b-998d52e8684c. Verbatim, with Markdown emphasis removed and list items joined by ' / ': 'Optional: should a re-run still count as clean when setup failed before any test ran? / A (recommended): yes, from now on, once per version and logged. Repeated causes still need a real fix. / B: yes, and also recheck the two earlier runs marked not clean. / C: no change. A or B would need a new written decision that you approve.' The rest of that message is about other matters and is not a source of any term. ANSWER: the operator's own human-origin user message (origin.kind human) at file line 1129, 2026-11-28T05:15:53.684Z (9:15 PM PST Fri 11-27), uuid 958ff06e-ed5a-4234-801d-924056a31a10, verbatim with its line break shown as ' / ': 'should a re-run still count as clean when setup failed before any test ran? / A (recommended): yes'. RECORDED MEANING (option A), only in line 1029's words: "yes, from now on, once per version and logged. Repeated causes still need a real fix." Read with his question: a re-run where setup failed before any test ran still counts as clean, from now on, once per version and logged. The question's "re-run" is the re-run kind in Decision 0297 (C1), "an agent re-running a check where every test passed (at most once per version)", which this answer clarifies; "Repeated causes still need a real fix" is Decision 0297's existing learning rule ("a cause recurring twice must get a real fix. If it happens a third time without one, it no longer counts as clean."), which this record does not change. UNCHANGED: every other term of Decisions 0288, 0297 and 0298, including every other kind of agent help and what is not clean; declaring any Milestone reached stays the operator's alone. Decision 0297 is not edited. docs/milestones.md changes only its "Agent help kinds" paragraph to quote this answer, in the same candidate; no Milestone status or run record changes. NOT ADOPTED: this record adds no term line 1029 did not show. Option B's recheck of the two earlier runs marked not clean is not recorded: no past run is recounted and no earlier verdict changes (the menu does not name those two runs). It does not define "setup" or "version" beyond his words, and it does not cover a re-run after any test ran and failed, a re-run more than once per version, an unlogged re-run, an edit by hand, a governance step mid-run, or a host repair that changes files or records. Any such wider term needs a separate question to the operator. This draft grants nothing and approves nothing. Only the answer recorded through arcadia decision approve, and the operator's merge of its record PR, put it in force.

Proposed by Agent Ask claudia-mason-0297-setup-failure-rerun-20261127.
