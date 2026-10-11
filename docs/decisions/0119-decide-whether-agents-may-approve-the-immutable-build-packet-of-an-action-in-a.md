---
arcadia: v1
type: decision
id: "0119"
slug: decide-whether-agents-may-approve-the-immutable-build-packet-of-an-action-in-a
project: arcadia
status: approved
question: Decide whether agents may approve the immutable build packet of an Action in a registered disposable fixture Project, so fixture Actions run from Launch to a merged pull request without an operator tap per Action.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Agents approve fixture build packets
options:
  - label: Agents approve fixture build packets
    consequence: Until 2026-10-18, alongside Decision 0100, an agent may approve the build packet of an Action only in a registered disposable fixture Project (today pmark/arcadia-three-action-rehearsal-20261004) or a Decision 0082 experiment workspace, using the no-execute approval, with a receipt naming the agent. It never applies to Arcadia's own repository or any other Project, and it approves no planning run, Grant or production change. The fixture chain then runs from Launch to merged PR with no operator tap; any Decision raised inside the fixture still waits for you.
    recommended: true
  - label: Not now
    consequence: "Nothing changes. Each fresh fixture Action waits for your packet approval at a terminal (or a dashboard button once #1190 ships). Revival trigger: the next fixture chain run that stalls more than an hour on a packet approval."
    recommended: false
confidence: high
plan: governed-agent-roles-one-real-action-and-one-interactive-session-each-run-as-a
updated: 2026-10-10
answer: Agents approve fixture build packets
decided: 2026-10-10
---

# Decision 0119: Decide whether agents may approve the immutable build packet of an Action in a registered disposable fixture Project, so fixture Actions run from Launch to a merged pull request without an operator tap per Action.

## Options

- **Agents approve fixture build packets** (recommended): Until 2026-10-18, alongside Decision 0100, an agent may approve the build packet of an Action only in a registered disposable fixture Project (today pmark/arcadia-three-action-rehearsal-20261004) or a Decision 0082 experiment workspace, using the no-execute approval, with a receipt naming the agent. It never applies to Arcadia's own repository or any other Project, and it approves no planning run, Grant or production change. The fixture chain then runs from Launch to merged PR with no operator tap; any Decision raised inside the fixture still waits for you.
- **Not now**: Nothing changes. Each fresh fixture Action waits for your packet approval at a terminal (or a dashboard button once #1190 ships). Revival trigger: the next fixture chain run that stalls more than an hour on a packet approval.

## Rationale

Under Decision 0100 an agent can launch fixture Actions and merge their pull requests on green, and on 2026-10-10 four fixture Actions ran unattended that way (fixture PRs #11-#14). Each fresh Action still stops at its build-packet approval, which is an operator Decision that 0100 does not cover, and the dashboard has no button for it (#1190), so every step waits for the operator at a terminal. The operator chose to raise this extension in chat.

Proposed by Agent Ask raise-fixture-packet-approval-20261010.
