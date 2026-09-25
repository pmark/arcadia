---
arcadia: v1
type: decision
id: "0070"
slug: decide-whether-an-action-s-completion-settles-after-its-pr-merges-applied
project: arcadia
status: open
question: Decide whether an Action's completion settles after its PR merges, applied serially on main by the host, instead of inside the candidate branch before push.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Settle after merge, serially, with host push
options:
  - label: Settle after merge, serially, with host push
    consequence: "Governance files leave every PR, so parallel sessions stop conflicting; the host worker (or arcadia go preflight) settles merged completions in merge order with no LLM and pushes chore(arcadia): settle commits to main. AGENTS.md's settle-in-candidate rule is replaced. The pointer lags a merge by at most one worker tick."
    recommended: true
  - label: Settle after merge, operator pushes
    consequence: Same conflict elimination, but the settlement commit stays LOCAL ONLY on main until the operator (or an operator-run /runs action) pushes it; no new unattended push authority, at the cost of a manual step after every merge batch.
    recommended: false
  - label: Keep settling in the candidate
    consequence: "No change: parallel PRs keep conflicting on PROJECT.md, the Plan, and MISSION_LOG.md, and each conflict is repaired by re-running the settlement against fresh main. The two held Actions (settle-squash-merged-completion-drafts, sweep-merged-completions-before-dispatch) are closed as rejected."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-25
---

# Decision 0070: Decide whether an Action's completion settles after its PR merges, applied serially on main by the host, instead of inside the candidate branch before push.

## Options

- **Settle after merge, serially, with host push** (recommended): Governance files leave every PR, so parallel sessions stop conflicting; the host worker (or arcadia go preflight) settles merged completions in merge order with no LLM and pushes chore(arcadia): settle commits to main. AGENTS.md's settle-in-candidate rule is replaced. The pointer lags a merge by at most one worker tick.
- **Settle after merge, operator pushes**: Same conflict elimination, but the settlement commit stays LOCAL ONLY on main until the operator (or an operator-run /runs action) pushes it; no new unattended push authority, at the cost of a manual step after every merge batch.
- **Keep settling in the candidate**: No change: parallel PRs keep conflicting on PROJECT.md, the Plan, and MISSION_LOG.md, and each conflict is repaired by re-running the settlement against fresh main. The two held Actions (settle-squash-merged-completion-drafts, sweep-merged-completions-before-dispatch) are closed as rejected.

## Rationale

Every complete settlement rewrites the same shared lines in the candidate branch: PROJECT.md current_action and updated, the active Plan's current_action and updated, and the tail of MISSION_LOG.md (src/ask/settlement.ts:777-822). Two parallel PRs therefore always conflict on governance files even when their code is disjoint, and the only correct repair is re-deriving the settlement against fresh main. The proposed fix: a PR carries only its drafted complete Ask (a unique .arcadia/asks path that never conflicts); after merge, the existing deterministic auto-settle (src/ask/autoSettleBeforeDispatch.ts), extended to a squash-safe merged-content check and a sweep of every merged pending completion in merge order, applies them as one serial writer and pushes the settlement commit to main. This reverses AGENTS.md's 'One session completes one Action' rule (settle in the candidate before push) and grants an unattended host process push-to-main for settlement commits only, which is why it is a Decision rather than an agent call. Operator requested this design 2026-09-25 and asked that its build be held behind prove-two-action-unattended-production.

Proposed by Agent Ask decide-settle-completions-after-merge-2026-09-25.
