---
arcadia: v1
type: plan
slug: make-arcadia-go-orient-one-caller-truthfully-before-authorized-work
project: arcadia
status: active
milestone: Make Arcadia Go orient one caller truthfully before authorized work.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-29
actions:
  - id: resolve-go-caller-context
    title: "Resolve the existing Go/advance/next orientation from one caller-bound read-only context. Recommended role: implementer, standard tier. Size M; execute only after a named source assignment; no activation, installation or merge."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-go-caller-context-20261016-01a143a6; no further action.
    expected_artifact: Evidence satisfying Agent Ask resolve-go-caller-context
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-truthful-orientation-20261016-01a143a6-r2
    why: "A useful Go brief must describe the caller’s actual assignment without hiding the separately selected pointer."
    acceptance_criteria:
      - "Requirement REQ-001. Given a registered Project whose pointer names Action A and a caller candidate with a valid own claim for Action B, the existing read-only orientation resolves repository/base and caller worktree, Project, active Plan and selected Action A, assigned Plan/Action B and claim identity separately; actual Session id/status is present only when canonical Session evidence exists. Expected proof: hermetic distinct-A/B fixture through advance and next/combined-brief consumers; titles and acceptance refer to B when assigned, never silently A. Center this correction on src/goBroker.ts brief integration: advance currently receives request.source while nextRunner receives only workspace/project; reuse current dispatch/gate resolution rather than inventing a second resolver."
      - "Requirement REQ-002. Given no own claim, another caller’s claim, a stale/conflicting claim, an unknown repository or missing/ambiguous Project/Plan/Action record, orientation shows selected work separately and either no assignment or one exact existing refusal; it never steals/rebinds a claim, invents a Session or authorizes work. Expected proof: focused fixtures for each case including cross-Project/cross-Plan and secret-redaction assertions."
      - "Requirement REQ-003. Rendering orientation reports observed ongoing ownership and related Plans with source/time and a bounded summary, plus the next permitted step or exact gate. Identical pinned inputs produce identical output. Expected proof: read-only adapter spies and before/after snapshots prove zero Project/queue/claim/admission/Git/worktree mutations and zero provider calls; malformed/missing evidence remains visible."
      - Focused context/advance/next/brief tests, TypeScript, lint and build pass; retain failed-first evidence for any reproduced caller-versus-registered-path defect. Read-only orientation does not implement orchestrator replacement or modify the existing live control/admission policy.
    depends_on: []
    decisions: []
    references: ["agentask_e5f269308aded23266", "lesson_c9ebb19d9dbb00316d56", "docs/planning-process.md", "docs/agent-guidance/chat-titles.md", "agentask_1220d0d060493d6292", "src/commands/advance.ts", "src/commands/next.ts", "src/briefSupervisor.ts", "src/sessions/hostEnrollment.ts", "tests/brief-supervisor.test.ts", "tests/go-broker.test.ts", "docs/agent-guidance/continuation.md", "Agent Ask plan-go-truthful-orientation-20261016-01a143a6 rationale retains independent critique and deferred triggers", "src/goBroker.ts"]
  - id: reuse-go-context-through-authorized-continuation
    title: "Use the caller-bound orientation in the existing protected Go continuation while preserving stable replay and all host authority gates. Recommended role: implementer, standard tier. Size M; execute only after a named source assignment; no activation, installation or merge."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-go-caller-continuation-20261027-01a17e94; no further action.
    expected_artifact: Evidence satisfying Agent Ask reuse-go-context-through-authorized-continuation
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-truthful-orientation-20261016-01a143a6-r2
    why: "Orientation and actual continuation must name the same work and avoid duplicated effects on retry."
    acceptance_criteria:
      - "Requirement REQ-004. The existing protected entry path emits or returns read-only orientation before optional preparation and binds authorized continuation to caller, Project/Plan/Action and current evidence. Initial preparation revalidates the selected snapshot. An already-assigned caller retains B if unrelated selected pointer A advances to C while its own claim remains valid; it refuses revoked/stale B ownership, incompatible packet or authority/policy evidence, dirty or occupied candidate, foreign custody or missing required permission before an unauthorized effect. Expected proof: A-to-C/B-still-owned and revoked-B fixtures plus changed initial snapshot cases, retaining every existing approval, cleanliness, custody, preservation and production check."
      - Requirement REQ-005. Integration fixtures invoke the existing fixed arcadia-go-broker-codex/claude/opencode request entry (scripts/arcadia-go-broker.ts) and the supported requestId-bearing enrollment receipt boundary, not merely the enrollment unit helper. Exact caller/request/input replay or recovery after interruption returns the same supported enrollment/preparation identity and candidate, or the existing in-progress/refused state; changed input under that identity refuses. Concurrent repeats produce at most one claim/candidate/Session. Reuse stable enrollment semantics and existing host-observable identity; no second identity transport or enrollment wrapper. If an ordinary Go entry cannot retain/recover its identity within existing host mechanisms, retain that exact integration gap as a governed follow-up instead of silently expanding this Action or fabricating native-adopt support.
      - Go/brief orientation does not invoke Tidy, retire/delete/reset worktrees or remove unique work. Monitor/brief retain the existing 25-second bounded supervisor/error contract and every safety check; a metadata-heavy deterministic fixture verifies bounded initial rendering and exact timeout stage without claiming a live performance guarantee. Optimization beyond that is deferred until profiling proves a remaining bottleneck.
      - Existing Go, enrollment, protected broker, preservation and fast-rehearsal regressions pass with zero live provider calls or host installation. Source, installed adoption and live proof are recorded as separate stages.
    depends_on: [resolve-go-caller-context]
    decisions: []
    references: ["agentask_e5f269308aded23266", "lesson_c9ebb19d9dbb00316d56", "docs/planning-process.md", "docs/agent-guidance/chat-titles.md", "agentask_1220d0d060493d6292", "src/commands/go.ts", "src/sessions/enrollment.ts", "src/sessions/hostEnrollment.ts", "src/briefSupervisor.ts", "tests/go.test.ts", "tests/session-enrollment.test.ts", "tests/host-enrollment-managed.test.ts", "tests/brief-supervisor.test.ts", "Agent Ask plan-go-truthful-orientation-20261016-01a143a6 rationale retains independent critique and deferred triggers", "src/goBroker.ts", "scripts/arcadia-go-broker.ts", "tests/enrollment-request-executor.test.ts", "tests/go-request-transport.test.ts"]
  - id: project-go-context-as-compact-state-signals
    title: "Project Go context into existing title guidance and compact truthful acknowledgment/state changes across the three native agent paths. Recommended role: implementer, standard tier. Size M; execute only after a named source assignment; no activation, installation or merge."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-go-state-signals-20261027-rowan; no further action.
    expected_artifact: Evidence satisfying Agent Ask project-go-context-as-compact-state-signals
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-truthful-orientation-20261016-01a143a6-r2
    why: "The operator needs to see whose work is active and what needs attention without a context dump."
    acceptance_criteria:
      - "Requirement REQ-006. Existing sessionTitles generation and shared native instructions preserve canonical kind/state, distinguishing Plan/Action or workstream identifiers early, and a helper marker only for a verified parent. Observed state transitions update supported host titles; idle/end-of-turn alone cannot imply pause, done or custody release. Expected proof: deterministic title fixtures for selected A/assigned B, no Session, working, PR/review, checks, needs-input, external-blocked, completed and deliberate hold states; no new role or independent title truth store."
      - "Requirement REQ-007. Existing brief/instructions specify an immediate compact acknowledgment of the actual observed state and subsequent state-change updates, with detail available on demand. The no-worker example must not claim an active team; native activity must not claim governed Session admission; a missing title tool must be disclosed rather than asserted as updated. Expected proof: checked-in rendered examples/fixtures for Codex, Claude Code and OpenCode; identify any unverified runtime support explicitly."
      - Shared guidance remains one authoritative source delivered by existing generators; regenerate affected managed regions and run canonical guidance/budget checks plus focused title/brief tests, TypeScript, lint, build and fast-rehearsal. Update START_HERE.md for any changed user-visible Go behavior with executable QA steps that keep local fixtures and live-provider acceptance distinct.
    depends_on: [resolve-go-caller-context, reuse-go-context-through-authorized-continuation]
    decisions: []
    references: ["agentask_e5f269308aded23266", "lesson_c9ebb19d9dbb00316d56", "docs/planning-process.md", "docs/agent-guidance/chat-titles.md", "agentask_1220d0d060493d6292", "docs/agent-guidance/continuation.md", "docs/agents-context.md", "src/sessions/actionBrief.ts", "tests/action-brief.test.ts", "START_HERE.md", "Agent Ask plan-go-truthful-orientation-20261016-01a143a6 rationale retains independent critique and deferred triggers"]
  - id: project-go-orientation-for-the-operator
    title: Serve Go's resolution to the operator workspace per Project, and as a portfolio summary, as a read-only and journal-free read from the existing resolver.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-go-operator-orientation-20261027-rowan; no further action.
    expected_artifact: Evidence satisfying Agent Ask project-go-orientation-for-the-operator
    clarification: clarified
    confidence: high
    source: Agent Ask amend-go-workspace-ui-actions-20261027-r3
    acceptance_criteria:
      - A read-only route returns, per Project, Go's selected Plan and Action, its dispatchable verdict, the operator question or first blocker with its remedy, and ongoing claims and Sessions with source and observed time, using the existing dispatch and gate resolution rather than a second resolver.
      - Read-only adapter spies and before/after snapshots prove zero dispatch-journal, Project, queue, claim, admission, Git and worktree writes and zero provider calls; identical pinned inputs give identical output, and an unreadable Project is listed with its exact error, never dropped.
      - The workspace reads this route instead of the journaled continuation GET; the existing workspace end-to-end suite passes unchanged in intent.
      - Registry and discovery fixtures retain every configured Project, including unreadable directory, stat and document-read failures, with the exact per-Project error and source; no discovery exception silently drops a Project or produces a dispatchable verdict from missing evidence.
    depends_on: [resolve-go-caller-context]
    decisions: []
    references: ["agentask_ac0f04ed38fa1264ec", "asksettle_e005780d8bc44d1aba", "agentask_1b49d1d91f4662bfac", "agentask_0c62dc0a9245204aeb", "agentask_58b16fc9b8aec479e0"]
  - id: show-receipts-for-operator-directions
    title: "Record and show an operator direction's receipts as distinct evidence-backed states: submitted, delivered, acknowledged, continued and verified, plus unknown and held."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-operator-direction-receipts-source-20261028; no further action.
    expected_artifact: Evidence satisfying Agent Ask show-receipts-for-operator-directions
    clarification: clarified
    confidence: high
    source: Agent Ask amend-go-workspace-ui-actions-20261027-r3
    acceptance_criteria:
      - An operator direction addressed to an explicit Project, Plan or Action carries a stable request id; exact replay returns the same receipt and changed input under the same id refuses.
      - "Each state is set only by its own evidence: delivered when a native checkpoint that the recipient reads records it, acknowledged from the recipient's compact acknowledgment, continued from a subsequently observed state change; storage alone never implies delivered or acknowledged."
      - A stopped or paused recipient leaves the direction held, and an uncertain submission shows as unknown and is never resent automatically; the workspace renders every state with end-to-end coverage for held and unknown.
      - A submitted state requires a durable accepted direction receipt that pins the stable request id, target and content; a rejected submission records its refusal and an uncertain submission remains unknown. A transition fixture names the evidence artifact, source and observed time for every submitted, delivered, acknowledged, continued, verified, unknown and held state.
      - A verified state requires separately observed acceptance evidence tied to the direction and resulting revision or artifact, with its verification result and provenance; recipient self-report, storage, delivery, acknowledgment or continuation alone never sets verified. Transition fixtures refuse missing, stale or mismatched evidence and preserve the last supported state with the unresolved reason shown.
    depends_on: [reuse-go-context-through-authorized-continuation, project-go-context-as-compact-state-signals]
    decisions: []
    references: ["agentask_ac0f04ed38fa1264ec", "asksettle_e005780d8bc44d1aba", "agentask_1b49d1d91f4662bfac", "agentask_0c62dc0a9245204aeb", "agentask_58b16fc9b8aec479e0"]
  - id: continue-from-go-in-the-workspace
    title: Offer Go's next permitted move as a Continue control in the workspace through the existing protected continuation, and complete one bounded real operator-assisted delivery through it.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement the remaining acceptance evidence for the existing workspace Continue after the approved probe delivery, retaining its four declared criteria and recording actual separate source, adoption and live results.
    expected_artifact: Evidence satisfying Agent Ask continue-from-go-in-the-workspace
    clarification: clarified
    confidence: high
    source: Agent Ask sequence-approved-go-probe-return-20261028
    acceptance_criteria:
      - Continue appears only when Go's resolution for the shown Action is dispatchable, previews target, owner, provider and limits before commitment, and invokes the existing protected Go continuation with a stable request id so that repeated or concurrent presses produce at most one claim, candidate and Session.
      - A resolution that changed after it was shown refuses with the changed facts and offers a fresh read; no approval, credential or production gate is bypassed, and Production stays Off unless separately started.
      - One bounded real operator-assisted delivery through the workspace is recorded with its receipts and pull request, with source, installed adoption and live proof recorded as separate stages.
      - The delivery record names separate evidence artifacts and verification results for source revision and required checks, installed adoption revision and receipt, and live attempt receipts and observed outcome. A failed, blocked or unknown stage is recorded explicitly and never inferred successful from another stage; real-delivery acceptance requires the declared live proof under separately valid authority.
    depends_on: [reuse-go-context-through-authorized-continuation, project-go-orientation-for-the-operator, show-receipts-for-operator-directions, implement-go-live-delivery-checklist]
    decisions: []
    references: ["agentask_ac0f04ed38fa1264ec", "asksettle_e005780d8bc44d1aba", "agentask_1b49d1d91f4662bfac", "agentask_0c62dc0a9245204aeb", "agentask_58b16fc9b8aec479e0"]
  - id: continue-through-approved-scope-from-the-workspace
    title: Let the operator approve one bounded scope of eligible Actions once in the workspace, and have Go continue through it one Action at a time, stopping at the first gate with the reason shown.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement the approved bounded continuation scope in the workspace, one eligible Action at a time, preserving every declared criterion and stopping at the first gate.
    expected_artifact: Evidence satisfying Agent Ask continue-through-approved-scope-from-the-workspace
    clarification: clarified
    confidence: high
    source: Agent Ask sequence-approved-go-probe-return-20261028
    acceptance_criteria:
      - Implementation starts only after the separate bounded-continuation scope Decision from Agent Ask propose-go-bounded-continuation-scope-decision-20261027 is opened and answered by the operator, the answered option permits bounded continuation, and a fresh named source assignment is recorded; fixtures implement that answered option. Until then the workspace offers only the separately authorized one-Action Continue. If the operator selects one Action per press, the fourth Action is not built.
      - The preview names the exact ordered Actions in scope from Go's own resolution, the owner, provider and limits for each, and every stop condition; an approval covers only that recorded scope and expires when Go's resolution for it changes, and the workspace never selects or reorders work.
      - Go continues to the next Action in scope only after the previous one completes through its governed settlement, one Session at a time, reusing the protected continuation's stable identity so repeated or concurrent presses create no second writer.
      - Continuation stops and shows the reason at the first open Decision, review or merge gate, failure, exhausted repair or usage limit, Action outside the scope, pause request or changed resolution; it never answers a Decision, merges, crosses an approval boundary or starts Production, which stays Off unless separately started.
      - End-to-end coverage proves a scope of at least two Actions continuing through one settlement and stopping at a gate, plus a pause mid-scope; one real bounded run through the workspace is recorded with its receipts, with source, installed adoption and live proof as separate stages.
      - The delivery record names separate evidence artifacts and verification results for source revision and required checks, installed adoption revision and receipt, and live attempt receipts and observed outcome. A failed, blocked or unknown stage is recorded explicitly and never inferred successful from another stage; real-delivery acceptance requires the declared live proof under separately valid authority.
    depends_on: [continue-from-go-in-the-workspace]
    decisions: []
    references: ["agentask_ac0f04ed38fa1264ec", "asksettle_e005780d8bc44d1aba", "agentask_1b49d1d91f4662bfac", "agentask_0c62dc0a9245204aeb", "agentask_58b16fc9b8aec479e0"]
  - id: implement-go-live-delivery-checklist
    title: Implement a concise Go live-delivery evidence checklist in START_HERE.md through one protected workspace Continue Session.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a concise Go live-delivery evidence checklist in START_HERE.md through one protected workspace Continue Session.
    expected_artifact: Evidence satisfying Agent Ask implement-go-live-delivery-checklist
    clarification: clarified
    confidence: high
    source: Agent Ask insert-approved-host-completion-repair-20261029-r3
    acceptance_criteria:
      - START_HERE.md contains a concise Go delivery checklist that separately names source revision and required checks, installed revision and adoption receipt, and actual workspace Session receipt, observed result and resulting delivery PR; it never describes planning-only output, storage, source tests or installation as real-delivery acceptance.
      - The checklist tells the operator to inspect the protected Continue preview target, owner, configured provider and limits, retain stable request and Session receipts, reconcile an unknown outcome before another press, and stop on changed facts or an existing approval gate; Production remains Off unless separately started.
      - The implementation changes only START_HERE.md apart from canonical Agent Ask completion records. The existing node scripts/preservation-self-check.mjs validation and git diff --check pass. Completion evidence describes this source checklist only and does not assert that its own future PR already exists.
    depends_on: [reuse-go-context-through-authorized-continuation, project-go-orientation-for-the-operator, show-receipts-for-operator-directions, repair-host-owned-source-completion-capabilities]
    decisions: []
    references: ["decision/should-arcadia-add-the-bounded-host-completion-repair-before-retrying-r465", "https://github.com/pmark/arcadia/issues/1864", "agentask_33a2ae289adae37e03", "agentask_c2535307f9d97b4915", "https://github.com/pmark/arcadia/pull/1851"]
  - id: repair-host-owned-source-completion-capabilities
    title: Implement host-owned source completion capability requirements so a source-only managed Session can produce its local completion Ask without direct live-workspace writes.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement host-owned source completion capability requirements so a source-only managed Session can produce its local completion Ask without direct live-workspace writes.
    expected_artifact: Evidence satisfying Agent Ask repair-host-owned-source-completion-capabilities
    clarification: clarified
    confidence: high
    source: Agent Ask insert-approved-host-completion-repair-20261029-r3
    why: "The required workspace-write probe currently stops a source-only Session before its supported local-Ask-to-host completion path."
    acceptance_criteria:
      - Host-derived completion capability requirements are bound to the Session, immutable packet and probe nonce. The model cannot choose weaker requirements. Source-only host-owned completion truthfully records unavailable direct workspace writes without treating them as passed, while genuinely required direct-write denial still refuses.
      - A restricted-environment regression carries permitted source edits and a validated local complete Ask (including preview_blocked) through real host validation and settlement while the model cannot write the live database. Missing local Ask transport or fresh host readiness, malformed/mismatched/spoofed evidence, and incompatible requirements all refuse before completion.
      - Existing sandbox protections, packet/custody/validation/preservation gates, default models, consumed attempts and failed R465 outcome remain intact. START_HERE.md documents the changed source-only completion flow and its separate review, adoption and fresh-live gates; Production remains Off.
      - Focused behavioral regressions, TypeScript, lint, build, preservation-self-check and isolated fast-rehearsal pass. Source completion evidence records exact revisions and results without claiming a future PR, installed adoption or R465 live success; independent current-head review and required CI plus separately receipted adoption remain prerequisites to any fresh guarded R465 delivery.
    depends_on: [reuse-go-context-through-authorized-continuation]
    decisions: []
    references: ["decision/should-arcadia-add-the-bounded-host-completion-repair-before-retrying-r465", "https://github.com/pmark/arcadia/issues/1864", "session_f5bd5319d14440c485", "exit_9b9babb972b444e59d"]
questions: []
decisions: []
current_action: implement-go-live-delivery-checklist
recommended_model: standard
recommended_reasoning_effort: medium
---

# Make Arcadia Go orient one caller truthfully before authorized work.

Created as an inactive draft from accepted Agent Ask plan-go-truthful-orientation-20261016-01a143a6-r2; creation changed no pointer. Current activation is recorded in frontmatter.
