---
arcadia: v1
type: decision
id: "0283"
slug: build-straight-from-issues-may-rowan-s-builders-build-unattended-production
project: arcadia
status: approved
question: "Build straight from Issues: may Rowan's builders build unattended-production work from Issues, with no Plan Action or Agent Ask per item?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Yes, for the playbook's item list and Issues that pass the class test
options:
  - label: A. Yes, for the playbook's item list and Issues that pass the class test
    consequence: "Yes, for this playbook's item list and any later Issue that passes the class test: it is U0 or U1 in `docs/roadmap.md`'s intake table, touches only modules named in section 4, and adds no spend, credential, dependency or operator-facing surface. Each PR cites the Decision. It ends when section 1 holds or on your word. Consequence: no per-item approval; work happens outside the queue's order, bounded by lanes, review and the merge classes."
    recommended: true
  - label: B. Yes, for the listed items only
    consequence: "Yes, for the listed items only. Consequence: each newly found blocker waits for you (INFERENCE: one to three a day at the current find rate)."
    recommended: false
  - label: C. No
    consequence: "No. Consequence: every fix keeps costing an amendment, a card and a press."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-22
answer: A. Yes, for the playbook's item list and Issues that pass the class test
decided: 2026-11-22
---

# Decision 0283: Build straight from Issues: may Rowan's builders build unattended-production work from Issues, with no Plan Action or Agent Ask per item?

## Options

- **A. Yes, for the playbook's item list and Issues that pass the class test** (recommended): Yes, for this playbook's item list and any later Issue that passes the class test: it is U0 or U1 in `docs/roadmap.md`'s intake table, touches only modules named in section 4, and adds no spend, credential, dependency or operator-facing surface. Each PR cites the Decision. It ends when section 1 holds or on your word. Consequence: no per-item approval; work happens outside the queue's order, bounded by lanes, review and the merge classes.
- **B. Yes, for the listed items only**: Yes, for the listed items only. Consequence: each newly found blocker waits for you (INFERENCE: one to three a day at the current find rate).
- **C. No**: No. Consequence: every fix keeps costing an amendment, a card and a press.

## Rationale

Operator, 2026-11-22 2:30:25 PM PST (22:30:25.386Z), a human-origin turn in Signal 18's session f3d1e5f1-8e82-470d-8aea-d68ce34c9365, verified by Rowan 31 under Decision 0229 A (transcript route; source session id, timestamp and verbatim quote recorded here): 'Follow the suggested advice unless you have an objection.' Signal 18 (local_82202837-ab9e-4dc8-bc96-d836d05aa9e5) found no objection and relayed the advisor's reply string, verbatim: 'Playbook: D1 A · D2 A · D3 A (Rowan and builders now, Signal once relay-hosted) · D4 B. Engine: activate yes, amend Action 1 yes, reinstall yes after the ls-tree fetch fix. I'll press the standing grant when you send the card with the clearance and pre-mortem done.' Caveat, recorded honestly: his words came before the advisor's report (22:32:55Z). What he had seen was Signal 18's message of 22:27:43Z, which listed D1 A, D2 A, D3 A and D4 A, the Playbook's recommended letters; for this item it read: 'D1 A: build from Issues directly. No Plan Action or Ask needed per item.' That summary did not state the class test, the item list, that each PR cites the Decision, or the end condition; the record states them and is narrower than the summary he saw, not wider. The item list ('this playbook's item list', Playbook section 4): H1, H2, H3, P1, B1, B2, B3, B4, B5, B6a, B6b, B6c, B7, B8, B9, B10, B11, B12, B13, B14, B15, B16a, B16b, B17, B18, B19, B20, B21, B22. 'Section 1 holds' means E1, E3 and E4 all hold (Playbook section 1, verbatim): E1 'Clean nights in a row. A clean night: the timer pressed at least one card under the standing grant, at least one worker merge landed, no batch read failed, and no person or coordinator pressed, merged, repaired, reset, restarted or turned production Off by hand.' Target: 3 consecutive. E3 'The four NORTH_STAR gates are true live, each with a caller and a live receipt': (1) a `production_worker_merges` row `merged` on a timer-pressed card; (2) a park receipt followed by admission of the next independent Action in the same run; (3) the timer starts the next approved Plan after scope complete with no touch; (4) the 8 AM report delivered three mornings running with every overnight merge re-verified. E4 'Session handoff works without the operator': no coordinator turn above 400k tokens for 7 days; 2 or more relay-launched handoffs accepted; no operator-started Rowan for 7 days. Scope (Playbook section 2, verbatim): 'What always stays his under every option: spend, credentials, the standing-grant press and START authority (Decision 0241), which Plans enter the queue, raising or answering any Decision, CONSTITUTION.md, branch protection and CI-as-gate, deploy, publish, delete, messaging.' So this answer lets builders build and open pull requests; it grants no merge: every merge stays under Decisions 0060/0080, 0182 C and 0230 A, and a PR that loosens a gate follows the answer to P-D4. Items whose Playbook entry depends on an unanswered Decision (B20 on P-D5) or names the operator as merger (B18, B20, B22) are not made mergeable by this answer. Builders are implementer helpers Rowan launches at depth 1 (Decisions 0114 and 0212 A); they never merge, launch subagents or message the operator (Playbook section 5). The work trace is the Issue and the PR ('Closes #N'), as docs/agent-guidance/operator-directed-work.md describes, with the PR line 'No governed Action; operator-directed under Decision <this id>'. Outside this class an Issue remains a signal, never authority: the same record PR adds a project-owned AGENTS.md paragraph naming this Decision as the only class in which an Issue carries work without an Action, and stating that the authority is this Decision, never the Issue. His read-back of this record and his merge of its record pull request are the ratification; nothing in this record is in force before that merge. It changes what agents are authorized to do, so under the Constitution's Authority section and Decision 0273 condition 3 its record PR is the operator's merge. Options and consequences are copied from the Playbook workspaces/playbook-to-unattended-production.md (outside the repository; sha256 440e52df406e7fd111c51b69b68339c975b179e92a11628992fe3de594e6510c), section 2, without change except where this rationale says so; 'this playbook', 'section N' and item ids (H1-H3, P1, B1-B22) in them mean that file at that sha256. The option labels are added because the Playbook gives letters only and `arcadia decision approve` records an option's exact label as the answer (src/commands/decision.ts:451-461). Next free number: allocate from fresh origin/main at settle. This draft grants nothing.

Proposed by Agent Ask ellis-playbook-d1-build-from-issues-20261122.
