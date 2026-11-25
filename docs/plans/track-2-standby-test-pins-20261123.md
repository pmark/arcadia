---
arcadia: v1
type: plan
slug: track-2-standby-test-pins-20261123
project: arcadia
status: active
milestone: Track 2 standby test pins 20261123
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-25
actions:
  - id: pin-successor-press-render-lines
    title: Pin the one line the successor press prints for a pressed, refused or skipped outcome, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-successor-press-render-lines-54145a7d7f48; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-successor-press-render-lines
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "renderSuccessorLines (src/commands/productionSuccessor.ts:185-191) is the timer's only printed record of each successor press, and no test file names it, so its wording and skip silence are unpinned."
    acceptance_criteria:
      - "tests/pin-successor-press-render-lines.test.ts is a new test file that imports renderSuccessorLines from ../src/commands/productionSuccessor.js (lines 185-191) and, with the stamp T, asserts a pressed outcome of card c1, run r1 and one Action gives [`${T} successor press: pressed c1 (1 Action) as run r1`], and with two Actions and offIssued true gives [`${T} successor press: pressed c1 (2 Actions) as run r1; issued the scope-complete Off first`]."
      - "The same test file asserts a refused outcome with code X and message m gives [`${T} successor press: refused (X): m`], adding `; queued ping p1` only when pingId is p1, and that a skipped outcome gives [] when offIssued is false and one line ending `issued the scope-complete Off; skipped the press (<reason>)` when it is true."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-successor-press-render-lines.test.ts, a new test file of at most 50 lines that imports only vitest and src/commands/productionSuccessor.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-failed-batch-clearance-parse
    title: Pin which failed-batch clearance records the START card derivation accepts, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-failed-batch-clearance-parse-10ec23371cd6; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-failed-batch-clearance-parse
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "parseFailedBatchClearance (src/operatorActions/startRunDerive.ts:64-72) decides whether a recorded fix clears a failed batch for the next derived card, and no test file names it, so its fail-closed parsing is unpinned."
    acceptance_criteria:
      - tests/pin-failed-batch-clearance-parse.test.ts is a new test file that imports parseFailedBatchClearance from ../src/operatorActions/startRunDerive.js (lines 64-72) and asserts a well-formed JSON record with extra keys returns exactly its cause, premortem and fix { pullRequest, commit, reproduction } fields.
      - The same test file asserts it returns null for null, for unparseable JSON, for a blank premortem, for a non-string cause, for a missing fix, and when any one of fix.pullRequest, fix.commit or fix.reproduction is missing.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-failed-batch-clearance-parse.test.ts, a new test file of at most 50 lines that imports only vitest and src/operatorActions/startRunDerive.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-failed-batch-window-boundary
    title: Pin which failed batches count against a grant window by their end time, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-failed-batch-window-boundary-decafcd0a0ee; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-failed-batch-window-boundary
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "failedBatchesInWindow (src/operatorActions/startRunDayGrant.ts:184-193) decides whether a failed batch stops the next press, and no test file names it, so the exact window boundary is pinned only indirectly."
    acceptance_criteria:
      - tests/pin-failed-batch-window-boundary.test.ts is a new test file that imports failedBatchesInWindow from ../src/operatorActions/startRunDayGrant.js (lines 184-193) and asserts that failed batches (admitted 1, scopeComplete null) that ended exactly at the window's opening, after it, or not at all (endedAt null) are all returned, in order.
      - "The same test file asserts a failed batch that ended one millisecond before the opening is left out, and that a clean batch (scopeComplete { merged: 2, escalated: 0 }) and an activation that admitted no Session are left out."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-failed-batch-window-boundary.test.ts, a new test file of at most 50 lines that imports only vitest and src/operatorActions/startRunDayGrant.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-derive-operator-reasons
    title: Pin that a derived card stops only for unanswered cited Decisions, never for referenced paths, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-derive-operator-reasons-82cc135b96a2; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-derive-operator-reasons
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "operatorReasons (src/operatorActions/startRunDerive.ts:115-120) decides which Action a derived START card stops before, and no test file names it; only a single-Decision case is covered, through deriveActionsAndOperatorItem."
    acceptance_criteria:
      - tests/pin-derive-operator-reasons.test.ts is a new test file that imports operatorReasons from ../src/operatorActions/startRunDerive.js (lines 115-120) and asserts an Action citing Decisions 0300, 0100 and 0200 with only 0100 answered returns ["cites unanswered Decision 0300", "cites unanswered Decision 0200"], in citation order.
      - The same test file asserts it returns [] when every cited Decision is answered, when decisions is empty or absent, and when the Action's references name .github/workflows/ci.yml and CONSTITUTION.md but it cites no Decision.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-derive-operator-reasons.test.ts, a new test file of at most 50 lines that imports only vitest and src/operatorActions/startRunDerive.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-worker-operator-merge-command
    title: Pin the exact operator merge command a refused worker merge reports, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-worker-operator-merge-command-9c70b76c9f02; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-worker-operator-merge-command
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "workerOperatorMergeCommand (src/production/workerMerge.ts:564-567) is the command handed to the operator when a worker merge is refused, and no test file names it, so its head pin and null case are unpinned."
    acceptance_criteria:
      - "tests/pin-worker-operator-merge-command.test.ts is a new test file that imports workerOperatorMergeCommand from ../src/production/workerMerge.js (lines 564-567) and asserts that for https://github.com/o/r/pull/7 and a 40-character head H it returns `gh pr merge https://github.com/o/r/pull/7 --merge --match-head-commit H`."
      - The same test file asserts it returns null for a null URL and for an empty URL.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-worker-operator-merge-command.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/workerMerge.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-repeated-park-cause-rules
    title: Pin when two parks share a cause that stops production, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-repeated-park-cause-rules-6cdddfad858a; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-repeated-park-cause-rules
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "findRepeatedCause (src/production/parkAndContinue.ts:201-211) turns a second same-cause park into a production stop, and no test file names it; only the basic two-Action case is covered, through the night breaker."
    acceptance_criteria:
      - tests/pin-repeated-park-cause-rules.test.ts is a new test file that imports findRepeatedCause, BREAKER_WINDOW_MS and the ParkReceipt type from ../src/production/parkAndContinue.js (lines 14 and 201-211) and asserts two condition-failed parks of different Actions with cause "same" inside the window return "same", while the same Action parking twice on that cause returns null.
      - The same test file asserts an operator-cancel park never pairs, and that a second park exactly BREAKER_WINDOW_MS old returns null while one BREAKER_WINDOW_MS - 1 old returns "same".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-repeated-park-cause-rules.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/parkAndContinue.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-claude-five-hour-window-label
    title: Pin which capacity window labels the night breaker reads as the Claude five-hour window, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-claude-five-hour-window-label-14476350bad4; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-claude-five-hour-window-label
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "claudeFiveHourPercent (src/production/parkAndContinue.ts:171-177) feeds the night breaker's Claude window trip, and no test file names it; only the label 5-hour is covered, through evaluateNightBreaker."
    acceptance_criteria:
      - tests/pin-claude-five-hour-window-label.test.ts is a new test file that imports claudeFiveHourPercent from ../src/production/parkAndContinue.js (lines 171-177) and asserts that beside a 7-day window it returns the used percentage of a window labelled each of "5-hour", "5h", "5 hour", "Five hour", "five-hour session" and "5hour", and that with two matching windows it returns the first one's.
      - The same test file asserts it returns null for null, for an empty list, and for windows labelled only "7-day" and "weekly".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-claude-five-hour-window-label.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/parkAndContinue.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-journey-log-fingerprint
    title: Pin which fields make a production journey log entry new, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which fields make a production journey log entry new, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-journey-log-fingerprint
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "journeyLogFingerprint (src/production/journeyLog.ts:43-46) decides when the per-tick journey log appends a row, and no test file names it, so the escalation kind-only rule is unpinned."
    acceptance_criteria:
      - tests/pin-journey-log-fingerprint.test.ts is a new test file that imports journeyLogFingerprint from ../src/production/journeyLog.js (lines 43-46) and asserts an escalation's fingerprint is the sha256 hex of JSON [kind] alone, so two escalations of one kind with different message and remedy fingerprint equal.
      - The same test file asserts launch_refusal and review_repair fingerprints are the sha256 hex of JSON [kind, message, remedy], and that changing the message, or the remedy from "r" to null, changes them.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - "Apart from the settlement records Arcadia writes, the change touches only tests/pin-journey-log-fingerprint.test.ts, a new test file of at most 50 lines that imports only vitest, node:crypto and src/production/journeyLog.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation."
    depends_on: []
    decisions: []
    references: []
  - id: pin-freeze-operation-names
    title: Pin the host-wide operations the production freeze guards and its receipt lines, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the host-wide operations the production freeze guards and its receipt lines, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-freeze-operation-names
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "isFreezeOperation and freezeReceiptLines (src/production/freezeWindow.ts:28, 90-92 and 275-278) name what the freeze refuses while production is Active, and no test file names either."
    acceptance_criteria:
      - tests/pin-freeze-operation-names.test.ts is a new test file that imports FREEZE_OPERATIONS, isFreezeOperation, freezeReceiptLines and the RehearsalFreezeDecision type from ../src/production/freezeWindow.js (lines 28, 90-92 and 275-278) and asserts FREEZE_OPERATIONS is exactly ["go-broker.install", "go-broker.ensure", "services.restart", "services.stop"], each is a freeze operation, and "go-broker.status", "services.start", "Services.Restart" and "" are not.
      - The same test file asserts freezeReceiptLines returns [warning, note] when both are set, [note] when only the note is set, and [] when the warning is empty and no note is set or neither is set.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-freeze-operation-names.test.ts, a new test file of at most 50 lines that imports only vitest and src/production/freezeWindow.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-claude-auth-classification
    title: Pin how a Claude sign-in status is classified as a subscription, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how a Claude sign-in status is classified as a subscription, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-claude-auth-classification
    clarification: clarified
    confidence: high
    source: Agent Ask plan-track-2-standby-test-pins-20261123
    why: "classifyClaudeAuthStatus (src/qa/reviewerReplay.ts:59 and 346-363) is the one subscription test shared by the reviewer replay and spend check, and no test file names it, so its fail-closed cases are pinned only indirectly."
    acceptance_criteria:
      - "tests/pin-claude-auth-classification.test.ts is a new test file that imports classifyClaudeAuthStatus from ../src/qa/reviewerReplay.js (lines 59 and 346-363) and asserts loggedIn true with authMethod \"claude.ai\" or \"oauth_token\" and apiProvider \"firstParty\" is { kind: \"subscription\", method }, while authMethod \"api_key\", apiProvider \"bedrock\", or neither field present gives { kind: \"not_subscription\", method, provider } with \"unknown\" for an absent field."
      - "The same test file asserts loggedIn \"true\" (a string) and {} are { kind: \"signed_out\" }, and that \"not json\" and \"null\" are { kind: \"unreadable\" }."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-claude-auth-classification.test.ts, a new test file of at most 50 lines that imports only vitest and src/qa/reviewerReplay.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
current_action: pin-journey-log-fingerprint
recommended_model: heavy
recommended_reasoning_effort: high
---

# Track 2 standby test pins 20261123

Created as an inactive draft from accepted Agent Ask plan-track-2-standby-test-pins-20261123; creation changed no pointer. Current activation is recorded in frontmatter.
