---
arcadia: v1
type: plan
slug: reliable-single-session-launch-one-action-as-a-session-and-have-it-run-to
project: arcadia
status: draft
milestone: "Reliable single session: launch one Action as a session and have it run to completion, observably, every time"
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-09
actions:
  - id: headless-observable-session-launch
    title: Make every operator-launched session run headless and leave a complete, persistent record of its output and exit.
    status: open
    responsibility: agent
    effort: session
    next_action: Make every operator-launched session run headless and leave a complete, persistent record of its output and exit.
    expected_artifact: Evidence satisfying Agent Ask headless-observable-session-launch
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009
    acceptance_criteria:
      - "Sessions launched by fingerprint (dashboard session-launch, arcadia session launch, arcadia go --launch) run the provider headless instead of the interactive TUI: claude --print with stream-json output, codex exec with JSON output, opencode run. The same unattended command builder that standing-policy launches use today in src/sessions/index.ts is reused, not duplicated."
      - Every session's combined output is appended to a per-session log file under the workspace (not the repository), named by session id. The provider process's exit code is captured and written to agent_sessions.exit_status for every provider, not only fixture-cli. A crash is therefore distinguishable from a clean exit, and the log survives the tmux session.
      - "Tests drive fixture-cli through the real tmux launch path for: a clean exit (exit_status 0, log present), a non-zero exit (exit_status recorded), and a crash mid-output (log kept). Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact."
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: bounded-session-lifetime
    title: Stop a stuck session automatically so it can never hold the repository lease indefinitely.
    status: open
    responsibility: agent
    effort: session
    next_action: Stop a stuck session automatically so it can never hold the repository lease indefinitely.
    expected_artifact: Evidence satisfying Agent Ask bounded-session-lifetime
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009
    acceptance_criteria:
      - Each session has a wall-clock limit taken from policy, with a default and a per-launch override. When the limit passes, or when the existing pane classifier (src/production/sessionSignals.ts) reports a blocking condition (permission prompt, auth failure, provider limit) that persists past the stall deadline, Arcadia ends the tmux session, writes a session exit receipt with the reason, and releases the lease. It never kills a session that is still making progress within its limit.
      - "The stop path does no more than ending the tmux session: it never deletes the session's worktree or branch, and the existing preservation and reconcile path then runs exactly as for any other exit, so work done so far is kept."
      - Tests cover the time limit, each blocking classifier hit, a progressing session that must not be killed, and lease release. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [headless-observable-session-launch]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: operator-launch-runs-to-completion
    title: Let an operator-launched session for one Action finish with its work preserved and its outcome recorded, without production being Active.
    status: open
    responsibility: agent
    effort: session
    next_action: Let an operator-launched session for one Action finish with its work preserved and its outcome recorded, without production being Active.
    expected_artifact: Evidence satisfying Agent Ask operator-launch-runs-to-completion
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009
    acceptance_criteria:
      - "Implemented only as an open Decision titled for what an operator Launch authorizes (raised alongside this Plan) answers it. If the answer authorizes it: an operator Launch of one Action carries a one-shot, single-Action authorization so that, when its session exits, Arcadia preserves the candidate, reconciles the exit and, if completion is accepted, opens or updates a draft PR, exactly as the production tick does today, without production Active and without any merge."
      - The automatic reconcile does not depend only on the production tick. If no tick runs within a bound after a session exits, the worker reconciles it; if the worker is down, arcadia session reconcile <id> remains the manual fallback and the dashboard shows that it is needed.
      - Tests cover accepted completion to draft PR, incomplete-resumable with the work preserved, a refused authorization (wrong Action, expired, already used), and a missed tick. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [headless-observable-session-launch]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: prove-single-session-offline
    title: Prove the whole single-session path end to end offline, in minutes, on every change.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove the whole single-session path end to end offline, in minutes, on every change.
    expected_artifact: Evidence satisfying Agent Ask prove-single-session-offline
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009
    acceptance_criteria:
      - A fast-rehearsal scenario (tests/fast-rehearsal) runs one Action from a dashboard-equivalent launch request through fixture-cli in a real tmux session, headless logging, exit capture, the bounded-lifetime guard, preservation, reconcile and a draft PR against the fake GitHub, and asserts each receipt. It runs in CI in under 5 minutes, using the same production code, never a separate imitation.
      - Failure injection covers a crash, a stall killed by the limit, and a refused authorization, and each ends in the recorded outcome with no lease held. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [bounded-session-lifetime, operator-launch-runs-to-completion]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: session-board-page
    title: Give the operator one dashboard page that shows everything to do, launches one Action as a session and streams that session's activity live.
    status: open
    responsibility: agent
    effort: session
    next_action: Give the operator one dashboard page that shows everything to do, launches one Action as a session and streams that session's activity live.
    expected_artifact: Evidence satisfying Agent Ask session-board-page
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009
    acceptance_criteria:
      - A dashboard page lists, in one view, every item arcadia todo returns for the operator together with every ready Action from the work queue, each with its Project and Plan. Each ready Action has a Launch control that runs the existing preview-then-launch fingerprint flow (making it next first if needed), shows the preview's consequence before confirming, and never launches without that confirmation.
      - A session view shows status, elapsed time, the live tail of the session's log updated at least every 4 seconds while it runs, the exit code, the reconcile outcome and the PR link when one exists. It reads only the files and CLI output Arcadia already records, and works over the tailnet on a phone.
      - Tests cover the merged list, the launch confirmation flow against a stubbed CLI, and the log tail. The operator guide in START_HERE.md describes the page. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [headless-observable-session-launch]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: prove-single-session-live
    title: Prove one real Action launched from the page runs to a draft PR with no human intervention, three times in a row.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove one real Action launched from the page runs to a draft PR with no human intervention, three times in a row.
    expected_artifact: Evidence satisfying Agent Ask prove-single-session-live
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009
    acceptance_criteria:
      - Three consecutive live runs, each launching one small, real, already-clarified Action from the session board with a real provider, end with the session exiting on its own, its log and exit code recorded, its candidate preserved and a draft PR opened, with no operator or agent intervention between Launch and draft PR. A failed run resets the count, and its defect is fixed offline first in the fast-rehearsal scenario.
      - The evidence names, for each run, the session id, the Action, the exit code, the reconcile outcome, the PR and the elapsed time. The Actions are chosen by the operator or are genuine queued work, never fixtures.
    depends_on: [prove-single-session-offline, session-board-page]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md"]
questions: []
decisions: []
---

# Reliable single session: launch one Action as a session and have it run to completion, observably, every time

Created as an inactive draft from accepted Agent Ask plan-reliable-single-session-20261009; creation changed no pointer. Current activation is recorded in frontmatter.
