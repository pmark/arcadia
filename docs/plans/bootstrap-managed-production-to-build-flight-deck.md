---
arcadia: v1
type: plan
slug: bootstrap-managed-production-to-build-flight-deck
project: arcadia
status: draft
milestone: Bootstrap managed production to run unattended from the GitHub board
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-10
actions:
  - id: implement-evidence-bound-action-completion
    title: Implement the operator-settled managed-Action completion routine so bootstrap work can advance from accepted evidence without hand-editing governance.
    status: done
    responsibility: agent
    effort: session
    next_action: Implement the operator-settled managed-Action completion routine so bootstrap work can advance from accepted evidence without hand-editing governance.
    expected_artifact: Evidence satisfying Agent Ask implement-evidence-bound-action-completion
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Extend the existing Agent Ask settlement and canonical writer rather than introducing a parallel completion command, approval store or queue.
      - Bind one exact Project, Plan and Action, Candidate revision, criterion-level acceptance evidence and required review to a preview; changed documents, evidence or revision invalidate it.
      - Refuse missing, failed or skipped required validation, unresolved blocking review and absent operator authority; passing tests or a merged PR alone never imply acceptance.
      - One operator-settled recoverable transition records accepted evidence, marks the managed Action done, appends its Log and resolves the next governed Action, question, external blocker or completed Plan without leaving a done dispatch pointer.
      - Replays and injected failures across document, commit, projection and receipt boundaries preserve one recoverable outcome without duplicate Logs or skipped Actions; no inactive Plan is inferred from queue order.
      - Prove the operator completion path in temporary repositories, preserve a runnable exact-preview QA procedure and use it for this Action's own completion only after the operator accepts its evidence.
      - Grant no automatic acceptance, Session launch, merge, deployment, spending or production authority; the later policy and production reconciliation Actions reuse this routine under separately approved scope.
    depends_on: []
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "docs/proposals/complete-managed-action-from-evidence.md", "src/ask/settlement.ts", "src/docs/dispatch.ts", "src/dispatch/pointer.ts"]
  - id: define-managed-production-policy
    title: Persist a bounded Active/Inactive production policy and admission authority in the existing workspace.
    status: done
    responsibility: agent
    effort: session
    next_action: Persist a bounded Active/Inactive production policy and admission authority in the existing workspace.
    expected_artifact: Evidence satisfying Agent Ask define-managed-production-policy
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Activation previews included Projects/Plans, ordered Action scope, providers, concurrency and permitted mechanical validation/acceptance/pointer transitions; new scope and consequential authority require explicit judgment.
      - Persist desired state, revision/epoch and authority receipt; default Inactive on first setup, preserve valid Active state across restart and never resurrect revoked policy.
      - Off fences new admissions and queued-but-unlaunched production work before confirmation; default lets committed running work finish/reconcile, with exact displayed consequence.
      - Policy state remains accessible when queue/provider reads or execution block; race tests define the cutoff for already-committed launches.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
      - Define measurable control deadlines and bounded attempt budgets from contract 20; policy-store failure cannot report confirmed Off or admit new work.
      - Carry the operator's whole-Plan intent in the policy scope; routine implementation and mechanical continuation require no per-Action relay. Genuine judgments show the affected objective, current evidence and two or more meaningful options with consequences and a recommendation.
    depends_on: [implement-evidence-bound-action-completion]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/commands/worker.ts", "src/sessions/index.ts", "src/db/schema.ts"]
  - id: prove-provider-capacity-admission
    title: Prove and reuse existing Codex and Claude telemetry for unattended included-capacity admission.
    status: done
    responsibility: agent
    effort: session
    next_action: Prove and reuse existing Codex and Claude telemetry for unattended included-capacity admission.
    expected_artifact: Evidence satisfying Agent Ask prove-provider-capacity-admission
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Reuse availability.ts observers and the provider-capacity-harvesting receipt contract; record real supported windows, source, observed age, reset, account scope and included/paid/unknown policy.
      - Unattended admission rejects unknown/stale capacity and unknown paid mode with a visible reason; an explicit bounded manual receipt is labeled and is not indefinite unattended proof.
      - Refresh with deadlines/backoff and no model calls; after an observed reset, automatically refresh and readmit while Active. Do not redeem resets, buy credits or enable paid fallback.
      - Reuse compliant provider selection after admission filters; a limited provider permits a different eligible configured provider, without weaker substitution or replaying partial work blindly.
      - Prove supported host telemetry for each configured provider during authorized rehearsal; unavailable fields remain explicit and do not require invented comparable daily/weekly metrics.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
    depends_on: [define-managed-production-policy]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/codingAgents/availability.ts", "src/codingAgents/providerAdapters.ts", "docs/plans/provider-capacity-harvesting.md", "docs/plans/agent-advance-queue.md"]
  - id: resolve-production-agent-and-launch-preview
    title: Preview execution with automatic coding-agent selection and an exact bounded launch contract.
    status: done
    responsibility: agent
    effort: session
    next_action: Preview execution with automatic coding-agent selection and an exact bounded launch contract.
    expected_artifact: Evidence satisfying Agent Ask resolve-production-agent-and-launch-preview
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Reuse selectCompliantCodingAgent and portable execution requirements; automatic selection shows agent, model, effort, rationale and binding provenance without an operator provider choice.
      - Bind Action/doc_ref, current documents, queue revision, packet hash, authorizing Decisions, repository/base and binding to a launch preview and request id.
      - Selection accounts for launch-adapter availability, rejects unsatisfied requirements without downgrade, and never silently changes an immutable packet provider.
      - Preview starts no process and performs no Git mutation; expose missing packet, stale pointer, unavailable provider and conflicting execution as named prerequisites.
      - "Preserve the proof Artifact: Selection and launch-preview contract fixtures including both providers; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
      - Bind criterion-level validation and required review to the packet; preserve capability floors regardless of remaining provider capacity.
    depends_on: [define-managed-production-policy]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/codingAgents/providerAdapters.ts", "src/execution/profiles.ts", "src/commands/go.ts", "src/sessions/index.ts"]
  - id: connect-action-to-launch-packet
    title: Connect a dispatchable Action to its existing preparation and approval path before launch.
    status: done
    responsibility: agent
    effort: session
    next_action: Connect a dispatchable Action to its existing preparation and approval path before launch.
    expected_artifact: Evidence satisfying Agent Ask connect-action-to-launch-packet
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Handle no packet, planning required, planning approval pending, build packet ready and stale packet as separate states with one usable existing remedy.
      - Reuse planning preparation, immutable packet authorization and accepted-plan promotion; no second packet format or approval store is introduced.
      - Preserve the exact Action and selection provenance through preparation; no planning-only approval becomes implementation authority.
      - Prepare isolated work through extracted canonical mechanics and never invoke generic go/apply reconciliation as an implicit launch side effect.
      - "Preserve the proof Artifact: Packet lifecycle and authority-boundary integration fixtures; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
    depends_on: [resolve-production-agent-and-launch-preview]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/execution/planningPreparation.ts", "src/execution/planningAuthorization.ts", "src/sessions/index.ts", "src/commands/go.ts", "apps/dashboard/app/api/projects/[id]/continuation/route.ts"]
  - id: support-selected-codex-and-claude-sessions
    title: Launch the selected Codex or Claude adapter through the canonical Session subsystem.
    status: done
    responsibility: agent
    effort: session
    next_action: Launch the selected Codex adapter through the canonical Session subsystem, with a provider interface that does not have to be reworked when Claude session launch is added in prove-multi-provider-production-recovery.
    expected_artifact: Evidence satisfying Agent Ask support-selected-codex-and-claude-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask apply-8020-yagni-to-bootstrap-plan-2026-09-06-v2
    acceptance_criteria:
      - Support the Codex selection result with provider-specific executable arguments and native Session identity in the existing Session model.
      - Reuse existing packet/model/binding validation and add Codex reattach/resume semantics and honest unsupported-operation messages.
      - Enforce repository lease admission across prepared/live Sessions and competing managed Runs, including canonical path aliases.
      - Use additive migration only if existing operational records require it; preserve older Session records and both existing execution paths.
      - Prove argument construction and spawn failure without live model invocation in deterministic tests.
      - Claude session launch is explicitly deferred to prove-multi-provider-production-recovery, which already requires demonstrating both configured providers; this Action does not claim Claude launch support.
      - "Preserve the proof Artifact: Provider adapter, lease conflict and backward-compatibility tests; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
    depends_on: [connect-action-to-launch-packet]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/sessions/index.ts", "src/commands/go.ts", "src/execution/runner.ts", "src/db/schema.ts"]
  - id: expose-guarded-host-session-launch
    title: Expose a bounded server launch operation with replay-safe receipts and fresh authority checks.
    status: done
    responsibility: agent
    effort: session
    next_action: Expose a bounded server launch operation with replay-safe receipts and fresh authority checks.
    expected_artifact: Evidence satisfying Agent Ask expose-guarded-host-session-launch
    clarification: clarified
    confidence: high
    source: Agent Ask break-launch-dependency-loop-2026-09-11
    acceptance_criteria:
      - Accept an explicit operator launch request for the previewed canonical Action; resolve repository, executable and arguments on the server.
      - Reject cross-origin, malformed, altered, stale and unauthorized requests; document/test the operator-action request guard for the existing local/tailnet deployment.
      - Revalidate pointer, documents, packet hash, Decisions, binding availability and repository lease immediately before preparation/spawn.
      - Two tabs or retried requests start at most one Session; lost-response recovery returns the durable result across restart.
      - Launch grants no implicit merge, integration, cleanup, deployment, spending, credential expansion or messaging; failures preserve recoverable work.
      - Inject at least one pre-spawn crash, one post-spawn crash and one lost response, and reconcile ambiguous launch identity without blind retry, proving at most one live conflicting execution across that bounded set of injected faults.
      - Support either a current explicit one-Session launch grant or a valid standing managed-production policy with an epoch-bound admission receipt; recheck Off immediately before launch commitment. Do not require a new human launch click for every authorized Action.
      - "Preserve the proof Artifact: Launch boundary, replay, bounded crash-window and conflict integration tests; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
    depends_on: [support-selected-codex-and-claude-sessions]
    decisions: []
    references: []
  - id: observe-portfolio-agent-sessions
    title: Show all active Sessions and Runs with fresh observation and native recovery access.
    status: done
    responsibility: agent
    effort: session
    next_action: Show all active Sessions and Runs with fresh observation and native recovery access.
    expected_artifact: Evidence satisfying Agent Ask observe-portfolio-agent-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Query active Sessions and active Runs independently of recent-history limits, keeping every repository lease visible.
      - Show Action, packet, agent/model, host, worktree, native identity, lifecycle status and observed time; live process never implies semantic progress.
      - Provide supported host-specific native reattach/resume and existing Run evidence links; phone-only limitations are explicit.
      - Coalesce polling with visibility/reconnect refresh and bounded failure/backoff; source errors preserve labeled last-known state.
      - Prove an old still-active Session/Run remains visible after more than ten newer terminal records.
      - "Preserve the proof Artifact: Active-history truncation, reconnect and lifecycle fixtures; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
    depends_on: [expose-guarded-host-session-launch]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/sessions/index.ts", "src/commands/advance.ts", "src/dashboard/snapshot.ts", "apps/dashboard/hooks/use-arcadia-snapshot.ts"]
  - id: reconcile-session-exits-to-next-move
    title: Reconcile Session exit into durable evidence and the next governed Action or Decision.
    status: done
    responsibility: agent
    effort: session
    next_action: Reconcile Session exit into durable evidence and the next governed Action or Decision, reading Session/Run state directly rather than through the portfolio dashboard view.
    expected_artifact: Evidence satisfying Agent Ask reconcile-session-exits-to-next-move
    clarification: clarified
    confidence: high
    source: Agent Ask amend-for-candidate-continuation-2026-09-13
    acceptance_criteria:
      - Persist a thin exit observation/receipt through the existing operational model and link available Run, Artifact and Decision proof.
      - Distinguish successful exit, failed execution, missing evidence, needs input, incomplete with a resumable candidate, and accepted Action completion; zero exit never marks done by itself.
      - Release repository leases only on proven terminal state and preserve recoverable reconciliation errors. Per Decision 0051, an incomplete exit whose candidate is resumable hands the existing repository lease to the next Session for the same Action rather than releasing it to a competing preparation; no new lease type is introduced.
      - Display the resulting canonical next Action or exact judgment/blocker with a usable link; automatic next admission only under the current Active production policy; no hand-edited governance state.
      - Retry/reconcile/reload is idempotent and does not duplicate completion, Decisions or execution.
      - "Preserve the proof Artifact: Exit-to-evidence-to-next-move lifecycle integration tests; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
      - Require criterion-level evidence bound to the exact Candidate revision and a separate review pass for nontrivial code and safety boundaries; unresolved blocking findings, missing/skipped checks and stale evidence prevent acceptance.
      - Prove the quality gate rejects deliberately failed tests, absent artifacts and false agent completion claims as specified in contract 20.
    depends_on: [expose-guarded-host-session-launch]
    decisions: []
    references: ["docs/decisions/0051-decide-whether-sequential-coding-agent-sessions-for-the-same-governed-action-may.md", "docs/proposals/host-owned-agent-workspace-contract.md", "docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/sessions/index.ts", "src/commands/advance.ts", "src/stewardship/artifactValidator.ts", "src/docs/dispatch.ts"]
  - id: advance-approved-production-work
    title: Advance accepted production work through canonical completion, Log and pointer transitions.
    status: done
    responsibility: agent
    effort: session
    next_action: Advance accepted production work through canonical completion, Log and pointer transitions.
    expected_artifact: Evidence satisfying Agent Ask advance-approved-production-work
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Reuse canonical evidence/acceptance writers and implement only the missing core bridge from Session outcome to managed Action completion and next pointer; database-only work done is insufficient.
      - Automatically advance objective evidence-based completion only under the explicit production policy; subjective judgment and merge/deploy/publication gates remain answerable obligations.
      - Within approved scope select the next dependency-ready Action or already-authorized Plan activation, with exact receipts; draft/unapproved Plan activation never occurs by queue inference.
      - Repeated reconciliation and crash recovery cannot duplicate completion, logs, Decisions or pointer changes; failure preserves evidence and isolates that Project.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
      - Inject crashes across document write, commit, projection and receipt boundaries; recover one canonical transition without duplicate Logs or skipped Actions, and invalidate affected proof after Candidate/base changes.
      - Resolve the next governed Action, question, external blocker or completed Plan as part of completion; never leave a done Action as the dispatch pointer. Support one operator-settled completion as well as explicitly delegated mechanical production acceptance.
    depends_on: [reconcile-session-exits-to-next-move, define-managed-production-policy]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/sessions/index.ts", "src/stewardship/artifactValidator.ts", "src/docs/dispatch.ts", "src/dispatch/pointer.ts", "src/ask/settlement.ts", "docs/proposals/complete-managed-action-from-evidence.md"]
  - id: feed-and-supervise-managed-production
    title: Extend the existing worker to continuously admit, supervise and advance approved Sessions while Active.
    status: done
    responsibility: agent
    effort: session
    next_action: Extend the existing worker to continuously admit, supervise and advance approved Sessions while Active, and independently detect a dead-Session exit and a base-branch advance.
    expected_artifact: Evidence satisfying Agent Ask feed-and-supervise-managed-production
    clarification: clarified
    confidence: high
    source: Agent Ask split-hung-detection-and-fault-soak-from-feed-and-supervise-2026-09-14
    acceptance_criteria:
      - Reuse the existing persistent worker ownership, recovery, queue and Session paths; no second daemon, queue or browser-owned scheduling loop.
      - After a terminal accepted Action, re-evaluate current priority/capacity and launch the next eligible Action without a new human session, chat or Launch click.
      - Detects when the base branch has advanced because an Action's PR merged, not only from an internal completion signal, and records that observation as an events-table row and a MISSION_LOG line naming the previous and new SHA, so a merge is never silent even if the worker was off or between ticks when it landed.
      - Use atomic leases and capacity reservations across competing ticks/workers; independent Projects may run concurrently within configured provider/host limits, but conflicting repositories cannot.
      - Off remains responsive during running work and stops future launch commitments; worker restart reconciles existing work and policy epoch before admission.
      - Blocked approval, unavailable provider or failed Project permits independent eligible work to progress. Exhausted capacity schedules bounded rechecks; a per-Action launch failure has a finite repair/retry limit and one actionable stop.
      - Enforce the existing finite repair-attempt budget and provider-call deadline constants; do not release uncertain leases or loop across providers to bypass a failure.
    depends_on: [advance-approved-production-work, prove-provider-capacity-admission, expose-guarded-host-session-launch]
    decisions: []
    references: []
  - id: expose-bootstrap-production-controls
    title: Expose the production switch, priority, capacity and review stops on the existing Work Queue.
    status: open
    responsibility: agent
    effort: session
    next_action: Expose the production switch, priority, capacity and review stops on the existing Work Queue.
    expected_artifact: Evidence satisfying Agent Ask expose-bootstrap-production-controls
    clarification: clarified
    confidence: high
    source: Agent Ask retire-flight-deck-scope-from-bootstrap-plan-2026-09-20
    acceptance_criteria:
      - Add a minimal Active/Inactive control and desired-versus-observed status to /work-queue using the production service; no /flight-deck route or component is required.
      - Reuse existing Plan segment/Action priority previews, review destinations and Session links; show included scope, selected/next Action, capacity age and exact operator stops.
      - Every operator stop offers contextual multiple-choice options with the affected Project/Plan/Action, evidence, recommendation and consequence of each choice; preserve free-text direction and route the selected answer through existing canonical review/settlement controls.
      - The control works on phone and desktop and remains responsive during execution and slow source reads; Off follows the documented policy.
      - Extract the concrete production control as a reusable unit rather than building a second controller or state store; the GitHub board shows state and cannot hold an Off switch, an approval or a capacity reading, so this control is the only place those live.
      - Preserve a runnable QA Artifact naming exact URL, host, revision and recovery command.
      - Measure durable Off acknowledgment within two seconds on the recorded healthy local host under stalled execution/provider reads; persistence failure is visible within five seconds without false confirmation.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "apps/dashboard/app/work-queue/page.tsx", "apps/dashboard/app/api/work-queue/route.ts"]
  - id: prove-two-action-unattended-production
    title: Prove two dependent Actions run from one activation using the existing Work Queue production control.
    status: done
    responsibility: agent
    effort: session
    next_action: Record only the retained v6 two-Action proof criteria already met; keep unfinished proof as a governed remainder.
    expected_artifact: Evidence satisfying Agent Ask prove-two-action-unattended-production
    clarification: clarified
    confidence: high
    source: Agent Ask split-v6-two-action-proof-supported-criteria-2026-10-01
    acceptance_criteria:
      - Provide a disposable or explicitly approved real Project with two small dependent Actions and a reachable existing production control (CLI or dashboard) before requesting live execution.
      - "Under bounded rehearsal authority activate once: Action A launches, validates, records canonical completion/pointer, and B launches without manual session setup or launch confirmation in between."
      - Complete this vertical proof before broad rail, capture, navigation polish or default-home cutover; reuse existing review/proof specialists as needed.
    depends_on: [feed-and-supervise-managed-production, add-opencode-production-provider]
    split_into: [finish-two-action-unattended-production-proof]
    decisions: []
    references: []
  - id: prove-multi-provider-production-recovery
    title: Prove continuous production across configured providers, independent Plans and capacity recovery.
    status: open
    responsibility: agent
    effort: session
    next_action: Add minimal Claude session launch support so Arcadia can substitute providers, reusing the Codex adapter interface from support-selected-codex-and-claude-sessions; defer the full dual-provider concurrent soak/interleaving proof until single-provider single-repository production has run cleanly in real use or a real workload needs concurrent multi-provider execution.
    expected_artifact: Evidence satisfying Agent Ask prove-multi-provider-production-recovery
    clarification: clarified
    confidence: high
    source: Agent Ask defer-multi-provider-soak-until-single-provider-hardened-2026-09-14-v2
    acceptance_criteria:
      - Add Claude session launch support (provider-specific executable arguments, native Session identity, packet/model/binding validation, reattach/resume, honest unsupported-operation messages), reusing the existing provider-adapter interface without reworking it.
      - Prove automatic selection can launch either configured provider for a given Action, preserving per-account capacity and repository isolation, on at least one real or fixture Action per provider.
      - "Defer the dual-provider concurrent soak proof (100 reproducible interleavings per race scenario; ten-Action live soak across two Projects and both providers) with an explicit trigger: reactivate when single-provider single-repository production (prove-two-action-unattended-production and its hardening) has run cleanly in real operator use, or when a real workload actually requires concurrent multi-provider execution."
      - Publish live/fixture evidence for each proven boundary and name the exact deferred gap so it is not mistaken for completed proof; distinguish simulated provider or capacity behavior from real proof.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: []
  - id: freeze-production-runtime-and-handoff-flight-deck
    title: Freeze the proven production runtime and prepare Flight Deck as its first real production workload.
    status: open
    responsibility: agent
    effort: session
    next_action: Freeze the proven production runtime and prepare the first real production workload, once that workload is named and agreed.
    expected_artifact: Evidence satisfying Agent Ask freeze-production-runtime-and-handoff-flight-deck
    clarification: clarified
    confidence: high
    source: Agent Ask retire-flight-deck-scope-from-bootstrap-plan-2026-09-20
    acceptance_criteria:
      - Identify and preserve the exact proven worker/runtime revision, service command, workspace/schema compatibility and rollback/recovery procedure independently of coding worktrees.
      - Name the first real production workload and record the operator's agreement to it before any handoff step; Flight Deck is no longer that workload and nothing may be assumed in its place.
      - Prove that editing/building the first workload in an isolated Arcadia worktree does not replace, hot-reload or restart the controller; runtime upgrades require a separate controlled handoff.
      - Present the first workload's Plan scope and first two dependent Actions, current queue segment, automatic completion policy and external merge/publication boundaries as one handoff Artifact.
      - After bootstrap acceptance and approved Plan transition, the canonical pointer selects the first workload and production admits its first Action; no repeated human Session setup is required.
      - If the first workload cannot advance without a merge or subjective acceptance, show that exact approval in the existing review surface. Never weaken a gate to manufacture uninterrupted progress.
      - Publish the contract 20 release evidence index; every required proof is passed at the accepted revision, blocking findings are resolved, and independent status/Off plus recovery are exercised before unattended handoff of the first workload.
    depends_on: [prove-two-action-unattended-production, expose-bootstrap-production-controls, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: []
  - id: repair-codex-worktree-configuration
    title: Repair the existing protected-broker installer and status contract so every Codex profile Arcadia actually launches can use the exact standard agent worktree roots without broad filesystem or network access.
    status: done
    responsibility: agent
    effort: session
    next_action: Repair the existing protected-broker installer and status contract so every Codex profile Arcadia actually launches can use the exact standard agent worktree roots without broad filesystem or network access.
    expected_artifact: Evidence satisfying Agent Ask repair-codex-worktree-configuration
    clarification: clarified
    confidence: high
    source: Agent Ask repair-arcadia-go-codex-dx-2026-09-06-v2
    acceptance_criteria:
      - Extend the existing configureGoBrokerAgents path instead of introducing a second installer or manual setup instructions; preserve unrelated user configuration, existing writable roots, comments where the current writer preserves them, and timestamped recovery backups.
      - Configure and verify sandbox_workspace_write.writable_roots for the exact ~/.codex/worktrees and ~/.claude/worktrees roots in the default Codex configuration and in every named Codex profile Arcadia selects for managed production, including arcadia-unattended when that profile is used.
      - Keep sandbox_mode workspace-write; do not grant danger-full-access, a whole-home writable root, unrestricted command execution, or command network access as a workaround.
      - Make go-broker status fail with a named Codex worktree/profile issue when any selected profile is missing the required roots; it must not report READY from the currently observed configuration that lacks them.
      - Preserve approval_policy on-request for interactive sessions and never for explicitly unattended sessions, and prove that changing approval policy does not masquerade as changing sandbox access.
      - Cover new, mixed, duplicate-table, pre-existing-root, absent-profile, idempotent reinstall, backup, and refusal cases with deterministic tests; update START_HERE.md, INSTALL_WITH_A_CODING_AGENT.md, docs/COMMANDS.md, and the installed skill wherever their current claims change.
    depends_on: [support-selected-codex-and-claude-sessions]
    decisions: []
    references: ["src/agentSetup/goBrokerAgentSetup.ts", "src/commands/goBrokerInstall.ts", "tests/go-broker-agent-setup.test.ts", "src/sessions/worktreePreparation.ts", "https://developers.openai.com/codex/config-reference", "https://learn.chatgpt.com/codex/agent-approvals-security"]
  - id: make-worktree-runtime-self-contained
    title: Make every mandatory Arcadia Go lifecycle, dependency, build, and test path run from the prepared candidate without sandbox-blocked IPC or accidental execution of the main checkout's built code.
    status: done
    responsibility: agent
    effort: session
    next_action: Make every mandatory Arcadia Go lifecycle, dependency, build, and test path run from the prepared candidate without sandbox-blocked IPC or accidental execution of the main checkout's built code.
    expected_artifact: Evidence satisfying Agent Ask make-worktree-runtime-self-contained
    clarification: clarified
    confidence: high
    source: Agent Ask repair-arcadia-go-codex-dx-2026-09-06-v2
    acceptance_criteria:
      - Run governed advance and work monitoring through the installed revision-pinned compiled broker; no required Arcadia Go lifecycle step depends on the tsx CLI IPC server.
      - Resolve or avoid the observed macOS listen EPERM failure for required TypeScript-backed development commands without enabling unrestricted network access or danger-full-access, and retain a denial-focused diagnostic that names the blocked path or operation.
      - Make dependency preparation idempotent and prove workspace package imports exercise the candidate worktree's source or candidate build, never the main checkout's stale dist; add a sentinel regression fixture that fails if resolution crosses back to the main checkout.
      - From a prepared worktree under the intended Codex sandbox, prove ordinary source edits, node_modules preparation, dist and .next output, temporary SQLite databases, Vitest, build, and cleanup all work without an operator approval prompt.
      - The installer performs a disposable post-install host probe covering candidate-root writes, dependency preparation, temporary files, and the compiled preflight; any failure leaves recoverable state and reports one exact remedy before Arcadia launches production work.
      - Keep the common path deterministic and local; diagnose a failed probe with one bounded model-bearing repair pass only after preserving the denial evidence.
    depends_on: [repair-codex-worktree-configuration]
    decisions: []
    references: ["scripts/bridge-worktree-deps.mjs", "package.json", "src/goBroker.ts", "src/commands/workMonitor.ts", "docs/AGENT_ORIENTATION.md", "https://learn.chatgpt.com/codex/agent-approvals-security"]
  - id: broker-candidate-preservation
    title: Preserve a completed candidate through Arcadia's protected controller boundary so sandboxed agents never need direct write access to shared Git metadata or ad hoc approval escalation.
    status: done
    responsibility: agent
    effort: session
    next_action: Preserve a completed candidate through Arcadia's protected controller boundary so sandboxed agents never need direct write access to shared Git metadata or ad hoc approval escalation.
    expected_artifact: Evidence satisfying Agent Ask broker-candidate-preservation
    clarification: clarified
    confidence: high
    source: Agent Ask repair-arcadia-go-codex-dx-2026-09-06-v2
    acceptance_criteria:
      - Reuse the existing protected broker, Session lease, governed Action, and managed-production policy boundaries; do not allowlist raw general Git mutation or make .git writable to the coding agent.
      - Bind preservation to one exact registered prepared worktree, agent-owned branch, base revision, Action, packet, policy epoch, candidate diff fingerprint, validation evidence, and request id; changed inputs invalidate the operation.
      - Outside the agent sandbox, stage only the validated candidate worktree, create one recoverable branch commit, and make retries or lost responses return the same receipt without duplicate commits or staged leakage from another worktree.
      - When the standing policy explicitly includes remote preservation, push only that exact agent branch and create or update its draft pull request with the required operator QA plan; merge, deployment, publication, spending, credential expansion, and messaging remain separate gates.
      - If remote preservation is not authorized or reachable, retain the local commit, report LOCAL ONLY with the exact retry action, and never claim that the work is recoverable from another machine.
      - Refuse dirty base state, detached or unexpected branches, symlink/path escapes, stale reservations, conflicting Sessions, changed base history, missing validation, and unapproved network effects while preserving all candidate files.
      - Add fault injection before and after stage, commit, push, and pull-request receipt persistence; prove one recoverable outcome and no cross-worktree mutation across retries and restart.
    depends_on: [make-worktree-runtime-self-contained]
    decisions: []
    references: ["src/goBroker.ts", "src/commands/go.ts", "src/sessions/index.ts", "src/git/worktrees.ts", "docs/working-copy-safety.md", "docs/operator-demo-and-release-contract.md", "https://learn.chatgpt.com/codex/agent-approvals-security"]
  - id: prove-zero-prompt-production-loop
    title: Prove on the real host that Arcadia can hand off, execute, validate, preserve, and advance bounded coding work without operator permission relay while retaining every consequential approval boundary.
    status: open
    responsibility: requires_review
    effort: session
    next_action: "Prove the real-host zero-prompt preservation, separately authorized integration, evidence reconciliation and governed pointer transition, by running docs/reports/prove-zero-prompt-production-loop-runbook.md in a plain operator terminal. This Action cannot be implemented by a coding agent: the runbook explicitly forbids it, because a coding agent stepping around the go-launcher sandbox boundary would invalidate the very proof under test."
    expected_artifact: Evidence satisfying Agent Ask prove-zero-prompt-production-loop
    clarification: clarified
    confidence: high
    source: Agent Ask reclassify-prove-zero-prompt-dispatch-2026-09-22-v2
    acceptance_criteria:
      - Use the Zero Prompt Rehearsal fixture Project with two dependent small Actions and the same OpenCode provider profile, protected launchers, workspace root, dependency bridge, build, test, SQLite, Git, network and pull-request path that managed production will use.
      - Before the counted run, record and verify every required launch, remote-preservation, integration and mechanical-completion grant, with its exact fixture scope, policy/receipt identity, freshness and limits. A missing, stale or insufficient grant stops preflight before the run begins; no new approval halfway through the proof is part of a successful run.
      - Before the counted run, identify and verify the exact supported host entry point delivered by reconcile-session-exits-to-next-move and advance-approved-production-work that drives reconciliation and canonical completion without the continuous worker. Record its command and the revision-pinned arcadia-go-broker-opencode host-controller invocation that prepares Action B, or the supported combined entry point if the prerequisite implementation provides one. Current go prepares work but does not supply the missing reconciliation bridge; until a supported bridge is shipped and verified, preflight refuses. Any explicit host-controller invocation is a visible, predeclared operator step, not autonomous execution.
      - From one bounded activation and the predeclared visible host steps, Arcadia prepares Action As worktree, advances and monitors it, edits, builds, tests, preserves its exact branch and authorized draft pull request, reconciles evidence through the implemented canonical completion bridge, advances the governed pointer to Action B and prepares Action Bs worktree. Record and verify the actual authoritative Action completion and both pointer document effects; a successful command response alone is insufficient.
      - After protected preservation, prove the host controller reports commitsToIntegrate greater than zero and integrates the exact candidate branch under the separately explicit integration grant recorded in preflight. Prove acceptance/completion and pointer advancement use their existing governed writers and applicable authority, never preservation alone.
      - Keep zero sandbox approval prompts, zero hidden interventions and fully unattended execution distinct. This rehearsal requires the first two, permits only the predeclared visible operator steps, and makes no fully unattended execution claim. prove-two-action-unattended-production owns unattended Action B launch and execution after the continuous worker exists.
      - One proof Artifact records preflight grants, exact supported entry points, all predeclared manual steps, and every command, profile, writable root, sandbox denial, approval event, worktree, branch, revision, Session, Action, validation result, commit, push, pull request, actual document transition and operator intervention. Zero sandbox approval prompts and zero hidden interventions are acceptance conditions; record visible manual invocation explicitly and never label it autonomous execution.
    depends_on: [broker-candidate-preservation, let-agent-preserve-its-candidate, advance-approved-production-work]
    decisions: []
    references: ["docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "docs/working-copy-safety.md", "src/commands/worker.ts", "src/sessions/index.ts", "src/agentSetup/goBrokerAgentSetup.ts", "src/commands/go.ts", "src/ask/settlement.ts", "src/dispatch/pointer.ts", "docs/reports/prove-zero-prompt-production-loop-runbook.md"]
  - id: harden-zero-prompt-production-loop
    title: Harden the proven zero-prompt loop across profiles, approval gates, mid-flight shutdown and reinstall, once the happy path has run clean twice in a row.
    status: open
    responsibility: agent
    effort: session
    next_action: Harden the proven zero-prompt loop across profiles, approval gates, mid-flight shutdown and reinstall, once the happy path has run clean twice in a row.
    expected_artifact: Evidence satisfying Agent Ask harden-zero-prompt-production-loop
    clarification: clarified
    confidence: high
    source: Agent Ask split-zero-prompt-loop-happy-path-2026-09-10-v3
    acceptance_criteria:
      - Run the local lifecycle once with approval_policy on-request and once with the selected unattended profile; the first produces zero sandbox prompts on the common path and the second produces zero permission failures rather than merely suppressing prompts.
      - Demonstrate that merge, deployment, publication, paid-capacity use, reset redemption, credential expansion, destructive cleanup and unrelated network access still stop at their existing explicit gates.
      - Turn production Off during Action B and prove no later admission, no lost candidate work, bounded reconciliation, and no duplicate commit or pull request after worker restart.
      - Repeat the deterministic host probe after reinstall and from a fresh generated worktree; any regression makes go-broker status or production admission fail closed before a coding-agent model is launched.
    depends_on: [prove-zero-prompt-production-loop]
    decisions: []
    references: ["docs/plans/mission-control-view/20-production-quality-and-reliability.md", "docs/operator-demo-and-release-contract.md"]
  - id: let-agent-preserve-its-candidate
    title: A sandboxed coding-agent session can preserve its completed candidate through the protected controller boundary, without direct write access to shared Git metadata and without ad hoc approval escalation.
    status: done
    responsibility: agent
    effort: session
    next_action: Connect trusted candidate-bound validation to the existing protected preservation request and prove it from the intended agent sandbox on a disposable fixture.
    expected_artifact: Evidence satisfying Agent Ask let-agent-preserve-its-candidate
    clarification: clarified
    confidence: high
    source: Agent Ask trusted-protected-preservation-scope-2026-09-12-v2
    acceptance_criteria:
      - Reuse the existing protected host controller, registered prepared worktree, Session lease and candidate-preservation machinery. Permit the minimal protected request transport needed for the intended sandbox to reach the existing host-side preservation operation; this is not a second controller or a general host command-execution service. Do not introduce another pointer writer, allow raw Git mutation, make shared Git metadata writable to the agent, or weaken the sandbox.
      - "Validate only the declared objective checks required for preservation, sourced from the existing host-managed Project metadata validation_commands and frozen into the immutable authorized Action packet. Verify their definitions against that packet and its authorizing receipt; the request cannot select or replace checks. Use a host-owned validation runner as the trusted result producer: it runs those checks with candidate code sandboxed, observes their actual process outcomes and captures evidence in host-protected storage. An agent-writable evidence file, caller-supplied passed=true, or agent completion assertion is not trusted evidence. Passing a check proves only that check passed; do not build a general acceptance evaluator or require subjective acceptance criteria to become executable."
      - Bind results to the exact candidate snapshot actually tested, repository/worktree/branch/base, Project and Action, immutable packet hash, check definitions and applicable authority including policy revision/epoch. Require that the validated candidate snapshot and the committed tree are identical. Cover mutation during validation as well as mutation between validation and preservation; hashing only the content found after testing is insufficient. Use the smallest sound existing snapshot or content-binding mechanism without requiring a new snapshot framework. Refuse absent, failed, skipped, stale or caller-fabricated evidence and changed bindings, preserve candidate files on refusal, and prove that altered content cannot inherit a passing receipt.
      - Make the protected preservation request agent-callable for Codex and Claude through the existing launcher setup, Codex rule and Claude allowlist. From the intended Codex sandbox, prove the actual request reaches the protected host and creates one candidate commit on a disposable objective-criteria fixture, with no direct shared-Git write by the agent or ad hoc approval escalation; allowlist presence and unsandboxed direct invocation alone are insufficient proof.
      - Update the arcadia-go skill to request protected preservation after required validation, while continuing to forbid direct mutable advance and git commit. Make go-broker status report named preservation readiness and fail closed when the launcher or required protected request path is unavailable.
      - Preservation records a recoverable candidate and trusted validation only; it does not accept the Action, integrate or merge it, mark it done, or advance its pointer. Subjective acceptance and required independent review remain separate gates. Remote preservation requires its existing explicit authority; unauthorized or unreachable remote preservation remains honestly LOCAL ONLY with an exact recovery action.
      - Reuse the existing request-id and recovery receipts; prove retries and a lost response yield one preserved commit without cross-worktree mutation or duplicate preservation.
      - Preserve passing targeted tests and a reproducible protected-boundary fixture Artifact recording exact host/runtime revision, profile, writable roots, authoritative check definitions, trusted producer, check results, tested snapshot and committed-tree identities, Action, packet, authority, request/receipt, commit and every denial, approval or operator intervention. Include fixtures for content mutation during validation and between validation and preservation, showing altered content cannot inherit passing evidence. Include exact runnable operator QA steps and the end-user procedure in the PR; distinguish fixture proof from live production acceptance.
    depends_on: []
    decisions: []
    references: ["src/agentSetup/goBrokerAgentSetup.ts", "src/goBroker.ts", "src/sessions/worktreePreparation.ts", "src/commands/go.ts", "docs/reports/prove-zero-prompt-production-loop-runbook.md", "src/commands/preserve.ts", "src/sessions/candidatePreservation.ts", "docs/working-copy-safety.md"]
  - id: refuse-to-orphan-an-uncommitted-candidate
    title: The host controller reports a prepared worktree that holds uncommitted work instead of silently preparing a duplicate for the same Action.
    status: done
    responsibility: agent
    effort: session
    next_action: The host controller resumes the existing prepared candidate for the same Action after its prior Session is proven terminal, and otherwise reports a prepared worktree holding uncommitted work instead of silently preparing a duplicate.
    expected_artifact: Evidence satisfying Agent Ask refuse-to-orphan-an-uncommitted-candidate
    clarification: clarified
    confidence: high
    source: Agent Ask amend-for-candidate-continuation-2026-09-13
    acceptance_criteria:
      - "`go` detects a prepared worktree for the current Action that holds uncommitted changes, and reports it with its exact path rather than preparing a second worktree for that Action."
      - Per Decision 0051, when the same governed Action still owns the candidate and its prior Session is proven terminal, `go` resumes that candidate (same worktree and branch, repository lease handed over) without operator Git steps. In every other case - different Action, unproven exit, or a conflicting live Session - the reported state names the operator's choices explicitly (preserve the existing candidate, or discard it) and `go` takes neither action implicitly.
      - "The `clutter` summary counts existing agent worktrees accurately; a run with two agent worktrees never reports `extraWorktrees: 0`."
      - "Preserve the proof Artifact: fixture tests reproducing an uncommitted prepared worktree, asserting `go` resumes it for the same Action after a proven terminal Session and refuses to duplicate or resume it otherwise; include the exact runnable target and operator QA steps in the pull request."
    depends_on: []
    decisions: []
    references: ["docs/decisions/0051-decide-whether-sequential-coding-agent-sessions-for-the-same-governed-action-may.md", "docs/proposals/host-owned-agent-workspace-contract.md", "src/commands/go.ts", "src/goBroker.ts", "docs/working-copy-safety.md"]
  - id: register-agent-workspace-trust
    title: "`go-broker install` establishes and verifies agent workspace trust for each configured Arcadia Project repository, and `go-broker status` reports it as a first-class readiness condition."
    status: done
    responsibility: agent
    effort: session
    next_action: "`go-broker install` establishes and verifies agent workspace trust for each configured Arcadia Project repository, and `go-broker status` reports it as a first-class readiness condition."
    expected_artifact: Evidence satisfying Agent Ask register-agent-workspace-trust
    clarification: clarified
    confidence: high
    source: Agent Ask register-agent-workspace-trust-2026-09-11-v3
    acceptance_criteria:
      - "`go-broker install` records workspace trust for each configured Project repository at its repository root, using the agent's own trust mechanism (for Codex, a `[projects.\"<repo root>\"] trust_level = \"trusted\"` entry in the operator's config)."
      - Trust is granted only to repositories already configured as Arcadia Projects. A parent directory, a shared worktree root such as `~/.codex/worktrees`, and the home directory are never trusted, and a test proves each of those three is refused.
      - "`go-broker status` reports trust as a named check alongside the existing profile, executable and allowlist checks, and reports `ready: false` with the exact missing repository when trust is absent."
      - "Re-running `install` is idempotent: an existing trusted entry is neither duplicated nor downgraded, and unrelated entries in the operator's config are preserved byte-for-byte."
      - A repository the agent has never seen dispatches a prepared worktree with zero trust prompts and zero approval prompts, proven on a disposable fixture rather than asserted.
      - State explicitly whether Claude Code's equivalent workspace-trust gate needs the same treatment; if it does, cover it, and if it does not, record why in the Artifact.
      - "Preserve the proof Artifact: trust-scoping refusal tests, idempotence tests, and the zero-prompt fixture evidence; include the exact runnable target and operator QA steps in the pull request, or state why no runnable surface exists."
    depends_on: []
    decisions: []
    references: ["src/agentSetup/goBrokerAgentSetup.ts", "src/goBroker.ts", "docs/reports/prove-zero-prompt-production-loop-runbook.md", "docs/working-copy-safety.md"]
  - id: approval-must-apply-or-refuse
    title: Review approval applies its effect to the authoritative document or refuses with a named reason, and never consumes an item it cannot apply.
    status: done
    responsibility: agent
    effort: session
    next_action: Review approval applies its effect to the authoritative document or refuses with a named reason, and never consumes an item it cannot apply.
    expected_artifact: Evidence satisfying Agent Ask approval-must-apply-or-refuse
    clarification: clarified
    confidence: high
    source: Agent Ask approval-must-apply-or-refuse-2026-09-12
    acceptance_criteria:
      - Approving a review item writes the resulting state to the authoritative checked-in document, or refuses; the workspace database and that document never disagree about whether a Decision is answered.
      - An approval whose effect cannot be applied is refused with a reason naming what is missing, and the item remains in the attention queue rather than leaving it.
      - A `project_update` Ask whose `target_ref` names a field with no apply path is refused at preview time, rather than opening a clarification Decision that approval cannot act on.
      - "A regression test reproduces R183: approve a project-field clarification and assert either the field moved and the document was updated, or the approval was refused and the item is still queued."
      - "Preserve the proof Artifact: the regression test plus a before/after of the database and document state; include the exact runnable target and operator QA steps in the pull request."
    depends_on: []
    decisions: []
    references: ["src/commands/review.ts", "src/ask/settlement.ts", "docs/decisions/0046-how-should-this-project-update-be-applied-set-the-work-pointer-to-let-agent-pres.md", "docs/proposals/validate-governed-documents.md"]
  - id: isolate-agent-asks-from-production-handoff
    title: Make Agent Ask authoring, preview, correction, settlement, and preservation use uniquely named files on Arcadia-owned isolated branches and worktrees so concurrent Asks cannot collide and no Ask dirties the shared base or blocks Arcadia Go.
    status: done
    responsibility: agent
    effort: session
    next_action: Make Agent Ask authoring, preview, correction, settlement, and preservation use uniquely named files on Arcadia-owned isolated branches and worktrees so concurrent Asks cannot collide and no Ask dirties the shared base or blocks Arcadia Go.
    expected_artifact: Evidence satisfying Agent Ask isolate-agent-asks-from-production-handoff
    clarification: clarified
    confidence: high
    source: Agent Ask isolate-concurrent-agent-asks-from-production-handoff-2026-09-12
    acceptance_criteria:
      - Every newly authored or edited Agent Ask is stored as `.arcadia/asks/agent-ask-<unique-stub>.yaml` in a uniquely identified, recoverable Arcadia-owned Ask branch and worktree rather than the repository's shared base checkout; the stub is stable for one request and collision-resistant across concurrent agents.
      - Multiple Ask files may coexist. Preview, correction, settlement, status, and cleanup require an exact file path or request id and never select an arbitrary glob match; two concurrent Ask drafts cannot overwrite, settle, or retire each other.
      - Preview and correction resolve the Ask by request id from that isolated location, and settlement commits only the exact previewed Ask effects on its Ask branch before the existing authorized integration and push boundaries apply.
      - When Arcadia Go finds a legacy root `agent-ask.yaml` change as the only dirty base path, it atomically preserves that exact content and diff under a uniquely named Ask file in an isolated Ask branch and worktree, reports the recovery location, restores no unrelated path, and continues preparing the governed production worktree in the same operator invocation.
      - If any dirty base path is not recognized as isolated Ask input, or Ask preservation cannot be proven complete, Arcadia Go retains the existing fail-closed refusal and names every preserved blocker; no work is discarded, staged, or silently included.
      - The protected broker and Agent Ask skill use the isolated path without giving a sandboxed agent general shared-Git mutation, and retries return the same branch, worktree, request id, and receipt without duplicate commits or orphaned drafts.
      - A fixture reproduces the 2026-09-12 failure from a base containing only a modified agent-ask.yaml, then proves one Arcadia Go activation preserves the Ask and prepares the governed Action worktree with zero operator Git steps; fault tests cover interruption before and after Ask preservation.
      - A concurrency fixture creates, previews, corrects, and settles at least two Ask files in parallel and proves their paths, request ids, receipts, branches, effects, and cleanup remain disjoint.
      - The operator-facing QA plan identifies the exact local command and paths, demonstrates the preserved Ask can still be previewed or settled, and demonstrates the prepared production worktree starts from the unchanged clean base.
    depends_on: []
    decisions: []
    references: ["docs/proposals/validate-governed-documents.md", "docs/proposals/gate-judgment-not-mechanics.md", "docs/decisions/0009-agent-neutral-go-handoff.md", "docs/decisions/0023-work-pointer-under-concurrency.md", "docs/working-copy-safety.md", "src/commands/go.ts", "src/goBroker.ts", "src/ask/settlement.ts", "src/agentSetup/goBrokerAgentSetup.ts"]
  - id: make-go-total-across-plans
    title: Make the shared transition resolver and Arcadia Go activate the Plan whose earliest eligible Action is highest in the explicit queue whenever the active Plan is absent or complete.
    status: done
    responsibility: agent
    effort: session
    next_action: Make the shared transition resolver and Arcadia Go activate the Plan whose earliest eligible Action is highest in the explicit queue whenever the active Plan is absent or complete.
    expected_artifact: Evidence satisfying Agent Ask make-go-total-across-plans
    clarification: clarified
    confidence: high
    source: Agent Ask implement-total-go-plan-selection-2026-09-12
    acceptance_criteria:
      - Arcadia Go, Action completion, and managed-production continuation use one shared total transition resolver for active work, completed Plans, absent active-Plan pointers, stale missing-Plan pointers, Decisions, external blockers, reconciliation, waiting, and Project milestone completion.
      - When no active Plan can continue, Arcadia activates the Plan whose earliest eligible Action is highest in the existing explicit operator-owned queue and makes that Action current without another operator round trip; dependencies, Decisions, responsibility, and approval gates filter eligibility without changing queue priority.
      - A stale or missing active-Plan pointer is repaired automatically only when checked-in documents and explicit queue order determine one eligible replacement without ambiguity; otherwise Arcadia emits one actionable Decision or named truth blocker and preserves all work.
      - Approved legacy Actions lacking explicit order receive a previewed, reversible FIFO seed before automatic Plan selection; timestamps never silently reorder work after that seed and existing explicitly ordered work is unchanged.
      - No separate urgency or priority field is introduced. Reordering the explicit queue remains the single way to change priority until a concrete accepted requirement cannot be represented there.
      - "Repeated, concurrent, interrupted, and lost-response transitions are idempotent: one Plan is activated, one Action becomes current, and retries return the same durable receipt without duplicate pointer or queue effects."
      - Fixtures cover a completed active Plan, no active Plan, a dangling missing-Plan pointer, one eligible candidate, several candidates with explicit order, blocked higher candidates, unordered legacy candidates, a genuine ambiguity requiring one Decision, and a Project with no remaining work.
      - The operator-facing QA plan gives the exact local Arcadia Go commands and observable pointer, queue, receipt, and refusal results; the end-user procedure is stated separately if it differs.
    depends_on: [isolate-agent-asks-from-production-handoff]
    decisions: []
    references: ["docs/decisions/0048-make-arcadia-go-a-total-governed-transition-that-keeps-advancing-whenever-the-ne.md", "docs/decisions/0012-the-session-primitive.md", "docs/decisions/0039-prioritize-agent-ask-and-work-queue.md", "docs/plans/agent-ask-execution-queue.md", "src/commands/advance.ts", "src/commands/go.ts", "src/docs/dispatch.ts"]
  - id: build-autonomous-defect-loop
    title: Add the one-line defect intake and automatic bounded triage loop approved by Decision 0049.
    status: done
    responsibility: agent
    effort: session
    next_action: "Add the one-line `arcadia defect` intake approved by Decision 0049: a durable Back Burner defect signal with a stable id and automatically captured Project, source, time, repository revision, and optional evidence, recorded with zero model calls, idempotent on exact retry, and reporting likely duplicates without discarding distinct reports."
    expected_artifact: Evidence satisfying Agent Ask build-autonomous-defect-loop
    clarification: clarified
    confidence: high
    source: Agent Ask narrow-defect-loop-to-intake-2026-09-23
    acceptance_criteria:
      - "`arcadia defect <summary>` records a durable Back Burner defect signal with a stable id and automatically captured Project, source, time, repository revision when available, and optional evidence; successful intake makes zero model calls."
      - "Repeated intake is lossless and replay-safe: exact retries are idempotent, deterministic matching identifies likely duplicates without silently discarding distinct reports, and the reporter receives the durable record id."
      - Deterministic tests cover zero-model intake, exact-retry idempotency, and duplicate candidates.
      - The operator-facing QA plan names the exact CLI intake, Back Burner and defect-signal inspection steps, observable expected results, and whether the procedure is also the end-user procedure.
    depends_on: [make-go-total-across-plans]
    decisions: []
    references: ["docs/decisions/0049-add-a-one-line-defect-intake-whose-periodically-token-budgeted-back-burner-proce.md", "src/commands/defect.ts", "src/defect/signal.ts", "src/db/repositories.ts"]
  - id: build-agent-agnostic-learning-loop
    title: Let Arcadia and every Project capture concise lessons cheaply and automatically turn supported lessons into durable reusable capability.
    status: open
    responsibility: agent
    effort: session
    next_action: Let Arcadia and every Project capture concise lessons cheaply and automatically turn supported lessons into durable reusable capability.
    expected_artifact: Evidence satisfying Agent Ask build-agent-agnostic-learning-loop
    clarification: clarified
    confidence: high
    source: Agent Ask split-defect-loop-remainder-2026-09-23
    acceptance_criteria:
      - "`arcadia learn <summary>` records a durable lesson signal with a stable id, explicit Project or Arcadia scope, and automatically captured source, time, repository revision when available, confidence/freshness, and statement kind; successful intake makes zero model calls and requires no coding-agent session."
      - The record distinguishes direct operator statements, observed outcomes, agent inferences, and imported evidence; an inference never silently becomes an operator preference, Project truth, approved Decision, or authority grant.
      - Lesson intake reuses the defect signal's replay, likely-duplicate, Back Burner, worker, budget, recovery, and receipt machinery while keeping defect repair and lesson incorporation as distinct dispositions; no second daemon, scheduler, backlog, or generic memory store is introduced.
      - The periodic worker performs deterministic normalization, exact matching, source/freshness checks, and support counting before any model call, then uses only the bounded admitted allowance to dismiss noise, merge or link evidence, retain a trigger, or propose and safely apply the smallest durable incorporation.
      - "A supported lesson lands in one existing authoritative home appropriate to its claim: regression test or guard, Project reference or Log, Arcadia Way guidance, Decision, governed Action, or reusable skill; the original signal remains linked as provenance and the outcome is inspectable, correctable, and retractable."
      - Project-scoped or sensitive material cannot cross into another Project or Arcadia-wide guidance by similarity alone. Cross-scope promotion requires evidence from more than one Project or one high-severity trust/safety incident, preserves source links, and excludes credentials, raw transcripts, unrelated repository content, and private data not authorized for that scope.
      - A lesson meeting the existing stop-the-line test bypasses periodic cadence. All other learning is subordinate to current governed work; merge, deployment, publication, spending, credentials, messaging, production access, destructive changes, constitutional changes, and unresolved operator judgment retain their existing gates.
      - Deterministic tests cover Arcadia and Project scope, zero-model intake, retry, likely duplicates, direct-statement versus inference provenance, stale evidence, correction/retraction, bounded reflection, safe test or reference promotion, refused cross-scope disclosure, worker restart, and stop-the-line escalation.
      - The operator-facing QA plan includes exact CLI intake, scope selection, worker/recovery command, signal and promoted-record inspection, correction/retraction, and observable expected results; state whether this is also the end-user procedure.
    depends_on: [defect-bounded-triage-loop]
    decisions: []
    references: ["docs/decisions/0050-add-a-nearly-free-automatic-learning-loop-that-lets-any-arcadia-surface-or-proje.md", "docs/decisions/0020-compounding-agent-production-principles.md", "docs/decisions/0049-add-a-one-line-defect-intake-whose-periodically-token-budgeted-back-burner-proce.md", "docs/plans/provider-capacity-harvesting.md", "OPERATOR_CONTEXT.md"]
  - id: design-and-build-the-mechanism-that
    title: Design and build the mechanism that discovers unprocessed .arcadia/asks/ files whenever a real Arcadia workspace becomes available, regardless of which command or environment triggered that availability.
    status: done
    responsibility: agent
    effort: session
    next_action: Design and build the mechanism that discovers unprocessed .arcadia/asks/ files whenever a real Arcadia workspace becomes available, regardless of which command or environment triggered that availability.
    expected_artifact: Evidence satisfying Agent Ask design-and-build-the-mechanism-that
    clarification: clarified
    confidence: high
    source: Agent Ask design-agent-ask-discovery-2026-09-13
    acceptance_criteria:
      - A design is written down (in the Action, a Decision, or a short doc) naming exactly where discovery hooks in and why, given that arcadia go is not a reliable trigger.
      - Every .arcadia/asks/*.yaml file whose request_id the database does not yet know is previewed automatically the next time any agent-ask command successfully resolves a real workspace in that repository, with no separate command required.
      - A file that fails validation during automatic discovery is reported clearly (e.g. in that commands own output) rather than silently swallowed or left to repeatedly fail on every future command.
      - Test coverage proves discovery fires from more than one entry point (e.g. both draft and preview), not only from a single hardcoded command.
    depends_on: []
    decisions: []
    references: []
  - id: settle-onto-candidate-branch
    title: Settlement commits produced during an arcadia go session land on the Action candidate branch and ship in its PR, never as loose commits on main.
    status: done
    responsibility: agent
    effort: session
    next_action: Settlement commits produced during an arcadia go session land on the Action candidate branch and ship in its PR, never as loose commits on main.
    expected_artifact: Evidence satisfying Agent Ask settle-onto-candidate-branch
    clarification: clarified
    confidence: high
    source: Agent Ask one-session-completes-one-action-2026-09-13
    acceptance_criteria:
      - Running agent-ask settle --apply inside a candidate worktree commits to that candidate branch.
      - A test proves a session that settles and opens a PR leaves main with no new local-only commits.
    depends_on: []
    decisions: []
    references: []
  - id: merge-completes-the-action
    title: The Action PR carries its completion evidence and pointer advance, so merging it marks the Action done without a separate complete Ask or session.
    status: done
    responsibility: agent
    effort: session
    next_action: The Action PR carries its completion evidence and pointer advance, so merging it marks the Action done without a separate complete Ask or session.
    expected_artifact: Evidence satisfying Agent Ask merge-completes-the-action
    clarification: clarified
    confidence: high
    source: Agent Ask one-session-completes-one-action-2026-09-13
    acceptance_criteria:
      - arcadia go can stage a complete settlement (evidence per acceptance criterion, pointer advance) into the candidate PR before merge.
      - After the PR merges, PROJECT.md current_action names the next governed Action with no further command run.
      - A stale or failed criterion still refuses completion, as the complete intent does today.
    depends_on: [settle-onto-candidate-branch]
    decisions: []
    references: []
  - id: triage-decisions-before-opening
    title: A Decision opens only when the Constitution gate test holds (a reasonable person could choose differently, or the move resists reversal or reaches outside the work); otherwise the agent applies its recommendation and reports it in the PR.
    status: done
    responsibility: agent
    effort: session
    next_action: A Decision opens only when the Constitution gate test holds (a reasonable person could choose differently, or the move resists reversal or reaches outside the work); otherwise the agent applies its recommendation and reports it in the PR.
    expected_artifact: Evidence satisfying Agent Ask triage-decisions-before-opening
    clarification: clarified
    confidence: high
    source: Agent Ask one-session-completes-one-action-2026-09-13
    acceptance_criteria:
      - Decision-intent settlement records which gate question fired, and refuses to open a Decision when neither fires and the move is reversible, converting it into a PR-reported assumption.
      - Approval boundaries (merge, deploy, publish, spend, credentials, production, messaging) always open a Decision regardless of triage.
      - A fixture shaped like Decision 0052 is reported, not opened.
    depends_on: []
    decisions: []
    references: []
  - id: divide-instead-of-stall
    title: A session that cannot finish its Action ends by completing the finishable slice and queueing the remainder as new Actions in the same PR, so the pointer always advances.
    status: done
    responsibility: agent
    effort: session
    next_action: Add a split Agent Ask intent so a session that can only finish part of an Action narrows it to the finished slice instead of stalling.
    expected_artifact: Evidence satisfying Agent Ask divide-instead-of-stall
    clarification: clarified
    confidence: high
    source: Agent Ask split-divide-instead-of-stall-2026-09-24
    acceptance_criteria:
      - A split settlement marks the finished slice done and places remainder Actions immediately after it in the queue.
    depends_on: [merge-completes-the-action]
    decisions: []
    references: []
  - id: settle-complete-from-drafted-ask
    title: Settling a complete Ask whose drafted file sits in the candidate worktree succeeds without manual relocation.
    status: done
    responsibility: agent
    effort: session
    next_action: Settling a complete Ask whose drafted file sits in the candidate worktree succeeds without manual relocation.
    expected_artifact: Evidence satisfying Agent Ask settle-complete-from-drafted-ask
    clarification: clarified
    confidence: high
    source: Agent Ask settle-complete-from-drafted-ask-2026-09-14
    acceptance_criteria:
      - A test drafts a complete Ask in a candidate worktree and settles it with --apply, with no file moved or commit rewritten.
      - The candidate_revision check still refuses evidence recorded against a revision whose code differs from HEAD.
    depends_on: []
    decisions: []
    references: []
  - id: auto-settle-pending-completions-before-dispatch
    title: Before dispatching a coding-agent Session for an Action, the host-side go/advance path detects a drafted complete Agent Ask for the current pointer whose declared acceptance criteria are all covered verbatim, refreshes a stale candidate_revision against current HEAD when the Action's own commit is already on the branch, previews it, and settles it deterministically with no LLM session -- only falling through to a normal agent dispatch when settlement isn't clean or doesn't apply.
    status: done
    responsibility: agent
    effort: session
    next_action: Before dispatching a coding-agent Session for an Action, the host-side go/advance path detects a drafted complete Agent Ask for the current pointer whose declared acceptance criteria are all covered verbatim, refreshes a stale candidate_revision against current HEAD when the Action's own commit is already on the branch, previews it, and settles it deterministically with no LLM session -- only falling through to a normal agent dispatch when settlement isn't clean or doesn't apply.
    expected_artifact: Evidence satisfying Agent Ask auto-settle-pending-completions-before-dispatch
    clarification: clarified
    confidence: high
    source: Agent Ask auto-settle-pending-completions-before-dispatch-2026-09-14
    acceptance_criteria:
      - Given a repository whose current pointer Action already has a drafted complete Ask in .arcadia/asks/, and whose evidence criteria match the Action's declared acceptance criteria verbatim, and whose candidate_revision differs from HEAD only because later commits landed after the draft, go/advance settles it deterministically and re-resolves the pointer without launching any coding-agent process.
      - The same path refuses to auto-settle (and falls through to normal dispatch) when the preview reports any conflict, any required Decision, or evidence that does not verbatim-cover every declared acceptance criterion.
      - A repository with no drafted complete Ask for the current pointer, or no locally resolvable Arcadia workspace, dispatches exactly as it does today with no behavior change.
      - "A test proves the auto-settle path end-to-end against a fixture repo: stale candidate_revision, clean re-preview, settled commit, pointer advanced -- and a second test proves the fallthrough when evidence is incomplete or a conflict exists."
      - docs/agent-continuation-protocol.md and AGENTS.md's 'One session completes one Action' section are updated to describe when a session's settlement instead happens automatically before that session is ever launched.
    depends_on: []
    decisions: []
    references: []
  - id: assess-pr-blast-radius-before-merge
    title: Independently assess a candidate PR's blast radius against its base revision and either record a clean recommendation to proceed, or escalate by opening exactly one Decision naming the concern, before the PR is merged.
    status: done
    responsibility: agent
    effort: session
    next_action: Independently assess a candidate PR's blast radius against its base revision and either record a clean recommendation to proceed, or escalate by opening exactly one Decision naming the concern, before the PR is merged.
    expected_artifact: Evidence satisfying Agent Ask assess-pr-blast-radius-before-merge
    clarification: clarified
    confidence: high
    source: Agent Ask add-assess-pr-blast-radius-before-merge-2026-09-14
    acceptance_criteria:
      - Reuse existing review/QA and Decision infrastructure (review_items, Decision documents, the existing code-review pass) rather than a new bespoke risk model or a second review system.
      - "Compute the assessment from the real diff against the base revision: files touched, lines changed, and whether touched paths fall in named safety/authority/concurrency/canonical-state-transition areas (e.g. src/production/, src/ask/settlement.ts, src/sessions/, src/dispatch/, database migrations, CI/workflow config); diff size alone never decides the outcome."
      - Default to escalate whenever a code-review finding is confirmed/high-severity, a safety/authority/canonical-write path is touched, the review pass could not run, or evidence is stale or missing; only an unambiguous, narrow, low-blast-radius change with no unresolved findings may proceed without escalation.
      - Escalating opens exactly one Decision naming the specific concern, the touched paths, and the review findings verbatim, with a clear recommendation; it never merges, deploys, or blocks unrelated eligible work.
      - Proceeding writes a durable record of the assessment (touched paths, findings considered, why no escalation) linked to the exact candidate revision, and grants no merge, deploy, or publication authority of its own -- this Action produces a recommendation only.
      - "Idempotent: reassessing the same candidate revision returns the same recommendation and never opens a duplicate Decision."
      - The proof harness demonstrates escalation on a deliberately dangerous fixture (a change touching safety/authority code such as src/production/policy.ts, or one that removes a safety check) and a clean pass-through on a deliberately narrow, safe fixture (a comment-only or test-only change), per contract 20's mandatory negative-case requirement.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR.
    depends_on: [advance-approved-production-work]
    decisions: []
    references: ["docs/arcadia-development-orchestration-vision.md", "docs/decisions/0019-streamline-pr-qa-before-expansion.md", "docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/sessions/reconciliation.ts", "src/stewardship/critic.ts", "src/stewardship/artifactValidator.ts", "src/ask/settlement.ts"]
  - id: detect-hung-managed-production-sessions
    title: The worker notices a managed-production Session whose tmux stays alive but has stopped making real progress, not only one whose tmux has died.
    status: done
    responsibility: agent
    effort: session
    next_action: The worker notices a managed-production Session whose tmux stays alive but has stopped making real progress, not only one whose tmux has died.
    expected_artifact: Evidence satisfying Agent Ask detect-hung-managed-production-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask split-hung-detection-and-fault-soak-from-feed-and-supervise-2026-09-14
    acceptance_criteria:
      - Define an observable, deterministic signal for 'stalled' (e.g. no new tmux pane output, no new Run/receipt activity) and a bounded deadline before a live-but-stalled Session is flagged.
      - A flagged stalled Session is surfaced as an explicit uncertain/needs-attention state, never silently reconciled as successful or silently relaunched.
      - The existing repository lease and admission are preserved (not released) while a Session is only suspected stalled, pending operator or bounded automatic repair.
      - "False positives are bounded: a Session doing real long-running work is not flagged merely for being slow."
    depends_on: [feed-and-supervise-managed-production]
    decisions: []
    references: []
  - id: prove-managed-production-fault-matrix
    title: Prove the contract-20 fault-injection matrix and staged evidence bundle before unattended Flight Deck handoff.
    status: done
    responsibility: agent
    effort: session
    next_action: Prove contract 20's deterministic fault matrix for the policy and claim store boundaries, and publish the release evidence index.
    expected_artifact: Evidence satisfying Agent Ask prove-managed-production-fault-matrix
    clarification: clarified
    confidence: high
    source: Agent Ask divide-prove-managed-production-fault-matrix-2026-09-22
    acceptance_criteria:
      - The admission/launch, Off, capacity, and priority/authority race scenarios from the contract-20 boundary table each run at least 100 reproducible seeded interleavings against the real policy and claim store with zero invariant violations, retaining the failing seed and timeline for any violation.
      - "The harness is shown to reject injected defects: disabling each guard it covers in turn makes the matrix fail with a named seed, and any guard it cannot catch is recorded as such."
      - A single release evidence index maps every contract-20 invariant and quality gate to pass/fail/unproven, revision, artifact, and reproduction procedure, with missing live evidence left unproven.
    depends_on: [feed-and-supervise-managed-production]
    decisions: []
    references: []
  - id: combine-advance-monitor-next-into-one-brief
    title: One broker call from a prepared worktree returns the combined result of today's separate advance reconciliation, work-monitor preflight, and next dispatch-brief resolution, and arcadia-go.SKILL.md issues that one call instead of three.
    status: done
    responsibility: agent
    effort: session
    next_action: One broker call from a prepared worktree returns the combined result of today's separate advance reconciliation, work-monitor preflight, and next dispatch-brief resolution, and arcadia-go.SKILL.md issues that one call instead of three.
    expected_artifact: Evidence satisfying Agent Ask combine-advance-monitor-next-into-one-brief
    clarification: clarified
    confidence: high
    source: Agent Ask combine-advance-monitor-next-broker-2026-09-15
    acceptance_criteria:
      - A new broker operation (extending scripts/arcadia-go-broker.ts and src/goBroker.ts) runs the existing advance logic, the existing work-monitor preflight, and the existing next dispatch resolution in one process invocation from the prepared worktree, and returns one combined JSON response including the exact rendered dispatch-brief text the operator must see -- no separate `pnpm arcadia next` invocation is needed to produce that text.
      - The existing standalone advance, work-monitor, and next commands are unchanged and keep working exactly as they do today for any other caller; this adds one new combined entry point rather than removing or altering the individual ones.
      - "A failure at any one of the three stages (for example: dispatch not resolvable, or work-monitor finding a preservation blocker) is reported with the same field-level specificity the standalone command would give for that stage, not swallowed or genericized by the combination."
      - No model or AI call is introduced anywhere in the combined path; it remains exactly as deterministic as the three calls it replaces.
      - arcadia-go.SKILL.md's step 3 is rewritten to issue exactly one launcher call from the prepared worktree and paste its returned brief verbatim as the opening chat message, replacing the current three-call sequence (advance broker, work-monitor broker, pnpm arcadia next); step 4's standalone work-monitor guidance is removed or marked redundant accordingly.
      - "Deterministic tests cover: the combined success path returns all three results including the rendered brief text; a failure injected at each of the three stages individually is reported with that stage's exact failure; and the standalone advance/work-monitor/next commands are proven unaffected by the change."
      - Preserve a runnable operator QA artifact showing the exact before/after command and round-trip count from a prepared worktree.
    depends_on: [make-worktree-runtime-self-contained]
    decisions: []
    references: ["scripts/arcadia-go-broker.ts", "src/goBroker.ts", "src/commands/go.ts", "src/commands/next.ts", "src/commands/workMonitor.ts", "src/agentSetup/arcadia-go.SKILL.md", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md"]
  - id: add-opencode-production-provider
    title: Add a first-class opencode-cli coding-agent provider to the managed-production launch path so prove-two-action-unattended-production can run with opencode instead of the credit-exhausted Codex and Claude providers.
    status: done
    responsibility: agent
    effort: session
    next_action: Add a first-class opencode-cli coding-agent provider to the managed-production launch path so prove-two-action-unattended-production can run with opencode instead of the credit-exhausted Codex and Claude providers.
    expected_artifact: Evidence satisfying Agent Ask add-opencode-production-provider
    clarification: clarified
    confidence: high
    source: Agent Ask add-opencode-production-provider-2026-09-15-v2
    acceptance_criteria:
      - An opencode build coding-agent profile and an opencode-cli provider binding are registered in the workspace config, and provider selection picks them without hardcoding a new opencode name outside the existing provider registry.
      - "The guarded launch path launches opencode non-interactively in the prepared worktree: SessionAgent/SESSION_PROVIDER, buildSessionLaunch, the prepareAgentWorktree agent union plus its opencode worktree root, buildAgentLaunchCommand, the provider-to-agent map, and LAUNCH_ADAPTER_SUPPORT each handle opencode, reusing the existing Session, lease, packet, and promotion guards unchanged."
      - A standing production policy scoped to --provider opencode-cli launches an opencode Session that runs arcadia advance with no per-launch operator click, and a concurrent launch against the same candidate is still refused with the existing lease conflict.
      - opencode admission uses only the existing bounded operator capacity attestation (arcadia production capacity attest), labeled attended and never standing proof; no new capacity source, credit purchase, or paid fallback is introduced.
      - Existing codex and claude selection, launch, refusal, and reconciliation behavior is unchanged, with deterministic tests covering opencode selection, launch-command construction, worktree root, and refusal cases; the full test suite and the core, Discord, and Dashboard builds pass.
      - docs/model-selection.md, START_HERE.md, docs/COMMANDS.md, and the AGENTS.md Codex-only sentence are updated wherever their claims change; the legacy review-approve executor, an opencode planning profile, and go-broker sandbox config stay deferred against a named trigger.
    depends_on: []
    decisions: []
    references: ["src/sessions/index.ts", "src/sessions/worktreePreparation.ts", "src/sessions/launch.ts", "src/sessions/launchPreview.ts", "src/codingAgents/providerAdapters.ts", "src/codingAgents/capacity.ts", "src/commands/capacity.ts", "config/provider-adapters.json", "config/coding-agent-profiles.json"]
  - id: refresh-preservation-heartbeat-off-tick
    title: Preservation transport heartbeat stays fresh during a long worker tick without lying about its routes.
    status: done
    responsibility: agent
    effort: session
    next_action: Preservation transport heartbeat stays fresh during a long worker tick without lying about its routes.
    expected_artifact: Evidence satisfying Agent Ask refresh-preservation-heartbeat-off-tick
    clarification: clarified
    confidence: high
    source: Agent Ask fix-worker-tick-heartbeat-starvation-2026-09-16
    acceptance_criteria:
      - The 5s worker loop re-stamps the existing preservation heartbeat projection (schema arcadia-preservation-transport-v1) with an updated at timestamp and unchanged routes while a tick is in progress, so a concurrent arcadia go-broker status reports both transports READY continuously across a multi-minute runManagedProductionIteration.
      - A deterministic test covers heartbeat freshness during a simulated long tick, and the existing go-request transport tests still pass.
    depends_on: []
    decisions: []
    references: []
  - id: cut-managed-production-tick-cost
    title: The managed-production tick stops repeating per-Project whole-tree document discovery, YAML parsing and spawnSync every iteration, and the living-songbook tick failure is not re-observed every tick.
    status: done
    responsibility: agent
    effort: session
    next_action: The managed-production tick stops repeating per-Project whole-tree document discovery, YAML parsing and spawnSync every iteration, and the living-songbook tick failure is not re-observed every tick.
    expected_artifact: Evidence satisfying Agent Ask cut-managed-production-tick-cost
    clarification: clarified
    confidence: high
    source: Agent Ask fix-worker-tick-heartbeat-starvation-2026-09-16
    acceptance_criteria:
      - The per-tick managed-production iteration no longer re-walks and re-parses unchanged Project trees every tick (observed cost drops from ~85s to seconds in a profiled run, with a before/after measurement recorded as evidence), and per-Project detection semantics are unchanged.
      - A determinism-failing base-branch observation such as the living-songbook one is logged once and retried only when its inputs could have changed, rather than every ~70s tick, with an existing named failure log line retained.
      - pnpm test and the core, Discord, and Dashboard builds pass, and codex/claude launch, refusal, and reconciliation behavior is unchanged.
    depends_on: [refresh-preservation-heartbeat-off-tick]
    decisions: []
    references: []
  - id: stop-writing-base-advances-to-mission-log
    title: Stop writing routine base-branch-advance telemetry into MISSION_LOG.md, keep the durable events record, and surface advances where a human actually looks.
    status: done
    responsibility: agent
    effort: session
    next_action: Stop writing routine base-branch-advance telemetry into MISSION_LOG.md, keep the durable events record, and surface advances where a human actually looks.
    expected_artifact: Evidence satisfying Agent Ask stop-writing-base-advances-to-mission-log
    clarification: clarified
    confidence: high
    source: Agent Ask stop-writing-base-advances-to-mission-log-2026-09-16
    acceptance_criteria:
      - "detectBaseBranchAdvance no longer appends a '— Base branch advanced' section to MISSION_LOG.md and no longer creates a 'chore(arcadia): record base branch advance' commit; the managed_production.base_branch_advanced event row and the production_base_branch_observations dedup row remain the durable record."
      - "Base advances stay visible without the Mission Log: a read-only surface (arcadia production status or the existing activity report) shows recent base-advance events with their previous and new SHA, and the existing worker log line is preserved."
      - The accumulated '— Base branch advanced' sections are removed from MISSION_LOG.md once, and arcadia docs sync ingests the file cleanly afterward with no duplicate-heading validation error.
      - Deterministic tests prove one advance writes exactly one events row, zero MISSION_LOG sections, and zero commits; that the visibility surface reports the previous and new SHA; and that docs sync accepts the trimmed log.
      - Existing codex and claude behaviour, every other Mission Log writer, and the tick's other observations are unchanged; the full test suite and the core, Discord, and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: ["src/production/tick.ts", "MISSION_LOG.md", "src/dashboard/snapshot.ts", "src/activity/report.ts", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md"]
  - id: preserve-projects-with-dependencies
    title: Preservation can validate a Project whose declared objective checks need installed dependencies, or Arcadia declares a genuine self-contained objective check, with the sandbox boundary and the operator remedy made explicit.
    status: done
    responsibility: agent
    effort: session
    next_action: Preservation can validate a Project whose declared objective checks need installed dependencies, or Arcadia declares a genuine self-contained objective check, with the sandbox boundary and the operator remedy made explicit.
    expected_artifact: Evidence satisfying Agent Ask preserve-projects-with-dependencies
    clarification: clarified
    confidence: high
    source: Agent Ask promote-issue-273-preservation-dependencies-2026-09-16
    acceptance_criteria:
      - A Project whose declared objective validation check needs installed dependencies can complete protected preservation, or Arcadia's own Project declares a genuine self-contained objective check that runs inside the existing sandbox; the chosen mechanism and its security boundary are documented, and no check that cannot run is left configured as if it could.
      - "The existing preservation invariants hold or any reviewed exception is narrower and bounded and named: no network, no source writes, regular files only, at most 64 MiB, temporary output only in the private scratch/TMPDIR."
      - advance, go, and go-broker status report this as a named, actionable remedy instead of only validation_commands_missing when a declared check requires dependencies the sandbox refuses.
      - Deterministic tests cover the chosen validation path including pass, fail, and refusal, and prove a check that cannot run reports refusal rather than readiness; existing codex and claude launch, refusal, and reconciliation behavior is unchanged; pnpm test and the core, Discord, and Dashboard builds pass.
    depends_on: [let-agent-preserve-its-candidate]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/273", "src/sessions/preservationValidation.ts", "src/sessions/candidateSnapshot.ts", "src/sessions/manualPreservation.ts", "docs/reports/protected-preservation-qa.md"]
  - id: resolve-agent-handoff-model-per-provider
    title: arcadia go handoff resolves an agent-appropriate launch model instead of passing a plan's provider-specific recommended_model to a different provider, so the protected broker can hand off to opencode without an operator-supplied --model.
    status: done
    responsibility: agent
    effort: session
    next_action: Plans name an agent-agnostic model tier that arcadia go resolves per coding agent, so the protected broker can hand off to opencode without an operator-supplied --model.
    expected_artifact: Evidence satisfying Agent Ask resolve-agent-handoff-model-per-provider
    clarification: clarified
    confidence: high
    source: Agent Ask amend-agent-handoff-model-tiers-2026-09-17
    acceptance_criteria:
      - "One tier registry (bundled defaults plus a workspace override) maps light/standard/heavy to a concrete model per coding agent, and no vendor model is hardcoded outside it: codex gpt-5.6-luna, gpt-5.6-terra, gpt-5.6-sol; claude haiku, sonnet, opus; opencode opencode-go/glm-5.3-flash, opencode-go/deepseek-v4.1-flash, opencode-go/gpt-5.6-luna."
      - arcadia go --agent <agent> resolves a plan recommended_model that names a known tier to that agent's tier model; a plan that names a concrete model uses it as-is only when it is plausible for the chosen agent, and otherwise resolves that agent's standard-tier model. The protected broker path succeeds with no operator-supplied --model.
      - Reasoning effort resolves independently of the tier (--effort, else recommended_reasoning_effort, else the tier's own default), and opencode's --variant mapping from the resolved effort is preserved.
      - "Deterministic tests cover tier resolution for all three agents, concrete-model pass-through when plausible, the concrete-model fallback that fixes GitHub Issue #282 (claude-sonnet-5 handed to opencode resolving to the opencode standard model), and a legible refusal for an unknown tier or an agent with no mapping; existing codex and claude behavior for plausible concrete models is unchanged."
      - "docs/model-selection.md documents the three tiers, the per-agent table, and the rule that new plans declare a tier while existing concrete-model plans keep working through the fallback; docs/COMMANDS.md states the resolution order; the Action closes Issue #282 when it merges and introduces no new approval, capacity, or paid-fallback authority."
      - pnpm test and the core, Discord, and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: []
  - id: fix-agent-go-transport-readiness
    title: The protected broker's agent go transport reports ready only when a worker can actually service a go request, and a timed-out or refused request clears its pending marker so a retry needs no hand-editing.
    status: done
    responsibility: agent
    effort: session
    next_action: "The go and pointer commands are durable: advance queue make-next --apply commits the pointer it writes, and the protected broker's agent go transport reports ready only when a worker can service a request and clears its pending marker on timeout or refusal."
    expected_artifact: Evidence satisfying Agent Ask fix-agent-go-transport-readiness
    clarification: clarified
    confidence: high
    source: Agent Ask amend-fix-go-and-pointer-durability-2026-09-17
    acceptance_criteria:
      - arcadia go-broker status reports the agent go transport NOT READY unless a worker able to service a go request is registered, so a merely fresh heartbeat from a worker whose tick is stuck in managed production can no longer satisfy it.
      - "A go request timeout or refusal removes the pending .arcadia-go-request marker, matching the contract #272 set for the preserve path, so an immediate retry succeeds without removing the file by hand."
      - Deterministic tests cover readiness false while the worker cannot service a request, marker cleanup on timeout and on refusal, and a successful request still returning its host response; the existing preservation transport and managed-production tick behavior is unchanged.
      - arcadia advance queue make-next --apply commits the pointer transition it writes (PROJECT.md and the active plan), on whatever branch it ran from and never pushing, so the governed pointer is durable and the next clean-tree-gated command is not blocked by the pointer move.
      - Deterministic tests prove make-next commits exactly the pointer files and leaves no dirty tree, and that a settlement immediately after a pointer move succeeds with no manual commit.
      - START_HERE.md and docs/COMMANDS.md state that a fresh heartbeat alone is not sufficient for the go transport, name the recovery for a stranded request marker, and state that a pointer move is committed by the command.
      - pnpm test and the core, Discord, and Dashboard builds pass; no new approval, capacity, or paid-fallback authority is introduced.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/283", "https://github.com/pmark/arcadia/issues/284", "src/dispatch/pointer.ts", "src/sessions/preservationTransport.ts", "src/goBroker.ts", "src/commands/goBrokerInstall.ts", "START_HERE.md", "docs/COMMANDS.md"]
  - id: harden-agent-ask-settlement
    title: Agent Ask settlement and its derived slugs are durable and deterministic, so a settle either completes every step or fails cleanly and a long question never produces an invalid slug.
    status: done
    responsibility: agent
    effort: session
    next_action: Agent Ask settlement and its derived slugs are durable and deterministic, so a settle either completes every step or fails cleanly and a long question never produces an invalid slug.
    expected_artifact: Evidence satisfying Agent Ask harden-agent-ask-settlement
    clarification: clarified
    confidence: high
    source: Agent Ask triage-open-bug-issues-2026-09-17
    acceptance_criteria:
      - "A derived Decision or Plan slug from an over-long question is always valid kebab-case: slugify truncates at the 80-character cap without leaving a leading or trailing separator, and a unit test proves an over-long desired_result or question yields a slug the Decision writer accepts (fixes Issue #269)."
      - "agent-ask settle --apply either completes every step (managed-document writes, review-item creation, local commit) or fails cleanly with a clearly reported recoverable state; any post-write side effect (Discord notification, operational sync, database lock) is bounded by a deadline and never gates the local commit (fixes Issue #270)."
      - A regression test settles with the notification/sync path stalled and asserts the command returns and the change is committed; the intermittent hang cannot reoccur without a test failure.
      - Existing settlement behavior for the successful path, and existing codex and claude behavior, are unchanged; pnpm test and the core, Discord, and Dashboard builds pass.
      - "The Action closes GitHub Issues #269 and #270 when it merges."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/269", "https://github.com/pmark/arcadia/issues/270", "src/utils/slug.ts", "src/ask/settlement.ts"]
  - id: clean-up-preserve-transport-request
    title: The preservation requester removes its own reserved transport file on every exit path, matching the go transport, so a refusal or timeout never dirties the candidate worktree.
    status: done
    responsibility: agent
    effort: session
    next_action: The preservation requester removes its own reserved transport file on every exit path, matching the go transport, so a refusal or timeout never dirties the candidate worktree.
    expected_artifact: Evidence satisfying Agent Ask clean-up-preserve-transport-request
    clarification: clarified
    confidence: high
    source: Agent Ask triage-open-bug-issues-2026-09-17
    acceptance_criteria:
      - "requestCandidatePreservation removes its own .arcadia-preserve-request file on success, refusal, and timeout, exactly as requestAgentGo does in its finally block; it removes only its own nonce and never another caller's or a tracked file (fixes Issue #272)."
      - Deterministic tests prove a refused or timed-out preservation request leaves the candidate worktree clean and cannot trip an arcadia go cleanliness check, while a successful request still returns its host response.
      - Existing preservation transport and managed-production tick behavior is unchanged; pnpm test and the core, Discord, and Dashboard builds pass.
      - "The Action closes GitHub Issue #272 when it merges."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/272", "src/sessions/preservationTransport.ts"]
  - id: bind-candidate-revision-in-action-settle
    title: arcadia action settle derives the candidate revision from the same resolved checkout settlement compares against, so the documented candidate-worktree completion path works.
    status: done
    responsibility: agent
    effort: session
    next_action: arcadia action settle derives the candidate revision from the same resolved checkout settlement compares against, so the documented candidate-worktree completion path works.
    expected_artifact: Evidence satisfying Agent Ask bind-candidate-revision-in-action-settle
    clarification: clarified
    confidence: high
    source: Agent Ask triage-open-bug-issues-2026-09-17
    acceptance_criteria:
      - "arcadia action settle computes candidateRevision from the checkout settlement resolves (projectCheckoutFor over the Project repository and cwd), not from the configured main checkout, so completing from a candidate worktree whose HEAD differs from the base HEAD no longer refuses (fixes Issue #278)."
      - A regression test completes an Action from inside a candidate worktree where the candidate branch HEAD differs from the main checkout HEAD and asserts success; the existing main-checkout flow is unchanged.
      - The refusal message, when a revision genuinely does not match, names the actual mismatch rather than misdirecting to 'refresh evidence'.
      - Existing action settle, Agent Ask settlement, and codex and claude behavior is unchanged; pnpm test and the core, Discord, and Dashboard builds pass.
      - "The Action closes GitHub Issue #278 when it merges."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/278", "src/commands/actionSettle.ts", "src/ask/settlement.ts", "src/git/worktrees.ts"]
  - id: translate-reasoning-effort-at-launch
    title: Managed-production launches translate the abstract reasoning-effort key to each provider's native value at the spawn boundary, so a packet whose selection was computed from an execution requirement never hands codex or claude an invalid effort.
    status: done
    responsibility: agent
    effort: session
    next_action: Managed-production launches translate the abstract reasoning-effort key to each provider's native value at the spawn boundary, so a packet whose selection was computed from an execution requirement never hands codex or claude an invalid effort.
    expected_artifact: Evidence satisfying Agent Ask translate-reasoning-effort-at-launch
    clarification: clarified
    confidence: high
    source: Agent Ask triage-open-bug-issues-2026-09-17
    acceptance_criteria:
      - "buildProviderLaunch translates the stored abstract ReasoningEffort key (e1_brief/e2_standard/e3_deep/e4_rigorous) to the provider's native value for codex-cli (low/medium/high/xhigh) and for claude-cli (its own accepted set) at the spawn boundary; the abstract key remains the stored and bound value, and opencode's existing --variant mapping is preserved (fixes Issue #280)."
      - The codex mapping reuses or deliberately mirrors prReview.ts's codexReasoningEffort rather than drifting from it.
      - A launch-argument regression test covers a packet whose selection was recomputed from an Action's execution requirement (the e-key path), not only the packet-verbatim path with native effort strings.
      - Existing launch behavior for the packet-verbatim path, and existing codex, claude, and opencode behavior, is unchanged; pnpm test and the core, Discord, and Dashboard builds pass.
      - "The Action closes GitHub Issue #280 when it merges."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/280", "src/sessions/index.ts", "src/qa/prReview.ts", "src/codingAgents/providerAdapters.ts", "src/codingAgents/agentIdentity.ts"]
  - id: detect-duplicate-ids-and-dangling-refs
    title: docs sync refuses a duplicate Decision id and reports a dangling review-item docRef as a named validation issue, and the duplicate-id migration is recorded as a Decision before any historical renumbering.
    status: done
    responsibility: agent
    effort: session
    next_action: docs sync refuses a duplicate Decision id and reports a dangling review-item docRef as a named validation issue, and the duplicate-id migration is recorded as a Decision before any historical renumbering.
    expected_artifact: Evidence satisfying Agent Ask detect-duplicate-ids-and-dangling-refs
    clarification: clarified
    confidence: high
    source: Agent Ask triage-open-bug-issues-2026-09-17
    acceptance_criteria:
      - "arcadia docs sync refuses to create a Decision whose numeric id already exists in docs/decisions/ and reports the collision as a named validation issue, so a new duplicate 0004/0005 can no longer be written (fixes Issue #268)."
      - "arcadia docs sync detects and reports as a named validation issue any open review item whose sourceInput or docRef points at a document that does not exist on disk, reproducing R195's dangling reference to a non-existent 0053 document (fixes Issue #267)."
      - "Historical duplicate Decision ids are not renumbered by this Action: the migration choice (renumber the later duplicates versus make the slug the canonical handle) is recorded as an open Decision before any renumbering is applied, and R195's disposition (re-point or reject) is decided there."
      - Deterministic tests cover the duplicate-id refusal and the dangling-reference detection, including a clean corpus that stays accepted; existing docs sync ingestion of well-formed documents is unchanged; pnpm test and the core, Discord, and Dashboard builds pass.
      - "The Action closes GitHub Issues #267 and #268 when it merges."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/267", "https://github.com/pmark/arcadia/issues/268", "src/docs/sync.ts", "src/ask/settlement.ts", "docs/decisions/"]
  - id: deliver-session-brief
    title: A managed-production Session is launched with an actionable Action brief instead of session metadata, so an unattended Session knows its task, its constraints and how to finish.
    status: done
    responsibility: agent
    effort: session
    next_action: Deliver the Action brief to every managed-production Session launch so an unattended Session knows its task, its constraints and how to finish.
    expected_artifact: Evidence satisfying Agent Ask deliver-session-brief
    clarification: clarified
    confidence: high
    source: Agent Ask amend-first-real-unattended-run-actions-2026-09-17
    acceptance_criteria:
      - "The managed launch delivers the Action brief to the spawned agent for every configured provider: the Action title and next_action, every acceptance criterion verbatim and in the plan's own order, the candidate worktree path, and the standing constraints (no merge, deploy, publish, push to shared branches, or pointer edits)."
      - "The brief states the exact completion protocol: run the repository's declared validation, request protected preservation through the existing fixed launcher, and settle a `complete` Agent Ask with candidate_revision equal to the worktree HEAD and one `met` evidence entry per criterion, verbatim and in order."
      - The brief is derived from the authoritative plan document for the Session's recorded plan_slug and action_id rather than a hardcoded or stale copy; a missing Action or missing acceptance criteria fails closed with a named error before launch.
      - Deterministic tests cover the rendered brief for an Action carrying criteria and the fail-closed case for a missing Action, and existing provider argument construction (model, effort/variant, worktree cwd, agent Git identity) is unchanged.
      - pnpm test and the core, Discord and Dashboard builds pass; no new approval, capacity or paid-fallback authority is introduced.
      - "The Blocker recorded at docs/reports/planning-agent-route-review-2.md:427-437 is resolved and the PR closes GitHub Issue #292 when it merges."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/292", "src/sessions/index.ts", "src/commands/advance.ts", "src/docs/types.ts", "docs/reports/planning-agent-route-review-2.md"]
  - id: preserve-on-exit-and-integrate
    title: A finished managed-production Session's candidate is preserved and, under an explicit standing grant, integrated into the governed base branch automatically, so the next dependent Action launches with no operator merge between them.
    status: done
    responsibility: agent
    effort: session
    next_action: Preserve a finished managed-production Session's candidate on terminal exit and, only under the authority recorded by Decision 0058, integrate it into the governed base branch so the next dependent Action launches with no operator merge.
    expected_artifact: Evidence satisfying Agent Ask preserve-on-exit-and-integrate
    clarification: clarified
    confidence: high
    source: Agent Ask amend-first-real-unattended-run-actions-2026-09-17
    acceptance_criteria:
      - When a managed-production Session reaches a terminal process state, the host preserves that Session's candidate through the existing candidate-preservation machinery (runPreserveCommand / preserveCandidate) without requiring the agent to have requested preservation while alive; a candidate already preserved is never re-committed.
      - The host validates the candidate with the Project's declared objective validation_commands run host-side where dependencies are available, refuses to preserve on a failed, skipped or absent check, and preserves all candidate files on refusal.
      - Candidate integration happens only under the explicit authority recorded by Decision 0058, never inferred from this Action's acceptance criteria or from a standing production grant that delegates only validation, acceptance and pointer transitions. Before integrating, the mechanism verifies the grant is unexpired and names this Project, Plan, Action, agent-owned branch and governed base branch.
      - Absent a valid grant the mechanism stops after preservation and reports the exact operator merge command; merge, deploy, publish, spend, credentials, messaging and destructive operations remain separate gates.
      - Integration is a fast-forward or clean merge of the grant's own agent-owned branch into the governed base branch; a conflict, a non-agent-owned branch, a divergent base, or a candidate outside the grant scope stops integration, reports the exact blocker, and preserves all work.
      - After integration the Action advances through the existing canonical completion and pointer writers, and the worker admits the next eligible Action with no operator command in between; repeated, concurrent or interrupted reconciliation is idempotent and never duplicates a commit, completion, Decision or pointer move.
      - A deterministic fixture proves terminal-session detection, host-side validation, preservation, integration and admission of the next Action, plus refused-integration cases (a conflict, an expired or absent grant, and an out-of-scope candidate) that preserve all work, and an already-preserved candidate that is not duplicated.
      - pnpm test and the core, Discord and Dashboard builds pass, and the PR states the exact operator procedure, target and recovery command or why no runnable surface exists.
    depends_on: [deliver-session-brief]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/272", "https://github.com/pmark/arcadia/issues/273", "docs/decisions/0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md", "src/sessions/preservationTransport.ts", "src/sessions/candidatePreservation.ts", "src/sessions/reconciliation.ts", "src/production/tick.ts", "src/production/policy.ts", "docs/plans/mission-control-view/17-managed-production-contract.md", "docs/working-copy-safety.md"]
  - id: apply-answered-decision-consequences
    title: Apply an answered Decision's consequence to the Action it governs and advance the governed pointer in one transition.
    status: done
    responsibility: agent
    effort: session
    next_action: Apply an answered Decision's consequence to the Action it governs and advance the governed pointer in one transition.
    expected_artifact: Evidence satisfying Agent Ask apply-answered-decision-consequences
    clarification: clarified
    confidence: high
    source: Agent Ask apply-answered-decision-consequences-2026-09-17
    acceptance_criteria:
      - When a Decision that governs an Action is answered, Arcadia applies the chosen option consequence to that Action checked-in plan record in the same transition (a deferral parks the Action so dispatch stops selecting it), or refuses the answer with a named reason and leaves the Decision and the Action unchanged.
      - When the answer parks the current Action, the governed pointer advances to the next eligible Action in the existing explicit queue with no second operator command and no hand-edited plan field.
      - "The transition is previewable, idempotent and reversible: one receipt records the Decision, the Action field change and the pointer move, and a retry returns the same receipt without duplicate effects."
      - An agent cannot perform this transition directly; Arcadia writes the canonical records, and no local script, second pointer writer or new queue is introduced.
      - "Preserve the proof Artifact: deterministic tests covering the deferral-applies, the refusal naming the missing apply path, the pointer advance, and the idempotent retry, plus the exact operator command in the pull request."
    depends_on: []
    decisions: []
    references: ["docs/decisions/0057-should-prove-two-action-unattended-production-be-deferred-until-the-next-live.md", "docs/decisions/0048-make-arcadia-go-a-total-governed-transition-that-keeps-advancing-whenever-the-ne.md", "src/commands/review.ts", "src/ask/settlement.ts", "src/dispatch/pointer.ts", "src/docs/dispatch.ts"]
  - id: fix-tick-database-open-error-boundary
    title: A transient SQLITE_BUSY while opening the workspace database no longer kills the worker process; it is reported as a tick error and the tick loop retries on its next interval.
    status: done
    responsibility: agent
    effort: session
    next_action: A transient SQLITE_BUSY while opening the workspace database no longer kills the worker process; it is reported as a tick error and the tick loop retries on its next interval.
    expected_artifact: Evidence satisfying Agent Ask fix-tick-database-open-error-boundary
    clarification: clarified
    confidence: high
    source: Agent Ask promote-worker-supervision-defects-2026-09-17
    acceptance_criteria:
      - "openDatabase in tick() (src/commands/worker.ts:118) runs inside the same error boundary as runWorkerIteration, so a throw is logged as Worker tick error: and setTimeout(tick, POLL_INTERVAL_MS) still reschedules."
      - "No uncaught synchronous throw in the tick path can end the loop without a log line: either the moved try covers it or a process-level uncaughtException handler logs and reschedules."
      - A deterministic test forces openDatabase to throw SQLITE_BUSY and asserts the process does not exit, the failure is logged, and a subsequent tick still runs.
      - Existing worker tests pass unchanged, and the happy path issues no additional log output.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/305", "src/commands/worker.ts", "src/db/connection.ts"]
  - id: stop-keepalive-worker-crash-loop
    title: An installed worker launch agent stops respawning forever when a worker already holds the workspace pidfile, and a duplicate agent for one workspace is detected instead of silently reinstalled.
    status: done
    responsibility: agent
    effort: session
    next_action: An installed worker launch agent stops respawning forever when a worker already holds the workspace pidfile, and a duplicate agent for one workspace is detected instead of silently reinstalled.
    expected_artifact: Evidence satisfying Agent Ask stop-keepalive-worker-crash-loop
    clarification: clarified
    confidence: high
    source: Agent Ask promote-worker-supervision-defects-2026-09-17
    acceptance_criteria:
      - "arcadia worker install no longer produces an agent that crash-loops on the benign already-running path: worker start exits 0 there, or the generated plist uses KeepAlive with SuccessfulExit false, and a test asserts the generated plist shape."
      - After a fresh install with a second worker already running for the same workspace, .arcadia/worker.log gains no repeated already-running lines over a sustained interval.
      - The launch-agent audit (src/runtime/launchAgents.ts) reports when two installed agents resolve to the same workspace, and its remedy names the correct command rather than a reinstalling one.
      - Deterministic tests cover the already-running exit path and the duplicate-workspace audit; existing runtime-pinning tests pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/303", "src/commands/worker.ts", "src/runtime/launchAgents.ts"]
  - id: fix-decision-deferral-review-bugs
    title: "decision approve defer path honors --dry-run, requires approved status, and re-applies a later deferral (issues #315, #316, #317)."
    status: done
    responsibility: agent
    effort: session
    next_action: "decision approve defer path honors --dry-run, requires approved status, and re-applies a later deferral (issues #315, #316, #317)."
    expected_artifact: Evidence satisfying Agent Ask fix-decision-deferral-review-bugs
    clarification: clarified
    confidence: high
    source: Agent Ask fix-decision-deferral-review-bugs-2026-09-18
    acceptance_criteria:
      - "decision approve --dry-run never commits, even when an unapplied receipt exists (#315), with a test."
      - "A defer effect is applied only when the recorded status is approved (#316), with a test."
      - "Re-approving a previously applied deferral after revival writes and commits the new deferral (#317), with a test."
    depends_on: []
    decisions: []
    references: []
  - id: fix-plan-mode-planning-artifact
    title: Make a claude --print --permission-mode plan planning Run produce a plan that passes planning-artifact validation, by carrying the full plan in final.md or reading the plan file Claude wrote.
    status: done
    responsibility: agent
    effort: session
    next_action: Make a claude --print --permission-mode plan planning Run produce a plan that passes planning-artifact validation, by carrying the full plan in final.md or reading the plan file Claude wrote.
    expected_artifact: Evidence satisfying Agent Ask fix-plan-mode-planning-artifact
    clarification: clarified
    confidence: high
    source: Agent Ask plan-mode-planning-artifact-2026-09-19
    acceptance_criteria:
      - A plan-mode planning Run whose plan is written by Claude passes codex_planning_artifact_validation.
      - A test reproduces the plan-in-plan-file, summary-in-final.md case and fails before the fix.
    depends_on: []
    decisions: []
    references: []
  - id: fix-accepted-plan-to-build-packet-path
    title: Accepting a validated planning Artifact for a governed plan-document Action prepares, or offers exactly one supported command to prepare, its immutable build packet and build approval, so managed production can launch it.
    status: done
    responsibility: agent
    effort: session
    next_action: Accepting a validated planning Artifact for a governed plan-document Action prepares, or offers exactly one supported command to prepare, its immutable build packet and build approval, so managed production can launch it.
    expected_artifact: Evidence satisfying Agent Ask fix-accepted-plan-to-build-packet-path
    clarification: clarified
    confidence: high
    source: Agent Ask promote-issue-404-accepted-plan-to-build-packet-2026-09-19
    acceptance_criteria:
      - A test shows an accepted validated planning Artifact for a plan-document Action yields a build packet and build approval through one supported command or automatically.
      - session preview-launch reports Ready for that Action once the build approval exists, with a test covering it.
    depends_on: []
    decisions: []
    references: []
  - id: fix-packet-lifecycle-latest-planning-decision
    title: Make resolvePacketLifecycle read the latest planning Decision instead of the oldest.
    status: done
    responsibility: agent
    effort: session
    next_action: Make resolvePacketLifecycle read the latest planning Decision instead of the oldest.
    expected_artifact: Evidence satisfying Agent Ask fix-packet-lifecycle-latest-planning-decision
    clarification: clarified
    confidence: high
    source: Agent Ask promote-issue-404-accepted-plan-to-build-packet-2026-09-19
    acceptance_criteria:
      - A test with an old finished planning Decision and a newer accepted one shows the lifecycle remedy names the newer Decision, and it fails before the fix.
    depends_on: []
    decisions: []
    references: []
  - id: restore-preservation-worker-heartbeat
    title: Make the managed Arcadia worker publish and maintain a fresh preservation and Go-route heartbeat after restart, with deterministic coverage for startup and stale-heartbeat refusal paths.
    status: done
    responsibility: agent
    effort: session
    next_action: Make the managed Arcadia worker publish and maintain a fresh preservation and Go-route heartbeat after restart, with deterministic coverage for startup and stale-heartbeat refusal paths.
    expected_artifact: Evidence satisfying Agent Ask restore-preservation-worker-heartbeat
    clarification: clarified
    confidence: high
    source: Agent Ask promote-fix-preservation-worker-heartbeat-2026-09-19
    acceptance_criteria:
      - "After `restart-services.sh restart` reports the worker running, `arcadia go-broker status --json` reports `preservationTransport.ready: true` and a usable Go transport state for the configured workspace."
      - A deterministic regression test proves the worker publishes a preservation heartbeat after startup and that a missing or stale heartbeat fails with a diagnostic that identifies the worker route.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/411"]
  - id: gate-prepared-dispatch-on-transport-readiness
    title: Add deterministic prepared-dispatch admission checks that refuse task preparation until the selected profile can access the resolved workspace database and fresh Go and preservation transport heartbeats are available.
    status: done
    responsibility: agent
    effort: session
    next_action: Add deterministic prepared-dispatch admission checks that refuse task preparation until the selected profile can access the resolved workspace database and fresh Go and preservation transport heartbeats are available.
    expected_artifact: Evidence satisfying Agent Ask gate-prepared-dispatch-on-transport-readiness
    clarification: clarified
    confidence: high
    source: Agent Ask promote-pre-dispatch-transport-readiness-2026-09-19
    acceptance_criteria:
      - A deterministic pre-dispatch check refuses preparation with an actionable remedy when the workspace database cannot be opened by the selected agent profile.
      - A deterministic pre-dispatch check refuses preparation when either Go-capable or preservation transport lacks a fresh heartbeat, before a coding agent is started.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/411", "src/goBroker.ts", "src/sessions/preservationTransport.ts"]
  - id: verify-worker-recovery-before-success
    title: Make the managed worker control path fail on launchd load failure and report success only after the worker has recovered stale state and published fresh preservation and Go-route heartbeats.
    status: done
    responsibility: agent
    effort: session
    next_action: Make the managed worker control path fail on launchd load failure and report success only after the worker has recovered stale state and published fresh preservation and Go-route heartbeats.
    expected_artifact: Evidence satisfying Agent Ask verify-worker-recovery-before-success
    clarification: clarified
    confidence: high
    source: Agent Ask promote-truthful-worker-recovery-2026-09-19
    acceptance_criteria:
      - A failed launchd load or bootstrap makes worker recovery return a nonzero actionable refusal instead of reporting that the worker started.
      - After a successful managed restart, worker recovery verifies a fresh preservation heartbeat and a fresh Go-capable heartbeat before reporting ready.
      - A regression test covers a stale worker state and a launchd startup failure without relying on a live macOS service.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/411", "src/commands/worker.ts", "src/sessions/preservationTransport.ts", "src/commands/goBrokerInstall.ts"]
  - id: surface-terminal-operator-approvals-in-runs
    title: Add a /runs approval queue that presents only terminal operator-only approvals, each with its essential recommended option and a details expansion containing evidence, costs, consequences, alternatives, and the exact canonical settlement effect.
    status: done
    responsibility: agent
    effort: session
    next_action: Add the /runs approval queue's listing, recommended-option details, and canonical settlement wiring for pending Agent Asks and open Decisions.
    expected_artifact: Evidence satisfying Agent Ask surface-terminal-operator-approvals-in-runs
    clarification: clarified
    confidence: high
    source: Agent Ask split-surface-terminal-operator-approvals-in-runs-2026-09-24-v3
    acceptance_criteria:
      - /runs lists every pending Agent Ask and other terminal operator-only approval that blocks managed production, while excluding mechanics agents may safely perform.
      - Each queue item offers one minimal recommended action plus an expandable details view that states evidence, cost, consequence, alternatives, and what the canonical settlement will change.
      - Choosing an option invokes the existing fingerprinted canonical settlement path, preserves approval boundaries, and records one durable receipt.
    depends_on: []
    decisions: []
    references: ["apps/dashboard/app/runs", "apps/dashboard/components", "src/agentAsk", "src/dashboard/snapshot.ts", "src/commands/agentAsk.ts", "docs/plans/mission-control-view/17-managed-production-contract.md", "scripts/services.sh", "src/commands/worker.ts", "artifacts/generated/operator-scripts"]
  - id: reference-constitution-without-duplicating-it
    title: Replace repeated Constitution text in dispatch, next, and session briefs with one canonical repository reference and content fingerprint; load only the applicable canonical clauses at an authority-sensitive boundary.
    status: done
    responsibility: agent
    effort: session
    next_action: Replace repeated Constitution text in dispatch, next, and session briefs with one canonical repository reference and content fingerprint; load only the applicable canonical clauses at an authority-sensitive boundary.
    expected_artifact: Evidence satisfying Agent Ask reference-constitution-without-duplicating-it
    clarification: clarified
    confidence: high
    source: Agent Ask reduce-constitution-dispatch-duplication-2026-09-19
    acceptance_criteria:
      - A dispatch and agent brief identify the repository CONSTITUTION.md and its content fingerprint without embedding its full text more than once across the handoff path.
      - An agent still receives or deterministically loads the canonical Constitution before performing an authority-sensitive action, and a changed or unreadable Constitution fails closed with an actionable remedy.
      - Regression tests prove dispatch and session briefs remain bounded while constitution drift or unreadability cannot silently weaken the contract.
    depends_on: []
    decisions: []
    references: ["CONSTITUTION.md", "AGENTS.md", "src/docs/dispatch.ts", "src/commands/next.ts", "src/sessions/actionBrief.ts", "src/projects/contextSetup.ts"]
  - id: recover-protected-go-base-divergence
    title: Make the host-controlled Arcadia Go path safely reconcile governed local base commits with merged remote changes, or generate a bounded operator script that invokes only that supported route and returns a prepared-worktree receipt.
    status: done
    responsibility: agent
    effort: session
    next_action: Make the host-controlled Arcadia Go path safely reconcile governed local base commits with merged remote changes, or generate a bounded operator script that invokes only that supported route and returns a prepared-worktree receipt.
    expected_artifact: Evidence satisfying Agent Ask recover-protected-go-base-divergence
    clarification: clarified
    confidence: high
    source: Agent Ask promote-protected-go-divergence-recovery-2026-09-19
    acceptance_criteria:
      - When the local base is ahead and behind its configured remote, protected Arcadia Go either completes a host-controlled reconciliation with an auditable receipt or refuses with a generated bounded operator script; it never directs a coding agent to manually rebase or merge.
      - A deterministic regression test covers the divergent-base case and proves no prepared worktree is issued before the supported reconciliation outcome is known.
      - A live host probe after the repair returns a valid prepared or resumed worktree receipt through the protected Go request path.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/419", "src/goBroker.ts", "src/sessions/preservationTransport.ts", "scripts/arcadia-go-broker.ts"]
  - id: substitute-unavailable-provider-before-binding
    title: Substitute an equivalent-or-stronger permitted provider before packet binding when hard evidence shows the intended provider cannot execute the work, record and surface the substitution, and never switch providers once execution has begun.
    status: done
    responsibility: agent
    effort: session
    next_action: Substitute an equivalent-or-stronger permitted provider before packet binding when hard evidence shows the intended provider cannot execute the work, record and surface the substitution, and never switch providers once execution has begun.
    expected_artifact: Evidence satisfying Agent Ask substitute-unavailable-provider-before-binding
    clarification: clarified
    confidence: high
    source: Agent Ask substitute-unavailable-provider-before-binding-2026-09-21
    acceptance_criteria:
      - "Substitution happens only before packet binding, reusing selectCompliantCodingAgent's existing capability, tools, context, locality and sandbox floors: the replacement is equivalent-or-stronger and never a weaker or cheaper substitution, and when no equivalent eligible permitted provider exists Arcadia surfaces the incapacity normally rather than lowering a capability floor to keep work moving."
      - "Hard evidence is a closed enum in code rather than a heuristic, containing exactly: provider unavailable, model unavailable, authentication failure, explicit quota or rate-limit rejection, and one explicitly named deterministic launch-precluding catch-all. Advisory capacity estimates — including an unadmitted, stale, reserve-margin or exhausted capacity decision — never trigger substitution, and a regression test fails if a value is added to or removed from the closed set without the change being deliberate."
      - intended_provider, selected_provider and substitution_reason are recorded where an operator sees them in aggregate — the Session or Plan log, not only the per-launch preview — and the record names which hard-evidence value caused the substitution.
      - "Once packet binding or execution has begun, provider identity is execution history: no automatic cross-provider retry, re-admission or provider swap occurs, and a mid-session failure still terminates or suspends under the existing recovery rules. feed-and-supervise-managed-production criterion 5 is unchanged by this Action."
      - A substitution never replays work the intended provider already applied and never changes an immutable packet's bound provider; resumed work is recorded against the provider that actually runs it, with the resume guidance the existing selection contract already produces.
      - Deterministic tests cover substitution for each hard-evidence value, refusal to substitute on advisory capacity alone (unadmitted, stale, reserve-margin, exhausted), refusal when no equivalent permitted provider exists without lowering a floor, and the post-binding guarantee that no switch occurs.
      - pnpm test and the core, Discord and Dashboard builds pass, and the PR states the exact operator procedure, target and recovery command or why no runnable surface exists.
    depends_on: []
    decisions: []
    references: ["docs/decisions/0063-how-should-arcadia-handle-a-provider-that-cannot-run-the-work-given-that.md", "src/codingAgents/capacity.ts", "src/sessions/launchPreview.ts", "src/codingAgents/providerAdapters.ts", "docs/model-selection.md", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md"]
  - id: an-agent-ask-action-amendment-can
    title: An Agent Ask action-amendment can move an existing Actions responsibility to requires_review or blocked, not only to agent or autonomous, per Decision 0045s already-ratified, direction-agnostic answer.
    status: done
    responsibility: agent
    effort: session
    next_action: An Agent Ask action-amendment can move an existing Actions responsibility to requires_review or blocked, not only to agent or autonomous, per Decision 0045s already-ratified, direction-agnostic answer.
    expected_artifact: Evidence satisfying Agent Ask an-agent-ask-action-amendment-can
    clarification: clarified
    confidence: high
    source: Agent Ask widen-agent-ask-responsibility-reclassification-2026-09-22
    acceptance_criteria:
      - arcadia agent-ask settle --responsibility requires_review (or blocked) succeeds for an action-amendment intent, on explicit operator direction in the live session, matching the existing agent/autonomous behavior.
      - arcadia agent-ask settle --responsibility <unrecognized value> is refused with a clear error naming the accepted values.
      - A regression test amends an existing Actions responsibility to requires_review through this path and asserts the written plan document and settlement effects.
      - No change to the existing restriction that a brand-new Action still requires an explicit --responsibility at creation time.
    depends_on: []
    decisions: []
    references: ["src/commands/agentAsk.ts", "src/ask/settlement.ts", "src/cli.ts", "src/domain/constants.ts", "docs/decisions/0045-agent-ask-can-amend-action-responsibility.md", "docs/decisions/0064-resolve-how-to-handle-prove-zero-prompt-production-loop-being-dispatched-to.md", "tests/agent-ask-settlement.test.ts"]
  - id: formalize-two-phase-planning-process
    title: A documented, reusable two-phase planning process (Outcome Alignment Interview, then Staff Planning Architect) exists as vendor-neutral Arcadia documentation plus Claude Code skills wrapping it.
    status: done
    responsibility: agent
    effort: session
    next_action: A documented, reusable two-phase planning process (Outcome Alignment Interview, then Staff Planning Architect) exists as vendor-neutral Arcadia documentation, discoverable from AGENTS.md so every coding agent (not only Claude Code) can run it.
    expected_artifact: Evidence satisfying Agent Ask formalize-two-phase-planning-process
    clarification: clarified
    confidence: high
    source: Agent Ask scope-planning-process-build-criterion-2026-09-22
    acceptance_criteria:
      - "docs/planning-process.md exists, vendor-neutral, and states the two-phase process: Phase 1 (Outcome Alignment Interview) produces a confirmed Outcome/Milestone plus any open Decisions with options and consequences; Phase 2 (Staff Planning Architect) consumes that and produces a Plan amendment or new Plan with dependency-ordered, session-sized Actions."
      - The document embeds both role prompts in full, written so they can be pasted into any coding-agent or chat surface -- Claude Code, Codex, opencode, or a bare frontier-model chat -- not gated behind a single vendors skill mechanism.
      - The document states how to invoke each phase today (a coding-agent session prompt, or pasting the role prompt directly) given that Claude Code skills live outside this repository at ~/.claude/skills and are not repository-managed content; wiring automatic invocation into arcadia ask routing is named as an explicit deferred trigger, not built here.
      - AGENTS.md gains a short pointer to docs/planning-process.md so a future session of any vendor can discover it without being told.
      - Neither the document invents a new Arcadia document type or CLI capability; both phases produce only Agent Asks against existing intents (outcome, milestone, decision, plan, action).
      - "mise exec -- pnpm exec tsc -p tsconfig.json --noEmit passes, and arcadia docs sync reports no new errors attributable to the changed files; pnpm builds full-repo lint step is not a gate here, since it already fails in a prepared worktree on files this Action never touches (tracked, unrelated, in Issue #480)."
    depends_on: []
    decisions: []
    references: ["AGENTS.md", "docs/managed-documents.md", "docs/arcadia-semantics.md", "docs/agents-context.md", "CONSTITUTION.md"]
  - id: refresh-managed-production-readiness-2026-09-22
    title: docs/managed-production-readiness.md accurately reflects live Plan/Decision/production state as of 2026-09-22 and names the shortest remaining path to indefinite unattended production.
    status: done
    responsibility: agent
    effort: session
    next_action: docs/managed-production-readiness.md accurately reflects live Plan/Decision/production state as of 2026-09-22 and names the shortest remaining path to indefinite unattended production.
    expected_artifact: Evidence satisfying Agent Ask refresh-managed-production-readiness-2026-09-22
    clarification: clarified
    confidence: high
    source: Agent Ask refresh-managed-production-readiness-2026-09-22
    acceptance_criteria:
      - "The gate tables reflect each named Actions current status: and Gate 2 is marked closed now that verify-worker-recovery-before-success, fix-packet-lifecycle-latest-planning-decision, and translate-reasoning-effort-at-launch are done."
      - "prove-zero-prompt-production-loop is described accurately: reclassified to responsibility requires_review this session (Decision 0064, PR #481), so it is no longer wrongly dispatched to coding agents; separately, the real rehearsals Action A succeeded live with opencode on 2026-09-21 per MISSION_LOG, and the specific remaining technical gap is named (Issue #460)."
      - The new current-pointer Action substitute-unavailable-provider-before-binding is named, with its concrete blocker (packet lifecycle planning_required, per arcadia session preview-launch).
      - "The newly filed worker-hang defect (Issue #485) is named as a blocker to the indefinite-unattended claim specifically, distinct from the existing detect-hung-managed-production-sessions Action which covers hung Sessions, not a hung worker daemon itself."
      - The critical path list is re-sequenced in dependency order against current Plan state, and the Last derived date and executive summary numbers (distance, gate counts, scoreboard) are updated to match.
      - External blockers table is re-verified against live arcadia production capacity output and MISSION_LOG, correcting the stale opencode Unexpected server error claim.
      - Every claim in the refreshed document traces to a live command output, a Plan document field, a Decision file, or a MISSION_LOG entry actually read during this Action -- no guessing forward from the prior version.
    depends_on: []
    decisions: []
    references: ["docs/managed-production-readiness.md", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "PROJECT.md", "MISSION_LOG.md", "docs/decisions/0064-resolve-how-to-handle-prove-zero-prompt-production-loop-being-dispatched-to.md"]
  - id: self-heal-hung-worker-heartbeat
    title: arcadia worker start/status detects a stale-heartbeat worker process as unhealthy rather than already running, and recovers it automatically (or fails loudly with an actionable remedy an automated caller can act on) instead of requiring a human to find the PID and force-kill it.
    status: done
    responsibility: agent
    effort: session
    next_action: arcadia worker start/status detects a stale-heartbeat worker process as unhealthy rather than already running, and recovers it automatically (or fails loudly with an actionable remedy an automated caller can act on) instead of requiring a human to find the PID and force-kill it.
    expected_artifact: Evidence satisfying Agent Ask self-heal-hung-worker-heartbeat
    clarification: clarified
    confidence: high
    source: Agent Ask file-worker-heartbeat-recovery-2026-09-22
    acceptance_criteria:
      - arcadia worker status classifies a process whose heartbeat exceeds the existing staleness threshold as unhealthy even when the process is alive, matching the same threshold arcadia-preserve-broker-* already uses to refuse.
      - "arcadia worker start detects an unhealthy (stale-heartbeat) existing process rather than reporting Worker already running, and either terminates and relaunches it automatically or exits non-zero naming the exact stale PID and remedy -- it must not silently leave a hung process in place the way it did in Issue #485."
      - "Recovery from a hung process is safe under launchds concurrent restart semantics: no duplicate worker processes, no orphaned pidfile pointing at a dead PID, and no lost in-flight preservation or production state beyond what a normal worker restart already tolerates."
      - A regression test reproduces a stale-heartbeat-but-alive worker process (fixture, not a real 159-minute hang) and asserts status reports unhealthy and start recovers it without manual intervention.
      - This Action does not attempt to root-cause why the original process accumulated 159 minutes of CPU time or ignored SIGTERM -- that investigation is out of scope here and, if still worth doing after this ships, is a separate deferred item; this Action only has to make the symptom self-healing.
      - "docs/managed-production-readiness.md is updated to reflect the fix once it ships: the worker-hang section is closed out or rescoped depending on what actually shipped, per that documents own refresh discipline."
    depends_on: []
    decisions: []
    references: ["src/commands/worker.ts", "docs/managed-production-readiness.md"]
  - id: surface-batch-readiness-view
    title: The dashboards /runs page shows the current batch (ready-set prefix to the next operator gate) as parallel lanes with a token rollup, and the same computed batch position is mirrored onto GitHub board cards via the existing status-projection pipeline.
    status: done
    responsibility: agent
    effort: session
    next_action: The dashboards /runs page shows the current batch (ready-set prefix to the next operator gate) as parallel lanes with a token rollup, and the same computed batch position is mirrored onto GitHub board cards via the existing status-projection pipeline.
    expected_artifact: Evidence satisfying Agent Ask surface-batch-readiness-view
    clarification: clarified
    confidence: high
    source: Agent Ask surface-batch-readiness-view-2026-09-22
    acceptance_criteria:
      - resolveReadySet (or a thin wrapper over it) groups its existing ready-set output into lanes by repo/Project -- same-repo Actions in one lane labeled sequence-advised, different-repo Actions each in their own lane -- and sums each lanes token_impact tier plus an overall total, with zero model calls.
      - "The same function computes the batch boundary: walk the dependency-clear ready set forward from current_action and stop at the first Decision, deferred Action, clarification: question_open Action, or capacity-gated proof run; everything before the boundary is the batch, everything after is named but not expanded."
      - apps/dashboard/app/runs/page.tsx and production-control-panel.tsx extend the existing Next up section into This push (the batch, expanded, lanes visible) and Next push (collapsed by default, same pattern as Recent history) instead of the current flat list; the boundary itself renders as an actionable prompt (a Decision link, an un-defer control, or a plain named blocker) rather than prose.
      - This reuses the existing /api/production-control route and useProductionControl hook -- extend their payload/types, do not add a new API route or a new top-level dashboard page.
      - The GitHub board mirror writes the computed lane/batch position through the existing card-status projection pipeline (the same mechanism Gate 1 already uses to keep Arcadia status fresh per card), recomputed on the same cadence as that projection -- never cached separately, since a stale batch label on a card is worse than none.
      - The mirror does not attempt to create or manage a GitHub Projects saved view, grouped board, or swimlane -- GitHubs API has no capability for that (confirmed, docs/managed-production-readiness.md Gate 1). Document that creating a grouped view from the mirrored field is a one-time manual operator step in GitHubs own UI, not something this Action builds.
      - A regression test covers lane grouping (same-repo vs cross-repo), the boundary computation stopping at each of the four named gate types, and token rollup arithmetic, using a fixture Plan rather than live production state.
    depends_on: []
    decisions: []
    references: ["src/docs/dispatch.ts", "apps/dashboard/components/production-control-panel.tsx", "apps/dashboard/app/runs/page.tsx", "apps/dashboard/hooks/use-production-control.ts", "docs/managed-production-readiness.md", "docs/github-board-guide.md", "docs/production-scheduling.md"]
  - id: serialize-current-action-writes
    title: arcadia agent-ask settle's current_action/Plan pointer write for project_update and complete goes through transitionActionPointer's existing fingerprint-checked compare-and-set instead of settleAgentAsk's own independent, unguarded read-then-write.
    status: done
    responsibility: agent
    effort: session
    next_action: arcadia agent-ask settle's current_action/Plan pointer write for project_update and complete goes through transitionActionPointer's existing fingerprint-checked compare-and-set instead of settleAgentAsk's own independent, unguarded read-then-write.
    expected_artifact: Evidence satisfying Agent Ask serialize-current-action-writes
    clarification: clarified
    confidence: high
    source: Agent Ask action-serialize-current-action-writes-2026-09-22
    acceptance_criteria:
      - "settleAgentAsk's PROJECT.md/Plan pointer write for project_update and complete routes through transitionActionPointer (or reuses its fingerprint discipline: headBefore plus both documents' content hashes, verified fresh at write time) instead of its own independent readFileSync-then-writeFileSync-via-temp-file path."
      - "The retry rule preserves an explicitly resolved settlement target: project_update and complete can resolve an Action outside queue order, and a compare-and-set failure retries the pointer transition against that same resolved target, re-reading only the base content for a fresh diff -- it never re-derives current_action from fresh queue state, which could silently retarget a different Action."
      - A compare-and-set failure retries under the same settlementRequestId, since that id is what the existing duplicate-settlement guard already keys idempotency on.
      - writePairAtomically's existing pair-write (PROJECT.md and the Plan document, inside transitionActionPointer's db.transaction) covers the settlement path too, so a retry or a concurrent transition cannot interleave the two documents' renames or leave them pointing at different current_action values.
      - "A regression test reproduces two concurrent settlements for two different Actions racing to write current_action: the second settlement's compare-and-set fails against the first's already-applied change, retries against fresh state, and both pointer moves are preserved in the correct final order -- neither is silently discarded."
      - pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: []
  - id: plan-scoped-agent-ask-complete
    title: "arcadia agent-ask settle --intent complete accepts target_ref: plan/<plan-slug>#<action-id>, resolving and completing that Action in its own (possibly non-active) plan, writing PROJECT.md and the active plan's current_action only when the completed Action is actually in the active plan."
    status: done
    responsibility: agent
    effort: session
    next_action: "arcadia agent-ask settle --intent complete accepts target_ref: plan/<plan-slug>#<action-id>, resolving and completing that Action in its own (possibly non-active) plan, writing PROJECT.md and the active plan's current_action only when the completed Action is actually in the active plan."
    expected_artifact: Evidence satisfying Agent Ask plan-scoped-agent-ask-complete
    clarification: clarified
    confidence: high
    source: Agent Ask action-plan-scoped-agent-ask-complete-2026-09-22
    acceptance_criteria:
      - "target_ref of the form plan/<plan-slug>#<action-id> resolves and completes that Action in the named plan, regardless of whether that plan is the Project's active_plan; plain action/<id> is unchanged and continues to mean the active plan."
      - Completing an Action in a non-active plan does not write PROJECT.md and does not change the active plan's current_action or queue; the settlement records that the pointer and active plan were left untouched.
      - A non-unique Action id across the Project's plans is refused with a clear error, matching the existing guard used by plan activation.
      - "Every other complete-intent validation is unchanged for both forms: evidence must cover every declared acceptance criterion verbatim and in order, all evidence must be met, candidate_revision must match HEAD, unresolved required review Decisions refuse completion, and the existing clean-tree/preview-fingerprint/replay-receipt/Mission-Log behavior is preserved."
      - "arcadia agent-ask contract's complete example and AGENTS.md's complete-intent description both document the plan/<slug>#<action-id> form, not only action/<id>."
      - "Regression tests cover: completing an Action in a non-active plan while a different plan stays active throughout, asserting the active plan's document and PROJECT.md are byte-for-byte unchanged; and refusing an ambiguous or unresolvable plan-scoped target_ref."
      - pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: []
  - id: prove-fault-matrix-remaining-boundaries
    title: Extend the seeded contract-20 fault matrix to the completion/pointer, process-health, and runtime boundaries, and close the missing-artifact quality-gate negative case.
    status: done
    responsibility: agent
    effort: session
    next_action: Extend the seeded contract-20 fault matrix to the completion/pointer, process-health, and runtime boundaries, and close the missing-artifact quality-gate negative case.
    expected_artifact: Evidence satisfying Agent Ask prove-fault-matrix-remaining-boundaries
    clarification: clarified
    confidence: high
    source: Agent Ask divide-prove-managed-production-fault-matrix-2026-09-22
    acceptance_criteria:
      - The completion/pointer, process-health, and runtime race scenarios from the contract-20 boundary table each run at least 100 reproducible seeded interleavings with crash injection points specified in the harness, with zero invariant violations and retained failing-seed/timeline evidence for any violation found and fixed.
      - A completion whose declared Artifact is absent is refused, with a test.
      - docs/evidence/managed-production-release-evidence-index.md is updated with each new row's status, revision, and reproduction procedure.
    depends_on: [prove-managed-production-fault-matrix, detect-hung-managed-production-sessions]
    decisions: []
    references: ["tests/production-fault-matrix.test.ts", "docs/evidence/managed-production-release-evidence-index.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md"]
  - id: run-managed-production-live-soak
    title: Run contract 20's live stages 2-4 under operator-granted scope and capacity authority, and record the results in the release evidence index.
    status: open
    responsibility: agent
    effort: session
    next_action: Run contract 20's live stages 2-4 under operator-granted scope and capacity authority, and record the results in the release evidence index.
    expected_artifact: Evidence satisfying Agent Ask run-managed-production-live-soak
    clarification: clarified
    confidence: high
    source: Agent Ask divide-prove-managed-production-fault-matrix-2026-09-22
    acceptance_criteria:
      - The two-dependent-Action live rehearsal passes from one activation with no manual Session relay, with every human intervention recorded.
      - Both configured providers complete real bounded Actions, with capacity failure/reset tests naming which evidence is real and which is simulated.
      - "A bounded real soak completes: at least ten accepted small Actions across at least two Projects and both providers, across two worker restarts, an Off/reactivation, and one injected recoverable failure, with zero duplicate launches, lost outputs, unauthorized transitions, falsely accepted results, or manual Session relays."
      - docs/evidence/managed-production-release-evidence-index.md maps each live stage to pass/fail/unproven, revision, artifact, and reproduction procedure.
    depends_on: [prove-fault-matrix-remaining-boundaries, prove-two-action-unattended-production, prove-multi-provider-production-recovery, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["docs/evidence/managed-production-release-evidence-index.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md"]
  - id: add-segment-queue-arrange
    title: Add a batch queue operation that places an ordered list of keys at one position, keeping every other row's relative order, and make settle placement preserve the active Plan's existing relative order.
    status: open
    responsibility: agent
    effort: session
    next_action: Add a batch queue operation that places an ordered list of keys at one position, keeping every other row's relative order, and make settle placement preserve the active Plan's existing relative order.
    expected_artifact: Evidence satisfying Agent Ask add-segment-queue-arrange
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - One `arcadia advance queue` invocation places an ordered list of existing approved keys at the top, or before or after an anchor, with preview, --apply, --request-id idempotency, and --revision optimistic concurrency; every key not listed keeps its relative order, and the whole move commits atomically as one queue revision.
      - The command refuses, before writing, an order that puts an Action ahead of a dependency, naming the offending key and dependency.
      - "`agent-ask settle` with --top, --before, or --after inserts newly created Actions without changing the relative order of the active Plan's existing positioned rows, placing each new Action immediately after its latest dependency when no anchor is given."
      - Deterministic tests cover the segment move, the dependency refusal, idempotent replay, a stale-revision refusal, and a settle insertion that leaves existing Plan order unchanged.
      - START_HERE.md or docs/COMMANDS.md documents the command with one example.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["src/ask/settlement.ts", "src/commands/advance.ts", "docs/COMMANDS.md"]
  - id: settle-commit-survives-gitignored-asks
    title: Make `arcadia agent-ask settle --apply` land its managed-document commit even when the Project gitignores `.arcadia/asks/`.
    status: open
    responsibility: agent
    effort: session
    next_action: Make `arcadia agent-ask settle --apply` land its managed-document commit even when the Project gitignores `.arcadia/asks/`.
    expected_artifact: Evidence satisfying Agent Ask settle-commit-survives-gitignored-asks
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - The archived Ask path is never added to the managed-document commit when `git check-ignore` reports it ignored, and the managed documents still commit regardless of the archived file's ignore status.
      - When the Project tracks `.arcadia/asks/`, the archived Ask is still staged and committed alongside the managed documents.
      - A deterministic test settles an Ask in a repository whose `.gitignore` excludes `.arcadia/asks/` and asserts the managed documents are committed with a clean working tree.
      - A second test covers the tracked case and asserts the archived file is committed.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/512", "src/ask/settlement.ts"]
  - id: serialize-decision-deferral-pointer-write
    title: Put `applyDecisionDeferral`'s pointer read-modify-write inside the same workspace write interlock and compare-and-set discipline the settlement and `transitionActionPointer` already use.
    status: open
    responsibility: agent
    effort: session
    next_action: Put `applyDecisionDeferral`'s pointer read-modify-write inside the same workspace write interlock and compare-and-set discipline the settlement and `transitionActionPointer` already use.
    expected_artifact: Evidence satisfying Agent Ask serialize-decision-deferral-pointer-write
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - "`applyDecisionDeferral` reads PROJECT.md and the active Plan, applies its transforms, and writes the pair inside the same `writeTransaction` (BEGIN IMMEDIATE) the settlement path uses, re-reading the base under the lock."
      - A compare-and-set failure, where the base changed since the Plan was resolved, refuses or retries against fresh state instead of overwriting the concurrent pointer move; the two documents never end up pointing at different `current_action` values.
      - A regression test races a deferral apply against a concurrent settlement or pointer move and asserts one final `current_action` in both documents and no silently lost move.
      - Existing deferral, reversal and `--dry-run` behavior is unchanged; `pnpm test` and the core, Discord and Dashboard builds pass.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/505", "src/dispatch/decisionDeferral.ts", "src/ask/settlement.ts"]
  - id: guard-go-fallback-against-claimed-actions
    title: Make `arcadia go`'s fallback dispatch run the same live-worktree and Action-claim predicate as the primary path before handing any Action to a session.
    status: done
    responsibility: agent
    effort: session
    next_action: Make `arcadia go`'s fallback dispatch run the same live-worktree and Action-claim predicate as the primary path before handing any Action to a session.
    expected_artifact: Evidence satisfying Agent Ask guard-go-fallback-against-claimed-actions
    clarification: clarified
    confidence: high
    source: Agent Ask triage-highest-priority-bugs-2026-09-23-v2
    acceptance_criteria:
      - Every fallback candidate `arcadia go` considers is checked for an existing live worktree/Action claim in a loop before dispatch, not only the pointer Action.
      - A fallback candidate already claimed by another live worktree is skipped and the walk continues to the next dependency-ready unclaimed Action; when none remains, `go` refuses with a named reason and a remedy.
      - The final `resolveProjectTransition` dispatch is bound to the same reserved fallback Action as `dispatch` and `queueFallback`; a regression assertion proves `transition.dispatch.context.action.id` equals `dispatch.context.action.id` and `queueFallback.actionId`.
      - A deterministic test runs two concurrent `go` invocations against the same pointer and asserts they either land on two different ready Actions or one refuses, never two sessions on one Action.
      - A regression test reproduces the observed two-PR case (two prepared worktrees for one Action) and proves the second dispatch is refused.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/526", "src/commands/go.ts", "src/git/worktrees.ts"]
  - id: refresh-pointer-action-against-current-base
    title: Re-resolve the pointer Action against the current base branch before `arcadia go` prepares or resumes its worktree, refusing when that version is already done.
    status: done
    responsibility: agent
    effort: session
    next_action: Re-resolve the pointer Action against the current base branch before `arcadia go` prepares or resumes its worktree, refusing when that version is already done.
    expected_artifact: Evidence satisfying Agent Ask refresh-pointer-action-against-current-base
    clarification: clarified
    confidence: high
    source: Agent Ask triage-highest-priority-bugs-2026-09-23-v2
    acceptance_criteria:
      - "`arcadia go` re-resolves the pointer Action from the current base branch before preparing or resuming its worktree, not only from the possibly-stale `projectRoot` checkout."
      - When the current-base version of the pointer Action is `done`, or is no longer the `current_action`, `go` refuses or walks to the next eligible Action instead of preparing a duplicate candidate for already-completed work.
      - A regression test starts from an older checkout whose pointer Action is already done on the base branch and asserts no new worktree or claim is created for it.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/511", "src/commands/go.ts", "src/docs/dispatch.ts"]
  - id: bind-preservation-checks-to-host-owned-code
    title: Stop a candidate from neutering its own protected-preservation check by binding the declared check's definition or content digest to the authorized packet.
    status: done
    responsibility: agent
    effort: session
    next_action: Stop a candidate from neutering its own protected-preservation check by binding the declared check's definition or content digest to the authorized packet.
    expected_artifact: Evidence satisfying Agent Ask bind-preservation-checks-to-host-owned-code
    clarification: clarified
    confidence: high
    source: Agent Ask triage-highest-priority-bugs-2026-09-23-v2
    acceptance_criteria:
      - "A candidate can no longer pass protected preservation by rewriting the code its declared check executes: the check definition or its content digest is bound to the authorized packet, and a candidate that changes it is refused with a named reason."
      - The chosen enforcing mechanism is a host-owned checker or a content digest bound to the authorized packet, recorded with its security boundary; documentation-only treatment is explicitly out of scope because it cannot refuse a rewritten check.
      - Deterministic tests cover a candidate that neuters its check (refused, candidate files preserved) and an unchanged candidate (preserved), per contract 20's negative-case requirement.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/326", "src/sessions/preservationValidation.ts", "docs/reports/protected-preservation-qa.md"]
  - id: give-zero-prompt-fixture-actions-a-build-packet
    title: Give the Zero Prompt Rehearsal fixture Project's Actions a real build packet so the guarded session-launch path resolves them instead of reporting `planning_required`.
    status: done
    responsibility: agent
    effort: session
    next_action: Give the Zero Prompt Rehearsal fixture Project's Actions a real build packet so the guarded session-launch path resolves them instead of reporting `planning_required`.
    expected_artifact: Evidence satisfying Agent Ask give-zero-prompt-fixture-actions-a-build-packet
    clarification: clarified
    confidence: high
    source: Agent Ask triage-highest-priority-bugs-2026-09-23-v2
    acceptance_criteria:
      - The Zero Prompt Rehearsal fixture Project's Actions carry a real build packet, so `arcadia session preview-launch` resolves them instead of reporting `planning_required`.
      - The guarded session-launch path can launch the fixture's Action B with no manual packet step, while the existing manual runbook path remains available and unchanged.
      - A deterministic test resolves the fixture's Action through the guarded launch path and asserts a launchable packet rather than `planning_required`.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/460", "docs/reports/prove-zero-prompt-production-loop-runbook.md", "docs/managed-production-readiness.md"]
  - id: treat-blocked-status-as-undispatchable
    title: "Make `resolveDispatch`/`isDispatchable` treat a `status: blocked` Action as not dispatchable, consistent with `resolveReadySet` and `buildProjectSchedule`."
    status: open
    responsibility: agent
    effort: session
    next_action: "Make `resolveDispatch`/`isDispatchable` treat a `status: blocked` Action as not dispatchable, consistent with `resolveReadySet` and `buildProjectSchedule`."
    expected_artifact: Evidence satisfying Agent Ask treat-blocked-status-as-undispatchable
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - "`resolveDispatch`/`isDispatchable` treats an Action with `status: blocked` as not dispatchable and pushes a named blocker, consistent with `resolveReadySet` and `buildProjectSchedule`."
      - "`arcadia next` no longer prints the coding-agent authorization for a blocked Action and `arcadia go` cannot prepare a worktree for it."
      - "`docs/managed-documents.md` states how `status: blocked` relates to `responsibility: blocked` and to dispatch readiness."
      - "A regression test reproduces the fixture (`status: blocked`, `responsibility: agent`) and asserts not dispatchable, while an unblocked Action stays dispatchable."
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/494", "src/docs/dispatch.ts", "src/scheduling/schedule.ts"]
  - id: honor-policy-providers-at-launch
    title: Packet preparation and launch preview honor the active standing policy permitted providers, and a mismatch is a named, surfaced prerequisite rather than a silent per-tick admission refusal.
    status: done
    responsibility: agent
    effort: session
    next_action: Packet preparation and launch preview honor the active standing policy permitted providers, and a mismatch is a named, surfaced prerequisite rather than a silent per-tick admission refusal.
    expected_artifact: Evidence satisfying Agent Ask honor-policy-providers-at-launch
    clarification: clarified
    confidence: high
    source: Agent Ask honor-policy-providers-559-2026-09-23
    acceptance_criteria:
      - While a standing production policy is active, every build-packet preparation path (work plan, ask, planning promotion) selects only among the policy scope.providers when a compliant permitted provider exists, and records why when none does.
      - buildLaunchPreview reports a named prerequisite when the selected or packet-bound provider is not in the active policy scope.providers, naming the provider, the permitted list, and the remedy (re-grant or re-prepare the packet).
      - The managed-production tick logs a launch refusal with its named prerequisites instead of the generic not-ready message, and does not repeat an identical refusal line on every tick.
      - Regression tests cover a packet bound to a forbidden provider, a permitted-provider packet preparation under an active policy, and the deduplicated refusal log.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/559"]
  - id: defect-bounded-triage-loop
    title: "Add the automatic bounded defect triage loop approved by Decision 0049: the persistent worker periodically admits defect triage under one explicit token and attempt budget, performs deterministic reproduction and deduplication before any model call, reuses fresh included-capacity receipts, and leaves a durable disposition and evidence for each signal."
    status: open
    responsibility: agent
    effort: session
    next_action: "Add the automatic bounded defect triage loop approved by Decision 0049: the persistent worker periodically admits defect triage under one explicit token and attempt budget, performs deterministic reproduction and deduplication before any model call, reuses fresh included-capacity receipts, and leaves a durable disposition and evidence for each signal."
    expected_artifact: Evidence satisfying Agent Ask defect-bounded-triage-loop
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - The existing persistent worker periodically admits defect triage under one explicit token and attempt budget, performs deterministic reproduction and deduplication before any model call, and reuses fresh included-capacity receipts when available; unknown capacity, purchased credits, and reset redemption never count as free.
      - "Each triage run leaves a durable disposition and evidence: close noise, enrich or link a duplicate, preserve a waiting item with a concrete trigger, promote a formal governed Action into the explicit queue, or perform a validated low-risk reversible repair within standing authority."
      - A stop-the-line defect bypasses periodic cadence when it blocks unrelated work, requires a remembered human workaround, or blocks its own reporting or repair; promotion changes the queue and current pointer rather than merely adding an urgent label.
      - Merge, deployment, publication, spending, credentials, messaging, production access, destructive changes, operator judgment, and any authority not already granted remain gated; automation reports the exact gate instead of treating urgency as permission.
      - Deterministic tests cover periodic budget exhaustion, worker restart, stale or unknown capacity, Action promotion, safe repair, a refused consequential repair, and immediate stop-the-line escalation.
      - The operator-facing QA plan includes the worker/recovery command, Back Burner and queue inspection steps, observable expected results, and whether the procedure is also the end-user procedure.
    depends_on: [build-autonomous-defect-loop, prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["docs/decisions/0049-add-a-one-line-defect-intake-whose-periodically-token-budgeted-back-burner-proce.md", "docs/plans/provider-capacity-harvesting.md", "src/commands/worker.ts", "src/codingAgents/capacity.ts", "src/defect/signal.ts", "src/db/repositories.ts"]
  - id: preflight-provider-signin-before-launch
    title: Launch verifies provider sign-in from the worker context before reserving admission or the repository lease, and refuses with a named remedy when it is missing.
    status: done
    responsibility: agent
    effort: session
    next_action: Launch verifies provider sign-in from the worker context before reserving admission or the repository lease, and refuses with a named remedy when it is missing.
    expected_artifact: Evidence satisfying Agent Ask preflight-provider-signin-before-launch
    clarification: clarified
    confidence: high
    source: Agent Ask preflight-provider-signin-568-2026-09-23
    acceptance_criteria:
      - Before issueAdmission and before any worktree or lease is created, launchGuardedHostSession checks sign-in for the selected provider from the worker process context (claude-code-cli via claude auth status, or an equivalent documented check per provider) and refuses when it is not signed in.
      - The refusal names the provider, says it is not signed in for the worker, gives the operator remedy, and appears in arcadia production status as the Project launch blocker rather than only in the worker log.
      - A signed-out provider takes no repository lease and no concurrency slot, and the next tick retries without counting against the repair budget.
      - Regression tests cover a signed-in launch, a signed-out refusal with no lease taken, and the surfaced status reason.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/568"]
  - id: pass-managed-claude-token-into-sessions
    title: The worker reads the operator token from the workspace config file at launch and passes it only into the claude-code-cli Session environment as CLAUDE_CODE_OAUTH_TOKEN.
    status: done
    responsibility: agent
    effort: session
    next_action: The worker reads the operator token from the workspace config file at launch and passes it only into the claude-code-cli Session environment as CLAUDE_CODE_OAUTH_TOKEN.
    expected_artifact: Evidence satisfying Agent Ask pass-managed-claude-token-into-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask pass-managed-claude-token-0065-2026-09-23
    acceptance_criteria:
      - At claude-code-cli Session launch the worker reads the token from one documented file under the workspace config directory and passes it only into that Session process environment as CLAUDE_CODE_OAUTH_TOKEN; no other child process receives it.
      - The worker refuses to use the file, with a named remedy, when it is readable by group or others, is empty, or is a symlink out of the workspace config directory.
      - The token value never appears in logs, receipts, events, command lines visible to ps, packets, or error messages.
      - The sign-in preflight from preflight-provider-signin-before-launch treats a valid token file as signed in for claude-code-cli.
      - START_HERE documents the one-time operator setup (claude setup-token, then writing the file with 0600 permissions) and rotation, and a /runs operator button performs the write-and-verify step without the agent ever handling the value.
      - Regression tests cover token pass-through, each refused file state, and absence of the value from logs and the tmux command line.
    depends_on: [preflight-provider-signin-before-launch]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/568"]
  - id: escalate-nonrecoverable-launch-refusals
    title: Distinguish a non-self-resolving launch refusal (starting with planning_required) from a transient wait-state conflict, and surface it to the operator instead of retrying silently forever.
    status: done
    responsibility: agent
    effort: session
    next_action: Distinguish a non-self-resolving launch refusal (starting with planning_required) from a transient wait-state conflict, and surface it to the operator instead of retrying silently forever.
    expected_artifact: Evidence satisfying Agent Ask escalate-nonrecoverable-launch-refusals
    clarification: clarified
    confidence: high
    source: Agent Ask escalate-nonrecoverable-launch-refusals-2026-09-23
    acceptance_criteria:
      - production/tick.ts's conflict-refusal handling classifies planning_required, and any other refusal whose remedy requires an operator or agent action rather than the passage of time, separately from capacity/Off/stale-preview/lease conflicts.
      - A non-self-resolving refusal is surfaced once per a bounded window (not on every tick) through a durable, operator-visible signal -- the existing /runs terminal-approvals surface or an equivalent named mechanism -- rather than appearing only as routine worker.out.log noise.
      - "A deterministic test reproduces both cases: a transient conflict (e.g. capacity) keeps retrying silently exactly as today; a planning_required refusal is surfaced once and does not repeat the same signal on every subsequent tick while it remains unresolved."
      - pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: ["src/production/tick.ts", "src/sessions/launch.ts", "https://github.com/pmark/arcadia/issues/576"]
  - id: auto-resolve-planning-required
    title: When the dispatch pointer's current Action has no build packet (packetLifecycle.kind === "planning_required"), Arcadia automatically prepares one using the existing consistent packet-template machinery in src/codex/packets.ts (renderPrompt), or automatically requests the Decision-gated real planning run when the Action genuinely needs one -- rather than leaving the Action silently or visibly stuck until a human or agent notices.
    status: done
    responsibility: agent
    effort: session
    next_action: When the dispatch pointer's current Action has no build packet (packetLifecycle.kind === "planning_required"), Arcadia automatically prepares one using the existing consistent packet-template machinery in src/codex/packets.ts (renderPrompt), or automatically requests the Decision-gated real planning run when the Action genuinely needs one -- rather than leaving the Action silently or visibly stuck until a human or agent notices.
    expected_artifact: Evidence satisfying Agent Ask auto-resolve-planning-required
    clarification: clarified
    confidence: high
    source: Agent Ask auto-resolve-planning-required-2026-09-23
    acceptance_criteria:
      - "Reproduces the observed failure: an Action reaching the front of the dispatch pointer with no packet does not require a human or a separately-dispatched agent session to run `arcadia work plan` by hand before it can launch."
      - When completing the Action needs no Decision-gated planning run, its packet is prepared deterministically through the existing packets.ts template system -- no new or inconsistent prompt scheme is introduced.
      - When the Action genuinely needs a real, Decision-gated planning run (CodexPlanningRunApproval), that run is requested automatically, and the existing approval gate is preserved -- this Action never bypasses it.
      - "A currently-open production_operator_escalations row for this exact Action (see src/production/tick.ts, PR #579) clears once the packet is prepared or the planning run is requested, through the tick's normal resolution path -- not a special case."
      - "A deterministic test reproduces both branches: the no-Decision-needed case resolves automatically within a bounded number of ticks; the Decision-gated case requests the planning run and stops there, never bypassing approval."
      - pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: ["src/codex/packets.ts", "src/sessions/packetLifecycle.ts", "src/production/tick.ts", "docs/planning-process.md", "https://github.com/pmark/arcadia/issues/584"]
  - id: page-runs-this-push-list
    title: Replace the Runs page This push section with an infinitely scrolling list of past and future Actions, fetched in pages instead of all at once.
    status: open
    responsibility: agent
    effort: session
    next_action: Replace the Runs page This push section with an infinitely scrolling list of past and future Actions, fetched in pages instead of all at once.
    expected_artifact: Evidence satisfying Agent Ask page-runs-this-push-list
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - The This push section renders its first page without waiting for the full queue and history to load.
      - Scrolling to the end of the list fetches and appends the next page of past or future Actions, with no duplicates or gaps.
      - The list API accepts a page cursor and limit and is covered by tests for first, middle, and last pages.
      - The section still shows its loading, empty, and error states.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: []
  - id: tab-runs-page-concerns
    title: Split the Runs page into tabs so each concern (This push, Active now, Recent history, Operator actions) is viewed on its own.
    status: open
    responsibility: agent
    effort: session
    next_action: Split the Runs page into tabs so each concern (This push, Active now, Recent history, Operator actions) is viewed on its own.
    expected_artifact: Evidence satisfying Agent Ask tab-runs-page-concerns
    clarification: clarified
    confidence: high
    source: Agent Ask runs-page-ux-2026-09-23
    acceptance_criteria:
      - The Runs page shows one tab per concern and only the selected tab content is rendered.
      - The selected tab is reflected in the URL so a reload or shared link opens the same tab.
      - Tabs are keyboard accessible and usable at phone width.
    depends_on: [page-runs-this-push-list]
    decisions: []
    references: []
  - id: go-refuses-stale-session-without-question-or-blocker
    title: arcadia go refuses to end a session with the current Action unchanged unless it records an operator question or external blocker.
    status: done
    responsibility: agent
    effort: session
    next_action: arcadia go refuses to end a session with the current Action unchanged unless it records an operator question or external blocker.
    expected_artifact: Evidence satisfying Agent Ask go-refuses-stale-session-without-question-or-blocker
    clarification: clarified
    confidence: high
    source: Agent Ask split-divide-instead-of-stall-2026-09-24
    acceptance_criteria:
      - arcadia go refuses to end a session with the current Action unchanged unless it records an operator question or external blocker.
    depends_on: []
    decisions: []
    references: []
  - id: renumber-duplicate-decision-files
    title: Renumber the later-arriving file in each duplicate id pair to the next free numeric id, keeping the earlier-created file at its original id, per Decision 0067.
    status: open
    responsibility: agent
    effort: session
    next_action: Renumber the later-arriving file in each duplicate id pair to the next free numeric id, keeping the earlier-created file at its original id, per Decision 0067.
    expected_artifact: Evidence satisfying Agent Ask renumber-duplicate-decision-files
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - docs/decisions/0004-remaining-protocol-increment.md is renamed to the next free numeric id at implementation time, keeping docs/decisions/0004-docs-sync-write-back.md at id 0004.
      - docs/decisions/0005-recheck-readiness-hybrid.md is renamed to the next free numeric id at implementation time, keeping docs/decisions/0005-plan-milestone-span.md at id 0005.
      - Each renamed file's frontmatter id field is updated to match its new filename, and the file records a docs-sync-visible migration note pointing back to its original id so the rename is traceable in history.
      - Every inbound reference to a renamed file's old id or its old id+slug pair (Mission Log entries, other Decisions' decision frontmatter links, other documents' prose or cross-references) is found by repository-wide search and updated to the new id.
      - arcadia docs sync reports zero duplicate-id issues for these two pairs afterward, and pnpm test and the core, Discord, and Dashboard builds pass.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: []
  - id: repoint-r195-to-fresh-decision
    title: Re-point review item R195 (project martianrover, id review_f533ac102d1d47479d), whose doc_ref and source_input dangling-reference a document never committed under id 0053, to a freshly reserved Arcadia Decision restating its original question, per Decision 0067.
    status: open
    responsibility: agent
    effort: session
    next_action: Re-point review item R195 (project martianrover, id review_f533ac102d1d47479d), whose doc_ref and source_input dangling-reference a document never committed under id 0053, to a freshly reserved Arcadia Decision restating its original question, per Decision 0067.
    expected_artifact: Evidence satisfying Agent Ask repoint-r195-to-fresh-decision
    clarification: clarified
    confidence: high
    source: Agent Ask renumber-duplicate-decision-ids-and-repoint-r195-2026-09-25
    acceptance_criteria:
      - A new Decision document is created in docs/decisions/ at the next free numeric id, restating R195's original question (recovered from R195's decision_needed and source_input in the martianrover project's workspace database) as its own question.
      - R195's doc_ref and source_input in the martianrover project's workspace database are updated to reference the new Decision's ref instead of the dead 0053 path, using whatever mechanism the implementing session determines is the correct, audited way to update a review item across a project boundary -- if no such mechanism exists yet, that gap is reported back as a concrete blocker rather than hand-edited directly in the database.
      - arcadia docs sync run against the martianrover project no longer reports R195's doc_ref as dangling.
    depends_on: [renumber-duplicate-decision-files]
    decisions: []
    references: []
  - id: release-committed-admissions-on-session-end
    title: Release a committed production admission when its Session reaches a terminal outcome, so finished Sessions stop counting against maxConcurrentSessions.
    status: done
    responsibility: agent
    effort: session
    next_action: Release a committed production admission when its Session reaches a terminal outcome, so finished Sessions stop counting against maxConcurrentSessions.
    expected_artifact: Evidence satisfying Agent Ask release-committed-admissions-on-session-end
    clarification: clarified
    confidence: high
    source: Agent Ask file-live-production-blockers-2026-09-24
    acceptance_criteria:
      - When a Session backed by a committed production admission is reconciled to any terminal outcome (accepted completion, incomplete-resumable exit, failure, or operator stop), its admission is released through the existing releaseAdmission writer in the same transaction as the reconciliation.
      - countLiveAdmissions no longer counts a committed admission whose Session is terminal; already-leaked committed admissions on an existing workspace stop counting without a manual database edit.
      - "A deterministic test reproduces Issue #610: with maxConcurrentSessions 1, one Session launches, completes, and a second Action is then admitted on the next tick instead of being refused concurrency_limit."
      - "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #610."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/610", "src/production/policy.ts", "src/sessions/reconciliation.ts"]
  - id: name-failing-preservation-check-and-bound-retries
    title: Make a preservation refusal name the check that failed, and stop a Session from retrying an identical refusal forever.
    status: done
    responsibility: agent
    effort: session
    next_action: Make a preservation refusal name the check that failed, and stop a Session from retrying an identical refusal forever.
    expected_artifact: Evidence satisfying Agent Ask name-failing-preservation-check-and-bound-retries
    clarification: clarified
    confidence: high
    source: Agent Ask restore-blocker-references-2026-09-24
    acceptance_criteria:
      - The 'Declared preservation validation failed or was skipped.' refusal returned by the preserve broker carries non-empty details naming each failing or skipped check, its command, and its exit status or skip reason.
      - The preserve broker or Session controller, not only the Session brief, enforces a bounded number of identical preservation refusals per Session; when the limit is reached it records the refusal and the Session is reconciled as an incomplete exit.
      - Deterministic tests cover a failing check (details name it), a skipped check (details name the skip reason), and a Session that reaches the identical-refusal limit and is recorded incomplete.
      - "pnpm test and the core, Discord and Dashboard builds pass, and the PR refs Issue #611."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/611", "src/sessions/preservationValidation.ts"]
  - id: withhold-worker-lifecycle-from-sessions
    title: Stop a dispatched coding-agent Session from stopping, starting, or restarting the shared host worker.
    status: done
    responsibility: agent
    effort: session
    next_action: Stop a dispatched coding-agent Session from stopping, starting, or restarting the shared host worker.
    expected_artifact: Evidence satisfying Agent Ask withhold-worker-lifecycle-from-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask restore-blocker-references-2026-09-24
    acceptance_criteria:
      - arcadia worker stop, start, restart and install refuse, with a named reason, when the caller descends from a managed coding-agent Session, determined by a non-forgeable host-side check (such as the Session's recorded process tree or tmux server) rather than caller environment variables or working directory.
      - The operator's own terminal and the launchd agent can still run every worker command unchanged.
      - A deterministic test proves the refusal from a Session process even after it clears its environment and changes directory to the host workspace, and proves the unchanged operator and launchd paths.
      - "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #611 together with name-failing-preservation-check-and-bound-retries or refs it if that Action has not merged."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/611", "src/commands/worker.ts"]
  - id: preserve-candidates-across-base-advance
    title: Let a candidate be preserved after the base branch advanced during its Session, and bind preservation to the Session's own dispatched Action rather than the current pointer.
    status: done
    responsibility: agent
    effort: session
    next_action: Let a candidate be preserved after the base branch advanced during its Session, and bind preservation to the Session's own dispatched Action rather than the current pointer.
    expected_artifact: Evidence satisfying Agent Ask preserve-candidates-across-base-advance
    clarification: clarified
    confidence: high
    source: Agent Ask file-live-production-blockers-2026-09-24
    acceptance_criteria:
      - Manual and protected preservation accept a candidate whose base branch advanced after preparation when the candidate still merges cleanly onto the new base, and refuse with a message naming the old base, the new base and the recovery when it does not.
      - Preservation compares the candidate's Action definition against the Session's own dispatched Action, not resolveDispatch's pointer Action, so a non-pointer Session can be preserved.
      - Deterministic tests cover a base that advanced cleanly (preserved), a conflicting advance (named refusal), and a non-pointer Action (preserved).
      - "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #539."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/539", "src/sessions/manualPreservation.ts"]
  - id: refuse-packets-without-validation-commands
    title: Refuse to prepare a build packet or launch a managed Session for a Project that declares no validation commands, since such a Session can never be preserved or auto-completed.
    status: done
    responsibility: agent
    effort: session
    next_action: Refuse to prepare a build packet or launch a managed Session for a Project that declares no validation commands, since such a Session can never be preserved or auto-completed.
    expected_artifact: Evidence satisfying Agent Ask refuse-packets-without-validation-commands
    clarification: clarified
    confidence: high
    source: Agent Ask file-live-production-blockers-2026-09-24
    acceptance_criteria:
      - Build-packet preparation refuses, naming the remedy arcadia project metadata <project> --validation-command <command>, when the Project's validation_commands list is empty.
      - buildLaunchPreview reports the same condition as a named prerequisite, and the managed-production tick escalates it once through production_operator_escalations instead of launching.
      - A deterministic test covers the empty-list refusal and an unchanged launch for a Project with declared commands.
      - "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #572."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/572", "src/sessions/reconciliation.ts"]
  - id: stop-killing-busy-workers
    title: Recover only a genuinely hung worker, never one that is merely busy inside a long synchronous step.
    status: done
    responsibility: agent
    effort: session
    next_action: Recover only a genuinely hung worker, never one that is merely busy inside a long synchronous step.
    expected_artifact: Evidence satisfying Agent Ask stop-killing-busy-workers
    clarification: clarified
    confidence: high
    source: Agent Ask cover-busy-worker-stop-2026-09-24
    acceptance_criteria:
      - Hung-worker recovery in arcadia worker start and stop is driven by a liveness signal that no synchronous tick step can starve (for example a beat from a separate thread or process), not by lengthening the heartbeat threshold alone.
      - A deterministic test holds the worker inside a synchronous step for longer than 26s and proves start neither signals nor replaces it, and that stop sends only its ordinary SIGTERM and reports the worker mid-tick without escalating to SIGKILL; a worker that stops progressing entirely is still recovered by both.
      - "The 170s and 292s stalls recorded in Issue #617 are investigated and their cause recorded in the PR, or recorded as not reproducible with the evidence gathered."
      - "pnpm test and the core, Discord and Dashboard builds pass, and the PR closes Issue #617."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/617", "https://github.com/pmark/arcadia/issues/485", "src/commands/worker.ts"]
  - id: generate-operator-scripts-for-runs-approvals
    title: Extend the /runs approval queue to derive bounded operator scripts for scriptable approval steps, expose full descriptor detail, and cover the remaining acceptance criteria with tests.
    status: open
    responsibility: agent
    effort: session
    next_action: Extend the /runs approval queue to derive bounded operator scripts for scriptable approval steps, expose full descriptor detail, and cover the remaining acceptance criteria with tests.
    expected_artifact: Evidence satisfying Agent Ask generate-operator-scripts-for-runs-approvals
    clarification: clarified
    confidence: high
    source: Agent Ask gate-dispatch-to-production-critical-path-2026-09-25
    acceptance_criteria:
      - For every bounded scriptable operator step Arcadia derives, it writes a short-lived script and an arcadia-operator-script-v1 descriptor only beneath artifacts/generated/operator-scripts/; /runs displays the descriptor's problem, desired effect, exact CLI invocation, checksum, prerequisites, authority boundary, success next step, and failure next step.
      - A script failure writes a timestamped, immutable failure handoff and complete run log beneath that script's generated directory; /runs exposes both as the exact input for a coding agent to diagnose the first failed command and propose a narrower follow-up script.
      - The /runs execute control sends only the selected fingerprinted script descriptor to the host-side service controller; it records output and a durable receipt, refuses when that controller is unavailable or the descriptor is stale, and never lets a browser execute an arbitrary command.
      - Regression tests cover prioritization, minimal-versus-expanded rendering, stale-preview refusal, successful operator settlement, generated-script integrity, failure-handoff generation, unavailable-host refusal, and successful host-mediated execution.
    depends_on: [surface-terminal-operator-approvals-in-runs, prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["apps/dashboard/app/api/approvals", "apps/dashboard/components/approval-queue.tsx", "apps/dashboard/app/api/operator-script", "artifacts/generated/operator-scripts"]
  - id: gate-dispatch-on-blocking-operator-items
    title: arcadia go/advance/next stops for a pending operator item that blocks the eligible Action(s) it would otherwise dispatch, and otherwise appends a brief, non-blocking alert listing everything else pending.
    status: done
    responsibility: agent
    effort: session
    next_action: arcadia go/advance/next stops for a pending operator item that blocks the eligible Action(s) it would otherwise dispatch, and otherwise appends a brief, non-blocking alert listing everything else pending.
    expected_artifact: Evidence satisfying Agent Ask gate-dispatch-on-blocking-operator-items
    clarification: clarified
    confidence: high
    source: Agent Ask add-blocking-vs-alert-operator-gate-2026-09-24
    acceptance_criteria:
      - One shared function classifies every pending operator-only item (unsettled Agent Ask proposals, open Decisions) as blocking or alert, reusing the exact data surface-terminal-operator-approvals-in-runs already built rather than re-deriving it.
      - "An item is blocking when it names, or its Decision's action: field names, an Action the current dispatch resolution would otherwise select, or when it is the reason no Action in the current queue segment is eligible; every other pending item is an alert."
      - When one or more blocking items exist, arcadia go/advance/next refuses to hand off a dispatch brief for agent work and instead prints each blocking item's title, recommended option and consequence, and the exact command to settle it — matching the existing per-Action blocker/operatorQuestion contract, not a second one.
      - When only alert items exist, dispatch proceeds normally and the resolution additionally lists each alert's title and one-line consequence, newest first, capped at a small fixed count with a count of any remainder.
      - This one gate is shared by the CLI (go, advance, next), the dashboard's equivalent status calls, and the Discord bot's dispatch-brief posting — none of them re-implements its own copy.
      - "Regression tests cover: a blocking item suppresses dispatch and is named exactly; an alert-only state dispatches normally with the alert list attached; zero pending items adds neither section; an item blocking one Project does not suppress dispatch for an unrelated Project."
    depends_on: []
    decisions: []
    references: ["apps/dashboard/app/api/approvals/route.ts", "src/commands/agentAsk.ts", "src/commands/decision.ts", "src/docs/dispatch.ts", "src/commands/go.ts", "src/commands/advance.ts", "apps/discord-bot"]
  - id: support-per-project-north-star
    title: Read a NORTH_STAR.md from each Project repository root as that Project's target, alongside the workspace NORTH_STAR as the portfolio-wide target.
    status: open
    responsibility: agent
    effort: session
    next_action: Read a NORTH_STAR.md from each Project repository root as that Project's target, alongside the workspace NORTH_STAR as the portfolio-wide target.
    expected_artifact: Evidence satisfying Agent Ask support-per-project-north-star
    clarification: clarified
    confidence: high
    source: Agent Ask file-per-project-north-star-2026-09-25
    acceptance_criteria:
      - The north-star loader reads an optional NORTH_STAR.md at each Project repository root with the same schema as the workspace file, taking project from its own Project when the field is omitted, and never replaces or reinterprets the workspace NORTH_STAR.md, which remains the portfolio-wide target.
      - arcadia now and the dashboard /now and /path screens can show one Project's target and gates (a --project flag or equivalent selector), while the default view stays the portfolio-wide target.
      - A Project NORTH_STAR.md that fails to parse is reported as a named validation issue for that Project only, and does not break the portfolio view or other Projects.
      - Deterministic tests cover a Project file, a missing Project file, a malformed Project file, and an unchanged workspace-only setup; pnpm test and the core, Discord and Dashboard builds pass.
      - START_HERE.md documents where each NORTH_STAR lives and which view reads it.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["src/northStar/document.ts", "src/northStar/compute.ts", "src/northStar/path.ts", "apps/dashboard/app/now/page.tsx", "apps/dashboard/app/path/page.tsx", "NORTH_STAR.md"]
  - id: notify-operator-on-agent-blockers
    title: Let any agent session record an operator notification that the default channel relays with its full text.
    status: open
    responsibility: agent
    effort: session
    next_action: Let any agent session record an operator notification that the default channel relays with its full text.
    expected_artifact: Evidence satisfying Agent Ask notify-operator-on-agent-blockers
    clarification: clarified
    confidence: high
    source: Agent Ask file-operator-blocker-notification-2026-09-25
    acceptance_criteria:
      - A verb command (for example arcadia operator notify) records a durable operator notification with project, severity, title, body, and an optional PR or Action reference; it is idempotent on a caller-supplied key and makes no model call.
      - The Discord notification poller relays each new notification once, with its title, body and reference, through the existing CLI-snapshot boundary; the dashboard /runs Alerts panel lists open notifications.
      - It works from any Project repository and any coding-agent provider, including a managed-production Session; where no workspace resolves, the command fails with a named remedy rather than silently succeeding.
      - docs/agents-context.md's 'CI failures are fixed immediately' step 4 is updated to use the command instead of the log-Ask interim, and AGENTS.md is regenerated.
      - Deterministic tests cover recording, idempotent replay, Discord relay of the full text exactly once, and the no-workspace refusal; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["docs/agents-context.md", "apps/discord-bot/src/notifications/poller.ts", "src/ask/settlement.ts"]
  - id: settle-squash-merged-completion-drafts
    title: Let the automatic completion settlement accept a drafted complete Ask whose candidate was squash-merged into main.
    status: open
    responsibility: agent
    effort: session
    next_action: Let the automatic completion settlement accept a drafted complete Ask whose candidate was squash-merged into main.
    expected_artifact: Evidence satisfying Agent Ask settle-squash-merged-completion-drafts
    clarification: clarified
    confidence: high
    source: Agent Ask file-settle-completions-after-merge-2026-09-25
    acceptance_criteria:
      - attemptAutoSettlePendingCompletion accepts a drafted complete Ask whose candidate_revision is not an ancestor of HEAD when merging that revision into HEAD changes no file (the git merge-tree --write-tree result equals HEAD's tree), and still refuses, with a named reason, a candidate whose changes are not fully contained in HEAD.
      - Deterministic tests cover a squash-merged candidate that settles, a merge-committed candidate that settles, and a candidate with unmerged changes that is refused; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["src/ask/autoSettleBeforeDispatch.ts", "docs/decisions/0070-decide-whether-an-action-s-completion-settles-after-its-pr-merges-applied.md"]
  - id: sweep-merged-completions-before-dispatch
    title: Settle every merged pending completion on main, in merge order, before dispatch, and stop settling completions inside candidate branches.
    status: open
    responsibility: agent
    effort: session
    next_action: Settle every merged pending completion on main, in merge order, before dispatch, and stop settling completions inside candidate branches.
    expected_artifact: Evidence satisfying Agent Ask sweep-merged-completions-before-dispatch
    clarification: clarified
    confidence: high
    source: Agent Ask file-settle-completions-after-merge-2026-09-25
    acceptance_criteria:
      - Before selecting work, the worker tick and arcadia go settle every drafted complete Ask whose candidate is merged into main, one at a time in merge order, so current_action reflects every merged completion; an Ask whose candidate is not yet merged is left pending and untouched.
      - The settlement commit is pushed or left LOCAL ONLY exactly as Decision 0070's answer grants, and a LOCAL ONLY result is reported in arcadia work monitor.
      - docs/agents-context.md (regenerated into AGENTS.md) tells a session to commit its drafted complete Ask in its PR instead of running settle --apply in the candidate, and START_HERE.md describes the post-merge settlement.
      - Deterministic tests cover two merged completions settling in merge order with the pointer on the correct next Action, and an unmerged candidate's Ask left pending; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [settle-squash-merged-completion-drafts, prove-two-action-unattended-production, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["src/ask/autoSettleBeforeDispatch.ts", "src/production/tick.ts", "src/commands/advance.ts", "src/commands/go.ts", "docs/agents-context.md", "START_HERE.md"]
  - id: fix-decision-approve-missing-commit
    title: "arcadia decision approve commits its plain-answer Decision file write locally (write + git add + local commit, no push), matching the deferral path in src/dispatch/decisionDeferral.ts and the agent-ask settle --apply contract, instead of leaving it uncommitted per src/commands/decision.ts:337-340."
    status: done
    responsibility: agent
    effort: session
    next_action: "arcadia decision approve commits its plain-answer Decision file write locally (write + git add + local commit, no push), matching the deferral path in src/dispatch/decisionDeferral.ts and the agent-ask settle --apply contract, instead of leaving it uncommitted per src/commands/decision.ts:337-340."
    expected_artifact: Evidence satisfying Agent Ask fix-decision-approve-missing-commit
    clarification: clarified
    confidence: high
    source: Agent Ask fix-decision-approve-missing-commit-2026-09-25
    acceptance_criteria:
      - Answering a Decision with a plain (non-defer) effect via arcadia decision approve leaves the repository clean (no uncommitted changes) immediately after the command returns, with the Decision file change committed locally and not pushed.
      - A test covers a plain-answer decision approve and asserts the working tree is clean after the command runs.
      - "The pull request that lands this fix includes Closes #645 in its body."
    depends_on: []
    decisions: []
    references: []
  - id: resolve-cross-plan-dependency-ids
    title: "Unknown depends_on ids block the Action instead of counting as satisfied, resolving cross-Plan references by plan/<slug>#<action> before falling back to a dependency_unresolved wait reason."
    status: done
    responsibility: agent
    effort: session
    next_action: "Unknown depends_on ids block the Action instead of counting as satisfied, resolving same-Project cross-Plan references by plan/<slug>#<action-id> before falling back to a dependency_unresolved wait reason."
    expected_artifact: Evidence satisfying Agent Ask resolve-cross-plan-dependency-ids
    clarification: clarified
    confidence: high
    source: Agent Ask narrow-resolve-cross-plan-dependency-ids-2026-09-26-r2
    acceptance_criteria:
      - "canonicalOrder (src/scheduling/order.ts) resolves a depends_on id first within the same Plan, then across the same Project's Plans as plan/<slug>#<action-id>; an id that resolves to a done Action on the base branch is satisfied."
      - A depends_on id that does not resolve to any known Action within the same Project produces a dependency_unresolved wait reason instead of being treated as satisfied, and the Action does not enter the ready set.
      - "Deterministic tests cover: a same-Plan dependency, a cross-Plan dependency, a dependency that lands after being unresolved on an earlier tick, and an id that never resolves; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: []
  - id: admit-ready-set-across-repositories
    title: "Replace current_action as a settlement-advanced pointer with ready-set admission: the production tick admits Actions from the portfolio's ready set in canonicalOrder across repositories, and completion settlement stops selecting the next Action."
    status: open
    responsibility: agent
    effort: session
    next_action: "Replace current_action as a settlement-advanced pointer with ready-set admission, after the sequential proof has validated the pointer it retires: the production tick admits Actions from the portfolio ready set in canonicalOrder across repositories, and Decision 0070 host settler becomes the pointer's only writer."
    expected_artifact: Evidence satisfying Agent Ask admit-ready-set-across-repositories
    clarification: clarified
    confidence: high
    source: Agent Ask amend-ready-set-admission-actions-after-review-2026-09-25
    acceptance_criteria:
      - The production tick (src/production/tick.ts) computes the ready set from every in-scope Plan of every active Project -- status not done/deferred/needs_operator, every depends_on landed on the base branch, no live claim -- and launches in canonicalOrder up to host and per-repository lane limits, per docs/proposals/portfolio-parallel-execution.md section 3.
      - settleAgentAsk (src/ask/settlement.ts) stops calling selectNextAfterCompletion and stops writing current_action; a completion records its evidence and releases its claim only.
      - current_action becomes a derived projection -- the highest-priority claimed Action, or the highest-priority ready Action if nothing is claimed -- with exactly one writer, the host settler built by settle-squash-merged-completion-drafts and sweep-merged-completions-before-dispatch; settlement, deferral, advance, the scheduler's alignPointer (src/scheduling/scheduler.ts) and the arcadia go preflight all stop writing it, and a projection computed before the most recent settlement is refused rather than written.
      - A read-only status surface reports one wait reason per in-scope Action that did not launch this tick (dependency, dependency_unresolved, claimed, host_full, needs_operator, ...), recomputed every tick and never stored as truth.
      - A Session flagged stalled is named in the host_full wait reason of every Action it keeps from launching, so a stalled Session holding a host slot is visible instead of silently starving other repositories.
      - "Deterministic tests cover: two ready Actions in different repositories launching in the same tick, an Action correctly excluded by a live claim, current_action reflecting the highest-priority claim with no settlement write, a projection computed before a later settlement being refused, and the #505/#507 race scenarios each closed; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: [resolve-cross-plan-dependency-ids, enforce-concurrency-gate-at-admission, rewire-dependents-on-split, prove-two-action-unattended-production, sweep-merged-completions-before-dispatch, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md", "docs/decisions/0071-decide-whether-to-reopen-decision-0023-and-adopt-ready-set-admission-for.md", "docs/decisions/0070-decide-whether-an-action-s-completion-settles-after-its-pr-merges-applied.md", "docs/decisions/0066-record-when-arcadia-should-widen-beyond-one-coding-agent-session-per-repository.md", "src/production/tick.ts", "src/ask/settlement.ts", "src/scheduling/scheduler.ts", "src/scheduling/order.ts", "src/production/policy.ts", "docs/proposals/portfolio-parallel-execution.md"]
  - id: pipeline-independent-actions-while-pr-unmerged
    title: "Let an independent, non-overlapping Action start in a repository whose previous candidate PR is still unmerged, up to a per-repository review limit, using declared touches: scope to prevent overlap."
    status: open
    responsibility: agent
    effort: session
    next_action: "Let an independent, non-overlapping Action start in a repository whose previous candidate PR is still unmerged, up to a per-repository review limit, using declared touches: scope to prevent overlap."
    expected_artifact: Evidence satisfying Agent Ask pipeline-independent-actions-while-pr-unmerged
    clarification: clarified
    confidence: high
    source: Agent Ask wire-concurrency-proofs-behind-soak-and-review-limit-2026-09-26
    acceptance_criteria:
      - "Plan Actions may declare touches: <paths>; an Action whose touches: is absent, empty, or not a list of paths (including a single scalar string) is treated as touching the whole repository and never pipelines."
      - "Admission may start a new Action in a repository with an unmerged candidate only when the ready Action's declared touches: do not overlap the unmerged candidate's actual changed paths, and the repository's unmerged-candidate count is below the operator's configured review limit; otherwise it records scope_overlap or review_backlog as the wait reason."
      - "Overlap is rechecked against both candidates' actual changed paths whenever either is pushed or preserved; a new candidate whose actual diff leaves its declared touches:, or an overlap that appears after admission, stops pipelining for that repository and is reported as scope_overlap."
      - Pipelining is available only once admit-ready-set-across-repositories, settle-squash-merged-completion-drafts and sweep-merged-completions-before-dispatch are all built, since the host settler must already be the sole current_action writer and merged completions must settle serially on main before a second unmerged candidate in one repository is safe.
      - "Deterministic tests cover: a non-overlapping Action pipelining while the prior PR is unmerged, an overlapping Action refused with scope_overlap, a repository at its review limit refused with review_backlog, an empty or scalar touches: never pipelining, and an overlap introduced by a later push to the prior candidate being caught; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: [admit-ready-set-across-repositories, settle-squash-merged-completion-drafts, sweep-merged-completions-before-dispatch, limit-unmerged-candidates-per-repository]
    decisions: []
    references: ["src/production/tick.ts", "src/ask/settlement.ts", "docs/proposals/portfolio-parallel-execution.md", "docs/decisions/0071-decide-whether-to-reopen-decision-0023-and-adopt-ready-set-admission-for.md", "docs/decisions/0070-decide-whether-an-action-s-completion-settles-after-its-pr-merges-applied.md", "docs/decisions/0066-record-when-arcadia-should-widen-beyond-one-coding-agent-session-per-repository.md", "docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md"]
  - id: prove-concurrent-ready-set-admission
    title: Prove that two independent Actions in two different repositories launch and complete correctly from the same production tick under ready-set admission, with no settlement or pointer-projection race, before real concurrent admission is ever allowed.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove that two independent Actions in two different repositories launch and complete correctly from the same production tick under ready-set admission, with no settlement or pointer-projection race, before real concurrent admission is ever allowed.
    expected_artifact: Evidence satisfying Agent Ask prove-concurrent-ready-set-admission
    clarification: clarified
    confidence: high
    source: Agent Ask wire-concurrency-proofs-behind-soak-and-review-limit-2026-09-26
    acceptance_criteria:
      - Provide or reuse two disposable or explicitly approved real Projects/repositories, each with at least one ready Action that does not depend on the other, and a reachable existing production control (CLI or dashboard), before requesting live execution.
      - Under bounded rehearsal authority, with a policy scope activated at maxConcurrentSessions 2 or more through the expiring rehearsal exception defined by enforce-concurrency-gate-at-admission (the only path that lifts the concurrency cap before both proofs are done), one production tick admits and launches Sessions for both independent Actions in their separate repositories with no per-launch operator confirmation in between.
      - "Both Sessions run to completion holding disjoint resources throughout: each Action's claim, worktree, and repository lease belong only to that Session, and neither Session's admission, launch, or settlement observably blocks or interferes with the other."
      - "Both completions settle correctly in either order: each repository's current_action projection reflects that repository's correct highest-priority ready or claimed Action after each settlement, and the workspace-database state the two Sessions share (production admissions, the host-slot count, Action claims) shows no lost, duplicated or misattributed row; record which order happened live and cover the other order with a deterministic test against the new projection writer, not the removed selectNextAfterCompletion path."
      - Turn the standing policy Off while both Sessions are in flight; prove no new launch occurs, both in-flight Sessions reconcile visibly, and no duplicate or reactivated Session appears after Off.
      - Record exact revisions, hosts, providers, Action/Session identities, and receipts for both repositories; missing real authorization or input remains one precise review, never fixture-as-live success, and any deferred gap (same-repository pipelining, provider-account slots, review headroom) is named rather than implied proven.
      - "This proof activates only once prove-two-action-unattended-production is status: done and admit-ready-set-across-repositories has shipped; preserve deterministic integration evidence and an exact operator procedure/target in the PR."
    depends_on: [admit-ready-set-across-repositories, prove-two-action-unattended-production, soak-ready-set-admission-with-fixture-provider, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["docs/proposals/portfolio-parallel-execution.md", "docs/decisions/0071-decide-whether-to-reopen-decision-0023-and-adopt-ready-set-admission-for.md", "docs/decisions/0066-record-when-arcadia-should-widen-beyond-one-coding-agent-session-per-repository.md", "docs/decisions/0051-decide-whether-sequential-coding-agent-sessions-for-the-same-governed-action-may.md", "docs/operator-demo-and-release-contract.md", "src/production/tick.ts", "src/ask/settlement.ts", "src/production/policy.ts", "docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md"]
  - id: enforce-concurrency-gate-at-admission
    title: Cap production concurrency at one Session on every admission until both concurrency proofs are done, with an expiring operator-granted rehearsal exception as the only way around it.
    status: done
    responsibility: agent
    effort: session
    next_action: Cap production concurrency at one Session on every admission until both concurrency proofs are done, with an expiring operator-granted rehearsal exception as the only way around it.
    expected_artifact: Evidence satisfying Agent Ask enforce-concurrency-gate-at-admission
    clarification: clarified
    confidence: high
    source: Agent Ask add-concurrency-gate-and-split-rewire-after-review-2026-09-25
    acceptance_criteria:
      - "issueAdmission (src/production/policy.ts) caps effective concurrency at 1 on every admission, whatever maxConcurrentSessions the stored scope carries, unless plan/bootstrap-managed-production-to-build-flight-deck#prove-two-action-unattended-production and plan/bootstrap-managed-production-to-build-flight-deck#prove-concurrent-ready-set-admission are both done on the base branch; a refused admission names both ids."
      - The check runs on every admission and names both Actions by Plan-qualified id, so reopening either Action restores the cap without deactivating the policy, and a later change of active Plan neither lifts nor permanently locks the gate.
      - production preview and activate with --concurrency greater than 1 report the effective cap and its reason while the gate is closed, instead of silently recording a limit that will not be honoured.
      - The only way to exceed the cap before both proofs are done is an explicit, expiring rehearsal exception on the operator-granted policy scope that names prove-concurrent-ready-set-admission; it lapses at its expiry or on deactivation, and nothing else lifts the cap.
      - "Deterministic tests cover: the cap holding for a stored scope above 1 while the gate is closed, including a scope written directly without passing through activation; the cap lifting once both Actions are done; the cap returning when one is reopened; and the rehearsal exception being honoured only before its expiry; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["src/production/policy.ts", "src/production/activation.ts", "src/commands/production.ts", "docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md"]
  - id: rewire-dependents-on-split
    title: A split no longer satisfies anything that depended on the narrowed Action until its remainder Actions are done too.
    status: done
    responsibility: agent
    effort: session
    next_action: A split no longer satisfies anything that depended on the narrowed Action until its remainder Actions are done too.
    expected_artifact: Evidence satisfying Agent Ask rewire-dependents-on-split
    clarification: clarified
    confidence: high
    source: Agent Ask add-concurrency-gate-and-split-rewire-after-review-2026-09-25
    acceptance_criteria:
      - When a split settles (src/ask/settlement.ts), every Action whose depends_on names the split Action also gains the remainder Action ids, so no dependent becomes ready while any remainder is still open.
      - Any readiness or gate check that requires a named Action to be done, including enforce-concurrency-gate-at-admission, also requires every remainder Action split from it to be done.
      - "Deterministic tests cover: a dependent that stays blocked after a split until its remainder is done, and the concurrency gate staying closed when one of its proof Actions is split with an open remainder; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["src/ask/settlement.ts", "src/docs/dispatch.ts", "docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md"]
  - id: fix-action-intent-target-ref-amendments
    title: "An intent: action Agent Ask whose children carry target_ref amends those Actions on settlement, matching what its preview reports, instead of creating duplicates."
    status: done
    responsibility: agent
    effort: session
    next_action: "An intent: action Agent Ask whose children carry target_ref amends those Actions on settlement, matching what its preview reports, instead of creating duplicates."
    expected_artifact: Evidence satisfying Agent Ask fix-action-intent-target-ref-amendments
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - "Settling an intent: action Ask with no envelope target_ref amends every child that carries target_ref: action/<id> and creates only children without one, in src/ask/settlement.ts, exactly as its draft preview reports."
      - A child target_ref naming an Action that does not exist is refused at preview with a named reason, never settled as a creation.
      - "Deterministic tests cover a mixed bundle of amended and created children settling to the previewed effects, and the refused missing target; Closes #654; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["src/ask/settlement.ts", "docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md"]
  - id: release-admission-on-every-launch-failure
    title: Every launch failure after an admission is issued releases that admission at once, so a failed launch never holds a concurrency slot until its receipt expires.
    status: done
    responsibility: agent
    effort: session
    next_action: Every launch failure after an admission is issued releases that admission at once, so a failed launch never holds a concurrency slot until its receipt expires.
    expected_artifact: Evidence satisfying Agent Ask release-admission-on-every-launch-failure
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - Every failure path in src/sessions/launch.ts after issueAdmission -- worktree preparation, prepareSession, tmux start, and the commitAdmission recheck -- calls releaseAdmission for that admission, not only the lease-race path.
      - A crash between issue and commit leaves at most one uncommitted admission, which expires within the existing 30-second receipt TTL and is then not counted by countLiveAdmissions.
      - Deterministic tests inject a failure at each path and show the live admission count back at its prior value immediately afterwards; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: ["src/sessions/launch.ts", "src/production/policy.ts", "docs/proposals/portfolio-parallel-execution.md"]
  - id: add-fixture-coding-agent-provider
    title: Add a deterministic fixture coding-agent provider that sleeps, edits one file and exits, so concurrency limits can be exercised end to end at zero token cost.
    status: done
    responsibility: agent
    effort: session
    next_action: Add a deterministic fixture coding-agent provider that sleeps, edits one file and exits, so concurrency limits can be exercised end to end at zero token cost.
    expected_artifact: Evidence satisfying Agent Ask add-fixture-coding-agent-provider
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - A fixture provider launches through the same adapter, tmux and admission path as real providers, sleeps for a configured duration, edits one declared file in its candidate, and exits with a configured outcome (completed, failed, stalled with no output, or crashed).
      - "The fixture provider is never selected automatically: production admits it only when the active policy scope names it in providers, and every receipt, Session and completion it produces is marked simulated so it can never be cited as live proof."
      - Deterministic tests cover each configured outcome reaching the matching reconciliation result, and the refusal when the policy scope does not name the fixture provider; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: ["src/codingAgents/adapters.ts", "src/codingAgents/providerAdapters.ts", "docs/proposals/portfolio-parallel-execution.md"]
  - id: load-test-workspace-db-contention
    title: Measure the workspace database under concurrent writers so the concurrency limit rests on a tested number, not an assertion.
    status: done
    responsibility: agent
    effort: session
    next_action: Measure the workspace database under concurrent writers so the concurrency limit rests on a tested number, not an assertion.
    expected_artifact: Evidence satisfying Agent Ask load-test-workspace-db-contention
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - A repeatable test starts at least eight separate processes against one WAL workspace database, each running production admission issue/commit/release, Action claim reserve/release, and settlement-sized write transactions in a loop.
      - The test reports surfaced SQLITE_BUSY errors, the longest write-lock wait, and the longest single write transaction; it passes only with zero surfaced errors and a longest wait under the busy_timeout set in src/db/connection.ts.
      - The measured writer count and waits are recorded in docs/production-scheduling.md as the tested basis for maxConcurrentSessions; any write transaction that holds the lock across a git or filesystem call is named and filed as a bug Issue; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: ["src/db/connection.ts", "tests/db-write-transaction.test.ts", "docs/production-scheduling.md", "docs/proposals/portfolio-parallel-execution.md"]
  - id: keep-action-claim-while-candidate-unmerged
    title: An Action claim does not expire while its candidate is still unmerged, so neither arcadia go nor production can dispatch the same Action a second time.
    status: done
    responsibility: agent
    effort: session
    next_action: An Action claim does not expire while its candidate is still unmerged, so neither arcadia go nor production can dispatch the same Action a second time.
    expected_artifact: Evidence satisfying Agent Ask keep-action-claim-while-candidate-unmerged
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - An Action claim whose worktree reservation (AGENT_WORKTREE_RESERVATION_MS, src/sessions/index.ts) has passed its 24-hour window is kept while its candidate branch or pull request is unmerged, and is released when the candidate merges or is explicitly abandoned.
      - Both launch paths (launchGuardedHostSession and arcadia go) refuse to dispatch an Action whose claim is held this way, and name the unmerged candidate.
      - "Deterministic tests cover a claim older than 24 hours with an unmerged candidate refusing re-dispatch, and releasing once the candidate merges; Closes #549; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["src/sessions/index.ts", "src/sessions/launch.ts", "docs/decisions/0066-record-when-arcadia-should-widen-beyond-one-coding-agent-session-per-repository.md"]
  - id: limit-sessions-per-provider-account
    title: Cap concurrent Sessions per provider account in the same admission transaction as the host slot, so concurrency never oversubscribes one account.
    status: open
    responsibility: agent
    effort: session
    next_action: Cap concurrent Sessions per provider account in the same admission transaction as the host slot, so concurrency never oversubscribes one account.
    expected_artifact: Evidence satisfying Agent Ask limit-sessions-per-provider-account
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - issueAdmission (src/production/policy.ts) counts live admissions per provider account in the same transaction as the host-slot count, against a per-account limit in workspace configuration that defaults to 1.
      - A provider whose capacity receipt cannot prove account identity (accountIdentity unsupported in src/codingAgents/capacity.ts) is counted as one account for that provider, never as unlimited.
      - A refused admission records provider_full(<account>) as the wait reason; deterministic tests cover two admissions on one account refused at limit 1, two accounts admitted side by side, and an unknown identity folded into one account; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [enforce-concurrency-gate-at-admission]
    decisions: []
    references: ["src/production/policy.ts", "src/codingAgents/capacity.ts", "docs/proposals/portfolio-parallel-execution.md"]
  - id: recover-stalled-sessions-within-bound
    title: A Session that stays stalled past a bounded window is ended, preserved and reconciled so its repository lease and host slot are freed, with repeated stalls escalated to the operator.
    status: open
    responsibility: agent
    effort: session
    next_action: A Session that stays stalled past a bounded window is ended, preserved and reconciled so its repository lease and host slot are freed, with repeated stalls escalated to the operator.
    expected_artifact: Evidence satisfying Agent Ask recover-stalled-sessions-within-bound
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - A Session flagged stalled (src/production/stallDetection.ts) that shows no activity for a configured recovery window after the flag is ended by the production worker, its candidate is preserved, and it is reconciled through the existing path, which releases its repository lease and its admission.
      - The Action is left resumable in the same candidate under Decision 0051, and a second stall recovery for the same Action records an operator escalation instead of relaunching.
      - Recovery runs only while a production policy is active and the Session is inside its scope, and records a receipt naming the Session, the stall duration and the preserved candidate.
      - Deterministic tests, using the fixture provider stalled outcome, cover recovery freeing the lease and slot, resumption in the same candidate, and escalation on the second stall; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [prove-two-action-unattended-production, add-fixture-coding-agent-provider, finish-two-action-unattended-production-proof, prove-literal-split-browser-and-ledger]
    decisions: []
    references: ["src/production/stallDetection.ts", "src/production/tick.ts", "src/sessions/reconciliation.ts", "docs/decisions/0051-decide-whether-sequential-coding-agent-sessions-for-the-same-governed-action-may.md", "docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md"]
  - id: limit-unmerged-candidates-per-repository
    title: Admission stops starting new work in a repository once its count of unmerged candidates reaches the operator-configured review limit.
    status: open
    responsibility: agent
    effort: session
    next_action: Admission stops starting new work in a repository once its count of unmerged candidates reaches the operator-configured review limit.
    expected_artifact: Evidence satisfying Agent Ask limit-unmerged-candidates-per-repository
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - Workspace configuration carries a per-repository review limit on unmerged candidates, defaulting to 1, which preserves today behaviour of waiting for each pull request to merge.
      - The ready-set admission in src/production/tick.ts counts a repository unmerged candidates from preserved branches and open pull requests and records review_backlog(<n PRs>) instead of launching once the count reaches the limit.
      - Deterministic tests cover a repository at its limit refused with review_backlog and admitted again once a candidate merges; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [admit-ready-set-across-repositories]
    decisions: []
    references: ["src/production/tick.ts", "src/scheduling/scheduler.ts", "docs/proposals/portfolio-parallel-execution.md"]
  - id: soak-ready-set-admission-with-fixture-provider
    title: Soak ready-set admission with the fixture provider across several repositories at a raised concurrency limit, proving every limit engages and every invariant holds before any live concurrent proof.
    status: open
    responsibility: agent
    effort: session
    next_action: Soak ready-set admission with the fixture provider across several repositories at a raised concurrency limit, proving every limit engages and every invariant holds before any live concurrent proof.
    expected_artifact: Evidence satisfying Agent Ask soak-ready-set-admission-with-fixture-provider
    clarification: clarified
    confidence: high
    source: Agent Ask plan-concurrent-session-management-gaps-2026-09-26
    acceptance_criteria:
      - Under the rehearsal exception defined by enforce-concurrency-gate-at-admission, a scripted soak runs at least twenty fixture Actions across at least three disposable repositories at maxConcurrentSessions 3, including injected launch failures, a stalled Session and a crashed Session.
      - "Throughout the soak: live Sessions never exceed the host or per-account limit, no repository ever has two live Sessions, no Action is launched twice, every in-scope Action that did not launch on a tick carries exactly one wait reason, and every admission is released or committed."
      - The soak command is checked in, repeatable with one command, prints a pass/fail invariant report, and its latest report is linked from docs/managed-production-readiness.md, marked simulated.
      - Pass/fail of this soak is a prerequisite of prove-concurrent-ready-set-admission, so no live concurrent Session runs before the fixture soak is green; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [admit-ready-set-across-repositories, add-fixture-coding-agent-provider, limit-sessions-per-provider-account, release-admission-on-every-launch-failure, recover-stalled-sessions-within-bound, load-test-workspace-db-contention, keep-action-claim-while-candidate-unmerged]
    decisions: []
    references: ["docs/proposals/portfolio-parallel-execution.md", "docs/reviews/2026-09-25-ready-set-admission-adversarial-review.md", "docs/managed-production-readiness.md", "src/production/tick.ts"]
  - id: resolve-ambiguous-and-cross-project-dependency-ids
    title: Cross-Project dependency resolution, ambiguous-id refusal, cross-Plan cycle detection at parse time, and tick-based escalation for a long-unresolved dependency.
    status: done
    responsibility: agent
    effort: session
    next_action: Cross-Project dependency resolution, ambiguous-id refusal, cross-Plan cycle detection at parse time, and tick-based escalation for a long-unresolved dependency.
    expected_artifact: Evidence satisfying Agent Ask resolve-ambiguous-and-cross-project-dependency-ids
    clarification: clarified
    confidence: high
    source: Agent Ask resolve-ambiguous-and-cross-project-dependency-ids-2026-09-26
    acceptance_criteria:
      - A depends_on id may name another Project; an id that resolves to more than one Action across Plans or Projects is reported as dependency_unresolved (ambiguous) and never resolved to either, in both collectUnmetDependencies (src/docs/dispatch.ts) and canonicalOrder (src/scheduling/order.ts).
      - The plan parser (src/docs/parse.ts) detects and reports a dependency cycle that spans Plans, not only one confined to a single Plan.
      - An Action that stays dependency_unresolved for more than one worker tick is surfaced as an operator escalation (src/production/tick.ts) naming the unresolved id, instead of waiting silently.
      - "Deterministic tests cover: cross-Project resolution, an ambiguous id refused across Plans or Projects, a cross-Plan cycle detected and reported at parse time, and an unresolved dependency escalated after one tick; pnpm test and the core, Discord and Dashboard builds pass."
    depends_on: [resolve-cross-plan-dependency-ids]
    decisions: []
    references: []
  - id: tidy-quarantine-instead-of-delete
    title: Retire worktrees and branches by moving them into a quarantine instead of deleting them, with arcadia tidy undo and arcadia tidy quarantine.
    status: done
    responsibility: agent
    effort: session
    next_action: Retire worktrees and branches by moving them into a quarantine instead of deleting them, with arcadia tidy undo and arcadia tidy quarantine.
    expected_artifact: Evidence satisfying Agent Ask tidy-quarantine-instead-of-delete
    clarification: clarified
    confidence: high
    source: Agent Ask tidy-quarantine-not-delete-2026-09-27
    acceptance_criteria:
      - Branch retirement is one git update-ref --stdin transaction that verifies the tip, creates refs/arcadia/tidy/<run>/heads/<branch>, and deletes refs/heads/<branch>, with the branch reflog preserved; the git branch -d shortcut and new archive/tidy tags are no longer used.
      - Worktree retirement pins HEAD under refs/arcadia/tidy/<run>/worktrees/<id>, then renames the worktree directory and its .git/worktrees/<id> admin directory into .git/arcadia-tidy/quarantine/<run>/, refusing (never copying) across filesystems.
      - A missing worktree has its admin directory quarantined and HEAD pinned rather than being removed by git worktree prune, and tidy refuses when its path sits under an unmounted volume.
      - arcadia tidy undo <run> restores the exact prior git worktree list, refs, and file trees including gitignored files, and a test proves it.
      - A test proves gitignored files and a detached HEAD whose commits no ref contains both survive tidy --apply.
      - START_HERE.md describes quarantine, undo, and the listing command.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/737", "https://github.com/pmark/arcadia/issues/738"]
  - id: tidy-harden-merge-and-liveness-verdicts
    title: Tighten tidy verdicts so wrong merge proofs and live unregistered worktrees are no longer retired.
    status: done
    responsibility: agent
    effort: session
    next_action: Tighten tidy verdicts so wrong merge proofs and live unregistered worktrees are no longer retired.
    expected_artifact: Evidence satisfying Agent Ask tidy-harden-merge-and-liveness-verdicts
    clarification: clarified
    confidence: high
    source: Agent Ask tidy-quarantine-not-delete-2026-09-27
    acceptance_criteria:
      - The pull-request proof requires the local branch tip to be an ancestor of the PR headRefOid, ignores cross-repository PRs, and fails closed when headRefOid is not in the local object store.
      - A worktree whose branch reflog holds only its creation entry, or that saw activity inside a configurable grace window, or that is the cwd of a live process, or that is git-worktree-locked, is reported protected.
      - Under the apply interlock every branch is re-assessed with evaluateMerge and skipped if it is now checked out in any worktree.
      - Regression tests cover branch-name reuse after merge, a fork PR name collision, a fresh desktop-agent worktree at the base tip, and a branch checked out between preview and apply.
    depends_on: [tidy-quarantine-instead-of-delete]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/736", "https://github.com/pmark/arcadia/issues/739", "https://github.com/pmark/arcadia/issues/740"]
  - id: tidy-journal-recovery-and-conservation-tests
    title: Make tidy crash-safe and prove its no-loss guarantee with generated repository histories.
    status: done
    responsibility: agent
    effort: session
    next_action: Make tidy crash-safe and prove its no-loss guarantee with generated repository histories.
    expected_artifact: Evidence satisfying Agent Ask tidy-journal-recovery-and-conservation-tests
    clarification: clarified
    confidence: high
    source: Agent Ask tidy-quarantine-not-delete-2026-09-27
    acceptance_criteria:
      - Each quarantine step is written to an fsynced journal before it runs, and tidy startup rolls an interrupted run forward or back deterministically.
      - A seeded generator of repository states (squash, rebase, detached HEADs, ignored files, missing directories, reused names, injected races) asserts that every reachable commit and every worktree file byte before tidy --apply is still reachable or quarantined after it.
      - The same generator asserts that undo restores the exact prior state and that a second tidy --apply is a no-op.
    depends_on: [tidy-quarantine-instead-of-delete, tidy-harden-merge-and-liveness-verdicts]
    decisions: []
    references: []
  - id: fix-rehearsal-fixture-validation-command
    title: Give the two-Action rehearsal fixture a validation command that can actually pass for both Actions.
    status: done
    responsibility: agent
    effort: session
    next_action: Give the two-Action rehearsal fixture a validation command that can actually pass for both Actions.
    expected_artifact: Evidence satisfying Agent Ask fix-rehearsal-fixture-validation-command
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#726: The v5 fixture declares scripts/check-marker.mjs (committed at genesis) as its validation command instead of a file that does not exist yet for Action A."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/726"]
  - id: enable-unattended-claude-session-launch
    title: Launch standing-policy Claude Sessions the same non-interactive way Codex launches, and remove the worktree-trust dialog that blocks them.
    status: done
    responsibility: agent
    effort: session
    next_action: Launch standing-policy Claude Sessions the same non-interactive way Codex launches, and remove the worktree-trust dialog that blocks them.
    expected_artifact: Evidence satisfying Agent Ask enable-unattended-claude-session-launch
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#727: A Claude Session launched by the worker runs non-interactively and exits on its own, with no approval bypass."
      - "#698: go-broker install pre-trusts Claude Code's global worktree root so a fresh Session never hits the interactive 'trust this folder' dialog."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/727", "https://github.com/pmark/arcadia/issues/698"]
  - id: harden-agent-ask-settlement-races-and-state
    title: "Fix the agent-ask settle correctness defects: stale revisions, missing locks, and state that diverges across concurrent or replayed settlements."
    status: done
    responsibility: agent
    effort: session
    next_action: "Fix the agent-ask settle correctness defects: stale revisions, missing locks, and state that diverges across concurrent or replayed settlements."
    expected_artifact: Evidence satisfying Agent Ask harden-agent-ask-settlement-races-and-state
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#296: settle --revision only hard-fails on genuinely stale input, matching what --preview's fingerprint already reported."
      - "#304: agent-ask draft refuses to produce a completion Ask that is un-applicable at its own recorded candidate_revision."
      - "#320: decision approve --dry-run replay of an applied deferral receipt is covered by a test and behaves correctly."
      - "#321: An archived complete Ask's candidate_revision matches what the Mission Log records, not the settle commit."
      - "#505: applyDecisionDeferral writes the pointer pair under a lock or compare-and-set so it cannot clobber a concurrent write."
      - "#507: arcadia action settle prints the correct Next action under concurrent settlement."
      - "#512: agent-ask settle --apply's auto-commit succeeds because it no longer stages its own gitignored archive file."
      - "#592: agent-ask draft does not report an already-settled .arcadia/asks file as an auto-discover failure."
      - "#598: agent-ask settle bumps a Plan's updated date when it amends that Plan."
      - "#609: production activate's --expect-revision flag matches preview's expectedRevision field name."
      - "#639: attemptSettleOneDraft only refreshes a stale candidate_revision when the refreshed evidence still verbatim-covers every criterion, not by ancestry alone."
      - "#663: review approve --no-execute routes the packet's sourceInput correctly instead of through the general intent classifier."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/296", "https://github.com/pmark/arcadia/issues/304", "https://github.com/pmark/arcadia/issues/320", "https://github.com/pmark/arcadia/issues/321", "https://github.com/pmark/arcadia/issues/505", "https://github.com/pmark/arcadia/issues/507", "https://github.com/pmark/arcadia/issues/512", "https://github.com/pmark/arcadia/issues/592", "https://github.com/pmark/arcadia/issues/598", "https://github.com/pmark/arcadia/issues/609", "https://github.com/pmark/arcadia/issues/639", "https://github.com/pmark/arcadia/issues/663"]
  - id: improve-agent-ask-settle-usability
    title: Reduce agent-ask settle's friction so the correct flag combination and next step are discoverable without repeated failed attempts.
    status: done
    responsibility: agent
    effort: session
    next_action: Reduce agent-ask settle's friction so the correct flag combination and next step are discoverable without repeated failed attempts.
    expected_artifact: Evidence satisfying Agent Ask improve-agent-ask-settle-usability
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#718: agent-ask settle's documentation or error output shows a combined usage example covering the required flag combination and preview-fingerprint requirement."
      - "#722: split settlement chooses its next_action pointer after the compare-and-set retry, not before, so it cannot reflect a stale dependent set."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/718", "https://github.com/pmark/arcadia/issues/722"]
  - id: fix-docs-sync-paused-project-handling
    title: Make a paused Project actually stop being read, synced, and routed to, matching what 'paused' should mean.
    status: done
    responsibility: agent
    effort: session
    next_action: Make a paused Project actually stop being read, synced, and routed to, matching what 'paused' should mean.
    expected_artifact: Evidence satisfying Agent Ask fix-docs-sync-paused-project-handling
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#298: Agent Ask v1 can set a Project's status, so pausing/reactivating no longer requires a hand edit of PROJECT.md."
      - "#299: docs sync --all has a defined, tested scope for whether it ingests paused Projects."
      - "#300: Ask routing (resolveProjectReference / resolveProjectContextFromRequest) does not resolve a paused Project."
      - "#455: arcadia docs sync no longer silently omits documents whose frontmatter declares an unrecognized type; it reports them."
      - "#662: docs sync --project cannot mutate another project's work_item when a plan slug and action id collide."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/298", "https://github.com/pmark/arcadia/issues/299", "https://github.com/pmark/arcadia/issues/300", "https://github.com/pmark/arcadia/issues/455", "https://github.com/pmark/arcadia/issues/662"]
  - id: fix-auto-settle-eligibility-docs
    title: Correct docs/agents-context.md's description of auto-settle eligibility and the no-workspace draft-only settle invocation.
    status: done
    responsibility: agent
    effort: session
    next_action: Correct docs/agents-context.md's description of auto-settle eligibility and the no-workspace draft-only settle invocation.
    expected_artifact: Evidence satisfying Agent Ask fix-auto-settle-eligibility-docs
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#640: docs/agents-context.md's auto-settle eligibility text states the per-criterion met requirement the code actually enforces."
      - "#641: docs/agents-context.md states the exact settle invocation for the no-workspace draft-only case."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/640", "https://github.com/pmark/arcadia/issues/641"]
  - id: harden-dispatch-and-claim-lifecycle
    title: "Fix the dispatch and Action-claim defects: wrong dispatchability reporting, claims that outlive their worktree or candidate, and worktree prep that ignores an operator gate."
    status: done
    responsibility: agent
    effort: session
    next_action: "Fix the dispatch and Action-claim defects: wrong dispatchability reporting, claims that outlive their worktree or candidate, and worktree prep that ignores an operator gate."
    expected_artifact: Evidence satisfying Agent Ask harden-dispatch-and-claim-lifecycle
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#459: go's refusal message's allowedPrefixes list includes opencode/, matching what SAFE_TASK_BRANCH actually allows."
      - "#464: selectCompliantCodingAgent's capacityRefusals parameter receives capacity refusals, not launch-adapter refusals."
      - "#494: resolveDispatch reports an Action with status: blocked as not dispatchable, matching the ready set and scheduler."
      - "#549: An Action claim does not expire at 24h while its candidate is still unmerged, so arcadia go cannot re-dispatch a live Action."
      - "#621: arcadia go's worktree-preparation branching is gated by the same resolveOperatorGate classification as launch, so it never prepares a worktree for an Action a pending operator item blocks."
      - "#625: An Action claim (agent_worktree_reservations) is released once its worktree no longer exists, instead of outliving it and refusing dispatch."
      - "#733: An Action claim is released once the claiming worktree's PR is confirmed merged (landed)."
      - "#608: Base-branch-advance does not silently revert a manual git reset on a DB-active Project."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/459", "https://github.com/pmark/arcadia/issues/464", "https://github.com/pmark/arcadia/issues/494", "https://github.com/pmark/arcadia/issues/549", "https://github.com/pmark/arcadia/issues/621", "https://github.com/pmark/arcadia/issues/625", "https://github.com/pmark/arcadia/issues/733", "https://github.com/pmark/arcadia/issues/608"]
  - id: fix-worker-and-dashboard-operational-bugs
    title: Fix operational bugs in the worker, its install/recovery scripts, and the dashboard's status reporting.
    status: done
    responsibility: agent
    effort: session
    next_action: Fix operational bugs in the worker, its install/recovery scripts, and the dashboard's status reporting.
    expected_artifact: Evidence satisfying Agent Ask fix-worker-and-dashboard-operational-bugs
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#392: The dashboard's production toggle does not re-derive scope.actions on reactivation."
      - "#430: services.sh restart does not tear down all services when a single 2s health probe times out."
      - "#450: The recovery script does not report failure before worker transports are actually ready."
      - "#560: Worker install tests do not write to the real ~/Library/LaunchAgents/com.arcadia.worker.plist."
      - "#569: add-arcadia-push-field-to-board.sh does not write a pnpm warning line into schedule-status.json."
      - "#582: The dashboard /runs page reports the worker's actual running/stopped state, matching the real pidfile format."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/392", "https://github.com/pmark/arcadia/issues/430", "https://github.com/pmark/arcadia/issues/450", "https://github.com/pmark/arcadia/issues/560", "https://github.com/pmark/arcadia/issues/569", "https://github.com/pmark/arcadia/issues/582"]
  - id: stabilize-test-and-build-infra
    title: Remove flakiness and false failures from the test and build pipeline.
    status: done
    responsibility: agent
    effort: session
    next_action: Remove flakiness and false failures from the test and build pipeline.
    expected_artifact: Evidence satisfying Agent Ask stabilize-test-and-build-infra
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#452: pnpm test does not flake into 30s timeouts on CLI/discord subprocess tests under file parallelism."
      - "#480: eslint's type-aware rules do not report false positives in a prepared worktree that are absent on the main checkout."
      - "#514: The packageBoundary beforeAll build completes within vitest's 10s hook timeout on a clean checkout."
      - "#557: Preservation check binding resolves dotted local Python submodule imports."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/452", "https://github.com/pmark/arcadia/issues/480", "https://github.com/pmark/arcadia/issues/514", "https://github.com/pmark/arcadia/issues/557"]
  - id: close-ask-traceability-and-cli-portability-gaps
    title: Make Ask capture ids traceable to what they produced, and make the arcadia-go skill's dependency bridge work outside Arcadia's own monorepo.
    status: done
    responsibility: agent
    effort: session
    next_action: Make Ask capture ids traceable to every resulting record while preserving the delivered portable arcadia-go dependency bridge.
    expected_artifact: Evidence satisfying Agent Ask close-ask-traceability-and-cli-portability-gaps
    clarification: clarified
    confidence: high
    source: Agent Ask amend-close-ask-traceability-scope-2026-09-30
    acceptance_criteria:
      - "#591: Every resulting Ask record carries its originating capture_id."
      - "#591: arcadia ask show <capture_…|request id> maps a capture or request to the Ask, back-burner item, or Action it produced."
      - "#591: The dashboard exposes a receipt link for each capture-to-result trace."
      - "#591: Objective tests cover capture_id propagation, capture/request lookup, dashboard receipt links, and every resulting record type."
      - "#716: The arcadia-go skill’s node_modules bridge step works on a target repo that is not Arcadia’s own monorepo."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/591", "https://github.com/pmark/arcadia/issues/716", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md"]
  - id: prove-contract-20-completion-gate
    title: Give Contract-20's false-agent-completion quality gate an owning Action and proof that it holds.
    status: done
    responsibility: agent
    effort: session
    next_action: Give Contract-20's false-agent-completion quality gate an owning Action and proof that it holds.
    expected_artifact: Evidence satisfying Agent Ask prove-contract-20-completion-gate
    clarification: clarified
    confidence: high
    source: Agent Ask batch-defect-issues-into-actions-2026-09-27
    acceptance_criteria:
      - "#555: Contract-20's false-agent-completion quality gate is proven by a test, with an owning Action recorded."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/555"]
  - id: harden-tidy-quarantine-safety-and-docs
    title: Fix tidy's quarantine-not-delete safety gaps found while hardening it, and correct its documented tag name.
    status: done
    responsibility: agent
    effort: session
    next_action: Fix tidy quarantine safety gaps and document the current recoverable quarantine mechanism.
    expected_artifact: Evidence satisfying Agent Ask harden-tidy-quarantine-safety-and-docs
    clarification: clarified
    confidence: high
    source: Agent Ask amend-tidy-quarantine-safety-criterion-2026-09-30
    acceptance_criteria:
      - "#735: START_HERE.md states that current tidy quarantines branch refs under refs/arcadia/tidy/<run>/heads/<branch> and restores them with arcadia tidy undo <run>; it does not describe archive/<branch> as an active recovery path."
      - "#739: tidy does not retire a live non-Arcadia agent worktree that has not committed yet."
      - "#740: tidy --apply does not retire branches on preview-time verdicts, and never runs update-ref -d on a branch checked out in another worktree."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/735", "https://github.com/pmark/arcadia/issues/739", "https://github.com/pmark/arcadia/issues/740", "START_HERE.md", "src/commands/tidy.ts", "tests/tidy-command.test.ts"]
  - id: soak-rehearsal-harness-until-clean
    title: Run the hermetic rehearsal harness in a bounded soak loop that files each defect as an Issue, fixes only loop-blocking ones, and stops on fixed conditions.
    status: done
    responsibility: agent
    effort: session
    next_action: Run the hermetic rehearsal harness in a bounded soak loop that files each defect as an Issue, fixes only loop-blocking ones, and stops on fixed conditions.
    expected_artifact: Evidence satisfying Agent Ask soak-rehearsal-harness-until-clean
    clarification: clarified
    confidence: high
    source: Agent Ask soak-rehearsal-harness-loop-2026-09-29
    acceptance_criteria:
      - A single documented command runs tests/rehearsal-two-action.test.ts repeatedly against a freshly prepared fixture each iteration, and refuses to start when the fixture shows leftover repair budget, stale handoffs, live claims or a reused request_id.
      - "The loop stops on any of: N consecutive clean iterations (default 5), a configured iteration or token budget, or the same failure recurring after three fix attempts; each stop reason is printed and recorded."
      - "Every failing iteration files or updates one bug Issue in the owning repository with evidence and file:line, and only a failure that blocks the loop becomes a fix; non-blocking failures stay Issues."
      - The loop never merges a change to the concurrency gate, admission policy or approval boundaries; such a fix is left as an open pull request for the operator.
      - Deterministic tests cover the clean-fixture refusal, each stop condition, and the gate-file merge refusal; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [harden-dispatch-and-claim-lifecycle]
    decisions: []
    references: []
  - id: session-signal-catalog-and-classifier
    title: Classify a live managed Session into a closed state set from deterministic signals, with no model calls.
    status: done
    responsibility: agent
    effort: session
    next_action: Ship the session signal catalog, the pure classifier and its documented precedence (PR 812).
    expected_artifact: Evidence satisfying Agent Ask session-signal-catalog-and-classifier
    clarification: clarified
    confidence: high
    source: Agent Ask split-session-signal-catalog-and-classifier-2026-09-29
    acceptance_criteria:
      - A regex catalog recognizes provider rate/usage limits, auth or scope failures, permission prompts, sandbox denials, context exhaustion, and repeated-command loops from pane text.
      - A pure classifier combines process, pane, git, Run, preservation, drafted-Ask, PR and claim signals into one state from a documented closed set, each state mapped to one action.
      - The classifier documents an explicit precedence order for overlapping signals, so a provider limit, auth failure, or permission prompt is never classified as a stall when pane or process signals also overlap.
    depends_on: []
    split_into: [replay-real-pane-transcripts-through-classifier]
    decisions: []
    references: []
  - id: raise-red-alert-on-stop-the-line-failures
    title: Detect stop-the-line failures deterministically in the worker tick and record a red alert with evidence and a Discord post.
    status: done
    responsibility: agent
    effort: session
    next_action: Detect stop-the-line failures deterministically in the worker tick and record a red alert with evidence and a Discord post.
    expected_artifact: Evidence satisfying Agent Ask raise-red-alert-on-stop-the-line-failures
    clarification: clarified
    confidence: high
    source: Agent Ask red-alert-stop-the-line-monitoring-2026-09-29
    acceptance_criteria:
      - "docs/arcadia-semantics.md defines a red alert as a managed-production failure that meets the Stop the line test, and lists the triggers: an admission refused on consecutive ticks, a Session past its stall window, a failed reconcile, and a failure repeating after the repair budget."
      - The worker tick detects each trigger with no model call and records one red alert per distinct failure, with the Project, Action, Session id, trigger, first-seen time, and the log or artifact path that shows the cause; a repeat of the same failure updates the alert instead of creating another.
      - Each new red alert posts once to the configured notification channel with its request id, the Action, the trigger and a link to the evidence, and production status lists open red alerts before every other section.
      - Deterministic tests cover each trigger raising exactly one alert, a repeat updating it, and an alert clearing when the failure resolves; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: []
  - id: diagnose-red-alerts-and-propose-the-fix
    title: Run one bounded diagnosis per red alert that files the Issue and proposes the fix Action, never merging changes to safety gates.
    status: done
    responsibility: agent
    effort: session
    next_action: Run one bounded diagnosis per red alert that files the Issue and proposes the fix Action, never merging changes to safety gates.
    expected_artifact: Evidence satisfying Agent Ask diagnose-red-alerts-and-propose-the-fix
    clarification: clarified
    confidence: high
    source: Agent Ask red-alert-stop-the-line-monitoring-2026-09-29
    acceptance_criteria:
      - "An open red alert starts at most one bounded diagnosis with a declared token budget, which reads the alert evidence, files or updates one bug Issue with file:line evidence, and records a proposed fix Action through an Agent Ask."
      - A diagnosis whose fix touches the concurrency gate, admission policy, approval boundaries or credentials stops at an open pull request for the operator and is never merged automatically.
      - A diagnosis that exceeds its budget or finds no cause records that fact on the alert and leaves it open and visible; it does not retry.
      - Deterministic tests cover the single-diagnosis limit, the budget stop, and the safety-gate refusal; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [raise-red-alert-on-stop-the-line-failures]
    decisions: []
    references: []
  - id: prove-red-alert-with-injected-failures
    title: Prove the red alert and diagnosis path fire end to end by injecting failures into the hermetic rehearsal harness.
    status: done
    responsibility: agent
    effort: session
    next_action: Prove the red alert and diagnosis path fire end to end by injecting failures into the hermetic rehearsal harness.
    expected_artifact: Evidence satisfying Agent Ask prove-red-alert-with-injected-failures
    clarification: clarified
    confidence: high
    source: Agent Ask red-alert-stop-the-line-monitoring-2026-09-29
    acceptance_criteria:
      - tests/rehearsal-two-action.test.ts or a sibling suite injects a stalled Session, a refused admission on consecutive ticks and a failed reconcile through tests/helpers/rehearsalHarness.ts, and asserts each raises its red alert with evidence.
      - The suite asserts the alert posts one notification and starts one bounded diagnosis, and that resolving the failure clears the alert.
      - The suite runs in the standard pnpm test run with no live production grant and no network; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [diagnose-red-alerts-and-propose-the-fix]
    decisions: []
    references: []
  - id: define-grant-operator-action-pattern
    title: Document the Grant pattern and add a grant tag that /runs and the script contract understand, without breaking existing descriptors.
    status: done
    responsibility: agent
    effort: session
    next_action: Document the Grant pattern and add a grant tag that /runs and the script contract understand, without breaking existing descriptors.
    expected_artifact: Evidence satisfying Agent Ask define-grant-operator-action-pattern
    clarification: clarified
    confidence: high
    source: Agent Ask amend-grant-operator-action-v6-criterion-2026-09-30-v2
    acceptance_criteria:
      - "docs/arcadia-semantics.md defines Grant as a one-shot operator action that delegates bounded authority, and states what every Grant must do: pin the policy revision it was built against, cover a named scope only, carry an expiry, refuse on any precondition drift, and record a receipt."
      - The arcadia-operator-script-v1 descriptor contract accepts an optional kind field with the value grant; descriptors without it keep listing exactly as before, and a test proves both.
      - AGENTS.md operator-step guidance (via docs/agents-context.md and regeneration) tells agents to tag an authority-delegating script as kind grant and points at the semantics definition.
      - The existing grant-production-two-action-v6-remaining-stages-2026-09-30 descriptor is tagged kind grant and /runs shows its Grant tag; neither absent v5 nor regrant descriptor is recreated or changed; pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: []
  - id: move-grants-to-their-own-page
    title: Show Grants on their own dashboard page, separate from the other /runs operator actions.
    status: open
    responsibility: agent
    effort: session
    next_action: Show Grants on their own dashboard page, separate from the other /runs operator actions.
    expected_artifact: Evidence satisfying Agent Ask move-grants-to-their-own-page
    clarification: clarified
    confidence: high
    source: Agent Ask define-grant-pattern-and-page-2026-09-29
    acceptance_criteria:
      - A dashboard route lists only actions tagged kind grant, with each one showing its scope, expiry, pinned revision, availability and last receipt; /runs no longer lists them.
      - The page reuses the existing operator-script API and launch lifecycle with no new execution path; the browser still never supplies a command or path.
      - The route is documented in START_HERE.md with its exact URL and start command; a component test covers listing, a disabled succeeded one-shot, and the handoff link of a failed run; pnpm test and the Dashboard build pass.
    depends_on: [define-grant-operator-action-pattern]
    decisions: []
    references: []
  - id: replay-real-pane-transcripts-through-classifier
    title: Capture real pane transcripts and replay them through the session signal classifier as fixtures, replacing the constructed ones.
    status: open
    responsibility: agent
    effort: session
    next_action: Capture real pane transcripts and replay them through the session signal classifier as fixtures, replacing the constructed ones.
    expected_artifact: Evidence satisfying Agent Ask replay-real-pane-transcripts-through-classifier
    clarification: clarified
    confidence: high
    source: Agent Ask split-session-signal-catalog-and-classifier-2026-09-29
    acceptance_criteria:
      - Recorded real pane transcripts replay through the classifier as fixtures in tests, with at least one case per catalog class and representative overlap cases, including overlaps with stall indicators.
    depends_on: []
    decisions: []
    references: []
  - id: finish-two-action-unattended-production-proof
    title: Finish the exact split Session, Off/restart, evidence ledger and integration proof that retained v6 evidence has not yet established.
    status: done
    responsibility: agent
    effort: session
    next_action: "Record only the exact integration-evidence criterion proven by retained v6 B recovery and merged PR #870; keep the other three criteria open."
    expected_artifact: Evidence satisfying Agent Ask finish-two-action-unattended-production-proof
    clarification: clarified
    confidence: high
    source: Agent Ask split-v6-b-recovery-evidenced-slice-2026-10-01
    acceptance_criteria:
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
    depends_on: []
    split_into: [prove-literal-split-browser-and-ledger]
    decisions: []
    references: []
  - id: recover-terminal-integration-after-reconcile
    title: Rediscover a terminal completed candidate from canonical receipts and integrate it exactly once under fresh exact authority.
    status: done
    responsibility: agent
    effort: session
    next_action: Rediscover a terminal completed candidate from canonical receipts and integrate it exactly once under fresh exact authority.
    expected_artifact: Evidence satisfying Agent Ask recover-terminal-integration-after-reconcile
    clarification: clarified
    confidence: high
    source: Agent Ask recover-terminal-integration-after-reconcile-2026-10-01
    acceptance_criteria:
      - A later worker tick rediscovers a canonically completed, validated and preserved terminal candidate after an injected integration failure, integrates its unchanged settlement HEAD through the existing fast-forward path exactly once, and launches no replacement coding Session.
      - Production Off, expired or drifted exact Grant or scope, missing validation or preservation, changed candidate HEAD or branch, and divergent base each refuse integration while preserving a recoverable handoff receipt.
      - Focused fault and refusal tests pass, followed by the required full test and build checks; the reviewed change states the installed revision and remaining live-proof boundary.
    depends_on: []
    decisions: []
    references: ["artifacts/generated/adversarial-review/2026-10-01-production/recovery-probe/result.md", "src/production/tick.ts", "src/production/sessionHandoff.ts", "docs/managed-production-readiness.md"]
  - id: recover-off-completed-candidate-preservation
    title: Bind the accepted terminal exit and completion settlement to the unchanged candidate, validate and preserve it under current exact authority, then integrate it through the existing receipt and fast-forward path.
    status: done
    responsibility: agent
    effort: session
    next_action: Bind the accepted terminal exit and completion settlement to the unchanged candidate, validate and preserve it under current exact authority, then integrate it through the existing receipt and fast-forward path.
    expected_artifact: Evidence satisfying Agent Ask recover-off-completed-candidate-preservation
    clarification: clarified
    confidence: high
    source: Agent Ask recover-completed-candidate-unpreserved-after-off-2026-10-01
    acceptance_criteria:
      - A later worker tick, under a fresh exact Active policy and integration Grant, validates and preserves the unchanged completed v6-style candidate whose prior Off state withheld preservation, then integrates its settlement HEAD exactly once without another coding Session.
      - Off, expired or drifted exact authority, missing accepted completion or passing validation, changed candidate HEAD or branch, conflicting live lease, and divergent base each refuse before integration and leave the candidate and canonical receipts recoverable.
      - Focused fault and refusal tests pass, followed by the required full test and build checks; the reviewed change identifies its installed revision, the v6 live-proof boundary and the separate operator approval needed for a fresh Grant.
    depends_on: []
    decisions: []
    references: ["src/production/tick.ts", "src/production/sessionHandoff.ts", "src/sessions/candidatePreservation.ts", "docs/managed-production-readiness.md"]
  - id: prove-literal-split-browser-and-ledger
    title: Prove the literal two-Session continuation, browser-close/Off restart behavior, and exhaustive operator-intervention ledger still missing from the v6 proof.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove the literal two-Session continuation, browser-close/Off restart behavior, and exhaustive operator-intervention ledger still missing from the v6 proof.
    expected_artifact: Evidence satisfying Agent Ask prove-literal-split-browser-and-ledger
    clarification: clarified
    confidence: high
    source: Agent Ask split-v6-b-recovery-evidenced-slice-2026-10-01
    acceptance_criteria:
      - "Per Decision 0051, deliberately split one Action across Sessions: Session A edits the candidate and exits incomplete without Git common-directory writes; Session B launches in the same worktree and branch, sees Session A changes and finishes; a concurrent second live execution against that candidate is refused; the next Action receives a fresh candidate from the new governed base; no operator branch, worktree, commit, stash, rebase or cleanup step occurs."
      - Turn Off during work; prove no later launch, preserved current output and visible terminal reconciliation. Close browser/restart worker and prove no duplicate or reactivation after Off.
      - Record exact revision, host, provider, Action/Session identities, receipts and every operator intervention; missing real authorization/input remains one precise review, never fixture-as-live success.
    depends_on: []
    decisions: []
    references: ["docs/reports/v6-two-action-evidence-assessment-2026-10-01.md"]
  - id: enroll-session-through-governed-host-request
    title: Add an idempotent protected enrollment request so any preliminary helper can obtain governed preparation or launch an assigned managed worker.
    status: done
    responsibility: agent
    effort: session
    next_action: Record the merged protected enrollment request (criteria 1-6) as done and keep criteria 7-9 (role attempt lineage, one mutation owner, serial three-Action selection) as a remainder Action.
    expected_artifact: Evidence satisfying Agent Ask enroll-session-through-governed-host-request
    clarification: clarified
    confidence: high
    source: Agent Ask split-enrollment-protected-request-from-attempt-lineage-2026-10-03
    acceptance_criteria:
      - A fixed host enrollment request resolves the configured workspace and exact governed Project/Plan/Action, canonical brief, required operator gates, packet provider/model/effort, and existing worktree claim; the request accepts no caller-supplied executable or arbitrary shell command.
      - An exact request replay returns its original prepared-principal or managed-Session receipt; changed Action, caller identity or mode under the same request id refuses before mutation.
      - Preparation returns the canonical candidate and fenced ownership receipt; a production launch reuses issueAdmission, commitAdmission and launchGuardedHostSession. Preliminary helper execution and prompt text establish no ownership, completion or production authority.
      - Concurrent enrollment, Off, stale policy epoch, unavailable capacity, missing packet approval and transport refusal leave no duplicate principal or orphan admission, claim or candidate; existing pending work remains recoverable.
      - Native durable adoption refuses with native_runtime_not_supervisable unless a host-observable adapter verifies stable identity, liveness, terminal outcome and recovery; the refusal supplies the supported managed-worker launch route.
      - Focused enrollment, admission and claim refusal/replay tests pass, followed by the repository's required checks; the operator guide and portable skill instructions explain how an unleased helper requests enrollment and proves success.
    depends_on: [persist-inactive-production-configuration]
    split_into: [wire-requirement-attempt-lineage-into-session-roles-and-tick]
    decisions: []
    references: ["src/goBroker.ts", "src/sessions/goRequestExecutor.ts", "src/sessions/launch.ts", "src/sessions/index.ts", "src/sessions/actionBrief.ts", "src/production/policy.ts", "docs/managed-production-readiness.md", ".arcadia/asks/archive/agent-ask-enroll-any-session-and-preserve-production-config-2026-10-02-v2.yaml", ".arcadia/asks/agent-ask-minimal-autonomous-managed-production-critical-path-2026-10-02.yaml", "src/production/tick.ts", "src/sessions/reconciliation.ts", "src/qa/prReview.ts", "src/sessions/candidatePreservation.ts", "src/production/sessionHandoff.ts", "docs/reports/three-action-managed-production-scope-design-2026-10-02.md"]
  - id: persist-inactive-production-configuration
    title: Persist exact inactive production configuration separately from revoked authority so /runs can preview a safe fresh activation after Off.
    status: done
    responsibility: agent
    effort: session
    next_action: Persist exact inactive production configuration separately from revoked authority so /runs can preview a safe fresh activation after Off.
    expected_artifact: Evidence satisfying Agent Ask persist-inactive-production-configuration
    clarification: clarified
    confidence: high
    source: Agent Ask enroll-any-session-and-preserve-production-config-2026-10-02-v2
    acceptance_criteria:
      - Off atomically revokes active authority and fences pending admissions while retaining separately labelled DB-owned configuration across worker and dashboard restart; a migration and named revision/fingerprint preserve its provenance.
      - The /runs On path previews the saved exact Project/Plan/Action/provider bounds and current effective concurrency, refuses stale policy/configuration revisions, and never re-derives scope.actions from a moved queue or pointer.
      - An authorized On transition records fresh activation authority and epoch; old fenced admissions stay fenced, committed work remains identifiable, and restart or duplicate toggles never launch a duplicate worker.
      - Consumed or expired integration Grants, rehearsal exceptions and packet delegation never revive. Missing current authority returns the exact actionable gate; any changed On delegation semantics remain inactive pending the required explicit Decision.
      - Effective production-worker concurrency remains one until the existing concurrency proof gate permits more; native helpers cannot bypass principal ownership or admission accounting.
      - Deterministic policy and dashboard tests cover absent configuration, migration, Off/On, consumed/expired grants, moved pointers, concurrent toggles, restart and in-flight work; required checks pass and the operator guide describes saved configuration separately from active permission.
    depends_on: []
    decisions: []
    references: ["src/production/policy.ts", "src/production/tick.ts", "apps/dashboard/app/api/production-control/route.ts", "apps/dashboard/lib/arcadia-cli.ts", "tests/managed-production-policy.test.ts", "tests/production-tick.test.ts", "docs/decisions/0072-decide-whether-the-standing-managed-production-grant-may-approve-the-build.md"]
  - id: repair-manual-preservation-snapshot-identity
    title: Bind manual preservation request identity to each immutable candidate snapshot while retaining idempotent unchanged retries and all exact authority and validation checks.
    status: done
    responsibility: agent
    effort: session
    next_action: Bind manual preservation request identity to each immutable candidate snapshot while retaining idempotent unchanged retries and all exact authority and validation checks.
    expected_artifact: Evidence satisfying Agent Ask repair-manual-preservation-snapshot-identity
    clarification: clarified
    confidence: high
    source: Agent Ask repair-manual-preservation-snapshot-identity-878-2026-10-02-v2
    acceptance_criteria:
      - The fixed no-argument protected preservation launcher successfully captures an initial manual candidate, then captures a revised candidate after a canonical governance commit plus documentation changes in the same reservation with a distinct request id and a distinct immutable preservation receipt.
      - An unchanged retry of either captured snapshot reuses that snapshot's request id and returns its original preservation outcome without creating a duplicate preservation commit or overwriting the earlier receipt.
      - Changed consequential inputs under a reused request id still refuse; reservation, Action, repository, branch, base, policy, validation-command and exact validated-tree bindings remain enforced, with no caller-supplied success assertion or preservation bypass.
      - Deterministic regression tests reproduce the two-capture failure sequence and cover identical retries, replay drift refusal, and recoverable failure or interrupted-attempt retry using the existing manual and candidate preservation architecture.
      - "The repair preserves manual local-only authority and the no-public-arguments launcher contract; it starts no managed Run and does not accept, integrate, complete or advance the interrupted PPN Action, alter PR #207's draft state, discard its pending files or mark Nagel verification complete."
      - Objective validation evidence covers the repair and regression tests, protected preservation records the final tested candidate, and a runnable handoff states the exact reviewed broker installation and same-worktree PPN resume procedure without exercising those downstream authority gates.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/878", "src/sessions/manualPreservation.ts", "src/sessions/candidatePreservation.ts", "tests/manual-preservation.test.ts", "tests/candidate-preservation.test.ts"]
  - id: fix-preserve-launcher-git-timeout-and-index-mutation
    title: Make fixed preservation never mutate the candidate's real index before the commit succeeds, and make any git timeout a typed, retryable, self-describing failure instead of a bare `spawnSync git ETIMEDOUT`.
    status: done
    responsibility: agent
    effort: session
    next_action: Make fixed preservation never mutate the candidate's real index before the commit succeeds, and make any git timeout a typed, retryable, self-describing failure instead of a bare `spawnSync git ETIMEDOUT`.
    expected_artifact: Evidence satisfying Agent Ask fix-preserve-launcher-git-timeout-and-index-mutation
    clarification: clarified
    confidence: high
    source: Agent Ask fix-preserve-launcher-git-timeout-889-2026-10-03
    acceptance_criteria:
      - A forced failure at `preserve.recheck-binding` (and every other stage before the commit) leaves the candidate's real index bytes, `git status --porcelain` output and `.git` locks exactly as they were, with no `index.lock` and no staged change; a successful preserve still ends with a clean status.
      - A git timeout in any preserve, binding or validation call (raw `execFileSync` in the snapshot code, `git()`, `tryGit`, `isAncestor`, `mergesCleanly`, `commitTreeAt`) raises a typed retryable error whose details name the git subcommand, arguments, working directory, timeout budget, stage and a retry remedy; it is never a bare `UNEXPECTED_ERROR`, "base branch could not be resolved" or "not a forward advance", and `tryGit` and `isAncestor` never turn a timeout into a negative answer.
      - The per-call git timeout is configurable and defaults below the stage idle limit, snapshot steps emit progress so a large candidate cannot trip the stage watchdog, retryable timeouts do not consume the identical-refusal budget, and a retry after a timeout reuses the same request id and creates exactly one preservation commit; the failed-attempt journal is documented as safe to retry.
      - Regression tests cover a hung-git shim at each stage, index-bytes-before-and-after equality, three consecutive timeouts not exhausting the refusal budget, and timeout-then-retry producing one commit; the notes and operator guidance describe the failure receipt and the separate reviewed broker reinstall that makes the fix live, with no install, restart or production action taken, and required checks pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/889", "src/sessions/candidatePreservation.ts", "src/sessions/candidateSnapshot.ts", "src/sessions/manualPreservation.ts", "src/sessions/preservationStages.ts", "src/sessions/preservationRefusalBudget.ts", "src/git/worktrees.ts", "tests/candidate-preservation.test.ts", "tests/manual-preservation.test.ts"]
  - id: resolve-agent-ask-draft-file-from-caller-worktree
    title: Resolve a relative agent-ask draft/preview --file from the caller's repository or worktree, never the main checkout.
    status: done
    responsibility: agent
    effort: session
    next_action: Resolve a relative agent-ask draft/preview --file from the caller's repository or worktree, never the main checkout.
    expected_artifact: Evidence satisfying Agent Ask resolve-agent-ask-draft-file-from-caller-worktree
    clarification: clarified
    confidence: high
    source: Agent Ask fix-governance-tooling-defects-884-887-2026-10-03
    acceptance_criteria:
      - A relative `--file` passed to `agent-ask draft` or `preview` from a linked candidate worktree is read from that worktree, validated and previewed as that exact file; the main checkout is untouched and nothing is copied into it.
      - A nonexistent path, a path or symlink resolving outside the caller's repository, and a reused request id with different content each fail closed with no read or write outside the caller's repository.
      - Regression tests drive the real CLI parser for the main checkout, a linked worktree and a different Project repository, and required checks pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/886", "src/cli.ts", "src/commands/agentAsk.ts", "tests/agent-ask-draft.test.ts"]
  - id: retire-legacy-operator-script-descriptors
    title: "Make `pnpm check:operator-scripts` pass on this host by retiring exactly the five named legacy descriptors through a hash-pinned, documented path, without weakening validation."
    status: done
    responsibility: agent
    effort: session
    next_action: "Make `pnpm check:operator-scripts` pass on this host by retiring exactly the five named legacy descriptors through a hash-pinned, documented path, without weakening validation."
    expected_artifact: Evidence satisfying Agent Ask retire-legacy-operator-script-descriptors
    clarification: clarified
    confidence: high
    source: Agent Ask fix-governance-tooling-defects-884-887-2026-10-03
    acceptance_criteria:
      - A tracked retirement manifest names exactly the five legacy descriptors with the sha256 of each descriptor and script and a stated reason; the checker skips an id only when both hashes match, so any new, renamed or changed file still gets full validation.
      - "`pnpm check:operator-scripts` against the live local library exits 0, and `validateOperatorScriptContract` and runtime settlement enforcement are unchanged; a new undeclared Agent Ask script, a retired id with different bytes and a Plan with a non-null target still fail."
      - No ignored local descriptor, script, run state or receipt is modified, deleted or moved; one-shot and repeatability behavior is unchanged; the retirement path is documented in the operator-actions guidance and covered by tests, and required checks pass.
    depends_on: [resolve-agent-ask-draft-file-from-caller-worktree]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/887", "scripts/check-operator-scripts.ts", "src/operatorActions/libraryContract.ts", "tests/operator-script-contract.test.ts", "docs/agent-guidance/operator-actions.md"]
  - id: bound-fixed-brief-broker-with-structured-receipt
    title: Make every fixed brief broker invocation return a bounded structured success or failure receipt instead of hanging.
    status: done
    responsibility: agent
    effort: session
    next_action: Make every fixed brief broker invocation return a bounded structured success or failure receipt instead of hanging.
    expected_artifact: Evidence satisfying Agent Ask bound-fixed-brief-broker-with-structured-receipt
    clarification: clarified
    confidence: high
    source: Agent Ask fix-governance-tooling-defects-884-887-2026-10-03
    acceptance_criteria:
      - "Every fixed brief invocation returns within a bounded deadline: the literal dispatch brief with its bytes and hash unchanged, or a structured failure on a single stream naming the stage, a correlation id and the safe recovery; a stalled dependency is reproduced in an integration test through the real entrypoint and kills the whole process group."
      - A healthy brief creates no claim, admission or dispatch telemetry and does not mutate the candidate; repeated calls and a worker restart neither hang nor duplicate telemetry, and a late child write after the deadline never produces a second receipt.
      - Installed-broker status proves the brief is usable rather than merely installed, the notes and operator guidance record the new failure receipt, and required checks pass.
    depends_on: [retire-legacy-operator-script-descriptors]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/885", "scripts/arcadia-go-broker.ts", "src/goBroker.ts", "src/commands/goBrokerInstall.ts", "tests/go-broker.test.ts", "tests/dispatch-journal.test.ts"]
  - id: recover-draft-only-never-launched-candidates
    title: Give Arcadia Go a host-owned, receipt-backed route that preserves and resumes a never-launched candidate holding only untracked Agent Ask drafts.
    status: done
    responsibility: agent
    effort: session
    next_action: Give Arcadia Go a host-owned, receipt-backed route that preserves and resumes a never-launched candidate holding only untracked Agent Ask drafts.
    expected_artifact: Evidence satisfying Agent Ask recover-draft-only-never-launched-candidates
    clarification: clarified
    confidence: high
    source: Agent Ask fix-governance-tooling-defects-884-887-2026-10-03
    acceptance_criteria:
      - Go distinguishes a draft-only linked candidate from a tracked or code-bearing one; every draft is preserved by exact sha256 and origin in an idempotent receipt before any resume or disposition, and no draft is settled, copied, moved or deleted.
      - A draft-only never-launched candidate resumes in the same worktree and branch with no duplicate claim or worktree; a draft naming another Project stays in place; one narrow operator disposition is exposed only when resuming is unsafe.
      - Tracked changes, non-Ask or unknown files, symlinks, renames, a changed hash and a concurrent Go attempt fail closed or converge on one receipt, recovery survives restart, the dispatch-launch path agrees with Go, and required checks pass.
    depends_on: [bound-fixed-brief-broker-with-structured-receipt]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/884", "src/commands/go.ts", "src/git/worktrees.ts", "src/sessions/launch.ts", "tests/go.test.ts"]
  - id: make-pr-review-verdict-truthful-for-current-head
    title: Fix the CodeRabbit loop and `arcadia pr code-review` so only a genuinely completed review of the current head can yield done or approved.
    status: done
    responsibility: agent
    effort: session
    next_action: Fix the CodeRabbit loop and `arcadia pr code-review` so only a genuinely completed review of the current head can yield done or approved.
    expected_artifact: Evidence satisfying Agent Ask make-pr-review-verdict-truthful-for-current-head
    clarification: clarified
    confidence: high
    source: Agent Ask queue-r1-truthful-current-head-review-2026-10-03
    acceptance_criteria:
      - Regression tests reproduce, before the fix, that a `Review paused` success status with an old APPROVED head and a `Review rate limited` success with no review each wrongly yield verdict done.
      - After the fix, paused or skipped success plus an old approval is not a completed review, and rate-limited success with no review is not a completed review.
      - A genuinely completed review without approval is reported as completed-not-approved, and a genuine approval of the exact current head by the actual reviewer identity is reported as approved; an approval of an earlier head never approves a changed head.
      - Unresolved review findings keep the verdict not done, and a push invalidates all earlier review evidence for that PR.
      - Decision 0060 and the exact-head independent review, QA and required-check gates are unchanged, and no gate, test or branch protection is weakened.
      - Show by test or code trace that the rehearsal and managed path consume the corrected classification, and state explicitly that installed verification is not claimed until the separate reviewed install.
    depends_on: []
    decisions: []
    references: []
  - id: reset-managed-preservation-timeout-history-on-success
    title: Route the managed tick's preserve call through the shared timeout guard so a success clears the consecutive timeout count.
    status: done
    responsibility: agent
    effort: session
    next_action: Route the managed tick's preserve call through the shared timeout guard so a success clears the consecutive timeout count.
    expected_artifact: Evidence satisfying Agent Ask reset-managed-preservation-timeout-history-on-success
    clarification: clarified
    confidence: high
    source: Agent Ask queue-r2-managed-preservation-timeout-reset-2026-10-03
    acceptance_criteria:
      - "A regression test reproduces, before the fix, that a managed tick timeout followed by a successful preservation leaves timeout:<session.id> uncleared."
      - After the fix, timeout then successful managed preservation then timeout counts the second timeout as the first consecutive one, while ten identical consecutive timeouts still stop automatic retries.
      - The managed tick and the CLI use one shared budget; index_locked is counted separately from timeouts, bounded retry behavior is unchanged and the stop condition is not weakened.
      - A malformed or live preservation lock yields a typed bounded error with preserved diagnostics instead of an unhandled exception.
      - The actual managed handoff is exercised in a temporary repository and its structured receipts are retained; the original candidate commits and index remain recoverable.
      - Merge and install are not claimed; the exact reviewed install step and host-path verification are named as the next gate.
    depends_on: []
    decisions: []
    references: []
  - id: clear-preservation-timeout-count-and-harden-index-lock-checks
    title: Make the managed-production tick count and clear preservation timeouts like the CLI path, and make the stale index.lock decision and its error code accurate.
    status: done
    responsibility: agent
    effort: session
    next_action: Make the managed-production tick count and clear preservation timeouts like the CLI path, and make the stale index.lock decision and its error code accurate.
    expected_artifact: Evidence satisfying Agent Ask clear-preservation-timeout-count-and-harden-index-lock-checks
    clarification: clarified
    confidence: high
    source: Agent Ask queue-review-gate-and-timeout-followups-896-908-2026-10-03
    acceptance_criteria:
      - The managed-production tick path (`src/production/sessionHandoff.ts`) counts preserve-stage timeouts toward the same identical-timeout cap as `arcadia preserve` and clears the count after a successful preservation, with a deterministic test that fails when either is removed.
      - "Stale `index.lock` removal no longer rests on mtime alone: a lock is removed only when it is older than the threshold and a fail-closed probe finds no process holding it open (an unreadable probe refuses with the typed retryable error); a directory lock, a symlinked lock and a dangling symlink raise the typed error instead of an untyped failure after the commit; tests cover each shape."
      - "`index_locked` has its own error code, is not counted against the timeout budget, and the cap message no longer suggests tuning the timeout for a locked index; notes and START_HERE describe it; lint, tsc and required checks pass."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/896", "src/production/sessionHandoff.ts", "src/sessions/candidatePreservation.ts", "src/sessions/preservationStages.ts", "src/sessions/preservationRefusalBudget.ts", "tests/preservation-git-timeout.test.ts"]
  - id: align-code-review-messages-with-advisory-coderabbit
    title: Make every runtime message and document agree that CodeRabbit is advisory under Decision 0080 and that main now has branch protection.
    status: done
    responsibility: agent
    effort: session
    next_action: Make every runtime message and document agree that CodeRabbit is advisory under Decision 0080 and that main now has branch protection.
    expected_artifact: Evidence satisfying Agent Ask align-code-review-messages-with-advisory-coderabbit
    clarification: clarified
    confidence: high
    source: Agent Ask queue-review-gate-and-timeout-followups-896-908-2026-10-03
    acceptance_criteria:
      - "`arcadia pr code-review` and its runtime messages (`src/stewardship/codeRabbitReview.ts`, `src/cli.ts`) no longer say a completed CodeRabbit review is required or to wait for a limit to reset; they say a rate limit or missing review never blocks a merge and that the independent review gate governs, with tests updated."
      - "The bootstrap names conflict-free base merges beside the governed-record commits; the PR procedure tells the reviewer to confirm the settle receipt id for an exempt commit and says branch protection on main now requires the seven CI jobs (lint, unit-1..4, dashboard, e2e); the regenerated AGENTS.md and guidance fingerprints agree and `check:agent-guidance` passes."
      - The CodeRabbit-dependent rehearsal text in `docs/managed-production-readiness.md` is revised so CodeRabbit is advisory rather than a required reviewer actor, with the independent review gate named; lint, tsc and required checks pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/908", "src/stewardship/codeRabbitReview.ts", "src/cli.ts", "docs/agent-guidance/pull-requests.md", "docs/agents-context.md", "docs/managed-production-readiness.md"]
  - id: restore-readiness-evidence-and-report-spoofed-coderabbit-status
    title: Undo two small wording regressions left by the advisory-CodeRabbit alignment.
    status: done
    responsibility: agent
    effort: session
    next_action: Undo two small wording regressions left by the advisory-CodeRabbit alignment.
    expected_artifact: Evidence satisfying Agent Ask restore-readiness-evidence-and-report-spoofed-coderabbit-status
    clarification: clarified
    confidence: high
    source: Agent Ask queue-followups-911-913-2026-10-03
    acceptance_criteria:
      - "`docs/managed-production-readiness.md` again carries the original historical sentence about what the read-only helpers and the adversary judged (the CodeRabbit-actor route), with a short 'as of Decision 0080' note after it saying the independent review gate now replaces that reviewer actor; no other claim in the document changes."
      - The `unverified_reporter` remedy in `src/stewardship/codeRabbitReview.ts` again tells the agent to check who posted the status named CodeRabbit and to report a possible spoof, while still saying the status is advisory and never blocks a merge; a test asserts both statements.
      - Verdict codes, error codes and the JSON shape of `arcadia pr code-review` are unchanged, and lint, tsc and required checks pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/911", "docs/managed-production-readiness.md", "src/stewardship/codeRabbitReview.ts", "tests/code-rabbit-review.test.ts"]
  - id: close-index-lock-probe-races-and-fd-matching-gaps
    title: "Close the three non-blocking gaps the independent review of PR #912 left in stale index.lock handling."
    status: done
    responsibility: agent
    effort: session
    next_action: "Close the three non-blocking gaps the independent review of PR #912 left in stale index.lock handling."
    expected_artifact: Evidence satisfying Agent Ask close-index-lock-probe-races-and-fd-matching-gaps
    clarification: clarified
    confidence: high
    source: Agent Ask queue-followups-911-913-2026-10-03
    acceptance_criteria:
      - Stale `index.lock` removal re-`lstat`s the lock and compares its `ino` and `mtimeMs` immediately before `rmSync` and refuses with the typed retryable error if either changed since the holder probes, with a deterministic test that swaps the lock between the probe and the removal.
      - The Linux `/proc/<pid>/fd` holder probe matches by device and inode via `stat` on each fd link rather than by path string (so bind mounts and mount namespaces cannot read as 'none'), keeping its fail-closed handling of unreadable pids, with tests using injected readers including a differing-path-same-inode case.
      - An `lsof` warning on stderr is carried into the typed error details so the operator can see why the answer was 'unknown'; the docs say plainly that the held-open probe covers only Git's brief write and non-Git holders and that an editor-based commit is protected only by the Git-cwd probe; lint, tsc and required checks pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/913", "src/sessions/candidatePreservation.ts", "src/sessions/worktreeLiveness.ts", "tests/preservation-index-lock.test.ts", "docs/working-copy-safety.md"]
  - id: wire-requirement-attempt-lineage-into-session-roles-and-tick
    title: Wire the persisted requirement/attempt lineage into the five fixed roles and the production tick so one mutation owner, serial dependency-ready selection and verdict invalidation hold end to end.
    status: done
    responsibility: agent
    effort: session
    next_action: Record the merged lineage wiring (one mutation owner, serial selection, verdict invalidation, restart and Off fencing) as done and keep the code-review verdict recorder as a remainder Action so unattended integration can proceed.
    expected_artifact: Evidence satisfying Agent Ask wire-requirement-attempt-lineage-into-session-roles-and-tick
    clarification: clarified
    confidence: high
    source: Agent Ask split-lineage-code-review-recorder-2026-10-03-v2
    acceptance_criteria:
      - Route only one mutation-owning principal; helpers are separately identified and read-only. Deterministic readiness precedes inference, and push/criteria/evidence changes invalidate dependent verdicts.
      - A three-Action Plan always selects only its next dependency-ready Action; restart resumes or reconciles its current attempt without duplication; Off fences a between-Action launch; independent review/QA cannot be supplied by the developer; focused migration/race/replay/restart/Off tests pass.
    depends_on: []
    split_into: [record-code-review-verdicts-for-unattended-integration]
    decisions: []
    references: ["src/sessions/enrollment.ts", "src/production/tick.ts", "src/sessions/launch.ts", "tests/rehearsal-three-action.test.ts", "docs/reports/three-action-managed-production-scope-design-2026-10-02.md", "https://github.com/pmark/arcadia/pull/917"]
  - id: record-code-review-verdicts-for-unattended-integration
    title: Give the host a governed way to record an exact-head independent code-review verdict so the production tick can integrate a managed candidate without an operator merge.
    status: done
    responsibility: agent
    effort: session
    next_action: Give the host a governed way to record an exact-head independent code-review verdict so the production tick can integrate a managed candidate without an operator merge.
    expected_artifact: Evidence satisfying Agent Ask record-code-review-verdicts-for-unattended-integration
    clarification: clarified
    confidence: high
    source: Agent Ask split-lineage-code-review-recorder-2026-10-03-v2
    acceptance_criteria:
      - Persist a requirement identity/input revision and distinct attempt ordinal/request ID for planner, critique, development, exact-head code review and independent QA. Transport replay returns the same receipt; an explicitly authorized retry after terminal failure atomically allocates the next bounded ordinal.
      - A host command or worker step records a passed or failed exact-head code-review verdict through beginIndependentVerdict/finishIndependentVerdict for a preserved managed candidate, refuses any developer-supplied or stale-head verdict, and the production tick then integrates a candidate with both current code-review and QA verdicts with no operator merge; the awaiting_independent_verdicts escalation clears; focused replay/stale/independence/Off tests and the three-Action rehearsal pass.
    depends_on: []
    decisions: []
    references: ["src/sessions/roleLineage.ts", "src/production/sessionHandoff.ts", "src/production/tick.ts", "src/qa/prReview.ts", "https://github.com/pmark/arcadia/pull/919"]
  - id: let-production-grant-request-remote-preservation
    title: Let an operator preview and activate a production Grant that requests remote candidate preservation, through the existing fingerprinted preview/activate path.
    status: done
    responsibility: agent
    effort: session
    next_action: Let an operator preview and activate a production Grant that requests remote candidate preservation, through the existing fingerprinted preview/activate path.
    expected_artifact: Evidence satisfying Agent Ask let-production-grant-request-remote-preservation
    clarification: clarified
    confidence: high
    source: Agent Ask unattended-rehearsal-blockers-remote-preservation-and-review-step-2026-10-04
    acceptance_criteria:
      - arcadia production preview and activate accept a remote-preservation option that sets scope.remotePreservation, shows it in the preview, status and receipt, and binds it into the scope fingerprint so an activation cannot differ from its preview; reactivation preserves it from the saved reviewed configuration.
      - An activation without the option leaves preservation local only; no other flag, environment variable or dashboard control can turn it on; and tests in tests/managed-production-policy.test.ts and the dashboard production-control contract cover the preview fingerprint, replay, Off clearing authority, and refusal without the option.
      - START_HERE.md and docs/managed-production-readiness.md document the option and that it authorizes only push and draft PR creation, not merge or marking a PR ready.
    depends_on: []
    decisions: []
    references: ["src/production/policy.ts", "src/commands/production.ts", "src/production/sessionHandoff.ts", "src/commands/preserve.ts"]
  - id: ready-pr-and-run-independent-reviews-from-the-tick
    title: After a managed candidate is preserved with a draft PR, have the production tick ready the PR, wait for its required checks, and run the independent code-review and QA host commands so integration needs no operator step.
    status: done
    responsibility: agent
    effort: session
    next_action: After a managed candidate is preserved with a draft PR, have the production tick ready the PR, wait for its required checks, and run the independent code-review and QA host commands so integration needs no operator step.
    expected_artifact: Evidence satisfying Agent Ask ready-pr-and-run-independent-reviews-from-the-tick
    clarification: clarified
    confidence: high
    source: Agent Ask unattended-rehearsal-blockers-remote-preservation-and-review-step-2026-10-04
    acceptance_criteria:
      - For an Action awaiting verdicts the tick (or worker step) marks the exact-head PR ready, waits a bounded time for required checks, then runs arcadia qa code-review and arcadia qa pr against that PR; every step is idempotent by request id, bounded by a retry budget that survives restart, fenced by Off and the policy epoch, and escalates with an accurate remedy when the budget, checks or reviewer capacity are exhausted.
      - The PR head is proven equal to the settled candidate head before verdicts are requested, with a hermetic assertion covering a settlement commit that lands after preservation; a head that moved never receives a verdict, and a failed verdict never integrates.
      - A hermetic three-Action rehearsal drives preserve, ready, both reviews and local fast-forward integration through the tick with only the GitHub CLI and reviewer model stubbed, with no operator step, the awaiting_independent_verdicts escalation clearing, Off fencing between Actions, and restart resuming mid-step without duplicate PR readiness or duplicate verdicts; GitHub-side merge and base push stay out of scope and are documented as such.
    depends_on: [let-production-grant-request-remote-preservation]
    decisions: []
    references: ["src/production/tick.ts", "src/production/sessionHandoff.ts", "src/qa/prReview.ts", "src/sessions/candidatePreservation.ts", "tests/rehearsal-three-action.test.ts", "docs/managed-production-readiness.md"]
  - id: prepare-three-action-rehearsal-operator-runbooks
    title: Prepare the bounded G1, G6, G7, and G8 operator-script pairs for the disposable three-Action rehearsal.
    status: done
    responsibility: agent
    effort: session
    next_action: Prepare the bounded G1, G6, G7, and G8 operator-script pairs for the disposable three-Action rehearsal.
    expected_artifact: Evidence satisfying Agent Ask prepare-three-action-rehearsal-operator-runbooks
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-three-action-rehearsal-operator-runbooks-2026-10-04
    acceptance_criteria:
      - A G1 paired operator descriptor and script accept one exact operator-supplied disposable private GitHub repository identifier, verify it is safe to create or reuse, create only the minimal CI/check-rollup fixture, import and sync one Project with Plan autonomous-three-action-rehearsal and serial Actions write-start-marker, transform-start-marker and verify-final-rehearsal, and never preview or activate production.
      - "A G6 paired preflight descriptor and script make only bounded observations: current production status/release, Claude worker-context token verdict without token disclosure, Codex capacity evidence, and explicitly authorized GitHub readiness; unknown, stale, paid, or unavailable evidence refuses with a receipt and no activation."
      - A fresh G7 paired descriptor and script run the hermetic three-Action rehearsal check before a current-revision production preview and one-shot activation; they bind the exact fixture, provider, concurrency one, packet approval expiry, --remote-preservation, and an unexpired Decision 0058 integration Grant naming each Action, and state that they authorize only the reviewed scope, draft preservation, readiness/review integration where the Grant permits, never GitHub merge or base push.
      - "A G8 paired descriptor and script use only the reviewed host-service path to restore and prove terminal Off: an inactive receipt, zero live admissions and leases across repeated observations, preserved/reconciled committed work, a restart receipt, and an intervention ledger; they never kill a raw PID or discard a candidate."
      - The pairs have bounded waits, fail-closed preconditions, timestamped receipts and failure handoffs, pass the operator-script checker and focused three-Action/preflight tests, and are independently reviewed at their frozen head before publication; unrelated existing library failures are retained as named blockers rather than weakened or hidden.
    depends_on: []
    decisions: []
    references: ["docs/reports/three-action-managed-production-scope-design-2026-10-02.md", "docs/managed-production-readiness.md", "docs/agent-guidance/operator-actions.md", "tests/rehearsal-three-action.test.ts", "tests/grant-rehearsal-preflight.test.ts", "https://github.com/pmark/arcadia/issues/899", "https://github.com/pmark/arcadia/issues/923", "https://github.com/pmark/arcadia/issues/925"]
  - id: normalize-check-contexts-in-review-readiness
    title: Normalize every pull-request check entry (CheckRun and StatusContext) before classification at every call site, and make advisory bot contexts never gate readiness.
    status: done
    responsibility: agent
    effort: session
    next_action: Normalize every pull-request check entry (CheckRun and StatusContext) before classification at every call site, and make advisory bot contexts never gate readiness.
    expected_artifact: Evidence satisfying Agent Ask normalize-check-contexts-in-review-readiness
    clarification: clarified
    confidence: high
    source: Agent Ask normalize-check-contexts-in-review-readiness-2026-10-04
    acceptance_criteria:
      - "classifyPullRequestChecks and every caller (the tick's independent review step, assertPullRequestReadyForQa and evaluateDeterministicEvidence) pass the statusCheckRollup through the existing normalizeCheck (src/workMonitoring/pullRequests.ts) or one shared normalizer, so a StatusContext entry (context, state, targetUrl, description) is read by its real state: SUCCESS passes; PENDING and EXPECTED wait; FAILURE and ERROR block; and an unrecognised entry shape is reported by name as unknown rather than silently pending."
      - The CodeRabbit context is treated as advisory under Decision 0080 and never gates readiness, whatever its state (including rate limited, pending or failed), while every other check, including required GitHub Actions jobs, still gates exactly as before; the exemption is one named list with a test and a docs line, not a general bypass.
      - "Tests use real payload shapes captured from this repository's pull requests (a CheckRun-only list, a CheckRun plus CodeRabbit StatusContext list, a pending StatusContext, a failed non-advisory StatusContext, an empty list) through classifyPullRequestChecks, the tick step in tests/tick-independent-review.test.ts, and qa pr readiness; the empty-rollup refusal is unchanged; focused suites, lint, tsc, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/qa/prReview.ts", "src/production/independentReview.ts", "src/workMonitoring/pullRequests.ts", "tests/tick-independent-review.test.ts", "tests/qa-pr-review.test.ts", "https://github.com/pmark/arcadia/issues/899"]
  - id: fix-rehearsal-g1-plan-and-operator-guidance
    title: Make G1 validate its generated fixture with Arcadia's own discovery before any external mutation, fix the invalid Plan line, and put the inline-workspace requirement where the operator reads it.
    status: done
    responsibility: agent
    effort: session
    next_action: Make G1 validate its generated fixture with Arcadia's own discovery before any external mutation, fix the invalid Plan line, and put the inline-workspace requirement where the operator reads it.
    expected_artifact: Evidence satisfying Agent Ask fix-rehearsal-g1-plan-and-operator-guidance
    clarification: clarified
    confidence: high
    source: Agent Ask fix-rehearsal-g1-plan-and-operator-guidance-2026-10-04
    acceptance_criteria:
      - G1 renders the fixture Plan and runs Arcadia's real discovery/validation (the same code docs sync uses, with zero errors and Actions write-start-marker, transform-start-marker and verify-final-rehearsal resolving serially by depends_on) in a scratch directory BEFORE gh repo create, any push, project import or manifest write; an invalid generated fixture refuses with a receipt and failure handoff having made no external mutation; the acceptance-criterion line is valid YAML.
      - A regression test generates the fixture from the script's own heredocs and runs the real discoverDocs/docs-sync validation on it (no faked errorCount), and fails on the pre-fix script; it also asserts G1 refuses before any create, push or import when the generated Plan is invalid, and that a half-registered earlier attempt is reported with an exact recovery instruction rather than a silent refusal.
      - "G1's next-step text, its descriptor, START_HERE.md and the recover-arcadia-host-services descriptor state that recovery must be run with ARCADIA_WORKSPACE=/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover inline (never exported in the shell, because exporting makes the other scripts refuse), and give the exact command; the cosmetic G6 defects (double 'none' after an HTTP error; a codex availability check that cannot fail) are fixed with tests; pnpm check:operator-scripts, the focused operator-script tests, lint, tsc, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/prepare-three-action-rehearsal-fixture-2026-10-04.sh", "artifacts/generated/operator-scripts/preflight-three-action-rehearsal-2026-10-04.sh", "tests/three-action-rehearsal-operator-scripts.test.ts", "START_HERE.md", "https://github.com/pmark/arcadia/issues/899"]
  - id: close-completed-board-mirrors
    title: In src/scheduling/github.ts, close the mirror Issue for a governed Action that leaves the scheduled set with status done, matched by its stored githubIssueNumber/githubIssueUrl, idempotently.
    status: open
    responsibility: agent
    effort: session
    next_action: In src/scheduling/github.ts, close the mirror Issue for a governed Action that leaves the scheduled set with status done, matched by its stored githubIssueNumber/githubIssueUrl, idempotently.
    expected_artifact: Evidence satisfying Agent Ask close-completed-board-mirrors
    clarification: clarified
    confidence: high
    source: Agent Ask close-completed-board-mirror-issues-2026-10-04
    acceptance_criteria:
      - When a scheduled Action transitions to done (or otherwise leaves the scheduled set completed), reconcileBoard closes its mirror Issue matched by the Action's stored githubIssueNumber/githubIssueUrl, not by rediscovering it.
      - "Closing is idempotent: when the mirror Issue is already closed, a re-projection issues no close call and does not error; a projection with no completed Actions is unchanged."
      - A deterministic test with a stubbed board drives create -> done and asserts exactly one close, then re-projects and asserts a no-op; it also asserts an open Action's mirror is never closed.
      - The behavior is documented in src/scheduling/github.ts and does not change Issue creation or status/push projection for live Actions.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["src/scheduling/github.ts", "docs/decisions/0055-log-defects-with-github-issues.md", "https://github.com/pmark/arcadia/issues/490"]
  - id: fix-decision-approve-resolution-body
    title: "`arcadia decision approve` replaces the body's `## Resolution` placeholder (`Open.`) with the recorded answer, so the document never reads approved in frontmatter while the prose says Open."
    status: open
    responsibility: agent
    effort: session
    next_action: "`arcadia decision approve` replaces the body's `## Resolution` placeholder (`Open.`) with the recorded answer, so the document never reads approved in frontmatter while the prose says Open."
    expected_artifact: Evidence satisfying Agent Ask fix-decision-approve-resolution-body
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - "After approving a Decision, its body's `## Resolution` section contains the recorded answer text (or a one-line pointer to it) and no longer contains the literal `Open.`."
      - "`--dry-run` still writes nothing, and re-approving or reverse leaves the body in a consistent state."
      - A deterministic test approves a `decision new` document and asserts the body changed with the answer and no longer reads `Open.`.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["src/commands/decision.ts", "https://github.com/pmark/arcadia/issues/746"]
  - id: fix-tidy-torn-tail-byte-offset
    title: "`repairTornTail` in `src/git/quarantine.ts` truncates the journal at a byte offset, not a UTF-16 string index."
    status: open
    responsibility: agent
    effort: session
    next_action: "`repairTornTail` in `src/git/quarantine.ts` truncates the journal at a byte offset, not a UTF-16 string index."
    expected_artifact: Evidence satisfying Agent Ask fix-tidy-torn-tail-byte-offset
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - "`repairTornTail` derives the truncation offset from a byte-accurate measure (Buffer/`Buffer.byteLength`) so a multi-byte character before the torn tail never causes `ftruncateSync` to cut mid-character or leave a torn tail."
      - A deterministic test writes a journal whose last complete line contains a multi-byte character, tears the tail, repairs it, and asserts the repaired file is valid UTF-8 and ends at a newline.
      - Existing journal recovery and tidy behavior is unchanged; `pnpm test` passes.
    depends_on: []
    decisions: []
    references: ["src/git/quarantine.ts", "https://github.com/pmark/arcadia/issues/749"]
  - id: narrow-db-write-transactions-across-fs-calls
    title: Workspace write transactions in the hot paths no longer hold the SQLite write lock across local filesystem calls.
    status: open
    responsibility: agent
    effort: session
    next_action: Workspace write transactions in the hot paths no longer hold the SQLite write lock across local filesystem calls.
    expected_artifact: Evidence satisfying Agent Ask narrow-db-write-transactions-across-fs-calls
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - The write transactions named by the `tests/db-contention.test.ts` measurement perform their filesystem reads/writes outside the transaction, or hold the lock only for the database mutation, so a slow disk or network mount cannot block every other writer.
      - A measured assertion or documented receipt shows the transaction lock hold no longer scales with filesystem latency.
      - Concurrency and correctness tests (`pnpm test`) pass; no lost update is introduced.
    depends_on: []
    decisions: []
    references: ["src/db/connection.ts", "tests/db-contention.test.ts", "https://github.com/pmark/arcadia/issues/757"]
  - id: allow-manual-preservation-first-binding-after-base-advance
    title: Manual preservation can create its first binding after a clean base advance when the old base is an ancestor of the new base and the candidate merges cleanly.
    status: open
    responsibility: agent
    effort: session
    next_action: Manual preservation can create its first binding after a clean base advance when the old base is an ancestor of the new base and the candidate merges cleanly.
    expected_artifact: Evidence satisfying Agent Ask allow-manual-preservation-first-binding-after-base-advance
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - A reserved manual candidate whose first binding was delayed until after the governed base advanced can be preserved when the prepared base is an ancestor of the current base and the merge is clean; the binding records the actual merge base.
      - The existing refusal for diverged or conflicting history is preserved; a genuinely incompatible candidate still refuses with a named reason.
      - A deterministic test advances the base between reservation and first binding and asserts preservation succeeds and produces a validation receipt.
      - "`pnpm test` and the core, Discord and Dashboard builds pass."
    depends_on: []
    decisions: []
    references: ["src/sessions/manualPreservation.ts", "https://github.com/pmark/arcadia/issues/811"]
  - id: report-missing-validation-commands-in-broker-readiness
    title: "`go-broker status` reports not-ready when manual preservation has no `validation_commands`, matching the guaranteed refusal, instead of reporting ready."
    status: open
    responsibility: agent
    effort: session
    next_action: "`go-broker status` reports not-ready when manual preservation has no `validation_commands`, matching the guaranteed refusal, instead of reporting ready."
    expected_artifact: Evidence satisfying Agent Ask report-missing-validation-commands-in-broker-readiness
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - Broker readiness surfaces a named `validation_commands` prerequisite when manual preservation is enabled but no host-configured objective commands exist, consistent with `readPreservationChecksStatus`.
      - A deterministic test configures manual preservation without validation commands and asserts readiness is false with a remedy naming the missing commands.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/commands/goBrokerInstall.ts", "src/sessions/manualPreservation.ts", "https://github.com/pmark/arcadia/issues/813"]
  - id: keep-inactive-plan-acceptance-fingerprint-stable
    title: Accepting an inactive draft Plan is not refused by unrelated portfolio queue movement, since the acceptance changes no pointer, dispatch authority, or queue state.
    status: open
    responsibility: agent
    effort: session
    next_action: Accepting an inactive draft Plan is not refused by unrelated portfolio queue movement, since the acceptance changes no pointer, dispatch authority, or queue state.
    expected_artifact: Evidence satisfying Agent Ask keep-inactive-plan-acceptance-fingerprint-stable
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - The acceptance fingerprint for an inactive Plan hashes only the state the acceptance actually depends on, so unrelated queue revisions do not expire it; the apply still refuses if the Plan or its own inputs changed.
      - A deterministic test accepts an inactive Plan after unrelated queue movement and asserts success; a test that mutates the Plan's own content still refuses.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/docs/operatorGate.ts", "https://github.com/pmark/arcadia/issues/823"]
  - id: support-action-deferral-via-agent-ask
    title: An Agent Ask can create an actionable Action deferral (the effect is accepted and the target Action resolved), so deferring an Action is a governed, phone-friendly operation.
    status: open
    responsibility: agent
    effort: session
    next_action: An Agent Ask can create an actionable Action deferral (the effect is accepted and the target Action resolved), so deferring an Action is a governed, phone-friendly operation.
    expected_artifact: Evidence satisfying Agent Ask support-action-deferral-via-agent-ask
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - "An Agent Ask whose effect is `defer` with a `target_ref` naming an Action is accepted, applies `status: deferred`, and advances the governed pointer as `decision approve` does; it is rejected only for a genuinely unsupported combination."
      - The preview matches the applied effect, and a replayed settlement is idempotent.
      - A deterministic test previews and applies an Action deferral and asserts the Action is deferred and the pointer advanced.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/ask/agentAsk.ts", "src/ask/settlement.ts", "docs/agent-guidance/agent-asks.md", "https://github.com/pmark/arcadia/issues/844"]
  - id: diagnose-manual-preservation-response-budget-timeout
    title: A manual preservation that exhausts its response budget without a receipt or named failure produces a durable diagnosis and is not silently retried forever.
    status: open
    responsibility: agent
    effort: session
    next_action: A manual preservation that exhausts its response budget without a receipt or named failure produces a durable diagnosis and is not silently retried forever.
    expected_artifact: Evidence satisfying Agent Ask diagnose-manual-preservation-response-budget-timeout
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - When the preservation broker exhausts its response budget, the requester records a durable refusal naming the budget, the transport freshness, and the host-claim state, rather than leaving no evidence.
      - An identical subsequent request does not repeat the same silent timeout; a retry requires a changed input or an explicit operator action.
      - A deterministic test drives a budget exhaustion and asserts a durable evidence artifact and a single bounded retry behavior.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/sessions/manualPreservation.ts", "src/sessions/preservationTransport.ts", "https://github.com/pmark/arcadia/issues/848"]
  - id: withdraw-superseded-847-activation-asks
    title: "Superseded #847 activation Ask inputs are withdrawn so stale Grant choices cannot resurface, while the live v3 scope is preserved."
    status: open
    responsibility: agent
    effort: session
    next_action: "Superseded #847 activation Ask inputs are withdrawn so stale Grant choices cannot resurface, while the live v3 scope is preserved."
    expected_artifact: Evidence satisfying Agent Ask withdraw-superseded-847-activation-asks
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - The superseded `agent-ask-activate-scoped-container-audit-847-*.yaml` inputs are removed from the active scan directory (archived or deleted) so they cannot surface a stale Grant choice; the live v3 scope settled into Decision 0079 is untouched.
      - A scan of the ask directory surfaces exactly the current activation input.
      - The change is recorded so the withdrawal is auditable.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/875", "docs/decisions/0079-decide-whether-to-activate-exactly-one-bounded-docker-host-audit-of-the.md"]
  - id: silence-sandbox-certificate-copy-errors
    title: Every `arcadia`/`mise` invocation in a Claude Code sandbox stops printing repeated 'failed to copy trust settings' lines to stderr.
    status: open
    responsibility: agent
    effort: session
    next_action: Every `arcadia`/`mise` invocation in a Claude Code sandbox stops printing repeated 'failed to copy trust settings' lines to stderr.
    expected_artifact: Evidence satisfying Agent Ask silence-sandbox-certificate-copy-errors
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - The `security`/certificate step is guarded so a sandbox-denied trust-settings copy is suppressed or emitted once at a debug level, without hiding real errors; `arcadia ... --json` stdout stays clean.
      - "A test or documented receipt in the sandboxed environment shows `ok: true` with no repeated stderr noise."
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/cli.ts", "scripts/", "https://github.com/pmark/arcadia/issues/890"]
  - id: preserve-global-agent-defaults-in-go-install
    title: "`arcadia go-broker install` provides its named `arcadia-unattended` profile without changing the operator's ordinary global Codex/Claude defaults."
    status: open
    responsibility: agent
    effort: session
    next_action: "`arcadia go-broker install` provides its named `arcadia-unattended` profile without changing the operator's ordinary global Codex/Claude defaults."
    expected_artifact: Evidence satisfying Agent Ask preserve-global-agent-defaults-in-go-install
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - Install no longer writes the restricted profile as the global Codex default; readiness resolves the named profile explicitly instead of depending on a global selection.
      - A deterministic test installs against a home with existing interactive defaults and asserts those defaults are preserved while the named profile is available.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/agentSetup/goBrokerAgentSetup.ts", "https://github.com/pmark/arcadia/issues/927"]
  - id: stabilize-flaky-test-suite
    title: "Remove the remaining test-suite flakiness: Playwright mission-control flakes, decision-deferral teardown ENOTEMPTY, the completion-pointer fault-matrix timeout, the Corepack/undici install crash, and the CLI missing-workspace resolution."
    status: open
    responsibility: agent
    effort: session
    next_action: "Remove the remaining test-suite flakiness: Playwright mission-control flakes, decision-deferral teardown ENOTEMPTY, the completion-pointer fault-matrix timeout, the Corepack/undici install crash, and the CLI missing-workspace resolution."
    expected_artifact: Evidence satisfying Agent Ask stabilize-flaky-test-suite
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - "Each named flake (#765 Playwright mission-control; #766 decision-deferral ENOTEMPTY; #768 completion-pointer 300s timeout; #778 Corepack/undici assert; #831 CLI missing-workspace workspace resolution) is reproduced deterministically or fixed by a targeted change, with the fix named per issue."
      - A full `pnpm test` and the e2e job pass repeatedly on a loaded host without reruns.
      - No test timeout is raised merely to mask a real hang; any timeout change cites the issue.
    depends_on: []
    decisions: []
    references: ["vitest.config.ts", "tests/", "https://github.com/pmark/arcadia/issues/765", "https://github.com/pmark/arcadia/issues/766", "https://github.com/pmark/arcadia/issues/768", "https://github.com/pmark/arcadia/issues/778", "https://github.com/pmark/arcadia/issues/831"]
  - id: resolve-merged-pr-review-followups
    title: "Resolve the non-blocking review follow-ups carried from merged PRs #912/#915/#917/#920/#922/#932: #916, #918, #921, #930, #933."
    status: open
    responsibility: agent
    effort: session
    next_action: "Resolve the non-blocking review follow-ups carried from merged PRs #912/#915/#917/#920/#922/#932: #916, #918, #921, #930, #933."
    expected_artifact: Evidence satisfying Agent Ask resolve-merged-pr-review-followups
    clarification: clarified
    confidence: high
    source: Agent Ask govern-backlog-fixes-and-batches-2026-10-04
    acceptance_criteria:
      - "Each of #916, #918, #921, #930 and #933 is either fixed with a test/doc change or explicitly declined with a reason, and the choice is recorded on the Issue."
      - "#921's receipt-vs-verdict race (concurrent `qa code-review` runs) is fixed so the gate cannot see pass while a later call returns a fail receipt."
      - Fixes for the named call sites ship with focused tests where the note identified a testable behavior.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/916", "https://github.com/pmark/arcadia/issues/918", "https://github.com/pmark/arcadia/issues/921", "https://github.com/pmark/arcadia/issues/930", "https://github.com/pmark/arcadia/issues/933"]
  - id: code-review-not-applicable-criteria
    title: Add a not-applicable criterion status for the code-review role, bounded so it cannot weaken real review, and teach the reviewer prompt about governed records.
    status: done
    responsibility: agent
    effort: session
    next_action: Add a not-applicable criterion status for the code-review role, bounded so it cannot weaken real review, and teach the reviewer prompt about governed records.
    expected_artifact: Evidence satisfying Agent Ask code-review-not-applicable-criteria
    clarification: clarified
    confidence: high
    source: Agent Ask code-review-not-applicable-criteria-2026-10-04
    acceptance_criteria:
      - The reviewer schema, parser, receipts, lineage binding and persisted-receipt reading accept a not-applicable check status that is non-blocking only when it carries concrete evidence that the change cannot affect that criterion; the correctness criterion can never be not-applicable; a deterministic check on the files the patch touches refuses not-applicable for a criterion the patch demonstrably affects (for example failure handling, state, security or compatibility claimed not-applicable on a diff that changes executable code, configuration, or authority-bearing documents); an all-not-applicable-but-correctness verdict on a marker/docs-only patch passes, and not-checked still blocks as needs-follow-up.
      - The reviewer prompt distinguishes not-applicable (the change cannot affect the criterion) from not-checked (the change affects it but the evidence cannot show it), and states that commits carrying Arcadia-Preservation-Request or Arcadia-Candidate-Fingerprint trailers or a 'Written by arcadia agent-ask settle' body are governed records to judge only for consistency with the stated Action, not for how they were generated; qa pr's own role is unchanged except for any shared schema.
      - "Tests use the real captured result from the rehearsal (the exact patch and model verdict for PR #1 head 58bcd9155: five not-checked criteria, zero findings) as a fixture, plus a pass/fail matrix (marker-only patch passes with all-not-applicable-but-correctness; not-applicable on a changed executable file is refused; missing evidence text is refused; a real finding still fails), the hermetic three-Action tick rehearsal with a marker-only candidate integrates without an operator step, and persisted receipts from before this change still read; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/qa/prReview.ts", "src/sessions/roleLineage.ts", "src/production/independentReview.ts", "tests/code-review-verdict-recorder.test.ts", "tests/qa-pr-review.test.ts", "tests/rehearsal-three-action.test.ts", "https://github.com/pmark/arcadia/issues/899"]
  - id: code-review-not-applicable-naming
    title: Stop refusing honest not-applicable claims for generic wording while the deterministic classifier still decides applicability, and tell the model to name files.
    status: done
    responsibility: agent
    effort: session
    next_action: Stop refusing honest not-applicable claims for generic wording while the deterministic classifier still decides applicability, and tell the model to name files.
    expected_artifact: Evidence satisfying Agent Ask code-review-not-applicable-naming
    clarification: clarified
    confidence: high
    source: Agent Ask code-review-not-applicable-naming-2026-10-04
    acceptance_criteria:
      - "The per-claim 'names a touched file' check is replaced by a verdict-level rule: the not-applicable claims are accepted only if every claim's evidence is substantive (existing length rule) and at least one not-applicable claim names a touched file path or basename (or, for a docs-only patch, the review summary names one); the deterministic per-file classification of the patch remains the sole decision on whether a claim can be accepted, every refusal for touched executable, configuration, authority or unknown files is unchanged, and correctness is still never not-applicable."
      - "The code-review prompt's not-applicable rule tells the model that each not-applicable check's own evidence should name every touched file by exact path (for example MARKER.md, PROJECT.md) and must not refer to files only generically ('all touched files', 'the marker', 'governed records'); tests lock the new rule and keep all of #934's refusal tests passing."
      - "A regression test uses the real model-verdict from the live smoke (five not-applicable claims where state-and-concurrency, security-and-authority and tests evidence names no file, copied from the smoke's out-exact receipt under /private/tmp/claude-501/-Users-pmark-Dev-MR-Arcadia-arcadia/8b3c388d-2a2c-4a1b-bfb8-165c1289534c/scratchpad/na-smoke/) and shows it now derives to pass on the captured patch while a code, workflow, config or docs/ patch with the same wording is still refused; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/qa/prReview.ts", "src/qa/patchApplicability.ts", "tests/code-review-not-applicable.test.ts", "tests/fixtures/rehearsal-code-review/", "https://github.com/pmark/arcadia/issues/899"]
  - id: code-review-tests-criterion-stability
    title: Tell the code reviewer how to judge the Tests criterion when a patch contains no executable code and no test files, and pin the stability with a live measurement.
    status: done
    responsibility: agent
    effort: session
    next_action: Tell the code reviewer how to judge the Tests criterion when a patch contains no executable code and no test files, and pin the stability with a live measurement.
    expected_artifact: Evidence satisfying Agent Ask code-review-tests-criterion-stability
    clarification: clarified
    confidence: high
    source: Agent Ask code-review-tests-criterion-stability-2026-10-04
    acceptance_criteria:
      - "The code-review prompt's rule for the Tests criterion states that when the patch touches no executable or test files the Tests criterion is not-applicable (with evidence naming the touched files) rather than pass or not-checked, that a successful required CI check named in the evidence counts as concrete validation evidence for a patch that does change code, and that missing CI command output alone is never a reason for not-checked or a finding on a patch that adds no executable behavior; QA's prompt and every deterministic classifier rule are unchanged and the #934 and #935 refusal tests still pass."
      - Tests lock the new prompt sentences and show that the deterministic gate still refuses a Tests not-applicable claim on a patch that touches an executable or test file.
      - "A live measurement with the real codex reviewer on the exact captured rehearsal patch (at least five runs, recorded in the PR with per-run verdicts and Tests statuses; stubbing only gh as the earlier smokes did) shows at least four of five pass with no medium or higher finding, a code-change control still does not pass, and the numbers and receipt paths are in the pull request body; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/qa/prReview.ts", "tests/code-review-not-applicable.test.ts", "/private/tmp/claude-501/-Users-pmark-Dev-MR-Arcadia-arcadia/8b3c388d-2a2c-4a1b-bfb8-165c1289534c/scratchpad/na-smoke-935/", "https://github.com/pmark/arcadia/issues/899"]
  - id: define-agent-peer-watch-contract
    title: "Write the agent-agnostic peer-watch contract: what evidence each agent publishes, how stalls and exhaustion are classified, and how takeover is requested without stealing ownership."
    status: done
    responsibility: agent
    effort: session
    next_action: "Write the agent-agnostic peer-watch contract: what evidence each agent publishes, how stalls and exhaustion are classified, and how takeover is requested without stealing ownership."
    expected_artifact: Evidence satisfying Agent Ask define-agent-peer-watch-contract
    clarification: clarified
    confidence: high
    source: Agent Ask agent-peer-watch-2026-10-04
    acceptance_criteria:
      - "A checked-in contract (docs/agent-guidance/ procedure registered in index.json plus a typed schema in code) defines the evidence an agent publishes and a watcher reads, using only channels every supported agent already has: Git commits on its candidate branch (a machine-readable trailer such as Arcadia-Agent, Arcadia-Action and Arcadia-Heartbeat on commits and on an optional empty heartbeat commit), GitHub issue comments on the coordination issue (one fenced machine-readable block per comment), the existing session/lease rows, and the coding-agent capacity telemetry; it names which of these each of Claude Code, Codex and OpenCode can produce today."
      - The contract classifies each watched agent as healthy, idle, stalled, exhausted (out of tokens or capacity), or unknown from that evidence with explicit freshness windows, and states in code and prose that a coding turn ending, a missing process, a preserved local head, or silence alone is never proof of released ownership; takeover is requested through the existing claim/ownership recovery with the old principal proven terminal or released, and a watcher may only offer help, escalate to the operator, or continue work the owner has released.
      - Tests cover the schema, trailer and comment-block parsing with malformed, forged and stale input, the classification table including the 2026-10-03 enrollment-collision case (turn ended, no process, local head preserved, orchestrator still owning) classified as not released, and the agent-guidance index and fingerprint checks pass.
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/index.json", "docs/agent-guidance/continuation.md", "src/codingAgents/capacity.ts", "src/sessions/", "https://github.com/pmark/arcadia/issues/899"]
  - id: implement-agent-peer-watch-reader
    title: Build the deterministic read-only watcher that gathers peer evidence and reports each agent's state.
    status: open
    responsibility: agent
    effort: session
    next_action: Build the deterministic read-only watcher that gathers peer evidence and reports each agent's state.
    expected_artifact: Evidence satisfying Agent Ask implement-agent-peer-watch-reader
    clarification: clarified
    confidence: high
    source: Agent Ask agent-comms-role-v2-2026-10-04
    acceptance_criteria:
      - A read-only command (for example arcadia agents watch) gathers the contract's evidence for every agent with an active claim, candidate or lease (candidate branch commits and their trailers, issue comments on a named coordination issue via the GitHub CLI with bounded polling and rate-limit awareness, session and lease rows, capacity telemetry), classifies each agent per the contract, and prints a typed status with the evidence and its age; it never mutates the workspace, repositories or GitHub, and unknown or unreadable evidence is reported as unknown, not healthy.
      - "The production tick and the operator surfaces that already show escalations consume the classification: a stalled or exhausted owner of the current Action raises a deduplicated operator escalation with an accurate remedy, and nothing is dispatched to or taken from the owner."
      - "Hermetic tests with fake Git history, fake issue comments and capacity fixtures cover healthy, idle, stalled, exhausted and unknown agents, forged or stale heartbeats, GitHub rate limiting, and the 2026-10-03 collision; focused suites, lint, tsc, build, check:agent-guidance and the preservation self-check pass."
      - The command offers a blocking event mode (for example `arcadia agents watch --until-event --since <watermark>`) that exits with one typed JSON event when a comment from another signature newer than the watermark arrives on the named coordination Issue, a watched agent's classification changes or an escalation is raised, so a Comms session waits in a shell rather than in a model turn; hermetic tests cover each event kind, watermark replay and the self-signature filter.
    depends_on: [define-agent-peer-watch-contract]
    decisions: []
    references: ["src/production/tick.ts", "src/commands/workMonitor.ts", "src/codingAgents/capacity.ts"]
  - id: publish-agent-peer-heartbeats-and-offers
    title: Have agents publish heartbeats and peers post help offers through commits and issue comments, only under an explicit operator Decision.
    status: open
    responsibility: agent
    effort: session
    next_action: Have agents publish heartbeats and peers post help offers through commits and issue comments, only under an explicit operator Decision.
    expected_artifact: Evidence satisfying Agent Ask publish-agent-peer-heartbeats-and-offers
    clarification: clarified
    confidence: high
    source: Agent Ask agent-peer-watch-2026-10-04
    acceptance_criteria:
      - Agent launch and exit paths add the contract's trailers to commits the agent already makes and can emit one bounded heartbeat (an empty commit or a fenced issue-comment block) at a finite interval while a Session is live, and a peer's watcher can read those heartbeats; no heartbeat is posted unless the owner's candidate is live.
      - Posting a heartbeat or help offer to GitHub is gated by an explicit operator Decision naming the repository and issue, a request-id replay guard, a rate budget and an Off fence; without the Decision the same text is written as a local draft only, never posted; an offer carries the observed evidence and the exact claim-release request a peer would need, and never takes over a claim.
      - "Hermetic tests cover trailer injection on real commits, the heartbeat interval and rate budget, the Decision gate, replay, Off, a forged peer comment being ignored, and a handoff offer accepted by the owner through the existing claim-release path; focused suites, lint, tsc, build and check:agent-guidance pass."
    depends_on: [implement-agent-peer-watch-reader]
    decisions: []
    references: ["src/sessions/launch.ts", "src/sessions/reconciliation.ts", "docs/agent-guidance/pull-requests.md"]
  - id: enroll-opencode-in-agent-peer-watch
    title: Make OpenCode a full participant in peer watch through the same Git and issue-comment channels.
    status: open
    responsibility: agent
    effort: session
    next_action: Make OpenCode a full participant in peer watch through the same Git and issue-comment channels.
    expected_artifact: Evidence satisfying Agent Ask enroll-opencode-in-agent-peer-watch
    clarification: clarified
    confidence: high
    source: Agent Ask agent-peer-watch-2026-10-04
    acceptance_criteria:
      - OpenCode sessions launched through the fixed OpenCode launcher publish the contract's commit trailers and heartbeats, are watched by the Claude Code and Codex peers, and can watch them, using only Git commits and GitHub issue comments plus the existing capacity telemetry; the contract's table lists what OpenCode can and cannot produce and degrades to unknown rather than healthy where it cannot.
      - A hermetic three-agent scenario (Claude Code, Codex, OpenCode fakes) shows one agent exhausting its capacity mid-Action, the others classifying it exhausted from commits, comments and telemetry, offering help through a comment draft (or a posted comment when the Decision exists), the owner releasing the claim through the existing recovery path, and a peer continuing the same Action with no duplicate candidate, claim or settlement; a stalled-but-owning agent is never taken over; the operator guide explains how to read the watch output and approve the posting Decision.
    depends_on: [publish-agent-peer-heartbeats-and-offers]
    decisions: []
    references: ["scripts/arcadia-go-broker.ts", "src/goBroker.ts", "tests/rehearsal-three-action.test.ts"]
  - id: build-production-control-page-preview-first
    title: Build a dedicated Production page that makes current production state, next safe action and exact post-click evidence legible without bypassing production authority.
    status: open
    responsibility: agent
    effort: session
    next_action: Build a dedicated Production page that makes current production state, next safe action and exact post-click evidence legible without bypassing production authority.
    expected_artifact: Evidence satisfying Agent Ask build-production-control-page-preview-first
    clarification: clarified
    confidence: high
    source: Agent Ask production-control-page-preview-first-2026-10-04
    acceptance_criteria:
      - The dashboard has a dedicated responsive Production page that derives state solely from existing production status, saved-configuration preview, worker observation, operator-action descriptors and durable receipts; it shows desired state, policy/configuration identity and expiry, worker health, live admissions, current Action/candidate evidence when available, and the first unmet gate. Missing or stale data is unknown or unavailable, never safe or complete.
      - Exactly one primary control is displayed at a time. Before press, it states the selected existing reviewed /runs action or read-only preview, exact effect, preconditions, authority.does, authority.never_does, replay behavior and expected receipt. A click uses the audited operator-action launch path with a stable result identity and displays its durable terminal receipt or refusal; it never shells out from the browser or invokes an undeclared command.
      - When no reviewed compatible action exists, or a Decision, fresh Grant, stale preview, drift, running operation or unknown state blocks progress, the control is disabled and names the first unmet gate and bounded recovery. The page never activates production, consumes a Grant, restarts a service, merges, deploys, publishes, spends, uses credentials or creates an Action by itself.
      - The prior ambiguous direct dashboard activation interaction is removed from the Production interaction or made preview-first and replay-safe under the same authority contract; no UI label or test treats a click as authority by itself.
      - Focused route, component and API tests cover active, inactive-with-saved-configuration, unknown/stale, compatible action, no compatible action, conflict/refusal, duplicate/replayed click and receipt rendering. Dashboard build, relevant focused tests, lint/type checks, operator-script contract checks and preservation self-check pass; START_HERE.md explains the flow and limits.
    depends_on: []
    decisions: []
    references: []
  - id: agents-know-names-and-teammates
    title: Add a roster to agentIdentity.ts, surface it in `arcadia identity`, and inject an Identity block with self, teammates and partners into every launched session's prompt and brief.
    status: done
    responsibility: agent
    effort: session
    next_action: Add a roster to agentIdentity.ts, surface it in `arcadia identity`, and inject an Identity block with self, teammates and partners into every launched session's prompt and brief.
    expected_artifact: Evidence satisfying Agent Ask agents-know-names-and-teammates
    clarification: clarified
    confidence: high
    source: Agent Ask agents-know-names-and-teammates-2026-10-04
    acceptance_criteria:
      - src/codingAgents/agentIdentity.ts exposes a pure roster (every platform's given name, tier surnames, critic title and local address) and a teammates function that, for a resolved identity, lists the other platforms' identities and roles, the operator as a non-agent principal who never signs as an agent, and the rule that the resolved identity for the session's own model tier is authoritative; `arcadia identity resolve` prints the agent's own signature string and its teammates, and a new `arcadia identity roster` prints the whole roster; both agree with resolveAgentIdentity and refuse to fall back to the operator's identity.
      - "Every session prompt and brief Arcadia generates for Claude Code, Codex and OpenCode (go, brief, enroll, the managed worker packet and reviewer/critic launches) includes one Identity block built from that function: 'You are <name> <<email>> (platform, tier, role); sign every comment and commit exactly so, never as another tier or name; your teammates are ...; your current partners on this Project, from live claims and Sessions, are ...', where partners come from existing session and claim rows when they can be read and are omitted (not guessed) when they cannot; tests cover each provider, the critic role, an unknown tier refusing, no live partners, and a partner with a different platform."
      - "The operator and agent guidance (docs/agent-guidance/git-identity.md and the instructions the brief links) state the signature rule and the roster once, agent-agnostically; a deterministic test fails if a generated prompt for any platform lacks the Identity block or names a self identity that differs from resolveAgentIdentity for that session's tier and role; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/codingAgents/agentIdentity.ts", "src/commands/identity.ts", "src/sessions/index.ts", "src/agentWatch/contract.ts", "docs/agent-guidance/git-identity.md"]
  - id: guard-experiment-workspaces
    title: Add an experiment workspace profile and a guard that refuses the host-global and production-affecting commands inside it.
    status: done
    responsibility: agent
    effort: session
    next_action: Add an experiment workspace profile and a guard that refuses the host-global and production-affecting commands inside it.
    expected_artifact: Evidence satisfying Agent Ask guard-experiment-workspaces
    clarification: clarified
    confidence: high
    source: Agent Ask experiment-workspace-guard-and-trial-2026-10-04
    acceptance_criteria:
      - "`arcadia init --profile experiment` creates a workspace flagged experimental in its config (with an allowed repository root under the workspace), refuses the name martianrover and any existing database, and never seeds the real Arcadia Project; `config set defaultWorkspace` refuses an experiment workspace; a Project registered in an experiment workspace must have a repository path inside its allowed root and equal to no path registered in the live workspace."
      - A single guard module is called by every command that can touch host-global or production state (production activate, grants and reactivation, go-broker install and ensure, worker, dashboard and ingress service install or restart, GitHub PR and issue posting, notification and Discord senders, trust writes to the Codex and Claude configuration) and refuses with a named reason and the exact supported alternative when the resolved workspace is experimental; a test enumerates the command registry so a newly added command that is not classified (allowed, guarded or exempt) fails the build.
      - "The activity recorder stores an error code with each failed command so contention (SQLITE_BUSY, queue-revision conflicts, dirty-checkout refusals, stale preview fingerprints) can be measured; a leak-check command or script compares the live workspace's project count and queue revision, the user config and Codex/Claude configuration hashes and the launchd plist list before and after a session and reports any change; the guidance (docs/agent-guidance/arcadia-repository.md 'Experiment workspaces', and docs/agents-context.md regenerated into AGENTS.md within its budget) states the bounded exception and the rule that experiment workspaces are addressed only inline and never exported; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/workspace/config.ts", "src/workspace/initWorkspace.ts", "src/commands/init.ts", "src/commands/goBrokerInstall.ts", "src/commands/worker.ts", "src/commands/ingressService.ts", "src/activity/recorder.ts", "docs/decisions/0082-decide-whether-coding-agents-may-run-a-bounded-experiment-using-additional.md"]
  - id: run-multi-workspace-experiment-trial
    title: Run the first bounded trial of one experiment workspace per agent platform and report whether contention fell and nothing leaked.
    status: done
    responsibility: agent
    effort: session
    next_action: Run the Claude step of the multi-workspace experiment against the agreed contract, record the stop-condition event and its fixes, and end the trial by operator direction with workspaces preserved.
    expected_artifact: Evidence satisfying Agent Ask run-multi-workspace-experiment-trial
    clarification: clarified
    confidence: high
    source: Agent Ask end-multi-workspace-trial-amend-2026-10-05
    acceptance_criteria:
      - "The Claude Code step ran against the contract agreed in issue #940: workspace exp-claude-20261004 created with arcadia init --profile experiment and addressed inline, a no-remote one-Action fixture inside it advanced and settled with receipts, the leak check run before and after, guarded refusals shown with exact messages, and the evidence and friction posted to issue #940 (comment 5986088702) and kept under the workspace's evidence directory."
      - "The Decision 0082 stop condition event (an uninlined config get defaultWorkspace wrote one activity row into the live workspace) is recorded with its cause and its fixes merged and installed (#948 keeps workspace-independent commands out of the activity log and makes the leak check report live activity and refs; #950 adds the opt-in ARCADIA_REQUIRE_INLINE_WORKSPACE mode), the Codex step stopped without advancing (issue #940 comments 5986077838 and 5986555763) and the OpenCode step never started."
      - "The operator ended the trial on 2026-10-05: no further experiment commands run, the preserved workspaces exp-claude-20261004 and exp-codex-20261004 are kept until the operator says to delete them (exp-owen-20261004 was never created), the unrun scope (concurrent three-agent settle overlap and the error-rate comparison against the live baseline) is recorded as not run, the friction is catalogued in issues #947 and #949, and the recommendation is recorded: narrow."
    depends_on: []
    decisions: []
    references: []
  - id: keep-exempt-commands-out-of-activity-log
    title: Make workspace-independent commands record no activity and make activity-row and ref changes in the live workspace visible to the leak check.
    status: done
    responsibility: agent
    effort: session
    next_action: Make workspace-independent commands record no activity and make activity-row and ref changes in the live workspace visible to the leak check.
    expected_artifact: Evidence satisfying Agent Ask keep-exempt-commands-out-of-activity-log
    clarification: clarified
    confidence: high
    source: Agent Ask keep-exempt-commands-out-of-activity-log-2026-10-04
    acceptance_criteria:
      - Every command classified exempt in src/workspace/experimentGuard.ts COMMAND_CLASSIFICATION, and any other command that reads no workspace state (init including --profile experiment, config get defaultWorkspace, identity resolve and roster, workspace resolve, workspace guard, workspace leak-check, audit host-preview), is run with activity recording off (the runCliAction recordActivity 'never' setting or a classification-driven equivalent) and never resolves, opens or writes a workspace database to record it; a test runs each of them with an uninlined environment whose user-config default points at a temporary live-like workspace and asserts zero activity rows and no database open there, and a test enumerates the command registry so a newly exempt command that still records activity fails the build.
      - "`arcadia workspace leak-check` additionally records and compares, as separate attributed fields that do not by themselves count as a leak, the live workspace's activity_events row count and newest row id (read-only) and the live repository's ref list (heads, remotes, tags and refs/codex/* by name and target), prints them in its human output with a note on attributing them, and the guidance in docs/agent-guidance/arcadia-repository.md ('Experiment workspaces') states that a command run with no inline workspace is a command against the live workspace, that exempt commands record nothing, and fixes the sqlite read-only recipe for a fresh database (use immutable=1); focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/cli.ts", "src/activity/recorder.ts", "src/workspace/experimentGuard.ts", "src/workspace/leakCheck.ts", "src/commands/workspaceExperiment.ts", "https://github.com/pmark/arcadia/issues/947", "https://github.com/pmark/arcadia/issues/940"]
  - id: define-agent-comms-role
    title: "Define the Comms role: one event-driven communication session per coding-agent platform that observes, relays and escalates across agents through one GitHub coordination Issue, without dispatching or claiming work."
    status: done
    responsibility: agent
    effort: session
    next_action: "Define the Comms role: one event-driven communication session per coding-agent platform that observes, relays and escalates across agents through one GitHub coordination Issue, without dispatching or claiming work."
    expected_artifact: Evidence satisfying Agent Ask define-agent-comms-role
    clarification: clarified
    confidence: high
    source: Agent Ask agent-comms-role-v2-2026-10-04
    acceptance_criteria:
      - "docs/agent-guidance/agent-comms.md, registered in docs/agent-guidance/index.json with its triggers (comms, coordination issue, sub-issue, relay, peer sessions), defines the Comms role on top of docs/agent-guidance/agent-peer-watch.md: exactly one Comms session per platform (Claude Code, Codex, OpenCode); Comms may observe, relay, ask, offer help, escalate and launch read-only information-gathering subagents, and never dispatches, assigns, claims, releases or takes over work, which stays with the queue, claims and `arcadia go`; an Issue comment is a signal and never authority; awareness of other sessions reads Arcadia session and claim rows first, and each platform's native session listing (stated as verified or unknown for each of the three platforms) only as a fallback reported as unknown when unreadable."
      - "The procedure fixes the channel: one coordination Issue per round, named by an approved posting Decision (initially pmark/arcadia#944, once an approved Decision such as 0083 covers it); each Comms comment is signed with the exact resolved identity signature line and carries a short human summary plus at most one arcadia-peer-watch-v1 block; a sub-issue is opened only when one Action needs multi-agent discussion or the operator asks, and a round ends with a summary comment and a successor Issue named by a new Decision; Comms posts only through the main checkout (never from an experiment workspace) and only while a posting Decision is approved and unexpired, and otherwise writes the same text as a local draft."
      - "The procedure makes waiting cost no model tokens: a shell watcher polls with a comment-id watermark, an exact-signature self filter and rate-limit back-off below 500 remaining core requests, and is re-armed before the two-hour background limit; the Comms model wakes only on a comment from another signature, a peer classification change or an escalation; a checked-in launch brief for each of Claude Code, Codex and OpenCode starts a Comms session under these rules with its resolved identity; check:agent-guidance and the guidance index fingerprint checks pass."
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/agent-peer-watch.md", "docs/agent-guidance/git-identity.md", "docs/agent-guidance/index.json", "https://github.com/pmark/arcadia/issues/944", "https://github.com/pmark/arcadia/issues/940", "https://github.com/pmark/arcadia/issues/899"]
  - id: require-inline-workspace-mode
    title: Make ARCADIA_REQUIRE_INLINE_WORKSPACE refuse default-workspace fallback and set it for Arcadia-launched agent sessions where that is safe.
    status: done
    responsibility: agent
    effort: session
    next_action: Make ARCADIA_REQUIRE_INLINE_WORKSPACE refuse default-workspace fallback and set it for Arcadia-launched agent sessions where that is safe.
    expected_artifact: Evidence satisfying Agent Ask require-inline-workspace-mode
    clarification: clarified
    confidence: high
    source: Agent Ask require-inline-workspace-mode-2026-10-05
    acceptance_criteria:
      - With ARCADIA_REQUIRE_INLINE_WORKSPACE set to a truthy value, workspace resolution (src/workspace/resolve.ts and every caller path, including the activity recorder) refuses to use the user-config defaultWorkspace or the .arcadia-workspace marker and fails with a named error code (for example INLINE_WORKSPACE_REQUIRED) whose message states the exact fix (pass --workspace <path> or set ARCADIA_WORKSPACE inline on that command); --workspace, an ARCADIA_WORKSPACE value and the cwd config/arcadia.json walk-up keep resolving as before; commands that resolve no workspace (the no-record set, help, version) are unaffected; with the variable unset or falsy behaviour is byte-for-byte unchanged, so the live launchd services and operator scripts keep working; `arcadia workspace resolve` reports whether the mode is on.
      - Arcadia-launched agent sessions (the launch environment built in src/sessions/ for Claude Code, Codex and OpenCode) set the variable when the launch environment already pins the workspace explicitly, so launched sessions' own arcadia commands keep working and cannot fall back silently; where a launch path does not pin the workspace the Action does not set it there and records exactly why in the pull request; the Identity block and docs/agent-guidance/arcadia-repository.md ('Experiment workspaces') state the mode, who sets it and how a native session turns it on for its own shell.
      - "Tests (temporary directories and a temporary user config only) cover each resolution source with the mode on and off, the error code and remedy text, the recorder not falling back, the no-record commands and help staying usable, a launched-session environment containing the variable only when the workspace is pinned, and a regression that a command run inside the mode against a temp default workspace writes nothing there; focused suites, lint, tsc, pnpm build, pnpm dashboard:build, check:agent-guidance and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/workspace/resolve.ts", "src/workspace/config.ts", "src/activity/recorder.ts", "src/sessions/launch.ts", "src/sessions/index.ts", "src/codingAgents/agentIdentity.ts", "https://github.com/pmark/arcadia/issues/940", "https://github.com/pmark/arcadia/issues/947"]
  - id: fix-reviewer-verdict-name-echo
    title: "The code reviewer's verdict parser accepts the prompt's 'Name: description' criterion line when a model echoes it into the check `name`, instead of rejecting the verdict shape."
    status: open
    responsibility: agent
    effort: session
    next_action: "The code reviewer's verdict parser accepts the prompt's 'Name: description' criterion line when a model echoes it into the check `name`, instead of rejecting the verdict shape."
    expected_artifact: Evidence satisfying Agent Ask fix-reviewer-verdict-name-echo
    clarification: clarified
    confidence: high
    source: Agent Ask govern-oct5-review-followups-2026-10-05
    acceptance_criteria:
      - "When the reviewer's `name` field contains the criterion's full 'Name: description' line, Arcadia matches it to the declared criterion (by name prefix) rather than recording `reviewerUnavailable`."
      - A malformed verdict that matches no criterion still fails closed as before; the model's own statuses are preserved.
      - A deterministic test feeds a verdict whose `name` echoes the criteria line and asserts it is accepted and mapped.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/qa/prReview.ts", "https://github.com/pmark/arcadia/issues/937"]
  - id: harden-peer-watch-ownership-join
    title: "Close the peer-watch contract follow-ups: claim-after-session ownership join, `hasOwn`, and `releaseRef` from the reader."
    status: open
    responsibility: agent
    effort: session
    next_action: "Close the peer-watch contract follow-ups: claim-after-session ownership join, `hasOwn`, and `releaseRef` from the reader."
    expected_artifact: Evidence satisfying Agent Ask harden-peer-watch-ownership-join
    clarification: clarified
    confidence: high
    source: Agent Ask govern-oct5-review-followups-2026-10-05
    acceptance_criteria:
      - "`deriveOwnership` does not yield `principal_terminal` when a claim was created after the Session it is joined to; the join is by claim/session identity, not worktree+branch only (src/agentWatch/classify.ts ~543-549)."
      - "`hasOwn` uses the correct prototype-safe check, and the reader can return `releaseRef`."
      - Regression tests cover the claim-after-session case and the ownership gate.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/agentWatch/classify.ts", "docs/agent-guidance/agent-peer-watch.md", "https://github.com/pmark/arcadia/issues/939"]
  - id: fix-identity-block-fail-soft
    title: "The Identity block fails soft and is printed everywhere it should be: reviewer prompt, `go`, packets, and advance."
    status: open
    responsibility: agent
    effort: session
    next_action: "The Identity block fails soft and is printed everywhere it should be: reviewer prompt, `go`, packets, and advance."
    expected_artifact: Evidence satisfying Agent Ask fix-identity-block-fail-soft
    clarification: clarified
    confidence: high
    source: Agent Ask govern-oct5-review-followups-2026-10-05
    acceptance_criteria:
      - "An invalid `config/coding-agent-models.json` does not make the independent QA/code review refuse for a cosmetic reason; `loadModelTierRegistry` in the reviewer prompt (src/qa/prReview.ts:421-427) is wrapped to fall back to the default display name."
      - An empty packet directory no longer suppresses the Identity block, and `arcadia advance` prints it.
      - Deterministic tests cover the fail-soft registry, empty packet dir, and advance output.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/qa/prReview.ts", "https://github.com/pmark/arcadia/issues/942"]
  - id: harden-experiment-guard-leak-check-attribution
    title: "Close the experiment-guard review follow-ups: leak-check attribution guidance and `--record` clobber."
    status: open
    responsibility: agent
    effort: session
    next_action: "Close the experiment-guard review follow-ups: leak-check attribution guidance and `--record` clobber."
    expected_artifact: Evidence satisfying Agent Ask harden-experiment-guard-leak-check-attribution
    clarification: clarified
    confidence: high
    source: Agent Ask govern-oct5-review-followups-2026-10-05
    acceptance_criteria:
      - Leak-check output distinguishes ordinary live operation (broker manifest rewrite on a services restart, operator production transitions, admissions growth) from a real leak, in guidance and in attributed fields.
      - "`leak-check --record` does not clobber a prior baseline unexpectedly; overwrite is explicit or preserved."
      - Focused tests or fixtures cover the attribution cases and the record behavior.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["docs/agent-guidance/", "https://github.com/pmark/arcadia/issues/945"]
  - id: fix-experiment-workspace-friction
    title: "Fix the experiment-workspace friction: uninlined commands reaching live activity, unpositioned fresh Actions, and the Ask `--dir` default."
    status: open
    responsibility: agent
    effort: session
    next_action: "Fix the experiment-workspace friction: uninlined commands reaching live activity, unpositioned fresh Actions, and the Ask `--dir` default."
    expected_artifact: Evidence satisfying Agent Ask fix-experiment-workspace-friction
    clarification: clarified
    confidence: high
    source: Agent Ask govern-oct5-review-followups-2026-10-05
    acceptance_criteria:
      - A command run without an inline workspace cannot write an `activity_events` row into the live workspace from an experiment context (or the guard/require-inline mode makes that refusal explicit).
      - A freshly imported/created fixture Action is positioned so `advance`/`make-next` works without a manual `queue arrange`, or the setup path does it.
      - "`agent-ask draft/preview` does not default `--dir` to the Arcadia checkout when run inside a fixture; cost is documented."
      - Deterministic tests cover the activity isolation and fresh-Action positioning.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["src/scheduling/github.ts", "https://github.com/pmark/arcadia/issues/947"]
  - id: harden-activity-leak-fix-followups
    title: "Close the activity-leak review follow-ups: operator-task ledger audit and leak-check snapshot size."
    status: open
    responsibility: agent
    effort: session
    next_action: "Close the activity-leak review follow-ups: operator-task ledger audit and leak-check snapshot size."
    expected_artifact: Evidence satisfying Agent Ask harden-activity-leak-fix-followups
    clarification: clarified
    confidence: high
    source: Agent Ask govern-oct5-review-followups-2026-10-05
    acceptance_criteria:
      - "`operator-task raise|evidence|close|decline` writes to the repository ledger by design and is either recorded there only or documented as intentionally outside `activity_events`."
      - "`leak-check --json` does not embed an unbounded `liveRefs` map; the snapshot is bounded or summarized."
      - Focused tests cover the operator-task ledger and the bounded snapshot.
      - "`pnpm test` passes."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/949"]
  - id: adopt-rehearsal-freeze-window
    title: Let agents keep working in parallel with a live managed-production rehearsal by defining and enforcing a freeze window over the shared host state that can disrupt it.
    status: done
    responsibility: agent
    effort: session
    next_action: Let agents keep working in parallel with a live managed-production rehearsal by defining and enforcing a freeze window over the shared host state that can disrupt it.
    expected_artifact: Evidence satisfying Agent Ask adopt-rehearsal-freeze-window
    clarification: clarified
    confidence: high
    source: Agent Ask adopt-rehearsal-freeze-window-2026-10-05
    acceptance_criteria:
      - "Agent guidance (a 'Rehearsal freeze window' procedure registered in docs/agent-guidance/index.json with triggers such as rehearsal, freeze, production active, reinstall, restart, install) defines the window as running from a successful production activation until the terminal production Off receipt, observed with read-only `arcadia production status`; lists what is forbidden inside it (reinstall-go-broker.sh and `go-broker install|ensure`; recover-arcadia-host-services.sh and `scripts/services.sh restart|stop` except through the run's own Off-first G8 step; `production activate|deactivate|reactivate` outside the run's own G-steps; workspace config and provider-registry edits; editing, pausing, docs-syncing or tidying the in-scope fixture Project; whole-queue arrange or moving in-scope queue keys; fast-forwarding or dirtying the main checkout across commits that touch runtime paths: src, scripts, apps, package.json, pnpm-lock.yaml, tsconfig.json) and what continues (worktree commits, PRs and reviews; merges on origin, with the main checkout not fast-forwarded past runtime-path commits until the window ends; Arcadia-only Ask settles from the main checkout when the fast-forward range is docs-only; read-only commands; `arcadia go` sessions in their own worktrees; modest gh reads); and names who runs the batched install after the window ends (the release-manager or orchestrator session: reinstall-go-broker.sh, then recover-arcadia-host-services.sh when services need it) and how agents learn the window opened or closed (the coordination Issue and production status), without changing any authority."
      - "`arcadia go-broker install` and `arcadia go-broker ensure` (src/commands/goBrokerInstall.ts), reinstall-go-broker.sh before it installs, and `scripts/services.sh restart|stop` refuse with a named reason (for example production_active_freeze) and the exact supported alternative when read-only production status reports the managed-production policy Active, and proceed when it is Inactive or Off; a documented inline operator override (for example ARCADIA_FREEZE_OVERRIDE=<reason>) bypasses the refusal and records the reason; G8's Off-first restart path is unaffected; the CLI checks fail closed when status cannot be read while services.sh fails open with a warning as its existing comment requires; recover-arcadia-host-services.sh and its descriptor stay byte-identical, or G8's RECOVER_* sha256 pins and their tests are re-pinned in the same change."
      - "Hermetic tests cover Active refusal, Inactive and Off success, the override with its recorded reason and unreadable status for each guarded entry point, and the G8 Off-then-restart path still passing; focused suites, lint, tsc, pnpm build, check:agent-guidance, check:operator-scripts and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["src/commands/goBrokerInstall.ts", "scripts/services.sh", "artifacts/generated/operator-scripts/reinstall-go-broker.sh", "artifacts/generated/operator-scripts/recover-arcadia-host-services.sh", "artifacts/generated/operator-scripts/restore-terminal-off-three-action-rehearsal-2026-10-04.sh", "src/production/tick.ts", "src/production/policy.ts", "docs/managed-production-readiness.md", "https://github.com/pmark/arcadia/issues/940"]
  - id: prepare-run-2-rehearsal-scripts
    title: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean second rehearsal, without running any of them.
    status: done
    responsibility: agent
    effort: session
    next_action: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean second rehearsal, without running any of them.
    expected_artifact: Evidence satisfying Agent Ask prepare-run-2-rehearsal-scripts
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-run-2-rehearsal-scripts-2026-10-05
    acceptance_criteria:
      - "A fixture-reset operator pair (descriptor and script, repeatable only in its refusing form) takes the exact operator-supplied fixture repository (validated as G1 does: owner is the gh user, safe name, private, not archived, not a fork, the registered Project's repository), requires production Inactive with zero live admissions and leases, rewrites only the Action text of write-start-marker in the fixture Plan so its requirement input revision changes (the implementer proves in a test through src/sessions/roleLineage.ts requirementIdentity and the tick's launch gate that the amended Action gets a fresh lineage and is dispatchable even though the old attempts exist), commits and pushes it to fixture main without force after validating the amended fixture with Arcadia's real discovery before any push, runs docs sync, and writes a receipt carrying the new fixture head sha; it never touches production, Grants, other Actions, the old candidate branch or PR #1."
      - "The G7 Grant has a NEW pair with a new request id and descriptor (the existing pair is left unchanged and retired from use by its documentation), reads the reset receipt and binds the new fixture head instead of genesis, keeps every existing G7 safety property (G6 receipt freshness and matching, hermetic replay, double preview with identical fingerprint, scope exactly the three fixture Actions, remote preservation, Decision 0058 integration grant naming each Action with the same 12-hour expiries, cleanup that turns only its own Grant Off on any failure, the #925 acknowledgement visible on the /runs card); G8 gains a variant (or accepts both ids) that deactivates only a policy whose request id is the new G7's (or the old one's) with the exact fixture scope and keeps its other behaviour and hash pins; G6 (a new pair or a parameterised successor) pins the reset head and the current installed revision and keeps every existing check."
      - "Tests with fake gh, git and arcadia shims as in tests/three-action-rehearsal-operator-scripts.test.ts (no live system) cover the refusals and the happy path of each pair, the reset's no-push-before-validation guarantee, the new fixture head binding in G6 and G7, G8's ownership check for the new id and still refusing an unrelated policy; the operator-script checker passes with the new pairs (retirement manifest entries only if the guidance requires them); START_HERE.md and docs/managed-production-readiness.md give the exact operator order for run 2; every script is run only with --describe or against fakes; independent authority review rounds are recorded on the pull request; lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/prepare-three-action-rehearsal-fixture-2026-10-04.sh", "artifacts/generated/operator-scripts/preflight-three-action-rehearsal-2026-10-04.sh", "artifacts/generated/operator-scripts/grant-production-three-action-rehearsal-2026-10-04.sh", "artifacts/generated/operator-scripts/restore-terminal-off-three-action-rehearsal-2026-10-04.sh", "tests/three-action-rehearsal-operator-scripts.test.ts", "src/sessions/roleLineage.ts", "https://github.com/pmark/arcadia/issues/899", "https://github.com/pmark/arcadia/issues/940"]
  - id: accept-settled-descendant-in-g8-reconciliation
    title: Let G8 reconcile a preserved candidate whose tip is the exact accepted-completion settlement on top of the preservation commit, so rehearsal run 1 can reach terminal proof.
    status: done
    responsibility: agent
    effort: session
    next_action: Let G8 reconcile a preserved candidate whose tip is the exact accepted-completion settlement on top of the preservation commit, so rehearsal run 1 can reach terminal proof.
    expected_artifact: Evidence satisfying Agent Ask accept-settled-descendant-in-g8-reconciliation
    clarification: clarified
    confidence: high
    source: Agent Ask accept-settled-descendant-in-g8-reconciliation-2026-10-05
    acceptance_criteria:
      - "G8's work reconciliation (restore-terminal-off-three-action-rehearsal-2026-10-04 and any code it calls) classifies a preserved candidate as reconciled when its tip equals the preservation receipt's commit, or when all of these hold: the tip is clean; the receipt commit is an ancestor of the tip; every commit between them is a genuine accepted-completion settlement for that candidate's Action (a `Written by arcadia agent-ask settle --apply (asksettle_...)` receipt line, touching only .arcadia/asks/, MISSION_LOG.md, PROJECT.md, docs/plans/ and docs/decisions/, completing the claimed Action); and the same branch and pull request are remotely preserved at that exact tip. It keeps refusing a dirty tip, an arbitrary or code-changing descendant, a local-only tip, a missing or invalid settlement, and a remote or pull-request mismatch, each with a named reason."
      - "The change keeps every operator-script pin coherent: recover-arcadia-host-services.{sh,json} stay byte-identical; any changed G8 script or descriptor bytes are re-pinned with their tests in the same change; `pnpm check:operator-scripts` passes; and a read-only classification of rehearsal run 1's real evidence (receipt commit 9ed639d, PR #1 tip 58bcd915 on pmark/arcadia-three-action-rehearsal-20261004) reports reconciled without mutating anything."
      - "Hermetic tests cover the exact-tip case, the settled-descendant case, and each refusal (dirty, code-changing descendant, two settlements or a non-completion settlement, forged receipt line, local-only, remote or PR mismatch); the G8 operator-scripts suite, focused suites, lint, tsc, pnpm build, check:operator-scripts and the preservation self-check pass."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/restore-terminal-off-three-action-rehearsal-2026-10-04.sh", "artifacts/generated/operator-scripts/restore-terminal-off-three-action-rehearsal-2026-10-04.json", "tests/three-action-rehearsal-operator-scripts.test.ts", "https://github.com/pmark/arcadia/issues/940"]
  - id: isolate-next-operator-action
    title: Make the operator's single next action on the /actions page impossible to miss and hard to confuse with any other action.
    status: done
    responsibility: agent
    effort: session
    next_action: Make the operator's single next action on the /actions page impossible to miss and hard to confuse with any other action.
    expected_artifact: Evidence satisfying Agent Ask isolate-next-operator-action
    clarification: clarified
    confidence: high
    source: Agent Ask isolate-next-operator-action-2026-10-05
    acceptance_criteria:
      - The /actions page (and the operator-actions view on /runs if it lists the same cards) shows at most one 'Do this next' action, isolated at the top in a visually distinct panel above everything else, with a one-sentence plain-language instruction, the exact card name, and, when a time window applies (for example G7 within 30 minutes of a passing G6 receipt), the local deadline and a live countdown; it is derived deterministically from published descriptors, live production status and run receipts (never from an agent's message), and when nothing needs the operator the panel says so plainly.
      - Every other action is visually separated below the panel and de-emphasized; pressing an action that is not the current next action, or one whose effect would invalidate the next action (for example a G8 or a host restart while a fresh G6 receipt awaits its G7), first shows a confirmation that names the current next action and what the press would undo, without removing or weakening any action's existing gates or refusals.
      - "Works one-handed at phone width; component and route tests cover the next-action derivation (G6 then G7 with its window, an expired window falling back to G6, nothing pending, a failed run) and the confirm-on-off-path behaviour; pnpm dashboard:build, lint, tsc and focused suites pass, and a live read-only smoke of the page is captured as a screenshot in the pull request."
    depends_on: []
    decisions: []
    references: ["apps/dashboard/app/actions", "apps/dashboard/app/runs", "apps/dashboard/app/api/operator-script/route.ts", "artifacts/generated/operator-scripts/"]
  - id: add-operator-qa-plan-to-preserved-pr-body
    title: Give every host-preserved candidate pull request a concrete, runnable Operator QA plan derived from its Action, so independent QA can judge it instead of failing on a one-line placeholder.
    status: done
    responsibility: agent
    effort: session
    next_action: Render a deterministic Operator QA plan into every host-preserved candidate pull request body, with tests.
    expected_artifact: Evidence satisfying Agent Ask add-operator-qa-plan-to-preserved-pr-body
    clarification: clarified
    confidence: high
    source: Agent Ask split-add-operator-qa-plan-to-preserved-pr-body-2026-10-05-r2
    acceptance_criteria:
      - "The host preservation path (src/production/sessionHandoff.ts qaPlan and any other place a preserved candidate pull request body is written, such as src/commands/preserve.ts) renders a deterministic 'Operator QA plan' section from the Action's declared acceptance criteria and the candidate's changed files: for each criterion a concrete step (what to open, run or inspect, using exact paths, branch and commit) and its observable expected result, plus the Action id, candidate commit and base; it is built only from governed records and Git facts, never from model output, escapes Markdown safely, stays within GitHub's body limits, and keeps QA's no-not-applicable rule unchanged."
      - "Hermetic tests cover rendering for one and several criteria, inert-document and code patches, Markdown injection in criterion text, long bodies, and an Action with no criteria (which refuses rather than writing a placeholder); focused suites, lint, tsc, pnpm build, the preservation self-check and check:agent-guidance pass."
    depends_on: []
    split_into: [verify-operator-qa-plan-with-live-qa]
    decisions: []
    references: ["src/production/sessionHandoff.ts", "src/commands/preserve.ts", "src/qa/prReview.ts", "https://github.com/pmark/arcadia-three-action-rehearsal-20261004/pull/2"]
  - id: prepare-run-3-rehearsal-scripts
    title: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean third rehearsal, without running any of them.
    status: done
    responsibility: agent
    effort: session
    next_action: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean third rehearsal, without running any of them.
    expected_artifact: Evidence satisfying Agent Ask prepare-run-3-rehearsal-scripts
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-run-3-rehearsal-scripts-2026-10-05
    acceptance_criteria:
      - "A run-3 fixture-reset operator pair (descriptor and script, repeatable only in its refusing form) reuses the run-2 reset's fixture validation and no-push-before-validation guarantees and additionally: requires a succeeded, Off-confirmed run-2 G8 receipt (restore-terminal-off-three-action-rehearsal-2026-10-05, run 20261005T160050Z-46759 or a later succeeded one) and fixture main exactly at the run-2 reset head 0d3d2cedc5548da41896201688a1dc0210208ea4; requires run 1's branch and PR #1 at 58bcd9155cf64836994045ca63a7707d8b9ebe75 and run 2's branch claude/write-start-marker-20261005T155147519Z and PR #2 at 7f1390376f4d49215cd29fd98145d40198475613, local and remote, before and after the push; rewrites only write-start-marker's next_action to a third distinct text (and the Plan's updated: date if docs sync needs it, proven in a test with real docs sync that the amendment is applied, not skipped as older) so its requirement input revision differs from both earlier ones; and closes the Issue #968 gap: it refuses unless no pending Agent Ask proposal gates the amended Action, or it supersedes exactly run 2's pending complete proposal (complete-write-start-marker-2026-10-05) through the governed settle (disposition rejected, preview then apply with the exact fingerprint) before the commit, never touching other proposals. It writes a receipt carrying the new fixture head, the three candidate tips and the superseded proposal id; it never touches production, Grants, other Actions, run 1's or run 2's branches or PRs. A test proves, through src/sessions/roleLineage.ts requirementIdentity and the tick's launch gate on fakes, that the amended Action gets a fresh lineage and is dispatchable with run 1's and run 2's attempts and candidates present, and that the pending-proposal gate no longer blocks it."
      - "The run-3 G7 Grant has a NEW pair with a new request id and descriptor (the 2026-10-04 and 2026-10-05 pairs are left unchanged and retired from use by their documentation), reads the run-3 reset receipt and binds its new fixture head, keeps every run-2 G7 safety property (G6 receipt freshness, matching arcadiaHead and brokerRevision, hermetic replay, double preview with identical fingerprint, scope exactly the three fixture Actions, remote preservation, Decision 0058 integration grant naming each Action with the same 12-hour expiries, cleanup that turns only its own Grant Off, the #925 acknowledgement on the /runs card) and carries the optional next_after field exactly as the run-2 G7 JSON does (prerequisite G6 within 30 minutes; voided_by G8, recover, reinstall and reset) so check-operator-scripts validates it and the panel isolates it; the run-3 G6 (a new pair) pins the run-3 reset head and keeps every existing check; the run-3 G8 accepts the run-3, run-2 or run-1 G7 request id with the exact fixture scope and otherwise keeps the merged G8 behaviour and hash pins byte-identical (a test compares the normalized scripts)."
      - "Tests with fake gh, git and arcadia shims as in tests/three-action-rehearsal-run-2-operator-scripts.test.ts (no live system) cover the refusals and happy path of each pair, the reset's no-push-before-validation guarantee, the proposal-supersede behaviour and its refusal for any other pending proposal, the reset-head binding in G6 and G7, G8's ownership check for each accepted id and its refusal of an unrelated policy, and the reset to G6 to G7 chain; check:operator-scripts passes; START_HERE.md and docs/managed-production-readiness.md give the exact operator order for run 3 (including that main must not move between G6 and the G7 press and that G8 must be run from the Terminal panel or /runs, never a plain shell); every script is run only with --describe or against fakes; independent authority review rounds are recorded on the pull request; lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-2026-10-05.sh", "artifacts/generated/operator-scripts/preflight-three-action-rehearsal-2026-10-05.sh", "artifacts/generated/operator-scripts/grant-production-three-action-rehearsal-2026-10-05.sh", "artifacts/generated/operator-scripts/restore-terminal-off-three-action-rehearsal-2026-10-05.sh", "tests/three-action-rehearsal-run-2-operator-scripts.test.ts", "tests/rehearsal-run-2-amended-action.test.ts", "src/sessions/roleLineage.ts", "https://github.com/pmark/arcadia/issues/968", "https://github.com/pmark/arcadia/issues/940"]
  - id: verify-operator-qa-plan-with-live-qa
    title: Prove with the configured independent QA reviewer that the rendered Operator QA plan passes its criterion on a real preserved pull request.
    status: done
    responsibility: agent
    effort: session
    next_action: Prove with the configured independent QA reviewer that the rendered Operator QA plan passes its criterion on a real preserved pull request.
    expected_artifact: Evidence satisfying Agent Ask verify-operator-qa-plan-with-live-qa
    clarification: clarified
    confidence: high
    source: Agent Ask amend-verify-operator-qa-plan-criterion-2026-10-05
    acceptance_criteria:
      - "The configured independent QA reviewer (arcadia qa pr) has judged a real pull request that Arcadia's own host preservation created with the rendered Operator QA plan in its body, and its report records the 'Operator QA plan' criterion as pass; the evidence names the pull request, its exact head, the verdict artifact paths and the reviewer provenance. Rehearsal run 3's pmark/arcadia-three-action-rehearsal-20261004#3 at 50d1eab84e385a5566119831c82f5a6d32e752fd (two live verdicts, 2026-10-05T18:51Z and 19:38Z) satisfies this."
    depends_on: []
    decisions: []
    references: []
  - id: embed-validation-evidence-in-preserved-pr-body
    title: Render each declared validation command, cwd, exit code, duration and a bounded escaped output tail, plus one settlement-commit line, into the host-rendered Operator QA plan of preserved PR bodies, and prove it live against the QA reviewer.
    status: done
    responsibility: agent
    effort: session
    next_action: Render each declared validation command, cwd, exit code, duration and a bounded escaped output tail, plus one settlement-commit line, into the host-rendered Operator QA plan of preserved PR bodies, and prove it live against the QA reviewer.
    expected_artifact: Evidence satisfying Agent Ask embed-validation-evidence-in-preserved-pr-body
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-run-4-and-validation-evidence-2026-10-05
    acceptance_criteria:
      - "The host-rendered Operator QA plan in a preserved candidate's pull-request body gains a 'Validation evidence' section built only from the preservation receipt and governed records (no model): for each declared validation command it renders the command, its working directory, exit code, duration and a bounded (fixed byte cap per stream, last lines kept), escaped stdout/stderr tail; a failed, timed-out or missing validation renders an explicit status and the PR is still preserved as today; hostile output (markdown or HTML injection, ANSI and control characters, very long lines, binary) is neutralised; it also renders one fixed line stating that a candidate's own governed completion-settlement commit is the record Arcadia expects before independent review and is not an approval-boundary crossing. Unit tests with fixtures cover passing, failing, timed-out, missing, oversized and hostile-output cases and prove the body stays deterministic and bounded."
      - "A live read-only smoke (the configured independent QA reviewer through `arcadia qa pr`'s evidence assembly with only GitHub writes stubbed, never editing any PR) judges rehearsal run 3's PR #3 exact patch at 50d1eab84e385a5566119831c82f5a6d32e752fd with the newly rendered body substituted, twice, and records both verdicts with the report paths on the pull request: neither verdict cites missing validation evidence or the completion-settlement commit as a finding; if either does, the Action iterates on the rendering within three review rounds and records every attempt. QA's own criteria and rules are unchanged."
      - "Lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request; the change is installed through the governed reinstall path after merge by the release manager (not by the implementer)."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/972", "https://github.com/pmark/arcadia/issues/940"]
  - id: prepare-run-4-rehearsal-scripts
    title: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean fourth rehearsal, without running any of them.
    status: done
    responsibility: agent
    effort: session
    next_action: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean fourth rehearsal, without running any of them.
    expected_artifact: Evidence satisfying Agent Ask prepare-run-4-rehearsal-scripts
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-run-4-and-validation-evidence-2026-10-05
    acceptance_criteria:
      - "A run-4 fixture-reset operator pair (ids ending -run4-2026-10-05; descriptor and script, repeatable only in its refusing form) reuses the run-3 reset's fixture validation, no-push-before-validation and proposal-state handling, and: requires a succeeded, Off-confirmed run-3 G8 receipt (restore-terminal-off-three-action-rehearsal-run3-2026-10-05, run 20261005T194025Z-26232 or a later succeeded one) and fixture main exactly at the run-3 reset head 4375aafeef38f0ee339a300406c8a865dbb916dc; requires run 1's branch and PR #1 at 58bcd9155cf64836994045ca63a7707d8b9ebe75, run 2's branch claude/write-start-marker-20261005T155147519Z and PR #2 at 7f1390376f4d49215cd29fd98145d40198475613 and run 3's branch claude/write-start-marker-20261005T184707757Z and PR #3 at 50d1eab84e385a5566119831c82f5a6d32e752fd, local and remote, before and after the push; rewrites only write-start-marker's next_action to a fourth distinct text (and the Plan's updated: date only if docs sync needs it) so its input revision differs from 959a3b12c686, 7a8dd4f5960f and e22c8cfadd0b, and that text names the unused completion request id complete-write-start-marker-run4-2026-10-05 (the reset refuses before any settle or commit if that id already exists in agent_ask_proposals); handles any pending proposal for the Action exactly as the run-3 reset does (pending own: governed rejected settle; rejected or accepted elsewhere: proceed only if the real gate is clear; foreign pending: refuse); and writes a receipt with the new fixture head, the four candidate tips and the proposal states. It never touches production, Grants, other Actions or any earlier run's branches or PRs. A test with the real transition resolver and tick proves the amended Action gets a fresh lineage and is dispatchable with the earlier runs' attempts and candidates present."
      - "The run-4 G7 Grant has a NEW pair with a new request id (grant-production-three-action-rehearsal-run4-2026-10-05), reads the run-4 reset receipt and binds its new fixture head, keeps every run-3 G7 safety property (G6 receipt freshness, matching arcadiaHead and brokerRevision, hermetic replay, double preview with identical fingerprint, scope exactly the three fixture Actions, remote preservation, Decision 0058 integration grant naming each Action with the same 12-hour expiries, cleanup that turns only its own Grant Off, the #925 acknowledgement) and the next_after field (voided_by now also lists the run-3 and run-4 resets and G8s); the run-4 G6 pins the run-4 reset head and keeps every run-3 check; the run-4 G8 accepts the run-4, run-3, run-2 or run-1 G7 request id with the exact fixture scope and otherwise stays byte-identical in reconciliation and hash pins to the run-3 G8 (tested), and says in its descriptor that it must run from the Terminal panel or /runs. All earlier pairs stay byte-unchanged and are retired from use."
      - "Tests with fake gh, git and arcadia shims as in tests/three-action-rehearsal-run-3-operator-scripts.test.ts (no live system) cover the refusals and happy path of each pair, no push before validation, the proposal-state cases and the used-completion-id refusal, the reset-head binding in G6 and G7, G8's ownership of each accepted id and refusal of an unrelated policy, the reset to G6 to G7 chain, and a real same-day docs-sync test of an already-done work item; check:operator-scripts passes; START_HERE.md and docs/managed-production-readiness.md give the exact run-4 operator order (reset, G6 within 30 minutes, no main movement or reinstall or restart or G8 between G6 and the G7 press, the Terminal-panel rule for G8) and a run-4 evidence-to-capture line (the live QA verdicts on PR #4 including the Tests and evidence criterion); every script is run only with --describe or against fakes; independent authority review rounds are recorded on the pull request; lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-run3-2026-10-05.sh", "artifacts/generated/operator-scripts/preflight-three-action-rehearsal-run3-2026-10-05.sh", "artifacts/generated/operator-scripts/grant-production-three-action-rehearsal-run3-2026-10-05.sh", "artifacts/generated/operator-scripts/restore-terminal-off-three-action-rehearsal-run3-2026-10-05.sh", "tests/three-action-rehearsal-run-3-operator-scripts.test.ts", "tests/rehearsal-run-3-amended-action.test.ts", "https://github.com/pmark/arcadia/issues/968", "https://github.com/pmark/arcadia/issues/972"]
  - id: archive-settled-ask-by-canonical-name
    title: Make settlement archive the drafted Ask file when no sourcePath was recorded, and make a repeated integration refusal visible once instead of looping silently.
    status: done
    responsibility: agent
    effort: session
    next_action: Make settlement archive the drafted Ask file when no sourcePath was recorded, and make a repeated integration refusal visible once instead of looping silently.
    expected_artifact: Evidence satisfying Agent Ask archive-settled-ask-by-canonical-name
    clarification: clarified
    confidence: high
    source: Agent Ask fix-stray-ask-archive-and-run-5-scripts-2026-10-06
    acceptance_criteria:
      - "Settlement archives the settled Agent Ask file even when the proposal recorded no sourcePath: `settle --apply` (src/ask/settlement.ts archiveSettledAskFile) falls back to the canonical drafted name `.arcadia/asks/agent-ask-<request_id>.yaml` under the repository being settled and moves it to `.arcadia/asks/archive/` inside the same settlement commit, only when that file's content matches the proposal (same request id and fingerprint), never touching any other file; a settle with neither a sourcePath nor a canonical file behaves exactly as today. Unit tests reproduce the run-4 shape (a complete Ask previewed without a recorded path, settled in a candidate worktree: the settle commit includes the archived file and git status is clean afterwards), the matching-content guard, and the unchanged no-file case."
      - "The worker no longer fails silently when a terminal candidate cannot integrate: a repeated identical `integration refused` outcome for the same candidate head (the tick.ts 'differs from its exact canonical completion settlement' class and its siblings) is logged once per head, not every tick, and is recorded once as an operator escalation shown in `arcadia production status` with the exact blocker and a remedy (for the run-4 shape: the stray untracked file and what to do), clearing when the candidate integrates or production goes Off; the existing refusal logic and guards are unchanged. Tests cover the dedupe, the escalation text and its clearing."
      - "The candidate brief (Action packet) tells a completing agent to leave `git status` clean after settlement and not to commit or keep a copy of the Ask file; lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request; after merge the release manager reinstalls (not the implementer)."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/981", "src/ask/settlement.ts", "src/production/tick.ts"]
  - id: prepare-run-5-rehearsal-scripts
    title: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean fifth rehearsal, without running any of them.
    status: done
    responsibility: agent
    effort: session
    next_action: Add reviewed, fail-closed, drafts-only operator script pairs that reset the fixture and run a clean fifth rehearsal, without running any of them.
    expected_artifact: Evidence satisfying Agent Ask prepare-run-5-rehearsal-scripts
    clarification: clarified
    confidence: high
    source: Agent Ask fix-stray-ask-archive-and-run-5-scripts-2026-10-06
    acceptance_criteria:
      - "Run-5 operator pairs (ids ending -run5-2026-10-06 or -run5-2026-10-05 per the host date at build time; descriptor id == file stem) are cloned from the merged run-4 pairs (#973): the reset requires the run-4 reset receipt (9642005f2fdca40a4c8859d64ee28e3361df0056 on run 3's head 4375aafeef38f0ee339a300406c8a865dbb916dc) and a succeeded Off-confirmed run-4 G8 (restore-terminal-off-three-action-rehearsal-run4-2026-10-05, run 20261006T011557Z-3871 or later), checks runs 1-4 branch and PR tips before and after (run 4: branch claude/write-start-marker-20261005T220000438Z, PR #4, tip 79c6bae9 which includes the preservation commit; read the exact full sha from the repo at build time), writes a fifth distinct next_action (input revision differs from 959a3b12c686, 7a8dd4f5960f, e22c8cfadd0b and 7843e2eb12f9) naming the unused completion id complete-write-start-marker-run5-2026-10-06 (or the date variant matching the host date) and telling the agent to leave git status clean after settlement; handles run 4's own proposal as run 3's reset handled run 3's; G6/G7/G8 follow the same derivation rules as run 4's (G8 owns the run-5, run-4, run-3, run-2 and run-1 G7 ids; hash pins byte-identical to run-4's G8; G7's next_after voided_by extended)."
      - "Tests and docs follow run 4's (fake shims, refusals and happy paths, proposal-state cases, used-id refusal, chain binding in G6/G7, G8 ownership, reset to G6 to G7 chain, real same-day docs-sync of a done work item, lineage test with the real transition resolver and tick through four earlier runs, sha256 pin of every earlier pair file); START_HERE.md and docs/managed-production-readiness.md give the run-5 order including that main must be quiet from G6 to the G7 press; check:operator-scripts, lint, tsc, check:agent-guidance, preservation self-check and the focused suites pass; every script runs only with --describe or against fakes; independent authority review rounds are recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-run4-2026-10-05.sh", "tests/three-action-rehearsal-run-4-operator-scripts.test.ts", "https://github.com/pmark/arcadia/issues/981"]
  - id: document-rehearsal-runbook
    title: Write docs/autonomous-production-rehearsal-runbook.md and point START_HERE.md and docs/managed-production-readiness.md at it.
    status: done
    responsibility: agent
    effort: session
    next_action: Write docs/autonomous-production-rehearsal-runbook.md and point START_HERE.md and docs/managed-production-readiness.md at it.
    expected_artifact: Evidence satisfying Agent Ask document-rehearsal-runbook
    clarification: clarified
    confidence: high
    source: Agent Ask document-rehearsal-runbook-2026-10-06
    acceptance_criteria:
      - "docs/autonomous-production-rehearsal-runbook.md exists and gives, in one checked-in document written for the next release manager and any coding agent: (1) the minimum-viable-production standard stated as observable exit criteria (the proof ladder: current exact source installed and inactive, a fresh one-shot Grant pressed by the operator, one serial three-Action run with zero operator steps between the G7 press and G8, every Action preserved with the host-rendered QA plan and validation evidence, code-review and QA both passing on the exact head, local fast-forward integration, terminal Off and reconciliation proven, then a clean repeat, then one escalated dimension); (2) roles and authority (what the operator alone does: G7 press, Decisions, activation, spend; what the release manager, implementers and reviewers may do; standing permissions Mark has granted and their limits); (3) the exact optimal step-by-step procedure for a rehearsal run from orientation through WINDOW OPEN, with the real commands, the order, the timing observed, who does each step and the observable check after each (governed Action creation, broker candidate, implementer and independent review, merge on green, merge-window announcement, single reinstall, reset, immediately G6, operator ping, G7 deadline, watchdog, verdict handling, G8 from the Terminal panel, evidence capture); (4) the failure catalog: every symptom seen in runs 1-5 with its cause, the fix that shipped or the Issue that tracks it, and what to do if it recurs; (5) the operational gotchas (REST over GraphQL for gh, unsandboxed gh/git/arcadia, inline workspace, runner-capacity CI cancellations and the one-rerun rule, untracked Ask files blocking installs and settlements, G8 refusing non-interactive shells, macOS sed, the freeze window rule from G6 to the G7 press, no-progress watchdog); (6) the open gaps that still stand between the rehearsals and a minimum viable production standard (Issue #987 serial-Action base, #986, #984, #976, #972 follow-ups, the one-hour cost of cloning run-N script pairs and the proposal to parameterise them) with the exact next step for each."
      - START_HERE.md and docs/managed-production-readiness.md each gain a short pointer to the runbook (where an agent starts before critical-path production work); every command, path, Issue number, receipt id and timing quoted in the runbook was checked against the repository or the recorded evidence (the release manager's retro lists the sources) and nothing in it claims capability that has not been proven live; docs/agent-guidance remains unchanged (no new hash pin) unless the guidance index requires otherwise.
      - "lint, tsc, check:agent-guidance and the preservation self-check pass; the focused documentation tests pass; an independent read-only reviewer reads the runbook against the repository and the recorded evidence, reports unsupported claims and gaps, and its rounds are recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["docs/managed-production-readiness.md", "START_HERE.md", "docs/notes-to-self.md", "https://github.com/pmark/arcadia/issues/987", "https://github.com/pmark/arcadia/issues/940", "https://github.com/pmark/arcadia/issues/899"]
  - id: build-fast-rehearsal-harness
    title: A serial two-Action scenario harness over the real lifecycle with a scripted executor, failure injection and phase timings, run by `pnpm fast-rehearsal` in under five minutes.
    status: done
    responsibility: agent
    effort: session
    next_action: A serial two-Action scenario harness over the real lifecycle with a scripted executor, failure injection and phase timings, run by `pnpm fast-rehearsal` in under five minutes.
    expected_artifact: Evidence satisfying Agent Ask build-fast-rehearsal-harness
    clarification: clarified
    confidence: high
    source: Agent Ask build-fast-rehearsal-replay-2026-10-06
    acceptance_criteria:
      - "A checked-in fast scenario harness (tests/fast-rehearsal/ with shared helpers and a `pnpm fast-rehearsal` script) runs a serial two-Action scenario in an isolated temporary Project repository and workspace through the REAL production lifecycle code: the worker tick (admission, policy and Grant scope), the session launch and terminal-recovery path with a scripted executor standing in for the coding agent, candidate preservation, tick-driven PR readiness and the review steps (with a fake `gh` and a local bare remote that models the PR's base and head the way GitHub reports them, and stubbed reviewer verdicts), integration by local fast-forward, and queue and pointer advancement; it finishes in under five minutes; it reimplements none of the lifecycle and a short document in the harness lists exactly which seams are faked (tmux, gh, model reviewers) and why those and no others. Per-phase timings (queue wait, agent execution, validation, Git finalization, review, integration, advancement) and exact errors (command, working directory, exit code, sanitised stderr) are recorded to a report the command prints."
      - "The scripted executor drives the same execution contract the coding agent uses (the brief, the candidate worktree, the completion Ask and settle) and has selectable behaviours: clean; leaves its drafted Ask file untracked and unarchived (run 4's defect, which #983 fixed); edits the draft after an inline preview; leaves an extra uncommitted file; commits an extra file after settling. Failure injection at the completion boundary (a failing Git command, an interruption after the commit and before completion is recorded, a worker restart between preservation and readiness) verifies that recovery preserves the work and advances exactly once. A scenario test shows run 4's shape integrates with the #983 fix and that, when the guard refuses, `production status` carries one escalation naming the blocker."
      - "docs/autonomous-production-rehearsal-runbook.md gains Phase 1 step 'run `pnpm fast-rehearsal` before any live run' and records the key learning (measure loop cost and time-to-detect and time-to-fix per defect; two consecutive live runs that each find a new offline-reproducible defect are the trigger to build the cheap experiment first; the live run is the integration check, not the debugger); docs/notes-to-self.md gets the matching entry; lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/989", "https://github.com/pmark/arcadia/issues/987", "docs/autonomous-production-rehearsal-runbook.md", "tests/rehearsal-run-5-amended-action.test.ts", "tests/preserve-on-exit-and-integrate.test.ts", "src/production/tick.ts"]
  - id: build-checkpoint-replay-and-base-check
    title: "A checkpoint replay tool with a deterministic plan-versus-PR consistency check that reproduces Issue #987 from run 5's preserved PR #6 in seconds."
    status: done
    responsibility: agent
    effort: session
    next_action: "A checkpoint replay tool with a deterministic plan-versus-PR consistency check that reproduces Issue #987 from run 5's preserved PR #6 in seconds."
    expected_artifact: Evidence satisfying Agent Ask build-checkpoint-replay-and-base-check
    clarification: clarified
    confidence: high
    source: Agent Ask build-fast-rehearsal-replay-2026-10-06
    acceptance_criteria:
      - "A checkpoint replay tool (a documented script or test helper in the repository) loads a preserved rehearsal candidate read-only (its branch, base revision, the preservation receipt and validation record, the QA evidence JSON and patch the reviewer saw) into an isolated copy and re-renders the host Operator QA plan with the repository's real renderer, then runs a deterministic consistency check between the plan and the pull-request metadata as GitHub reports it: the plan's base revision and changed-file list must equal the PR's base and file list; a mismatch is reported with the exact differing values. It needs no model and no GitHub write, and runs in seconds."
      - "The tool reproduces Issue #987 from rehearsal run 5's preserved PR #6 (fixture pmark/arcadia-three-action-rehearsal-20261004, candidate branch claude/transform-start-marker-20261006T032821535Z at 69eb7d62, QA evidence under the live workspace artifacts/qa/pull-requests/pmark-arcadia-three-action-rehearsal-20261004/6/): the plan names base f68ec48ed4ff while the PR's metadata names 7214de28da2745c66f89d81e124e2ab2de05b2ca and lists seven changed files against the plan's six; a checked-in test captures a minimal synthetic copy of that state (no live data in the repository) and asserts the mismatch as an expected failure (`it.fails` or an equivalent documented marker) so the Issue's fix flips it; the same test file shows run 5's PR #5 (first Action, no mismatch) passes the check."
      - "lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; independent authority review rounds are recorded on the pull request; the change adds no runtime path that executes in production (test and script only) so no reinstall is needed."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/987", "https://github.com/pmark/arcadia/issues/989", "src/sessions/operatorQaPlan.ts", "src/sessions/validationEvidence.ts", "src/qa/prReview.ts"]
  - id: operator-timeline-phase-1
    title: Design and prove a unified workspace event stream (schema, collectors, command, point-in-time read model) on real data, with Phase 2 UX options for the operator.
    status: done
    responsibility: agent
    effort: session
    next_action: Design and prove a unified workspace event stream (schema, collectors, command, point-in-time read model) on real data, with Phase 2 UX options for the operator.
    expected_artifact: Evidence satisfying Agent Ask operator-timeline-phase-1
    clarification: clarified
    confidence: high
    source: Agent Ask operator-timeline-phase-1-2026-10-06
    acceptance_criteria:
      - "A written design (docs/proposals/operator-timeline.md) states the operator problem in the operator's words (disorientation across multiple session histories, projects and three native agent tools: OpenCode, Claude Code, Codex; wanting to know what kind of work any agent or subagent is doing; monitor everything active; rewind and play back significant events for a whole workspace and all its Projects), inventories the REAL event sources that exist today in this repository and workspace (verified by reading the code and the data: git activity across the main checkout, every agent worktree under ~/.claude, ~/.codex and ~/.opencode, fixture repositories and PR/branch activity; the Sessions and role-attempt tables; Agent Asks, proposals and settlements; Decisions; Actions, Plans, Milestones, Missions and Projects as checked-in records and their commits; the events table; managed-production policy, admissions and escalations; operator-script run receipts; Discord pings), defines ONE unified event schema (stable id, UTC time, source, kind, subject refs for workspace/project/plan/action/session/ask/decision/PR/commit, actor identity with agent tool (opencode, claude-code, codex, operator, host worker) and semantic name and tier where derivable, a controlled `work_kind` taxonomy answering 'what kind of work is this' (for example plan/design, implement, review, verify, integrate, govern, operate, observe), a short human summary, evidence pointers, and provenance of how it was derived), explains how each field is derived (including how an agent tool and a semantic name are recovered from worktree paths, commit author emails and Session rows), and records the open questions that need the operator."
      - "Phase 1 is proven on real data: a collector layer and a command (for example `arcadia timeline`, with `--since`, `--until`, `--project`, `--tool`, `--kind`, `--json` / NDJSON, and a `--follow` mode that streams new events) in this repository read the live workspace and repositories READ-ONLY and emit the unified stream, merged and deterministically ordered across all Projects, de-duplicated, with provenance per event, tolerant of missing or unreadable sources (a collector failure is reported as a stream event and never aborts the stream), and fast enough to be practical (the design records measured timings on this workspace); at least these collectors exist: git (commits, branches, merges and worktrees across the repositories the workspace knows), sessions and role attempts, Agent Asks and settlements, Decisions, Actions/Plans/Milestones/Projects record changes, the events table, managed-production activity, and operator-script receipts; a point-in-time query shows the workspace's recent history as of a past timestamp (the 'rewind' read model; interactive playback is Phase 2). The command writes nothing to any repository or database."
      - "Tests (fixtures built in temp repositories and temp workspaces, no live data committed) cover each collector, the schema and `work_kind` classification including agent tool and semantic-name recovery from a worktree path, a commit author email and a Session row, ordering and de-duplication, source failure tolerance, the time-window and `--follow` behaviour; a short sample of real stream output from this workspace (sanitised, bounded, no secrets) is attached to the design as evidence that the data can be collected and presented as a stream; a Phase 2 section of the design offers two or three UX directions (a live 'what is happening now' view by project and agent tool, a scrubbable timeline for replay, an at-a-glance 'what kind of work' lens) with the practical data each needs from Phase 1, as options for the operator to choose, without building UI; lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; an independent authority review of the design and the code is recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["docs/autonomous-production-rehearsal-runbook.md", "docs/agent-guidance/index.json", "src/sessions/", "src/ask/", "src/production/", "src/workspace/"]
  - id: fix-serial-pr-base-stacking
    title: Open each serial Action's draft PR stacked on the previous candidate branch, keep the QA plan consistent with it, and prove a three-Action chain through the real lifecycle in the fast harness.
    status: done
    responsibility: agent
    effort: session
    next_action: Open each serial Action's draft PR stacked on the previous candidate branch, keep the QA plan consistent with it, and prove a three-Action chain through the real lifecycle in the fast harness.
    expected_artifact: Evidence satisfying Agent Ask fix-serial-pr-base-stacking
    clarification: clarified
    confidence: high
    source: Agent Ask fix-serial-pr-base-stacking-2026-10-06
    acceptance_criteria:
      - "Remote preservation opens a serial Action's draft PR **stacked**: when the candidate's base revision is not the tip of the Project's base branch on the remote (an earlier Action integrated locally and GitHub's base did not advance), the PR's base branch is the remote branch whose tip equals the candidate's base revision (the previous candidate's branch, found deterministically, for example by `git ls-remote`/`for-each-ref --points-at` on the remote and the Project's candidate branch naming), with a clear refusal and an escalation naming the exact blocker and remedy when no such branch exists (deleted or never pushed); the first Action and any candidate whose base equals the remote base behave exactly as today; no GitHub base push, merge or force push ever happens, and nothing in the Grant or Decision 0058 changes. The reason a stacked base was chosen is recorded on the receipt."
      - "The host-rendered Operator QA plan (Base, Candidate and the Step 2 changed-file list) describes the PR's real base so the plan, the PR's GitHub diff and the reviewers' evidence agree for stacked Actions; `scripts/qa-plan-consistency.ts` reports CONSISTENT for the serial case; the `it.fails` markers for Issue #987 in tests/fast-rehearsal/serial-two-action.test.ts and tests/qa-plan-pr-consistency.test.ts flip to passing (updated deliberately, with the companion pins revised to the new behaviour); the fast harness's fake gh models a PR whose base is a branch (three-dot diff against that branch, `baseRefOid` the branch tip) exactly as GitHub reports it."
      - "Readiness, both review steps, the settled-head push and integration remain correct with stacked bases, proven through the real lifecycle in the fast harness: the serial two-Action scenario integrates both Actions and a new three-Action chain scenario integrates all three with each PR stacked on the previous candidate branch, each PR's QA plan consistent with its GitHub diff, Action N admitted exactly once, no commit lost and the remote base never pushed; edge cases covered: the previous candidate's branch deleted on the remote (refusal plus one escalation), the previous PR closed or merged, a candidate whose base equals the remote base (unchanged), and the fault-injection scenarios still pass; `pnpm fast-rehearsal`, lint, tsc, check:agent-guidance, the preservation self-check and the focused suites pass; the runbook (section 8 item 1 and the failure catalog) and Issue #987 are updated; independent authority review rounds are recorded on the pull request; the governed reinstall after merge is the release manager's."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/987", "https://github.com/pmark/arcadia/issues/989", "tests/fast-rehearsal/README.md", "scripts/qa-plan-consistency.ts", "src/sessions/candidatePreservation.ts", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: fix-pending-completion-gate
    title: Surface a pending-Ask operator gate once in production status and recover the agent-left-extra-work and died-before-recorded completion stalls, proven in the fast harness.
    status: done
    responsibility: agent
    effort: session
    next_action: Surface a pending-Ask operator gate once in production status and recover the agent-left-extra-work and died-before-recorded completion stalls, proven in the fast harness.
    expected_artifact: Evidence satisfying Agent Ask fix-pending-completion-gate
    clarification: clarified
    confidence: high
    source: Agent Ask fix-pending-completion-gate-2026-10-06
    acceptance_criteria:
      - "When the worker tick skips a launch because resolveProjectTransition answers `decision` for an Action in the active Grant's scope (a pending unsettled Agent Ask proposal or open Decision), `arcadia production status` shows exactly one operator-gate entry for it within one tick (gate kind, Action, proposal or Decision id, and the exact governed settle command or the reason it cannot settle, for example 'Action is already done'), deduplicated like `terminal_candidate_not_integrable` (one escalation and one deduplicated worker log line, not one per tick), and cleared when the proposal is settled or rejected or the Decision answered; tests pin it, including run 2's shape (a stale pending proposal for an amended Action) and the #994 and #995 scenarios."
      - "Issue #994: an agent that leaves an extra uncommitted file or an extra commit after its completion settlement no longer stalls silently: the Action either integrates (only where the governed settlement and every guard stay intact; unreviewed extra work is never integrated) or stops on exactly one visible, actionable entry in production status; a continuation Session never loops on 'Action is already done'; the `it.fails` marker in tests/fast-rehearsal/settle-then-dirty.test.ts flips to `it` with its companion pin revised deliberately."
      - "Issue #995: an agent that dies after its settlement commit and before the settlement is recorded is recovered deterministically by the tick (no coding-agent process and no LLM call; for example recognising the candidate's own canonical completion settlement or auto-settling the drafted complete Ask whose evidence verbatim-covers every criterion, as attemptAutoSettlePendingCompletion already does before dispatch), and the Action integrates and the next Action is admitted exactly once; the `it.fails` marker in tests/fast-rehearsal/completion-faults.test.ts flips to `it` with its companion pin revised deliberately."
      - "No authority widens: no proposal is accepted whose evidence does not verbatim-cover the Action's declared criteria with every entry met, nothing outside the Grant's scope is launched or settled, and Decision 0058 and the Grant model are unchanged; `pnpm fast-rehearsal`, lint, tsc, check:agent-guidance and the focused suites pass; the runbook (failure catalog and section 8 item 6), tests/fast-rehearsal/README.md and Issues #994, #995 and #997 are updated; independent review rounds are recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/997", "https://github.com/pmark/arcadia/issues/994", "https://github.com/pmark/arcadia/issues/995", "https://github.com/pmark/arcadia/issues/968", "tests/fast-rehearsal/README.md", "src/ask/autoSettleBeforeDispatch.ts", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: build-chain-rehearsal-run-scripts
    title: Build one parameterised reset, G6, G7 and G8 operator script set for an N-Action serial rehearsal chain on the existing fixture, ready for run 6 with N=3 and an overnight run with N=9.
    status: done
    responsibility: agent
    effort: session
    next_action: Build one parameterised reset, G6, G7 and G8 operator script set for an N-Action serial rehearsal chain on the existing fixture, ready for run 6 with N=3 and an overnight run with N=9.
    expected_artifact: Evidence satisfying Agent Ask build-chain-rehearsal-run-scripts
    clarification: clarified
    confidence: high
    source: Agent Ask build-chain-rehearsal-run-scripts-2026-10-06
    acceptance_criteria:
      - One operator script set (reset, G6 preflight, G7 grant, G8 terminal Off) with descriptors in artifacts/generated/operator-scripts/ takes the run id, the Action count N (3 to 12), the previous run's receipts and the required Arcadia commits from one small reviewed per-run parameter file, so a new run is a reviewed parameter change and not a clone; each script keeps every authority bound of the run-5 set (fail-closed preconditions, refusing-form-only and one-shot where the run-5 script is, receipts and failure handoffs, never exporting the workspace, never touching earlier candidates or pull requests, never force-pushing, deleting or rewriting history); `scripts/check-operator-scripts.ts` and the operator-script tests pass; parameter files for run 6 (N=3) and the overnight run (N=9) are included, with the latter's previous-run bindings left to be filled from run 6's receipts.
      - "The reset handles run 5's terminal state without losing work or pushing a base other than its single validated reset commit: it verifies that the fixture clone's local main f68ec48 is preserved on run 5's remote candidate branch and pull request #5 (and Action 2's work on #6) before moving only the clone's local main back to GitHub's main, and refuses otherwise; it then renders the fixture Plan as a serial chain of N tiny dependent Actions (the existing three amended and new ones appended, each reading its predecessor's output so the chain is genuinely ordered), each with a fresh requirement input revision, a fresh unused completion request id and the leave-git-status-clean instruction; it validates with Arcadia's own discovery and a dry-run docs sync (every Action an update or create, no error, only Action 1 ready), handles every pending fixture proposal by state, commits once and pushes without force, runs docs sync and writes a receipt naming the new head, the starting head, every earlier candidate's tip and the N Action ids and completion ids."
      - "G6 binds the reset receipt, the main head and the installed broker revision exactly as the run-5 preflight does and requires the parameterised commits (the merged #987 stacking fix and the #997 gate fix, filled in when they merge); G7's one-shot Grant names exactly the N fixture Actions, with remote preservation and the Decision 0058 integration grant scoped to those Actions and the existing 12-hour expiry, and its descriptor tells the operator plainly what one press authorises for N Actions (if Decision 0058 or Issue #925's answer is limited to three Actions, the descriptor says so and the change stops for the operator instead of widening it); G8 proves terminal Off, reconciles all N candidates as integrated, preserved or empty, and copies the worker log into the run's evidence folder before its reviewed restart."
      - "Offline proof: the pure parts (parameter validation, Plan rendering for N=3 and N=9, completion-id freshness, previous-head checks) are unit-tested, and a read-only dry-run mode of the reset prints the exact planned fixture change and refusals against the real fixture state without writing anything; the runbook (sections 4, 5 and 8 items 1 and 4) names the new set and how to start a run from it; independent review rounds are recorded on the pull request; running the reset, G6, G7 and G8 remains the release manager's and the operator's, not this Action's."
    depends_on: []
    decisions: []
    references: ["docs/autonomous-production-rehearsal-runbook.md", "artifacts/generated/operator-scripts/reset-three-action-rehearsal-fixture-run5-2026-10-06.json", "artifacts/generated/operator-scripts/preflight-three-action-rehearsal-run5-2026-10-06.json", "artifacts/generated/operator-scripts/grant-production-three-action-rehearsal-run5-2026-10-06.json", "artifacts/generated/operator-scripts/restore-terminal-off-three-action-rehearsal-run5-2026-10-06.json", "https://github.com/pmark/arcadia/issues/987"]
  - id: fix-qa-plan-check-wording
    title: Render check-passes criteria in the Operator QA plan as bounded inspection steps that point the proof of passing at the declared-validation step.
    status: done
    responsibility: agent
    effort: session
    next_action: Render check-passes criteria in the Operator QA plan as bounded inspection steps that point the proof of passing at the declared-validation step.
    expected_artifact: Evidence satisfying Agent Ask fix-qa-plan-check-wording
    clarification: clarified
    confidence: high
    source: Agent Ask fix-qa-plan-check-wording-2026-10-06
    acceptance_criteria:
      - In src/sessions/operatorQaPlan.ts a criterion that is satisfied by running a declared validation command, or that names a script or command that must pass, renders as an inspection step whose Expected line is limited to what inspection shows (the file exists and what it contains) and points the proof of 'passes' explicitly at the declared-validation step and its exit-zero result; no QA criteria, reviewer prompts or other plan steps change; a unit test pins that the rendered step never claims source display proves a pass.
      - "A read-only check with the real QA reviewer on a plan rendered for run 5's Action 1 shape (as done for #974, recording the command and both verdict reports) shows no 'Operator QA plan' finding in two verdicts; if the reviewer cannot be run read-only from the candidate, the pull request says so plainly and the next live run's first QA verdict is named as the check."
      - "Lint, tsc, `pnpm fast-rehearsal` and the focused suites pass; the runbook failure catalog and Issue #986 are updated; independent review rounds are recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/986", "https://github.com/pmark/arcadia/issues/974", "src/sessions/operatorQaPlan.ts", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: add-long-chain-fast-rehearsal
    title: Add a nine-Action serial chain scenario over simulated hours to pnpm fast-rehearsal and fix or file every defect it finds.
    status: done
    responsibility: agent
    effort: session
    next_action: Add a nine-Action serial chain scenario over simulated hours to pnpm fast-rehearsal and fix or file every defect it finds.
    expected_artifact: Evidence satisfying Agent Ask add-long-chain-fast-rehearsal
    clarification: clarified
    confidence: high
    source: Agent Ask add-long-chain-fast-rehearsal-2026-10-06
    acceptance_criteria:
      - A new fast-rehearsal scenario drives a serial chain of nine tiny dependent Actions (three batches of three, each reading its predecessor's output) under one Grant through the real worker tick, preservation, stacked draft PRs, readiness, both review steps and local fast-forward integration, with simulated time spanning several hours inside the Grant's 12-hour expiry; it asserts every Action is admitted exactly once and integrated in order, each PR is stacked on the previous candidate branch with a QA plan consistent with its GitHub diff, no commit is lost, the remote base is never pushed, production status names the progress, and after the last Action the chain ends with nothing admitted and no silent stall.
      - "The scenario also covers, in the same or a sibling test, a chain that hits a blocker midway (a failing verdict on Action 5 and, separately, the Grant expiring before the chain finishes): the chain stops on exactly one named, visible entry in production status and never admits a later Action or stalls silently; any behaviour that does not hold today is either fixed in this Action or pinned as an `it.fails` expected failure naming a new Issue with a revival trigger."
      - "`pnpm fast-rehearsal` still finishes in a few minutes and passes; lint, tsc and the focused suites pass; tests/fast-rehearsal/README.md and the runbook name the scenario and what it proves; independent review rounds are recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["tests/fast-rehearsal/README.md", "tests/fast-rehearsal/three-action-chain.test.ts", "https://github.com/pmark/arcadia/pull/1006", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: set-run6-nine-action-chain
    title: Set run 6's chain length to nine Actions and make G8 prefer the G7 receipt that activated.
    status: done
    responsibility: agent
    effort: session
    next_action: Set run 6's chain length to nine Actions and make G8 prefer the G7 receipt that activated.
    expected_artifact: Evidence satisfying Agent Ask set-run6-nine-action-chain
    clarification: clarified
    confidence: high
    source: Agent Ask set-run6-nine-action-chain-2026-10-06
    acceptance_criteria:
      - artifacts/generated/operator-scripts/rehearsal-chain/params/run6-2026-10-06.json declares actionCount 9 with its notes updated; the run-6 launchers and descriptors are re-rendered with no drift (`render-rehearsal-chain-operator-scripts.ts --check`), the run-6 G7 descriptor states that one press authorises exactly nine named fixture Actions, and run 7's parameter file remains a nine-Action repeat whose run-6 bindings stay UNFILLED and refusing; every other run-6 binding and required commit is unchanged.
      - G8 (`rehearsal-chain/restore-terminal-off.sh`) chooses as its ownership basis the latest G7 receipt for this Grant that activated or succeeded, falling back to the latest receipt with actionIds only when none did, and a test proves that a later refused G7 attempt with different actionIds does not stop G8 from turning the run's Grant Off.
      - "The rehearsal-chain tests, `check:operator-scripts`, lint and tsc pass, the runbook's run-6 description says nine Actions, and an independent review round is recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/pull/1009", "artifacts/generated/operator-scripts/rehearsal-chain/params/run6-2026-10-06.json", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: fix-chain-scope-order-compare
    title: Compare Grant Action sets order-independently in the rehearsal chain G7 and G8, pinned by tests whose faked preview and status return a different order.
    status: done
    responsibility: agent
    effort: session
    next_action: Compare Grant Action sets order-independently in the rehearsal chain G7 and G8, pinned by tests whose faked preview and status return a different order.
    expected_artifact: Evidence satisfying Agent Ask fix-chain-scope-order-compare
    clarification: clarified
    confidence: high
    source: Agent Ask fix-chain-scope-order-compare-2026-10-06
    acceptance_criteria:
      - "`rehearsal-chain/grant.sh` accepts the preview when `scope.actions` and `scope.integrationGrant.actions` each contain exactly the run's N fixture Actions in any order (same set, same length, no duplicates, nothing extra) and still refuses a missing, extra or duplicated Action; `rehearsal-chain/restore-terminal-off.sh` owns and turns Off the run's Grant when the stored policy's `scope.actions` equal the G7 receipt's actionIds as a set, and still refuses a different set; no other check is loosened."
      - "`tests/rehearsal-chain-operator-scripts.test.ts` pins both: a faked preview (and stored policy for G8) returning the nine Actions in the live order observed in run 6's refused G7 (transform-start-marker, verify-final-rehearsal, write-start-marker, chain-step-04 to 09) passes G7 and lets G8 turn Off exactly once, while an extra or missing Action still refuses; the rehearsal-chain tests, `check:operator-scripts`, render `--check`, lint and tsc pass; an independent review round is recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/runs/20261006T151603Z-70938/preview.json", "artifacts/generated/operator-scripts/rehearsal-chain/grant.sh", "artifacts/generated/operator-scripts/rehearsal-chain/restore-terminal-off.sh"]
  - id: bound-variance-verdict-reruns
    title: Classify zero-defect non-PASS independent verdicts as variance and let the tick rerun them within a bound of two, with every rerun recorded and visible.
    status: done
    responsibility: agent
    effort: session
    next_action: Classify zero-defect non-PASS independent verdicts as variance and let the tick rerun them within a bound of two, with every rerun recorded and visible.
    expected_artifact: Evidence satisfying Agent Ask bound-variance-verdict-reruns
    clarification: clarified
    confidence: high
    source: Agent Ask bound-variance-verdict-reruns-2026-10-06
    acceptance_criteria:
      - The independent-review step classifies a non-PASS code-review or QA verdict as variance only when it has no finding other than refused not-applicable claims and no criterion judged fail (every non-pass criterion is not-applicable-refused or not-checked); for a variance verdict on the exact head the tick runs a fresh review of that same verdict kind at most 2 more times (3 attempts in total per verdict kind per head), recording each attempt and its classification; a verdict with any real finding or any criterion judged fail stops immediately with the existing `independent_verdict_failed` entry; a new head restarts the count; nothing else in review, readiness, integration, the Grant or Decision 0058 changes.
      - "`production status` and the worker log name each automatic rerun once (verdict kind, attempt n of 3, reason) and, when the bound is exhausted, one `independent_verdict_failed` entry that says the reruns are spent; the fast harness covers: a variance verdict then PASS integrates with no operator step; three variance verdicts stop on one visible entry; a real finding stops on the first attempt with no rerun; the stubbed reviewer counts prove no extra reviewer call beyond the bound."
      - "`pnpm fast-rehearsal`, lint, tsc, check:agent-guidance and the focused review suites pass; the runbook (sections 1 criterion 4, 3, 6 and the failure catalog) records the operator's 2026-10-06 choice and the new bound; Issue #1018 is updated; independent review rounds are recorded on the pull request, and the merge waits for the operator because it changes the repair budget."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1018", "src/production/independentReview.ts", "tests/fast-rehearsal/long-chain-verdict-failure.test.ts", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: prepare-run7-chain
    title: Fill run 7's parameters from run 6's receipts, make the chain reset position reopened and new fixture Actions in the queue, and make G6 check queue validity and read Codex capacity reliably.
    status: done
    responsibility: agent
    effort: session
    next_action: Fill run 7's parameters from run 6's receipts, make the chain reset position reopened and new fixture Actions in the queue, and make G6 check queue validity and read Codex capacity reliably.
    expected_artifact: Evidence satisfying Agent Ask prepare-run7-chain
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-run7-chain-2026-10-06
    acceptance_criteria:
      - "`rehearsal-chain/params/run7-2026-10-06.json` binds run 6's receipts exactly: reset run `20261006T141854Z-41044` (newHead 162f5b19), terminal Off run `20261006T160825Z-24828` (fixtureMain 6fbae8d6) and one candidate entry per integrated or preserved line of that G8's work-reconciliation (including PR #7 and stacked PR #8), with no UNFILLED value left; required commits include #1017 (3c67b0a8); descriptors re-render with no drift; the run-7 reset dry run is expected to plan moving the clone's local main from 6fbae8d6 back to GitHub main 162f5b19 only after verifying both run-6 candidates are preserved on GitHub, and never to push a base other than its single reset commit."
      - "The chain reset positions every reopened or created fixture Action in chain order through the governed `arcadia advance queue arrange` after its docs sync (keeping every other key's relative order), records the queue receipt in its receipt, and refuses if the queue is not `orderValid` with zero unpositioned afterwards; G6 refuses unless `orderValid` is true and `unpositionedCount` is 0; tests pin both (Issue #1015)."
      - "G6's Codex capacity check performs a fresh live read with a bounded retry before observing, and when the live read fails it names the failure (exit status or timeout) in the refusal instead of silently judging a stale cache (Issue #1016); tests pin both the success and the named-failure paths; the rehearsal-chain tests, `check:operator-scripts`, render `--check`, lint and tsc pass; the runbook names run 7; an independent review round is recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1015", "https://github.com/pmark/arcadia/issues/1016", "artifacts/generated/operator-scripts/rehearsal-chain/params/run7-2026-10-06.json", "artifacts/generated/operator-scripts/rehearsal-chain/reset.sh", "artifacts/generated/operator-scripts/rehearsal-chain/preflight.sh"]
  - id: prepare-run8-coherent-chain-fixture
    title: Render consistent N-Action Project and Plan wording in the chain reset, refuse any stated Action-count contradiction offline, and add run 8's parameters bound to run 7.
    status: done
    responsibility: agent
    effort: session
    next_action: Render consistent N-Action Project and Plan wording in the chain reset, refuse any stated Action-count contradiction offline, and add run 8's parameters bound to run 7.
    expected_artifact: Evidence satisfying Agent Ask prepare-run8-coherent-chain-fixture
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-run8-coherent-chain-fixture-2026-10-06
    acceptance_criteria:
      - The chain reset renders every fixture managed-document statement of the chain's size and purpose for the run's N (at least the fixture PROJECT.md outcome or mission text and the Plan title, goal, milestone and token_budget lines; a rendered Plan title such as 'Autonomous nine-Action rehearsal chain'), validated by Arcadia's own discovery and the dry-run docs sync exactly as today, changing no Action criteria, statuses, responsibilities or the genesis check, and committing it in the reset's single commit; if fixture PROJECT.md must change, its governed pointer and status fields are left untouched.
      - A deterministic coherence guard, run in both the reset (real and dry run) and G6, refuses when any fixture managed document (PROJECT.md, the Plan, the Actions' text) states a number of Actions or a rehearsal size other than the run's N (for example 'three-Action' or 'three dependent Actions' with N=9), naming the file, line and text; unit tests pin it for N=3 and N=9 and against run 7's actual fixture state at f478438 (which must refuse for N=9).
      - "`params/run8-2026-10-06.json` (N=9) binds run 7's receipts exactly: reset `20261006T173810Z-40687` (newHead f478438a), terminal Off `20261006T175308Z-12860` and one candidate per integrated or preserved line of its work-reconciliation (including run 7's PR #9), with required commits including #1019 (c26f3a9e) and #1020 (98b532a1); descriptors render with no drift; the rehearsal-chain tests, `check:operator-scripts`, render `--check`, lint and tsc pass; the runbook names run 8 and the coherence guard; an independent review round is recorded on the pull request."
    depends_on: []
    decisions: []
    references: ["artifacts/generated/operator-scripts/runs/20261006T175308Z-12860", "artifacts/generated/operator-scripts/rehearsal-chain/reset.sh", "src/operatorActions/rehearsalChain.ts", "docs/autonomous-production-rehearsal-runbook.md"]
  - id: record-rehearsal-findings-ledger
    title: Add a findings ledger, a per-run retro protocol, the next-run recommendations and a handoff section to the rehearsal runbook, and preserve the reviewer smoke harness.
    status: done
    responsibility: agent
    effort: session
    next_action: Add a findings ledger, a per-run retro protocol, the next-run recommendations and a handoff section to the rehearsal runbook, and preserve the reviewer smoke harness.
    expected_artifact: Evidence satisfying Agent Ask record-rehearsal-findings-ledger
    clarification: clarified
    confidence: high
    source: Agent Ask record-rehearsal-findings-ledger-2026-10-06
    acceptance_criteria:
      - docs/autonomous-production-rehearsal-runbook.md gains a findings ledger (one row per live run and per pre-flight smoke since run 1, each with stop point, failure class, time to detect, fix PR or Issue, and the prevention that now guards it), records runs 6 and 7 and the run-8 reviewer smoke with their receipts and PRs, and states the protocol every future run follows to append its row before the session ends.
      - The runbook gains a handoff section naming the exact current state (production Off, last receipts, next run id and its parameter file, open Issues blocking success) and the ranked recommendations for the next run, so a fresh session can start from it alone.
      - "The reviewer pre-flight smoke harness used for #986 and the run-8 check is preserved under docs/reports/rehearsal-reviewer-smoke/ with a README saying what it simulates, what is not faithful, how to run it read-only, and that it is reference code not yet wired into the operator scripts."
    depends_on: []
    decisions: []
    references: ["docs/autonomous-production-rehearsal-runbook.md", "https://github.com/pmark/arcadia/issues/1018"]
  - id: make-done-action-settlement-unambiguous
    title: Rewrite next_action when completion settlement marks an Action done, naming the completion request id.
    status: open
    responsibility: agent
    effort: session
    next_action: Rewrite next_action when completion settlement marks an Action done, naming the completion request id.
    expected_artifact: Evidence satisfying Agent Ask make-done-action-settlement-unambiguous
    clarification: clarified
    confidence: high
    source: Agent Ask run8-unambiguous-done-settlement-2026-10-06
    acceptance_criteria:
      - A successful complete settlement rewrites only the completed Action next_action to an unambiguous completed form naming the completion request_id, in active and non-active Plans; pending Actions keep their instructions.
      - Deterministic regression tests prove canonical completion rewriting, idempotency and refusal behavior remain correct.
      - pnpm fast-rehearsal passes with the settlement change.
      - A SMOKE_DRY=1 reviewer smoke built from the rendered run-8 Action 1 candidate proves its done record names the completion request id; paid smoke is held until this chat operator authorizes spend.
    depends_on: []
    decisions: []
    references: ["docs/autonomous-production-rehearsal-runbook.md#10-handoff-current-state-and-next-run-recommendations", "docs/reports/rehearsal-reviewer-smoke/run8"]
  - id: preserve-unchanged-baseline-skill-symlinks
    title: Implement protected preservation of unchanged baseline tracked symlink blobs without following candidate links, retaining the current escape and race guards.
    status: open
    responsibility: agent
    effort: session
    next_action: Finish protected preservation of unchanged baseline symlink blobs and provide the smallest supported host-owned reviewed-packet recovery path with disposable dry proof.
    expected_artifact: Evidence satisfying Agent Ask preserve-unchanged-baseline-skill-symlinks
    clarification: clarified
    confidence: high
    source: Agent Ask amend-preservation-host-packet-recovery-1032-2026-10-07
    acceptance_criteria:
      - Protected candidate capture retains an unchanged tracked mode-120000 baseline entry from its immutable Git blob without dereferencing it; candidate-added or modified symlinks and path escapes still refuse, and normal regular-file capture retains its existing guards.
      - Focused regressions and a hermetic invocation of the literal no-argument Claude preservation launcher prove successful capture, unchanged replay, changed-tree receipt identity, and refusal of modified/new symlinks, ancestor-link escapes and unsafe or raced regular-file inputs; failed capture does not change the candidate index.
      - "The PR #1033 repair and both preservation packets remain intact; evidence distinguishes reviewed source from installed runtime and gives the exact remaining bootstrap boundary without raw commits, symlink deletion, repeated unchanged refusals, installation or completion resettlement."
      - Typecheck, lint and focused preservation tests pass; run fast-rehearsal once on final changed source before any separately authorized installation.
      - "A single reviewed host-owned packet-recovery operation represents the approved Decision0086 envelope: exact Decision/answer, seven-file manifest, pinned base and candidate reservation; a clean isolated recovery candidate with normal hooks and resolved agent identity; drift refusal and resumable receipts; original contaminated history, fixture paths, #1033, Identity and every packet retained. Positive, refusal and interrupted/replay proofs use disposable fixtures. Preparation and dry proof do not execute recovery, publish source, install/restart, complete or activate production. Live execution remains operator-owned and requires the reviewed exact-scope Actions-page script; changing the approved seven-file publication envelope requires its own governed proposal rather than inferred authority."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1032", "src/sessions/candidateSnapshot.ts", "docs/working-copy-safety.md", "/private/tmp/run8-ci-preservation-handoff/manifest.json", "decision/0086", "docs/proposals/packet-only-host-bootstrap-recovery-1032.md", "/private/tmp/arcadia-run8-asks/resume-1032-final-packet/manifest.json"]
  - id: generate-neutral-rehearsal-dry-preparation
    title: Implement one resumable deterministic preparation command that generates a fresh N-neutral fixture baseline, reviewed descriptor inputs and dry proof from one parameter file, initially N=3.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement one resumable deterministic preparation command that generates a fresh N-neutral fixture baseline, reviewed descriptor inputs and dry proof from one parameter file, initially N=3.
    expected_artifact: Evidence satisfying Agent Ask generate-neutral-rehearsal-dry-preparation
    clarification: clarified
    confidence: high
    source: Agent Ask rehearsal-v1-preservation-and-neutral-prep-2026-10-06
    acceptance_criteria:
      - One parameter file pins run identity, N, the existing repository /Users/pmark/tmp/arcadia-three-action-rehearsal and pmark/arcadia-three-action-rehearsal-20261004, prerequisite revisions and preservation bindings. A fresh reproducible baseline uses N-neutral wording and step-01 through step-NN with serial dependencies; N=2, N=3 and another supported N render coherently without cloning run-specific amendments.
      - Dry preparation renders in an isolated output, checks fixture coherence and descriptor drift, validates managed-document shape using real Arcadia code, and resumes or reuses hash-bound completed stages. Drift or stale scope refuses. It retains existing Git history, candidates and receipts and performs no live workspace mutation, repository publication, reset, G6 execution, Grant creation, activation or service installation.
      - The concise preparation receipt binds parameters, baseline, descriptor and source hashes; states the exact next step and separate authority needed; reuses existing operator-script implementations and the governed Ask path for later fixture application. Changed operator flows update START_HERE.md.
      - SMOKE_DRY=1 uses the exact rendered Action 1 candidate and proves the six-call read-only QA/code-review request shape without paid calls. The maintained smoke gate permits exactly 3 QA plus 3 code-review calls only after this chat operator authorizes spend, requires all six first-attempt PASS on unchanged hashes, and refuses a G7-ready claim on a missing, failed or stale verdict.
      - V1 evidence evaluation requires at least 2 chained Actions, zero operator or release-manager interventions between G7 and G8, both independent verdicts PASS on attempt 1 per Action, and G8 terminal Off with zero live admissions. Existing variance reruns cannot satisfy V1; a live run-8 failure stops without fix-and-rerun.
      - Focused deterministic tests cover reproducibility, changed N, stale receipts, interrupted preparation, authority boundaries and smoke failure. Final changed source passes fast-rehearsal once before installation. No live success is claimed by dry proof.
    depends_on: [preserve-unchanged-baseline-skill-symlinks, make-done-action-settlement-unambiguous]
    decisions: []
    references: ["docs/autonomous-production-rehearsal-runbook.md", "src/operatorActions/rehearsalChain.ts", "scripts/render-rehearsal-chain-operator-scripts.ts", "docs/reports/rehearsal-reviewer-smoke/README.md", "https://github.com/pmark/arcadia/issues/1031"]
questions: []
decisions: []
recommended_model: claude-sonnet-5
recommended_reasoning_effort: high
---

# Bootstrap managed production to run unattended from the GitHub board

Created as an inactive draft from accepted Agent Ask managed-production-completion-first-handoff-2026-09-05; creation changed no pointer. Current activation is recorded in frontmatter.
