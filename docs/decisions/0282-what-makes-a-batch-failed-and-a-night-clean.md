---
arcadia: v1
type: decision
id: "0282"
slug: what-makes-a-batch-failed-and-a-night-clean
project: arcadia
status: approved
question: What makes a batch failed, and a night clean?
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Failed only if a pinned step is neither merged nor parked, an escalation is open, or main is red; cap of 3 parked PRs
options:
  - label: A. Failed only if a pinned step is neither merged nor parked, an escalation is open, or main is red; cap of 3 parked PRs
    consequence: "A batch is failed only if, at Off, a pinned step is neither merged nor parked with a receipt, or an escalation is still open, or main is red. Parked for a policy reason, escalations resolved in the run, and an Off after every pin landed or parked are not failures. Cap: at 3 parked PRs outstanding the lane pauses with one ping (the breaker already written in `parkAndContinue.ts`, wired by B10). \"Clean night\" is E1's definition. Consequence: the timer keeps pressing through parked work up to the cap; answers Signal 17's concern that 0282 A alone has no cap."
    recommended: true
  - label: B. Decision 0282 A only
    consequence: "Decision 0282 A only. Consequence: an honestly recovered run still stops the chain."
    recommended: false
  - label: C. Keep today's rule
    consequence: "Keep today's rule. Consequence: any parked or recovered step stops the chain; day-lane work can never run on the timer."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-22
answer: A. Failed only if a pinned step is neither merged nor parked, an escalation is open, or main is red; cap of 3 parked PRs
decided: 2026-11-22
---

# Decision 0282: What makes a batch failed, and a night clean?

## Options

- **A. Failed only if a pinned step is neither merged nor parked, an escalation is open, or main is red; cap of 3 parked PRs** (recommended): A batch is failed only if, at Off, a pinned step is neither merged nor parked with a receipt, or an escalation is still open, or main is red. Parked for a policy reason, escalations resolved in the run, and an Off after every pin landed or parked are not failures. Cap: at 3 parked PRs outstanding the lane pauses with one ping (the breaker already written in `parkAndContinue.ts`, wired by B10). "Clean night" is E1's definition. Consequence: the timer keeps pressing through parked work up to the cap; answers Signal 17's concern that 0282 A alone has no cap.
- **B. Decision 0282 A only**: Decision 0282 A only. Consequence: an honestly recovered run still stops the chain.
- **C. Keep today's rule**: Keep today's rule. Consequence: any parked or recovered step stops the chain; day-lane work can never run on the timer.

## Rationale

Operator, 2026-11-22 2:30:25 PM PST (22:30:25.386Z), a human-origin turn in Signal 18's session f3d1e5f1-8e82-470d-8aea-d68ce34c9365, verified by Rowan 31 under Decision 0229 A (transcript route; source session id, timestamp and verbatim quote recorded here): 'Follow the suggested advice unless you have an objection.' Signal 18 (local_82202837-ab9e-4dc8-bc96-d836d05aa9e5) found no objection and relayed the advisor's reply string, verbatim: 'Playbook: D1 A · D2 A · D3 A (Rowan and builders now, Signal once relay-hosted) · D4 B. Engine: activate yes, amend Action 1 yes, reinstall yes after the ls-tree fetch fix. I'll press the standing grant when you send the card with the clearance and pre-mortem done.' Caveat, recorded honestly: his words came before the advisor's report (22:32:55Z). What he had seen was Signal 18's message of 22:27:43Z, which listed D1 A, D2 A, D3 A and D4 A, the Playbook's recommended letters; for this item it read: 'D2 A: one rule for failed batches and clean nights, with at most 3 parked PRs. It replaces Decision 0282 (PR #2957).' He did not see the rule's three failure conditions or E1's definition; the record states them. This covers open Decision 0282 (PR #2957, status open, never merged) and Issues #2941, #2807 and #2891, so they are not asked one by one (Playbook section 2). Decision 0282's option A is this option A without the cap; option B here is 0282 A alone. PR #2957 is closed unmerged as superseded before this record is settled, with a comment naming this record's PR, so the two never hold one Decision number. 'E1's definition' (Playbook section 1, verbatim): 'A clean night: the timer pressed at least one card under the standing grant, at least one worker merge landed, no batch read failed, and no person or coordinator pressed, merged, repaired, reset, restarted or turned production Off by hand.' Night = 9:00 PM to 8:00 AM Pacific. The answer is one rule: the parked-is-not-failed reading and the cap of 3 parked PRs go live together, never the reading without the cap (the cap is what separates A from B). It changes what counts as a failed batch, the stop of Decision 0181 as coded (src/operatorActions/startRunDayGrant.ts:176-188) that also bounds Decision 0241 E's standing grant, so it is a gate change (docs/agent-guidance/pull-requests.md, 'Gate change'), and the code that carries it out (Playbook items B9 and B10, and PR #2960) follows the answer to P-D4. The pause 'with one ping' is messaging: this answer adds no messaging authority, and which existing authority covers that ping is not verified in this draft. His read-back of this record and his merge of its record pull request are the ratification; nothing in this record is in force before that merge. It changes what agents are authorized to do, so under the Constitution's Authority section and Decision 0273 condition 3 its record PR is the operator's merge. Options and consequences are copied from the Playbook workspaces/playbook-to-unattended-production.md (outside the repository; sha256 440e52df406e7fd111c51b69b68339c975b179e92a11628992fe3de594e6510c), section 2, without change except where this rationale says so; 'this playbook', 'section N' and item ids (H1-H3, P1, B1-B22) in them mean that file at that sha256. The option labels are added because the Playbook gives letters only and `arcadia decision approve` records an option's exact label as the answer (src/commands/decision.ts:451-461). Next free number: allocate from fresh origin/main at settle. This draft grants nothing.

Proposed by Agent Ask ellis-playbook-d2-failed-batch-clean-night-20261122.
