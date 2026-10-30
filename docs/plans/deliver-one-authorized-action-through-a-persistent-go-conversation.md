---
arcadia: v1
type: plan
slug: deliver-one-authorized-action-through-a-persistent-go-conversation
project: arcadia
status: draft
milestone: Deliver one authorized Action through a persistent Go conversation
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-30
actions:
  - id: prove-go-delivery-from-coding-agent-session
    title: "Prove one real end-to-end Go delivery invoked inside a coding-agent session. Recommended role: implementer, standard tier; size S; execute only with a named assignment and valid test, provider and remote-delivery authority."
    status: open
    responsibility: agent
    effort: session
    next_action: "Prove one real end-to-end Go delivery invoked inside a coding-agent session. Recommended role: implementer, standard tier; size S; execute only with a named assignment and valid test, provider and remote-delivery authority."
    expected_artifact: Evidence satisfying Agent Ask prove-go-delivery-from-coding-agent-session
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-conversation-1894-20261029-r2
    why: "The conversation must rest on a Go workflow that already works from a real coding-agent caller."
    acceptance_criteria:
      - Requirement REQ-001; Issue AC1. A retained live evidence Artifact records the exact supported arcadia go invocation from inside an actual coding-agent session, caller working directory and provider/model/effort, selected Project/Plan/Action separately from assigned work, and the actual claim, candidate and Session identities. It records whether continuation resumes the caller or starts another Session. A dashboard-only invocation, host-terminal substitute, stub agent or manually assembled delivery does not satisfy this criterion.
      - The live proof uses one already eligible isolated disposable task with one trivial file change and the least costly suitable configured agent. Before launch, its evidence checks existing claims and the Go Agent Delivery Probe 20261029 records, including the monitor's missing-Git-checkout observation; an existing qualifying proof is reused with provenance instead of relaunching. Missing test setup or authority stops the dependent step with an exact refusal and governed follow-up; no new experiment workspace, pointer move, attempt reset or duplicate owner is inferred authorized.
      - The same supported Go delivery produces the actual trivial change, validation command/results, commit and accessible draft PR; the evidence links independent current-head review and required checks with their observed results. Every operator intervention and its authorization is recorded. Missing, failed or unknown stages remain explicit and prevent completion; source tests, prepared work or an agent exit alone never count as delivery.
      - The proof separately records source revision/checks, installed revision/adoption evidence and live request/Session/validation/PR receipts, reconciles an unknown request before retrying, and demonstrates preserved existing work, permissions and Production Off. Scope excludes merge, deployment, credential changes and repairs beyond the test; any observed defect goes through its owning governed path.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1894", "https://github.com/pmark/arcadia/issues/1889", "https://github.com/pmark/arcadia/pull/1890", "docs/arcadia-development-orchestration-vision.md", "docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md", "docs/planning-process.md", "https://github.com/pmark/arcadia/issues/1160", "src/goBroker.ts", "scripts/arcadia-go-broker.ts", "docs/working-copy-safety.md", "START_HERE.md"]
  - id: implement-project-go-conversation
    title: "Implement a persistent Project-scoped workspace conversation with read-only Go orientation. Recommended role: implementer, standard tier; size M; source work only after named assignment, with installation separately gated."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement a persistent Project-scoped workspace conversation with read-only Go orientation. Recommended role: implementer, standard tier; size M; source work only after named assignment, with installation separately gated."
    expected_artifact: Evidence satisfying Agent Ask implement-project-go-conversation
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-conversation-1894-20261029-r2
    why: "Give the operator a visible conversation and truthful next move before adding execution."
    acceptance_criteria:
      - Requirement REQ-002; Issue AC2. Given a selected Project, the conversation accepts What is next and displays Go's current Action or exact gate, source observation time and selected versus assigned work when different. Fixtures cover ready, gated, empty, missing evidence, stale evidence and assigned B versus selected A; all use the existing resolver and perform zero pointer, queue, claim or Session mutations.
      - Requirement REQ-003; Issue AC6. User messages and their canonical record references survive reload under the correct Project using an existing suitable persistence capability or a minimal addition after inspecting that capability. Switching Projects never exposes or submits a message against the previous Project; tests prove two-Project isolation and reload restoration. Action status and approval truth remain in their existing canonical stores.
      - The composer visibly acknowledges each received request and renders questions as numbered text options with consequences as well as optional buttons. Desktop and narrow/mobile keyboard and screen-reader checks prove that the current response is reachable without hidden native pickers or forced scrolling away from history the operator is reading.
      - Unsupported or ambiguous input displays its interpretation limit and one relevant clarification; it does not execute or silently amend scope. Routine orientation and status rendering invoke zero models; any free-text interpretation reuses the configured bounded route and cannot authorize effects. Focused conversation tests, TypeScript and Dashboard build pass.
    depends_on: [prove-go-delivery-from-coding-agent-session]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1894", "https://github.com/pmark/arcadia/issues/1889", "https://github.com/pmark/arcadia/pull/1890", "docs/arcadia-development-orchestration-vision.md", "docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md", "docs/planning-process.md", "https://github.com/pmark/arcadia/issues/1160", "apps/dashboard/components/workspace/workspace-next-move.tsx", "apps/dashboard/lib/workspace-go.ts"]
  - id: connect-conversation-to-protected-continue
    title: "Implement Go and Continue in the conversation through the existing protected preview and browser confirmation. Recommended role: implementer, standard tier; size M; source work only, no new launch authority."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement Go and Continue in the conversation through the existing protected preview and browser confirmation. Recommended role: implementer, standard tier; size M; source work only, no new launch authority."
    expected_artifact: Evidence satisfying Agent Ask connect-conversation-to-protected-continue
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-conversation-1894-20261029-r2
    why: "Make the authorized next step actionable while preserving the existing confirmation boundary."
    acceptance_criteria:
      - Requirement REQ-004; Issue AC3. Go or Continue obtains a fresh existing protected preview and shows target, owner, configured provider/model/effort, limits, stable request identity and exact launch consequences. Only the existing explicit browser confirmation may commit; tests prove zero Session launch from the initial message, a generic yes, copied approval prose or model-generated confirmation.
      - The adapter binds Project, Plan, Action, resolution identity and preview fingerprint without inventing a second resolver or launch policy. Changed-facts, expired/invalid authority and non-dispatchable fixtures return the existing refusal with a fresh-read path before effects; browser-origin and provider/custody/production gates remain enforced.
      - Requirement REQ-005; Issue AC4. Confirmation displays launched, reused, refused or unknown according to the protected response. Started appears only with the actual durable Session receipt and a working Session inspection link. Reuse the feedback correction from PR1890; desktop/mobile and accessibility checks prove preview, confirmation and result remain visible and operable.
      - Focused preview/confirmation integration tests, TypeScript and Dashboard build pass. No automatic next Action, merge, installation, Production activation or direct text approval is introduced.
    depends_on: [implement-project-go-conversation]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1894", "https://github.com/pmark/arcadia/issues/1889", "https://github.com/pmark/arcadia/pull/1890", "docs/arcadia-development-orchestration-vision.md", "docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md", "docs/planning-process.md", "https://github.com/pmark/arcadia/issues/1160", "apps/dashboard/lib/go-continue.ts", "apps/dashboard/components/workspace/workspace-continue.tsx", "apps/dashboard/app/api/projects/[id]/go-continue/route.ts", "apps/dashboard/app/api/projects/[id]/session-launch/route.ts", "apps/dashboard/lib/operator-launch-consequence.ts"]
  - id: project-session-evidence-into-conversation
    title: "Implement Session progress and result messages from canonical evidence in the conversation. Recommended role: implementer, standard tier; size M; source work only after named assignment."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement Session progress and result messages from canonical evidence in the conversation. Recommended role: implementer, standard tier; size M; source work only after named assignment."
    expected_artifact: Evidence satisfying Agent Ask project-session-evidence-into-conversation
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-conversation-1894-20261029-r2
    why: "Make ongoing work and its outcome understandable without guessing from a spinner or process exit."
    acceptance_criteria:
      - Requirement REQ-006; Issue AC6. Status and conversation re-entry read the bound request/Session and display recorded progress without interrupting its execution. Fixtures distinguish preparation, running, agent exit, validation success/failure, accepted completion, PR created and review readiness; unavailable or stale host evidence never becomes working or done.
      - Only canonical receipts can produce Session, validation, commit, PR and review claims. A result message includes actual available evidence links and identifies each missing or pending stage; tests prove a successful agent exit without accepted completion or PR cannot render delivery success.
      - Routine progress updates use deterministic projections and existing observation mechanisms, deduplicate the same recorded transition and retain historical messages with their source time. No new persistent model watcher, external notification or separate Action-state authority is introduced.
      - Questions remain usable while work runs. Scope-change and stop requests cannot silently amend the assignment or claim stopped without a supported receipt; the conversation points to the existing governed route or states the missing capability. Focused lifecycle tests, TypeScript and Dashboard build pass.
    depends_on: [connect-conversation-to-protected-continue]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1894", "https://github.com/pmark/arcadia/issues/1889", "https://github.com/pmark/arcadia/pull/1890", "docs/arcadia-development-orchestration-vision.md", "docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md", "docs/planning-process.md", "https://github.com/pmark/arcadia/issues/1160", "apps/dashboard/components/workspace/workspace-continue.tsx", "apps/dashboard/lib/arcadia-cli.ts", "src/sessions/index.ts"]
  - id: reconcile-conversation-retries-and-reconnects
    title: "Implement request reconciliation for duplicate messages, interrupted launch responses and conversation reconnects. Recommended role: implementer, standard tier; size M; source work only, preserve existing request identities."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement request reconciliation for duplicate messages, interrupted launch responses and conversation reconnects. Recommended role: implementer, standard tier; size M; source work only, preserve existing request identities."
    expected_artifact: Evidence satisfying Agent Ask reconcile-conversation-retries-and-reconnects
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-conversation-1894-20261029-r2
    why: "A lost response or repeated message must not create a second writer or a false success."
    acceptance_criteria:
      - Requirement REQ-007; Issue AC5. Behavioral integration tests submit duplicate and concurrent messages, repeated confirmation and reload/reconnect for one bound launch request and prove at most one claim, candidate and Session through the existing protected identity. Unsupported or unverifiable reuse refuses instead of creating a new identity.
      - A timeout or lost launch response renders outcome unknown, preserves the original identity and reconciles existing durable evidence before offering another start. Fixtures cover a launch that succeeded before its response was lost, an in-progress request, an actual refusal and unavailable reconciliation; none turns uncertainty into a fresh launch.
      - Reconnect restores Project/message/request bindings and current canonical evidence, retains prior receipts, labels stale observations and rejects changed input under an existing identity. Two-tab and two-Project tests prove no cross-target confirmation or receipt leakage.
      - Focused recovery tests, TypeScript and Dashboard build pass; existing sandbox, ownership, approval, attempt and budget fences remain unchanged.
    depends_on: [project-session-evidence-into-conversation]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1894", "https://github.com/pmark/arcadia/issues/1889", "https://github.com/pmark/arcadia/pull/1890", "docs/arcadia-development-orchestration-vision.md", "docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md", "docs/planning-process.md", "https://github.com/pmark/arcadia/issues/1160", "apps/dashboard/lib/go-continue.ts", "apps/dashboard/app/api/projects/[id]/go-continue/route.ts", "apps/dashboard/components/workspace/workspace-continue.tsx"]
  - id: prove-one-action-conversation-delivery
    title: "Prove one real conversation-to-PR delivery and document the operator flow. Recommended role: implementer, standard tier; size S; live proof waits for separately valid adoption and one-Action operator confirmation."
    status: open
    responsibility: agent
    effort: session
    next_action: "Prove one real conversation-to-PR delivery and document the operator flow. Recommended role: implementer, standard tier; size S; live proof waits for separately valid adoption and one-Action operator confirmation."
    expected_artifact: Evidence satisfying Agent Ask prove-one-action-conversation-delivery
    clarification: clarified
    confidence: high
    source: Agent Ask plan-go-conversation-1894-20261029-r2
    why: "The milestone requires an observable delivery through the new conversation, not source tests or an installed page."
    acceptance_criteria:
      - Requirement REQ-008; Issue AC7. After current-head source review/checks and separately receipted adoption, one authorized operator-assisted conversation flow resolves an eligible isolated trivial Action, presents the protected preview, obtains the existing confirmation and reaches an actual Session, validated change and accessible draft PR. Source fixtures, manual delivery substitutes and blocked attempts do not satisfy live acceptance. Evidence may reference the delivery PR without claiming that this evidence Action's future PR already exists.
      - Requirement REQ-009; Issue AC8. A retained delivery Artifact names source revision and required-check results, installed revision/adoption receipt, and the actual conversation request, Session, validation, commit and draft PR receipts separately; it records every operator intervention and independent review/check status. Unknown or failed stages remain visible, and real-delivery completion requires the declared actual delivery evidence.
      - Requirement REQ-010; Issue AC9-10. START_HERE.md documents What is next, Go, confirmation consequences, Status, Session/result links and unknown-outcome recovery. An executable operator QA checklist covers success, changed preview, refusal and reconnect, and records desktop/mobile plus keyboard/screen-reader results with numbered text choices and consequences.
      - The final evidence maps Issue1894 AC1-AC10 to this Plan's owning requirements and actual proofs, confirms no automatic next Action, scope amendment, authority change or Production activation, and lists remaining external gates honestly. External messaging, direct text approvals, multi-Action continuation and new stop controls remain deferred until their separately approved triggers; existing work and permissions remain preserved.
    depends_on: [reconcile-conversation-retries-and-reconnects]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1894", "https://github.com/pmark/arcadia/issues/1889", "https://github.com/pmark/arcadia/pull/1890", "docs/arcadia-development-orchestration-vision.md", "docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md", "docs/planning-process.md", "https://github.com/pmark/arcadia/issues/1160", "START_HERE.md", "docs/managed-documents.md", "docs/working-copy-safety.md"]
questions: []
decisions: []
---

# Deliver one authorized Action through a persistent Go conversation

Created as an inactive draft from accepted Agent Ask plan-go-conversation-1894-20261029-r2; creation changed no pointer. Current activation is recorded in frontmatter.
