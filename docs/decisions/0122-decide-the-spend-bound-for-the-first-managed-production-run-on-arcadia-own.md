---
arcadia: v1
type: decision
id: "0122"
slug: decide-the-spend-bound-for-the-first-managed-production-run-on-arcadia-own
project: arcadia
status: open
question: Decide the spend bound for the first managed production run on Arcadia own repository, which today has no provider-window awareness and no operator reserve.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Codex only, gate on, attended first run
options:
  - label: Codex only, gate on, attended first run
    consequence: "Name only codex-cli in the production policy and remove capacityGateEnabled false from the workspace config (operator-owned). Launches are admitted only while the live Codex 5h and 7d windows are fresh (15 minutes) and under 95 percent used; at 95 percent new launches stop on their own, with the refusal visible only in the worker log and timeline. The 5 percent last-slice margin is the only protection for your own Codex use on the shared account, and the 20 percent reserve of Decision 0111 is not built. Claude Code and OpenCode are not used. Concurrency stays 1, Sessions stop at 120 minutes, an Action gets 3 attempts, and with no integration grant the worker spends only on development Sessions while a supervising agent reviews and merges each PR. The first run is attended: you or a supervising agent merge each PR before the next launches. I would also add the missing production preview flag for the Session time limit so 120 minutes can be lowered, and surface capacity refusals in production status, as small follow-up Actions."
    recommended: true
  - label: Gate off, structural bounds only, attended first run
    consequence: "Leave capacityGateEnabled false and rely on the allowlists, concurrency 1, the 120 minute Session limit, 3 attempts per Action, the failed-Run budget and merge-by-supervisor pacing. Both Claude Code and Codex stay usable and nothing is refused for a stale observation. There is no awareness of provider windows: unattended Sessions can drive the shared 5h or 7d window to 100 percent and use up your interactive allowance until it resets, and the only protection is that a provider already at 100 percent is rejected from selection. Cheapest to start, weakest bound."
    recommended: false
  - label: Wait for the reserve and burn rate
    consequence: "No unattended run on Arcadia own repository until Decisions 0103 and 0111 are built: the governed-roles Plan Actions build-operator-presence-proof, select-model-for-delegated-task, broker-delegation-requests, reserve-operator-emergency-capacity and project-token-burn-rate are all open in a Plan that is currently a draft, and would have to be reactivated and finished first. Gives a real 20 percent operator reserve and a projected-burn throttle. The slowest option, and the bug Plan waits."
    recommended: false
  - label: Codex and Claude Code, gate on, after a small build
    consequence: First build a small Action that refreshes the Claude Code usage snapshot unattended (nothing in the worker does today), then enable the gate with both providers. Both windows become real bounds and either provider is refused when stale or at 95 percent, but there is still no substitution between providers, no reserve and no visible refusal until the status surface is added. Adds a build step before the first run; Codex is selected first anyway on cost rank, so it buys little for the bug Plan.
    recommended: false
confidence: high
plan: every-open-github-issue-in-pmark-arcadia-is-classified-once-into-a-five-route
updated: 2026-10-11
---

# Decision 0122: Decide the spend bound for the first managed production run on Arcadia own repository, which today has no provider-window awareness and no operator reserve.

## Options

- **Codex only, gate on, attended first run** (recommended): Name only codex-cli in the production policy and remove capacityGateEnabled false from the workspace config (operator-owned). Launches are admitted only while the live Codex 5h and 7d windows are fresh (15 minutes) and under 95 percent used; at 95 percent new launches stop on their own, with the refusal visible only in the worker log and timeline. The 5 percent last-slice margin is the only protection for your own Codex use on the shared account, and the 20 percent reserve of Decision 0111 is not built. Claude Code and OpenCode are not used. Concurrency stays 1, Sessions stop at 120 minutes, an Action gets 3 attempts, and with no integration grant the worker spends only on development Sessions while a supervising agent reviews and merges each PR. The first run is attended: you or a supervising agent merge each PR before the next launches. I would also add the missing production preview flag for the Session time limit so 120 minutes can be lowered, and surface capacity refusals in production status, as small follow-up Actions.
- **Gate off, structural bounds only, attended first run**: Leave capacityGateEnabled false and rely on the allowlists, concurrency 1, the 120 minute Session limit, 3 attempts per Action, the failed-Run budget and merge-by-supervisor pacing. Both Claude Code and Codex stay usable and nothing is refused for a stale observation. There is no awareness of provider windows: unattended Sessions can drive the shared 5h or 7d window to 100 percent and use up your interactive allowance until it resets, and the only protection is that a provider already at 100 percent is rejected from selection. Cheapest to start, weakest bound.
- **Wait for the reserve and burn rate**: No unattended run on Arcadia own repository until Decisions 0103 and 0111 are built: the governed-roles Plan Actions build-operator-presence-proof, select-model-for-delegated-task, broker-delegation-requests, reserve-operator-emergency-capacity and project-token-burn-rate are all open in a Plan that is currently a draft, and would have to be reactivated and finished first. Gives a real 20 percent operator reserve and a projected-burn throttle. The slowest option, and the bug Plan waits.
- **Codex and Claude Code, gate on, after a small build**: First build a small Action that refreshes the Claude Code usage snapshot unattended (nothing in the worker does today), then enable the gate with both providers. Both windows become real bounds and either provider is refused when stale or at 95 percent, but there is still no substitution between providers, no reserve and no visible refusal until the status surface is added. Adds a build step before the first run; Codex is selected first anyway on cost rank, so it buys little for the bug Plan.

## Rationale

Operator request 2026-10-11 (prep the spend bound; readiness gate 2). Verified read-only against origin/main 7c3f0cd29. Unattended Sessions draw on the same Claude Code and Codex accounts you use interactively. With capacityGateEnabled false every provider reads unmetered by config. Enabling the gate today admits Codex (live app-server read, 7d window 4% used), refuses Claude Code as capacity_stale (its usage snapshot is 71 hours old and nothing unattended refreshes it) and refuses OpenCode as manual_receipt_expired (no probe), with no substitution and a refusal visible only in the worker log and timeline. Decisions 0103 and 0111 (percent-of-window budget, 20 percent reserve) are approved but unbuilt: their Actions are open in a draft Plan, so only the fixed 5 percent last-slice margin exists. Real bounds today: provider and Project/Plan/Action allowlists, concurrency 1, 120 minute Session limit (not settable on tick launches), 3 development attempts per Action, failed-Run budget 8 per Milestone, light-tier session start, and merge-by-supervisor pacing (no integration grant). A short Grant expiry does not bound spend. Cost per Action is unmeasured; one typical Action is one light-tier Session, the code-capped worst case is 13 or more model processes plus uncapped resumes.

Proposed by Agent Ask decide-first-run-spend-bound-2026-10-11.
