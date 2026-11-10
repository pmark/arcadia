---
arcadia: v1
type: decision
id: "0182"
slug: decide-which-gated-pull-requests-rowan-may-merge-without-the-operator-s-word-on
project: arcadia
status: approved
question: Decide which gated pull requests Rowan may merge without the operator's word on each, under Decision 0176 option A's naming in advance.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. The operator names the pull requests Rowan may merge, valid 24 hours
options:
  - label: A. The operator names the pull requests Rowan may merge, valid 24 hours
    consequence: "Rowan merges a named pull request after independent review of its current head and green required checks, for 24 hours. For example: the CI re-trigger, the #2127 fix, #2128 and the work-seeding pull requests. Anything that opens a Decision or changes authority still waits for the operator."
    recommended: true
  - label: B. Every gated merge waits for the operator's word
    consequence: Nothing gated merges overnight without a tap or a named pull request; progress on gated work stops whenever the operator is away.
    recommended: false
  - label: "C. Standing order: Rowan settles and merges every pull request whose judgement is obvious"
    consequence: "Standing, with no 24-hour expiry, in the operator's words: \"I want you to settle and merge everything that has an obvious judgement, and that should be a standing order\". Each merge still needs independent review of its current head with no unresolved blocking finding, green required checks and a clean merge state (Decisions 0060 and 0080), never inside a run window, and Rowan quotes the standing order on the pull request. Still waits for the operator: a pull request that opens or carries an important Decision or changes what agents are authorized to do, and spend, credentials, deletion and publication."
    recommended: false
confidence: high
plan: keep-unattended-serial-production-running-overnight-on-three-test-only-actions
updated: 2026-11-06
answer: "C. Standing order: Rowan settles and merges every pull request whose judgement is obvious"
decided: 2026-11-06
---

# Decision 0182: Decide which gated pull requests Rowan may merge without the operator's word on each, under Decision 0176 option A's naming in advance.

## Options

- **A. The operator names the pull requests Rowan may merge, valid 24 hours** (recommended): Rowan merges a named pull request after independent review of its current head and green required checks, for 24 hours. For example: the CI re-trigger, the #2127 fix, #2128 and the work-seeding pull requests. Anything that opens a Decision or changes authority still waits for the operator.
- **B. Every gated merge waits for the operator's word**: Nothing gated merges overnight without a tap or a named pull request; progress on gated work stops whenever the operator is away.
- **C. Standing order: Rowan settles and merges every pull request whose judgement is obvious**: Standing, with no 24-hour expiry, in the operator's words: "I want you to settle and merge everything that has an obvious judgement, and that should be a standing order". Each merge still needs independent review of its current head with no unresolved blocking finding, green required checks and a clean merge state (Decisions 0060 and 0080), never inside a run window, and Rowan quotes the standing order on the pull request. Still waits for the operator: a pull request that opens or carries an important Decision or changes what agents are authorized to do, and spend, credentials, deletion and publication.

## Rationale

Decision 0176 answered A: the operator keeps the word on gated merges, given by a tap or by naming pull requests in advance for 24 hours. Rowan put this question to the operator in chat on 2026-11-05 as menu question 3. The operator answered "3A" and broadened it in the same message: "I want you to settle and merge everything that has an obvious judgement, and that should be a standing order" (recorded at https://github.com/pmark/arcadia/issues/1929#issuecomment-6673669313). Rowan's record of that answer keeps the Constitution's exclusions: a pull request that opens or carries an important Decision or changes what agents are authorized to do still waits for the operator, as do spend, credentials, deletion and publication. Every merge still needs independent review of its current head with no unresolved blocking finding, green required checks and a clean merge state (Decisions 0060 and 0080), and Rowan quotes the standing order on each such merge. This changes what Rowan is authorized to merge, so the pull request recording it waits for the operator. Option C states that broadened answer in the operator's words so it can be chosen and recorded as given; options A and B are unchanged from the menu.

Proposed by Agent Ask decide-standing-order-obvious-judgement-merges-20261106-v3.
