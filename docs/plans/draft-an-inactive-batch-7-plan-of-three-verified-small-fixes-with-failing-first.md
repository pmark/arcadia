---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-7-plan-of-three-verified-small-fixes-with-failing-first
project: arcadia
status: draft
milestone: Draft an inactive batch 7 Plan of three verified small fixes with failing-first tests (ping guard, work-scan label, gitignore)
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-14
actions:
  - id: refuse-ping-read-verbs-with-arguments
    title: Make `arcadia ping <read verb> <args>` refuse with a usage hint instead of queueing a real operator ping.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make `arcadia ping <read verb> <args>` refuse with a usage hint instead of queueing a real operator ping.
    expected_artifact: Evidence satisfying Agent Ask refuse-ping-read-verbs-with-arguments
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-7-20261113
    why: "Authority path (src/cli.ts). The #2570 guard refuses only a lone list/ls/status/show; `ping show <id>` queued a real Discord ping on 2026-11-13 (Issue 2592)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: src/cli.ts line 5997 returns early when message.length !== 1, and the list at line 5996 is only list, ls, status, show, so `show <id>` and `list foo` reach runPingSendCommand at line 1358 and queue."
      - A failing-first test in tests/ping-subcommand-dispatch.test.ts, one case per verb (show, get, list, ls, status, cat, view, read) with a trailing argument and case-insensitive, asserts exit code 2, queuedMessages empty and a usage hint naming send, pending and sent; it fails on the current head before the change.
      - The guard refuses a read verb as the first word with or without arguments unless `send` or `--` is on the command line; `ping send show the status`, `ping send -- show me` and `ping -- show me` still queue (the Session verifies how commander passes `--` in command.parent.args and adjusts the guard to it), and the existing multi-word implicit message test still passes.
      - pnpm vitest run tests/ping-subcommand-dispatch.test.ts --testTimeout 120000 passes, and only src/cli.ts and tests/ping-subcommand-dispatch.test.ts change; the Session records the authority-path edit in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2592", "https://github.com/pmark/arcadia/issues/2570", "src/cli.ts", "tests/ping-subcommand-dispatch.test.ts"]
  - id: label-pr-not-checked-when-lookup-disabled
    title: Show a neutral 'PR not checked' label and action instead of 'PUSHED, PR UNKNOWN / check whether it has a PR' when the work scan skips PR lookup.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Show a neutral 'PR not checked' label and action instead of 'PUSHED, PR UNKNOWN / check whether it has a PR' when the work scan skips PR lookup.
    expected_artifact: Evidence satisfying Agent Ask label-pr-not-checked-when-lookup-disabled
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-7-20261113
    why: "Orientation packets scan with includePullRequests:false, so every pushed branch reads PR UNKNOWN and 'check whether it has a PR', false noise inside a 6-line limit (Issue 2583)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: src/workMonitoring/scanner.ts line 117 labels any pushed copy whose pullRequestLookup is not 'queried' as 'PUSHED, PR UNKNOWN', line 488 recommends 'Check whether ... has a PR' for the same case, and src/commands/orientation.ts line 305 passes includePullRequests:false."
      - A failing-first test in tests/work-monitor.test.ts builds a pushed copy with pullRequestLookup 'disabled' and shows the old formatWorkingCopySafetyLines output contains 'PR UNKNOWN'; after the change the label says the PR was not checked and the recommended action no longer tells the reader to look for a missing PR.
      - A 'queried' pushed copy with no PR still says it has no open PR and recommends a draft PR, and an 'unavailable' lookup keeps 'PR UNKNOWN'; risk ordering and the 6-line limit are unchanged.
      - pnpm vitest run tests/work-monitor.test.ts tests/work-monitor-failures.test.ts --testTimeout 120000 passes, and only src/workMonitoring/scanner.ts and tests/work-monitor.test.ts change; this Action does not touch the digest scheduler backoff or the compose/mark-sent backoff key from Issue 2583, which stay open there.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2583", "src/workMonitoring/scanner.ts", "tests/work-monitor.test.ts"]
  - id: ignore-worker-claude-usage-request-in-gitignore
    title: Ignore the worker Claude usage request and its completed sidecars in the tracked .gitignore so a fresh checkout stays clean and START sign-in does not refuse.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Ignore the worker Claude usage request and its completed sidecars in the tracked .gitignore so a fresh checkout stays clean and START sign-in does not refuse.
    expected_artifact: Evidence satisfying Agent Ask ignore-worker-claude-usage-request-in-gitignore
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-7-20261113
    why: "Only a local .git/info/exclude hides .arcadia/worker-claude-usage.request today; the tracked .gitignore lacks it, so a diagnostic dirties settlement's clean check and sign-in refuses REQUEST_NOT_IGNORED (Issue 1763)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: .gitignore on origin/main has no .arcadia entry, src/production/startRunSignIn.ts line 339 requires `git check-ignore -q .arcadia/worker-claude-usage.request` or refuses REQUEST_NOT_IGNORED at line 340, and the shared checkout passes only through .git/info/exclude."
      - A failing-first test (new file tests/worker-claude-usage-request-ignore.test.ts) copies the repository's .gitignore into a fresh temporary git repo with no info/exclude and shows `git check-ignore -q` fails for .arcadia/worker-claude-usage.request and a .arcadia/worker-claude-usage.request.completed-<nonce> sidecar on the current head.
      - After adding exact ignore lines for that request path and its .completed-* sidecars, the test passes, and the same test shows .arcadia/asks/x.yaml, .arcadia/AGENT_CONTEXT_POLICY.md and .arcadia/context-policy.json are NOT ignored; no consumed request or attempt is deleted or reset.
      - pnpm vitest run tests/worker-claude-usage-request-ignore.test.ts tests/start-run-sign-in.test.ts --testTimeout 120000 passes, and only .gitignore and the new test file change.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1763", ".gitignore", "src/production/startRunSignIn.ts", "src/production/workerClaudeUsageDiagnostic.ts"]
questions: []
decisions: []
---

# Draft an inactive batch 7 Plan of three verified small fixes with failing-first tests (ping guard, work-scan label, gitignore)

Created as an inactive draft from accepted Agent Ask ellis-batch-7-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
