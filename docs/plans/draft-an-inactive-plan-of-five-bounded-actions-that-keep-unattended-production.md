---
arcadia: v1
type: plan
slug: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
project: arcadia
status: active
milestone: "Draft an inactive Plan of five bounded Actions that keep unattended production running between batches without a person: survive the operator's merges to main, repair mechanically red candidates, start the next approved Plan, and stop Decision-number collisions"
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-18
actions:
  - id: retry-successor-press-when-main-moves
    title: When main moves while the host timer is between derive and press, the timer retires that card and derives a fresh one on a later tick instead of ending the standing grant's loop, so the operator can merge to main freely while production runs.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: When main moves while the host timer is between derive and press, the timer retires that card and derives a fresh one on a later tick instead of ending the standing grant's loop, so the operator can merge to main freely while production runs.
    expected_artifact: Evidence satisfying Agent Ask retry-successor-press-when-main-moves
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-review-findings-20261117
    why: "Since #2765 a merge during the up-to-40-minute replay and preflight window ends the unattended loop for the whole grant and pings; the operator wants to merge freely."
    acceptance_criteria:
      - A failing-first test shows that a main move between derive and press retires the card with a receipt naming the old and new main revisions, does not end the step, and leads to a fresh derivation at the new main on a later tick.
      - A refusal (origin-moved, or CARD_NOT_DERIVED at replay, preflight or press) is retryable only when the card's pinned main revision differs from origin main read at the failing check. A CARD_NOT_DERIVED with an unchanged main (for example a differing field or NO_READY_ACTIONS) keeps today's sticky end; tests cover both cases.
      - Consecutive main-moved retries are bounded by a named constant. Exceeding it ends the step with exactly one ping naming the cause; a test covers both sides of the bound.
      - Every other refusal code keeps today's sticky behavior, shown by the existing successor-press tests passing unchanged.
      - A derived card's lifetime is at least the replay timeout plus the preflight timeout, enforced by a test that fails if either constant changes without the other.
      - The freeze guidance (rehearsal-freeze-window.md and operator-actions.md) states the retry bound's value and says that while a standing grant is open a merge to main voids nothing and delays the next press by at most that many derivations, after which the step ends with one ping. The work merge-check message stops telling the operator not to merge for a timer-derived card.
    depends_on: []
    decisions: []
    references: ["src/production/successorPress.ts", "src/commands/productionSuccessor.ts", "src/operatorActions/startRunDerive.ts", "scripts/start-run.sh", "docs/agent-guidance/rehearsal-freeze-window.md", "docs/agent-guidance/operator-actions.md", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md"]
  - id: repair-mechanical-check-failures-deterministically
    title: When a production candidate's required checks fail only on mechanical classes (lint auto-fixable rules, a stale guidance fingerprint, current_action left behind after a base merge), production applies the class's existing generator to the candidate, pushes a new production-owned head and lets it be reviewed afresh, with no model call and no person.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: When a production candidate's required checks fail only on mechanical classes (lint auto-fixable rules, a stale guidance fingerprint, current_action left behind after a base merge), production applies the class's existing generator to the candidate, pushes a new production-owned head and lets it be reviewed afresh, with no model call and no person.
    expected_artifact: Evidence satisfying Agent Ask repair-mechanical-check-failures-deterministically
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-next-batch-f-keep-the-loop-alive-20261117b
    why: "Seven of seven candidates since 2026-11-15 stopped for a hand fix, and every fix was mechanical; Decision 0247 E says deterministic fixes come first."
    acceptance_criteria:
      - "A pure classifier maps a failing required check's log to one of: lint-autofixable, guidance-fingerprint, stale-current-action, or unknown. Fixture tests use the recorded failures of #2752, #2758, #2765 and #2766 and classify each one correctly."
      - "For each known class the repair runs only that class's existing generator, never a hand edit: eslint --fix limited to the candidate's changed files, the fingerprint generator for guidance documents the candidate itself changed, and the governed pointer advance. A test shows a fingerprint is never refreshed for a document outside the candidate's diff."
      - "The repaired head is production-owned: the worker reviews it afresh as a new head and the candidate does not enter review_head_moved. A test covers a repair push following a recorded verdict."
      - Repair is bounded to one deterministic round per candidate head. An unknown class or a still-red check after the round hands off to the bounded repair Session of the next Action and never loops; tests show both.
      - The alert for a repaired or handed-off candidate fires at most once per episode. A test shows the repair_gated and repair_budget_repeat alerts do not re-fire every tick, against the recorded 139,735-repeat case.
      - Preview proposal agentask_abd3a5e65938083517 is recorded as absorbed by this Action and the next, with its receipt id cited in this Action's completion evidence.
    depends_on: []
    decisions: []
    references: ["src/production/tick.ts", "src/production/workerMerge.ts", "src/production/independentReview.ts", "docs/agent-guidance/fingerprints.json", "docs/decisions/0247-should-production-repair-a-candidate-that-fails-lint-budget-fingerprint-or.md", "docs/notes-to-self.md"]
  - id: repair-red-candidates-with-a-bounded-session
    title: When a candidate stays red after the deterministic round, production launches one bounded coding-agent repair Session on that candidate, briefed with the failing check logs, which produces a new reviewed head or parks the candidate with one ping that meets the operator-attention criteria.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: When a candidate stays red after the deterministic round, production launches one bounded coding-agent repair Session on that candidate, briefed with the failing check logs, which produces a new reviewed head or parks the candidate with one ping that meets the operator-attention criteria.
    expected_artifact: Evidence satisfying Agent Ask repair-red-candidates-with-a-bounded-session
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-next-batch-f-keep-the-loop-alive-20261117b
    why: "Decision 0247 E: after deterministic fixes, a coding-agent repair Session produces a new reviewed head; the operator is pinged only when the attention criteria are met. Classification and fixture failures need judgment, not a generator."
    acceptance_criteria:
      - "The repair Session's brief contains the failing required checks' log excerpts and the classifier's verdict. A test asserts the brief text for the recorded #2744 lint-and-classification failure."
      - A new module that the authority or command classification lists do not cover is classified most-restrictive (authority-adjacent) by default, so the repair can never weaken a guard. A test shows a repair that would classify a module as less restrictive is refused.
      - The repair runs on the light tier first, makes at most one attempt per candidate head, uses no paid fallback and stays inside the existing repair budget. A test shows a refused spend or capacity check launches nothing and leaves a receipt.
      - A successful repair's head is reviewed afresh by the worker and merges only under the 0060/0080 gate. A failed repair parks the candidate and sends exactly one ping that names the failing check, the attempted fix and the operator-attention criterion it meets.
      - A fixture run replays one recorded red candidate through both repair rounds to a green, reviewed head with zero operator touches, and the run record lists the touches as none.
    depends_on: [repair-mechanical-check-failures-deterministically]
    decisions: []
    references: ["src/production/tick.ts", "src/production/independentReview.ts", "src/decisions/batchMerge.ts", "docs/decisions/0247-should-production-repair-a-candidate-that-fails-lint-budget-fingerprint-or.md", "docs/decisions/0181-decide-what-unattended-production-does-after-attempt-3-s-clean-run-re-deciding.md", "docs/decisions/0187-decide-what-unattended-production-does-after-a-delegated-batch-fails-under-the.md", "CONSTITUTION.md"]
  - id: queue-approved-plans-and-start-the-next
    title: A governed record on main holds the ordered list of Plans the operator approved for production, and when the standing grant's current Plan reaches scope complete the host timer activates the next queued Plan and continues pressing its cards, instead of turning production Off and waiting.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A governed record on main holds the ordered list of Plans the operator approved for production, and when the standing grant's current Plan reaches scope complete the host timer activates the next queued Plan and continues pressing its cards, instead of turning production Off and waiting.
    expected_artifact: Evidence satisfying Agent Ask queue-approved-plans-and-start-the-next
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-review-findings-20261117
    why: "Decision 0241 E: the operator stacks Plans on the work queue and expects Arcadia to work through each. Today no record holds that stack and the timer stops at scope complete."
    acceptance_criteria:
      - A checked-in Plan-queue record per Project lists approved Plan slugs in order. Only a settled Agent Ask carrying the operator's approval can add, remove or reorder entries; a test shows any other write path is refused.
      - A read-only command prints the Plan queue with each Plan's status and readiness. A Plan is ready when every remaining Action has observable acceptance and none cites an open Decision or names an authority path the deriver stops at. Tests cover a ready Plan and two not-ready ones.
      - The deriver (src/operatorActions/startRunDerive.ts) accepts a Plan under an open standing grant only if it is the grant's pinned Plan or the Project's active Plan and an entry of the approved Plan-queue record at the same origin main revision. Any other Plan refuses with a named code, and the grant's end conditions are unchanged. Tests cover the pinned Plan, a queued activated Plan, and an active Plan missing from the record.
      - At scope complete with an open standing grant, the timer activates the next ready queued Plan through the governed pointer transition and derives its first card on a later tick. A not-ready next Plan, or an empty queue, turns production Off with exactly one ping naming the reason. Tests cover all three.
      - The derived card for a newly activated Plan passes the existing replay and press checks; the card-integrity suite from prove-card-integrity-against-recorded-defects still passes, extended with a fixture for a queued-Plan card.
      - Plan let-the-operator-change-what-production-queues-from-the-production-project records, through a governed amendment, that its single-Project ordering is delivered here and that its multi-Project preference Actions remain, with a revival trigger.
    depends_on: [retry-successor-press-when-main-moves]
    decisions: []
    references: ["src/production/successorPress.ts", "src/dispatch/queue.ts", "src/dispatch/pointer.ts", "src/plans/nextPlanSelector.ts", "src/operatorActions/planQueue.ts", "src/ask/agentAsk.ts", "docs/decisions/0241-may-one-standing-start-grant-replace-the-daily-approval-of-decision-0173-so.md", "docs/plans/let-the-operator-change-what-production-queues-from-the-production-project.md"]
  - id: allocate-decision-numbers-on-main-and-refuse-duplicates
    title: Decision numbers are allocated against origin main at settle or mint time, and a required check fails any pull request that adds a Decision id its base already has, so two Decisions never share a number again.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Decision numbers are allocated against origin main at settle or mint time, and a required check fails any pull request that adds a Decision id its base already has, so two Decisions never share a number again.
    expected_artifact: Evidence satisfying Agent Ask allocate-decision-numbers-on-main-and-refuse-duplicates
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-amend-plan-f-review-findings-20261117
    why: "Operator, 2026-11-17: 'This needs to never happen again.' Collisions recurred on 0240 and 0250, and every START press now mints a Decision on main."
    acceptance_criteria:
      - A test reproduces the 0250 race (an Ask settle candidate chooses N while a START sign-in mints N on main) and shows the second writer receives N+1 or refuses. No two Decision files on main share an id.
      - A required CI check fails a pull request that adds a docs/decisions file whose id already exists on its base, naming both files. The four historical pairs are grandfathered by an explicit list, and a test shows a fifth pair fails.
      - Every Arcadia merge path (the worker merge and the operator batch-merge card) re-runs the duplicate check against current origin main immediately before merging and refuses on a duplicate. A test with two pull requests that each add id N against the same base shows the second is refused after the first merges.
      - A check on every push to main fails loudly, with one ping naming both files, if a duplicate id reaches main by any other route.
      - START sign-in usage-check Decisions take their id at the moment they are written to main, from origin main, and a test shows a concurrent open PR's Decision does not block or collide with them.
      - "Action allocate-decision-numbers-from-origin-and-refuse-duplicates in Plan seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and is closed as superseded by this Action through a governed amendment, and Issues #2369 and #1275 cite the merged PR."
    depends_on: []
    decisions: []
    references: ["src/docs/sync.ts", "src/docs/types.ts", "src/docs/operatorGate.ts", "src/production/startRunSignIn.ts", "src/production/workerClaudeUsageDiagnostic.ts", "docs/plans/seven-verified-settlement-queue-and-preservation-integrity-bugs-are-fixed-and.md"]
questions: []
decisions: []
current_action: retry-successor-press-when-main-moves
recommended_model: standard
recommended_reasoning_effort: medium
---

# Draft an inactive Plan of five bounded Actions that keep unattended production running between batches without a person: survive the operator's merges to main, repair mechanically red candidates, start the next approved Plan, and stop Decision-number collisions

Created as an inactive draft from accepted Agent Ask ellis-next-batch-f-keep-the-loop-alive-20261117b; creation changed no pointer. Current activation is recorded in frontmatter.
