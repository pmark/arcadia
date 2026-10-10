---
arcadia: v1
type: plan
slug: governed-agent-roles-one-real-action-and-one-interactive-session-each-run-as-a
project: arcadia
status: active
milestone: "Governed agent roles: one real Action and one interactive session each run as a light-tier session-start role that requests delegates through Arcadia, gets a deterministic model and effort or a recorded queue or decline, reports through its supervisor chain, stays inside the burn budget and operator reserve, and appears on /agents."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-10
actions:
  - id: define-governed-role-registry
    title: "Add a checked-in governed role registry and a read-only arcadia roles command that lists each role's charter, attempt role, mutation right, delegation right, supervisor and default model tier and effort. Recommended role: implementer, standard tier. Waits on Decisions decide-session-start-role-name-2026-10-09-r2, decide-agent-role-taxonomy-2026-10-09 and decide-which-roles-may-delegate-2026-10-09-r2."
    status: open
    responsibility: agent
    effort: session
    next_action: "Add a checked-in governed role registry and a read-only arcadia roles command that lists each role's charter, attempt role, mutation right, delegation right, supervisor and default model tier and effort. Recommended role: implementer, standard tier. Waits on Decisions decide-session-start-role-name-2026-10-09-r2, decide-agent-role-taxonomy-2026-10-09 and decide-which-roles-may-delegate-2026-10-09-r2."
    expected_artifact: Evidence satisfying Agent Ask define-governed-role-registry
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - config/defaults/agent-roles.json (schema arcadia-agent-roles-v1) defines every role the answered taxonomy Decision names, each with id, purpose, attempt_role (a SESSION_ATTEMPT_ROLES value or null), identity_role (builder or critic), mutates, may_delegate, allowed_delegate_roles, max_delegation_depth, supervisor, default_tier and default_effort, and marks exactly one role as the session-start role under the answered name.
      - "The session-start role's attempt_role follows the answered name Decision: development for Lead (or Foreman), or null for Coordinator (or Dispatcher), in which case the registry also names the single implementer delegate role that holds the development attempt; a test asserts that exactly one role per Action can hold development."
      - A loader under src/agentRoles/ validates the registry and refuses, naming the offending role and field, an unknown attempt_role, a mutating role whose attempt_role is not development, a critic-identity role that mutates, a delegate role missing from the registry, and a delegation depth above the answered delegator Decision's limit; a workspace config/agent-roles.json override merges the same way config/coding-agent-models.json does.
      - Tests prove every SESSION_ATTEMPT_ROLES value maps to at least one registry role, that the code-review and qa roles require independent lineage, and that the bundled registry loads byte-stably.
      - arcadia roles --json (schema arcadia-roles-v1) and arcadia roles show <id> print the registry with zero model calls and no workspace writes.
    depends_on: []
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/sessions/enrollment.ts", "src/sessions/roleLineage.ts", "src/codingAgents/agentIdentity.ts", "src/codingAgents/modelTiers.ts"]
  - id: render-role-brief
    title: "Add arcadia role brief so any interactive or launched Session can print the governed brief for its role today, and add that role block to the Action brief. Recommended role: implementer, standard tier."
    status: open
    responsibility: agent
    effort: session
    next_action: "Add arcadia role brief so any interactive or launched Session can print the governed brief for its role today, and add that role block to the Action brief. Recommended role: implementer, standard tier."
    expected_artifact: Evidence satisfying Agent Ask render-role-brief
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - arcadia role brief --role <id> --agent <codex|claude|opencode> --tier <light|standard|heavy> prints the role's charter, what it may and may not do, its supervisor, its delegation rights, the Identity block from renderIdentityBlock, and the resolved start and escalation models; --json emits schema arcadia-role-brief-v1.
      - Until the arcadia delegation command exists, the delegation section says exactly that delegation is not live yet and that a delegate is requested through an Agent Ask (intent proposal, requested_authority propose); once the command exists, it prints the exact request command instead, and a test covers both states.
      - "With --action <plan-slug>#<action-id> the brief also quotes that Action's next action and acceptance criteria verbatim, and refuses with a named error when the Action is missing or declares no criteria, as renderActionBrief does."
      - renderActionBrief adds a Role section for the session-start role with the same text, and the existing actionBrief tests pass with updated snapshots.
      - The command makes zero model calls and writes nothing; a snapshot test pins one brief per agent.
    depends_on: [define-governed-role-registry]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/sessions/actionBrief.ts", "src/qa/prReview.ts", "src/codex/packets.ts"]
  - id: record-interactive-role-sessions
    title: "Let an interactive coding-agent session record its role start and end from day one, so it is reported the same way as managed Sessions. Recommended role: implementer, light tier. Waits on Decision decide-interactive-session-crutch-mapping-2026-10-09."
    status: open
    responsibility: agent
    effort: session
    next_action: "Let an interactive coding-agent session record its role start and end from day one, so it is reported the same way as managed Sessions. Recommended role: implementer, light tier. Waits on Decision decide-interactive-session-crutch-mapping-2026-10-09."
    expected_artifact: Evidence satisfying Agent Ask record-interactive-role-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - "Under the recommended option, arcadia role start --role <id> --agent <a> --tier <t> --label <title> [--action <plan-slug>#<action-id>] records an idempotent activity receipt with the declared tier and prints the role brief, and arcadia role end <receipt-id> --state <done|handed_off|needs_input> closes it; under the enrollment option the same is done through native-adopt enrollment."
      - arcadia role list --json shows open and recent receipts with role, agent, tier, label, Action and start time, so interactive sessions are visible before any broker or page exists.
      - A role start makes zero model calls, grants no claim or lease, and refuses an Action that another live Session claims.
      - Tests cover start, end, replay, list and claimed-Action refusal; the receipt id is the handle later delegation requests cite.
    depends_on: [define-governed-role-registry, render-role-brief]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/sessions/hostEnrollment.ts", "docs/agent-guidance/operator-directed-work.md", "docs/harness-engineering.md"]
  - id: add-action-role-field
    title: "Add an optional role field to Plan Actions and to Agent Ask action children so a Plan records each Action's recommended role, validated against the registry. Recommended role: implementer, standard tier."
    status: open
    responsibility: agent
    effort: session
    next_action: "Add an optional role field to Plan Actions and to Agent Ask action children so a Plan records each Action's recommended role, validated against the registry. Recommended role: implementer, standard tier."
    expected_artifact: Evidence satisfying Agent Ask add-action-role-field
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - The plan parser reads role on an Action into PlanActionDoc, and document validation refuses an unknown role id with the Plan, Action and field named; an Action without role stays valid.
      - arcadia agent-ask contract lists role among action fields, preview validates it against the registry, settling a plan or action Ask writes role into each created Action, and a target_ref amendment changes it.
      - arcadia roles --unassigned lists, per draft or active Plan, the open Actions that declare no role, with zero model calls.
      - Tests cover create, amend, unknown-role refusal and a legacy Action without role.
    depends_on: [define-governed-role-registry]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/docs/types.ts", "src/ask/settlement.ts", "docs/managed-documents.md", "docs/agent-guidance/agent-asks.md"]
  - id: teach-planners-divide-and-conquer-roles
    title: "Update the Staff Planning Architect prompt and the planner packet prompt so every planned Action names its recommended role and is sized for one Session in that role. Recommended role: implementer, light tier."
    status: open
    responsibility: agent
    effort: session
    next_action: "Update the Staff Planning Architect prompt and the planner packet prompt so every planned Action names its recommended role and is sized for one Session in that role. Recommended role: implementer, light tier."
    expected_artifact: Evidence satisfying Agent Ask teach-planners-divide-and-conquer-roles
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - docs/planning-process.md's Phase 2 prompt requires each Action to carry role, to split work needing two roles' authority into separate Actions, and lists role in its Deliverable.
      - The planner packet prompt rendered by src/codex/packets.ts carries the same requirement, and a test asserts the text.
      - The Phase 2 prompt names arcadia roles --unassigned as the check a planner runs before submitting its plan Ask.
    depends_on: [add-action-role-field]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "docs/planning-process.md", "src/codex/packets.ts"]
  - id: select-model-for-delegated-task
    title: "Build the deterministic just-in-time model and effort selector for a role and task, reading capacity through an admission interface, with a dry-run command and a golden table. Recommended role: implementer, standard tier, with a plan-critic review of the golden table. Waits on Decision decide-budget-pressure-model-selection-2026-10-09-r3."
    status: open
    responsibility: agent
    effort: session
    next_action: "Build the deterministic just-in-time model and effort selector for a role and task, reading capacity through an admission interface, with a dry-run command and a golden table. Recommended role: implementer, standard tier, with a plan-critic review of the golden table. Waits on Decision decide-budget-pressure-model-selection-2026-10-09-r3."
    expected_artifact: Evidence satisfying Agent Ask select-model-for-delegated-task
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - selectDelegateModel takes the role's registry defaults, the task's capability, effort and escalation triggers in src/execution/profiles.ts vocabulary, provider enablement and hard evidence, a capacity admission result, costRank, review-independence exclusion and prior attempt outcomes, and returns provider, model id, effort, every rejected candidate with its reason, and a sha256 of its normalized inputs.
      - Capacity reaches the selector only through a CapacityAdmission interface whose first implementation wraps the existing capacity admission decision unchanged (src/codingAgents/capacity.ts); a test proves a fake implementation can refuse a provider, so a reserve-aware implementation can be swapped in later without changing the selector.
      - It extends selectCompliantCodingAgent rather than replacing it, config/defaults/provider-adapters.json gains c1_bounded bindings for the light-tier models already pinned in src/codingAgents/modelTiers.ts, and one exported function normalises provider aliases (haiku, sonnet, opus and their Codex equivalents) to concrete model ids.
      - It never selects below the task's required capability, never draws on any operator reserve, behaves under budget pressure as the answered Decision says, and raises the next selection by one tier after a failed attempt at a tier, capped at heavy.
      - A checked-in golden table of at least 12 cases, including capacity refused, provider excluded and after a failure, passes, and identical inputs produce byte-identical output; arcadia delegation plan --role <id> --capability <tier> --effort <level> --json prints the selection with zero model calls and no writes.
    depends_on: [define-governed-role-registry]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/codingAgents/providerAdapters.ts", "config/defaults/provider-adapters.json", "src/execution/profiles.ts", "src/codingAgents/capacity.ts", "docs/model-selection.md"]
  - id: enforce-start-tier-interactive-sessions
    title: "Make arcadia role start check the declared start tier against the selector's smallest compliant start model for the session-start role, and require a recorded reason for anything heavier. Recommended role: implementer, light tier."
    status: open
    responsibility: agent
    effort: session
    next_action: "Make arcadia role start check the declared start tier against the selector's smallest compliant start model for the session-start role, and require a recorded reason for anything heavier. Recommended role: implementer, light tier."
    expected_artifact: Evidence satisfying Agent Ask enforce-start-tier-interactive-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - arcadia role start computes the selector's start choice for the session-start role, records it beside the declared agent and tier, and refuses a declared tier above it unless --start-reason <text> is given; the reason is recorded and printed.
      - arcadia role list --json reports declared tier, selector tier and reason, and a receipt without a recorded tier reads as unknown, never light.
      - Tests cover the default light start, a heavier declared start refused without a reason, and the same start accepted with a reason.
    depends_on: [record-interactive-role-sessions, select-model-for-delegated-task]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/codingAgents/modelTiers.ts", "docs/model-selection.md"]
  - id: enforce-start-tier-dispatch-launches
    title: "Make arcadia go --launch, arcadia session launch and the dashboard launch start on the selector's smallest compliant start model, record the start, and refuse a heavier start without a reason. Recommended role: implementer, standard tier."
    status: open
    responsibility: agent
    effort: session
    next_action: "Make arcadia go --launch, arcadia session launch and the dashboard launch start on the selector's smallest compliant start model, record the start, and refuse a heavier start without a reason. Recommended role: implementer, standard tier."
    expected_artifact: Evidence satisfying Agent Ask enforce-start-tier-dispatch-launches
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - Each of the three dispatch launch paths chooses the start model with selectDelegateModel for the session-start role, and records start tier, model id, effort, selector input hash and start reason on the Session or enrollment row.
      - "A plan pin counts as follows: a plan's recommended_model is the escalation target and never raises the start; when a workspace sets sessionStartTier to plan, the start uses the plan's tier with a reason derived automatically as plan_pin:<plan-slug>:<tier>; an explicit --model above the selector's choice, or a sessionStartTier override above it, is refused unless --start-reason <text> is given."
      - arcadia go and the Action brief print start model, tier and reason, and arcadia session show --json reports them; a Session without a recorded start tier reads as unknown.
      - Tests cover the default light start, a plan_pin start, an explicit heavier start refused without a reason and accepted with one, for each launch path.
    depends_on: [enforce-start-tier-interactive-sessions]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/commands/go.ts", "src/sessions/actionBrief.ts", "src/codingAgents/modelTiers.ts", "docs/model-selection.md"]
  - id: enforce-start-tier-managed-production
    title: "Apply the answered start-tier rule to the managed-production tick. Recommended role: implementer, standard tier. Waits on Decision decide-managed-production-start-tier-2026-10-09, because managed production is an approval boundary."
    status: open
    responsibility: agent
    effort: session
    next_action: "Apply the answered start-tier rule to the managed-production tick. Recommended role: implementer, standard tier. Waits on Decision decide-managed-production-start-tier-2026-10-09, because managed production is an approval boundary."
    expected_artifact: Evidence satisfying Agent Ask enforce-start-tier-managed-production
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - Under the recommended option, the tick records start tier, model id, effort and reason on every Session it launches without changing which model it starts; under the enforcement option, it chooses the start with selectDelegateModel and derives a heavier start's reason from the packet's plan pin.
      - Nothing in this Action changes production behavior beyond what the answered Decision states, and a test proves the tick's existing launch tests still pass.
      - arcadia production status --json reports each live Session's start tier and reason.
    depends_on: [enforce-start-tier-dispatch-launches]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/production/tick.ts", "docs/model-selection.md"]
  - id: broker-delegation-requests
    title: "Build the delegation broker: arcadia delegation request admits, queues or declines a subagent request with a recorded receipt and lease, and arcadia delegation finish closes it. Recommended role: implementer, standard tier. Waits on Decisions decide-which-roles-may-delegate-2026-10-09-r2 and decide-delegation-admission-semantics-2026-10-09-r3."
    status: open
    responsibility: agent
    effort: session
    next_action: "Build the delegation broker: arcadia delegation request admits, queues or declines a subagent request with a recorded receipt and lease, and arcadia delegation finish closes it. Recommended role: implementer, standard tier. Waits on Decisions decide-which-roles-may-delegate-2026-10-09-r2 and decide-delegation-admission-semantics-2026-10-09-r3."
    expected_artifact: Evidence satisfying Agent Ask broker-delegation-requests
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - A migration adds a delegation_requests store; each row records request id, the requester's agent, tier, role, depth and Session id or role-start receipt, the Project and Action when known, requested role, one-line task, requested capability and advisory effort, verdict (admitted, queued, declined, spawned, finished or expired), reason code, the provider, model id and effort from selectDelegateModel, supervisor, lease expiry, renewal count and timestamps; replaying a request id returns the original receipt and changed content under it is refused.
      - "Every broker command first sweeps expired leases (marking them expired and freeing their capacity) before doing anything else, and admission is deterministic: it declines a role the registry does not let the requester delegate to, a depth above the limit, and a code-reviewer or qa request made as an in-process child of the mutating Session (returning the existing independent review path instead); it queues when the per-lead or per-provider concurrency cap is reached or the CapacityAdmission interface refuses."
      - "The queue is strict first-in, first-out per provider: no later request on a provider is admitted while an earlier one for that provider is queued, and requests on other providers are unaffected. A queued request is promoted only by its own requester's arcadia delegation poll <id>; one not polled for 5 minutes is declined as poll_lapsed, and one still not admissible after its bounded wait (default 30 minutes) is declined as queue_timeout."
      - Every admitted receipt carries a lease with a default TTL of 60 minutes and at most two renewals through arcadia delegation renew <id>, so no receipt holds capacity for more than 3 hours.
      - "The broker fails closed: when it cannot read or write its store, or any check errors, it returns no admission with reason broker_unavailable and the caller is told to continue without the delegate; arcadia delegation finish <id> --outcome <done|failed|abandoned> and arcadia delegation list --json work as described, and tests cover admit, each decline reason, queue order, promotion only on the requester's poll, poll_lapsed, queue_timeout, lease expiry swept on an unrelated call, the renewal cap, broker_unavailable, replay and refused changed replay, with zero model calls."
    depends_on: [select-model-for-delegated-task, record-interactive-role-sessions]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/db/schema.ts", "src/sessions/roleLineage.ts", "src/qa/prReview.ts"]
  - id: route-subagent-spawns-through-broker
    title: "Make every Session brief and the headless Claude settings route subagent spawns through the delegation broker, replacing the prose-only Calling in help path. Recommended role: implementer, standard tier. Waits on Decision decide-delegation-admission-semantics-2026-10-09-r3 for the enforcement mechanism."
    status: open
    responsibility: agent
    effort: session
    next_action: "Make every Session brief and the headless Claude settings route subagent spawns through the delegation broker, replacing the prose-only Calling in help path. Recommended role: implementer, standard tier. Waits on Decision decide-delegation-admission-semantics-2026-10-09-r3 for the enforcement mechanism."
    expected_artifact: Evidence satisfying Agent Ask route-subagent-spawns-through-broker
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - renderCallingInHelp is replaced by a section telling the agent to run arcadia delegation request first and to spawn only an admitted delegate with the returned model, passing the effort to the delegate as advisory text because the Claude Agent tool has no effort parameter; on queued it continues other work and polls, on declined, poll_lapsed or broker_unavailable it proceeds without the delegate or files an Agent Ask.
      - An integration test against the installed claude binary proves whether a PreToolUse hook from the --settings file fires under --setting-sources empty; if it does not, the hook is not installed, the brief says enforcement is by convention only, and the test records that result.
      - If the answered Decision chooses hook enforcement and the proof passes, the Arcadia-written headless Claude settings add a PreToolUse rule on the Agent tool that permits a spawn only when an admitted, unexpired, unspawned receipt exists for that Session at depth 0, the normalised model of the Agent call (an omitted model counting as the parent Session's model) equals the receipt's model id, and the hook input identifies the receipt's own caller rather than a subagent; it marks the receipt spawned so a second spawn on one receipt is denied, and denies when the broker is unavailable. Tests cover each case, and if Claude's hook input cannot distinguish a subagent caller, the brief records that gap.
      - The headless Claude per-Session allow list widens by exactly the delegation request, poll, renew and finish commands and the hook command; the widening is called out in the brief and in START_HERE.md, and the headlessPermissions tests prove nothing else is widened.
      - The Codex and opencode briefs state the convention and say plainly that spawns outside the broker are neither prevented nor detected afterwards for those providers; existing actionBrief and headlessPermissions tests pass with updated snapshots.
    depends_on: [render-role-brief, broker-delegation-requests]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/sessions/actionBrief.ts", "src/sessions/headlessPermissions.ts", "docs/model-selection.md", "START_HERE.md"]
  - id: build-operator-presence-proof
    title: "Build the operator presence proof the answered Decision selects, so a reserve release or lowering can be accepted only on proof no agent process on this host can produce. Recommended role: implementer, standard tier, with an independent code-reviewer. Waits on Decision decide-operator-presence-proof-2026-10-09."
    status: open
    responsibility: agent
    effort: session
    next_action: "Build the operator presence proof the answered Decision selects, so a reserve release or lowering can be accepted only on proof no agent process on this host can produce. Recommended role: implementer, standard tier, with an independent code-reviewer. Waits on Decision decide-operator-presence-proof-2026-10-09."
    expected_artifact: Evidence satisfying Agent Ask build-operator-presence-proof
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - "arcadia operator presence challenge --scope <scope> creates a one-time challenge (random code, scope and expiry of at most 15 minutes), and arcadia operator presence verify <challenge-id> accepts only the answered proof: under the recommended option, a message in the configured operator channel, fetched live from the Discord API by the verifier, whose author id equals the operator Discord user id pinned in checked-in config/operator-identity.json and whose content contains the challenge code; under the passkey option, a WebAuthn assertion over the challenge verifying against the public key pinned in the same file."
      - A verified proof is stored as a reference (message id or assertion) bound to its challenge and scope, and is re-verified live each time it is used; nothing on the host holds a secret that can manufacture a proof (the verifier reads only the pinned public identity and, for Discord, the bot token the bot already holds, which cannot post as the operator).
      - "Refusal tests, each returning operator_proof_required: a forged receipt.json under artifacts/generated/operator-scripts/runs, a direct shell run of the operator script with no proof, ARCADIA_OPERATOR_SCRIPT_ID set by hand, a proof row written straight into the workspace database, a replayed or expired challenge, a message from another author, and a challenge for a different scope; a valid proof against a faked Discord API or authenticator is accepted."
      - A test pins the hash of config/operator-identity.json, so changing the pinned operator identity is a visible authority change whose pull request waits for the operator.
    depends_on: []
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "apps/dashboard/lib/originGuard.ts", "apps/dashboard/app/api/operator-script/route.ts", "src/operatorActions/operatorExecution.ts", "apps/discord-bot", "docs/agent-guidance/operator-actions.md"]
  - id: reserve-operator-emergency-capacity
    title: "Supply a reserve-aware CapacityAdmission implementation whose operator emergency reserve no agent can spend or shrink, with its operator-script grant entries prepared in advance. Recommended role: implementer, standard tier. Waits on Decisions decide-burn-rate-and-emergency-reserve-2026-10-09-r3 and decide-operator-reserve-size-2026-10-09-r3."
    status: open
    responsibility: agent
    effort: session
    next_action: "Supply a reserve-aware CapacityAdmission implementation whose operator emergency reserve no agent can spend or shrink, with its operator-script grant entries prepared in advance. Recommended role: implementer, standard tier. Waits on Decisions decide-burn-rate-and-emergency-reserve-2026-10-09-r3 and decide-operator-reserve-size-2026-10-09-r3."
    expected_artifact: Evidence satisfying Agent Ask reserve-operator-emergency-capacity
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - "config/defaults/token-budget.json (schema arcadia-token-budget-v1) sets the reserve per provider window at the answered size and replaces the fixed reserveMarginPercentage (src/codingAgents/capacity.ts:164); a test pins that bundled value at the answered size, so lowering the default is a visible authority change whose pull request waits for the operator; a missing key falls back to the answered size, never 0; values are clamped to the range from the answered size to 100, and 100 is documented as stopping all unattended work."
      - A workspace config/token-budget.json may only raise the reserve; a lower value is ignored and reported by arcadia production capacity. An operator-approved lowering or release is stored only as a row in a reserve_changes workspace table that carries its operator presence proof reference, and it takes effect only while that proof re-verifies.
      - "Releasing reserve and lowering it are offered as two entries prepared by this Action, ahead of any emergency: an operator-script library entry (kind grant) run through the governed operator-script path. They are named release-operator-reserve (repeatable, each run needing a fresh challenge) and lower-operator-reserve (one-shot). Each issues a presence challenge and waits for the proof, so a direct shell run without the proof changes nothing. No agent prepares or edits these entries during an emergency."
      - Any agent-invoked reserve use or change without a valid proof is refused with operator_proof_required, with tests for a CLI call, a workspace-file edit, a forged receipt file, a direct script run and a replayed proof; every consumer of the CapacityAdmission interface (production admission, the selector and the delegation broker) refuses or queues work on a window that has reached the reserve, with reason operator_reserve, and a stale or missing observation never counts as available capacity.
      - "arcadia production capacity shows each window's reserve, its remaining non-reserve allowance and any active proof-backed release. The surface where the operator presses the entries is open: it is wherever the governed operator-script path lists library entries today, and moving it to /production or the upcoming /todo is decided when /todo ships."
    depends_on: [select-model-for-delegated-task, broker-delegation-requests, build-operator-presence-proof]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/codingAgents/capacity.ts", "src/commands/capacity.ts", "src/production/policy.ts", "docs/agent-guidance/operator-actions.md", "docs/plans/provider-capacity-harvesting.md"]
  - id: project-token-burn-rate
    title: "Store capacity observations as history, compute each provider window's burn rate and projected time to the reserve, and throttle new delegations and then new Sessions when the reserve would be crossed before reset. Recommended role: implementer, standard tier."
    status: open
    responsibility: agent
    effort: session
    next_action: "Store capacity observations as history, compute each provider window's burn rate and projected time to the reserve, and throttle new delegations and then new Sessions when the reserve would be crossed before reset. Recommended role: implementer, standard tier."
    expected_artifact: Evidence satisfying Agent Ask project-token-burn-rate
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - Each capacity refresh appends its normalized observation to a bounded append-only history store, and burn rate per provider window is derived from it deterministically, with an explicit unknown state when samples are too few or stale.
      - When projected use reaches the reserve before the window resets, the reserve-aware CapacityAdmission queues new delegations with reason burn_rate; if the projection still crosses, production admission stops admitting new Sessions; both lift when the projection clears.
      - arcadia production capacity --json reports burn rate, projected reserve-crossing time, reset time and throttle state per window.
      - Tests with fixture observation series cover steady, spiking, too-few-samples and post-reset cases, with zero model calls.
    depends_on: [reserve-operator-emergency-capacity]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/codingAgents/capacity.ts", "src/production/policy.ts"]
  - id: assign-supervisors-and-relay
    title: "Resolve a supervisor for every agent deterministically, give each role a relay path to it, and add a read-only team view. Recommended role: implementer, standard tier. Waits on Decisions decide-supervisor-chain-2026-10-09-r2 and decide-inter-agent-channel-2026-10-09."
    status: open
    responsibility: agent
    effort: session
    next_action: "Resolve a supervisor for every agent deterministically, give each role a relay path to it, and add a read-only team view. Recommended role: implementer, standard tier. Waits on Decisions decide-supervisor-chain-2026-10-09-r2 and decide-inter-agent-channel-2026-10-09."
    expected_artifact: Evidence satisfying Agent Ask assign-supervisors-and-relay
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - supervisorFor returns, for any delegate, Session or role-start receipt, its supervisor as the answered supervisor-chain Decision defines, ending at operator, and every delegation receipt records it.
      - A relay to a supervisor uses the answered channel; under the reuse option it is an Agent Ask with intent proposal whose references cite the requester's delegation, Session or role-start id, and arcadia agents team --session <id> --json lists the team and its relays.
      - The role brief lists the duties the answered Decision assigns to each supervisor and maps each to an existing command, and states plainly any duty no agent performs (under the recommended option, team direction and cross-Session learning above the lead).
      - Tests prove the chain ends at the operator for every registry role, and that no relay can approve, settle or dispatch anything.
    depends_on: [render-role-brief, broker-delegation-requests]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "docs/agent-guidance/agent-peer-watch.md", "docs/agent-guidance/agent-comms.md", "src/agentWatch/classify.ts", "src/production/stallDetection.ts"]
  - id: build-agents-overview-read-model
    title: "Build the read-only arcadia agents overview read model that joins Sessions, role-start receipts, delegations, supervisors, start tiers and per-provider burn and reserve state. Recommended role: implementer, standard tier."
    status: open
    responsibility: agent
    effort: session
    next_action: "Build the read-only arcadia agents overview read model that joins Sessions, role-start receipts, delegations, supervisors, start tiers and per-provider burn and reserve state. Recommended role: implementer, standard tier."
    expected_artifact: Evidence satisfying Agent Ask build-agents-overview-read-model
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - arcadia agents overview --json (schema arcadia-agents-overview-v1) returns a team tree per Session or role-start receipt with role, supervisor, delegates and their verdicts, provider, model and effort, start tier and reason, last activity and state, plus per-provider burn rate, reserve and throttle state.
      - States come only from governed rows and peer-watch classification; anything unreadable is unknown, never healthy, and stale data carries its age.
      - Fixture tests cover an active team, a queued and a declined delegation, an expired lease, an interactive session and a throttled provider, with zero model calls and no writes.
    depends_on: [record-interactive-role-sessions, assign-supervisors-and-relay, project-token-burn-rate, enforce-start-tier-dispatch-launches]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "src/timeline", "src/agentWatch/classify.ts", "docs/proposals/operator-timeline.md"]
  - id: build-agents-page
    title: "Add the dashboard /agents page that renders the agents overview read model. Recommended role: implementer, standard tier, with a qa review. Waits on Decision decide-agents-page-scope-2026-10-09-r3."
    status: open
    responsibility: agent
    effort: session
    next_action: "Add the dashboard /agents page that renders the agents overview read model. Recommended role: implementer, standard tier, with a qa review. Waits on Decision decide-agents-page-scope-2026-10-09-r3."
    expected_artifact: Evidence satisfying Agent Ask build-agents-page
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - /agents renders arcadia agents overview without recomputing any state, showing each team tree and the per-provider burn rate, reserve and throttle state, with unknown and stale states labelled.
      - The page is read-only under the recommended option; any control the answered Decision adds calls an existing command and leaves a receipt, and no control can release or shrink the operator reserve without the operator presence proof.
      - START_HERE.md names the route, and a dashboard test renders the read model's fixtures.
    depends_on: [build-agents-overview-read-model]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "apps/dashboard/app/production", "START_HERE.md"]
  - id: prove-governed-role-team-end-to-end
    title: "Prove the scheme on one Action and one interactive session: a light-tier session-start Session gets one admitted, one queued and one declined delegation, relays to its supervisor, stays outside the reserve, and appears on /agents. Recommended role: qa, standard tier, independent of the implementers; the interactive leg and the reserve check are operator steps."
    status: open
    responsibility: agent
    effort: session
    next_action: "Prove the scheme on one Action and one interactive session: a light-tier session-start Session gets one admitted, one queued and one declined delegation, relays to its supervisor, stays outside the reserve, and appears on /agents. Recommended role: qa, standard tier, independent of the implementers; the interactive leg and the reserve check are operator steps."
    expected_artifact: Evidence satisfying Agent Ask prove-governed-role-team-end-to-end
    clarification: clarified
    confidence: high
    source: Agent Ask plan-governed-agent-roles-2026-10-09-r3
    acceptance_criteria:
      - An offline fast-rehearsal test drives a fixture Action through a light-tier launch in the session-start role with a recorded start tier, one admitted delegate whose model equals selectDelegateModel's choice, one queued delegate promoted on its requester's poll, one declined delegate, one expired lease, one supervisor relay and Session completion, asserting every receipt.
      - In an operator step, the operator starts one interactive session that runs arcadia role start, arcadia delegation request and arcadia role end; the QA Session records that session's receipt ids in the completion evidence and checks them.
      - After the reserve Action has merged, the live /api/operator-script response lists release-operator-reserve and lower-operator-reserve with kind grant, and in an operator step one release challenge is completed with the answered presence proof and then expires; the QA Session records both receipts.
      - arcadia agents overview --json and the /agents page show both teams with the correct roles, supervisors, verdicts, start tiers and reserve state, no delegation in either run consumed the operator reserve, and the headless Claude Session shows no subagent spawn without an admitted receipt.
    depends_on: [route-subagent-spawns-through-broker, build-agents-page]
    decisions: []
    references: ["docs/reviews/2026-10-09-governed-agent-roles-design.md", "docs/harness-engineering.md", "docs/agent-guidance/operator-actions.md"]
questions: []
decisions: []
current_action: define-governed-role-registry
recommended_model: standard
recommended_reasoning_effort: medium
---

# Governed agent roles: one real Action and one interactive session each run as a light-tier session-start role that requests delegates through Arcadia, gets a deterministic model and effort or a recorded queue or decline, reports through its supervisor chain, stays inside the burn budget and operator reserve, and appears on /agents.

Created as an inactive draft from accepted Agent Ask plan-governed-agent-roles-2026-10-09-r3; creation changed no pointer. Current activation is recorded in frontmatter.
