---
arcadia: v1
type: plan
slug: track-7-standby-test-pins-20261127
project: arcadia
status: draft
milestone: Track 7 standby test pins 20261127
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-28
actions:
  - id: pin-local-date-parts
    title: Pin how a Date is split into zero-padded local year, month and day strings, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how a Date is split into zero-padded local year, month and day strings, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-local-date-parts
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-amend-track-7-review-r1b-20261127
    why: "localDateParts (src/utils/time.ts:5-11) supplies the local date that localDateStamp (time.ts:13-16), the Mission Log path (markdown/missionLog.ts:16) and experiment brief dates use, and no test file names it, so its padding and local-calendar rule are pinned only indirectly."
    acceptance_criteria:
      - "tests/pin-local-date-parts.test.ts is a new test file that imports localDateParts from ../src/utils/time.js (lines 5-11) and asserts it returns { year: \"2026\", month: \"11\", day: \"07\" } for the local Date new Date(2026, 10, 7, 9, 5) and { year: \"2026\", month: \"01\", day: \"31\" } for new Date(2026, 0, 31, 23, 59), each built with the local-time Date constructor, never an ISO string."
      - "The same test file asserts it returns { year: \"2026\", month: \"12\", day: \"31\" } for the local Date new Date(2026, 11, 31, 12)."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-local-date-parts.test.ts, a new test file of at most 50 lines that imports only vitest and src/utils/time.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/utils/time.ts", "tests/pin-local-date-parts.test.ts"]
  - id: pin-timeline-actor-label
    title: Pin how a timeline actor is labelled and how the timeline source footer is worded, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how a timeline actor is labelled and how the timeline source footer is worded, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-timeline-actor-label
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-plan-track-7-standby-test-pins-20261127
    why: "actorLabel (src/timeline/render.ts:15-20) prefixes each timeline line's actor, marking low-confidence named actors with a question mark, and renderSources (render.ts:28-33) writes the source footer of commands/timeline.ts:123; no test file names either, so both are pinned only indirectly."
    acceptance_criteria:
      - tests/pin-timeline-actor-label.test.ts is a new test file that imports actorLabel and renderSources from ../src/timeline/render.js (lines 15-20 and 28-33) and asserts actorLabel returns "codex\u00b7gamma?" (U+00B7 middle dot) for tool codex, name gamma and confidence low, "claude" for tool claude with no name and confidence high, "unknown" for tool unknown with confidence low, and "opencode\u00b7beta" for tool opencode, name beta and confidence high.
      - The same test file asserts renderSources returns ["2 sources read in 42 ms; 1 unreadable (shown as source_error)."] for two sources of 40 and 2 ms, one with an error, and ["0 sources read in 0 ms."] for an empty list.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-timeline-actor-label.test.ts, a new test file of at most 50 lines that imports only vitest and src/timeline/render.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/timeline/render.ts", "tests/pin-timeline-actor-label.test.ts"]
  - id: pin-workspace-relative-path
    title: Pin how an absolute path is made relative to the workspace root for recorded evidence paths, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how an absolute path is made relative to the workspace root for recorded evidence paths, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-workspace-relative-path
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-plan-track-7-standby-test-pins-20261127
    why: "toWorkspaceRelativePath (src/workspace/paths.ts:57-59) makes the paths that qa/prReview.ts (lines 659-1836) and commands/run.ts:81 record relative to the workspace, and no test file names it, so its forward-slash, outside-root and root-itself results are pinned only indirectly."
    acceptance_criteria:
      - tests/pin-workspace-relative-path.test.ts is a new test file that imports toWorkspaceRelativePath from ../src/workspace/paths.js (lines 57-59) and asserts it returns "mission_logs/a.md" for root /ws/root and path /ws/root/mission_logs/a.md, and "projects/x/y.md" for root /ws/root/ (trailing slash) and path /ws/root/projects/x/y.md.
      - The same test file asserts it returns "../other/z.md" for root /ws/root and path /ws/other/z.md, and an empty string for root /ws/root and path /ws/root itself.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-workspace-relative-path.test.ts, a new test file of at most 50 lines that imports only vitest and src/workspace/paths.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/workspace/paths.ts", "tests/pin-workspace-relative-path.test.ts"]
  - id: pin-sqlite-error-guards
    title: Pin which SQLite errors are recognised as a native addon ABI mismatch or a workspace write denial, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which SQLite errors are recognised as a native addon ABI mismatch or a workspace write denial, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-sqlite-error-guards
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-plan-track-7-standby-test-pins-20261127
    why: "isSqliteNativeAddonAbiError and isSqliteWorkspaceWriteDeniedError (src/db/nativeAddon.ts:47-49 and 76-78) select the repair message that cli/errors.ts:203 and 212 show, and no test file names either, so their class checks are pinned only through error mapping."
    acceptance_criteria:
      - tests/pin-sqlite-error-guards.test.ts is a new test file that imports SqliteNativeAddonAbiError, SqliteWorkspaceWriteDeniedError, isSqliteNativeAddonAbiError and isSqliteWorkspaceWriteDeniedError from ../src/db/nativeAddon.js (lines 47-49 and 76-78) and asserts isSqliteNativeAddonAbiError is true for a new SqliteNativeAddonAbiError("115", "108", "/bin/node") whose message contains "/bin/node is running Node ABI 115, but better-sqlite3 was built for ABI 108", and false for a plain Error and for null.
      - "The same test file asserts isSqliteWorkspaceWriteDeniedError is true for a new SqliteWorkspaceWriteDeniedError(\"/ws/db.sqlite3\", \"SQLITE_READONLY\") whose message contains \"SQLite could not write to the workspace database: /ws/db.sqlite3 (SQLITE_READONLY).\", and false for an ABI error and for the string \"x\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-sqlite-error-guards.test.ts, a new test file of at most 50 lines that imports only vitest and src/db/nativeAddon.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/db/nativeAddon.ts", "tests/pin-sqlite-error-guards.test.ts"]
  - id: pin-mission-log-markdown
    title: Pin how a Mission Log is rendered to Markdown, its fixed section order and its None and Unassigned fallbacks, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how a Mission Log is rendered to Markdown, its fixed section order and its None and Unassigned fallbacks, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-mission-log-markdown
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-amend-track-7-review-r1b-20261127
    why: "renderMissionLogMarkdown (src/markdown/missionLog.ts:30-62) is the text that writeMissionLogMarkdown (missionLog.ts:68) writes for each Mission Log, and no test file names it, so its section order and fallbacks are pinned only indirectly."
    acceptance_criteria:
      - "tests/pin-mission-log-markdown.test.ts is a new test file that imports renderMissionLogMarkdown from ../src/markdown/missionLog.js (lines 30-62) and, for a log with created_at \"2026-11-27T10:00:00.000Z\", work_performed \"Did A\", result \"Done\", next_action \"Next B\", blockers null and artifact_impact null, project { name: \"Arcadia\" } and milestone null, asserts the output starts with the heading \"# Mission Log: Arcadia\" followed by the Date, Project and \"Milestone: None\" lines, includes the Blockers section reading None, ends with the Artifact Impact section reading None followed by a blank line, and has length 201."
      - "The same test file asserts that with no project the heading reads \"Unassigned\", and that with project null, milestone { title: \"M1\" } and the log fields created_at \"c\", work_performed \"w\", result \"r\", blockers \"bl\", next_action \"n\" and artifact_impact \"ai\", its first five lines are \"# Mission Log: Unassigned\", \"\", \"Date: c\", \"Project: Unassigned\" and \"Milestone: M1\", and its last five lines are \"## Artifact Impact\", \"\", \"ai\", \"\" and \"\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-mission-log-markdown.test.ts, a new test file of at most 50 lines that imports only vitest and src/markdown/missionLog.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/markdown/missionLog.ts", "tests/pin-mission-log-markdown.test.ts"]
  - id: pin-cli-failure-envelope
    title: Pin the failure envelope built from a command name, an Arcadia error and an optional workspace, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the failure envelope built from a command name, an Arcadia error and an optional workspace, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-cli-failure-envelope
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-amend-track-7-review-r1b-20261127
    why: "createFailure (src/cli/response.ts:46-57) builds the --json failure envelope that cli.ts:6054 and 6438 write and the brief broker returns at briefSupervisor.ts:117, and no test file names it, so its field copy and optional workspace are pinned only indirectly."
    acceptance_criteria:
      - "tests/pin-cli-failure-envelope.test.ts is a new test file that imports createFailure from ../src/cli/response.js (lines 46-57) and, with the error given as the plain object { code: \"VALIDATION_ERROR\", message: \"bad input\", exitCode: 2, details: { field: \"x\" } } cast to createFailure's error parameter type (so no other src module is imported) and workspace \"/ws\", asserts it equals { ok: false, command: \"arcadia status\", workspace: \"/ws\", error: { code: \"VALIDATION_ERROR\", message: \"bad input\", details: { field: \"x\" } } }."
      - "The same test file asserts that for the same plain-object error with details {} and no workspace argument the workspace property is undefined and the result equals { ok: false, command: \"arcadia status\", error: { code: \"VALIDATION_ERROR\", message: \"bad input\", details: {} } }."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-cli-failure-envelope.test.ts, a new test file of at most 50 lines that imports only vitest and src/cli/response.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/cli/response.ts", "tests/pin-cli-failure-envelope.test.ts"]
  - id: pin-plan-summary-shape
    title: Pin which values are accepted as a Plan summary of the current schema, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin which values are accepted as a Plan summary of the current schema, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-plan-summary-shape
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-plan-track-7-standby-test-pins-20261127
    why: "isPlanSummary (src/docs/planSummaries.ts:84-90) is the gate comparePlanSummary (planSummaries.ts:110) applies before it judges a summary, and no test file names it, so its schema, blank-text, Action-field and fingerprint rules are pinned only indirectly."
    acceptance_criteria:
      - tests/pin-plan-summary-shape.test.ts is a new test file that imports isPlanSummary from ../src/docs/planSummaries.js (lines 84-90) and asserts it returns true for a complete summary with schema arcadia-plan-summary-v1 and one Action that has id, source_fingerprint, title, why and done_when.
      - The same test file asserts it returns false for a wrong schema, for a title of two spaces, for an Action with only an id, for an empty source_fingerprint, and for null.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-plan-summary-shape.test.ts, a new test file of at most 50 lines that imports only vitest and src/docs/planSummaries.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/docs/planSummaries.ts", "tests/pin-plan-summary-shape.test.ts"]
  - id: pin-experiment-brief-path
    title: Pin the repository-relative path each experiment brief is written to, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the repository-relative path each experiment brief is written to, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-experiment-brief-path
    clarification: clarified
    confidence: high
    source: Agent Ask rowan-g12-amend-track-7-review-r1b-20261127
    why: "buildExperimentBriefRelativePath (src/markdown/experimentBrief.ts:19-31) names every experiment brief that commands/experiment.ts:79 writes, and no test file names it, so its slug and local date stamp are pinned only indirectly."
    acceptance_criteria:
      - "tests/pin-experiment-brief-path.test.ts is a new test file that imports buildExperimentBriefRelativePath from ../src/markdown/experimentBrief.js (lines 19-31) and asserts it returns \"artifacts/experiments/2026-11-27-arcadia-pinned-tests-go-experiment-brief.md\" for project slug arcadia, opportunity \"Pinned Tests: Go!\" and the local Date new Date(2026, 10, 27, 12)."
      - The same test file asserts it returns "artifacts/experiments/2026-01-02-arcadia-x-experiment-brief.md" for opportunity x and the local Date new Date(2026, 0, 2, 0, 30) (local-time constructor, never an ISO string), zero-padding the month and day.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-experiment-brief-path.test.ts, a new test file of at most 50 lines that imports only vitest and src/markdown/experimentBrief.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file passes and lints cleanly comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["src/markdown/experimentBrief.ts", "tests/pin-experiment-brief-path.test.ts"]
questions: []
decisions: []
---

# Track 7 standby test pins 20261127

Created as an inactive draft from accepted Agent Ask rowan-g12-plan-track-7-standby-test-pins-20261127; creation changed no pointer. Current activation is recorded in frontmatter.
