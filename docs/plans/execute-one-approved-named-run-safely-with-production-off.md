---
arcadia: v1
type: plan
slug: execute-one-approved-named-run-safely-with-production-off
project: arcadia
status: draft
milestone: Execute one approved named Run safely with Production Off.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-16
actions:
  - id: consume-one-approved-named-run
    title: Implement bounded public consumption of one approved named Run with Production Off (role implementer; standard tier; size M; operator gate none).
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-consume-one-approved-named-run-20261016-pr1455; no further action.
    expected_artifact: Evidence satisfying Agent Ask consume-one-approved-named-run
    clarification: clarified
    confidence: high
    source: Agent Ask plan-approved-run-infrastructure-20261016
    why: "Issue 1389 prevents the approved Ask from progressing beyond a pending_execution Run while Production remains Off."
    acceptance_criteria:
      - A public consume-one fixture test selects exactly one explicitly named approved Ask-linked Run, reuses existing execution and finalization, and records a completed correlated Run plus a ready or published product Artifact at HelloWorld.txt containing exactly the 13 bytes Hello World! followed by one LF newline; a scripted external executor produces the fixture output with zero live provider calls.
      - Negative public-path tests reject omitted, blank, invalid, unrelated or already claimed Run selectors, non-fixture scope, missing or revoked approval, stale source pins and missing durable admission safeguards before executor invocation; no fallback claims another Run.
      - A concurrent fixture test records at most one successful claim and one executor invocation for the selected Run; unrelated Runs and protected fixture state remain unchanged. Execution failure or interruption records a truthful terminal or blocked result and never reports accepted product completion without its exact file Artifact.
      - A source-path audit and deterministic fixtures verify the consumer introduces no daemon, recurring intake, orphan recovery, production tick, global-oldest fallback, internal-worker wrapper or second orchestration harness; Production stays Off and fixture GitHub, Discord, remotes, services and live Project pointers or queues receive zero writes.
      - A fixture test refuses live provider invocation until durable Decision 0128 reservation and restore detection return valid admission evidence; source-only tests use a scripted external executor and record zero live provider calls.
      - Separate independent Code-reviewer and QA receipts verify the current source head with no unresolved blocking findings; all repository-required CI checks pass, focused tests, lint, TypeScript and build pass, and the PR records executable QA instructions and updates docs/scout/CONTINUE.md with source acceptance, live attempts and product outcome separately.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1389", "https://github.com/pmark/arcadia/pull/1453", "docs/planning-process.md", "docs/scout/CONTINUE.md", "docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md"]
  - id: enforce-durable-run-admission
    title: Implement durable Run admission reservations, limits and independent restore detection (role implementer; standard tier; size M; operator gate none).
    status: open
    responsibility: agent
    effort: session
    next_action: Implement durable Run admission reservations, limits and independent restore detection (role implementer; standard tier; size M; operator gate none).
    expected_artifact: Evidence satisfying Agent Ask enforce-durable-run-admission
    clarification: clarified
    confidence: high
    source: Agent Ask plan-approved-run-infrastructure-20261016
    why: "A new source revision or restored ledger must never reset the same Scout goal allowance or admit an unreserved provider attempt."
    acceptance_criteria:
      - Restart, source-revision and fixture-recreation tests retain one stable goal identity, first-live-launch timestamp, cumulative attempt count and runtime repair count; none of those transitions resets the allowance.
      - Concurrent and crash-injection tests verify transactional reservation commits before provider invocation, at most three total live builder attempts each capped at 90 seconds, at most two runtime repair cycles and at most 90 minutes elapsed from first live launch including waits; an ambiguous interrupted reservation consumes allowance and concurrent callers cannot exceed any bound.
      - "Admission tests reject expiry at or after 2026-10-18T00:00:00Z, clock rollback, missing or corrupt history, exhausted bounds, unchanged failure, missing authority or isolation evidence before any provider call; a retry requires a named failure, changed verified source and separate independent code-review and QA evidence."
      - An earlier-valid-snapshot restoration test restores the ledger to an older internally valid state and verifies admission fails closed using an independently retained freshness or restore witness outside that restored ledger; a ledger-local hash or timestamp alone cannot satisfy the test. The evidence records the trusted-store boundary and does not claim protection against privileged replacement of every trusted store.
      - Integration fixtures prove the public consumer invokes the existing executor only after reservation and current exact-scope approval, clean immutable source, Node 22, Luna low with a 90-second cap, subscription and capacity evidence, Production Off and protected-state witnesses pass; missing or unknown required evidence refuses invocation. The source suite records zero live provider calls and zero live workspace, pointer, queue, service, host configuration or remote changes.
      - The evidence report records remaining live allowance as unknown unless fresh durable history proves it, preserves historical protected-config uncertainty, reports measured usage or unknown honestly and verifies no paid credits, reset purchase, API billing or model/provider fallback is admitted; no governed Session lineage is fabricated.
      - Separate independent Code-reviewer and QA receipts verify the current source head with no unresolved blocking findings; all repository-required CI checks pass, focused tests, lint, TypeScript and build pass, and the PR records executable QA instructions and updates docs/scout/CONTINUE.md with source acceptance, live attempts and product outcome separately.
    depends_on: [consume-one-approved-named-run]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1389", "https://github.com/pmark/arcadia/pull/1453", "docs/planning-process.md", "docs/scout/CONTINUE.md", "docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md"]
  - id: prove-approved-run-completion
    title: Implement a deterministic public-path proof of approved named-Run completion and refusal cases (role implementer; standard tier; size S; operator gate none).
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a deterministic public-path proof of approved named-Run completion and refusal cases (role implementer; standard tier; size S; operator gate none).
    expected_artifact: Evidence satisfying Agent Ask prove-approved-run-completion
    clarification: clarified
    confidence: high
    source: Agent Ask plan-approved-run-infrastructure-20261016
    why: "A reusable infrastructure test must prove completed work before a customer-persona trial is resumed."
    acceptance_criteria:
      - "An integration test drives real public Ask intake, explicitly labelled fixture operator approval and named-Run consumption through the existing executor/finalization; only the external executor is scripted, and the result records exactly one logical request, one correlated completed Run and a ready or published Artifact at HelloWorld.txt containing exactly 13 bytes: Hello World! followed by one LF newline."
      - The independent deterministic oracle rejects an absent file, wrong bytes, an unrelated or incomplete Run, an absent or stale Artifact and queued or approval receipts alone; each negative case returns product outcome No with a named reason.
      - Public-path tests reject unrelated Runs, missing or revoked approval, duplicate consumption, exhausted reservation, missing or restored history and expired live authority before any provider invocation; replay of the same request and interrupted reservation produces no duplicate execution or allowance reset.
      - The machine-readable integration report records zero live provider calls, zero incremental paid spend from the fixture, Production Off, zero live workspace or protected-state changes, expected-versus-actual results for every criterion and the exact source revision. It labels deterministic infrastructure success separately from an actual model-driven Scout result.
      - Separate independent current-head review and QA report no unresolved blocking findings; all required repository CI checks pass and the operator guide provides one repeatable deterministic verification command. No live Scout attempt or Plan activation occurs.
    depends_on: [consume-one-approved-named-run, enforce-durable-run-admission]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1389", "https://github.com/pmark/arcadia/pull/1453", "docs/planning-process.md", "docs/scout/CONTINUE.md", "docs/agent-guidance/ask-todo-scout.md"]
questions: []
decisions: []
---

# Execute one approved named Run safely with Production Off.

Created as an inactive draft from accepted Agent Ask plan-approved-run-infrastructure-20261016; creation changed no pointer. Current activation is recorded in frontmatter.
