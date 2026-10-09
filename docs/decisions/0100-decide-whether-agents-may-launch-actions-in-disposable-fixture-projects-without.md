---
arcadia: v1
type: decision
id: "0100"
slug: decide-whether-agents-may-launch-actions-in-disposable-fixture-projects-without
project: arcadia
status: approved
question: Decide whether agents may launch Actions in disposable fixture Projects without a per-launch operator confirmation, and merge those fixture pull requests on green, so the single-Action loop can be debugged without the operator present.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Standing fixture launch, with merge on green
options:
  - label: Standing fixture launch, with merge on green
    consequence: "Until 2026-10-18, an agent may mint Decision 0096's one-shot launch authorization without an interactive confirmation, only for Actions in disposable fixture Projects whose repository is a registered fixture (today pmark/arcadia-three-action-rehearsal-20261004) or an experiment workspace under Decision 0082. Each mint is recorded in a receipt naming the agent. The exit authority is unchanged: host validation, commit, push to the fixture repository and one draft pull request. The agent may also run that fixture's reviewed reset scripts, and merge the fixture's own pull request once all its checks pass and an independent review of its head finds nothing blocking. It never applies to Arcadia's own repository or any other Project, never activates production, and any Decision raised inside a fixture still waits for you and pings you. The debug loop runs without you; the risk is limited to a disposable repository. It stops at expiry or at any Decision 0082 stop condition."
    recommended: true
  - label: Standing fixture launch, you merge
    consequence: The same launch and reset authority for fixtures, but fixture pull requests stay draft and only you merge them. Single-Action runs can be repeated without you; anything that needs a merged fixture result, such as a serial chain, still waits for you.
    recommended: false
  - label: Not now
    consequence: "Nothing changes. Every fixture launch waits for your confirmed Launch on /production or at a terminal, so the debug loop pauses whenever you are away. Revival trigger: the next fixture defect whose relaunch waits more than an hour for a confirmation."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
answer: Standing fixture launch, with merge on green
decided: 2026-10-09
---

# Decision 0100: Decide whether agents may launch Actions in disposable fixture Projects without a per-launch operator confirmation, and merge those fixture pull requests on green, so the single-Action loop can be debugged without the operator present.

## Options

- **Standing fixture launch, with merge on green** (recommended): Until 2026-10-18, an agent may mint Decision 0096's one-shot launch authorization without an interactive confirmation, only for Actions in disposable fixture Projects whose repository is a registered fixture (today pmark/arcadia-three-action-rehearsal-20261004) or an experiment workspace under Decision 0082. Each mint is recorded in a receipt naming the agent. The exit authority is unchanged: host validation, commit, push to the fixture repository and one draft pull request. The agent may also run that fixture's reviewed reset scripts, and merge the fixture's own pull request once all its checks pass and an independent review of its head finds nothing blocking. It never applies to Arcadia's own repository or any other Project, never activates production, and any Decision raised inside a fixture still waits for you and pings you. The debug loop runs without you; the risk is limited to a disposable repository. It stops at expiry or at any Decision 0082 stop condition.
- **Standing fixture launch, you merge**: The same launch and reset authority for fixtures, but fixture pull requests stay draft and only you merge them. Single-Action runs can be repeated without you; anything that needs a merged fixture result, such as a serial chain, still waits for you.
- **Not now**: Nothing changes. Every fixture launch waits for your confirmed Launch on /production or at a terminal, so the debug loop pauses whenever you are away. Revival trigger: the next fixture defect whose relaunch waits more than an hour for a confirmation.

## Rationale

Decision 0096 mints the one-shot launch authorization only from a confirmed Launch (the dashboard dialog or an interactive terminal prompt), so every fixture relaunch while debugging the single-Action path waits on the operator. On 2026-10-09 three live defects (#1155, #1158, #1162) each needed a fresh confirmed relaunch. The operator asked in chat for a fixture-only standing launch so the release manager can iterate unattended, with merge on green where the operator is pinged only for important decisions. This asks for a narrow, expiring extension of Decision 0096 to disposable fixtures; nothing is authorized by raising it. Merge on green for Arcadia's own pull requests is already standing (Decisions 0060 and 0080) and is not changed here.

Proposed by Agent Ask raise-fixture-standing-launch-20261009.
