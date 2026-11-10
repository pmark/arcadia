---
arcadia: v1
type: decision
id: "0194"
slug: decide-whether-decision-0182-s-standing-order-covers-three-routine-governed
project: arcadia
status: approved
question: "Decide whether Decision 0182's standing order covers three routine governed steps that Rowan put to the operator one at a time on 2026-11-06: merging a settlement pull request, declaring `execution: build` on an approved build Plan's Action, and the later steps of a recovery route the operator already chose."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. All three are obvious judgement under the standing order
options:
  - label: A. All three are obvious judgement under the standing order
    consequence: "Rowan carries them out without a menu: (1) it merges a settlement pull request written by `arcadia agent-ask settle --apply` whose Ask opens no Decision and changes no authority (a completion, a clarification, an amendment inside an approved Plan, or the successor activation that settlement performs); (2) it declares `execution: build` by governed amendment on an agent-owned Action of an approved build Plan; (3) it takes the remaining steps of a recovery route the operator chose, when they reach the end state that route named. At 2026-11-06's rate, that removes about 4 operator touches and about 3.5 hours of waiting per night. Anything outside those classes still gets a menu."
    recommended: true
  - label: B. Only settlement merges
    consequence: "Class (1) needs no menu, which removes about 2 touches a night (#2150, #2157). Declaring an execution route and later recovery steps still go to the operator, about 2 touches a night."
    recommended: false
  - label: "C. No change: Rowan judges each case"
    consequence: "The 2026-11-06 pattern continues: about 4 extra touches a night for steps the operator answered A each time."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107
updated: 2026-11-07
answer: A. All three are obvious judgement under the standing order
decided: 2026-11-07
---

# Decision 0194: Decide whether Decision 0182's standing order covers three routine governed steps that Rowan put to the operator one at a time on 2026-11-06: merging a settlement pull request, declaring `execution: build` on an approved build Plan's Action, and the later steps of a recovery route the operator already chose.

## Options

- **A. All three are obvious judgement under the standing order** (recommended): Rowan carries them out without a menu: (1) it merges a settlement pull request written by `arcadia agent-ask settle --apply` whose Ask opens no Decision and changes no authority (a completion, a clarification, an amendment inside an approved Plan, or the successor activation that settlement performs); (2) it declares `execution: build` by governed amendment on an agent-owned Action of an approved build Plan; (3) it takes the remaining steps of a recovery route the operator chose, when they reach the end state that route named. At 2026-11-06's rate, that removes about 4 operator touches and about 3.5 hours of waiting per night. Anything outside those classes still gets a menu.
- **B. Only settlement merges**: Class (1) needs no menu, which removes about 2 touches a night (#2150, #2157). Declaring an execution route and later recovery steps still go to the operator, about 2 touches a night.
- **C. No change: Rowan judges each case**: The 2026-11-06 pattern continues: about 4 extra touches a night for steps the operator answered A each time.

## Rationale

Decision 0182 answered C: "I want you to settle and merge everything that has an obvious judgement, and that should be a standing order". On the evening of 2026-11-06, Rowan still put about four steps to the operator as menus: apply Action 3's completion from main (19:19Z), merge settlement #2150 (19:30Z), merge clarification settlement #2157 (21:32Z), and add `execution: build` to narrative-summarization (23:08Z, the same answer the operator gave for the same defect class at 09:07Z). Each was answered "A", and together they cost about three and a half hours of waiting. The playbook already says to drop options that earlier answers cover (#2153), but whether these three classes are obvious judgement is a reading of the operator's authority, not something an agent may decide for itself. Every option keeps 0182 C's exclusions and Decisions 0060 and 0080: independent review of the current head with no unresolved blocking finding, green required checks, a clean merge, never inside a run window, and the standing order quoted on the pull request. Sources: #1929 comments 6693360819, 6693570948, 6696197050 and 6698053645, and docs/reports/relay-rowan-night-2026-11-06.md.

Proposed by Agent Ask decide-standing-order-routine-governed-steps-20261107.
