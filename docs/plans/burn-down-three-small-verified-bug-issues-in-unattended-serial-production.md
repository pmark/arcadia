---
arcadia: v1
type: plan
slug: burn-down-three-small-verified-bug-issues-in-unattended-serial-production
project: arcadia
status: draft
milestone: Burn down three small verified bug Issues in unattended serial production.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-10
actions:
  - id: accept-canonical-roles-in-session-ledger
    title: "Make the Session ledger accept every role registered in config/defaults/agent-roles.json while keeping its legacy roles valid, fixing Issue #1366."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the Session ledger accept every role registered in config/defaults/agent-roles.json while keeping its legacy roles valid, fixing Issue #1366."
    expected_artifact: Evidence satisfying Agent Ask accept-canonical-roles-in-session-ledger
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bug-burn-plan-execution-build-20261106
    why: "validateSessionLedgerRow refuses implementer, code-reviewer, qa and the other registered roles, so honest canonical-role ledger rows cannot be recorded."
    acceptance_criteria:
      - validateSessionLedgerRow in src/reports/sessionLedger.ts accepts a row whose role is any role id listed in config/defaults/agent-roles.json.
      - A row with each legacy role lead, driver, reviewer, replayer and opus-planner still validates, and a row with the unknown role wizard still fails with a field role error.
      - A regression test in tests/session-ledger.test.ts reads the role ids from config/defaults/agent-roles.json and covers those three cases; it fails before the fix and passes after.
      - Every other test in tests/session-ledger.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/reports/sessionLedger.ts and tests/session-ledger.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1366"]
  - id: truncate-torn-journal-tail-by-byte-offset
    title: "Make the tidy journal's torn-tail repair truncate at the UTF-8 byte offset of the last newline, not the JavaScript string index, fixing Issue #749."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the tidy journal's torn-tail repair truncate at the UTF-8 byte offset of the last newline, not the JavaScript string index, fixing Issue #749."
    expected_artifact: Evidence satisfying Agent Ask truncate-torn-journal-tail-by-byte-offset
    clarification: clarified
    confidence: high
    source: Agent Ask amend-burn-down-worker-mergeable-src-fixes-20261110c
    why: "Touches operator_authority path src/git/quarantine.ts, so the worker cannot merge it; the first START scope excludes it. Ordered last, behind the worker-mergeable fixes."
    acceptance_criteria:
      - After repairTornTail in src/git/quarantine.ts runs on a journal with a torn tail, the file's byte length equals the UTF-8 byte length of its content through the last newline.
      - A regression test in tests/tidy-journal-recovery.test.ts writes a complete journal record containing a non-ASCII branch or worktree path followed by a torn trailing record, triggers the repair before an append, and asserts the earlier record still parses as JSON and the torn tail is gone; it fails before the fix and passes after.
      - Every other test in tests/tidy-journal-recovery.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/git/quarantine.ts and tests/tidy-journal-recovery.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: [read-zoneless-space-separated-time-as-utc, round-formatted-minutes-before-splitting-hours, label-exited-unreconciled-session-in-timeline]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/749"]
  - id: report-cut-work-monitor-attention-lines
    title: "Make the work monitor's attention lines say how many lines its limit cut and from which Projects, so no unsaved or local-only working copy disappears silently, fixing Issue #2011."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the work monitor's attention lines say how many lines its limit cut and from which Projects, so no unsaved or local-only working copy disappears silently, fixing Issue #2011."
    expected_artifact: Evidence satisfying Agent Ask report-cut-work-monitor-attention-lines
    clarification: clarified
    confidence: high
    source: Agent Ask amend-burn-down-worker-mergeable-src-fixes-20261110c
    why: "Touches operator_authority path src/workMonitoring/scanner.ts, so the worker cannot merge it; the first START scope excludes it. Ordered last, behind the worker-mergeable fixes."
    acceptance_criteria:
      - "When formatWorkingCopySafetyLines in src/workMonitoring/scanner.ts has more lines than its limit, it returns the first limit lines unchanged followed by exactly one extra line of the form \"3 more not shown: Alpha 1, Beta 2.\", where the number is the count of cut lines, each cut line (a repository error line or a working-copy line) counts under its Project name, and the Projects appear in Project-name order."
      - When no line is cut, the output is unchanged and has no extra line.
      - A regression test in tests/work-monitor.test.ts on a hand-built snapshot proves both cases; it fails before the fix and passes after.
      - The existing limit-2 expectation in tests/work-monitor.test.ts changes only by gaining the new final line, and every other test in tests/work-monitor.test.ts and tests/work-monitor-failures.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/workMonitoring/scanner.ts and tests/work-monitor.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: [read-zoneless-space-separated-time-as-utc, round-formatted-minutes-before-splitting-hours, label-exited-unreconciled-session-in-timeline]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2011"]
  - id: read-zoneless-space-separated-time-as-utc
    title: "Make parseTimeBound in src/timeline/time.ts read a space-separated time with no zone, such as 2026-10-06 03:30, as UTC like its T-separated form, fixing Issue #2471."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make parseTimeBound in src/timeline/time.ts read a space-separated time with no zone, such as 2026-10-06 03:30, as UTC like its T-separated form, fixing Issue #2471."
    expected_artifact: Evidence satisfying Agent Ask read-zoneless-space-separated-time-as-utc
    clarification: clarified
    confidence: high
    source: Agent Ask amend-burn-down-worker-mergeable-src-fixes-20261110c
    why: "parseTimeBound promises that a zoneless time is UTC, but the space-separated form falls through to host-local parsing, so a timeline window shifts by the host offset."
    acceptance_criteria:
      - "parseTimeBound in src/timeline/time.ts returns the UTC instants 2026-10-06T03:30:00.000Z, 2026-10-06T03:30:15.000Z and 2026-10-06T03:30:15.250Z for the inputs \"2026-10-06 03:30\", \"2026-10-06 03:30:15\" and \"2026-10-06 03:30:15.250\", whatever the host time zone."
      - "The inputs \"2026-10-06 03:30Z\", \"2026-10-06T03:30:00-07:00\", \"2026-10-06T03:30\", \"2026-10-06\" and the relative forms 30m and 6h return exactly what they return today."
      - A regression test in tests/timeline-model.test.ts sets process.env.TZ to America/Los_Angeles, restores it in a finally block, covers the three space-separated inputs, and fails before the fix and passes after.
      - Every other test in tests/timeline-model.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/timeline/time.ts and tests/timeline-model.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2471"]
  - id: round-formatted-minutes-before-splitting-hours
    title: "Make formatMinutes in src/orientation/effort.ts round to whole minutes before splitting hours, so 119.6 minutes reads 2h and never 1h60m, fixing Issue #2472."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make formatMinutes in src/orientation/effort.ts round to whole minutes before splitting hours, so 119.6 minutes reads 2h and never 1h60m, fixing Issue #2472."
    expected_artifact: Evidence satisfying Agent Ask round-formatted-minutes-before-splitting-hours
    clarification: clarified
    confidence: high
    source: Agent Ask amend-burn-down-worker-mergeable-src-fixes-20261110c
    why: "formatMinutes rounds the remainder after splitting, so fractional logged minutes print 1h60m or 60m in the activity report and fit-to-gap lines."
    acceptance_criteria:
      - formatMinutes in src/orientation/effort.ts returns "2h" for 119.6, "1h" for 59.6, "1h30m" for 89.5, "20m" for 20, "1h" for 60 and "0m" for 0.4.
      - No input makes formatMinutes return a string containing "60m".
      - A regression test in tests/orientation-fit.test.ts extends the formats windows for humans case with those six inputs; it fails before the fix and passes after.
      - Every other test in tests/orientation-fit.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/orientation/effort.ts and tests/orientation-fit.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2472"]
  - id: label-exited-unreconciled-session-in-timeline
    title: "Make the timeline Session collector say a Session that has ended_at and an exit status but is still prepared or running has exited and awaits reconciliation, instead of labelling it running, fixing item 3 of Issue #1144."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the timeline Session collector say a Session that has ended_at and an exit status but is still prepared or running has exited and awaits reconciliation, instead of labelling it running, fixing item 3 of Issue #1144."
    expected_artifact: Evidence satisfying Agent Ask label-exited-unreconciled-session-in-timeline
    clarification: clarified
    confidence: high
    source: Agent Ask amend-burn-down-worker-mergeable-src-fixes-20261110c
    why: "The timeline prints \"Session running on A (exit 1)\" for an exited Session the tick has not reconciled, which tells the operator the opposite of what happened."
    acceptance_criteria:
      - In src/timeline/collectors/sessions.ts, the session.ended event for an agent_sessions row whose status is prepared or running, with ended_at set and a non-null exit_status, has a summary of the form "Session exited on <action_id> (exit <n>), awaiting reconciliation", and the row is no longer described as running.
      - The summary for every other status, including completed, failed, needs_input and a row with a null exit_status, is unchanged.
      - A regression test in tests/timeline-collectors.test.ts adds one agent_sessions row with status running, an ended_at and exit_status 1 to the existing fixture and asserts the new summary; it fails before the fix and passes after.
      - Every other test in tests/timeline-collectors.test.ts and tests/timeline-model.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/timeline/collectors/sessions.ts and tests/timeline-collectors.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1144"]
questions: []
decisions: []
---

# Burn down three small verified bug Issues in unattended serial production.

Created as an inactive draft from accepted Agent Ask plan-bug-burn-serial-20261106b; creation changed no pointer. Current activation is recorded in frontmatter.
