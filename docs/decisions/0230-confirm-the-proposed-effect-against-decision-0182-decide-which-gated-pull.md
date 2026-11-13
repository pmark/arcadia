---
arcadia: v1
type: decision
id: "0230"
slug: confirm-the-proposed-effect-against-decision-0182-decide-which-gated-pull
project: arcadia
status: open
question: "Confirm the proposed effect against Decision 0182 (decide-which-gated-pull-requests-rowan-may-merge-without-the-operator-s-word-on): Proposal (Signal 10, on the operator's words in Signal 10's chat at 12:35 PM PST 2026-11-13: 'Do I really need to rubber stamp all of these merge approvals? I'd like for you to do it.'): record a Decision that the current Signal (and the current Rowan under 0182 C) may merge any PR, including operator-authority paths such as src/cli.ts, once independent review of the current head has PASS with no unresolved blocking finding, all required checks pass, merge is CLEAN, the merge is pinned to the reviewed head, and runtime-path PRs merge only while production is Off. Exclusions stay with the operator: PRs that raise, carry or answer a Decision; production START/activation; spend; credentials; branch-protection or gate changes. The merging session posts the merge sha in its log and the digest. Options: A adopt as above; B adopt but exclude operator-authority paths; C keep per-PR operator merges."
gap_type: missing-decision
gate_question: reasonable_disagreement
confidence: high
plan: keep-unattended-serial-production-running-overnight-on-three-test-only-actions
updated: 2026-11-13
---

# Decision 0230: Confirm the proposed effect against Decision 0182 (decide-which-gated-pull-requests-rowan-may-merge-without-the-operator-s-word-on): Proposal (Signal 10, on the operator's words in Signal 10's chat at 12:35 PM PST 2026-11-13: 'Do I really need to rubber stamp all of these merge approvals? I'd like for you to do it.'): record a Decision that the current Signal (and the current Rowan under 0182 C) may merge any PR, including operator-authority paths such as src/cli.ts, once independent review of the current head has PASS with no unresolved blocking finding, all required checks pass, merge is CLEAN, the merge is pinned to the reviewed head, and runtime-path PRs merge only while production is Off. Exclusions stay with the operator: PRs that raise, carry or answer a Decision; production START/activation; spend; credentials; branch-protection or gate changes. The merging session posts the merge sha in its log and the digest. Options: A adopt as above; B adopt but exclude operator-authority paths; C keep per-PR operator merges.

Proposed by Agent Ask signal-merges-on-gate-without-per-pr-approval-20261113.
