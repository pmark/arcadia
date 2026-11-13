---
arcadia: v1
type: decision
id: "0230"
slug: confirm-the-proposed-effect-against-decision-0182-decide-which-gated-pull
project: arcadia
status: open
question: "Confirm the proposed effect against Decision 0182 (decide-which-gated-pull-requests-rowan-may-merge-without-the-operator-s-word-on): Proposal (Signal 10, on the operator's words in Signal 10's chat at 12:35 PM PST 2026-11-13: 'Do I really need to rubber stamp all of these merge approvals? I'd like for you to do it.'): record a Decision that the current Signal (and the current Rowan under 0182 C) may merge any PR, including operator-authority paths such as src/cli.ts, once independent review of the current head has PASS with no unresolved blocking finding, all required checks pass, merge is CLEAN, the merge is pinned to the reviewed head, and runtime-path PRs merge only while production is Off. Exclusions stay with the operator: PRs that raise, carry or answer a Decision; production START/activation; spend; credentials; branch-protection or gate changes. The merging session posts the merge sha in its log and the digest. Options: A adopt as above; B adopt but exclude operator-authority paths; C keep per-PR operator merges."
recommendation: "A: Adopt as proposed. Signal (and the current Rowan under 0182 C) may merge any PR, including operator-authority paths such as src/cli.ts, once independent review of the current head has PASS with no unresolved blocking finding, all required checks pass, merge is CLEAN, the merge is pinned to the reviewed head, and runtime-path PRs merge only while production is Off. Exclusions stay with the operator: PRs that raise, carry or answer a Decision; production START/activation; spend; credentials; branch-protection or gate changes. The merging session posts the merge sha in its log and the digest."
options:
  - label: "A: Adopt as proposed. Signal (and the current Rowan under 0182 C) may merge any PR, including operator-authority paths such as src/cli.ts, once independent review of the current head has PASS with no unresolved blocking finding, all required checks pass, merge is CLEAN, the merge is pinned to the reviewed head, and runtime-path PRs merge only while production is Off. Exclusions stay with the operator: PRs that raise, carry or answer a Decision; production START/activation; spend; credentials; branch-protection or gate changes. The merging session posts the merge sha in its log and the digest."
    consequence: "The operator stops approving each gate-passing merge; merges move at the speed of independent review and CI. Risk: a wrong PASS on an authority path lands without a human look, bounded by head pinning, production Off for runtime paths and the exclusions."
    recommended: true
  - label: "B: Adopt, but exclude operator-authority paths. Same gate as A, except PRs touching operator-authority paths (for example src/cli.ts) still need the operator's merge."
    consequence: "Fewer operator touches than today but authority-path PRs (cli, gate-adjacent code) still wait for the operator; merges of those PRs can stall while the operator is away."
    recommended: false
  - label: "C: Keep per-PR operator merges. No delegation beyond Decision 0182 as it stands."
    consequence: "No new risk, but every authority-path merge keeps waiting on the operator, which is the stall the operator asked to remove."
    recommended: false
gap_type: missing-decision
gate_question: reasonable_disagreement
confidence: high
plan: keep-unattended-serial-production-running-overnight-on-three-test-only-actions
updated: 2026-11-13
---

# Decision 0230: Confirm the proposed effect against Decision 0182 (decide-which-gated-pull-requests-rowan-may-merge-without-the-operator-s-word-on): Proposal (Signal 10, on the operator's words in Signal 10's chat at 12:35 PM PST 2026-11-13: 'Do I really need to rubber stamp all of these merge approvals? I'd like for you to do it.'): record a Decision that the current Signal (and the current Rowan under 0182 C) may merge any PR, including operator-authority paths such as src/cli.ts, once independent review of the current head has PASS with no unresolved blocking finding, all required checks pass, merge is CLEAN, the merge is pinned to the reviewed head, and runtime-path PRs merge only while production is Off. Exclusions stay with the operator: PRs that raise, carry or answer a Decision; production START/activation; spend; credentials; branch-protection or gate changes. The merging session posts the merge sha in its log and the digest. Options: A adopt as above; B adopt but exclude operator-authority paths; C keep per-PR operator merges.

Proposed by Agent Ask signal-merges-on-gate-without-per-pr-approval-20261113.

## Options

- **A: Adopt as proposed. Signal (and the current Rowan under 0182 C) may merge any PR, including operator-authority paths such as src/cli.ts, once independent review of the current head has PASS with no unresolved blocking finding, all required checks pass, merge is CLEAN, the merge is pinned to the reviewed head, and runtime-path PRs merge only while production is Off. Exclusions stay with the operator: PRs that raise, carry or answer a Decision; production START/activation; spend; credentials; branch-protection or gate changes. The merging session posts the merge sha in its log and the digest.** (recommended): The operator stops approving each gate-passing merge; merges move at the speed of independent review and CI. Risk: a wrong PASS on an authority path lands without a human look, bounded by head pinning, production Off for runtime paths and the exclusions.
- **B: Adopt, but exclude operator-authority paths. Same gate as A, except PRs touching operator-authority paths (for example src/cli.ts) still need the operator's merge.**: Fewer operator touches than today but authority-path PRs (cli, gate-adjacent code) still wait for the operator; merges of those PRs can stall while the operator is away.
- **C: Keep per-PR operator merges. No delegation beyond Decision 0182 as it stands.**: No new risk, but every authority-path merge keeps waiting on the operator, which is the stall the operator asked to remove.
