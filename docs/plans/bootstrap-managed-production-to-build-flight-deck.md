---
arcadia: v1
type: plan
slug: bootstrap-managed-production-to-build-flight-deck
project: arcadia
status: draft
milestone: Bootstrap managed production to build Flight Deck
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-09-05
actions:
  - id: implement-evidence-bound-action-completion
    title: Implement the operator-settled managed-Action completion routine so bootstrap work can advance from accepted evidence without hand-editing governance.
    status: open
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
    status: open
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
    status: open
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
    status: open
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
    status: open
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
    status: open
    responsibility: agent
    effort: session
    next_action: Launch the selected Codex or Claude adapter through the canonical Session subsystem.
    expected_artifact: Evidence satisfying Agent Ask support-selected-codex-and-claude-sessions
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Support both configured Codex and Claude selection results with provider-specific executable arguments and native Session identity in the existing Session model.
      - Reuse Claude packet/model/binding validation and add equivalent Codex validation, reattach/resume semantics and honest unsupported-operation messages.
      - Enforce repository lease admission across prepared/live Sessions and competing managed Runs, including canonical path aliases.
      - Use additive migration only if existing operational records require it; preserve older Session records and both existing execution paths.
      - Prove argument construction and spawn failure without live model invocation in deterministic tests.
      - "Preserve the proof Artifact: Provider adapter, lease conflict and backward-compatibility tests; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
    depends_on: [connect-action-to-launch-packet]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/sessions/index.ts", "src/commands/go.ts", "src/execution/runner.ts", "src/db/schema.ts"]
  - id: expose-guarded-host-session-launch
    title: Expose a bounded server launch operation with replay-safe receipts and fresh authority checks.
    status: open
    responsibility: agent
    effort: session
    next_action: Expose a bounded server launch operation with replay-safe receipts and fresh authority checks.
    expected_artifact: Evidence satisfying Agent Ask expose-guarded-host-session-launch
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Accept an explicit operator launch request for the previewed canonical Action; resolve repository, executable and arguments on the server.
      - Reject cross-origin, malformed, altered, stale and unauthorized requests; document/test the operator-action request guard for the existing local/tailnet deployment.
      - Revalidate pointer, documents, packet hash, Decisions, binding availability and repository lease immediately before preparation/spawn.
      - Two tabs or retried requests start at most one Session; lost-response recovery returns the durable result across restart.
      - Launch grants no implicit merge, integration, cleanup, deployment, spending, credential expansion or messaging; failures preserve recoverable work.
      - "Preserve the proof Artifact: Launch boundary, replay, crash-window and conflict integration tests; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
      - Support either a current explicit one-Session launch grant or a valid standing managed-production policy with an epoch-bound admission receipt; recheck Off immediately before launch commitment. Do not require a new human launch click for every authorized Action.
      - Inject pre/post-spawn crashes and lost responses; reconcile ambiguous launch identity without blind retry and prove at most one live conflicting execution.
    depends_on: [support-selected-codex-and-claude-sessions]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "apps/dashboard/lib/arcadia-cli.ts", "src/sessions/index.ts", "src/docs/dispatch.ts", "src/execution/planningAuthorization.ts"]
  - id: observe-portfolio-agent-sessions
    title: Show all active Sessions and Runs with fresh observation and native recovery access.
    status: open
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
    status: open
    responsibility: agent
    effort: session
    next_action: Reconcile Session exit into durable evidence and the next governed Action or Decision.
    expected_artifact: Evidence satisfying Agent Ask reconcile-session-exits-to-next-move
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Persist a thin exit observation/receipt through the existing operational model and link available Run, Artifact and Decision proof.
      - Distinguish successful exit, failed execution, missing evidence, needs input and accepted Action completion; zero exit never marks done by itself.
      - Release repository leases only on proven terminal state and preserve recoverable reconciliation errors.
      - Display the resulting canonical next Action or exact judgment/blocker with a usable link; automatic next admission only under the current Active production policy; no hand-edited governance state.
      - Retry/reconcile/reload is idempotent and does not duplicate completion, Decisions or execution.
      - "Preserve the proof Artifact: Exit-to-evidence-to-next-move lifecycle integration tests; include exact runnable target and operator QA steps in the PR, or state why no runnable surface exists."
      - Require criterion-level evidence bound to the exact Candidate revision and a separate review pass for nontrivial code and safety boundaries; unresolved blocking findings, missing/skipped checks and stale evidence prevent acceptance.
      - Prove the quality gate rejects deliberately failed tests, absent artifacts and false agent completion claims as specified in contract 20.
    depends_on: [observe-portfolio-agent-sessions]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/sessions/index.ts", "src/commands/advance.ts", "src/stewardship/artifactValidator.ts", "src/docs/dispatch.ts"]
  - id: advance-approved-production-work
    title: Advance accepted production work through canonical completion, Log and pointer transitions.
    status: open
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
    status: open
    responsibility: agent
    effort: session
    next_action: Extend the existing worker to continuously admit, supervise and advance approved Sessions while Active.
    expected_artifact: Evidence satisfying Agent Ask feed-and-supervise-managed-production
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Reuse the existing persistent worker ownership, recovery, queue and Session paths; no second daemon, queue or browser-owned scheduling loop.
      - After a terminal accepted Action, re-evaluate current priority/capacity and launch the next eligible Action without a new human session, chat or Launch click.
      - Use atomic leases and capacity reservations across competing ticks/workers; independent Projects may run concurrently within configured provider/host limits, but conflicting repositories cannot.
      - Off remains responsive during running work and stops future launch commitments; worker restart reconciles existing work and policy epoch before admission.
      - Blocked approval, unavailable provider or failed Project permits independent eligible work to progress. Exhausted capacity schedules bounded rechecks; repeated failures have finite repair/retry limits and one actionable stop.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
      - Enforce finite repair/model-attempt budgets and deadlines; hung processes and disk/write failure remain visible and preserve work; do not release uncertain leases or loop across providers to bypass a failure.
    depends_on: [advance-approved-production-work, prove-provider-capacity-admission, expose-guarded-host-session-launch]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/commands/worker.ts", "src/dispatch/queue.ts", "src/dispatch/order.ts", "src/sessions/index.ts"]
  - id: expose-bootstrap-production-controls
    title: Expose the production switch, priority, capacity and review stops on the existing Work Queue.
    status: open
    responsibility: agent
    effort: session
    next_action: Expose the production switch, priority, capacity and review stops on the existing Work Queue.
    expected_artifact: Evidence satisfying Agent Ask expose-bootstrap-production-controls
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Add a minimal Active/Inactive control and desired-versus-observed status to /work-queue using the production service; no /flight-deck route or component is required.
      - Reuse existing Plan segment/Action priority previews, review destinations and Session links; show included scope, selected/next Action, capacity age and exact operator stops.
      - Every operator stop offers contextual multiple-choice options with the affected Project/Plan/Action, evidence, recommendation and consequence of each choice; preserve free-text direction and route the selected answer through existing canonical review/settlement controls.
      - The control works on phone and desktop and remains responsive during execution and slow source reads; Off follows the documented policy.
      - Extract the concrete production control for reuse by Flight Deck rather than building a second controller or state store.
      - Preserve a runnable QA Artifact naming exact URL, host, revision and recovery command.
      - Measure durable Off acknowledgment within two seconds on the recorded healthy local host under stalled execution/provider reads; persistence failure is visible within five seconds without false confirmation.
    depends_on: [feed-and-supervise-managed-production]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "apps/dashboard/app/work-queue/page.tsx", "apps/dashboard/app/api/work-queue/route.ts"]
  - id: prove-two-action-unattended-production
    title: Prove two dependent Actions run from one activation using the existing Work Queue production control.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove two dependent Actions run from one activation using the existing Work Queue production control.
    expected_artifact: Evidence satisfying Agent Ask prove-two-action-unattended-production
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Provide a disposable or explicitly approved real Project with two small dependent Actions and a reachable existing Work Queue production control before requesting live execution.
      - "Under bounded rehearsal authority activate once: Action A launches, validates, records canonical completion/pointer, and B launches without manual session setup or launch confirmation in between."
      - Turn Off during work; prove no later launch, preserved current output and visible terminal reconciliation. Close browser/restart worker and prove no duplicate or reactivation after Off.
      - Record exact revision, host, provider, Action/Session identities, receipts and every operator intervention; missing real authorization/input remains one precise review, never fixture-as-live success.
      - Complete this vertical proof before broad rail, capture, navigation polish or default-home cutover; reuse existing review/proof specialists as needed.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
    depends_on: [expose-bootstrap-production-controls]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "docs/operator-demo-and-release-contract.md", "docs/plans/idea-to-managed-build.md"]
  - id: prove-multi-provider-production-recovery
    title: Prove continuous production across configured providers, independent Plans and capacity recovery.
    status: open
    responsibility: agent
    effort: session
    next_action: Prove continuous production across configured providers, independent Plans and capacity recovery.
    expected_artifact: Evidence satisfying Agent Ask prove-multi-provider-production-recovery
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Demonstrate automatic selection/launch with both configured Codex and Claude, preserving per-account capacity and repository isolation; one-provider proof alone is not full acceptance.
      - Prove higher-priority provider-ineligible work remains visible while independent eligible work proceeds, and Plan order edits change subsequent admission without preempting running work.
      - Prove depletion/reset/re-observation resumes automatically while Active, with no paid/reset effect; distinguish simulated limit tests from observed live capacity evidence.
      - Exercise failed validation, bounded repair, mid-Session exhaustion/checkpoint recovery, stale policy, duplicate worker and approval boundaries; partial work must not be rerun blindly.
      - Publish live/fixture evidence for each boundary and exact outstanding gap; final acceptance requires supported automatic telemetry and no manual refresh/Session relay disguised as unattended operation.
      - Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof.
      - Pass the contract 20 deterministic fault matrix, at least 100 reproducible interleavings per race scenario, and bounded live soak of ten accepted Actions across two Projects/both providers with restart, Off and recoverable failure; retain all interventions and failures.
    depends_on: [prove-two-action-unattended-production]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "src/codingAgents/availability.ts", "src/commands/worker.ts", "docs/plans/provider-capacity-harvesting.md"]
  - id: freeze-production-runtime-and-handoff-flight-deck
    title: Freeze the proven production runtime and prepare Flight Deck as its first real production workload.
    status: open
    responsibility: agent
    effort: session
    next_action: Freeze the proven production runtime and prepare Flight Deck as its first real production workload.
    expected_artifact: Evidence satisfying Agent Ask freeze-production-runtime-and-handoff-flight-deck
    clarification: clarified
    confidence: high
    source: Agent Ask managed-production-completion-first-handoff-2026-09-05
    acceptance_criteria:
      - Identify and preserve the exact proven worker/runtime revision, service command, workspace/schema compatibility and rollback/recovery procedure independently of coding worktrees.
      - Prove that editing/building Flight Deck in an isolated Arcadia worktree does not replace, hot-reload or restart the controller; runtime upgrades require a separate controlled handoff.
      - Present the Flight Deck Plan scope and first two dependent Actions, current queue segment, automatic completion policy and external merge/publication boundaries as one handoff Artifact.
      - After bootstrap acceptance and approved Plan transition, the canonical pointer selects Flight Deck and production admits its first Action; no repeated human Session setup is required.
      - If Flight Deck cannot advance without a merge or subjective acceptance, show that exact approval in the existing review surface. Never weaken a gate to manufacture uninterrupted progress.
      - Publish the contract 20 release evidence index; every required proof is passed at the accepted revision, blocking findings are resolved, and independent status/Off plus recovery are exercised before unattended Flight Deck handoff.
    depends_on: [prove-multi-provider-production-recovery]
    decisions: []
    references: ["docs/plans/mission-control-view/17-managed-production-contract.md", "docs/plans/mission-control-view/18-bootstrap-then-dogfood.md", "docs/plans/mission-control-view/20-production-quality-and-reliability.md", "docs/working-copy-safety.md", "docs/plans/mission-control-view/14-flight-deck-plan-amendment.yaml"]
questions: []
decisions: []
---

# Bootstrap managed production to build Flight Deck

Created as an inactive draft from accepted Agent Ask managed-production-completion-first-handoff-2026-09-05; creation changed no pointer. Current activation is recorded in frontmatter.
