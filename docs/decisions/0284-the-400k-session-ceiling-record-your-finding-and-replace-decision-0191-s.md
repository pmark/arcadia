---
arcadia: v1
type: decision
id: "0284"
slug: the-400k-session-ceiling-record-your-finding-and-replace-decision-0191-s
project: arcadia
status: open
question: "The 400k session ceiling: record your finding and replace Decision 0191's percent lines?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Prepare 200k, due 260k, forced 320k, ceiling 400k (Rowan and builders now, Signal once relay-hosted)
options:
  - label: A. Prepare 200k, due 260k, forced 320k, ceiling 400k (Rowan and builders now, Signal once relay-hosted)
    consequence: "Prepare at 200k, due at 260k, forced at 320k, ceiling 400k, for Rowan and Signal; builders stop at 260k. Relay limits unchanged (6 renewals a day per role). Consequence (Mira's INFERENCE): about 37% less context reading for about 3 more handoffs a day. Forced sits 80k under the ceiling because worst observed growth is 29 points an hour (`coordinator-handoff-design.md:192-195`), about 72k in the 15 minutes a launch and custody transfer can take. Scope as answered (the relayed reply): Rowan and builders now, Signal once relay-hosted."
    recommended: true
  - label: B. Forced at 400k (prepare 250k, due 320k)
    consequence: "Forced at 400k (prepare 250k, due 320k). Consequence: fewer handoffs; sessions overshoot 400k by the relay's latency."
    recommended: false
  - label: C. Keep 50/60/75%
    consequence: "Keep 50/60/75%. Consequence: sessions keep reaching 750k and above."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-22
---

# Decision 0284: The 400k session ceiling: record your finding and replace Decision 0191's percent lines?

## Options

- **A. Prepare 200k, due 260k, forced 320k, ceiling 400k (Rowan and builders now, Signal once relay-hosted)** (recommended): Prepare at 200k, due at 260k, forced at 320k, ceiling 400k, for Rowan and Signal; builders stop at 260k. Relay limits unchanged (6 renewals a day per role). Consequence (Mira's INFERENCE): about 37% less context reading for about 3 more handoffs a day. Forced sits 80k under the ceiling because worst observed growth is 29 points an hour (`coordinator-handoff-design.md:192-195`), about 72k in the 15 minutes a launch and custody transfer can take. Scope as answered (the relayed reply): Rowan and builders now, Signal once relay-hosted.
- **B. Forced at 400k (prepare 250k, due 320k)**: Forced at 400k (prepare 250k, due 320k). Consequence: fewer handoffs; sessions overshoot 400k by the relay's latency.
- **C. Keep 50/60/75%**: Keep 50/60/75%. Consequence: sessions keep reaching 750k and above.

## Rationale

Operator, 2026-11-22 2:30:25 PM PST (22:30:25.386Z), a human-origin turn in Signal 18's session f3d1e5f1-8e82-470d-8aea-d68ce34c9365, verified by Rowan 31 under Decision 0229 A (transcript route; source session id, timestamp and verbatim quote recorded here): 'Follow the suggested advice unless you have an objection.' Signal 18 (local_82202837-ab9e-4dc8-bc96-d836d05aa9e5) found no objection and relayed the advisor's reply string, verbatim: 'Playbook: D1 A · D2 A · D3 A (Rowan and builders now, Signal once relay-hosted) · D4 B. Engine: activate yes, amend Action 1 yes, reinstall yes after the ls-tree fetch fix. I'll press the standing grant when you send the card with the clearance and pre-mortem done.' Caveat, recorded honestly: his words came before the advisor's report (22:32:55Z). What he had seen was Signal 18's message of 22:27:43Z, which listed D1 A, D2 A, D3 A and D4 A, the Playbook's recommended letters; for this item it read: 'D3 A: each session is capped at 400k tokens of context. Handoff prepares at 200k, is due at 260k and is forced at 320k.' He did not see that builders stop at 260k, that relay limits stay at 6 renewals a day per role, that this replaces Decision 0191's percent lines, or the scoping 'Rowan and builders now, Signal once relay-hosted', which came from the relayed reply. Text not copied from the Playbook: option A's label, and the last sentence of option A's consequence ('Scope as answered ...'), both carrying that scoping; the Playbook's own option A says 'for Rowan and Signal'. The scoping is narrower than what he saw. The finding (Playbook section 7, operator finding 2026-11-22): no session works above 400k tokens of context, counted as the relay counts occupancy, input + cache_creation + cache_read of the last main-chain turn (docs/agent-guidance/coordinator-handoff-design.md:167-173). What it replaces: Decision 0191 A's relay trigger at due (60%) and forced (75%) and the 50/60/75 starting values (src/coordinators/budget.ts:32). What it keeps: Decision 0191 A's relay authority and limits as renewed under Decision 0246 A (two launch attempts per renewal, six renewals a day, expiry 2026-12-07 unless renewed). It does not authorize relay hosting or relay launch of Signal; that needs its own Decision. Playbook section 7 adds, for a model whose window is under 533k, 'keep the smaller of the percent line and the token line'. The code is Playbook item B6b, which follows the answer to P-D4. His read-back of this record and his merge of its record pull request are the ratification; nothing in this record is in force before that merge. It changes what agents are authorized to do, so under the Constitution's Authority section and Decision 0273 condition 3 its record PR is the operator's merge. Options and consequences are copied from the Playbook workspaces/playbook-to-unattended-production.md (outside the repository; sha256 440e52df406e7fd111c51b69b68339c975b179e92a11628992fe3de594e6510c), section 2, without change except where this rationale says so; 'this playbook', 'section N' and item ids (H1-H3, P1, B1-B22) in them mean that file at that sha256. The option labels are added because the Playbook gives letters only and `arcadia decision approve` records an option's exact label as the answer (src/commands/decision.ts:451-461). Next free number: allocate from fresh origin/main at settle. This draft grants nothing.

Proposed by Agent Ask ellis-playbook-d3-400k-session-ceiling-20261122.
