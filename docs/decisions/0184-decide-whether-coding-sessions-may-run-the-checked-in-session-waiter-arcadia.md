---
arcadia: v1
type: decision
id: "0184"
slug: decide-whether-coding-sessions-may-run-the-checked-in-session-waiter-arcadia
project: arcadia
status: open
question: Decide whether coding sessions may run the checked-in session waiter, `arcadia timeline --wait`, as standing direction without the operator's word in each session.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: A. Sanction the checked-in waiter as standing direction in the bootstrap
options:
  - label: A. Sanction the checked-in waiter as standing direction in the bootstrap
    consequence: "Through docs/agents-context.md and this Decision. The scope is `arcadia timeline --wait` only: its local reads, plus its `--pull-requests` `gh api` GETs under existing auth. It covers no other polling, network use or command. This removes about 2 operator touches per coordinator session from the first night it ships, at up to about 120 GitHub GETs an hour per waiter. A host may still ask, and the probe will tell."
    recommended: true
  - label: B. Sanction local waits only, and build D1 so sessions never poll GitHub
    consequence: The operator's word covers production and card waits now. Own-PR wakes cost a touch per session until D1, a host-side GitHub watcher, lands after production is Off.
    recommended: false
  - label: C. No standing direction
    consequence: "The per-session word continues: 1-2 operator touches per coordinator session, as tonight."
    recommended: false
confidence: high
plan: portfolio-docs-protocol
updated: 2026-11-07
---

# Decision 0184: Decide whether coding sessions may run the checked-in session waiter, `arcadia timeline --wait`, as standing direction without the operator's word in each session.

## Options

- **A. Sanction the checked-in waiter as standing direction in the bootstrap** (recommended): Through docs/agents-context.md and this Decision. The scope is `arcadia timeline --wait` only: its local reads, plus its `--pull-requests` `gh api` GETs under existing auth. It covers no other polling, network use or command. This removes about 2 operator touches per coordinator session from the first night it ships, at up to about 120 GitHub GETs an hour per waiter. A host may still ask, and the probe will tell.
- **B. Sanction local waits only, and build D1 so sessions never poll GitHub**: The operator's word covers production and card waits now. Own-PR wakes cost a touch per session until D1, a host-side GitHub watcher, lands after production is Off.
- **C. No standing direction**: The per-session word continues: 1-2 operator touches per coordinator session, as tonight.

## Rationale

Coding-agent hosts treat timed polling as needing the operator's word in each session, so every coordinator session tonight cost one or two operator touches before it could wait on a merge, press or production change, and Rowan slept 65 minutes on a red check with no wake (Signal observation row 22). The design in docs/design/session-notifications.md (PR #2172, reviewed APPROVE at b8ca92202) proposes one read-only waiter, `arcadia timeline --wait`, and puts this question to the operator with options A, B and C exactly as below. A notification is never permission: each event is evidence that a session re-reads before acting, and the waiter writes nothing. The operator chose A in Signal 2's chat on 2026-11-07: "A, standing permission". This changes what agents may run without asking, so the pull request recording it waits for the operator's word.

Proposed by Agent Ask decide-waiter-standing-direction-20261107.
