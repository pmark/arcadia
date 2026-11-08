---
arcadia: v1
type: plan
slug: record-run-unattended-test-pins-20261107
project: arcadia
status: active
milestone: Record run unattended test pins 20261107
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-08
actions:
  - id: pin-red-alert-token-estimate
    title: Pin that the red-alert diagnosis token estimate rounds characters divided by four up, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-red-alert-token-estimate-060ca9f91b51; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-red-alert-token-estimate
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "estimateTokens sizes diagnosis prompts against a budget, and no test asserts its rounding, so changing it to floor would pass every test today."
    acceptance_criteria:
      - tests/pin-red-alert-token-estimate.test.ts is a new test file that imports estimateTokens from ../src/production/redAlertDiagnosis.js and asserts estimateTokens returns 0 for "", 1 for "abc", 1 for "abcd", 2 for "abcde" and 100 for a 400-character string.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-red-alert-token-estimate.test.ts, a new test file that imports only vitest and src/production/redAlertDiagnosis.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-defect-summary-normalization
    title: Pin that defect summary normalization collapses whitespace, trims and lowercases, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-defect-summary-normalization-8613d0b38151; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-defect-summary-normalization
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "The defect fingerprint depends on normalizeDefectSummary, and no test calls it directly, so a change to its whitespace or case handling would silently split duplicate defects."
    acceptance_criteria:
      - tests/pin-defect-summary-normalization.test.ts is a new test file that imports normalizeDefectSummary from ../src/defect/signal.js and asserts normalizeDefectSummary("  Login\tFAILS\n on  Retry ") returns "login fails on retry", that "login fails on retry" is returned unchanged, and that "   " returns "".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-defect-summary-normalization.test.ts, a new test file that imports only vitest and src/defect/signal.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-scheduling-sequence-equality
    title: Pin that scheduling sequence equality respects order and length and that only follow_up is an unqueued class, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-scheduling-sequence-equality-0f7d957d9e81; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-scheduling-sequence-equality
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "sameSequence and isQueuedClass gate board moves and queue membership, and neither is asserted directly, so an order-insensitive comparison would pass every test today."
    acceptance_criteria:
      - tests/pin-scheduling-sequence-equality.test.ts is a new test file that imports sameSequence, isQueuedClass and SCHEDULING_CLASSES from ../src/scheduling/order.js and asserts sameSequence returns true for ["a","b"] against ["a","b"] and for [] against [], and false for ["a","b"] against ["b","a"] and for ["a"] against ["a","b"].
      - The same test file asserts that filtering SCHEDULING_CLASSES by not isQueuedClass gives exactly ["follow_up"], and that isQueuedClass is true for interrupt, blocker, corrective and planned.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-scheduling-sequence-equality.test.ts, a new test file that imports only vitest and src/scheduling/order.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-action-doc-ref-parse
    title: "Pin how an Action doc ref splits into Plan slug and Action id on the first #, with a new test file."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-action-doc-ref-parse-d3b3eed3a8c4; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-action-doc-ref-parse
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "parseActionDocRef resolves review items to Plan Actions, and no test calls it directly, so splitting on the last # instead would pass every test today."
    acceptance_criteria:
      - "tests/pin-action-doc-ref-parse.test.ts is a new test file that imports parseActionDocRef from ../src/docs/types.js and asserts parseActionDocRef(\"plan/my-plan#do-thing\") equals { planSlug: \"my-plan\", actionId: \"do-thing\" } and parseActionDocRef(\"plan/a#b#c\") equals { planSlug: \"a\", actionId: \"b#c\" }."
      - "The same test file asserts parseActionDocRef returns null for \"plan/my-plan\" and for \"decision/x#y\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-action-doc-ref-parse.test.ts, a new test file that imports only vitest and src/docs/types.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-journey-action-key-split
    title: Pin that the journey splits project/action keys and refuses malformed keys, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-journey-action-key-split-d91ad7a92d97; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-journey-action-key-split
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "splitActionKey guards every journey derivation, and its refusal message is unasserted, so loosening its pattern would pass every test today."
    acceptance_criteria:
      - tests/pin-journey-action-key-split.test.ts is a new test file that imports splitActionKey from ../src/journey/derive.js and asserts splitActionKey("arcadia/pin-x") equals ["arcadia", "pin-x"].
      - The same test file asserts splitActionKey throws an error containing Expected <project>/<action> for each of "arcadia", "a/b/c", "a /b" and "".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-journey-action-key-split.test.ts, a new test file that imports only vitest and src/journey/derive.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-surface-date-validation
    title: Pin that back-burner surface dates must be real YYYY-MM-DD calendar dates, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-surface-date-validation-e99c083a844b; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-surface-date-validation
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "isValidSurfaceDate has no test, so accepting an impossible date such as 2026-02-29 or a timestamp would pass every test today."
    acceptance_criteria:
      - tests/pin-surface-date-validation.test.ts is a new test file that imports isValidSurfaceDate from ../src/backBurner/surfacing.js and asserts isValidSurfaceDate returns true for "2026-11-07" and "2028-02-29".
      - "The same test file asserts it returns false for each of \"2026-02-29\", \"2026-04-31\", \"2026-13-01\", \"2026-1-01\" and \"2026-11-07T00:00:00Z\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-surface-date-validation.test.ts, a new test file that imports only vitest and src/backBurner/surfacing.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-governed-record-path
    title: Pin exactly which repository paths count as governed records for Session scope checks, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-governed-record-path-8cd950f5e743; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-governed-record-path
    clarification: clarified
    confidence: high
    source: Agent Ask amend-pin-governed-record-path-acceptance-wording-20261107
    why: "isGovernedRecordPath decides which settlement files a Session may touch, and its exact path list is not asserted directly, so widening a prefix would pass every test today."
    acceptance_criteria:
      - tests/pin-governed-record-path.test.ts is a new test file that imports isGovernedRecordPath from ../src/sessions/scopeCriteria.js and asserts isGovernedRecordPath is true for each of PROJECT.md, MISSION_LOG.md, docs/plans/x.md, docs/decisions/0001-x.md and .arcadia/asks/x.yaml.
      - The same test file asserts it is false for each of project.md, docs/plansx.md, src/x.ts, a path under tests/ ending in .test.ts, and ./PROJECT.md.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-governed-record-path.test.ts, a new test file that imports only vitest and src/sessions/scopeCriteria.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-ask-intent-work-kind
    title: Pin how the timeline maps each Agent Ask intent to a work kind, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-ask-intent-work-kind-5270d047dc81; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-ask-intent-work-kind
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "workKindForAskIntent labels Ask work on the timeline, and no test calls it, so moving an intent to another kind would pass every test today."
    acceptance_criteria:
      - tests/pin-ask-intent-work-kind.test.ts is a new test file that imports workKindForAskIntent from ../src/timeline/classify.js and asserts workKindForAskIntent returns plan-design for each of plan, split, action, milestone and project_update, and observe for log.
      - The same test file asserts it returns govern for each of complete, decision, proposal, auto, unknown, null and undefined.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-ask-intent-work-kind.test.ts, a new test file that imports only vitest and src/timeline/classify.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-timeline-summary-and-order
    title: Pin that timeline text ordering is by code unit and that summaries flatten whitespace and cut at 240 characters, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-timeline-summary-and-order-6e66afa87560; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-timeline-summary-and-order
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "The timeline's total order and summary bound are untested directly, so a locale-aware compare or a different cut length would pass every test today."
    acceptance_criteria:
      - tests/pin-timeline-summary-and-order.test.ts is a new test file that imports boundSummary and compareText from ../src/timeline/schema.js and asserts compareText("B", "a") is -1, compareText("a", "a") is 0 and compareText("b", "a") is 1.
      - "The same test file asserts boundSummary(\"  a\\n\\n b  \") is \"a b\", a 240-character string is returned unchanged, and a 241-character string of y returns 240 characters: 239 y followed by an ellipsis character."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-timeline-summary-and-order.test.ts, a new test file that imports only vitest and src/timeline/schema.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-answer-menu-letters
    title: Pin how Decision answer menus map letters to options and read a Decision slug from a doc ref, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-answer-menu-letters-3592e2c54062; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-answer-menu-letters
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "Discord letter answers depend on these helpers, and none is called directly in tests, so case or whitespace handling in a typed letter could change unnoticed."
    acceptance_criteria:
      - tests/pin-answer-menu-letters.test.ts is a new test file that imports letterFor, optionForLetter, decisionSlugOfDocRef and the ReviewAnswerMenu type from ../src/decisions/answerMenu.js and asserts letterFor(0) is "A" and letterFor(2) is "C", and that for a hand-built menu with options A (Approve) and B (Reject), optionForLetter(menu, " b ") returns the Reject option and optionForLetter(menu, "C") returns null.
      - The same test file asserts decisionSlugOfDocRef returns "0184-foo" for "decision/0184-foo", "x" for " decision/x ", and null for "plan/x", null and "decision/   ".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-answer-menu-letters.test.ts, a new test file that imports only vitest and src/decisions/answerMenu.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-lesson-scope-normalization
    title: "Pin that lesson scopes are trimmed and accepted only as arcadia or project:<slug>, with a new test file."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-lesson-scope-normalization-d0a777382cb1; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-lesson-scope-normalization
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "normalizeLessonScope keeps lessons out of path-like buckets, and its refusals are not asserted directly, so allowing .. in a slug would pass every test today."
    acceptance_criteria:
      - "tests/pin-lesson-scope-normalization.test.ts is a new test file that imports normalizeLessonScope from ../src/learning/lessons.js and asserts normalizeLessonScope returns \"arcadia\" for \" arcadia \", \"project:x\" for \" project:x \" and \"project:arcadia\" for \"project:arcadia\"."
      - "The same test file asserts normalizeLessonScope(undefined) throws an error containing A lesson scope is required, and each of \"project:../x\", \"project:a..b\", \"Arcadia\" and \"project:\" throws an error containing Lesson scope must be."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-lesson-scope-normalization.test.ts, a new test file that imports only vitest and src/learning/lessons.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-agent-watch-ref-parsing
    title: Pin how the agent watch contract parses agent/tier refs, project/action refs and branch names, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-agent-watch-ref-parsing-042a5f7d77b3; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-agent-watch-ref-parsing
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "These parsers bound what an agent watch accepts, and none is called directly in tests, so accepting an unknown agent, tier or padded branch would pass every test today."
    acceptance_criteria:
      - "tests/pin-agent-watch-ref-parsing.test.ts is a new test file that imports parseAgentRef, parseActionRef and normalizeBranch from ../src/agentWatch/contract.js and asserts parseAgentRef(\"claude/heavy\") equals { agent: \"claude\", tier: \"heavy\" } and parseAgentRef returns null for each of \"claude/huge\", \"gpt/light\", \"Claude/heavy\" and \"claude\"."
      - "The same test file asserts parseActionRef(\"arcadia/pin-x\") equals { project: \"arcadia\", actionId: \"pin-x\" } and returns null for each of \"Arcadia/x\", \"a/b/c\" and \"a\"; and that normalizeBranch returns \"main\" for \"refs/heads/main\", \"feature/x\" for \"feature/x\", and null for \" main\", \"\", null and undefined."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-agent-watch-ref-parsing.test.ts, a new test file that imports only vitest and src/agentWatch/contract.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-close-out-canonical-json
    title: Pin that close-out canonical JSON sorts keys by code unit, drops undefined values and keeps array order, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-close-out-canonical-json-dcc13f31fe87; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-close-out-canonical-json
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "The close-out hash depends on canonicalJson, and its key order and undefined handling are not asserted directly, so a change would silently alter every close-out hash."
    acceptance_criteria:
      - "tests/pin-close-out-canonical-json.test.ts is a new test file that imports canonicalJson from ../src/plans/closeOut.js and asserts canonicalJson({ b: 1, a: [{ d: undefined, c: null }] }) is '{\"a\":[{\"c\":null}],\"b\":1}', canonicalJson([3, 1, 2]) is \"[3,1,2]\" and canonicalJson({ B: 1, a: 2 }) is '{\"B\":1,\"a\":2}'."
      - "The same test file asserts canonicalJson({ y: 2, x: 1 }) equals canonicalJson({ x: 1, y: 2 })."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-close-out-canonical-json.test.ts, a new test file that imports only vitest and src/plans/closeOut.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-card-expiry-parse
    title: Pin that Decision card expiry accepts only strict ISO instants with valid calendar, clock and offset fields, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-card-expiry-parse-9cadd38ad51b; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-card-expiry-parse
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "parseCardExpiry decides whether a START card is still pressable, and its refusals are not asserted directly, so accepting an impossible date or offset would pass every test today."
    acceptance_criteria:
      - "tests/pin-card-expiry-parse.test.ts is a new test file that imports parseCardExpiry from ../src/decisions/card.js and asserts parseCardExpiry returns Date.parse of the input for \"2026-11-08T03:34:16.000Z\" and for \"2026-11-08T03:34:16+05:30\"."
      - "The same test file asserts it returns null for each of \"2026-02-30T00:00:00Z\", \"2026-11-08T24:00:00Z\", \"2026-11-08T03:34:16+25:00\", \"2026-11-08\", 123, null, and \"2026-11-08T03:34:16Z\" followed by 21 spaces."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-card-expiry-parse.test.ts, a new test file that imports only vitest and src/decisions/card.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-ci-text-neutralization
    title: Pin how review repair neutralizes CI text by blanking control characters, swapping backticks and breaking mentions, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-ci-text-neutralization-549bfe86e10c; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-ci-text-neutralization
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "neutralizeCiText keeps CI output from injecting mentions or code fences into repair briefs, and no test calls it directly, so dropping a replacement would pass every test today."
    acceptance_criteria:
      - tests/pin-ci-text-neutralization.test.ts is a new test file that imports neutralizeCiText from ../src/production/reviewRepair.js and asserts neutralizeCiText("a\u0000b\tc\nd`e`@f\u007f\r") returns "a b\tc\nd'e'@\u200bf  " (written with those JavaScript escapes), so tab and newline survive, NUL, DEL and carriage return become spaces, backticks become apostrophes, and @ gains a zero-width space.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-ci-text-neutralization.test.ts, a new test file that imports only vitest and src/production/reviewRepair.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-issue-ref-parsing
    title: "Pin how narration parses GitHub issue URLs, owner/repo#number refs and bare numbers with a repo, with a new test file."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin how narration parses GitHub issue URLs, owner/repo#number refs and bare numbers with a repo, with a new test file."
    expected_artifact: Evidence satisfying Agent Ask pin-issue-ref-parsing
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "parseIssueRef has no test, so a change to its URL, short-ref or bare-number handling or to its refusal messages would pass every test today."
    acceptance_criteria:
      - "tests/pin-issue-ref-parsing.test.ts is a new test file that imports parseIssueRef from ../src/intelligence/speech/narration.js and asserts parseIssueRef returns { repository: \"pmark/arcadia\", number: 2143 } for \"https://github.com/pmark/arcadia/issues/2143#issuecomment-1\", { repository: \"pmark/arcadia\", number: 2144 } for \"pmark/arcadia#2144\", and { repository: \"pmark/arcadia\", number: 42 } for \" 42 \" with repo \" pmark/arcadia \"."
      - The same test file asserts parseIssueRef("  ") throws an error containing An issue reference is required., parseIssueRef("42") and parseIssueRef("42", "bad") each throw an error containing --repo, and parseIssueRef("foo") throws an error containing Issue reference must be.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-issue-ref-parsing.test.ts, a new test file that imports only vitest and src/intelligence/speech/narration.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-way-trigger-parsing
    title: Pin that Way lookup trigger parsing tolerates malformed input, skips incomplete entries and drops empty phrases, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that Way lookup trigger parsing tolerates malformed input, skips incomplete entries and drops empty phrases, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-way-trigger-parsing
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-way-trigger-wording-20261107
    why: "parseTriggers is not called directly in tests, so throwing on a malformed index or keeping an empty trigger phrase would pass every test today."
    acceptance_criteria:
      - tests/pin-way-trigger-parsing.test.ts is a new test file that imports parseTriggers from ../src/way/lookup.js and asserts parseTriggers returns [] for null, for "not json" and for "{}".
      - "The same test file asserts that for the input JSON.stringify({ entries: [{ path: \"a.md\", trigger: \"alpha beta, , gamma\" }, { path: 3, trigger: \"x\" }, { path: \"b.md\" }] }), the result's paths are exactly [\"a.md\"] and its first entry has exactly 2 trigger phrases."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-way-trigger-parsing.test.ts, a new test file that imports only vitest and src/way/lookup.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-narration-text-split
    title: Pin how narration text splits into chunks by paragraph, sentence and hard wrap, and refuses a bad chunk size, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how narration text splits into chunks by paragraph, sentence and hard wrap, and refuses a bad chunk size, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-narration-text-split
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "splitNarrationText's chunk boundaries feed per-chunk idempotency keys, and it has no test, so any change to packing or wrapping would pass every test today."
    acceptance_criteria:
      - tests/pin-narration-text-split.test.ts is a new test file that imports splitNarrationText from ../src/intelligence/speech/narration.js and asserts splitNarrationText("") is [], splitNarrationText("One. Two. Three.", 9) is ["One. Two.", "Three."], splitNarrationText("A.\n\nB.") is ["A.", "B."] and splitNarrationText("abcdefghij", 4) is ["abcd", "efgh", "ij"].
      - The same test file asserts splitNarrationText("x", 0) and splitNarrationText("x", 1.5) each throw an error containing positive integer.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-narration-text-split.test.ts, a new test file that imports only vitest and src/intelligence/speech/narration.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-markdown-speech-strip
    title: Pin how Markdown is stripped for speech, keeping words and snake_case while removing markup, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how Markdown is stripped for speech, keeping words and snake_case while removing markup, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-markdown-speech-strip
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "stripMarkdownForSpeech is only exercised indirectly, so a change that drops fenced code words or mangles snake_case would pass every test today."
    acceptance_criteria:
      - "tests/pin-markdown-speech-strip.test.ts is a new test file that imports stripMarkdownForSpeech from ../src/intelligence/text/markdown.js and asserts stripMarkdownForSpeech(\"# Title\\n\\n**Bold** and `code` see [docs](http://x) ![img](y)\\n- item\\n> quote\\nsnake_case_name\") returns \"Title\\n\\nBold and code see docs\\nitem\\nquote\\nsnake_case_name\" (written with those JavaScript escapes)."
      - The same test file asserts stripMarkdownForSpeech("```ts\nconst a = 1;\n```") returns "const a = 1;".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-markdown-speech-strip.test.ts, a new test file that imports only vitest and src/intelligence/text/markdown.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-agent-role-guard
    title: Pin that the agent role guard accepts exactly builder and critic, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the agent role guard accepts exactly builder and critic, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-agent-role-guard
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-execution-build-20261107
    why: "isAgentRole guards identity resolution, and no test calls it directly, so accepting another role or a differently cased one would pass every test today."
    acceptance_criteria:
      - tests/pin-agent-role-guard.test.ts is a new test file that imports isAgentRole from ../src/codingAgents/agentIdentity.js and asserts isAgentRole returns true for "builder" and "critic", and false for each of "Builder", "reviewer", "" and " builder".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-agent-role-guard.test.ts, a new test file that imports only vitest and src/codingAgents/agentIdentity.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
current_action: pin-issue-ref-parsing
recommended_model: standard
recommended_reasoning_effort: medium
---

# Record run unattended test pins 20261107

Created as an inactive draft from accepted Agent Ask plan-record-run-unattended-test-pins-20261107; creation changed no pointer. Current activation is recorded in frontmatter.
