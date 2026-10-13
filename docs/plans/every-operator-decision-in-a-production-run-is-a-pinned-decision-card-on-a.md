---
arcadia: v1
type: plan
slug: every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a
project: arcadia
status: active
milestone: Every operator decision in a production run is a pinned decision card on a remote surface, and Plan-to-Plan handoff runs through a deterministic close-out record and next-Plan selector.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-13
actions:
  - id: decision-card-contract
    title: Implement the arcadia-decision-card-v1 schema and validator in src/decisions/card.ts so every operator touch is one pinned card with a verb, consequence, evidence and receipt.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-decision-card-contract-2026-10-12; no further action.
    expected_artifact: Evidence satisfying Agent Ask decision-card-contract
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "One contract for PR merges, /actions buttons and /todo Decisions is what lets a deterministic engine replace the Lead class by class."
    acceptance_criteria:
      - The validator rejects a card with a missing consequence, missing pins or an unknown verb, and rejects a stale pin (state hash, head sha or preview fingerprint) at use time.
      - Fixtures exist for the merge, run and answer verbs and each validates.
      - A card carries a policy_match field that is null or a policy id and an expiry that the validator enforces.
      - Focused tests pass and the dashboard import graph has no containerAuditTransport or commander edge.
    depends_on: []
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: cards-from-existing-sources
    title: Implement card generation from open Decisions, operator-script descriptors and pull requests that need the operator, as a read-only module with fixtures.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-cards-from-existing-sources-2026-10-13; no further action.
    expected_artifact: Evidence satisfying Agent Ask cards-from-existing-sources
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "The operator already decides through these three surfaces; cards give them one evidence format readable in under a minute."
    acceptance_criteria:
      - Each of the three sources yields a valid decision card and the generator never mutates a Decision, script or PR.
      - A pull request card names which authority boundary the diff touches using a path-based classifier with a documented list.
      - The pinned fingerprint on a card changes when its source state changes.
      - Focused tests pass.
    depends_on: [decision-card-contract]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: todo-actions-render-cards
    title: Implement /todo and /actions rendering of decision cards with the consequence and evidence visible and one verb button that posts only the pinned fingerprint.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement /todo and /actions rendering of decision cards with the consequence and evidence visible and one verb button that posts only the pinned fingerprint.
    expected_artifact: Evidence satisfying Agent Ask todo-actions-render-cards
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "The operator wants decisions rendered through buttons and Decisions on the pages they already use."
    acceptance_criteria:
      - A card shows its consequence and evidence links on /todo or /actions and one verb button.
      - The button request carries only the card id and pinned fingerprint and a stale card shows a refusal with the reason.
      - An end-to-end dashboard test covers a run card and an answer card and the dashboard build passes.
      - Existing /todo and /actions behaviour is unchanged for items with no card.
    depends_on: [cards-from-existing-sources]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: delegation-policy-records
    title: Write the delegation-policy record format as a standing-grant extension and implement a pure evaluator that returns match or no-match with a reason.
    status: open
    responsibility: agent
    effort: session
    next_action: Write the delegation-policy record format as a standing-grant extension and implement a pure evaluator that returns match or no-match with a reason.
    expected_artifact: Evidence satisfying Agent Ask delegation-policy-records
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "Approving policies instead of instances is how operator clicks per Plan fall without widening authority."
    acceptance_criteria:
      - A policy record has a class, scope, expiry and evidence requirements and the evaluator is a pure function with no I/O.
      - A credentials, Grant, spend or Constitution class can never match and tests enumerate every excluded class.
      - An expired or revoked policy never matches.
      - Policies are proposed by agents only and the record has no approval path outside the existing Decision flow; tests pass.
    depends_on: [decision-card-contract]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: plan-close-out-record
    title: Implement arcadia plan close-out writing a deterministic docs/plans/PLAN/close-out.json from the session ledger and Plan state, and backfill one record for the hardening Plan.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement arcadia plan close-out writing a deterministic docs/plans/PLAN/close-out.json from the session ledger and Plan state, and backfill one record for the hardening Plan.
    expected_artifact: Evidence satisfying Agent Ask plan-close-out-record
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "The close-out record is the baton that makes handing off the next Plan safe and auditable."
    acceptance_criteria:
      - The schema validates and the same inputs produce the same hash.
      - The record lists Actions with outcome and PRs, open remainders, open blockers, ledger aggregates, frictions with test ids and a successor recommendation.
      - A backfilled record exists for the autonomous-production hardening Plan and a validator rejects a malformed record in CI.
      - Focused tests pass.
    depends_on: []
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: next-plan-selector
    title: Implement a deterministic next-Plan selector and preflight that emits a decision card and is preview-only.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a deterministic next-Plan selector and preflight that emits a decision card and is preview-only.
    expected_artifact: Evidence satisfying Agent Ask next-plan-selector
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "Plan-to-Plan handoff is a loop; selection and preflight are its deterministic first half."
    acceptance_criteria:
      - The selector follows Decisions 0116 and 0122 and returns the chosen Plan with the reasons.
      - It refuses a Plan authored in the same run and a Plan the operator has not approved.
      - A preflight failure names the blocker and the one-click remedy; no state is mutated.
      - Focused tests pass and the preview matches the card contract.
    depends_on: [decision-card-contract, plan-close-out-record]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: blocker-reset-script
    title: Write an operator script and descriptor that resets an environment_wall or budget_exhausted blocker from a card, with a pinned blocker id and a receipt.
    status: open
    responsibility: agent
    effort: session
    next_action: Write an operator script and descriptor that resets an environment_wall or budget_exhausted blocker from a card, with a pinned blocker id and a receipt.
    expected_artifact: Evidence satisfying Agent Ask blocker-reset-script
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "Clearing these blockers is CLI-only today, a standing host touch (living notes friction 12)."
    acceptance_criteria:
      - The script pins the blocker id and fingerprint, is idempotent and leaves a receipt.
      - It appears on /actions as a run card and never resets a real repair budget it was not pinned to.
      - A rehearsal test replays an environment_wall stop and clears it through the script.
      - Focused tests pass and no terminal command is shown to the operator.
    depends_on: [decision-card-contract]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: friction-to-test-guard
    title: Implement a CI check that every friction row marked Fixed in the living notes cites a test or rule id, and a Replayer fixture template for new frictions.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a CI check that every friction row marked Fixed in the living notes cites a test or rule id, and a Replayer fixture template for new frictions.
    expected_artifact: Evidence satisfying Agent Ask friction-to-test-guard
    clarification: clarified
    confidence: high
    source: Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12
    why: "A friction is not closed until a test or rule would catch its return."
    acceptance_criteria:
      - CI fails when a Fixed row has no test or rule citation.
      - The existing Fixed rows are updated to cite their tests.
      - A template and one worked example turn a recorded receipt into a failing fast-rehearsal fixture.
      - Focused tests pass.
    depends_on: []
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: batch-merge-decision-card
    title: Implement a /todo batch merge card that lists every pull request awaiting the operator with why it needs them, the decisions it makes and its consequences, and one button that merges them in stack order from pinned head shas.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask split-batch-merge-decision-card-2026-10-13; no further action.
    expected_artifact: Evidence satisfying Agent Ask batch-merge-decision-card
    clarification: clarified
    confidence: high
    source: Agent Ask split-batch-merge-decision-card-2026-10-13
    why: "One page and one button per decision round is the operator-effort target; merges are the largest remaining operator touch."
    acceptance_criteria:
      - Each listed pull request shows the authority boundary its diff touches from a path-based classifier, the independent review verdict, the required checks and a one-sentence consequence, and the card orders stacked pull requests base first.
    depends_on: [decision-card-contract]
    split_into: [wire-the-batch-merge-card-route, publish-the-batch-merge-descriptor-and]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md"]
  - id: card-veto-verb
    title: Implement a veto verb with an expiry default on the decision card so a card executes at expiry with a receipt unless the operator vetoes it, starting with split remainder placement.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a veto verb with an expiry default on the decision card so a card executes at expiry with a receipt unless the operator vetoes it, starting with split remainder placement.
    expected_artifact: Evidence satisfying Agent Ask card-veto-verb
    clarification: clarified
    confidence: high
    source: Agent Ask amend-cards-plan-add-veto-and-scoreboard-2026-10-12
    why: "Default-and-veto turns most routine questions into receipts and is the main lever on touches per Action."
    acceptance_criteria:
      - A card kind may declare a default action and an expiry and the evaluator executes the default at expiry only when no veto was recorded, leaving a receipt that names the card, default and time.
      - A veto before expiry cancels the default and records who vetoed and when; a later expiry never executes it.
      - Credentials, Grants, spend, cap, Constitution and approval classes can never declare a default, and tests enumerate each excluded class.
      - The /todo card shows the default, the deadline and a one-click veto; focused tests pass.
    depends_on: [decision-card-contract]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: record-operator-touch-receipts
    title: Implement an operator touch receipt written by every card verb and a /production scoreboard showing touches per Action, median decision latency and the share answered from the card alone.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement an operator touch receipt written by every card verb and a /production scoreboard showing touches per Action, median decision latency and the share answered from the card alone.
    expected_artifact: Evidence satisfying Agent Ask record-operator-touch-receipts
    clarification: clarified
    confidence: high
    source: Agent Ask amend-cards-plan-add-veto-and-scoreboard-2026-10-12
    why: "Nothing measures the goal today; the scoreboard shows whether operator attention is actually falling."
    acceptance_criteria:
      - Each merge, run, answer and veto verb writes one touch row with the card kind, latency and whether the card was sufficient.
      - The /production page shows touches per merged Action, median latency, host touches and unattended hours computed from the receipts and the session ledger.
      - A fixture replay of one run produces the expected scoreboard numbers and the numbers are deterministic.
      - Focused tests pass and the dashboard import graph has no containerAuditTransport or commander edge.
    depends_on: [decision-card-contract]
    decisions: []
    references: ["docs/strategy/autonomous-production-strategy.md", "docs/reports/production-simulation-living-notes.md", "https://github.com/pmark/arcadia/issues/1284"]
  - id: wire-the-batch-merge-card-route
    title: Wire the batch merge card route and one button into /todo
    status: open
    responsibility: agent
    effort: session
    next_action: Wire the batch merge card route and one button into /todo
    expected_artifact: Evidence satisfying Agent Ask wire-the-batch-merge-card-route
    clarification: clarified
    confidence: high
    source: Agent Ask split-batch-merge-decision-card-2026-10-13
    acceptance_criteria:
      - The button posts only the card id and the pinned head sha of each pull request; it refuses the whole batch and names the reason when any head moved, any required check is not green or any independent review is missing.
    depends_on: []
    decisions: []
    references: []
  - id: publish-the-batch-merge-descriptor-and
    title: Publish the batch merge descriptor and queue its Discord ping
    status: open
    responsibility: agent
    effort: session
    next_action: Publish the batch merge descriptor and queue its Discord ping
    expected_artifact: Evidence satisfying Agent Ask publish-the-batch-merge-descriptor-and
    clarification: clarified
    confidence: high
    source: Agent Ask split-batch-merge-decision-card-2026-10-13
    acceptance_criteria:
      - The merge runs as an operator script whose descriptor is published for review and is never executed by an agent; it writes one receipt per pull request and is idempotent when re-run.
      - The Discord ping for a pending batch links the card and states the count, and a focused test with fixture pull requests covers the stale-head refusal, the stack order and the receipt.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
current_action: todo-actions-render-cards
recommended_model: gpt-5.6-terra
recommended_reasoning_effort: medium
---

# Every operator decision in a production run is a pinned decision card on a remote surface, and Plan-to-Plan handoff runs through a deterministic close-out record and next-Plan selector.

Created as an inactive draft from accepted Agent Ask plan-decision-cards-and-plan-handoff-2026-10-12; creation changed no pointer. Current activation is recorded in frontmatter.
