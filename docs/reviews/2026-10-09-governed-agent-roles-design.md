# Governed agent roles: design note for the draft Plan

This note gives the rationale behind the draft Plan Ask
`plan-governed-agent-roles-2026-10-09-r2` and its eleven Decision Asks. It is a
proposal only. It activates nothing, answers no Decision and grants no
authority. The raw input is the operator's direction of 2026-10-09. The
operator was not available for a live interview, so that text stands in for
one. Revision r2 addresses the round-1 adversarial plan review.

## Outcome and Milestone

- **Outcome.** Every Arcadia Session runs as a small, governed team:
  - it starts on the smallest sufficient model, in one named session-start
    role;
  - every subagent is a governed role that Arcadia admits, queues or declines,
    at a deterministic model and effort;
  - every agent reports through a supervisor chain that ends at the operator;
  - token burn stays inside a budget that always keeps an operator emergency
    reserve;
  - all of it is visible at `/agents`.
- **Milestone.** One real Action and one interactive session each run end to
  end under the scheme. A light-tier session-start Session requests delegates
  through Arcadia and gets one admission, one queue and one decline, all with
  receipts. It relays to its supervisor, never touches the reserve, and
  appears on `/agents`.

All eleven Decisions must be answered before the draft is activated.

## What already exists, verified on `origin/main` 060f7fd5f

| Piece | Where | What the Plan does with it |
|---|---|---|
| Five attempt roles. Only `development` mutates; `code-review` and `qa` need independent lineage | `src/sessions/enrollment.ts:10` and `:506`, `src/sessions/roleLineage.ts` | Registry roles map onto them. The session-start role holds `development` (Lead) or none (Coordinator) |
| Builder/critic identity | `src/codingAgents/agentIdentity.ts:39` | Each role names its identity role |
| Light-tier session start and the "Calling in help" brief section | `src/codingAgents/modelTiers.ts`, `src/sessions/actionBrief.ts` | Start enforcement plus the broker replace the prose path |
| Headless Claude allow list, which includes `Agent` | `src/sessions/headlessPermissions.ts` | Widened by the delegation commands, plus an optional PreToolUse hook |
| Deterministic selection: least capable, then lowest `costRank` | `selectCompliantCodingAgent`, `config/defaults/provider-adapters.json` | Extended, not replaced. No `c1_bounded` binding exists yet |
| Per-Action `execution` vocabulary | `src/execution/profiles.ts` | The selector's task input |
| Capacity admission with a fixed 5% reserve margin | `src/codingAgents/capacity.ts:164`, inside `CAPACITY_ADMISSION_LIMITS` at `:160` | Wrapped behind a `CapacityAdmission` interface, then made reserve-aware |
| Operator attestation `production capacity attest` | `src/commands/capacity.ts` | Not accepted as proof of the operator: an agent can run it |
| `/runs` one-shot `kind: "grant"` operator scripts | `docs/agent-guidance/operator-actions.md` | The only route that can release or shrink the reserve |
| Native-session adoption | `src/sessions/hostEnrollment.ts` | One option for interactive sessions |

## Writer gaps found

- **No per-Action role or model field.** Agent Ask action children accept only
  `id`, `desired_result`, `acceptance`, `dependencies`, `references` and
  `target_ref`. Each Action states its role in its text until
  `add-action-role-field` adds the field.
- **A `plan` Ask cannot set `token_impact`, `token_budget` or
  `recommended_model`.** Settlement writes `medium`, but the true exposure is
  `large` (15 bounded Sessions). The proposal Ask
  `propose-plan-ask-token-fields-2026-10-09` records this so it is not lost.
- **Capacity observations are not stored as history.** `project-token-burn-rate`
  adds an append-only history store.
- **Name collisions:** `dispatch`, `steward` (`src/stewardship`) and
  "Brief supervisor" (`src/briefSupervisor.ts`).

## Order: smallest usable slice first

1. `define-governed-role-registry` and `arcadia roles`.
2. `render-role-brief`. Until the broker lands, it says delegation is not live
   yet and points to an Agent Ask.
3. `record-interactive-role-sessions`, so interactive sessions are visible
   from the first day.
4. `add-action-role-field`, then `teach-planners-divide-and-conquer-roles`.
5. `select-model-for-delegated-task`, which reads capacity through
   `CapacityAdmission`, then `enforce-smallest-model-session-start`.
6. `broker-delegation-requests`, then `route-subagent-spawns-through-broker`.
7. `reserve-operator-emergency-capacity`, which needs only the selector. It
   supplies the reserve-aware implementation that the broker picks up through
   the same interface, so there is no broker-reserve dependency cycle. Then
   `project-token-burn-rate`.
8. `assign-supervisors-and-relay`.
9. `build-agents-overview-read-model` (CLI), then `build-agents-page`.
10. `prove-governed-role-team-end-to-end`, run by an independent QA role. Its
    interactive leg is an operator step.

## Broker semantics in brief

- **Admitted:** the request gets a model, an effort and a lease (default 60
  minutes, renewable). A lease that expires frees its capacity.
- **Queued:** the request is re-evaluated in FIFO order whenever a delegation
  finishes, a lease expires, or the waiting requester polls. When its bounded
  wait (default 30 minutes) ends, it is declined as `queue_timeout`.
- **Declined:** the request carries a reason code.
- **Failing closed:** an unavailable broker admits nothing, and the parent
  continues alone.
- **Headless Claude hook:** it permits one spawn per admitted receipt, at the
  admitted model, and the per-Session allow list widens as stated.

## Deterministic pieces and the crutch each replaces

| Deterministic piece | Crutch it replaces |
|---|---|
| Role registry and validator | Role charters scattered through prompts and Comms briefs |
| `arcadia role brief` | Hand-pasted role prompts |
| Action `role` field and the `arcadia roles --unassigned` report | A planner's free-text role suggestion |
| `selectDelegateModel` and start-tier enforcement | The agent picking a model from prose; one model per Plan |
| Delegation broker, leases and receipts | Unrecorded in-process spawns (`Agent`, `spawn_agent`) |
| PreToolUse hook (if chosen) | Convention, for headless Claude only |
| Operator-verified reserve and burn-rate throttle | The fixed 5% margin and watching usage by eye |
| `supervisorFor` and relay | Ad hoc pings, with the operator supervising everyone |
| Interactive role receipts | Nothing: interactive sessions leave no Session row today |
| `arcadia agents overview` and `/agents` | Reading three native tools' session lists |

Crutches that remain after this Plan:

- A light coding agent plays the session-start role.
- Under the recommended supervisor option, no one actively directs a team or
  turns learning from across Sessions into changes. Every relay above a lead
  lands on the operator.
- Codex and opencode follow the broker by convention only. Spawns outside it
  are neither prevented nor detected afterwards.

## Deferred, with revival triggers

| Deferred | Revival trigger |
|---|---|
| Standing supervisor agents | A queued delegation outlives its bounded wait with no supervisor action, twice in one week |
| Detection of Codex/opencode spawns that bypass the broker | A provider exposes subagent spawn events in output Arcadia already reads, or the first unrecorded spawn is found in a provider transcript |
| Codex or opencode spawn enforcement | That provider ships a pre-spawn hook |
| A new typed agent message channel | A delegate must reach someone other than its own lead |
| Controls on `/agents` | The operator runs five or more manual queue or decline commands in one week |
| Per-agent token counts | A reserve is crossed although admission allowed every request |
| A local-model judge in selection | Three golden-table disagreements recorded against real outcomes |
| A writer for per-Action `execution` in Agent Asks | The first Plan that needs a per-Action execution profile through an Ask |
| A blocking planner lint (beyond the report) | Two activated Plans ship an Action without a role |

## Token economy

Selection, admission, queueing, leases, the reserve and the burn rate are all
deterministic and make zero model calls. Models are spent only by each Action's
Session and by admitted delegates, and never from the operator reserve without
an operator-verified receipt. Each Action is one Session, and any repair needs
a named failure.
