---
arcadia: v1
type: decision
id: "0229"
slug: decide-how-a-coordinator-desktop-or-tmux-cli-session-verifies-an-operator
project: arcadia
status: approved
question: "Decide how a coordinator (desktop or tmux/CLI session) verifies an operator approval without the operator copy-pasting it, and whether that verification may act before the durable record exists. Governance change: nothing is usable until this Decision is answered."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A: Both. The transcript route is the quick fix; the governed approval record is the durable route. Any coordinator or helper may act on an operator approval only after verifying it by one of the two routes, recording source session id, timestamp and verbatim quote."
options:
  - label: "A: Both. The transcript route is the quick fix; the governed approval record is the durable route. Any coordinator or helper may act on an operator approval only after verifying it by one of the two routes, recording source session id, timestamp and verbatim quote."
    consequence: Copy-pasting stops soon for the transcript route (desktop and tmux/CLI sessions). Verification depends on reading another session's transcript, which a process able to write that directory can forge (not a cryptographic bind). Records are created for each approval so a later audit can replay them.
    recommended: true
  - label: "B: Transcript route only, for desktop and tmux/CLI sessions. No governed approval record is added."
    consequence: Quick and cheap, but durable only as long as the transcript file exists; no approval record survives a session restart or a successor coordinator. The forgery caveat applies in full.
    recommended: false
  - label: "C: Governed approval record only. The operator answers through an authorised surface (Decision answer or existing approval card); any session reads that record, never another session's transcript."
    consequence: Strongest verification and no cross-transcript reads, but it does not fix the paste problem until the operator's surface is built and used for each approval. Until then the paste rule stays in force.
    recommended: false
  - label: "D: Keep the paste-a-quote rule. No verification route is added."
    consequence: No new authority or read path. The operator keeps pasting approvals into each coordinator; stalls continue whenever a successor cannot see his words.
    recommended: false
confidence: high
plan: burn-down-three-verified-test-only-bug-issues-in-unattended-serial-production
updated: 2026-11-13
answer: "A: Both. The transcript route is the quick fix; the governed approval record is the durable route. Any coordinator or helper may act on an operator approval only after verifying it by one of the two routes, recording source session id, timestamp and verbatim quote."
decided: 2026-11-13
---

# Decision 0229: Decide how a coordinator (desktop or tmux/CLI session) verifies an operator approval without the operator copy-pasting it, and whether that verification may act before the durable record exists. Governance change: nothing is usable until this Decision is answered.

## Options

- **A: Both. The transcript route is the quick fix; the governed approval record is the durable route. Any coordinator or helper may act on an operator approval only after verifying it by one of the two routes, recording source session id, timestamp and verbatim quote.** (recommended): Copy-pasting stops soon for the transcript route (desktop and tmux/CLI sessions). Verification depends on reading another session's transcript, which a process able to write that directory can forge (not a cryptographic bind). Records are created for each approval so a later audit can replay them.
- **B: Transcript route only, for desktop and tmux/CLI sessions. No governed approval record is added.**: Quick and cheap, but durable only as long as the transcript file exists; no approval record survives a session restart or a successor coordinator. The forgery caveat applies in full.
- **C: Governed approval record only. The operator answers through an authorised surface (Decision answer or existing approval card); any session reads that record, never another session's transcript.**: Strongest verification and no cross-transcript reads, but it does not fix the paste problem until the operator's surface is built and used for each approval. Until then the paste rule stays in force.
- **D: Keep the paste-a-quote rule. No verification route is added.**: No new authority or read path. The operator keeps pasting approvals into each coordinator; stalls continue whenever a successor cannot see his words.

## Rationale

Signal 9 proposal operator-approval-without-copy-paste-20261113: the operator chose to file both routes, with the quick fix first. Today approvals never cross sessions, so the operator re-pastes his words into each coordinator. A tmux-launched Rowan may lack the desktop list_events tool, so the verification route must also work from a CLI session that can read ~/.claude/projects/*/<session-id>.jsonl (the file family coordinator register --confirm already reads). Either route can fail on an unreadable or ambiguous transcript; both must fail closed. Limits: operator_message = only a genuine user-role entry in the originating session transcript typed by the operator in that session chat; never a tool result, system notification, relayed or summarised peer message, subagent report, hook output or another agent paraphrase. time_bound = approval dated within 30 minutes before the act it permits; older approvals do not carry forward. quote = recorded verbatim with source session id, UTC timestamp and transcript path, never reworded. verifier = a different session from the one whose transcript is read when the transcript owner cannot read its own. scope = no authority widening: only the action the operator words already granted. failure = unreadable, missing, ambiguous, stale or multi-match transcript fails closed (no action, visible hold, paste route remains). tmux_route = a tmux or CLI coordinator finds the Signal session id from its registration record (custodian session id and transcript path); if the Signal transcript is unreadable from its sandbox it stops and asks the operator for option C and does not act on a relayed quote.

Proposed by Agent Ask request-decision-transcript-verified-operator-approval-20261113.
