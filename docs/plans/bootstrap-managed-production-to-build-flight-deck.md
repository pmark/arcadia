---
arcadia: v1
type: plan
slug: bootstrap-managed-production-to-build-flight-deck
project: arcadia
status: active
milestone: Bootstrap managed production to run unattended from the GitHub board
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-09-22
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
    depends_on: [prove-two-action-unattended-production]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "apps/dashboard/app/work-queue/page.tsx", "apps/dashboard/app/api/work-queue/route.ts"]
  - id: prove-two-action-unattended-production
    title: Prove two dependent Actions run from one activation using the existing Work Queue production control.
    status: deferred
    responsibility: agent
    effort: session
    next_action: Prove two dependent Actions run from one activation using any reachable existing production control (the CLI production commands satisfy this; a dashboard control is not required for this proof), with one Action continued across two Sessions in the same candidate.
    expected_artifact: Evidence satisfying Agent Ask prove-two-action-unattended-production
    clarification: clarified
    confidence: high
    source: Agent Ask add-opencode-production-provider-2026-09-15-v2
    acceptance_criteria:
      - Provide a disposable or explicitly approved real Project with two small dependent Actions and a reachable existing production control (CLI or dashboard) before requesting live execution.
      - "Under bounded rehearsal authority activate once: Action A launches, validates, records canonical completion/pointer, and B launches without manual session setup or launch confirmation in between."
      - "Per Decision 0051, deliberately split one Action across Sessions: Session A edits the candidate and exits incomplete without Git common-directory writes; Session B launches in the same worktree and branch, sees Session A's changes and finishes; a concurrent second live execution against that candidate is refused; the next Action receives a fresh candidate from the new governed base; no operator branch, worktree, commit, stash, rebase or cleanup step occurs."
      - Turn Off during work; prove no later launch, preserved current output and visible terminal reconciliation. Close browser/restart worker and prove no duplicate or reactivation after Off.
      - Record exact revision, host, provider, Action/Session identities, receipts and every operator intervention; missing real authorization/input remains one precise review, never fixture-as-live success.
      - Complete this vertical proof before broad rail, capture, navigation polish or default-home cutover; reuse existing review/proof specialists as needed.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
    depends_on: [feed-and-supervise-managed-production, add-opencode-production-provider]
    decisions: []
    references: ["docs/decisions/0051-decide-whether-sequential-coding-agent-sessions-for-the-same-governed-action-may.md", "docs/proposals/host-owned-agent-workspace-contract.md", "docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "docs/operator-demo-and-release-contract.md", "docs/plans/idea-to-managed-build.md"]
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
    depends_on: [prove-two-action-unattended-production]
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
    depends_on: [prove-two-action-unattended-production, expose-bootstrap-production-controls]
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
    status: open
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
    status: open
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
    status: open
    responsibility: agent
    effort: session
    next_action: Add the one-line defect intake and automatic bounded triage loop approved by Decision 0049.
    expected_artifact: Evidence satisfying Agent Ask build-autonomous-defect-loop
    clarification: clarified
    confidence: high
    source: Agent Ask implement-autonomous-defect-triage-2026-09-12
    acceptance_criteria:
      - "`arcadia defect <summary>` records a durable Back Burner defect signal with a stable id and automatically captured Project, source, time, repository revision when available, and optional evidence; successful intake makes zero model calls."
      - "Repeated intake is lossless and replay-safe: exact retries are idempotent, deterministic matching identifies likely duplicates without silently discarding distinct reports, and the reporter receives the durable record id."
      - The existing persistent worker periodically admits defect triage under one explicit token and attempt budget, performs deterministic reproduction and deduplication before any model call, and reuses fresh included-capacity receipts when available; unknown capacity, purchased credits, and reset redemption never count as free.
      - "Each triage run leaves a durable disposition and evidence: close noise, enrich or link a duplicate, preserve a waiting item with a concrete trigger, promote a formal governed Action into the explicit queue, or perform a validated low-risk reversible repair within standing authority."
      - A stop-the-line defect bypasses periodic cadence when it blocks unrelated work, requires a remembered human workaround, or blocks its own reporting or repair; promotion changes the queue and current pointer rather than merely adding an urgent label.
      - Merge, deployment, publication, spending, credentials, messaging, production access, destructive changes, operator judgment, and any authority not already granted remain gated; automation reports the exact gate instead of treating urgency as permission.
      - Deterministic tests cover zero-model intake, retry, duplicate candidates, periodic budget exhaustion, worker restart, stale or unknown capacity, Action promotion, safe repair, a refused consequential repair, and immediate stop-the-line escalation.
      - The operator-facing QA plan includes exact CLI intake, worker/recovery command, Back Burner and queue inspection steps, observable expected results, and whether the procedure is also the end-user procedure.
    depends_on: [make-go-total-across-plans]
    decisions: []
    references: ["docs/decisions/0049-add-a-one-line-defect-intake-whose-periodically-token-budgeted-back-burner-proce.md", "docs/decisions/0037-project-to-arcadia-signal-channel.md", "docs/plans/provider-capacity-harvesting.md", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "src/commands/worker.ts"]
  - id: build-agent-agnostic-learning-loop
    title: Let Arcadia and every Project capture concise lessons cheaply and automatically turn supported lessons into durable reusable capability.
    status: open
    responsibility: agent
    effort: session
    next_action: Let Arcadia and every Project capture concise lessons cheaply and automatically turn supported lessons into durable reusable capability.
    expected_artifact: Evidence satisfying Agent Ask build-agent-agnostic-learning-loop
    clarification: clarified
    confidence: high
    source: Agent Ask implement-agent-agnostic-learning-loop-2026-09-12
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
    depends_on: [build-autonomous-defect-loop]
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
    status: open
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
    status: open
    responsibility: agent
    effort: session
    next_action: A session that cannot finish its Action ends by completing the finishable slice and queueing the remainder as new Actions in the same PR, so the pointer always advances.
    expected_artifact: Evidence satisfying Agent Ask divide-instead-of-stall
    clarification: clarified
    confidence: high
    source: Agent Ask one-session-completes-one-action-2026-09-13
    acceptance_criteria:
      - arcadia go refuses to end a session with the current Action unchanged unless it records an operator question or external blocker.
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
    status: open
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
    status: open
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
    status: open
    responsibility: agent
    effort: session
    next_action: Prove the contract-20 fault-injection matrix and staged evidence bundle before any unattended production handoff.
    expected_artifact: Evidence satisfying Agent Ask prove-managed-production-fault-matrix
    clarification: clarified
    confidence: high
    source: Agent Ask retire-flight-deck-from-fault-matrix-2026-09-20
    acceptance_criteria:
      - Each deterministic race scenario in the contract-20 boundary table (admission/launch, completion/pointer, Off, process health, capacity, priority/authority, runtime) is repeated at least 100 times with reproducible seeds/interleavings, with zero invariant violations and retained failing-seed/timeline evidence for any violation found and fixed.
      - The two-dependent-Action live rehearsal passes from one activation with no manual Session relay, with every human intervention recorded.
      - Both configured providers complete real bounded Actions, with capacity failure/reset tests naming which evidence is real and which is simulated.
      - "A bounded real soak completes: at least ten accepted small Actions across at least two Projects and both providers, across two worker restarts, an Off/reactivation, and one injected recoverable failure, with zero duplicate launches, lost outputs, unauthorized transitions, falsely accepted results, or manual Session relays."
      - A single release evidence index maps every required invariant and quality gate to pass/fail/unproven, revision, artifact, and reproduction procedure.
    depends_on: [feed-and-supervise-managed-production]
    decisions: []
    references: []
  - id: combine-advance-monitor-next-into-one-brief
    title: One broker call from a prepared worktree returns the combined result of today's separate advance reconciliation, work-monitor preflight, and next dispatch-brief resolution, and arcadia-go.SKILL.md issues that one call instead of three.
    status: open
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
    status: open
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
    status: open
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
    status: open
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
    status: open
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
    status: open
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
    status: open
    responsibility: agent
    effort: session
    next_action: Add a /runs approval queue that presents only terminal operator-only approvals, each with its essential recommended option and a details expansion containing evidence, costs, consequences, alternatives, exact canonical settlement effect, and a bounded operator-script control when Arcadia can derive a scriptable step.
    expected_artifact: Evidence satisfying Agent Ask surface-terminal-operator-approvals-in-runs
    clarification: clarified
    confidence: high
    source: Agent Ask add-runs-operator-script-controls-v3-2026-09-19
    acceptance_criteria:
      - /runs lists every pending Agent Ask and other terminal operator-only approval that blocks managed production, while excluding mechanics agents may safely perform.
      - Each queue item offers one minimal recommended action plus an expandable details view that states evidence, cost, consequence, alternatives, and what the canonical settlement will change.
      - Choosing an option invokes the existing fingerprinted canonical settlement path, preserves approval boundaries, and records one durable receipt.
      - For every bounded scriptable operator step Arcadia derives, it writes a short-lived script and an arcadia-operator-script-v1 descriptor only beneath artifacts/generated/operator-scripts/; /runs displays the descriptor's problem, desired effect, exact CLI invocation, checksum, prerequisites, authority boundary, success next step, and failure next step.
      - A script failure writes a timestamped, immutable failure handoff and complete run log beneath that script's generated directory; /runs exposes both as the exact input for a coding agent to diagnose the first failed command and propose a narrower follow-up script.
      - The /runs execute control sends only the selected fingerprinted script descriptor to the host-side service controller; it records output and a durable receipt, refuses when that controller is unavailable or the descriptor is stale, and never lets a browser execute an arbitrary command.
      - Regression tests cover prioritization, minimal-versus-expanded rendering, stale-preview refusal, successful operator settlement, generated-script integrity, failure-handoff generation, unavailable-host refusal, and successful host-mediated execution.
    depends_on: []
    decisions: []
    references: ["apps/dashboard/app/runs", "apps/dashboard/components", "src/agentAsk", "src/dashboard/snapshot.ts", "src/commands/agentAsk.ts", "docs/plans/mission-control-view/17-managed-production-contract.md", "scripts/services.sh", "src/commands/worker.ts", "artifacts/generated/operator-scripts"]
  - id: reference-constitution-without-duplicating-it
    title: Replace repeated Constitution text in dispatch, next, and session briefs with one canonical repository reference and content fingerprint; load only the applicable canonical clauses at an authority-sensitive boundary.
    status: open
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
    status: open
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
    status: open
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
questions: []
decisions: []
current_action: self-heal-hung-worker-heartbeat
recommended_model: claude-sonnet-5
recommended_reasoning_effort: high
---

# Bootstrap managed production to run unattended from the GitHub board

Created as an inactive draft from accepted Agent Ask managed-production-completion-first-handoff-2026-09-05; creation changed no pointer. Current activation is recorded in frontmatter.
