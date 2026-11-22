---
arcadia: v1
type: decision
id: "0285"
slug: carrying-out-a-gate-change-you-already-answered-may-signal-or-rowan-merge-a-pr
project: arcadia
status: approved
question: "Carrying out a gate change you already answered: may Signal or Rowan merge a PR that loosens a gate exactly as an answered Decision says?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Yes, with a heavy-tier exact-head statement, every Decision 0230 condition and production Off
options:
  - label: A. Yes, with a heavy-tier exact-head statement, every Decision 0230 condition and production Off
    consequence: "Yes, when a heavy-tier independent reviewer states on the exact head \"Loosens a gate: yes, only as Decision NNNN option X\", every Decision 0230 condition holds, and production is Off. Receipt comment and \"reply `revert`\" as today. Never for a loosening with no answered Decision behind it. Basis: CONSTITUTION, \"carrying out a decision already made is not a second decision\". Consequence: B9, B10, B14, B17 and B20 do not wait for you."
    recommended: true
  - label: B. No; they collect into one merge-all list at noon Pacific
    consequence: "No; they collect into one \"merge all\" list at noon Pacific. Consequence: one touch a day, up to 24 hours' delay per item."
    recommended: false
  - label: C. Per-PR as today
    consequence: "Per-PR as today. Consequence: the stalls you asked to remove."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-22
answer: B. No; they collect into one merge-all list at noon Pacific
decided: 2026-11-22
---

# Decision 0285: Carrying out a gate change you already answered: may Signal or Rowan merge a PR that loosens a gate exactly as an answered Decision says?

## Options

- **A. Yes, with a heavy-tier exact-head statement, every Decision 0230 condition and production Off** (recommended): Yes, when a heavy-tier independent reviewer states on the exact head "Loosens a gate: yes, only as Decision NNNN option X", every Decision 0230 condition holds, and production is Off. Receipt comment and "reply `revert`" as today. Never for a loosening with no answered Decision behind it. Basis: CONSTITUTION, "carrying out a decision already made is not a second decision". Consequence: B9, B10, B14, B17 and B20 do not wait for you.
- **B. No; they collect into one merge-all list at noon Pacific**: No; they collect into one "merge all" list at noon Pacific. Consequence: one touch a day, up to 24 hours' delay per item.
- **C. Per-PR as today**: Per-PR as today. Consequence: the stalls you asked to remove.

## Rationale

Operator, 2026-11-22 2:30:25 PM PST (22:30:25.386Z), a human-origin turn in Signal 18's session f3d1e5f1-8e82-470d-8aea-d68ce34c9365, verified by Rowan 31 under Decision 0229 A (transcript route; source session id, timestamp and verbatim quote recorded here): 'Follow the suggested advice unless you have an objection.' Signal 18 (local_82202837-ab9e-4dc8-bc96-d836d05aa9e5) found no objection and relayed the advisor's reply string, verbatim: 'Playbook: D1 A · D2 A · D3 A (Rowan and builders now, Signal once relay-hosted) · D4 B. Engine: activate yes, amend Action 1 yes, reinstall yes after the ls-tree fetch fix. I'll press the standing grant when you send the card with the clearance and pre-mortem done.' Caveat, recorded honestly: his words came before the advisor's report (22:32:55Z). What he had seen was Signal 18's message of 22:27:43Z, which listed D1 A, D2 A, D3 A and D4 A, the Playbook's recommended letters; for this item it read: 'D4 A: Signal and Rowan may merge a change that loosens a gate, but only exactly as an answered Decision says, and only after a heavy-tier reviewer confirms it.' The relayed reply answers B, not the A he saw. B grants agents nothing: it is narrower than A and keeps today's rule that a loosening is the operator's merge. Under B: a PR that loosens a gate, even exactly as an answered Decision says, is never merged by Signal or Rowan. Such PRs are collected into one 'merge all' list in the noon Pacific menu, and the operator merges them. The Playbook names B9, B10, B14, B17 and B20 (and B6b after P-D3); whether a PR loosens a gate is the independent reviewer's statement on the exact head, never the author's (docs/agent-guidance/pull-requests.md, 'Gate change'). Tightenings and fixes keep merging under Decision 0230 A as today. The advisor's reasons (relayed by Signal 18, not his words): loosenings need an Off-window merge train anyway, so the noon list adds almost no delay; reviewers failed twice that day. The advisor also suggested revisiting A after 5 clean loosening merges; that is a suggestion, not part of this answer, and A would need a new Decision. His read-back of this record and his merge of its record pull request are the ratification; nothing in this record is in force before that merge. It changes what agents are authorized to do, so under the Constitution's Authority section and Decision 0273 condition 3 its record PR is the operator's merge. Options and consequences are copied from the Playbook workspaces/playbook-to-unattended-production.md (outside the repository; sha256 440e52df406e7fd111c51b69b68339c975b179e92a11628992fe3de594e6510c), section 2, without change except where this rationale says so; 'this playbook', 'section N' and item ids (H1-H3, P1, B1-B22) in them mean that file at that sha256. The option labels are added because the Playbook gives letters only and `arcadia decision approve` records an option's exact label as the answer (src/commands/decision.ts:451-461). Next free number: allocate from fresh origin/main at settle. This draft grants nothing.

Proposed by Agent Ask ellis-playbook-d4-answered-gate-changes-20261122.
