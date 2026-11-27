---
arcadia: v1
type: plan
slug: track-5-standby-test-pins-20261126
project: arcadia
status: active
milestone: Track 5 standby test pins 20261126
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-27
actions:
  - id: pin-image-format-sniffing
    title: Pin how a generated image's format is named from its leading bytes and how its width and height are read, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-image-format-sniffing-2872e8752e6c; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-image-format-sniffing
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "sniffImageMimeType and parseImageDimensions (src/intelligence/artifacts/imageMeta.ts:11-33, 53-64) decide whether a Codex image artifact is accepted (imageExecutor.ts:365-373), and no test file names either, so the signatures and JPEG segment walk are pinned only indirectly."
    acceptance_criteria:
      - tests/pin-image-format-sniffing.test.ts is a new test file that imports sniffImageMimeType and parseImageDimensions from ../src/intelligence/artifacts/imageMeta.js (lines 11-33 and 53-117) and asserts sniffImageMimeType gives "image/png" for the 8-byte PNG signature 89 50 4e 47 0d 0a 1a 0a, "image/jpeg" for the bytes ff d8 ff, "image/gif" for the ASCII text GIF87a and for GIF89a, and "image/webp" for RIFF0000WEBP, and gives "application/octet-stream" for GIF88a, for RIFF0000WAVE, for the two bytes ff d8 and for an empty buffer.
      - "The same test file asserts parseImageDimensions returns { width: 640, height: 480 } for a 24-byte PNG with width 640 at byte 16 and height 480 at byte 20 (both 32-bit big-endian), and undefined for the same PNG cut to 23 bytes; returns { width: 640, height: 480 } for the 21-byte JPEG ff d8 ff c0 00 11 08 01 e0 02 80 03 followed by nine zero bytes, and { width: 32, height: 16 } for the 21-byte JPEG ff d8, then an APP0 segment ff e0 00 04 00 00, then ff c2 00 0b 08 00 10 00 20 03 01 11 00; and returns undefined for the first JPEG with its fourth byte changed to da (start of scan before any frame) and for the ASCII text GIF89a followed by five dots."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-image-format-sniffing.test.ts, a new test file of at most 50 lines that imports only vitest and src/intelligence/artifacts/imageMeta.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/intelligence/artifacts/imageMeta.ts", "tests/pin-image-format-sniffing.test.ts"]
  - id: pin-strict-utc-timestamp
    title: Pin which timestamps the peer-watch contract accepts as a strict UTC instant, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-strict-utc-timestamp-a88308278511; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-strict-utc-timestamp
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "parseUtcTimestamp (src/agentWatch/contract.ts:129-131) reads peer-watch heartbeat and issued_at trailers (contract.ts:211, 324) and rejects a trailer it cannot read, and no test file names it, so its Z-only, three-digit and impossible-date rules are pinned only via trailer parsing."
    acceptance_criteria:
      - "tests/pin-strict-utc-timestamp.test.ts is a new test file that imports parseUtcTimestamp from ../src/agentWatch/contract.js (lines 106 and 129-131, with parseIsoInstant at 494-507) and asserts it returns 1795714605000 for \"2026-11-26T17:36:45Z\", 1795714605287 for \"2026-11-26T17:36:45.287Z\", 1795714605200 for \"2026-11-26T17:36:45.2Z\" and 1709164800000 for the leap day \"2024-02-29T00:00:00Z\"."
      - "The same test file asserts it returns null for \"2026-11-26T17:36:45.1234Z\" (four fraction digits), \"2026-11-26T09:36:45-08:00\" (an offset), \"2026-11-26\" (a date alone), \"2026-11-26 17:36:45Z\" (a space for T), \"2026-11-26T17:36:45z\" (a lowercase z), \"2026-02-31T00:00:00Z\" and \"2026-13-01T00:00:00Z\" (impossible dates), \"2026-11-26T24:00:00Z\" (hour 24) and \"\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-strict-utc-timestamp.test.ts, a new test file of at most 50 lines that imports only vitest and src/agentWatch/contract.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/agentWatch/contract.ts", "tests/pin-strict-utc-timestamp.test.ts"]
  - id: pin-github-repository-url-check
    title: Pin which repository URLs Project setup accepts as GitHub and how stored string arrays are decoded, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which repository URLs Project setup accepts as GitHub and how stored string arrays are decoded, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-github-repository-url-check
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "validateGitHubRepositoryUrl and decodeStringArray (src/projects/setup.ts:129-139, 150-165) check a Project's repository URL and decode its stored aliases and validation commands (setup.ts:75-86, interpreter.ts:196-198), and no test file names either, so their accepted shapes are pinned indirectly."
    acceptance_criteria:
      - "tests/pin-github-repository-url-check.test.ts is a new test file that imports validateGitHubRepositoryUrl and decodeStringArray from ../src/projects/setup.js (lines 129-139 and 150-165) and asserts validateGitHubRepositoryUrl returns \"https://github.com/pmark/arcadia\" unchanged, returns that HTTPS URL with the suffix .git appended, trimmed, when given it with two leading and two trailing spaces, returns the SSH form git@github.com:pmark/arcadia with the suffix .git appended unchanged, and returns null for \"\", for three spaces, for null and for undefined."
      - "The same test file asserts validateGitHubRepositoryUrl throws \"Repository URL must identify a GitHub repository using HTTPS or SSH.\" for \"http://github.com/pmark/arcadia\", \"https://gitlab.com/pmark/arcadia\", \"https://github.com/pmark\", \"https://github.com/pmark/arcadia/\" and \"https://github.com/pmark/arcadia/tree/main\", and that decodeStringArray returns [\"a\", \"b\"] for the JSON text [\"a\",\" b \",\"a\",1,null,\"\"] and [] for the JSON object {\"a\":1}, the JSON string \"x\", the text not json, \"\", null and undefined."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-github-repository-url-check.test.ts, a new test file of at most 50 lines that imports only vitest and src/projects/setup.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/projects/setup.ts", "tests/pin-github-repository-url-check.test.ts"]
  - id: pin-build-route-declaration
    title: Pin which Actions count as declaring the build route that skips planning runs, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which Actions count as declaring the build route that skips planning runs, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-build-route-declaration
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "declaresBuildRoute (src/sessions/packetLifecycle.ts:32-35) decides whether an Action is gated only by its build packet instead of a planning run (packetLifecycle.ts:57), and no test file names it, so which route and classification pairs qualify is pinned only via packet lifecycle flows."
    acceptance_criteria:
      - tests/pin-build-route-declaration.test.ts is a new test file that imports declaresBuildRoute from ../src/sessions/packetLifecycle.js (lines 32-35) and asserts it is true for execution_route "build" with work_classification "agent" and for execution_route "build" with work_classification "autonomous".
      - The same test file asserts it is false for execution_route "build" with work_classification "requires_review" or "blocked", for execution_route "plan-run" with "agent", for execution_route null with "agent", and for an object with no execution_route and work_classification "autonomous".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-build-route-declaration.test.ts, a new test file of at most 50 lines that imports only vitest and src/sessions/packetLifecycle.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/sessions/packetLifecycle.ts", "tests/pin-build-route-declaration.test.ts"]
  - id: pin-defect-evidence-merge
    title: Pin how defect and lesson evidence lists are merged and which summary words count for duplicate detection, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how defect and lesson evidence lists are merged and which summary words count for duplicate detection, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-defect-evidence-merge
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "mergeEvidence, normalizeEvidence and summaryTokens (src/defect/signal.ts:38-53, 75-81) build stored lesson evidence (lessons.ts:115) and the word sets behind likely-duplicate checks (signal.ts:84-86), and no test file names them, so their trimming and stop-word rules are pinned only indirectly."
    acceptance_criteria:
      - tests/pin-defect-evidence-merge.test.ts is a new test file that imports mergeEvidence, normalizeEvidence and summaryTokens from ../src/defect/signal.js (lines 38-53 and 75-81) and asserts normalizeEvidence returns ["a", "b"] for [" a ", "b", "a", "", "  ", "b "], mergeEvidence returns ["x", "y", "z"] for existing ["x", "y"] and incoming ["y", " z ", "x"], and mergeEvidence returns ["x"] for existing [" x "] and incoming [].
      - "The same test file asserts the spread of summaryTokens is [\"dispatch\", \"tick\", \"fails\", \"queue\", \"empty\"] for \"The Dispatch tick FAILS when the queue is empty, again and again\" and [\"red\", \"main\", \"build\", \"broke\"] for \"CI-red on main: build_2 broke\", and that summaryTokens of \"a an to of\" has size 0."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-defect-evidence-merge.test.ts, a new test file of at most 50 lines that imports only vitest and src/defect/signal.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/defect/signal.ts", "tests/pin-defect-evidence-merge.test.ts"]
  - id: pin-notes-entry-ranges
    title: Pin how the notes file is split into entries for lesson capture, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how the notes file is split into entries for lesson capture, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-notes-entry-ranges
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "noteEntryRanges and noteEntries (src/learning/lessons.ts:346-356) split the notes file into the entries arcadia learn imports and restores (commands/learn.ts:74, 97, 122-123), and no test file names either, so the cache-heading exclusion and offsets are pinned only via learn flows."
    acceptance_criteria:
      - "tests/pin-notes-entry-ranges.test.ts is a new test file that imports noteEntryRanges and noteEntries from ../src/learning/lessons.js (lines 346-356) and asserts that for the text made of the lines # Notes, a blank line, Intro, a blank line, ## First entry, body one, a blank line, ## How the cache works, cache text, a blank line, ## Second, body two, ### sub and more, each ending in a newline, noteEntryRanges returns exactly two entries: the first starts at 16 and ends at 76 and its text runs from ## First entry through the cache text line and its following blank line (the How the cache works heading starts no entry), and the second starts at 76, ends at 108 and its text runs from ## Second to the end, keeping the ### sub line."
      - "The same test file asserts noteEntries returns [\"## x\\n\"] for the text \"##  \\n## x\\n\" (the line ## followed by two spaces is a blank heading and is dropped), returns [] for \"no headings\", and that noteEntryRanges returns [] for a ## a line that starts with a space."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-notes-entry-ranges.test.ts, a new test file of at most 50 lines that imports only vitest and src/learning/lessons.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/learning/lessons.ts", "tests/pin-notes-entry-ranges.test.ts"]
  - id: pin-review-item-work-kind
    title: Pin how the timeline names the kind of work a review item asks for, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how the timeline names the kind of work a review item asks for, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-review-item-work-kind
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "workKindForReviewItem (src/timeline/classify.ts:152-156) labels each review-item row in the timeline's Decisions collector (timeline/collectors/decisions.ts:53), and no test file names it, so its leading-word and word-boundary rules are pinned only via collected rows."
    acceptance_criteria:
      - "tests/pin-review-item-work-kind.test.ts is a new test file that imports workKindForReviewItem from ../src/timeline/classify.js (lines 152-156) and asserts it returns { workKind: \"verify\", provenance: \"review item asks a QA verdict\" } for \"QA pass or fail for PR 12\" and for \"qa FAIL on head\", and { workKind: \"review\", provenance: \"review item asks a code-review verdict\" } for \"Code review verdict\"."
      - "The same test file asserts it returns { workKind: \"govern\", provenance: \"review item is an approval gate\" } for \"QA passed\", \"QA\", \"code reviewer\", \"Review the code\", \"Approve the release\" and \"\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-review-item-work-kind.test.ts, a new test file of at most 50 lines that imports only vitest and src/timeline/classify.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/timeline/classify.ts", "tests/pin-review-item-work-kind.test.ts"]
  - id: pin-execution-tier-stronger-of
    title: Pin that the execution tier floor helpers return the stronger of two capability tiers or reasoning efforts, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that the execution tier floor helpers return the stronger of two capability tiers or reasoning efforts, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-execution-tier-stronger-of
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126
    why: "minimumCapability and minimumEffort (src/execution/profiles.ts:314-323) raise an execution requirement to a floor during escalation (profiles.ts:354-361), and no test file names either, so that each returns the higher-ranked value despite its name is pinned only indirectly."
    acceptance_criteria:
      - tests/pin-execution-tier-stronger-of.test.ts is a new test file that imports minimumCapability and minimumEffort from ../src/execution/profiles.js (lines 314-323) and asserts minimumCapability returns "c3_systems" for ("c1_bounded", "c3_systems"), "c4_critical" for ("c4_critical", "c2_integrated") and "c2_integrated" for ("c2_integrated", "c2_integrated").
      - The same test file asserts minimumEffort returns "e2_standard" for ("e2_standard", "e1_brief"), "e4_rigorous" for ("e1_brief", "e4_rigorous") and "e3_deep" for ("e3_deep", "e3_deep").
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-execution-tier-stronger-of.test.ts, a new test file of at most 50 lines that imports only vitest and src/execution/profiles.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/execution/profiles.ts", "tests/pin-execution-tier-stronger-of.test.ts"]
questions: []
decisions: []
current_action: pin-github-repository-url-check
recommended_model: heavy
recommended_reasoning_effort: high
---

# Track 5 standby test pins 20261126

Created as an inactive draft from accepted Agent Ask rowan-g10-plan-track-5-standby-test-pins-20261126; creation changed no pointer. Current activation is recorded in frontmatter.
