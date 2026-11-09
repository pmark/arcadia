---
arcadia: v1
type: plan
slug: record-run-unattended-test-pins-20261107-part-2
project: arcadia
status: active
milestone: Record run unattended test pins 20261107 part 2
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-09
actions:
  - id: pin-reasoning-effort-mapping
    title: Pin that stored effort keys map to the native Claude and Codex reasoning effort values and unknown keys pass through, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-reasoning-effort-mapping-f0e9121f2879; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-reasoning-effort-mapping
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "claudeReasoningEffort and codexReasoningEffort translate stored effort keys into the values passed to the coding agents, and no test calls either directly, so moving e3_deep from high to xhigh would pass every test today."
    acceptance_criteria:
      - tests/pin-reasoning-effort-mapping.test.ts is a new test file that imports claudeReasoningEffort and codexReasoningEffort from ../src/codingAgents/reasoningEffort.js and asserts both return "low" for "e1_brief", "medium" for "e2_standard", "high" for "e3_deep" and "xhigh" for "e4_rigorous".
      - The same test file asserts both return an unknown key such as "custom" unchanged, and that claudeReasoningEffort("") returns "".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-reasoning-effort-mapping.test.ts, a new test file that imports only vitest and src/codingAgents/reasoningEffort.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-cli-wants-json
    title: Pin that the CLI treats only an exact --json argument as a request for JSON output, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-cli-wants-json-c36363af9626; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-cli-wants-json
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "wantsJson decides whether a command prints JSON or text, and no test calls it directly, so loosening it to a prefix match would pass every test today."
    acceptance_criteria:
      - tests/pin-cli-wants-json.test.ts is a new test file that imports wantsJson from ../src/cli/response.js and asserts wantsJson returns true for ["--json"] and for ["status", "--json", "extra"].
      - The same test file asserts wantsJson returns false for [], ["--jsonx"], ["json"] and ["--json=true"].
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-cli-wants-json.test.ts, a new test file that imports only vitest and src/cli/response.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-requirement-id-format
    title: Pin that a requirement id joins project, plan and Action id with slashes and no normalization, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-requirement-id-format-a2a6c2f5bcfc; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-requirement-id-format
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "requirementIdFor builds the key under which role lineage tracks a requirement, and no test calls it directly, so changing the separator or folding case would silently orphan recorded lineage."
    acceptance_criteria:
      - tests/pin-requirement-id-format.test.ts is a new test file that imports requirementIdFor from ../src/sessions/roleLineage.js and asserts requirementIdFor("arcadia", "my-plan", "do-thing") returns "arcadia/my-plan/do-thing".
      - The same test file asserts requirementIdFor("A", "B c", "D/E") returns "A/B c/D/E".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-requirement-id-format.test.ts, a new test file that imports only vitest and src/sessions/roleLineage.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-doc-ref-builders
    title: Pin the stable plan, proposal and plan-question document reference formats, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-doc-ref-builders-371c65af4a4b; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-doc-ref-builders
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "planDocRef, proposalDocRef and planQuestionDocRef build the external keys document rows are stored under, and no test calls them directly, so a format change would fork every existing row without failing a test."
    acceptance_criteria:
      - tests/pin-doc-ref-builders.test.ts is a new test file that imports planDocRef, proposalDocRef and planQuestionDocRef from ../src/docs/types.js and asserts planDocRef("my-plan") returns "plan/my-plan" and proposalDocRef("my-proposal") returns "proposal/my-proposal".
      - The same test file asserts planQuestionDocRef("my-plan", "q1") returns "plan/my-plan?question=q1".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-doc-ref-builders.test.ts, a new test file that imports only vitest and src/docs/types.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-checks-repair-request-id
    title: Pin that the required-checks repair request id combines the failed Session id and head under a fixed prefix, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-checks-repair-request-id-7cbc78c0fa08; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-checks-repair-request-id
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "requiredChecksRepairRequestId makes the repair row unique per failed Session and exact head, and no test calls it directly, so dropping the head from the id would collapse repairs for different heads without failing a test."
    acceptance_criteria:
      - tests/pin-checks-repair-request-id.test.ts is a new test file that imports requiredChecksRepairRequestId from ../src/sessions/reviewRepair.js and asserts requiredChecksRepairRequestId("session-1", "abc123") returns "worker-tick-checks-repair-session-1-abc123".
      - The same test file asserts requiredChecksRepairRequestId("s", "h2") and requiredChecksRepairRequestId("t", "h1") each differ from requiredChecksRepairRequestId("s", "h1").
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-checks-repair-request-id.test.ts, a new test file that imports only vitest and src/sessions/reviewRepair.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-handoff-request-prefix
    title: Pin that the handoff request prefix lowercases the work item id and dashes every run of other characters, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-handoff-request-prefix-e1e85bfdd007; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-handoff-request-prefix
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "handoffRequestPrefix names every handoff request id for one Action, and no test calls it directly, so a change to its normalization would split one Action's handoffs across prefixes."
    acceptance_criteria:
      - tests/pin-handoff-request-prefix.test.ts is a new test file that imports handoffRequestPrefix from ../src/clarify/handoff.js and asserts handoffRequestPrefix("Arcadia/Pin_X  Y") returns "handoff-arcadia-pin-x-y-".
      - The same test file asserts handoffRequestPrefix("pin-x") returns "handoff-pin-x-".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-handoff-request-prefix.test.ts, a new test file that imports only vitest and src/clarify/handoff.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-review-response-normalization
    title: Pin that a review response value is trimmed, lowercased and whitespace-collapsed, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-review-response-normalization-4e9be3cb5f52; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-review-response-normalization
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "normalizeReviewResponseValue is applied before a review verdict is compared, and no test calls it directly, so dropping the lowercasing would reject valid verdicts without failing a test."
    acceptance_criteria:
      - tests/pin-review-response-normalization.test.ts is a new test file that imports normalizeReviewResponseValue from ../src/review/responseParser.js and asserts normalizeReviewResponseValue("  Needs   CHANGES\n now ") returns "needs changes now" and normalizeReviewResponseValue("approved") returns "approved".
      - The same test file asserts normalizeReviewResponseValue(" \t\n ") returns "".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-review-response-normalization.test.ts, a new test file that imports only vitest and src/review/responseParser.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-image-mime-extension
    title: Pin the image MIME type to file extension mapping and its bin fallback, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-image-mime-extension-05a68a019dd2; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-image-mime-extension
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "mimeTypeToExtension picks the extension an artifact image is stored under, and no test calls it directly, so changing jpg to jpeg or making the match case-insensitive would pass every test today."
    acceptance_criteria:
      - tests/pin-image-mime-extension.test.ts is a new test file that imports mimeTypeToExtension from ../src/intelligence/artifacts/imageMeta.js and asserts mimeTypeToExtension returns "png" for "image/png", "jpg" for "image/jpeg", "gif" for "image/gif" and "webp" for "image/webp".
      - The same test file asserts mimeTypeToExtension returns "bin" for "image/svg+xml", for "IMAGE/PNG" and for "".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-image-mime-extension.test.ts, a new test file that imports only vitest and src/intelligence/artifacts/imageMeta.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-authoritative-control-path
    title: Pin which relative paths count as authoritative control records, with a new test file.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-authoritative-control-path-4030e5f79871; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-authoritative-control-path
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "isAuthoritativeControlPath decides which records can govern dispatch, and no test calls it directly, so widening it to any docs path would let a supporting record's defect hide an active pointer without failing a test."
    acceptance_criteria:
      - tests/pin-authoritative-control-path.test.ts is a new test file that imports isAuthoritativeControlPath from ../src/docs/discover.js and asserts isAuthoritativeControlPath returns true for "PROJECT.md", "docs/plans/my-plan.md", "docs/decisions/0001-x.md" and the backslash form "docs\\plans\\my-plan.md".
      - The same test file asserts isAuthoritativeControlPath returns false for "docs/notes.md", "docs/plan/x.md", "project.md" and "sub/PROJECT.md".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-authoritative-control-path.test.ts, a new test file that imports only vitest and src/docs/discover.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-stable-proposal-id
    title: Pin that a stable proposal id is agentask_ followed by the first 18 fingerprint characters, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that a stable proposal id is agentask_ followed by the first 18 fingerprint characters, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-stable-proposal-id
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "stableProposalId derives the id an Agent Ask proposal is stored and settled under, and no test calls it directly, so changing the prefix length would orphan every pending proposal without failing a test."
    acceptance_criteria:
      - tests/pin-stable-proposal-id.test.ts is a new test file that imports stableProposalId from ../src/ask/agentAsk.js and asserts stableProposalId("abcdefghijklmnopqrstuvwxyz") returns "agentask_abcdefghijklmnopqr".
      - The same test file asserts stableProposalId("abc") returns "agentask_abc" and stableProposalId("") returns "agentask_".
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-stable-proposal-id.test.ts, a new test file that imports only vitest and src/ask/agentAsk.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-north-star-step-reasons
    title: "Pin the North Star step reason helpers: gate and remainder prefixes and the one-line 300-character cut, with a new test file."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin the North Star step reason helpers: gate and remainder prefixes and the one-line 300-character cut, with a new test file."
    expected_artifact: Evidence satisfying Agent Ask pin-north-star-step-reasons
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "completesGate, remainderOf and oneLineReason shape the reason printed beside every North Star step, and no test calls them directly, so a change to the cut length or ellipsis would pass every test today."
    acceptance_criteria:
      - "tests/pin-north-star-step-reasons.test.ts is a new test file that imports STEP_REASON_MAX_LENGTH, completesGate, oneLineReason and remainderOf from ../src/northStar/stepReason.js and asserts completesGate(\"G1 ready\") returns \"Completes gate: G1 ready\" and remainderOf(\"Build it\") returns \"Remainder of Build it\"."
      - The same test file asserts oneLineReason("  first\n  second\t\tthird  ") returns "first second third", that a string of exactly STEP_REASON_MAX_LENGTH "a" characters is returned unchanged, and that a string of STEP_REASON_MAX_LENGTH + 1 "a" characters returns a string of length STEP_REASON_MAX_LENGTH that ends with the ellipsis character \u2026.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-north-star-step-reasons.test.ts, a new test file that imports only vitest and src/northStar/stepReason.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-milestone-and-log-doc-refs
    title: Pin the plan milestone and Log entry document reference formats, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the plan milestone and Log entry document reference formats, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-milestone-and-log-doc-refs
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "planMilestoneDocRef and logEntryDocRef build the keys that stop retitled milestones and same-day Log entries from forking or colliding, and no test calls them directly, so a change to either format would pass every test today."
    acceptance_criteria:
      - "tests/pin-milestone-and-log-doc-refs.test.ts is a new test file that imports planMilestoneDocRef and logEntryDocRef from ../src/docs/types.js and asserts planMilestoneDocRef(\"my-plan\", \"Ship It: v2!\") returns \"plan/my-plan?milestone=ship-it-v2\" and planMilestoneDocRef(\"my-plan\", \"!!!\") returns \"plan/my-plan?milestone=milestone\"."
      - "The same test file asserts logEntryDocRef(\"mission\", \"2026-07-25\", \"Hello, World\") returns \"log/mission#2026-07-25--hello-world\" and that logEntryDocRef(\"mission\", \"2026-07-25\", \"First\") differs from logEntryDocRef(\"mission\", \"2026-07-25\", \"Second\")."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-milestone-and-log-doc-refs.test.ts, a new test file that imports only vitest and src/docs/types.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-yaml-scalar-quoting
    title: Pin that a frontmatter YAML scalar is JSON-quoted only when a colon, hash or leading indicator would change its meaning, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that a frontmatter YAML scalar is JSON-quoted only when a colon, hash or leading indicator would change its meaning, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-yaml-scalar-quoting
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "yamlScalar keeps generated frontmatter parseable, and no test calls it directly, so quoting every value or never quoting a colon would pass every test until a document failed to parse."
    acceptance_criteria:
      - tests/pin-yaml-scalar-quoting.test.ts is a new test file that imports yamlScalar from ../src/docs/frontmatter.js and asserts yamlScalar("  plain value  ") returns "plain value" and yamlScalar("a-b") returns "a-b".
      - "The same test file asserts yamlScalar(\"Question: why?\") returns the JSON-quoted text \"Question: why?\" including its double quotes, and yamlScalar(\"issue #12\") returns the JSON-quoted text \"issue #12\" including its double quotes."
      - The same test file asserts yamlScalar("- item"), yamlScalar("*bold") and yamlScalar("'quoted'") are each returned wrapped in double quotes.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-yaml-scalar-quoting.test.ts, a new test file that imports only vitest and src/docs/frontmatter.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-launch-agent-workspace-arg
    title: Pin that a launch agent's workspace is the value following a --workspace argument and is null otherwise, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that a launch agent's workspace is the value following a --workspace argument and is null otherwise, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-launch-agent-workspace-arg
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "launchAgentWorkspace groups launchd agents by the workspace they serve, and no test calls it directly, so accepting the --workspace=path form or a flag as a value would pass every test today."
    acceptance_criteria:
      - tests/pin-launch-agent-workspace-arg.test.ts is a new test file that imports launchAgentWorkspace from ../src/runtime/launchAgents.js and asserts launchAgentWorkspace(["node", "arcadia", "worker", "--workspace", "/w/one"]) returns "/w/one".
      - The same test file asserts launchAgentWorkspace returns null for ["node", "arcadia"], for ["--workspace"], for ["--workspace", "--other", "/w"], for ["--workspace", ""] and for ["--workspace=/w/one"].
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-launch-agent-workspace-arg.test.ts, a new test file that imports only vitest and src/runtime/launchAgents.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-lesson-keywords
    title: Pin that lesson keywords are lowercase alphanumeric words of at least three characters, de-duplicated in order and capped at 32, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that lesson keywords are lowercase alphanumeric words of at least three characters, de-duplicated in order and capped at 32, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-lesson-keywords
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "lessonKeywords feeds lesson retrieval, and no test calls it directly, so changing the minimum length, the order or the cap would pass every test today."
    acceptance_criteria:
      - tests/pin-lesson-keywords.test.ts is a new test file that imports lessonKeywords from ../src/learning/lessons.js and asserts lessonKeywords("Fix the CLI-Retry, a b of 42!") equals ["fix", "the", "cli", "retry"] and lessonKeywords("beta alpha beta ALPHA gamma") equals ["beta", "alpha", "gamma"].
      - The same test file asserts that for forty distinct words word0 through word39 joined by spaces, lessonKeywords returns 32 keywords starting with "word0" and ending with "word31", and that lessonKeywords("a b -- !") equals [].
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-lesson-keywords.test.ts, a new test file that imports only vitest and src/learning/lessons.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-cloudflare-worker-name
    title: Pin how a Project slug becomes a Cloudflare Worker name, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin how a Project slug becomes a Cloudflare Worker name, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-cloudflare-worker-name
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "cloudflareWorkerName derives the name a staging Worker is deployed under, and no test calls it directly, so changing the 54-character cap or the dash handling would rename deployments without failing a test."
    acceptance_criteria:
      - tests/pin-cloudflare-worker-name.test.ts is a new test file that imports cloudflareWorkerName from ../src/projects/stagingDeployment.js and asserts cloudflareWorkerName("My Field_Notes!!") returns "my-field-notes", cloudflareWorkerName("--abc--") returns "abc" and cloudflareWorkerName of 60 "a" characters returns 54 "a" characters.
      - The same test file asserts cloudflareWorkerName("!!!") and cloudflareWorkerName("") each throw an error containing Project name cannot be converted to a Cloudflare Worker name.
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-cloudflare-worker-name.test.ts, a new test file that imports only vitest and src/projects/stagingDeployment.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-liveness-duration-format
    title: Pin the production liveness duration format and the stale episode key, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin the production liveness duration format and the stale episode key, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-liveness-duration-format
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "formatDuration and staleEpisodeKey word the liveness alert and let the outbox recognise a retry of it, and no test calls them directly, so a rounding or unit change would pass every test today."
    acceptance_criteria:
      - tests/pin-liveness-duration-format.test.ts is a new test file that imports formatDuration and staleEpisodeKey from ../src/commands/productionLiveness.js and asserts formatDuration returns "0s" for 0, "1s" for 1499, "59s" for 59000, "1m 0s" for 60000, "2m 5s" for 125000 and "59m 59s" for 3599000.
      - "The same test file asserts formatDuration returns \"1h 0m\" for 3600000 and \"1h 2m\" for 3725000, and that staleEpisodeKey(Date.UTC(2026, 10, 7, 12, 30, 0)) returns \"since 2026-11-07T12:30:00.000Z\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-liveness-duration-format.test.ts, a new test file that imports only vitest and src/commands/productionLiveness.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-repository-frame-extraction
    title: "Pin that the first repository stack frame is the first tests, src or scripts file:line, with a new test file."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin that the first repository stack frame is the first tests, src or scripts file:line, with a new test file."
    expected_artifact: Evidence satisfying Agent Ask pin-repository-frame-extraction
    clarification: clarified
    confidence: high
    source: Agent Ask amend-pin-repository-frame-extraction-acceptance-wording-20261107
    why: "firstRepositoryFrame labels soak failures by where they happened, and no test calls it directly, so matching node_modules frames or dropping the column handling would pass every test today."
    acceptance_criteria:
      - "tests/pin-repository-frame-extraction.test.ts is a new test file that imports firstRepositoryFrame from ../src/soak/rehearsalSoak.js and asserts firstRepositoryFrame returns \"src/foo/bar.ts:12\" for a stack whose frames are, in order, node_modules/x/index.js:5:1, src/foo/bar.ts:12:3 and a frame in a file under tests/ whose name ends in .test.ts, at line 7, column 1."
      - "The same test file asserts firstRepositoryFrame(\"at scripts/run.mjs:9:2\") returns \"scripts/run.mjs:9\" and for a stack whose only frame is at line 3, column 1 of a file under tests/ whose name ends in .test.ts, it returns that same path followed by :3."
      - "The same test file asserts firstRepositoryFrame returns null for \"Error: no frames here\", for \"at node_modules/x/index.js:5:1\" and for \"\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-repository-frame-extraction.test.ts, a new test file that imports only vitest and src/soak/rehearsalSoak.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-defect-summary-similarity
    title: Pin that defect summary similarity is the Jaccard ratio of significant words and 0 when a side has none, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that defect summary similarity is the Jaccard ratio of significant words and 0 when a side has none, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-defect-summary-similarity
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "summarySimilarity decides whether two defect reports are near-duplicates, and no test calls it directly, so changing the stop words, the length floor or the ratio would pass every test today."
    acceptance_criteria:
      - tests/pin-defect-summary-similarity.test.ts is a new test file that imports summarySimilarity from ../src/defect/signal.js and asserts summarySimilarity("Login FAILS on retry", "login  fails retry") returns 1, summarySimilarity("alpha beta gamma", "alpha beta delta") returns 0.5 and summarySimilarity("alpha beta", "gamma delta") returns 0.
      - The same test file asserts summarySimilarity returns 0 for ("the and", "alpha"), ("alpha", "") and ("", "").
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-defect-summary-similarity.test.ts, a new test file that imports only vitest and src/defect/signal.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
  - id: pin-inline-text-escaping
    title: Pin that governed prose is rendered inline with Markdown, entities and @ escaped, with a new test file.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Pin that governed prose is rendered inline with Markdown, entities and @ escaped, with a new test file.
    expected_artifact: Evidence satisfying Agent Ask pin-inline-text-escaping
    clarification: clarified
    confidence: high
    source: Agent Ask amend-record-run-test-pins-part-2-execution-build-20261107
    why: "inlineText keeps a criterion from becoming Markdown block syntax or notifying a GitHub user inside the operator QA plan, and no test calls it directly, so dropping one escape would pass every test today."
    acceptance_criteria:
      - tests/pin-inline-text-escaping.test.ts is a new test file that imports inlineText from ../src/sessions/operatorQaPlan.js and asserts inlineText applied to the text of one, two and three separated by a newline, a tab, runs of spaces and a BEL control character (code point 7), with leading and trailing spaces, returns "one two three".
      - The same test file asserts inlineText inserts a backslash before each of the characters * _ ` [ ] < > | ~ and the backslash itself, using the single input a*b_c`d[e]<f>|g~h\i whose expected output is a\*b\_c\`d\[e\]\<f\>\|g\~h\\i.
      - "The same test file asserts inlineText(\"&amp; &#38; AT&T\") returns \"\\&amp; \\&#38; AT&T\" (only an ampersand that starts an entity is escaped) and that inlineText(\"@octocat\") returns \"@\" followed by a zero-width space (code point U+200B) and \"octocat\"."
      - No src/ change is made to make the test pass; if current behaviour differs from these assertions, the Session reports the mismatch instead of changing src/.
      - Apart from the settlement records Arcadia writes, the change touches only tests/pin-inline-text-escaping.test.ts, a new test file that imports only vitest and src/sessions/operatorQaPlan.ts; no src/, tests/helpers/, tests/fixtures/ or other test file changes, and the test needs no network, timer, child process, database or live service. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
current_action: pin-stable-proposal-id
recommended_model: standard
recommended_reasoning_effort: medium
---

# Record run unattended test pins 20261107 part 2

Created as an inactive draft from accepted Agent Ask plan-record-run-unattended-test-pins-part-2-20261107; creation changed no pointer. Current activation is recorded in frontmatter.
