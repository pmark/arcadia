# Managed Production first; Flight Deck as its real workload

The operator requires two sequential Plans. This supporting guide and the strict
Asks propose the records; neither changes the current Project pointer by itself.
Read [18](./18-bootstrap-then-dogfood.md) for the cross-Plan handoff and runtime
safety contract. Do not apply the earlier single-plan proposal versions.

## Plan A: bootstrap Managed Production (14 Actions)

Proposed slug: `bootstrap-managed-production-to-build-flight-deck`. The first
Action is `define-managed-production-policy`. Milestone: a proven persistent
controller can build approved Actions from the existing Work Queue, then take
Flight Deck as its first real workload. Existing CLI/Work Queue remain usable
without any Flight Deck code. Exact proposal: [19](./19-managed-production-bootstrap-ask.yaml).

| Order | Action | Prerequisites |
| --- | --- | --- |
| 1 | `define-managed-production-policy` | None within this Plan |
| 2 | `prove-provider-capacity-admission` | `define-managed-production-policy` |
| 3 | `resolve-production-agent-and-launch-preview` | `define-managed-production-policy` |
| 4 | `connect-action-to-launch-packet` | `resolve-production-agent-and-launch-preview` |
| 5 | `support-selected-codex-and-claude-sessions` | `connect-action-to-launch-packet` |
| 6 | `expose-guarded-host-session-launch` | `support-selected-codex-and-claude-sessions` |
| 7 | `observe-portfolio-agent-sessions` | `expose-guarded-host-session-launch` |
| 8 | `reconcile-session-exits-to-next-move` | `observe-portfolio-agent-sessions` |
| 9 | `advance-approved-production-work` | `reconcile-session-exits-to-next-move`, `define-managed-production-policy` |
| 10 | `feed-and-supervise-managed-production` | `advance-approved-production-work`, `prove-provider-capacity-admission`, `expose-guarded-host-session-launch` |
| 11 | `expose-bootstrap-production-controls` | `feed-and-supervise-managed-production` |
| 12 | `prove-two-action-unattended-production` | `expose-bootstrap-production-controls` |
| 13 | `prove-multi-provider-production-recovery` | `prove-two-action-unattended-production` |
| 14 | `freeze-production-runtime-and-handoff-flight-deck` | `prove-multi-provider-production-recovery` |

## Plan B: Flight Deck (17 Actions)

Preserve the existing Plan slug and four Action identifiers. Only after Plan A
acceptance and the explicit pointer/production-scope transition does its first
Action become the controller's real input. Exact amendment: [14](./14-flight-deck-plan-amendment.yaml).

| Order | Action | Prerequisites |
| --- | --- | --- |
| 1 | `project-plan-lanes-and-pipeline-columns` | None within this Plan |
| 2 | `focus-the-board-on-active-work` | `project-plan-lanes-and-pipeline-columns` |
| 3 | `dogfood-production-building-flight-deck` | `focus-the-board-on-active-work` |
| 4 | `reuse-queue-steering-controls` | `project-plan-lanes-and-pipeline-columns` |
| 5 | `reuse-contextual-decision-controls` | `project-plan-lanes-and-pipeline-columns` |
| 6 | `control-plan-production-from-flight-deck` | `focus-the-board-on-active-work`, `reuse-queue-steering-controls`, `reuse-contextual-decision-controls` |
| 7 | `open-the-object-detail-rail` | `dogfood-production-building-flight-deck` |
| 8 | `expose-planned-portfolio-work` | `open-the-object-detail-rail` |
| 9 | `carry-the-dispatch-command` | `open-the-object-detail-rail` |
| 10 | `launch-selected-agent-from-flight-deck` | `reuse-queue-steering-controls`, `reuse-contextual-decision-controls`, `carry-the-dispatch-command` |
| 11 | `reuse-proof-and-delivery-controls` | `open-the-object-detail-rail` |
| 12 | `capture-and-correct-work-in-context` | `open-the-object-detail-rail` |
| 13 | `surface-operational-exceptions-and-changes` | `expose-planned-portfolio-work` |
| 14 | `complete-flight-deck-mobile-and-navigation-parity` | `focus-the-board-on-active-work`, `expose-planned-portfolio-work`, `launch-selected-agent-from-flight-deck`, `reuse-proof-and-delivery-controls`, `capture-and-correct-work-in-context`, `surface-operational-exceptions-and-changes` |
| 15 | `verify-flight-deck-operational-loop` | `complete-flight-deck-mobile-and-navigation-parity` |
| 16 | `dogfood-flight-deck-as-operations-home` | `verify-flight-deck-operational-loop` |
| 17 | `make-flight-deck-the-default-entrance` | `dogfood-flight-deck-as-operations-home` |

## Execution sizing and continuation

Use the current configured Claude Sonnet 5 handoff, high effort for the bootstrap
policy, capacity, admission, canonical completion and supervision boundaries;
medium for focused UI integration. Runtime routing uses the existing portable
execution profiles and supported provider bindings, not this prose as a provider
configuration. Verify installed model/effort support rather than silently guessing.

Each Action is a bounded session with an observable proof Artifact. Reuse the
named source mechanisms; deterministic checks precede model review. A missing
telemetry field is unknown, not free quota. The Ask schema cannot set all model,
execution and token-budget metadata; see the existing metadata capability
proposal. At activation, explicitly supply the supported model pin and accurate
Plan budget through governed tooling. Do not hand-edit the pointer or claim the
default one-pass generated budget describes the whole bootstrap.

Initially, normal `arcadia go` sessions build and prove the bootstrap. Thereafter
the production controller performs repeated Action admission/Session launch and
canonical advancement; the operator does not start a new coding session per
Flight Deck Action. Human product/merge authority remains explicit and answerable.

At each implementation stop, preserve code in a pushed PR, include the exact
Candidate URL/revision/recovery command and operator procedure, record proof
through canonical governance and advance only within the approved scope. No
document table or Git commit order substitutes for the Project pointer. If the
controller is repairing itself, use the controlled runtime upgrade procedure in
18 rather than executing its own unverified checkout.

## Settlement order

Publish/merge the supporting documentation under its separate authority. Preview
and settle the new inactive bootstrap Plan and Flight Deck amendment, inspect
the allocated bootstrap slug, then explicitly activate bootstrap and place its
Action segment first. The Project has one active pointer throughout. The current
Flight Deck pointer must not be mistaken for bootstrap authority before this
transition. Plan creation alone does not activate it.

When bootstrap is proven, activate Flight Deck as the next authorized Plan and
start its admitted production scope once. The first two Flight Deck Actions are
the real dogfood; the third verifies their actual controller receipts. The old
queue repair remains valid historical preservation, not final Plan A priority.
