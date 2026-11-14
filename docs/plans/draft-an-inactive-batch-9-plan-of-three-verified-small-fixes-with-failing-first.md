---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-9-plan-of-three-verified-small-fixes-with-failing-first
project: arcadia
status: active
milestone: Draft an inactive batch 9 Plan of three verified small fixes with failing-first tests (park Issue, replay startRun cards, START merge-freeze check)
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-14
actions:
  - id: file-github-issue-when-action-parked
    title: Record a GitHub Issue with a revival trigger when the tick parks an Action on an Action-local repair_budget_exhausted hold.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Record a GitHub Issue with a revival trigger when the tick parks an Action on an Action-local repair_budget_exhausted hold.
    expected_artifact: Evidence satisfying Agent Ask file-github-issue-when-action-parked
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-9-20261114
    why: "Authority path (src/production). Decision 0223 A says a park records an Issue and revival trigger, but the tick records only an escalation row, a log line and the remedy text (Issue 2629)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: src/production/tick.ts recordRepairBudgetExhaustedEscalation (about line 1796) writes only recordOperatorEscalation, the remedy text 'arcadia production reset-repair-budget <actionKey>' (line 1809) and one log line (line 1822), and is called from the receipt write near line 2289 and the pre-launch check near line 2928; src/production/terminalCandidates.ts actionLocalHold (line 96) only reads the row; no gh issue create is made on the repair-budget park path (the only gh issue create calls under src/production are the Operator QA plan waiver in src/production/independentReview.ts near lines 785 to 825 and the red-alert diagnosis in src/production/redAlertDiagnosis.ts near line 227, both unrelated to repair-budget parks and out of scope for this check)."
      - A failing-first test in a new file tests/park-records-issue.test.ts drives a repair_budget_exhausted park whose recorded cause is Action-local with an injected runCommand and shows the old code issues no `gh issue create`; after the change exactly one Issue is created per park episode, its title and body name the Action key, the failure and the revival trigger (the `arcadia production reset-repair-budget <actionKey>` remedy), and a second tick over the same episode creates none.
      - "The filing follows the existing precedent in src/production/independentReview.ts near lines 785 to 825: an injectable command runner, an idempotence marker verified from the body, a bounded attempt count, and a failure that logs and never changes the park outcome, the kept repair counters or the tick result. It runs outside any database transaction callback and does not file for a global-cause exhaustion, a non-held kind or an Action that is not parked."
      - pnpm vitest run tests/park-records-issue.test.ts tests/production-tick.test.ts --testTimeout 150000 passes, and only src/production/tick.ts, src/production/terminalCandidates.ts, at most one new small table or column with its migration if idempotence needs persistence, and tests/park-records-issue.test.ts change; any schema addition and every edit under src/production are recorded in the PR description as an authority-path edit. The proof test in held PR 2628 (tests/park-and-continue-proof.test.ts) is not changed.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2629", "src/production/tick.ts", "src/production/terminalCandidates.ts", "src/production/independentReview.ts"]
  - id: replay-card-reads-start-run-descriptor
    title: Make production-replay --card read the startRun block of a per-run START card descriptor instead of old-style script pins.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make production-replay --card read the startRun block of a per-run START card descriptor instead of old-style script pins.
    expected_artifact: Evidence satisfying Agent Ask replay-card-reads-start-run-descriptor
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-9-20261114
    why: "Authority path (scripts). Route A's replay step cannot run before a START press because --card fails on a per-run START card with 'does not pin PROJECT' (Issue 2626)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: scripts/production-replay.ts cardGrantReceipt (about line 440) requires descriptor.kind 'grant' (line 453), reads pins with cardScriptFields from <id>.sh (line 454) and throws 'does not pin PROJECT as a plain quoted value' at line 458, while a START card carries project, plan, actions, provider, transitions, concurrency, packetApprovalHours, intent, spendDecision and integrationDecision in a startRun block of <id>.json (StartRunPins, src/operatorActions/startRunPins.ts lines 15 to 52). Also confirm the descriptor's kind for a START card (the repository holds no committed START descriptor; build the fixture from validateStartRunPins' shape) and record it."
      - A failing-first test in tests/production-replay.test.ts builds a fixture descriptor with a startRun block and a three-line launcher script and shows cardGrantReceipt currently throws; after the change it returns a receipt with source 'card-descriptor' whose scope has the project, the plan, the ordered Actions, provider claude-code-cli, concurrency 1, the transitions and the intent, with expiry from packetApprovalHours. A descriptor with a malformed or missing startRun field, a non-START kind with no startRun, or an expired card still refuses with a named reason, and the existing old-style grant-card tests keep passing unchanged.
      - The fix adds a startRun branch only; it does not run the card, change the old-style pin parser, or touch scripts/start-run.sh or the card executor.
      - pnpm vitest run tests/production-replay.test.ts --testTimeout 150000 passes, and only scripts/production-replay.ts and tests/production-replay.test.ts change; the Session records the authority-path edit in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2626", "scripts/production-replay.ts", "tests/production-replay.test.ts", "src/operatorActions/startRunPins.ts"]
  - id: add-merge-check-for-waiting-start-card
    title: Add a deterministic arcadia work merge-check that refuses while an unheld START card is waiting on a pinned main revision.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Add a deterministic arcadia work merge-check that refuses while an unheld START card is waiting on a pinned main revision.
    expected_artifact: Evidence satisfying Agent Ask add-merge-check-for-waiting-start-card
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-9-20261114
    why: "Authority path (src/workMonitoring, apps/*-adjacent operator tooling). The run-window signal only prints advice, and a merge of 2616 staled a pinned card (Issue 2630); this slice adds the mechanical check agents and scripts can call, not a branch-protection rule."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: src/workMonitoring/runWindow.ts observeRunWindow (line 110) and formatRunWindowLines (line 224) only return and print the window; src/commands/workMonitor.ts runWorkMonitorCommand always returns success, and the `work monitor` registration in src/cli.ts near line 3828 sets no exit code; no merge path (scripts/merge-decision-card-batch.ts line 88, src/production/workerMerge.ts line 566) reads the run window; docs/agent-guidance/rehearsal-freeze-window.md lines 26 to 31 state the freeze by prose only."
      - A failing-first test in tests/work-monitor-run-window.test.ts shows a new pure helper (for example mergeFreezeRefusal(window)) returns null for a closed window, null for a window opened only by managed production Active (that stays advisory, Issue 2104), a named refusal that cites the card id, the pinned revision and expiry for a start_card_waiting reason, null for a card held by its governed hold marker, and a named refusal when the window state is unknown (fail closed); it fails before the helper exists.
      - A read-only command `arcadia work merge-check` (workspace option, --json) prints the refusal or 'No START card is waiting' and sets a non-zero exit code only when the helper refuses; it writes nothing and grants no authority. docs/agent-guidance/rehearsal-freeze-window.md names the command as the check to run immediately before any merge to main.
      - "The Issue's CI or ruleset half is not attempted: GitHub cannot see the local operator-script library, so it stays open in Issue 2630 for an operator path decision, and the Session states that and the tolerate-unrelated-advances alternative in the PR description."
      - pnpm vitest run tests/work-monitor-run-window.test.ts --testTimeout 120000 passes, and only src/workMonitoring/runWindow.ts, src/commands/workMonitor.ts, src/cli.ts, tests/work-monitor-run-window.test.ts and docs/agent-guidance/rehearsal-freeze-window.md change; the Session records any authority-path edit in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2630", "https://github.com/pmark/arcadia/issues/2104", "src/workMonitoring/runWindow.ts", "src/commands/workMonitor.ts", "docs/agent-guidance/rehearsal-freeze-window.md"]
questions: []
decisions: []
current_action: file-github-issue-when-action-parked
recommended_model: standard
recommended_reasoning_effort: medium
---

# Draft an inactive batch 9 Plan of three verified small fixes with failing-first tests (park Issue, replay startRun cards, START merge-freeze check)

Created as an inactive draft from accepted Agent Ask ellis-batch-9-20261114; creation changed no pointer. Current activation is recorded in frontmatter.
