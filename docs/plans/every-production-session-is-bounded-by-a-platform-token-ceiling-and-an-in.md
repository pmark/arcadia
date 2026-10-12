---
arcadia: v1
type: plan
slug: every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in
project: arcadia
status: active
milestone: Every production Session is bounded by a platform token ceiling and an in-Session environment probe, and every stop it raises clears from /todo in at most two clicks, proven by replays of recorded sessions and one validated ledger row per session.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-12
actions:
  - id: replay-environment-wall-session
    title: "Implement a fast-rehearsal scenario built from the 2026-10-12 00:40Z Session receipts (no diff, workspace write denied, sandbox test refusals) that must end refused or stopped before a fixed token bound, and make a missing report.json fail loudly."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-replay-environment-wall-session-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask replay-environment-wall-session
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Recorded failures are free failing tests; the first run cost 11.1M tokens and a missing report.json silently wasted ten minutes (living notes frictions 11, 17)."
    acceptance_criteria:
      - The scenario exists in the fast-rehearsal set, is deterministic and runs in under 30 seconds, and on a tree without the environment-wall stop it fails.
      - scripts/fast-rehearsal.mjs prints the report path and exits non-zero when report.json is missing or unparsable.
      - The scenario asserts exactly one named environment blocker, no second launch and a recorded per-attempt token record.
      - Focused tests for the scenario builder pass and pnpm fast-rehearsal passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: record-session-ledger
    title: Implement docs/reports/session-ledger.jsonl with a typed schema, a deterministic validator wired into CI, and backfilled rows for A12, A3, A5 and A6 so every session records cost, review findings, touches and frictions in one compact row.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-record-session-ledger-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask record-session-ledger
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Spend and defect data today is estimated prose; one validated row per session makes the next hardening choice evidence-based and cheap to read."
    acceptance_criteria:
      - The schema requires session_id, role, model, effort, action_id, pr, tokens_in_uncached, tokens_in_cached, tokens_out, wall_min, attempts, review_rounds, blocking_findings, operator_touches, host_touches, frictions and outcome with a stop_reason.
      - The validator rejects a row with a missing or mistyped field and the CI job runs it on every pull request that touches the ledger.
      - The ledger has four backfilled rows for A12, A3, A5 and A6 taken from the living notes, and the living notes link to the ledger.
      - Focused validator tests pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: enforce-session-token-ceiling
    title: Implement a per-Session input-token ceiling in the production policy that ends the attempt and writes a budget_exhausted stop receipt with cached and uncached tokens recorded separately.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-enforce-session-token-ceiling-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask enforce-session-token-ceiling
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Platform caps, not prompt discipline, must bound spend for every failure mode including ones nobody has seen; the capacity gate is off and a heavy-tier Action ran unmetered."
    acceptance_criteria:
      - The replay scenario stops at the ceiling and the stop receipt names budget_exhausted with the ceiling value and both token counts.
      - An attempt that hits the ceiling is not relaunched automatically and raises exactly one named blocker.
      - The ceiling has a per-tier default and cannot be disabled or raised from a prompt, brief or Action text.
      - Focused tests for the ceiling and the production tick pass and pnpm fast-rehearsal passes.
    depends_on: [replay-environment-wall-session]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: probe-environment-inside-session
    title: Implement a deterministic probe script that runs as the Session first step and ends the attempt with environment_wall when the Session sandbox cannot write the workspace database, run host validation or produce a preservation receipt.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a deterministic probe script that runs as the Session first step and ends the attempt with environment_wall when the Session sandbox cannot write the workspace database, run host validation or produce a preservation receipt.
    expected_artifact: Evidence satisfying Agent Ask probe-environment-inside-session
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Session sandbox writable roots cannot be read offline, so only a probe inside the Session is truthful; the ceiling keeps it cheap."
    acceptance_criteria:
      - A fake provider with a read-only database is refused within the probe token budget and the probe JSON is attached to the reconcile receipt.
      - The host-worker side probe is no longer counted as evidence of Session capability.
      - A passing probe adds a bounded, recorded token cost and a failing probe raises exactly one environment_wall blocker with its remedy.
      - Focused tests and pnpm fast-rehearsal pass.
    depends_on: [enforce-session-token-ceiling]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: one-click-clear-every-blocker-kind
    title: Implement a blocker-kind remedy registry and /todo controls so every platform-raised stop clears in at most two clicks with no typing.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a blocker-kind remedy registry and /todo controls so every platform-raised stop clears in at most two clicks with no typing.
    expected_artifact: Evidence satisfying Agent Ask one-click-clear-every-blocker-kind
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Every new blocker kind was born without a remote clear (frictions 12, 14); a build-failing enumeration prevents the pattern."
    acceptance_criteria:
      - An enumeration test fails when any emitted blocker kind has no registered remedy; environment_wall, budget_exhausted, scope_successor_held and scope_pointer_mismatch are registered.
      - Each registered clear is a button on /todo or /actions that resolves in at most two interactions and runs through the existing operator-script machinery without copy or paste.
      - reset-repair-budget is reachable from /todo for an environment_wall and budget_exhausted stop.
      - Focused todo and dashboard tests pass and the dashboard graph has no containerAuditTransport import.
    depends_on: [enforce-session-token-ceiling, probe-environment-inside-session]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: fix-docs-sync-lock-and-activation-order
    title: Implement activation so the activated Plan Actions are positioned inside the apply transaction and docs sync retries a transient database lock.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement activation so the activated Plan Actions are positioned inside the apply transaction and docs sync retries a transient database lock.
    expected_artifact: Evidence satisfying Agent Ask fix-docs-sync-lock-and-activation-order
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Activation left four unpositioned Actions and a stale pointer that needed a manual arrange and an extra pull request (frictions 3, 14)."
    acceptance_criteria:
      - A test reproduces the post-activation SQLite lock and afterwards advance queue reports orderValid true with unpositionedCount 0.
      - Other Projects relative queue order is unchanged by an activation.
      - A queue reorder stages the matching pointer change in the same settlement so current_action does not stay on a moved Action.
      - Focused settlement and queue tests pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: revise-agent-roles-and-session-briefs
    title: Record the revised agent roles and a compact session brief template in the governed guidance so Lead sessions start from a generated brief and every role leaves one ledger row.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-revise-agent-roles-and-session-briefs-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask revise-agent-roles-and-session-briefs
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Reviewers produced the best defect yield and Lead sessions grew large; roles and briefs should be recorded where agents retrieve them."
    acceptance_criteria:
      - docs/agent-guidance records Lead as one Action per session, Driver on standard tier returning only diff, test command and exit code, Reviewer as one fresh role replacing Critic, a deterministic Replayer script role, and the live Observer deferred with its revisit trigger.
      - "A brief template names file:line ranges, focused test files, the adversarial strings for any guard or validator Action, and forbids repeating sandbox text in hand-backs."
      - The model and effort per role are stated with the cost reasoning and the guidance index routes to the new section.
      - The documentation budget check and docs link check pass.
    depends_on: [record-session-ledger]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
questions: []
decisions: []
current_action: probe-environment-inside-session
recommended_model: gpt-5.6-terra
recommended_reasoning_effort: medium
---

# Every production Session is bounded by a platform token ceiling and an in-Session environment probe, and every stop it raises clears from /todo in at most two clicks, proven by replays of recorded sessions and one validated ledger row per session.

Created as an inactive draft from accepted Agent Ask plan-autonomous-production-hardening-2026-10-12; creation changed no pointer. Current activation is recorded in frontmatter.
