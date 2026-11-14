---
arcadia: v1
type: plan
slug: record-run-unattended-test-pins-20261113-part-3
project: arcadia
status: draft
milestone: Record run unattended test pins 20261113 part 3
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-14
actions:
  - id: pin-requires-review-value
    title: Pin that only the exact requires_review value counts as requiring review, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-pin-requires-review-value-2026-11-14; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-requires-review-value
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "isRequiresReviewValue gates the requires_review decision used by the queue, and no test file names it, so its exact-match rule is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-requires-review-value.test.ts is a new test file that imports isRequiresReviewValue from ../src/domain/constants.js and asserts it returns true for 'requires_review' and false for 'Requires_Review', 'requires review', 'work_queue', an empty string, null and undefined.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-requires-review-value.test.ts, a new test file that imports only vitest and src/domain/constants.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-work-classification-queue
    title: Pin that work classifications route to the requires_review, blocked or work queue, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-pin-work-classification-queue-2026-11-14; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-work-classification-queue
    clarification: clarified
    confidence: high
    source: Agent Ask amend-plan3-pin-work-classification-20261113
    why: "queueForWorkClassification decides which queue a work item lands in, and no test file names it, so its requires_review, blocked and work_queue routing is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-work-classification-queue.test.ts is a new test file that imports queueForWorkClassification from ../src/domain/constants.js and asserts it returns 'requires_review' for 'requires_review', 'blocked' for 'blocked' and 'work_queue' for 'agent' and for 'autonomous'.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-work-classification-queue.test.ts, a new test file that imports only vitest and src/domain/constants.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-operator-surface-membership
    title: Pin that the cli, dashboard and discord surfaces count as operator-touched and claude and automation do not, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-pin-operator-surface-membership-2026-11-14; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-operator-surface-membership
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "isOperatorSurface decides which activity counts as the operator personally touching Arcadia, and no test file names it, so its membership list is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-operator-surface-membership.test.ts is a new test file that imports isOperatorSurface from ../src/activity/types.js and asserts it returns true for 'cli', 'dashboard' and 'discord' and false for 'claude' and 'automation'.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-operator-surface-membership.test.ts, a new test file that imports only vitest and src/activity/types.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-encouragement-format
    title: Pin that an encouragement line is shown bare or quoted with its attribution, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-encouragement-format-6a46eb6856d4; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-encouragement-format
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "formatEncouragement words the line shown to the operator, and no test file names it, so its bare and quoted-with-attribution forms are not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-encouragement-format.test.ts is a new test file that imports formatEncouragement from ../src/activity/encouragement.js and asserts it returns the bare line 'Pick one thing.' when there is no attribution.
      - The same test file asserts that with the attribution 'Seneca' and the line 'Keep going.' the result is the line in double quote marks, then an em dash, then the attribution.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-encouragement-format.test.ts, a new test file that imports only vitest and src/activity/encouragement.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-missing-done-condition-question
    title: Pin the question asked when a next action has no done-condition, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-missing-done-condition-question-86a85866a75c; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-missing-done-condition-question
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "missingDoneConditionQuestion is the single question the clarify lint asks the operator, and no test file names it, so its exact wording is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-missing-done-condition-question.test.ts is a new test file that imports missingDoneConditionQuestion from ../src/clarify/lint.js and asserts that for the next action 'Run tests' it returns the sentence asking how anyone will observe that the action is finished, ending with the words State the done-condition in one sentence.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-missing-done-condition-question.test.ts, a new test file that imports only vitest and src/clarify/lint.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-handoff-eligibility
    title: Pin that only a coding-agent verdict on a captured work item is eligible for handoff, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-handoff-eligibility-90519d527665; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-handoff-eligibility
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "isHandoffEligible decides which clarified work items become handoff Asks, and no test file names it, so its capture check is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-handoff-eligibility.test.ts is a new test file that imports isHandoffEligible from ../src/clarify/handoff.js and asserts it returns true for a work item with a capture id and a verdict whose actor is 'coding-agent'.
      - The same test file asserts it returns false when the work item has no capture id, and false when the verdict actor is 'human'.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-handoff-eligibility.test.ts, a new test file that imports only vitest and src/clarify/handoff.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-dashboard-base-url
    title: Pin that the dashboard base URL keeps only trimmed http or https origins, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the dashboard base URL keeps only trimmed http or https origins, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-dashboard-base-url
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "dashboardBase builds the links a digest sends to the operator, and no test file names it, so its protocol check and trailing-slash handling are not pinned by a direct test."
    acceptance_criteria:
      - "tests/pin-dashboard-base-url.test.ts is a new test file that imports dashboardBase from ../src/digests/report.js and asserts it returns 'https://arcadia.example' for '  https://arcadia.example/  ' and 'http://localhost:3000' for 'http://localhost:3000///'."
      - "The same test file asserts it returns null for an empty string, a whitespace-only string, 'ftp://arcadia.example', 'not a url', null and undefined."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-dashboard-base-url.test.ts, a new test file that imports only vitest and src/digests/report.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-safe-text-collapse
    title: Pin that safe text collapses whitespace, truncates to the limit and reads non-strings as empty, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that safe text collapses whitespace, truncates to the limit and reads non-strings as empty, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-safe-text-collapse
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "safeText cleans free text before it reaches next-step lines; nextSteps.test.ts asserts its control-character case and the 120-character title cap, but nothing asserts its whitespace collapse or non-string guard, so those two are not pinned."
    acceptance_criteria:
      - tests/pin-safe-text-collapse.test.ts is a new test file that imports safeText from ../src/decisions/nextSteps.js and asserts it returns an empty string for the number 42 and for null.
      - The same test file asserts safeText of a string with a tab and runs of spaces between words and leading and trailing spaces returns the words separated by single spaces, and that safeText of 'abcdefghijklmnop' with a limit of 5 returns a string of length 5 that starts with 'abcd'.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-safe-text-collapse.test.ts, a new test file that imports only vitest and src/decisions/nextSteps.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-design-is-date
    title: Pin that a design date is a real calendar date written as YYYY-MM-DD, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that a design date is a real calendar date written as YYYY-MM-DD, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-design-is-date
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "isDate validates the dates in design records, and it is reached only indirectly, through the design validators, so its calendar-date and leap-day rules are not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-design-is-date.test.ts is a new test file that imports isDate from ../src/design/common.js and asserts it returns true for '2026-11-07' and '2028-02-29'.
      - "The same test file asserts it returns false for '2026-02-29', '2026-11-7', '2026-11-07T00:00:00Z', '2026-13-01' and the number 20261107."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-design-is-date.test.ts, a new test file that imports only vitest and src/design/common.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-design-one-of
    title: Pin that the one-of check accepts only a string from the allowed list, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the one-of check accepts only a string from the allowed list, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-design-one-of
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "oneOf is the type guard behind every enumerated design field, and it is reached only indirectly, through the design validators, so its exact string match is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-design-one-of.test.ts is a new test file that imports oneOf from ../src/design/common.js and asserts it returns true for 'b' with the allowed list 'a' and 'b'.
      - The same test file asserts it returns false for 'c', 'B' and an empty string against that list, and false for the number 1 and for undefined.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-design-one-of.test.ts, a new test file that imports only vitest and src/design/common.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-design-text-value
    title: Pin that the design text helper returns non-blank strings unchanged and null otherwise, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the design text helper returns non-blank strings unchanged and null otherwise, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-design-text-value
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "text is the shared check that a design field has content, and it is reached only indirectly, through the design validators, so its handling of blank and padded text is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-design-text-value.test.ts is a new test file that imports text from ../src/design/common.js and asserts it returns a string with content unchanged, including its surrounding spaces.
      - The same test file asserts it returns null for an empty string, a whitespace-only string, null, undefined and the number 3.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-design-text-value.test.ts, a new test file that imports only vitest and src/design/common.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-design-list-items
    title: Pin that the design list helper returns an array as it is and reads anything else as empty, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the design list helper returns an array as it is and reads anything else as empty, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-design-list-items
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "items gives every design list field a safe array, and it is reached only indirectly, through the design validators, so its handling of arrays and non-arrays is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-design-list-items.test.ts is a new test file that imports items from ../src/design/common.js and asserts it returns the same array object it was given.
      - The same test file asserts it returns an empty array for null, undefined, the string 'text', the number 4 and an object with a length property.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-design-list-items.test.ts, a new test file that imports only vitest and src/design/common.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-design-is-object
    title: Pin that the design object check accepts plain objects and rejects null, arrays and scalars, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the design object check accepts plain objects and rejects null, arrays and scalars, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-design-is-object
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "isObj is the shape guard for every design record, and it is reached only indirectly, through the design validators, so its handling of arrays and null is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-design-is-object.test.ts is a new test file that imports isObj from ../src/design/common.js and asserts it returns true for a plain object with one field.
      - The same test file asserts it returns false for null, undefined, an empty array, an array of one string, a string, the number 1 and the boolean true.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-design-is-object.test.ts, a new test file that imports only vitest and src/design/common.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-design-require-text
    title: Pin that the required-text check records a blank-field problem and returns the value otherwise, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the required-text check records a blank-field problem and returns the value otherwise, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-design-require-text
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "requireText is the check that reports a blank design field, and it is reached only indirectly, through the design validators, so its message and recorded problem are not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-design-require-text.test.ts is a new test file that imports Findings and requireText from ../src/design/common.js and asserts that requireText returns '  x ' unchanged and records no problem for it.
      - "The same test file asserts that for whitespace-only text it returns null and records exactly one problem reading 'plan: title is required and must not be blank.', and that a non-string value also returns null with one problem recorded."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-design-require-text.test.ts, a new test file that imports only vitest and src/design/common.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-design-require-enum
    title: Pin that the required-enum check returns allowed values and records a listed problem otherwise, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the required-enum check returns allowed values and records a listed problem otherwise, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-design-require-enum
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "requireEnum is the check behind every enumerated design field, and it is reached only indirectly, through the design validators, so its message and missing-value handling are not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-design-require-enum.test.ts is a new test file that imports Findings and requireEnum from ../src/design/common.js and asserts that requireEnum returns 'b' for 'b' in the allowed list 'a' and 'b' and records no problem.
      - "The same test file asserts that for 'c' it returns null and records exactly one problem reading 'plan: status must be one of a, b.', and that for undefined it returns null and records the same problem with the words (missing) before the final period."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-design-require-enum.test.ts, a new test file that imports only vitest and src/design/common.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-urgency-level-thresholds
    title: Pin the urgency score cut-offs at 0.75 and 0.4, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the urgency score cut-offs at 0.75 and 0.4, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-urgency-level-thresholds
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "urgencyLevelForScore turns an orientation score into critical, attention or quiet, and no test file names it, so its two cut-offs are not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-urgency-level-thresholds.test.ts is a new test file that imports urgencyLevelForScore from ../src/orientation/urgency.js and asserts it returns 'critical' for 0.75 and 1, 'attention' for 0.74 and 0.4, and 'quiet' for 0.39 and 0.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-urgency-level-thresholds.test.ts, a new test file that imports only vitest and src/orientation/urgency.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-coding-agent-label-fallback
    title: Pin that a coding agent without a provider label is shown by its profile name, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that a coding agent without a provider label is shown by its profile name, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-coding-agent-label-fallback
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "codingAgentLabel names the agent on operator surfaces, and no test file names it, so its fallback for an unknown provider is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-coding-agent-label-fallback.test.ts is a new test file that imports codingAgentLabel from ../src/codingAgents/adapters.js and asserts it returns the profile name 'Custom profile' for a profile whose provider is 'not-a-real-provider'.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-coding-agent-label-fallback.test.ts, a new test file that imports only vitest and src/codingAgents/adapters.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-days-until-due
    title: Pin the signed fractional days until an orientation entry is due, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the signed fractional days until an orientation entry is due, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-days-until-due
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "daysUntilDue feeds the staleness check that marks entries as approaching or overdue, and no test file names it, so its sign and missing-due case are not pinned by a direct test."
    acceptance_criteria:
      - "tests/pin-days-until-due.test.ts is a new test file that imports daysUntilDue from ../src/orientation/staleness.js and asserts it returns 3 for an entry due 2026-11-10T00:00:00.000Z when now is 2026-11-07T00:00:00.000Z, and -2 for an entry due 2026-11-07T00:00:00.000Z when now is 2026-11-09T00:00:00.000Z."
      - The same test file asserts it returns undefined for an entry without a due instant.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-days-until-due.test.ts, a new test file that imports only vitest and src/orientation/staleness.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-leak-unverifiable-reason
    title: Pin the reason a leak check snapshot is reported as unverifiable, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the reason a leak check snapshot is reported as unverifiable, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-leak-unverifiable-reason
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "unverifiableReason tells the operator why a leak check could not observe the live workspace, and no test file names it, so its wording and first-errored-snapshot choice are not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-leak-unverifiable-reason.test.ts is a new test file that imports unverifiableReason from ../src/workspace/leakCheck.js and asserts it returns null when no snapshot records a live workspace error, including when it is called with no snapshots.
      - "The same test file asserts that with snapshots whose live workspace errors are 'boom' and 'late' it returns the text 'live workspace /w/live was not observed: boom' for the first errored snapshot, and that an unset path is named as (none) in the same wording."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-leak-unverifiable-reason.test.ts, a new test file that imports only vitest and src/workspace/leakCheck.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-model-tier-of
    title: Pin that a model maps back to the tier whose binding for the agent names it, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that a model maps back to the tier whose binding for the agent names it, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-model-tier-of
    clarification: clarified
    confidence: high
    source: Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113
    why: "tierOfModel maps a running model back to its tier for escalation decisions, and no test file names it, so which agent's binding it matches is not pinned by a direct test."
    acceptance_criteria:
      - tests/pin-model-tier-of.test.ts is a new test file that imports tierOfModel from ../src/codingAgents/modelTiers.js and asserts that, with a registry binding claude to model-light, model-standard and model-heavy in the light, standard and heavy tiers, it returns 'standard' for model-standard.
      - The same test file asserts it returns null for model-unknown with agent claude, and null for model-light with agent codex.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-model-tier-of.test.ts, a new test file that imports only vitest and src/codingAgents/modelTiers.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
recommended_model: standard
recommended_reasoning_effort: medium
---

# Record run unattended test pins 20261113 part 3

Created as an inactive draft from accepted Agent Ask plan-record-run-unattended-test-pins-part-3-r3-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
