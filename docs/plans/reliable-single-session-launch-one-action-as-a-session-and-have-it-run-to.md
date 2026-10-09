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
    source: Agent Ask plan-reliable-single-session-20261009-r3
    acceptance_criteria:
      - By default, Claude and Codex sessions launched by fingerprint (dashboard session-launch, arcadia session launch, arcadia go --launch) run headless instead of in the interactive TUI. They reuse the same unattended command builder that standing-policy launches use in src/sessions/index.ts, not a duplicate. opencode already runs headless. Claude's headless argv includes --verbose whenever --output-format stream-json is used. arcadia go --launch keeps an explicit --interactive opt-in that preserves today's TUI and reattach workflow.
      - The launch fixes the headless permission posture in checked-in, Arcadia-owned configuration passed per session and never taken from the operator's personal settings. For Claude it is an allow list that lets the agent run the Action's validation commands and arcadia agent-ask draft, and nothing broader. For Codex it is the existing workspace-write sandbox, which is documented as Codex's posture because Codex has no per-command allow list. A preflight refuses to launch, with a named reason, when the provider binary, its auth (Claude Code token or Codex login) or that posture is missing.
      - Each session's combined output is appended to a per-session log file under the workspace (not the repository), named by session id. The provider process's exit code is written to agent_sessions.exit_status for every provider, not only fixture-cli. A crash is therefore distinguishable from a clean exit, and the log survives the tmux session.
      - "Tests drive fixture-cli through the real tmux launch path for: a clean exit (exit_status 0, log present), a non-zero exit (exit_status recorded), and a crash mid-output (log kept). Further tests cover each preflight refusal with stubbed binaries and the --interactive opt-in. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact."
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
  - id: bounded-session-lifetime
    title: Stop a stuck session automatically so it can never hold the repository lease indefinitely.
    status: open
    responsibility: agent
    effort: session
    next_action: Stop a stuck session automatically so it can never hold the repository lease indefinitely.
    expected_artifact: Evidence satisfying Agent Ask bounded-session-lifetime
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009-r3
    acceptance_criteria:
      - Each session has a wall-clock limit taken from policy, with a default that applies when no readable policy exists, and a per-launch override. When the limit passes, or when the existing pane classifier (src/production/sessionSignals.ts) reports a blocking condition (permission prompt, auth failure, provider limit) that persists past the stall deadline, Arcadia ends the tmux session, writes a session exit receipt with the reason, and releases the lease. This supersedes the stallDetection.ts rule that a stalled session's lease survives pending operator judgment. The operator judgment now happens on the exit receipt. It never kills a session that is still making progress within its limit.
      - The stop path does no more than ending the tmux session. It never deletes the session's worktree or branch, so work done so far remains in the worktree. It is committed and pushed only through the preservation path, which for operator launches arrives with operator-launch-runs-to-completion. The existing reconcile path then runs exactly as for any other exit.
      - Tests cover the time limit, each blocking classifier hit, a progressing session that must not be killed, and lease release. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [headless-observable-session-launch]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
  - id: operator-launch-runs-to-completion
    title: Let an operator-launched session for one Action finish with its work preserved and its outcome recorded, without production being Active.
    status: open
    responsibility: agent
    effort: session
    next_action: Let an operator-launched session for one Action finish with its work preserved and its outcome recorded, without production being Active.
    expected_artifact: Evidence satisfying Agent Ask operator-launch-runs-to-completion
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009-r3
    acceptance_criteria:
      - "Decision 0096 must be approved before this Action starts, and this Plan must not be activated while 0096 is open, because dispatch cannot yet gate an Action on a Decision (#1126). If it approves the push-and-draft-PR option, an operator Launch of one Action records a one-shot authorization bound to that Action and Session. The authorization expires after 24 hours or at first use. Only a confirmed Launch carries it: the dashboard Launch confirmation, or arcadia session launch --operator-launch confirmed at an interactive TTY. A launch without that confirmation, from inside an Arcadia Session, or from a non-interactive shell carries none, and each mint writes an auditable receipt. When that Session exits, Arcadia runs host-side validation, preserves (commits) the candidate, pushes its branch, reconciles the exit and, only on accepted_completion, opens or updates a draft PR. It does this through the same preserveSessionCandidate path the production tick uses, without production Active and with no integration or merge. If the Decision approves the local-only option, the same applies but nothing is pushed and no PR is opened. If it is rejected or answered Not now, this Action stays blocked and is not implemented."
      - The existing tick reconcile, which already runs while production is Inactive, is reused, not duplicated. When a Session has exited but has not been reconciled within a bound, the dashboard shows it with arcadia session reconcile <id> as the manual fallback.
      - Tests cover accepted completion to a draft PR, incomplete-resumable with the work preserved, a refused authorization (wrong Action, expired, already used, unconfirmed or non-interactive launch), and the unreconciled-exit display. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [headless-observable-session-launch]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
  - id: prove-single-session-offline
    title: Prove the whole single-session path end to end offline, in minutes, on every change.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove the whole single-session path end to end offline, in minutes, on every change.
    expected_artifact: Evidence satisfying Agent Ask prove-single-session-offline
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009-r3
    acceptance_criteria:
      - A fast-rehearsal scenario (tests/fast-rehearsal) runs one Action from a dashboard-equivalent launch request, using the same production code and never a separate imitation. The path covers fixture-cli in a real tmux session, headless logging, exit capture, the bounded-lifetime guard, preservation, reconcile and a draft PR against the fake GitHub. It asserts each receipt and runs in CI in under 5 minutes.
      - Failure injection covers a crash, a stall killed by the limit, a preflight refusal and a refused authorization. Each ends in its recorded outcome with no lease held. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [bounded-session-lifetime, operator-launch-runs-to-completion]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
  - id: session-board-page
    title: Give the operator one dashboard page that shows everything to do, launches one Action as a session and streams that session's activity live.
    status: open
    responsibility: agent
    effort: session
    next_action: Give the operator one dashboard page that shows everything to do, launches one Action as a session and streams that session's activity live.
    expected_artifact: Evidence satisfying Agent Ask session-board-page
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009-r3
    acceptance_criteria:
      - A dashboard page lists, in one view, every item arcadia todo returns for the operator together with every ready Action from the work queue, each with its Project and Plan. Each ready Action has a Launch control. The control runs the existing preview-then-launch fingerprint flow (making the Action next first if needed), shows the preview's consequence before confirming, and never launches without that confirmation.
      - A session view shows status, elapsed time, the live tail of the session's log updated at least every 4 seconds while it runs, the exit code, the reconcile outcome, and the PR link when one exists. It reads only the files and CLI output Arcadia already records. It renders without horizontal scroll at 375px wide and is served on the existing tailnet dashboard origin.
      - Tests cover the merged list, the launch confirmation flow against a stubbed CLI, and the log tail. The operator guide in START_HERE.md describes the page. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [headless-observable-session-launch]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
  - id: prove-single-session-live
    title: Prove one real Action launched from the page runs to a draft PR with no human intervention, three times in a row.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove one real Action launched from the page runs to a draft PR with no human intervention, three times in a row.
    expected_artifact: Evidence satisfying Agent Ask prove-single-session-live
    clarification: clarified
    confidence: high
    source: Agent Ask plan-reliable-single-session-20261009-r3
    acceptance_criteria:
      - Three consecutive live runs each launch one small, real, already-clarified Action from the session board with a real provider. Each run ends with the session exiting on its own, its log and exit code recorded, its candidate preserved and a draft PR opened (or, if Decision 0096 approved local-only preservation, a preserved local candidate), with no operator or agent intervention between Launch and draft PR. A failed run resets the count, and its defect is fixed offline first in the fast-rehearsal scenario. The runs may span more than one session; each live session records the runs so far.
      - The evidence names, for each run, the session id, the Action, the exit code, the reconcile outcome, the PR and the elapsed time. The Actions are genuine queued work chosen by the operator or the queue, never fixtures. Their draft PRs then follow the normal review and merge gate like any other work.
    depends_on: [prove-single-session-offline, session-board-page]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
questions: []
decisions: []
---

# Reliable single session: launch one Action as a session and have it run to completion, observably, every time

Created as an inactive draft from accepted Agent Ask plan-reliable-single-session-20261009-r3; creation changed no pointer. Current activation is recorded in frontmatter.
