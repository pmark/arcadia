---
arcadia: v1
type: plan
slug: batch-2-of-2-three-independent-verified-bug-fix-actions-from-issues-2403-2111
project: arcadia
status: draft
milestone: "Batch 2 of 2: three independent, verified bug-fix Actions from Issues #2403, #2111 and #1825, proposed as an inactive draft Plan for operator acceptance under Decision 0226."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-13
actions:
  - id: resolve-decision-approve-repo-from-invocation-root
    title: "Make the Decision repository resolution in src/commands/decision.ts use invocationRoot() from src/cli/invocation.ts instead of process.cwd(), fixing Issue #2403."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make the Decision repository resolution in src/commands/decision.ts use invocationRoot() from src/cli/invocation.ts instead of process.cwd(), fixing Issue #2403."
    expected_artifact: Evidence satisfying Agent Ask resolve-decision-approve-repo-from-invocation-root
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-2-20261113
    why: "The launcher changes directory into the Arcadia checkout, so decision approve from an isolated candidate searches main for a Decision that only exists in the candidate and refuses with decision_document_not_on_base."
    acceptance_criteria:
      - A regression test in tests/decision-command.test.ts sets ARCADIA_INVOKED_FROM to a candidate checkout holding an open Decision, runs from a different process working directory, and asserts the dry-run returns the candidate Decision path; it fails before the fix and passes after.
      - A test asserts that with ARCADIA_INVOKED_FROM unset the resolution still uses process.cwd(), and every other test in tests/decision-command.test.ts and tests/decision-deferral.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only src/commands/decision.ts and tests/decision-command.test.ts. Proof that tests, lint and tsc pass comes from required CI on the pull request head.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2403", "src/commands/decision.ts", "src/cli/invocation.ts"]
  - id: retry-refreshes-card-read-on-todo-decision
    title: "Make the State unknown Retry in apps/dashboard/app/todo/[kind]/[...id]/page.tsx refresh the card read as well as the state, fixing Issue #2111 finding 1."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Make the Decision page State unknown Retry refresh the card read as well as the state, and make the failed-read e2e assertion wait for React to apply the failed render, fixing Issue 2111 findings 1 and 2.
    expected_artifact: Evidence satisfying Agent Ask retry-refreshes-card-read-on-todo-decision
    clarification: clarified
    confidence: high
    source: Agent Ask amend-action-2111-scope-20261113
    why: "When the card read is what failed, the Decision Retry called only state.refresh, so the button did nothing useful until the next 15-second poll; a failed-read e2e assertion could also pass before React applied the failed render."
    acceptance_criteria:
      - An end-to-end regression in tests/e2e/todo-decision-light.spec.ts, named Retry on a failed Decision read re-reads the card as well as the state, forces the card read to fail once, clicks Retry on the Decision page, and asserts the card read is repeated and the card renders; it fails before the fix and passes after, shown by a recorded red run or required CI on the pull request head.
      - The Decision page State unknown Retry calls both the card refresh and the state refresh; the other-item Retry calls only the state refresh because agent asks and other to-dos have no card read; and the card hook returns a refresh that re-reads the same card URL on demand, covered by apps/dashboard/hooks/use-decision-cards.test.tsx and apps/dashboard/components/todo-decision-retry.test.tsx.
      - In tests/e2e/todo-decision-light.spec.ts the failed-read test waits a short settle for React to apply the failed poll, then uses retrying negative checks for the nothing-can-be-pressed alert and the answer-from-the-card row control, and asserts the pinned card stays visible; every other test in that spec passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only apps/dashboard/app/todo/[kind]/[...id]/page.tsx, apps/dashboard/hooks/use-decision-cards.ts, the two unit test files named in the second criterion, and tests/e2e/todo-decision-light.spec.ts. Proof that tests, lint and tsc pass comes from required CI on the pull request head.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2111", "https://github.com/pmark/arcadia/pull/2557", "apps/dashboard/app/todo/[kind]/[...id]/page.tsx", "apps/dashboard/hooks/use-decision-cards.ts"]
  - id: bridge-added-dependencies-into-existing-worktree-trees
    title: "Make scripts/bridge-worktree-deps.mjs link dependencies missing from an already-present target tree instead of skipping the whole tree, fixing Issue #1825."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make scripts/bridge-worktree-deps.mjs link dependencies missing from an already-present target tree instead of skipping the whole tree, fixing Issue #1825."
    expected_artifact: Evidence satisfying Agent Ask bridge-added-dependencies-into-existing-worktree-trees
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-2-20261113
    why: "A previously valid bridge never acquires a dependency added to main, so the candidate CLI fails with ERR_MODULE_NOT_FOUND for a package already installed in main."
    acceptance_criteria:
      - A regression test in tests/bridge-worktree-deps.test.ts creates a bridged worktree tree, adds a new package entry to the main checkout tree, reruns the bridge, and asserts the new package is linked; it fails before the fix and passes after.
      - A rerun on a fully bridged tree still reports every tree present and links nothing, and every other test in tests/bridge-worktree-deps.test.ts passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only scripts/bridge-worktree-deps.mjs and tests/bridge-worktree-deps.test.ts. Proof that tests, lint and tsc pass comes from required CI on the pull request head.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1825", "scripts/bridge-worktree-deps.mjs"]
questions: []
decisions: []
---

# Batch 2 of 2: three independent, verified bug-fix Actions from Issues #2403, #2111 and #1825, proposed as an inactive draft Plan for operator acceptance under Decision 0226.

Created as an inactive draft from accepted Agent Ask ellis-batch-2-20261113; creation changed no pointer. Current activation is recorded in frontmatter.
