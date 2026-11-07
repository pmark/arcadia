---
arcadia: v1
type: plan
slug: burn-down-three-small-verified-bug-issues-in-unattended-serial-production
project: arcadia
status: draft
milestone: Burn down three small verified bug Issues in unattended serial production.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-07
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
    source: Agent Ask amend-bug-burn-plan-execution-build-20261106
    why: "A complete journal record with a non-ASCII branch or worktree path shifts the string index off the byte offset, so the repair cuts into a valid record and every later tidy throws."
    acceptance_criteria:
      - After repairTornTail in src/git/quarantine.ts runs on a journal with a torn tail, the file's byte length equals the UTF-8 byte length of its content through the last newline.
      - A regression test in tests/tidy-journal-recovery.test.ts writes a complete journal record containing a non-ASCII branch or worktree path followed by a torn trailing record, triggers the repair before an append, and asserts the earlier record still parses as JSON and the torn tail is gone; it fails before the fix and passes after.
      - Every other test in tests/tidy-journal-recovery.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/git/quarantine.ts and tests/tidy-journal-recovery.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
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
    source: Agent Ask amend-bug-burn-plan-execution-build-20261106
    why: "formatWorkingCopySafetyLines ends with a bare slice, so a Project outside the first six lines looks clean to the operator and to orientation."
    acceptance_criteria:
      - "When formatWorkingCopySafetyLines in src/workMonitoring/scanner.ts has more lines than its limit, it returns the first limit lines unchanged followed by exactly one extra line of the form \"3 more not shown: Alpha 1, Beta 2.\", where the number is the count of cut lines and each Project's cut count appears in Project-name order."
      - When no line is cut, the output is unchanged and has no extra line.
      - A regression test in tests/work-monitor.test.ts on a hand-built snapshot proves both cases; it fails before the fix and passes after.
      - The existing limit-2 expectation in tests/work-monitor.test.ts changes only by gaining the new final line, and every other test in tests/work-monitor.test.ts and tests/work-monitor-failures.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/workMonitoring/scanner.ts and tests/work-monitor.test.ts. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2011"]
questions: []
decisions: []
---

# Burn down three small verified bug Issues in unattended serial production.

Created as an inactive draft from accepted Agent Ask plan-bug-burn-serial-20261106b; creation changed no pointer. Current activation is recorded in frontmatter.
