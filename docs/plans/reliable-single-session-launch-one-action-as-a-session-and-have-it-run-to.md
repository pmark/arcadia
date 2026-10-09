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
    next_action: Let an operator-launched session for one Action finish with its work preserved, pushed and opened as a draft PR, without production being Active.
    expected_artifact: Evidence satisfying Agent Ask operator-launch-runs-to-completion
    clarification: clarified
    confidence: high
    source: Agent Ask amend-reliable-single-session-gate-0098-20261009-r2
    acceptance_criteria:
      - "Decision 0096 is answered (2026-10-09). An operator's confirmed Launch of one Action records a one-shot authorization bound to that Action and Session. The authorization expires after 24 hours or at first use. Only a confirmed Launch carries it: the dashboard Launch confirmation (minted on the dashboard side, because the route spawns the CLI without a TTY) or arcadia session launch --operator-launch confirmed at an interactive TTY. A launch without that confirmation, from inside an Arcadia Session, or from a non-interactive shell carries none, and each mint writes an auditable receipt. When that Session exits, Arcadia runs host-side validation, preserves (commits) the candidate, pushes its branch, reconciles the exit and, only on accepted_completion, opens or updates a draft PR. It does this through the same preserveSessionCandidate path the production tick uses, without production Active. Review, repair and merge are the next Action's (launched-pr-review-repair-merge)."
      - The existing tick reconcile, which already runs while production is Inactive, is reused, not duplicated. When a Session has exited but has not been reconciled within a bound, the dashboard shows it with arcadia session reconcile <id> as the manual fallback.
      - Tests cover accepted completion to a draft PR, incomplete-resumable with the work preserved, a refused authorization (wrong Action, expired, already used, unconfirmed or non-interactive launch), a confirmed dashboard Launch that does mint, and the unreconciled-exit display. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
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
    source: Agent Ask amend-reliable-single-session-per-0096-0097-20261009
    acceptance_criteria:
      - A fast-rehearsal scenario (tests/fast-rehearsal) runs one Action from a dashboard-equivalent confirmed launch request through the session-launch route's confirmed-mint path, using the same production code and never a separate imitation. The path covers fixture-cli in a real tmux session, headless logging, exit capture, the bounded-lifetime guard, preservation, reconcile, a PR against the fake GitHub, the adversarial review posted as PR comments, one repair round and the merge on green. It asserts each receipt and runs in CI in under 5 minutes.
      - Failure injection covers a crash, a stall killed by the limit, a preflight refusal, a refused authorization, a failing required check that is repaired, a merge conflict that is repaired, and an operator-approval gate that stops before merging. Each ends in its recorded outcome with no lease held. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [bounded-session-lifetime, operator-launch-runs-to-completion, launched-pr-review-repair-merge]
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
    next_action: Prove one real Action launched from the page runs to merged on green with no human intervention, three times in a row.
    expected_artifact: Evidence satisfying Agent Ask prove-single-session-live
    clarification: clarified
    confidence: high
    source: Agent Ask amend-reliable-single-session-gate-0098-20261009-r2
    acceptance_criteria:
      - Three consecutive live runs each launch one small, real, already-clarified Action from the session board with a real provider. Each ends merged to main, with no operator or agent intervention between Launch and merge beyond the sessions the loop itself launches. A run stopped by a correctly fired operator-approval gate neither counts nor resets the count; a wrongly fired gate is a failed run. Along the way, the session exits on its own, its log and exit code are recorded, its candidate is preserved, a draft PR is opened, adversarial review is posted as PR comments, and conflicts and CI failures are repaired. A failed run resets the count, and its defect is fixed offline first in the fast-rehearsal scenario. The runs may span more than one session; each live session records the runs so far.
      - The evidence names, for each run, the session id, the Action, the exit code, the reconcile outcome, the PR, the review rounds, the merge commit or gate, and the elapsed time. The Actions are genuine queued work chosen by the operator or the queue, never fixtures.
    depends_on: [prove-single-session-offline, session-board-page, launched-pr-review-repair-merge]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
  - id: launched-pr-review-repair-merge
    title: Carry a PR from a confirmed Launch through adversarial review, repair and merge on green, stopping only when an automated gate calls for operator approval.
    status: open
    responsibility: agent
    effort: session
    next_action: Carry a PR from a confirmed Launch through adversarial review, repair and merge on green, stopping only when an automated gate calls for operator approval.
    expected_artifact: Evidence satisfying Agent Ask launched-pr-review-repair-merge
    clarification: clarified
    confidence: high
    source: Agent Ask amend-reliable-single-session-gate-0098-20261009-r2
    acceptance_criteria:
      - "Decision 0098 must be approved before this Action starts, and this Plan must not be activated while 0098 is open, because dispatch cannot yet gate an Action on a Decision (#1126). Per Decision 0098, for a draft PR opened from a confirmed Launch, Arcadia runs an independent, read-only adversarial review of the exact head and posts its verdict and findings as a PR comment. It then launches repair sessions for valid blocking findings, conflicts with the base branch and failing required checks, within at most three review rounds; each push resets the proof. Each review or repair session mints its own receipted one-shot authorization, bound to the PR and the originating Launch receipt. Only once the Decision 0060/0080 conditions hold on the exact head (no unresolved blocking finding, all required checks green, clean merge state) does it mark the PR ready for review and merge it. Gate and outcome pings use the standing PR-lifecycle Discord notification in docs/agent-guidance/pull-requests.md. The work may span more than one session and more than one PR."
      - Automated gates stop before merging and raise one operator item in arcadia todo and Discord, naming the PR and the reason. Gates are evaluated deterministically on the exact head's diff against its base after every push. They fire when the PR opens, answers or changes any Decision (docs/decisions/**); changes CONSTITUTION.md, AGENTS.md, CLAUDE.md, docs/agents-context.md, docs/agent-guidance/**, .arcadia/** or .claude/** policy, or code implementing launch authorization, this loop or its gate list; touches credentials, secrets, .env files, .github/workflows, required-check or branch-protection configuration, or deployment or production configuration; adds or upgrades a dependency; or deletes or skips tests or lowers a threshold. They also fire when the review marks a finding authority-sensitive, when three rounds are exhausted, or when a check stays red after repair. The gate list is checked-in configuration that is itself gated; review judgment can add a gate, never clear one. A PR the loop cannot classify is not merged. The loop never weakens tests, gates or branch protection, and never force-pushes over another author's commits. The PRs that implement this Plan's authority Actions (headless-observable-session-launch, which sets the Claude allow list; operator-launch-runs-to-completion; launched-pr-review-repair-merge; chain-as-loop-of-single-runs) are themselves operator-merged.
      - Tests against a fake GitHub cover posting the review comment, a repair round for a blocking finding, a conflict repair, a CI-failure repair, merge on green, each gate stopping with its operator item, and the three-round limit. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [operator-launch-runs-to-completion]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
  - id: chain-as-loop-of-single-runs
    title: "Run an Action chain as a loop of single runs: when one launched Action merges, the next ready Action launches from the new main."
    status: open
    responsibility: agent
    effort: session
    next_action: "Run an Action chain as a loop of single runs: when one launched Action merges, the next ready Action launches from the new main."
    expected_artifact: Evidence satisfying Agent Ask chain-as-loop-of-single-runs
    clarification: clarified
    confidence: high
    source: Agent Ask amend-reliable-single-session-gate-0098-20261009-r2
    acceptance_criteria:
      - "Decision 0098 must be approved before this Action starts, and this Plan must not be activated while 0098 is open, because dispatch cannot yet gate an Action on a Decision (#1126). Per Decisions 0097 and 0098, a confirmed Launch of a chain names its Plan and a maximum number of Actions, capped by checked-in policy (default 3). The chain receipt expires after 24 hours. When an Action launched under it merges to main through launched-pr-review-repair-merge, Arcadia launches the next ready Action of that Plan from the new main; that launch mints its own one-shot authorization, bound to the chain receipt and receipted. The chain stops, with a receipt and one operator item, at the maximum count, at an operator-approval gate, on a failed run, when no ready Action remains, before an Action that lists an unapproved Decision, or when the Plan's Actions or pointer changed since the chain Launch. Because Decision gates in this Plan live in criterion text until #1126 lands, the Plan-activation guard is the effective protection meanwhile; #1126 is the trigger to revisit. No Action ever builds on an unmerged predecessor."
      - Two consecutive live chains of two real, already-clarified Actions each run from one confirmed chain Launch to both Actions merged. There is no intervention between Launch and the final merge beyond the sessions the loop itself launches. This is the two-Action rehearsal, now on merge-then-next. The evidence names each session, PR, merge commit and the elapsed time. The fast-rehearsal harness first proves the same two-Action chain offline. The work may span more than one session. Type, lint and build pass. A pushed PR with exact-head independent review and all required checks is the delivered Artifact.
    depends_on: [launched-pr-review-repair-merge, prove-single-session-live]
    decisions: []
    references: ["CONSTITUTION.md", "src/sessions/index.ts", "src/sessions/launch.ts", "src/sessions/reconciliation.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/production/stallDetection.ts", "src/production/sessionSignals.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/fast-rehearsal/README.md", "docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1126"]
questions: []
decisions: []
---

# Reliable single session: launch one Action as a session and have it run to completion, observably, every time

Created as an inactive draft from accepted Agent Ask plan-reliable-single-session-20261009-r3; creation changed no pointer. Current activation is recorded in frontmatter.
