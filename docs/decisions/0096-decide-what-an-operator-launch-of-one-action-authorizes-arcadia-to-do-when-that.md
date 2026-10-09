---
arcadia: v1
type: decision
id: "0096"
slug: decide-what-an-operator-launch-of-one-action-authorizes-arcadia-to-do-when-that
project: arcadia
status: open
question: Decide what an operator Launch of one Action authorizes Arcadia to do when that session exits while production is not Active. Nothing is authorized by raising this Decision.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Launch authorizes preserve, push and draft PR for that one Action, once
options:
  - label: Launch authorizes preserve, push and draft PR for that one Action, once
    consequence: When you press Launch on one Action, Arcadia records a one-shot authorization scoped to that Action and that session. When the session exits, Arcadia commits the candidate in its worktree, pushes its branch, reconciles the exit and, if completion is accepted, opens or updates a draft PR. There is no merge, no production activation and no other Action. The authorization is used up by that one exit or expires after 24 hours. The session board then shows Launch through draft PR with no further steps, and merging still follows the existing independent-review gate.
    recommended: true
  - label: Launch authorizes local preservation only
    consequence: When the session exits, Arcadia commits the candidate on its worktree branch and reconciles the exit, but pushes nothing and opens no PR. The session board shows 'preserved locally'. You or an agent then push and open the PR by hand, so a single run still needs a human step and the live proof's 'no intervention to draft PR' criterion would be amended to 'to a preserved local candidate'.
    recommended: false
  - label: Not now
    consequence: "Nothing changes. Operator launches keep ending incomplete_resumable unless production is Active for exactly that Action. The Action operator-launch-runs-to-completion and the live proof stay blocked. Headless launch, logging, timeouts and the session board can still be built. Revival trigger: your next request to launch an Action from the page."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-09
---

# Decision 0096: Decide what an operator Launch of one Action authorizes Arcadia to do when that session exits while production is not Active. Nothing is authorized by raising this Decision.

## Options

- **Launch authorizes preserve, push and draft PR for that one Action, once** (recommended): When you press Launch on one Action, Arcadia records a one-shot authorization scoped to that Action and that session. When the session exits, Arcadia commits the candidate in its worktree, pushes its branch, reconciles the exit and, if completion is accepted, opens or updates a draft PR. There is no merge, no production activation and no other Action. The authorization is used up by that one exit or expires after 24 hours. The session board then shows Launch through draft PR with no further steps, and merging still follows the existing independent-review gate.
- **Launch authorizes local preservation only**: When the session exits, Arcadia commits the candidate on its worktree branch and reconciles the exit, but pushes nothing and opens no PR. The session board shows 'preserved locally'. You or an agent then push and open the PR by hand, so a single run still needs a human step and the live proof's 'no intervention to draft PR' criterion would be amended to 'to a preserved local candidate'.
- **Not now**: Nothing changes. Operator launches keep ending incomplete_resumable unless production is Active for exactly that Action. The Action operator-launch-runs-to-completion and the live proof stay blocked. Headless launch, logging, timeouts and the session board can still be built. Revival trigger: your next request to launch an Action from the page.

## Rationale

Operator direction, 2026-10-09: reliably launching one session and having it run to completion comes before almost anything else.

Today, a session's exit is preserved (committed, pushed and opened as a draft PR) only while managed production is Active and scoped to exactly that Action, with a remote-preservation grant (src/production/sessionHandoff.ts). An operator Launch from the dashboard or CLI therefore ends incomplete_resumable, with no PR.

This Decision gates the Action operator-launch-runs-to-completion in the draft Plan for reliable single sessions. Pushing a branch and opening a draft PR are remote writes, which is why this is your call. Merging is not part of any option; merges stay under Decisions 0060 and 0080.

Proposed by Agent Ask raise-operator-launch-authority-decision-20261009.
