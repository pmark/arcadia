---
arcadia: v1
type: decision
id: "0260"
slug: may-rowan-merge-during-tonight-s-run-window-the-pull-requests-of-the-actions
project: arcadia
status: open
question: May Rowan merge, during tonight's run window, the pull requests of the Actions pinned on the Nov 18 9 PM START card when each passes exact-head independent review and green checks, so an unattended night does not stop at the first authority-path pull request?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Tonight only, named Actions, until 8 AM
options:
  - label: A. Tonight only, named Actions, until 8 AM
    consequence: "For the Actions pinned on the Nov 18 9 PM START card only, Rowan may merge each Action's pull request inside the run window once Decisions 0060 and 0080 hold on its final head and the independent reviewer states that the head loosens no gate. Rowan quotes this Decision on the pull request. A yes or unclear answer from the reviewer, a pull request that opens or carries a Decision, or one that changes what agents are authorized to do parks for your word. The permission ends at 8 AM Pacific on Nov 19 or at Off. Consequence: the night can complete the whole card. Risk: a reviewer's miss on authority-adjacent code lands with no human look until morning, bounded by concurrency one, exact-head review and the failed-batch stop of Decisions 0181 and 0187."
    recommended: true
  - label: B. Keep the run-window rule
    consequence: No change. Tonight's run stops at the first authority-path pull request, about 30 minutes after the press, and you merge it in the morning by word or batch-merge card. Effectively one Action per night until the authority classification or the standing grant changes.
    recommended: false
  - label: C. Standing in-run merges for every run
    consequence: "As A, but for every per-run card's pinned Actions with no end date, until you revoke it. Consequence: no noon question each day. Risk: the same reviewer-miss exposure every night, decided once rather than per night; it changes a rule two earlier Decisions kept."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-18
---

# Decision 0260: May Rowan merge, during tonight's run window, the pull requests of the Actions pinned on the Nov 18 9 PM START card when each passes exact-head independent review and green checks, so an unattended night does not stop at the first authority-path pull request?

## Options

- **A. Tonight only, named Actions, until 8 AM** (recommended): For the Actions pinned on the Nov 18 9 PM START card only, Rowan may merge each Action's pull request inside the run window once Decisions 0060 and 0080 hold on its final head and the independent reviewer states that the head loosens no gate. Rowan quotes this Decision on the pull request. A yes or unclear answer from the reviewer, a pull request that opens or carries a Decision, or one that changes what agents are authorized to do parks for your word. The permission ends at 8 AM Pacific on Nov 19 or at Off. Consequence: the night can complete the whole card. Risk: a reviewer's miss on authority-adjacent code lands with no human look until morning, bounded by concurrency one, exact-head review and the failed-batch stop of Decisions 0181 and 0187.
- **B. Keep the run-window rule**: No change. Tonight's run stops at the first authority-path pull request, about 30 minutes after the press, and you merge it in the morning by word or batch-merge card. Effectively one Action per night until the authority classification or the standing grant changes.
- **C. Standing in-run merges for every run**: As A, but for every per-run card's pinned Actions with no end date, until you revoke it. Consequence: no noon question each day. Risk: the same reviewer-miss exposure every night, decided once rather than per night; it changes a rule two earlier Decisions kept.

## Rationale

Decisions 0176 and 0182 C both say gated merges happen 'never during a run window', and production's worker does not merge authority-adjacent pull requests ('authority-adjacent PRs wait for the operator's batch-merge card'). Every remaining Plan F Action references operator_authority or production_policy paths, so tonight's run stops at its first pull request, about 30 minutes after the 9 PM press, until the operator's word in the morning. Batch 1 on 2026-11-17 took about 20 minutes per Action including a hand fix and a gate merge, so a seven-Action card is a realistic night only if these merges can happen in-run. Read-only pre-mortem (Nadia, relayed by Signal 14), reconciled by Ellis against main b7460955d. This Decision lifts only the run-window limit, only for one card's pinned Actions and only until 8 AM. It keeps every Constitution exclusion: no pull request that opens or carries a Decision or changes what agents are authorized to do, and no spend, credentials, deletion or publication. This draft grants nothing; only the operator's answer can.

Proposed by Agent Ask ellis-decision-in-run-merges-20261118.
