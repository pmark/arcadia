---
arcadia: v1
type: plan
slug: batch-1-of-2-three-independent-verified-bug-fix-actions-from-issues-1731-1976
project: arcadia
status: draft
milestone: "Batch 1 of 2: three independent, verified bug-fix Actions from Issues #1731, #1976 and #1765, proposed as an inactive draft Plan for operator acceptance under Decision 0226."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-13
actions:
  - id: quote-bracket-prefixed-criteria-in-settled-plan
    title: "Make the Agent Ask Plan writer in src/ask/settlement.ts double-quote an acceptance criterion or title that begins with [ or { so the settled Plan re-parses to the exact text, fixing Issue #1731."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the Agent Ask Plan writer in src/ask/settlement.ts double-quote an acceptance criterion or title that begins with [ or { so the settled Plan re-parses to the exact text, fixing Issue #1731."
    expected_artifact: Evidence satisfying Agent Ask quote-bracket-prefixed-criteria-in-settled-plan
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-1-20261113
    why: "A criterion beginning with the text [ENTRY] fails YAML parse, so an accepted Plan Ask refuses with Agent Ask resulting Plan failed validation and no Plan is written."
    acceptance_criteria:
      - A regression test in tests/agent-ask-settlement.test.ts settles a Plan Ask whose Action acceptance begins with the text [ENTRY] A focused integration test and asserts the written Plan parses and its acceptance equals that text verbatim; it fails before the fix and passes after.
      - The same test covers a title or next_action beginning with { and a criterion beginning with [x] done, and each round-trips verbatim.
      - Plan output for criteria that do not begin with [ or { is byte-identical to the current writer, and every other test in tests/agent-ask-settlement.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/ask/settlement.ts and tests/agent-ask-settlement.test.ts. Proof that tests, lint and tsc pass comes from required CI on the pull request head.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1731", "src/ask/settlement.ts", "src/docs/frontmatter.ts"]
  - id: classify-subjectless-implementation-claims-in-planning-validator
    title: "Make the planning artifact validator in src/stewardship/artifactValidator.ts flag the three residual implementation-claim bypasses, fixing Issue #1976."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the planning artifact validator in src/stewardship/artifactValidator.ts flag the three residual implementation-claim bypasses, fixing Issue #1976."
    expected_artifact: Evidence satisfying Agent Ask classify-subjectless-implementation-claims-in-planning-validator
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-1-20261113
    why: "Three phrasings that claim implementation pass the planning validator on main although the same claims are refused on the reviewed branch."
    acceptance_criteria:
      - A regression test in tests/planning-artifact-validator.test.ts asserts that each of I modified no tests but did modify src/cli.ts, I changed no files save src/cli.ts, and I updated the plan file at plans/../src/cli.ts is flagged as an implementation claim; each fails before the fix and passes after.
      - The sentence besides that I patched src/a.ts is still not flagged, as its test asserts unchanged behaviour, and every other test in tests/planning-artifact-validator.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/stewardship/artifactValidator.ts and tests/planning-artifact-validator.test.ts. Proof that tests, lint and tsc pass comes from required CI on the pull request head.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1976", "src/stewardship/artifactValidator.ts"]
  - id: report-real-command-timeout-for-criteria-required-lint
    title: "Give criteria-required commands in src/sessions/completionValidation.ts their own bound and make the timeout text name the bound actually applied, fixing Issue #1765."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Give criteria-required commands in src/sessions/completionValidation.ts their own bound and make the timeout text name the bound actually applied, fixing Issue #1765."
    expected_artifact: Evidence satisfying Agent Ask report-real-command-timeout-for-criteria-required-lint
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-1-20261113
    why: "Required pnpm lint runs under a 120-second per-command cap while the timeout message reports the 900-second total, so a valid lint that takes 127 seconds is refused as a validation timeout."
    acceptance_criteria:
      - A regression test in tests/completion-validation.test.ts, using the existing runner seam or a new injected timeout parameter, asserts that a criteria-required command gets the required-command bound and that a timeout reports the bound it actually hit; it fails before the fix and passes after.
      - Commands that are not criteria-required keep COMPLETION_COMMAND_TIMEOUT_MS, and every other test in tests/completion-validation.test.ts, tests/completion-validation-evidence.test.ts and tests/completion-validation-supplement.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/sessions/completionValidation.ts and tests/completion-validation.test.ts. Proof that tests, lint and tsc pass comes from required CI on the pull request head.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1765", "src/sessions/completionValidation.ts"]
questions: []
decisions: []
---

# Batch 1 of 2: three independent, verified bug-fix Actions from Issues #1731, #1976 and #1765, proposed as an inactive draft Plan for operator acceptance under Decision 0226.

Created as an inactive draft from accepted Agent Ask ellis-batch-1-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
