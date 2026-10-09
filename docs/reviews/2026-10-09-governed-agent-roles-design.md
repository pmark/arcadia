# Governed agent roles: design note for the draft Plan

This note gives the rationale behind the draft Plan Ask
`plan-governed-agent-roles-2026-10-09-r3` and its thirteen Decision Asks. It is a
proposal only. It activates nothing, answers no Decision and grants no
authority. The raw input is the operator's direction of 2026-10-09. The
operator was not available for a live interview, so that text stands in for
one. Revisions r2 and r3 address the round-1 and round-2 adversarial reviews.

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

All thirteen Decisions must be answered before the draft is activated.

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
| Operator-script library entries (`kind: grant`) on the governed operator-script path | `docs/agent-guidance/operator-actions.md`, `apps/dashboard/app/api/operator-script/route.ts` | The surface for reserve release and lowering. On its own it is not proof of the operator |
| Native-session adoption | `src/sessions/hostEnrollment.ts` | One option for interactive sessions |

## Writer gaps found

- **No per-Action role or model field.** Agent Ask action children accept only
  `id`, `desired_result`, `acceptance`, `dependencies`, `references` and
  `target_ref`. Each Action states its role in its text until
  `add-action-role-field` adds the field.
- **A `plan` Ask cannot set `token_impact`, `token_budget` or
  `recommended_model`.** Settlement writes `medium`, but the true exposure is
  `large` (18 bounded Sessions). The proposal Ask
  `propose-plan-ask-token-fields-2026-10-09-r3` records this so it is not lost.
- **No operator-only proof exists.** Verified on main:
  - The dashboard says it has no auth or identity layer; its guard only
    rejects cross-origin browser requests (`apps/dashboard/lib/originGuard.ts`).
  - Operator-script receipts and run records are plain workspace files, and
    the scripts can be run from any shell.
  - `ARCADIA_OPERATOR_SCRIPT_ID` is an environment variable.
  - The preservation and go-broker transports carry nonces, not identity.
  - The Discord bot authorizes by guild and channel only.

  Hence `decide-operator-presence-proof-2026-10-09` and the
  `build-operator-presence-proof` Action. The recommended proof is a Discord
  message from the operator's pinned user id that quotes a one-time challenge.
  The verifier fetches it live and re-verifies it at each use. That proof needs
  no host secret: the verifier reads only public identity and the bot token,
  which cannot post as the operator. The threat model excludes an agent that
  edits Arcadia's installed code, which review and operator merge cover.
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
   `CapacityAdmission`.
6. Start-tier enforcement, one launch path at a time:
   `enforce-start-tier-interactive-sessions`, then
   `enforce-start-tier-dispatch-launches`, then
   `enforce-start-tier-managed-production`. The managed-production step waits
   on `decide-managed-production-start-tier-2026-10-09`.
7. `broker-delegation-requests`, then `route-subagent-spawns-through-broker`.
8. `build-operator-presence-proof`. Then `reserve-operator-emergency-capacity`,
   which depends on the selector, the broker and the proof. It supplies the
   reserve-aware implementation behind the same interface, so there is no
   dependency cycle. Then `project-token-burn-rate`.
9. `assign-supervisors-and-relay`.
10. `build-agents-overview-read-model` (CLI), then `build-agents-page`.
11. `prove-governed-role-team-end-to-end`, run by an independent QA role. Its
    interactive leg and its live reserve check are operator steps.

## Reserve rules in brief

- **Floor.** The bundled default is pinned by a test at the answered size.
  Lowering the default is therefore a visible authority change whose PR waits
  for the operator.
- **Missing or out-of-range values.** A missing key falls back to the floor,
  never 0. Values are clamped from the floor up to 100%, and 100% stops all
  unattended work.
- **Workspace overrides** may only raise the reserve.
- **Proof-backed changes.** A lowering or release is a `reserve_changes` row
  that carries its proof reference. It takes effect only while that proof
  re-verifies.
- **Grant entries.** `release-operator-reserve` (repeatable, with a fresh
  challenge on every run) and `lower-operator-reserve` (one-shot) are
  operator-script library entries (`kind: grant`), run through the governed
  operator-script path. The reserve Action prepares them in advance, never an
  agent during an emergency. After merge, the end-to-end proof Action live-verifies that
  they are listed.
- **Press surface (open).** For now the operator presses these entries wherever
  the governed path lists library entries. Whether they move to `/production`
  or `/todo` is decided when `/todo` ships.

## Broker semantics in brief

- **Expired leases.** Every broker command first sweeps them.
- **Admitted:** the request gets a model id, an advisory effort and a lease
  (60 minutes, at most two renewals). The Agent tool has no effort parameter,
  so effort is never enforced.
- **Queued:** requests wait in strict first-in, first-out order per provider,
  and no later request on that provider overtakes an earlier one. A request is
  promoted only on its own requester's `poll`, and is declined as
  `poll_lapsed` if the requester does not poll for 5 minutes, or as
  `queue_timeout` after 30 minutes.
- **Declined:** the request carries a reason code.
- **Failing closed:** an unavailable broker admits nothing, and the parent
  continues alone.
- **Headless Claude hook.** It applies only if an integration test proves that
  a `--settings` hook fires under `--setting-sources ""`. When it applies:
  - it allows one spawn per admitted receipt;
  - it compares normalised model ids, and an omitted model counts as the
    parent's;
  - only the receipt's own depth-0 caller can spend the receipt;
  - the per-Session allow list widens by the delegation commands and the hook.

## Deterministic pieces and the crutch each replaces

| Deterministic piece | Crutch it replaces |
|---|---|
| Role registry and validator | Role charters scattered through prompts and Comms briefs |
| `arcadia role brief` | Hand-pasted role prompts |
| Action `role` field and the `arcadia roles --unassigned` report | A planner's free-text role suggestion |
| `selectDelegateModel` and start-tier enforcement | The agent picking a model from prose; one model per Plan |
| Delegation broker, leases and receipts | Unrecorded in-process spawns (`Agent`, `spawn_agent`) |
| PreToolUse hook (if chosen) | Convention, for headless Claude only |
| Proof-gated reserve, operator presence proof and burn-rate throttle | The fixed 5% margin, plain-file receipts and watching usage by eye |
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
a re-verified operator presence proof. Each Action is one Session, and any repair needs
a named failure.
