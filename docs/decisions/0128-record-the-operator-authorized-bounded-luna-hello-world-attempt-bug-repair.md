---
arcadia: v1
type: decision
id: "0128"
slug: record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair
project: arcadia
status: approved
question: Record the operator-authorized bounded Luna Hello World attempt, bug, repair, independent validation and retry loop, retaining production Off and unrelated work in flight.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Authorize the bounded Luna Hello World loop with three attempts and two repair cycles
options:
  - label: Authorize the bounded Luna Hello World loop with three attempts and two repair cycles
    consequence: "Supersedes Decision0125 only for the attempt/retry bounds of this same no-remote Hello World fixture goal. Permit at most3 total live builder attempts, each gpt-6-luna low and at most90seconds, and at most2 Supervisor-led repair cycles. Total loop wall time is at most90minutes from its first launch, including repair/review/validation waits, persisted across restarts; source revision changes or new invocations cannot reset the goal budget. A retry requires a named failure, a changed verified fix and independent review/QA; unchanged refusals/failures, isolation violation, missing authority/evidence, expired scope, login/quota failure or exhausted limits stop and preserve findings. Existing Codex subscription access only: incremental paid spend ceiling$0, no API-billing/paid-credit/reset purchase, frontier/model/provider fallback or new infrastructure. Record provider usage when available, otherwise cost unknown; invocation and wall limits remain enforceable. Each repair cycle has one canonical Luna medium Implementer up to20minutes plus separate canonical Luna code-reviewer and QA up to5minutes each; no further delegation. The Scout is a canonical Researcher/customer using only Ask/Ask show/To-do, with deterministic validator and Lead acting as Supervisor outside it. Keep standard coding harnesses unchanged: one instruction procedure and existing commands, no new orchestrator/queue/service. Before any live attempt require all three repairs, approved exact-scope assignment, pinned clean immutable source and Node22, guarded fixture-only scope and fresh protected-state attribution witnesses, and independently reviewed evidence; preserve the historical config uncertainty instead of rewriting it. Source validation may run from the reviewed clean pinned candidate recorded in this Decision; the important-record PR still needs operator merge, as separately requested in chat. This does not authorize production On, live Project/pointer/queue writes, service installs/restarts, host config rollback/deletion, default-workspace changes, fixture GitHub/Discord/repository-remote operations, remote repository creation/deployment or Studio pilot. Supervisor may log bugs/proposals through the existing host-side intake and preserve evidence under the existing operator authorization, never through fixture side effects. Stop no later than2026-10-18T00:00:00Z (October17 at5pm Pacific), within the original experiment window. Renew any bound only by a new operator Decision."
    recommended: true
  - label: Retain Decision0125 one-attempt scope
    consequence: No repair/retry loop; preserve only the previously approved single future fixture attempt and wait for another explicit direction.
    recommended: false
confidence: high
plan: every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a
updated: 2026-10-13
answer: Authorize the bounded Luna Hello World loop with three attempts and two repair cycles
decided: 2026-10-13
---

# Decision 0128: Record the operator-authorized bounded Luna Hello World attempt, bug, repair, independent validation and retry loop, retaining production Off and unrelated work in flight.

## Options

- **Authorize the bounded Luna Hello World loop with three attempts and two repair cycles** (recommended): Supersedes Decision0125 only for the attempt/retry bounds of this same no-remote Hello World fixture goal. Permit at most3 total live builder attempts, each gpt-6-luna low and at most90seconds, and at most2 Supervisor-led repair cycles. Total loop wall time is at most90minutes from its first launch, including repair/review/validation waits, persisted across restarts; source revision changes or new invocations cannot reset the goal budget. A retry requires a named failure, a changed verified fix and independent review/QA; unchanged refusals/failures, isolation violation, missing authority/evidence, expired scope, login/quota failure or exhausted limits stop and preserve findings. Existing Codex subscription access only: incremental paid spend ceiling$0, no API-billing/paid-credit/reset purchase, frontier/model/provider fallback or new infrastructure. Record provider usage when available, otherwise cost unknown; invocation and wall limits remain enforceable. Each repair cycle has one canonical Luna medium Implementer up to20minutes plus separate canonical Luna code-reviewer and QA up to5minutes each; no further delegation. The Scout is a canonical Researcher/customer using only Ask/Ask show/To-do, with deterministic validator and Lead acting as Supervisor outside it. Keep standard coding harnesses unchanged: one instruction procedure and existing commands, no new orchestrator/queue/service. Before any live attempt require all three repairs, approved exact-scope assignment, pinned clean immutable source and Node22, guarded fixture-only scope and fresh protected-state attribution witnesses, and independently reviewed evidence; preserve the historical config uncertainty instead of rewriting it. Source validation may run from the reviewed clean pinned candidate recorded in this Decision; the important-record PR still needs operator merge, as separately requested in chat. This does not authorize production On, live Project/pointer/queue writes, service installs/restarts, host config rollback/deletion, default-workspace changes, fixture GitHub/Discord/repository-remote operations, remote repository creation/deployment or Studio pilot. Supervisor may log bugs/proposals through the existing host-side intake and preserve evidence under the existing operator authorization, never through fixture side effects. Stop no later than2026-10-18T00:00:00Z (October17 at5pm Pacific), within the original experiment window. Renew any bound only by a new operator Decision.
- **Retain Decision0125 one-attempt scope**: No repair/retry loop; preserve only the previously approved single future fixture attempt and wait for another explicit direction.

## Rationale

Direct operator instruction2026-10-13: Yes, let us build the bounded loop, record reasonable retry and cost limits, finish the three repairs and get the Luna scout running. This expressly extends the prior one-attempt no-retry limit, but retains its isolation and historical-evidence protections. The operator subsequently asked to merge main when possible; merges still require independent review, all required checks and clean state. The conditional scope grants only the exact bounds selected below; it launches no provider, changes no current Plan/queue and does not waive failed guard evidence.

Proposed by Agent Ask authorize-bounded-luna-scout-loop-20261013.
