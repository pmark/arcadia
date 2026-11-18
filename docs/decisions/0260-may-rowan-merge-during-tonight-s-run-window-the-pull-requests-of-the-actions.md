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
recommendation: A. Tonight only, pinned Actions, until 8 AM, under five checked conditions
options:
  - label: A. Tonight only, pinned Actions, until 8 AM, under five checked conditions
    consequence: "Rowan may merge a pull request inside tonight's run window only when ALL of these hold and are recorded in a merge receipt comment on the pull request before merging: (C1) the pull request's Action is one of the Actions pinned on the Nov 18 9 PM START card, named by card id; (C2) an 'Independent review, head <sha>' comment names the exact head being merged, with no unresolved blocking finding (Decisions 0060 and 0080), and states, in the line 'Loosens a gate: no', that the head loosens no gate; (C3) every required check is green on that head and GitHub reports mergeStateStatus CLEAN; the merge uses --match-head-commit <sha>; (C4) the diff touches no docs/decisions file and no path that src/decisions/batchMerge.ts classifies as decisions or agent_permissions, and does not edit CONSTITUTION.md; (C5) the time is before 8:00 AM Pacific on Nov 19 and production is still Active for that card. Any condition that fails or cannot be read parks the pull request without merging, with a receipt naming the condition, for your word in the morning digest. Spend, credentials, deletion and publication remain excluded. Consequence: the night can complete the whole card, and every in-run merge leaves a receipt that the 8 AM verification report re-checks (the evidence for a standing version). Risk: a reviewer's miss on authority-adjacent code lands with no human look until morning, bounded by concurrency one, exact-head review, the failed-batch stop of Decisions 0181 and 0187, and the morning re-check."
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

- **A. Tonight only, pinned Actions, until 8 AM, under five checked conditions** (recommended): Rowan may merge a pull request inside tonight's run window only when ALL of these hold and are recorded in a merge receipt comment on the pull request before merging: (C1) the pull request's Action is one of the Actions pinned on the Nov 18 9 PM START card, named by card id; (C2) an 'Independent review, head <sha>' comment names the exact head being merged, with no unresolved blocking finding (Decisions 0060 and 0080), and states, in the line 'Loosens a gate: no', that the head loosens no gate; (C3) every required check is green on that head and GitHub reports mergeStateStatus CLEAN; the merge uses --match-head-commit <sha>; (C4) the diff touches no docs/decisions file and no path that src/decisions/batchMerge.ts classifies as decisions or agent_permissions, and does not edit CONSTITUTION.md; (C5) the time is before 8:00 AM Pacific on Nov 19 and production is still Active for that card. Any condition that fails or cannot be read parks the pull request without merging, with a receipt naming the condition, for your word in the morning digest. Spend, credentials, deletion and publication remain excluded. Consequence: the night can complete the whole card, and every in-run merge leaves a receipt that the 8 AM verification report re-checks (the evidence for a standing version). Risk: a reviewer's miss on authority-adjacent code lands with no human look until morning, bounded by concurrency one, exact-head review, the failed-batch stop of Decisions 0181 and 0187, and the morning re-check.
- **B. Keep the run-window rule**: No change. Tonight's run stops at the first authority-path pull request, about 30 minutes after the press, and you merge it in the morning by word or batch-merge card. Effectively one Action per night until the authority classification or the standing grant changes.
- **C. Standing in-run merges for every run**: As A, but for every per-run card's pinned Actions with no end date, until you revoke it. Consequence: no noon question each day. Risk: the same reviewer-miss exposure every night, decided once rather than per night; it changes a rule two earlier Decisions kept.

## Rationale

Decisions 0176 and 0182 C both say gated merges happen 'never during a run window', and production's worker does not merge authority-adjacent pull requests ('authority-adjacent PRs wait for the operator's batch-merge card'). Every remaining Plan F Action references operator_authority or production_policy paths, so tonight's run stops at its first pull request, about 30 minutes after the 9 PM press, until the operator's word in the morning. Batch 1 on 2026-11-17 took about 20 minutes per Action including a hand fix and a gate merge, so a seven-Action card is a realistic night only if these merges can happen in-run. Read-only pre-mortem (Nadia, relayed by Signal 14), reconciled by Ellis against main b7460955d. This Decision lifts only the run-window limit, only for one card's pinned Actions and only until 8 AM. It keeps every Constitution exclusion: no pull request that opens or carries a Decision or changes what agents are authorized to do, and no spend, credentials, deletion or publication. The operator chose D-A in Signal 14's chat on 2026-11-18 ('D-A'). This revision only makes A's conditions measurable and names the receipt and the morning re-check, so the record matches his answer more precisely and loosens nothing. It replaces the unsubmitted draft ellis-decision-in-run-merges-20261118. This draft grants nothing; only the operator's answer recorded through the governed route can.

Proposed by Agent Ask ellis-decision-in-run-merges-20261118b.
