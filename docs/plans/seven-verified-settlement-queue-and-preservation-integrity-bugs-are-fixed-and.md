---
arcadia: v1
type: plan
slug: seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and
project: arcadia
status: draft
milestone: Seven verified settlement, queue and preservation-integrity bugs are fixed and merged to main, one Action per merged PR, each with its regression test and a passing fast-rehearsal.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-11
actions:
  - id: keep-claim-when-passed-attempt-receipt-is-unparseable
    title: Keep a superseded candidate claim when a passed development attempt receipt cannot be parsed, so the Action is not handed to a second agent.
    status: open
    responsibility: agent
    effort: session
    next_action: Keep a superseded candidate claim when a passed development attempt receipt cannot be parsed, so the Action is not handed to a second agent.
    expected_artifact: Evidence satisfying Agent Ask keep-claim-when-passed-attempt-receipt-is-unparseable
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bug-burndown-plan-after-review-2026-10-10-r2
    why: "A malformed receipt currently lets the claim release and can launch a duplicate session for an Action that already has a passed candidate."
    acceptance_criteria:
      - With a passed development row whose terminal receipt JSON is malformed plus a superseded row, developedForSupersededInput returns false and the claim is not released.
      - With only well-formed superseded rows it still returns true and releases the claim.
      - A focused regression test for the malformed-receipt case exists, and tests/rehearsal-attempt-lineage.test.ts, tests/production-tick.test.ts and pnpm fast-rehearsal pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/960"]
  - id: settle-superseded-decision-ask-rejection
    title: Match a Decision own Agent Ask by exact token so rejecting a superseded Ask is not refused as already written.
    status: open
    responsibility: agent
    effort: session
    next_action: Match a Decision own Agent Ask by exact token so rejecting a superseded Ask is not refused as already written.
    expected_artifact: Evidence satisfying Agent Ask settle-superseded-decision-ask-rejection
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bug-burndown-plan-after-review-2026-10-10-r2
    why: "Six superseded Decision rejections are stuck behind a substring match, which also threatens any Ask whose id prefixes another."
    acceptance_criteria:
      - With an accepted <id>-r3 Decision on disk, rejecting the original Ask <id> applies without the already-wrote refusal.
      - A genuine prior commit of the same Ask id is still refused (the existing already-wrote test passes).
      - An Ask id that is a prefix of another no longer matches the other Ask Decision document, with a regression test.
      - pnpm fast-rehearsal passes with the change.
    depends_on: [keep-claim-when-passed-attempt-receipt-is-unparseable]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1173"]
  - id: amend-action-consumes-block-scalar-and-literal-ids
    title: Make amendAction consume a block-scalar next_action and write instructions and request ids literally in every settlement writer.
    status: open
    responsibility: agent
    effort: session
    next_action: Make amendAction consume a block-scalar next_action and write instructions and request ids literally in every settlement writer.
    expected_artifact: Evidence satisfying Agent Ask amend-action-consumes-block-scalar-and-literal-ids
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bug-burndown-plan-after-review-2026-10-10-r2
    why: "Amendment can show an agent old and new instruction text concatenated, and a request id with replacement patterns can garble a Plan."
    acceptance_criteria:
      - Amending an Action whose next_action is a literal or folded block scalar yields a parsed nextAction exactly equal to the requested text, on the Action-amend and Plan-amend paths.
      - An instruction or request id that contains a dollar sign followed by an ampersand, a backtick or an apostrophe is written literally by amendAction, setActionDependsOn, recordSplitInto and replaceTopLevelField.
      - A split Ask whose request_id contains a dollar sign followed by an ampersand leaves the Plan valid with only the intended fields changed (regression test).
      - Other fields, other Actions, refusals and idempotency are unchanged; the agent-ask settlement, split and complete test files and pnpm fast-rehearsal pass.
    depends_on: [settle-superseded-decision-ask-rejection]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1031", "https://github.com/pmark/arcadia/issues/1213"]
  - id: keep-queue-positions-of-projects-not-visible-at-arrange
    title: Keep the queue positions of Projects that are not visible when a queue is arranged, instead of silently deleting them.
    status: open
    responsibility: agent
    effort: session
    next_action: Keep the queue positions of Projects that are not visible when a queue is arranged, instead of silently deleting them.
    expected_artifact: Evidence satisfying Agent Ask keep-queue-positions-of-projects-not-visible-at-arrange
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bug-burndown-plan-after-review-2026-10-10-r2
    why: "A transient blocker on one Project can erase another Project order, leaving orderValid false and every make-next refused."
    acceptance_criteria:
      - arrangeActionOrder and moveActionOrder keep every position row for a key absent from currentKeys unless the caller names that key as retired (done or dropped); the PR states how callers pass retired keys.
      - A settlement-time arrange while another Project is transiently blocked leaves that Project positions intact (regression test).
      - A key the caller names as retired, as the scheduler does for done Actions, is still removed, and undo restores the full position table from the receipt.
      - The receipt records the full position table before and after; the action-order and settlement tests and pnpm fast-rehearsal pass.
    depends_on: [amend-action-consumes-block-scalar-and-literal-ids]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1022"]
  - id: refuse-hidden-renames-in-committed-completion-replay
    title: Harden recordCommittedCompletionSettlement against renames into .arcadia/asks and clean up its scratch directory on timeout.
    status: open
    responsibility: agent
    effort: session
    next_action: Harden recordCommittedCompletionSettlement against renames into .arcadia/asks and clean up its scratch directory on timeout.
    expected_artifact: Evidence satisfying Agent Ask refuse-hidden-renames-in-committed-completion-replay
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bug-burndown-plan-after-review-2026-10-10-r2
    why: "The deterministic completion proof can be passed by a candidate that hides the deletion of a governed record behind a rename."
    acceptance_criteria:
      - A candidate HEAD that renames a governed document into .arcadia/asks/ is refused by recordCommittedCompletionSettlement.
      - A commit that only adds .arcadia/asks/archive/agent-ask-<requestId>.yaml and removes .arcadia/asks/agent-ask-<requestId>.yaml is still recorded; an archive under any other name is refused, and the PR says so.
      - A forced source-control timeout inside the replay leaves no arcadia-settlement-replay-* scratch directory.
      - pnpm fast-rehearsal passes with the change.
    depends_on: [keep-queue-positions-of-projects-not-visible-at-arrange]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1011"]
  - id: allocate-decision-numbers-from-origin-and-refuse-duplicates
    title: Allocate Decision numbers from the local documents plus origin/main and refuse a new duplicate number, grandfathering the four existing pairs.
    status: open
    responsibility: agent
    effort: session
    next_action: Allocate Decision numbers from the local documents plus origin/main and refuse a new duplicate number, grandfathering the four existing pairs.
    expected_artifact: Evidence satisfying Agent Ask allocate-decision-numbers-from-origin-and-refuse-duplicates
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bug-burndown-plan-after-review-2026-10-10-r2
    why: "Parallel sessions allocate the same Decision number, so a bare Decision citation can resolve to the wrong authority record."
    acceptance_criteria:
      - With origin/main holding Decision 0100 and a worktree whose documents stop at 0099, settlement and arcadia decision new both allocate 0101; offline they fall back to the local maximum with a warning.
      - A new Decision file that duplicates an existing number outside the grandfathered pairs 0004, 0005, 0079 and 0100 fails a check that runs in pnpm lint, so CI catches two unmerged branches that allocated the same number when the second one runs; the PR states the residual race because branch protection is not strict.
      - The existing pairs and slug-based Decision lookup are unchanged and the settlement, decision and docs-sync tests and pnpm fast-rehearsal pass.
      - Renumbering the live second 0100 is not part of this Action and stays an operator-governed step.
    depends_on: [refuse-hidden-renames-in-committed-completion-replay]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1187", "https://github.com/pmark/arcadia/issues/1176"]
  - id: write-yaml-scalars-that-round-trip-as-strings
    title: Quote YAML scalars written by settlement and decision commands whenever the plain form would not parse back as the identical string.
    status: open
    responsibility: agent
    effort: session
    next_action: Quote YAML scalars written by settlement and decision commands whenever the plain form would not parse back as the identical string.
    expected_artifact: Evidence satisfying Agent Ask write-yaml-scalars-that-round-trip-as-strings
    clarification: clarified
    confidence: high
    source: Agent Ask plan-arcadia-loop-integrity-bug-burndown-2026-10-10
    why: "A title or criterion such as true or [x] done silently becomes a boolean or list in a validated Plan, and unattended agents will not notice."
    acceptance_criteria:
      - Titles, next_action, acceptance criteria, source and Decision question, recommendation and options written by settlement and the decision commands round-trip as the identical string for the values true, null, 123, [x] done and {a}.
      - Ordinary prose and previously quoted values keep their current rendering (existing snapshot assertions pass).
      - The ask, decision and project test suites and pnpm fast-rehearsal pass.
    depends_on: [allocate-decision-numbers-from-origin-and-refuse-duplicates]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1160"]
questions: []
decisions: []
---

# Seven verified settlement, queue and preservation-integrity bugs are fixed and merged to main, one Action per merged PR, each with its regression test and a passing fast-rehearsal.

Created as an inactive draft from accepted Agent Ask plan-arcadia-loop-integrity-bug-burndown-2026-10-10; creation changed no pointer. Current activation is recorded in frontmatter.
