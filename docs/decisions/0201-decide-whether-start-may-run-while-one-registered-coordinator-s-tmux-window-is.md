---
arcadia: v1
type: decision
id: "0201"
slug: decide-whether-start-may-run-while-one-registered-coordinator-s-tmux-window-is
project: arcadia
status: approved
question: Decide whether START may run while one registered coordinator's tmux window is open, which amends one case of the production rule Decision 0156 keeps ("zero live admissions and no live Sessions").
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Allow START while one registered coordinator window is open, and nothing else
options:
  - label: A. Allow START while one registered coordinator window is open, and nothing else
    consequence: "0156 is amended for one case. START may run with a session only when all of this holds: its exact name comes from a current coordinator record, no new coordinator for that role is mid-launch, the session has exactly one pane, and a process under that pane runs the recorded session id. Everything else still refuses. No effect until a first-record route exists. Later costs, once records exist: after a handoff the old window refuses every START until someone stops it. A handoff landing between START's two checks burns that one-shot press. A handoff after the last check could let production activate while a new coordinator is still launching, with two windows open. Nothing coordinates a handoff with START yet, and Rowan would require that before any automatic handoff is turned on. Limits: this is no cryptographic proof, since a program could copy that session id from its arguments. The record lives in a database agents can write to, where only a rule stops direct edits. A second, unadmitted agent running under the same pane would go undetected. Risk: a mistake here lets a competing Session run through a press."
    recommended: true
  - label: "B. No tolerance: keep 0156 and stop the coordinator window before each press"
    consequence: "#2338 drops its tolerance and keeps its stricter tmux read. The window must be stopped just before each press and can be relaunched right after, and someone must own that step. It's the strictest option that still uses the relay, and it adds a step to every press."
    recommended: false
  - label: C. Keep START as it is; the relay launches some other way than tmux
    consequence: "START's tolerance stays out and the launcher changes instead; #2338's stricter tmux read still goes in. Decision 0191 names tmux and its test launches are written for tmux, so this needs its own amendment. Nothing ships soon. Worth it only if you distrust any tmux session during a press."
    recommended: false
  - label: D. No relay coordinator around a press; desktop Rowan only
    consequence: "The relay's launch step stays off, Rowan stays a desktop session, and 0156 stands with no amendment; #2338's stricter tmux read still goes in. It costs the least now and removes the risk. Coordinator handoffs keep needing a person to start the successor, so a handoff while you sleep waits until you wake. That is the gap you asked to close."
    recommended: false
confidence: high
plan: record-run-unattended-test-pins-20261107-part-2
updated: 2026-11-09
answer: A. Allow START while one registered coordinator window is open, and nothing else
decided: 2026-11-09
---

# Decision 0201: Decide whether START may run while one registered coordinator's tmux window is open, which amends one case of the production rule Decision 0156 keeps ("zero live admissions and no live Sessions").

## Options

- **A. Allow START while one registered coordinator window is open, and nothing else** (recommended): 0156 is amended for one case. START may run with a session only when all of this holds: its exact name comes from a current coordinator record, no new coordinator for that role is mid-launch, the session has exactly one pane, and a process under that pane runs the recorded session id. Everything else still refuses. No effect until a first-record route exists. Later costs, once records exist: after a handoff the old window refuses every START until someone stops it. A handoff landing between START's two checks burns that one-shot press. A handoff after the last check could let production activate while a new coordinator is still launching, with two windows open. Nothing coordinates a handoff with START yet, and Rowan would require that before any automatic handoff is turned on. Limits: this is no cryptographic proof, since a program could copy that session id from its arguments. The record lives in a database agents can write to, where only a rule stops direct edits. A second, unadmitted agent running under the same pane would go undetected. Risk: a mistake here lets a competing Session run through a press.
- **B. No tolerance: keep 0156 and stop the coordinator window before each press**: #2338 drops its tolerance and keeps its stricter tmux read. The window must be stopped just before each press and can be relaunched right after, and someone must own that step. It's the strictest option that still uses the relay, and it adds a step to every press.
- **C. Keep START as it is; the relay launches some other way than tmux**: START's tolerance stays out and the launcher changes instead; #2338's stricter tmux read still goes in. Decision 0191 names tmux and its test launches are written for tmux, so this needs its own amendment. Nothing ships soon. Worth it only if you distrust any tmux session during a press.
- **D. No relay coordinator around a press; desktop Rowan only**: The relay's launch step stays off, Rowan stays a desktop session, and 0156 stands with no amendment; #2338's stricter tmux read still goes in. It costs the least now and removes the risk. Coordinator handoffs keep needing a person to start the successor, so a handoff while you sleep waits until you wake. That is the gap you asked to close.

## Rationale

Decision 0191-may-arcadia-s-deterministic-relay-launch-successor-coordinator-sessions-signal lets the relay start a successor coordinator in a tmux window, and START refuses any live tmux session, so the two cannot both hold. PR #2338 narrows that refusal to one window, and independent review says no Decision covers that today (comments 6734275012 and 6734971749). Desktop Rowans already run through START unseen by this check, which is the case for allowing one. A real press has never run with such a window open, and the process check has never been tested on a live window. Approving A launches nothing and has no practical effect yet: nothing creates the first coordinator record, so `renew` always refuses and no window can be tolerated. This Decision does not approve a route for that first record, the two short test launches (P1 and P2) that Decision 0191 requires under their own approvals and cost limits, or the real launch proof. Each needs its own answer. Merging #2338 does two things whatever you answer here: any tmux read error now refuses START, and prepared START cards must be regenerated because the START script changes, so it merges while production is Off. Rowan recommends A because it keeps the refusal for everything else.

Proposed by Agent Ask decide-start-tolerates-relay-coordinator-20261109-r4.
