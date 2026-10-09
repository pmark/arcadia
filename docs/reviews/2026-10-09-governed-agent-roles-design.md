# Governed agent roles: design note for the draft Plan

This is supporting rationale for the draft Plan Ask
`plan-governed-agent-roles-2026-10-09` and its ten Decision Asks. It is a
proposal only: it activates nothing, answers no Decision, and grants no
authority. Operator direction of 2026-10-09 is the raw input; the operator was
not available for a live interview, so that text stands in for one.

## Outcome and Milestone

- **Outcome.** Every Arcadia Session runs as a small, governed team: it starts
  on the smallest sufficient model in one named session-start role, every
  subagent is a governed role that Arcadia admits, queues or declines at a
  deterministic model and effort, every agent reports through a supervisor
  chain that ends at the operator, and token burn stays inside a budget that
  always keeps an operator emergency reserve, all visible at `/agents`.
- **Milestone.** One real Action and one interactive session each run end to
  end under the scheme: a light-tier session-start Session requests delegates
  through Arcadia, gets one admission, one queue and one decline with
  receipts, relays to its supervisor, never touches the reserve, and appears
  on `/agents`.

## What already exists, verified on `origin/main` 060f7fd5f

| Piece | Where | What the Plan does with it |
|---|---|---|
| Five attempt roles; only `development` mutates; `code-review` and `qa` need independent lineage | `src/sessions/enrollment.ts:10`, `:506`; `src/sessions/roleLineage.ts` | Registry roles map onto them; lineage stays the enforcement |
| Builder/critic identity | `src/codingAgents/agentIdentity.ts:39` | Each role names its identity role |
| Light-tier session start and the "Calling in help" brief section | `src/codingAgents/modelTiers.ts` (`sessionStartTier`), `src/sessions/actionBrief.ts` (`renderCallingInHelp`) | The broker replaces the prose path |
| Headless Claude allow list, including `Agent` | `src/sessions/headlessPermissions.ts` | Add the delegation commands; optional PreToolUse hook |
| Deterministic least-capable, lowest-`costRank` selection | `selectCompliantCodingAgent`, `config/defaults/provider-adapters.json` | Extended, not replaced; no `c1_bounded` binding exists yet |
| Per-Action `execution` profile vocabulary (capability, effort, `delegation`, escalation triggers) | `src/execution/profiles.ts` | The selector's task input |
| Capacity admission with a fixed 5% reserve margin | `src/codingAgents/capacity.ts:160` | Becomes the configurable operator reserve |
| Native-session adoption into a governed Session | `src/sessions/hostEnrollment.ts` (`native-adopt`) | Option for interactive sessions |
| Peer-watch classifier, Comms role, operator timeline | `src/agentWatch/`, `docs/agent-guidance/agent-comms.md`, `src/timeline/` | Inputs to `/agents` and supervisor monitoring |

Gaps found while verifying the writers:

- **No per-Action role or model field.** `recommended_model` is per Plan, and
  Agent Ask action children accept only `id`, `desired_result`, `acceptance`,
  `dependencies`, `references` and `target_ref`. So the recommended role sits
  in each Action's `desired_result` for now, and adding the field is its own
  Action (`add-action-role-field`).
- **A `plan` Ask cannot set `token_impact`, `token_budget` or
  `recommended_model`.** Settlement writes `token_impact: medium` and a stock
  budget. This Plan's true exposure is `large` (13 bounded Sessions); fixing
  that needs a governed amendment after creation, or a settlement writer
  change. That is recorded here so it is not lost.
- **Capacity observations are not stored as history.** Only operator
  attestations persist, so a burn rate needs an append-only observation store
  first.
- **Name collisions.** `dispatch` (dispatch journal), `steward`
  (`src/stewardship`) and "Brief supervisor" (`src/briefSupervisor.ts`) are
  already in use. The role-name Decision avoids the first two, and the
  supervisor Decision says the role is a relationship, not that process.

## Order: smallest usable slice first

1. Role registry plus `arcadia roles` (read-only data).
2. `arcadia role brief`, which interactive sessions can use the same day.
3. Action `role` field, then the planner prompt and lint that require it.
4. Deterministic model+effort selector with a golden table.
5. Delegation broker (admit, queue, decline, receipts).
6. Briefs and headless settings route spawns through the broker.
7. Operator emergency reserve, then the burn-rate projection and throttle.
8. Supervisor resolution and relay; interactive role receipts.
9. The `/agents` page over one read model.
10. End-to-end proof by an independent QA role.

Each Action names its recommended role and tier in its text, and each Action
that waits on an open Decision says which.

## Deterministic pieces and the crutch each replaces

| Deterministic piece | Crutch it replaces |
|---|---|
| Role registry and validator | Role charters scattered through prompts, Comms briefs and an agent's own judgment of its job |
| `arcadia role brief` | Hand-pasted role prompts (planning-process prompts, Comms briefs) |
| Action `role` field and lint | A planner's free-text role suggestion |
| `selectDelegateModel` | The agent picking `sonnet` or `opus` from the "Calling in help" prose, and one per-Plan model for every task |
| Delegation broker and receipts | Unrecorded in-process subagent spawns (`Agent`, `spawn_agent`) at the agent's discretion |
| PreToolUse hook (if chosen) | Convention, for headless Claude only |
| Configurable reserve and burn-rate throttle | The fixed 5% margin and the operator watching usage by eye |
| `supervisorFor` and relay | Ad hoc pings and chat; the operator acting as every agent's supervisor |
| Interactive role receipts | Nothing: interactive sessions leave no Session row today |
| `arcadia agents overview` and `/agents` | Reading three native tools' session lists |

Crutches that stay, by convention, after this Plan: a light coding agent
plays the session-start role; supervisor duties above the lead are done by the
operator through `arcadia todo` and pings; Codex and opencode follow the
broker by convention because they have no pre-spawn hook.

## Deferred, with revival triggers

| Deferred | Revival trigger |
|---|---|
| Standing supervisor agents | A queued delegation outlives its bounded wait with no supervisor action, twice in one week |
| A new typed agent message channel | A delegate must reach someone other than its own lead |
| Controls on `/agents` | The operator runs five or more manual queue or decline commands in one week |
| Per-agent token counts | A reserve is crossed although admission allowed every request |
| A local-model judge in selection | Three golden-table disagreements recorded against real outcomes |
| A writer for per-Action `execution` in Agent Asks | The first Plan that needs a per-Action execution profile through an Ask |
| Codex or opencode spawn enforcement | That provider ships a pre-spawn hook |
| Roles beyond the answered taxonomy | A planned Action that no registry role can own |

## Token economy

All selection, admission, queueing, reserve and burn-rate logic is
deterministic and makes zero model calls. Models are spent only by the Session
doing an Action and by admitted delegates, bounded by the reserve. Each Action
is one Session; repairs need a named failure.
