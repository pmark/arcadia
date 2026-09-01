---
arcadia: v1
type: plan
slug: provider-capacity-harvesting
project: arcadia
status: proposed
milestone: Otherwise-expiring included coding-agent capacity advances the smallest safe Back Burner slice without silently spending credits or changing authority
token_impact: large
token_budget: "Usage collection, reset calculations, freshness checks, candidate filtering, dependency evaluation, admission, and reporting are deterministic. Spend model tokens only on an admitted governed planning or implementation Action, bounded by its existing token budget and the observed provider allowance; never spend purchased credits merely to exhaust capacity."
recommended_model: gpt-5.6-sol
recommended_reasoning_effort: high
updated: 2026-09-01
actions:
  - id: define-provider-usage-snapshot
    title: Define the provider-neutral usage and reset receipt
    status: open
    responsibility: codex
    effort: short
    next_action: Define a versioned normalized receipt for included allowance windows, reset times, paid-credit state, banked benefits, freshness, confidence, provenance, and unsupported fields.
    expected_artifact: A validated provider-neutral usage snapshot contract with fixtures for known, partial, stale, and unavailable telemetry
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01 and agent-advance-queue#budget-aware-admission
    acceptance_criteria:
      - The receipt distinguishes included allowance, banked resets or benefits, purchased credits, API spend, and unknown capacity rather than reducing them to one token balance.
      - Each observation names provider, account or workspace scope without secrets, window kind, observed value, reset time when available, collection time, source, confidence, and freshness.
      - Partial, stale, refused, and unsupported observations remain valid explicit states and are never interpreted as unlimited or free capacity.
      - Fixtures normalize Codex, Claude Code, manual confirmation, and unavailable-provider evidence into byte-stable receipts with zero model calls.
    depends_on: []
    references:
      - docs/plans/agent-advance-queue.md
      - docs/arcadia-ask-product-vision.md
  - id: observe-codex-capacity
    title: Observe Codex allowance, resets, and credit state
    status: open
    responsibility: codex
    effort: session
    next_action: Implement the strongest read-only Codex observation available on the configured host, with a manual or status receipt fallback and explicit unsupported fields.
    expected_artifact: Fresh, provenance-bearing Codex usage snapshots without reset redemption or credit purchase
    clarification: clarified
    confidence: medium
    source: Operator direction on 2026-09-01
    acceptance_criteria:
      - The adapter captures only telemetry exposed through a supported local, account, workspace, or operator-confirmed surface and never scrapes secrets or guesses a remaining percentage.
      - Available five-hour, weekly, monthly, credit-balance, reset-time, and banked-reset fields map independently; absent fields remain unsupported.
      - Observation is read-only and cannot redeem a reset, purchase credits, change a plan, or start a coding-agent Run.
      - A manual or locally exported status receipt remains usable when no machine-readable personal-account interface exists.
    depends_on: [define-provider-usage-snapshot]
  - id: observe-claude-capacity
    title: Observe Claude Code allowance, resets, and credit state
    status: open
    responsibility: codex
    effort: session
    next_action: Implement the strongest read-only Claude Code observation available on the configured host, preserving whether plan allowance or paid API credits are active.
    expected_artifact: Fresh, provenance-bearing Claude Code usage snapshots without enabling credits or auto-reload
    clarification: clarified
    confidence: medium
    source: Operator direction on 2026-09-01
    acceptance_criteria:
      - The adapter preserves shared plan-limit state, reset information, warning state, and paid-credit mode only when the configured surface exposes them.
      - Subscription allowance, Console/API credits, and auto-reload remain separate states; the adapter never opts into paid usage.
      - Observation is read-only and a manual or `/status`-derived receipt remains available when no stable machine-readable interface exists.
      - Unsupported daily or weekly windows stay visible and prevent a false comparable-capacity claim.
    depends_on: [define-provider-usage-snapshot]
  - id: report-critical-provider-usage
    title: Report critical allowance, reset, and credit events
    status: open
    responsibility: codex
    effort: session
    next_action: Add deterministic severity rules and one provider-usage report covering opportunity, warning, and critical states.
    expected_artifact: A read-only report that distinguishes expiring included allowance from paid-credit or reset Decisions
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01
    acceptance_criteria:
      - Opportunity means included allowance is forecast to reset unused; warning covers stale telemetry, low capacity, or a Candidate unlikely to fit; critical covers paid-credit activation, spend beyond an approved budget, an expiring banked benefit needing a Decision, or a Run crossing its declared stop boundary.
      - Every alert names provider, resource class, observed value, reset or expiry time when known, freshness, consequence, and one next safe action.
      - Purchased-credit use and reset redemption are never recommended merely to maximize token consumption.
      - Repeated unchanged observations deduplicate while materially changed severity or reset state remains visible in the Log.
    depends_on: [observe-codex-capacity, observe-claude-capacity]
  - id: fire-expiring-capacity-predicate
    title: Make expiring included capacity an observable Back Burner trigger
    status: open
    responsibility: codex
    effort: session
    next_action: Register `expiring-agent-capacity` against fresh normalized receipts and make its complete evaluation legible in Back Burner output.
    expected_artifact: The existing Back Burner item fires only when usable included capacity would otherwise expire and higher-priority governed work cannot use it
    clarification: clarified
    confidence: high
    source: Back Burner item bb_f16bedc49aba44ed85 and operator direction on 2026-09-01
    acceptance_criteria:
      - The predicate requires fresh evidence of included provider capacity, a known reset boundary, and no higher-priority ready Action eligible for that provider.
      - Paid credits, banked resets, stale observations, unsupported windows, and unknown capacity cannot independently make the predicate true.
      - Evaluation reports every input, threshold, ignored resource, higher-priority Candidate, and exact reason for true, false, or unknown.
      - The predicate remains a scheduling signal only and grants no execution, spending, merge, deployment, messaging, or credential authority.
    depends_on: [report-critical-provider-usage]
  - id: shape-smallest-back-burner-slice
    title: Shape eligible Back Burner work into the smallest useful slice
    status: open
    responsibility: codex
    effort: project
    next_action: Extend Back Burner candidates with provider capability, model, effort, token impact, dependency, validation-cost, and approval metadata, then produce one governed smallest-slice proposal.
    expected_artifact: A corrigible proposed Action and supporting PM Artifacts sized to the observed allowance without implementation ceremony
    clarification: clarified
    confidence: medium
    source: Operator direction on 2026-09-01 and the Arcadia Ask product thesis
    acceptance_criteria:
      - Candidate selection reuses managed-plan readiness, execution profiles, token impact, token budget, dependencies, responsibility, and Decisions instead of creating a second work queue.
      - A large idea is divided until one slice has observable completion and is forecast to fit the available provider window with validation reserve.
      - Arcadia Ask presents the proposed Outcome, Milestone, Actions, dependencies, estimates, Artifacts, deferrals, and activation condition for correction before durable apply.
      - PM-only apply starts no coding-agent Run, code worktree, implementation branch, or pull request and does not label planning as a working product.
    depends_on: [define-provider-usage-snapshot]
    references:
      - docs/plans/arcadia-ask-active-sessions.md
  - id: admit-bounded-spare-capacity-run
    title: Admit one bounded provider-matched Run
    status: open
    responsibility: codex
    effort: session
    next_action: Join the fired capacity opportunity to one ready smallest slice through the existing Agent Queue, execution-profile resolver, lease, packet, and Run boundaries.
    expected_artifact: One deterministic admission receipt selecting a provider and bounded Action or refusing with a precise capacity stop
    clarification: clarified
    confidence: medium
    source: Operator direction on 2026-09-01 and agent-advance-queue#budget-aware-admission
    acceptance_criteria:
      - Admission requires a ready governed Action, matching provider capability, fresh sufficient included capacity, validation reserve, no conflicting lease or Run, and all existing authority checks.
      - The immutable packet records the observed receipt, forecast, model, effort, stop boundary, validation reserve, and what happens if capacity telemetry changes during execution.
      - Unknown or insufficient capacity leaves work visible with provider, window, observed value, reset time, freshness, and next safe check.
      - The path cannot opt into paid credits, redeem a reset, merge, deploy, publish, message, or use credentials without the separately required Decision.
    depends_on: [fire-expiring-capacity-predicate, shape-smallest-back-burner-slice]
  - id: reconcile-and-graph-capacity-use
    title: Reconcile actual usage and graph the complete work flow
    status: open
    responsibility: codex
    effort: session
    next_action: Persist prediction-versus-actual receipts and project usage windows, reset boundaries, selected work, Runs, Artifacts, alerts, and blocked edges into one live dependency graph.
    expected_artifact: A zero-model reconciliation record and graphic engineering surface tracing capacity through governed effects
    clarification: clarified
    confidence: medium
    source: Operator direction on 2026-09-01
    acceptance_criteria:
      - Reconciliation compares forecast and observed usage without claiming precision the provider did not expose and feeds bounded error evidence into later estimates.
      - The graph distinguishes provider observations, resource class, reset boundaries, Back Burner dependencies, admission, active Run state, produced Artifacts, validation, and every refusal or approval edge.
      - Every node links to its authoritative receipt or managed record; the visualization is a projection and never becomes a second scheduler or truth store.
      - Phone and desktop views make current capacity, critical credit use, selected work, remaining dependency path, and next safe action legible.
    depends_on: [admit-bounded-spare-capacity-run]
  - id: guard-reset-and-credit-effects
    title: Keep resets and purchased credits behind explicit Decisions
    status: open
    responsibility: codex
    effort: short
    next_action: Define preview-only recommendations and exact Decision shapes for reset redemption, paid-credit enablement, auto-reload changes, and approved spend ceilings.
    expected_artifact: A provider-neutral consequential-usage Decision contract with no automatic purchase or redemption path
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-09-01 and the Arcadia Constitution
    acceptance_criteria:
      - A recommendation distinguishes an automatic allowance reset, banked reset, immediate purchased reset, subscription allowance, purchased credits, and API spend.
      - The preview states cost or unknown cost, expiration, reset-schedule consequence, affected windows, rollback limits, and the exact operation requiring authority.
      - No reset, credit purchase, auto-reload change, plan change, or spend occurs without an explicit current Decision authorizing that exact effect.
      - Declining or lacking authority preserves the capacity observation and work Candidate without blocking safe included-allowance use.
    depends_on: [report-critical-provider-usage]
questions: []
decisions: []
---

# Provider capacity harvesting

## Outcome

Arcadia treats otherwise-expiring included coding-agent allowance as a scarce,
perishable planning signal. When higher-priority governed work cannot use that
allowance, Arcadia may select the smallest safe Back Burner slice, show why it
fits, and advance it through the existing governed Run path. It never turns a
quota opportunity into spending or execution authority.

This plan extends the deferred `budget-aware-admission` Action in
`docs/plans/agent-advance-queue.md`. It is proposed rather than active because
the operator classified the capability as ideal Back Burner work. It becomes a
candidate for activation when the operator selects it or when a reliably
capturable provider usage receipt makes the first observer slice worthwhile;
neither condition changes `PROJECT.md` without an explicit pointer transition.

## The vital few

1. Establish an honest usage receipt that admits unknowns.
2. Observe provider allowance without buying, redeeming, or guessing.
3. Fire one deterministic opportunity predicate.
4. Match it to the smallest already-governed safe slice.
5. Reconcile the result so the next estimate improves.

The expensive tail is cross-provider precision. It is not worth delaying the
first useful slice: one provider plus a manual/status receipt can prove the
entire policy before a second machine-readable provider interface exists.

## T-shirt estimates

| Module | Size | Delivery slice |
| --- | --- | --- |
| Usage snapshot contract | S | `define-provider-usage-snapshot` |
| Codex usage observer | M | `observe-codex-capacity` |
| Claude Code usage observer | M | `observe-claude-capacity` |
| Manual/status fallback | S | Shared by both observer Actions |
| Resource semantics | S | `define-provider-usage-snapshot` |
| Critical-usage reporter | M | `report-critical-provider-usage` |
| Capacity opportunity predicate | M | `fire-expiring-capacity-predicate` |
| Work suitability metadata | S | `shape-smallest-back-burner-slice` |
| Smallest-slice planner | L | `shape-smallest-back-burner-slice` |
| Admission and provider matcher | M | `admit-bounded-spare-capacity-run` |
| Bounded dispatcher integration | M | `admit-bounded-spare-capacity-run` |
| Usage reconciliation | M | `reconcile-and-graph-capacity-use` |
| Live capacity/work graph | M | `reconcile-and-graph-capacity-use` |
| Reset and credit Decision boundary | S | `guard-reset-and-credit-effects` |

Sizes mean XS is hours, S is one to three focused days, M is three to seven
focused days, L is one to two weeks, and XL is multi-week. They are complexity
estimates, not schedules. Reusing Back Burner, managed-plan readiness, execution
profiles, token budgets, provider gates, Runs, leases, and receipts makes the
first useful single-provider loop approximately L overall. Trustworthy dual-
provider observation, reconciliation, and the live graph are approximately XL.

## Dependency graph

```mermaid
flowchart TD
    C[Codex observer M] --> U[Usage snapshot S]
    H[Claude observer M] --> U
    F[Manual status fallback S] --> U
    U --> R[Resource semantics S]
    R --> A[Critical usage reporter M]
    R --> P[Expiring capacity predicate M]

    B[Back Burner] --> W[Work suitability S]
    W --> S[Smallest slice planner L]
    S --> M[Provider and work matcher M]
    P --> M

    M --> D[Bounded governed dispatch M]
    D --> X[Coding agent Run]
    X --> E[Usage reconciliation M]
    E --> U
    E --> G[Live capacity and work graph M]
    A --> G
    M --> G

    R --> Q[Reset recommendation S]
    Q --> O{Explicit operator Decision}
    O -->|approved| Z[Apply exact supported effect]
    O -->|declined| G
    Z --> U
```

## Resource and severity policy

- **Opportunity:** included allowance is forecast to reset unused.
- **Warning:** telemetry is stale, capacity is low, or a Candidate may not fit.
- **Critical:** paid credits began being consumed, usage exceeded an approved
  budget, an expiring banked benefit needs a Decision, or a Run crossed its
  declared stop boundary.

Included allowance is perishable. Purchased credits are money. Banked resets
are operator-controlled benefits that may change later reset schedules. Arcadia
must report and optimize these as different resources.

## Explicit deferrals

- Add a second provider only after one provider plus manual/status fallback
  proves the complete admission and reconciliation loop.
- Add predictive statistical calibration only after three real reconciled Runs
  show that static T-shirt and reserve rules reject useful work or overrun.
- Add automatic notifications only when an opportunity or critical event is
  missed without them and a Decision authorizes the delivery surface.
- Add any automatic reset or paid-credit effect only if the operator later asks
  for it and approves an exact provider-specific Decision; observation and
  recommendation come first.
