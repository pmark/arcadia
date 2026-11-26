---
arcadia: v1
type: plan
slug: track-4-standby-test-pins-20261126
project: arcadia
status: active
milestone: Track 4 standby test pins 20261126
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-26
actions:
  - id: pin-pr-decision-id-clashes
    title: Pin how a Decision file name gives its id and which ids a pull request would duplicate on main, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-pr-decision-id-clashes-ec4047a8a2f8; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-pr-decision-id-clashes
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "decisionIdOfFile and findPullRequestDecisionIdClashes (src/decisions/decisionIds.ts:19-21, 68-76) decide which Decision ids a pull request adds and whether one duplicates an id on main (#3108 class), and no test file names either, so their exemptions are pinned only indirectly."
    acceptance_criteria:
      - tests/pin-pr-decision-id-clashes.test.ts is a new test file that imports decisionIdOfFile and findPullRequestDecisionIdClashes from ../src/decisions/decisionIds.js (lines 14-21 and 49-76) and asserts decisionIdOfFile gives "0241" for "0241-standing-grant.md", "9001" for "docs/decisions/9001-x.md" (only the last path segment counts), and null for "0241.md", "x-0241-y.md" and "0241-x.txt".
      - "The same test file asserts findPullRequestDecisionIdClashes reports exactly one clash, { id: \"9001\", files: [\"docs/decisions/9001-a.md\", \"docs/decisions/9001-b.md\"] }, when origin main holds 9001-a.md and the head adds 9001-b.md (a bare name gains the docs/decisions/ prefix and the files are sorted), and reports [] when the head adds 9002-b.md beside 9000-a.md, when both 9001 files are already on the merge base, and for the grandfathered id 0004 with exactly two files, while a third 0004 file that the head adds is reported with all three files."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-pr-decision-id-clashes.test.ts, a new test file of at most 50 lines that imports only vitest and src/decisions/decisionIds.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/decisions/decisionIds.ts", "tests/pin-pr-decision-id-clashes.test.ts"]
  - id: pin-authority-path-normalization
    title: Pin how the authority classifier reduces a changed path before matching it, and which paths it refuses to reduce, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-authority-path-normalization-00eff8954f4c; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-authority-path-normalization
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "normalizeAuthorityPath (src/decisions/batchMerge.ts:300-322) is the fail-closed first step of classifyAuthorityPath, which batch merges and card sources use to find authority-adjacent paths, and no test file names it, so its reductions and null for unsafe input are pinned only via the classifier."
    acceptance_criteria:
      - tests/pin-authority-path-normalization.test.ts is a new test file that imports normalizeAuthorityPath from ../src/decisions/batchMerge.js (lines 300-322) and asserts it returns "src/a.ts" for "src/a.ts", for "./src//a.ts" and for src and a.ts joined by one backslash, returns "docs/x.md" for "docs/./x.md", and keeps case, returning "src/A.TS" for "src/A.TS".
      - "The same test file asserts it returns null for the number 42, for null, for \"\", \".\", \"/etc/x\", \"C:/x\", \"../x\" and \"a/../b\", for \" a/b\" and \"a /b\" (a segment with a leading or trailing space), for \"a/b.\" (a segment ending in a dot), for a path containing a tab character, and for a path containing the non-ASCII letter U+00E9."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-authority-path-normalization.test.ts, a new test file of at most 50 lines that imports only vitest and src/decisions/batchMerge.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/decisions/batchMerge.ts", "tests/pin-authority-path-normalization.test.ts"]
  - id: pin-review-attempt-receipt-flags
    title: Pin which failed review-lineage attempts count as a never-started repair or an unavailable reviewer, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-review-attempt-receipt-flags-50119f5bc04c; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-review-attempt-receipt-flags
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "isRepairNeverStarted and attemptWasReviewerUnavailable (src/sessions/roleLineage.ts:151-158, 570-578) decide whether a failed attempt stands for its candidate or spends verdict budget (roleLineage.ts:589), and no test file names either, so their exact-type rules are pinned only via the repair loop."
    acceptance_criteria:
      - tests/pin-review-attempt-receipt-flags.test.ts is a new test file that imports isRepairNeverStarted and attemptWasReviewerUnavailable from ../src/sessions/roleLineage.js (lines 151-158 and 570-578) and asserts isRepairNeverStarted is true for status "failed" with a terminal receipt whose repairNeverStarted is the boolean true, and attemptWasReviewerUnavailable is true for status "failed" with a terminal receipt whose reviewerUnavailable is the non-empty string "no reviewer".
      - The same test file asserts both return false for status "completed" or "running" with an otherwise matching receipt, for a null receipt, for a receipt that is not JSON ("not json") or is the JSON null, for repairNeverStarted given as the string "true", and for reviewerUnavailable given as "" or as the boolean true.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-review-attempt-receipt-flags.test.ts, a new test file of at most 50 lines that imports only vitest and src/sessions/roleLineage.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/sessions/roleLineage.ts", "tests/pin-review-attempt-receipt-flags.test.ts"]
  - id: pin-ask-draft-scalar-rewrite
    title: Pin how an Agent Ask draft's request id or candidate revision is rewritten before settlement, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-ask-draft-scalar-rewrite-a1058ea75319; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-ask-draft-scalar-rewrite
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "setTopLevelAskScalar (src/ask/agentAsk.ts:455-472) rewrites a drafted completion's request_id and candidate_revision before it settles (autoSettleBeforeDispatch.ts:133-142), and no test file names it, so the JSON path that once left every JSON draft unsettleable is pinned only via settlement."
    acceptance_criteria:
      - "tests/pin-ask-draft-scalar-rewrite.test.ts is a new test file that imports setTopLevelAskScalar from ../src/ask/agentAsk.js (lines 455-472) and asserts that setting request_id to \"new\" on the compact JSON draft {\"agent_ask\":\"v1\",\"request_id\":\"old\",\"project\":\"arcadia\"} returns {\"agent_ask\":\"v1\",\"request_id\":\"new\",\"project\":\"arcadia\"} plus one trailing newline, and that setting candidate_revision to \"abc123\" on {\"agent_ask\":\"v1\",\"project\":\"arcadia\"} returns that object with \"candidate_revision\":\"abc123\" added as its last key, plus one trailing newline."
      - "The same test file asserts that for a block YAML draft whose lines are agent_ask: v1, request_id: old and project: arcadia, setting request_id to \"new\" changes only that line, to request_id: new; that a block YAML draft with no candidate_revision line is returned unchanged when candidate_revision is set; and that a JSON array draft such as [1,2] is returned unchanged."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-ask-draft-scalar-rewrite.test.ts, a new test file of at most 50 lines that imports only vitest and src/ask/agentAsk.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/ask/agentAsk.ts", "tests/pin-ask-draft-scalar-rewrite.test.ts"]
  - id: pin-pointer-replace-current-action
    title: Pin how the queue rewrites or inserts a document's current_action pointer, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how the queue rewrites or inserts a document's current_action pointer, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-pointer-replace-current-action
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "replacePointer (src/dispatch/pointer.ts:322-335) writes current_action into PROJECT.md and the Plan for advance queue make-next and Decision deferral (pointer.ts:99, decisionDeferral.ts:254-255), and no test file names it, so its rewrite, insertion point and refusals are pinned only via those flows."
    acceptance_criteria:
      - "tests/pin-pointer-replace-current-action.test.ts is a new test file that imports replacePointer from ../src/dispatch/pointer.js (lines 322-335) and asserts that for a document whose frontmatter lines are slug: p, current_action: a1 and status: active, followed by a body line, replacing the pointer with a2 beside status changes only that line, to current_action: a2, and that for frontmatter lines slug: p, status: active and updated: x it inserts current_action: a2 on the line directly after status: active and changes nothing else."
      - The same test file asserts that a current_action line in the body, below the closing frontmatter marker, is left unchanged; that frontmatter with no current_action line and no line for the given field throws "Managed document has no stable field beside which to insert current_action."; and that text with no frontmatter block throws "Managed document has no YAML frontmatter block to update."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-pointer-replace-current-action.test.ts, a new test file of at most 50 lines that imports only vitest and src/dispatch/pointer.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/dispatch/pointer.ts", "tests/pin-pointer-replace-current-action.test.ts"]
  - id: pin-frontmatter-field-set
    title: Pin how Plan activation sets a top-level frontmatter field such as active_plan or status, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how Plan activation sets a top-level frontmatter field such as active_plan or status, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-frontmatter-field-set
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "setFrontmatterField (src/dispatch/planActivationApply.ts:366-379) writes active_plan into PROJECT.md and status into the Plan on activation (planActivationApply.ts:116-122), and no test file names it, so its replace-or-append rule, exact field match and refusal are pinned only via activation."
    acceptance_criteria:
      - "tests/pin-frontmatter-field-set.test.ts is a new test file that imports setFrontmatterField from ../src/dispatch/planActivationApply.js (lines 366-379) and asserts that for frontmatter lines slug: p, status: draft and updated: x followed by a body, setting status to active changes only that line, to status: active, and that setting active_plan to track-4 on frontmatter holding only slug: p appends active_plan: track-4 as the last frontmatter line, directly before the closing marker."
      - "The same test file asserts that when status is set, a status_note: x line stays unchanged and only the status: line changes; that a status: line in the body, below the frontmatter, stays unchanged; and that text with no frontmatter block throws \"Managed document has no YAML frontmatter block to update.\""
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-frontmatter-field-set.test.ts, a new test file of at most 50 lines that imports only vitest and src/dispatch/planActivationApply.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/dispatch/planActivationApply.ts", "tests/pin-frontmatter-field-set.test.ts"]
  - id: pin-stop-production-question
    title: Pin which operator questions the Way lookup reads as asking how to stop production, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which operator questions the Way lookup reads as asking how to stop production, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-stop-production-question
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "asksToStopProduction (src/way/lookup.ts:655-672) decides whether a Way question boosts the passage that says production Off (lookup.ts:716), and no test file names it, so which wordings ask to stop production, and the deliberate exclusion of switch, are pinned only via ranked answers."
    acceptance_criteria:
      - tests/pin-stop-production-question.test.ts is a new test file that imports asksToStopProduction from ../src/way/lookup.js (lines 655-672) and asserts it is true for "How do I stop production?", "stop everything", "Please HALT the production run", "turn the production off", "turn off production", "shut off the production", "shut everything off" and "where is the off button".
      - The same test file asserts it is false for "turn off notifications", "switch production off", "shut down production", "halt everything", "how do I start production" and "stop the timer".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-stop-production-question.test.ts, a new test file of at most 50 lines that imports only vitest and src/way/lookup.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/way/lookup.ts", "tests/pin-stop-production-question.test.ts"]
  - id: pin-evidence-secret-redaction
    title: Pin which credential shapes are redacted from recorded command output, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which credential shapes are redacted from recorded command output, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-evidence-secret-redaction
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126
    why: "redactSecrets (src/sessions/validationEvidence.ts:323-338) strips credential-shaped text from recorded validation output and launch failures (validationEvidence.ts:292, launchFailure.ts:38), and no test file names it, so its rules and length minimums are pinned only via those formatters."
    acceptance_criteria:
      - "tests/pin-evidence-secret-redaction.test.ts is a new test file that imports redactSecrets from ../src/sessions/validationEvidence.js (lines 323-338) and asserts it turns \"API_KEY=abcdefgh1234\" into \"API_KEY=[redacted]\", \"DB_PASSWORD = abcdefgh12\" into \"DB_PASSWORD = [redacted]\", the text SECRET=\"abcdefgh\" and more into SECRET=[redacted] and more (the quotes go too), and \"Authorization: Bearer abcdefghijklmnop1234\" into \"Authorization: Bearer [redacted]\"."
      - The same test file asserts it leaves unchanged "TOKEN=abc" (a value under 8 characters), "Bearer short" (under 16 characters), "key=abcdefghijkl" (a name with no credential word) and "all 12 tests passed".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-evidence-secret-redaction.test.ts, a new test file of at most 50 lines that imports only vitest and src/sessions/validationEvidence.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/sessions/validationEvidence.ts", "tests/pin-evidence-secret-redaction.test.ts"]
questions: []
decisions: []
current_action: pin-pointer-replace-current-action
recommended_model: heavy
recommended_reasoning_effort: high
---

# Track 4 standby test pins 20261126

Created as an inactive draft from accepted Agent Ask rowan-g9-plan-track-4-standby-test-pins-20261126; creation changed no pointer. Current activation is recorded in frontmatter.
