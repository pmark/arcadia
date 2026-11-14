---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-6-test-stability-plan-of-three-verified-fixes-with
project: arcadia
status: active
milestone: Draft an inactive batch 6 test-stability Plan of three verified fixes with corrected premises
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-14
actions:
  - id: stabilize-coordinator-relay-pid-record-snapshot
    title: Make the runner pid-record test sample after childPid lands so it stops racing the writer.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-stabilize-coordinator-relay-pid-record-snapshot-2026-11-13; no further action.
    expected_artifact: Evidence satisfying Agent Ask stabilize-coordinator-relay-pid-record-snapshot
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-6-fresh-20261113
    why: "The pid-record test can copy the state file before spawn writes childPid, which is a test ordering race, not a timer (Issue 2575)."
    acceptance_criteria:
      - "The first step confirms the cause in code before any edit, citing operatorExecution.ts lines 241, 252 and 253 and relay.ts line 476: the writer records status and pid first and childPid after spawn, and the test script copies the record first at tests/coordinator-relay.test.ts line 519. If the premise is false the Session stops and reports."
      - If a writer change turns out to be needed, the Session stops and files an Agent Ask because src/operatorActions/operatorExecution.ts is an operator-authority path; it is not changed in this Action.
      - A failing-first check delays the childPid rename by about 300 ms (for example with a node -r preload) and shows the old test fails; the fixed test waits, bounded, for childPid before copying the record and keeps the assertions seen.childPid equals child.pid and seen.pid differs from childPid.
      - pnpm vitest run tests/coordinator-relay.test.ts -t "records its child's pid" --testTimeout 120000 passes 20 times in a row, and the change touches only tests/coordinator-relay.test.ts and optionally a fixture under tests/fixtures/coordinator-relay/.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2575", "tests/coordinator-relay.test.ts", "src/operatorActions/operatorExecution.ts", "src/coordinator/relay.ts"]
  - id: dashboard-live-allocate-free-smoke-port
    title: Pick a verified-free smoke port in the dashboard-live test fixture instead of a random one.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-dashboard-live-allocate-free-smoke-port-2026-11-13; no further action.
    expected_artifact: Evidence satisfying Agent Ask dashboard-live-allocate-free-smoke-port
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-6-fresh-20261113
    why: "The fixture passes a random port to the smoke script, which collides with a busy port and fails the dashboard-live tests (Issue 2504)."
    acceptance_criteria:
      - "The first step confirms the cause in code: tests/dashboard-live.test.ts line 72 sets ARCADIA_DASHBOARD_SMOKE_PORT from a random number and scripts/dashboard-build.sh lines 18 and 136 to 145 curl that exact number, so port 0 cannot be used. If the premise is false the Session stops and reports."
      - A failing-first check stubs Math.random, holds that port, and shows the old fixture returns the held port; the new synchronous helper (for example spawnSync node -e) binds 127.0.0.1 port 0, reads the port, closes and returns it.
      - pnpm vitest run tests/dashboard-live.test.ts --testTimeout 120000 passes including the tests near lines 320 and 390, and only tests/dashboard-live.test.ts changes; cross-file port collisions are narrowed, not closed, and the Session says so.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2504", "tests/dashboard-live.test.ts", "scripts/dashboard-build.sh"]
  - id: harden-start-run-executor-calls-log-reader
    title: Make the start-run test's calls.log reader tolerate a partial last line.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make the start-run test's calls.log reader tolerate a partial last line.
    expected_artifact: Evidence satisfying Agent Ask harden-start-run-executor-calls-log-reader
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-6-fresh-20261113
    why: "The calls reader parses each line while the fake binary may be mid-append, so a TERM test can fail with an unterminated JSON string (Issue 2026); this is pulled ahead of its revival trigger because the mechanism is now found."
    acceptance_criteria:
      - "The first step confirms the cause in code and re-confirms against the current head, since the CI stack (run 41563300799, shard 5) came from an older head: calls() at tests/start-run-executor.test.ts line 408 runs JSON.parse per line, fake-arcadia.mjs line 10 uses appendFileSync, and the TERM test polls every 100 ms near line 1293. If the premise is false the Session stops and reports."
      - A failing-first unit test feeds a truncated final line; calls.log parsing moves into a pure helper that skips an incomplete or unparseable final line only, and a malformed earlier line still throws.
      - pnpm vitest run tests/start-run-executor.test.ts -t "forwards a TERM" --testTimeout 150000 and the helper test pass, and only tests/start-run-executor.test.ts changes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2026", "tests/start-run-executor.test.ts"]
questions: []
decisions: []
current_action: harden-start-run-executor-calls-log-reader
recommended_model: standard
recommended_reasoning_effort: medium
---

# Draft an inactive batch 6 test-stability Plan of three verified fixes with corrected premises

Created as an inactive draft from accepted Agent Ask ellis-batch-6-fresh-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
