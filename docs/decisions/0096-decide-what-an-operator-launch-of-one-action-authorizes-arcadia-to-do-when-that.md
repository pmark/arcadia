---
arcadia: v1
type: decision
id: "0096"
slug: decide-what-an-operator-launch-of-one-action-authorizes-arcadia-to-do-when-that
project: arcadia
status: open
question: Decide what an operator Launch of one Action authorizes Arcadia to do when that session exits while production is not Active. This gates the Action operator-launch-runs-to-completion in the reliable single-session Plan. Nothing is authorized by raising this Decision.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Launch authorizes validate, commit, push and draft PR for that one Action, once
options:
  - label: Launch authorizes validate, commit, push and draft PR for that one Action, once
    consequence: "The authorization is minted only by a confirmed Launch: the dashboard's Launch confirmation, or arcadia session launch --operator-launch answered at an interactive terminal prompt. It is one-shot and bound to that Action and Session. A launch without that confirmation, including any launch from inside an Arcadia Session or a non-interactive shell, carries none. This guards against accidental or routine agent launches, not against a deliberately misbehaving local process, and each mint is recorded in a receipt you can audit. When the Session exits, Arcadia runs host-side validation, commits the candidate in its worktree, pushes its branch with the existing GitHub credential and reconciles the exit. On accepted completion only, it opens or updates a draft PR. There is no merge, no integration, no production activation and no other Action. The authorization is used up by that exit or expires after 24 hours. Merging still follows Decisions 0060 and 0080."
    recommended: true
  - label: Launch authorizes local validation and commit only
    consequence: The same one-shot authorization, minted by the same confirmed Launch, covers only host-side validation, a local commit on the worktree branch and reconcile. Nothing is pushed and no PR is opened. The session board shows 'preserved locally', and you or an agent push and open the PR by hand. The live proof's criterion would be amended from 'to a draft PR' to 'to a preserved local candidate'.
    recommended: false
  - label: Not now
    consequence: "Nothing changes. Operator launches keep ending incomplete_resumable unless production is Active for exactly that Action. The Action operator-launch-runs-to-completion, the offline proof and the live proof stay blocked. Headless launch, logging, timeouts and the session board are still built. Revival trigger: your next request to launch an Action from the page."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0096: Decide what an operator Launch of one Action authorizes Arcadia to do when that session exits while production is not Active. This gates the Action operator-launch-runs-to-completion in the reliable single-session Plan. Nothing is authorized by raising this Decision.

## Options

- **Launch authorizes validate, commit, push and draft PR for that one Action, once** (recommended): The authorization is minted only by a confirmed Launch: the dashboard's Launch confirmation, or arcadia session launch --operator-launch answered at an interactive terminal prompt. It is one-shot and bound to that Action and Session. A launch without that confirmation, including any launch from inside an Arcadia Session or a non-interactive shell, carries none. This guards against accidental or routine agent launches, not against a deliberately misbehaving local process, and each mint is recorded in a receipt you can audit. When the Session exits, Arcadia runs host-side validation, commits the candidate in its worktree, pushes its branch with the existing GitHub credential and reconciles the exit. On accepted completion only, it opens or updates a draft PR. There is no merge, no integration, no production activation and no other Action. The authorization is used up by that exit or expires after 24 hours. Merging still follows Decisions 0060 and 0080.
- **Launch authorizes local validation and commit only**: The same one-shot authorization, minted by the same confirmed Launch, covers only host-side validation, a local commit on the worktree branch and reconcile. Nothing is pushed and no PR is opened. The session board shows 'preserved locally', and you or an agent push and open the PR by hand. The live proof's criterion would be amended from 'to a draft PR' to 'to a preserved local candidate'.
- **Not now**: Nothing changes. Operator launches keep ending incomplete_resumable unless production is Active for exactly that Action. The Action operator-launch-runs-to-completion, the offline proof and the live proof stay blocked. Headless launch, logging, timeouts and the session board are still built. Revival trigger: your next request to launch an Action from the page.

## Rationale

Operator direction, 2026-10-09: reliably launching one session and having it run to completion comes before almost anything else.

Today a session's exit is preserved only while managed production is Active and scoped to exactly that Action, with a remote-preservation grant (src/production/sessionHandoff.ts:130-143). Preserving means host-side validation, a commit, a push and a draft PR. An operator Launch from the dashboard or CLI therefore ends incomplete_resumable, with no PR.

Agents already push branches and open PRs by hand under AGENTS.md handoff. What is new is that the host does it unattended after a session you launched. Pushing a branch with the existing GitHub credential is publication under CONSTITUTION Authority, which is why this is your call. No option includes merging; merges stay under Decisions 0060 and 0080.

Proposed by Agent Ask raise-operator-launch-authority-decision-20261009-r3.
