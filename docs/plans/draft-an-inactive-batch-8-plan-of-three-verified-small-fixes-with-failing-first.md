---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-8-plan-of-three-verified-small-fixes-with-failing-first
project: arcadia
status: draft
milestone: Draft an inactive batch 8 Plan of three verified small fixes with failing-first tests (bot revision log, Discord status reply, Tidy PR proof)
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-14
actions:
  - id: log-checkout-revision-at-bot-startup
    title: Add the source checkout's git revision to the Discord bot's startup 'arcadia cli invocation chosen' log line.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Add the source checkout's git revision to the Discord bot's startup 'arcadia cli invocation chosen' log line.
    expected_artifact: Evidence satisfying Agent Ask log-checkout-revision-at-bot-startup
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-8-20261113
    why: "Authority path (apps/*). The startup log names the CLI but not which commit the bot is running; the installed bot lags HEAD silently. This is the revision slice of Issue 2574 only."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: apps/discord-bot/src/main.ts lines 27 to 34 log kind, command, sourceCli and reason from resolveCliChoice (apps/discord-bot/src/arcadia/cli.ts line 435) and no revision."
      - A failing-first unit test in tests/discord-bot-poll-timeouts.test.ts calls a new pure helper, for example readCheckoutRevision(dir, exec), and shows it returns the short HEAD sha from an injected exec, returns null and does not throw when git fails, and is never called with a shell; the test fails before the helper exists.
      - main.ts logs the revision of the checkout containing the chosen source CLI as a new field on the existing line, and logs revision null when unavailable; the build step, dist preference, ARCADIA_CLI_PATH policy and the restart script under ~/.claude/skills are not touched and stay open in Issue 2574 for an operator path decision.
      - pnpm vitest run tests/discord-bot-poll-timeouts.test.ts --testTimeout 120000 passes, and only apps/discord-bot/src/main.ts, apps/discord-bot/src/arcadia/cli.ts and tests/discord-bot-poll-timeouts.test.ts change; the Session records the authority-path edit in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2574", "apps/discord-bot/src/main.ts", "apps/discord-bot/src/arcadia/cli.ts", "tests/discord-bot-poll-timeouts.test.ts"]
  - id: show-status-in-discord-ask-reply
    title: Make the Discord reply to a status Ask include the compact status instead of only 'Status shown.'.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make the Discord reply to a status Ask include the compact status instead of only 'Status shown.'.
    expected_artifact: Evidence satisfying Agent Ask show-status-in-discord-ask-reply
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-8-20261113
    why: "Authority path (apps/*). A status Ask returns the status under data.status but the Discord reply prints only the summary 'Status shown.'. This is the Discord slice of Issue 2343; the Workspace surface stays open there."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: src/commands/ask.ts lines 762 and 790 return summary 'Status shown.' with the status in data.status, apps/discord-bot/src/formatters/requestFormatter.ts line 71 prints only data.result.summary, and AskData in apps/discord-bot/src/arcadia/types.ts (line 213) has no status field."
      - A failing-first test in a new file tests/discord-bot-status-reply.test.ts builds an AskData with result.summary 'Status shown.' and a status payload and shows the old formatRequest output contains no status counts; after the change it contains the formatStatus lines from apps/discord-bot/src/formatters/statusFormatter.ts.
      - A non-status Ask reply is byte-identical to before (existing tests/ask-correct.test.ts and tests/stewardship-quality.integration.test.ts still pass), and the change adds an optional status field to AskData and appends formatStatus output only when it is present; no freshness wording is invented beyond fields the payload carries.
      - pnpm vitest run tests/discord-bot-status-reply.test.ts tests/ask-correct.test.ts tests/stewardship-quality.integration.test.ts --testTimeout 120000 passes, and only apps/discord-bot/src/formatters/requestFormatter.ts, apps/discord-bot/src/arcadia/types.ts and the new test file change; the Session records the authority-path edit in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2343", "apps/discord-bot/src/formatters/requestFormatter.ts", "apps/discord-bot/src/formatters/statusFormatter.ts", "src/commands/ask.ts"]
  - id: tidy-keep-all-merged-prs-per-head-branch
    title: Make Tidy prove a branch merged when any merged PR for that head branch covers the current tip, regardless of result order.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make Tidy prove a branch merged when any merged PR for that head branch covers the current tip, regardless of result order.
    expected_artifact: Evidence satisfying Agent Ask tidy-keep-all-merged-prs-per-head-branch
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-8-20261113
    why: "Authority path (src/commands/*). prMergeCommits keeps one PR per head branch, so a branch with several merged PRs can read unmerged depending on ordering (Issue 1202)."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: src/commands/tidy.ts line 255 builds `new Map` keyed by entry.headBranch so a later PR overwrites an earlier one, and evaluateMerge reads a single record at line 700 via prMergeCommits.get(branch) then checks isAncestor(revision, pr.headRefOid)."
      - "A failing-first test in tests/tidy-command.test.ts gives one branch two merged PR records, where only one headRefOid covers the local tip, and shows the old build returns merged:false in one input order; the fixed version returns merged:true with proof 'pull-request' in both orders and still returns false when no record covers a tip newer than every merged head."
      - The fix keeps every record per branch (for example an index helper plus a lookup that tries each) while existing tests that pass a Map of single records keep compiling or are minimally updated; the post-merge-commit safety check, quarantine and archive behaviour are unchanged.
      - pnpm vitest run tests/tidy-command.test.ts --testTimeout 150000 passes, and only src/commands/tidy.ts and tests/tidy-command.test.ts change; the Session records the authority-path edit in the PR description.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1202", "src/commands/tidy.ts", "tests/tidy-command.test.ts"]
questions: []
decisions: []
---

# Draft an inactive batch 8 Plan of three verified small fixes with failing-first tests (bot revision log, Discord status reply, Tidy PR proof)

Created as an inactive draft from accepted Agent Ask ellis-batch-8-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
