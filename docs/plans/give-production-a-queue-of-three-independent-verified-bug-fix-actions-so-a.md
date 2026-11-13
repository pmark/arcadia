---
arcadia: v1
type: plan
slug: give-production-a-queue-of-three-independent-verified-bug-fix-actions-so-a
project: arcadia
status: draft
milestone: Give production a queue of three independent, verified bug-fix Actions so a serial run has ready work once the housekeeping hold is satisfied.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-13
actions:
  - id: harden-keeper-start-stale-lock-and-checkout-workspace
    title: "Make arcadia keeper start in src/commands/keeper.ts claim a stale lock atomically and refuse a --workspace inside the primary checkout, fixing Issue #2464."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make arcadia keeper start in src/commands/keeper.ts claim a stale lock with a protocol that cannot remove or replace another starter's live lock, and refuse a --workspace inside the primary checkout, fixing Issue #2464."
    expected_artifact: Evidence satisfying Agent Ask harden-keeper-start-stale-lock-and-checkout-workspace
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bugfix-plan-lock-and-contract-20261112
    why: "Two starters can both see a lock older than five minutes, unlink it in turn and both launch; a workspace inside the checkout turns the checkout dirty and makes operator buttons refuse with DIRTY_CHECKOUT."
    acceptance_criteria:
      - "In src/commands/keeper.ts, a stale lock is claimed so that no starter can remove or replace a lock another starter has just created: the claim renames or removes only the exact stale lock it observed (verified unchanged by identity, such as inode and mtime, immediately before and by the rename itself), or uses an exclusive-create ownership token; of two concurrent starters exactly one proceeds and the other refuses with the in-progress error."
      - A test in tests/keeper-launcher.test.ts reproduces the interleaving in which starter A claims the stale lock and creates a fresh lock before starter B's reclaim step, and asserts B does not remove or replace A's live lock and refuses; it fails before the fix and passes after.
      - A --workspace path inside the primary checkout is refused before any lock or record is written, with a test in tests/keeper-launcher.test.ts; every other test in that file passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only the named files and their tests. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2464"]
  - id: rank-production-off-first-for-stop-everything-lookup
    title: "Make Way lookup in src/way/lookup.ts return the production Off guidance first for stop-production wording, fixing Issue #2348."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make Way lookup in src/way/lookup.ts return the production Off guidance first for stop-production wording, fixing Issue #2348."
    expected_artifact: Evidence satisfying Agent Ask rank-production-off-first-for-stop-everything-lookup
    clarification: clarified
    confidence: high
    source: Agent Ask plan-independent-bug-fixes-20261112
    why: "arcadia way lookup \"how do I stop everything\" ranks the end-your-session passage first because of keyword overlap, while the Off guidance exists and is not found."
    acceptance_criteria:
      - "First reproduce the defect with a failing-first case in tests/way-lookup.test.ts; if the query already returns the production Off guidance first on current main, stop and record that Issue #2348 is stale instead of changing ranking."
      - The lookup returns the production Off guidance first for "how do I stop everything", "turn production off" and "where is the off button", in a checked-in case set in tests/way-lookup.test.ts that also holds near-miss queries about ending a session which still return the session-ending passage first.
      - The gibberish query still answers that the Way does not clearly answer it, and every other test in tests/way-lookup.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only the named source file and its test file. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2348"]
  - id: require-start-card-queue-segment-equal-to-activation-queue
    title: "Make validateOperatorScriptContract in src/operatorActions/libraryContract.ts require a planActivation queueSegment equal to the activation's dependency-ordered non-done Actions, fixing Issue #2478."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make validateOperatorScriptContract in src/operatorActions/libraryContract.ts require a planActivation queueSegment equal to the activation's dependency-ordered non-done Actions, sharing the ordering function with activation settlement, fixing Issue #2478."
    expected_artifact: Evidence satisfying Agent Ask require-start-card-queue-segment-equal-to-activation-queue
    clarification: clarified
    confidence: high
    source: Agent Ask amend-bugfix-plan-lock-and-contract-20261112
    why: "The contract checks only that the segment begins with the pinned Actions, but the activation runner requires an exact match, so a card can pass the contract and refuse at press time after the press began."
    acceptance_criteria:
      - The contract computes the expected segment with the same dependencyOrderedActionIds that activation settlement uses, exported from src/ask/settlement.ts or moved unchanged to a shared module imported by both, with no behavior change to settlement, and refuses any card whose queueSegment differs, with the INVALID_START_RUN error naming the expected segment.
      - A test in tests/operator-script-contract.test.ts for a Plan with non-done Actions outside the card's pinned scope fails before the fix and passes after; a card listing every non-done Action still passes.
      - Every other test in tests/operator-script-contract.test.ts, tests/plan-activation-runner.test.ts and the settlement tests passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only the named files and their tests. Proof that the tests, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2478"]
questions: []
decisions: []
---

# Give production a queue of three independent, verified bug-fix Actions so a serial run has ready work once the housekeeping hold is satisfied.

Created as an inactive draft from accepted Agent Ask plan-independent-bug-fixes-20261112; creation changed no pointer. Current activation is recorded in frontmatter.
