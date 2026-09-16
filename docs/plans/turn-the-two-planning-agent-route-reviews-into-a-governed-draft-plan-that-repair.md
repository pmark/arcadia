---
arcadia: v1
type: plan
slug: turn-the-two-planning-agent-route-reviews-into-a-governed-draft-plan-that-repair
project: arcadia
status: draft
milestone: Turn the two planning-agent-route reviews into a governed draft plan that repairs the provider-binding spawn defect, reconciles docs/model-selection.md with the provider-adapter registry, and revises the proposal to an acceptable, answerable form. Implementation of the planning route itself stays unplanned until the operator answers the revised proposal.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-09-16
actions:
  - id: thread-binding-args-into-codex-spawn
    title: Make executeCodexStep spawn the coding-agent process with the provider binding's recorded modelArgs and effortArgs, so codex_invocations.command and packet metadata stop claiming a model the spawned process never receives.
    status: open
    responsibility: agent
    effort: session
    next_action: Make executeCodexStep spawn the coding-agent process with the provider binding's recorded modelArgs and effortArgs, so codex_invocations.command and packet metadata stop claiming a model the spawned process never receives.
    expected_artifact: Evidence satisfying Agent Ask thread-binding-args-into-codex-spawn
    clarification: clarified
    confidence: high
    source: Agent Ask plan-planning-agent-route-revision-2026-09-16
    acceptance_criteria:
      - A deterministic test exercises the executeCodexStep spawn for an Action with an execution requirement and asserts the spawned command line contains the binding's model and reasoning-effort flags, read from the spawn record rather than packet metadata.
      - The packet display command, the persisted codex_invocations.command, and the actually spawned process agree on the same provider binding model for a requirement-bearing Action.
      - Legacy Actions without an execution requirement spawn exactly as before, with no configuration args and no new failure.
      - The full test suite and the core build pass.
    depends_on: []
    decisions: []
    references: ["docs/proposals/planning-agent-route-with-structural-templates.md", "docs/reports/planning-agent-route-review.md", "docs/reports/planning-agent-route-review-2.md", "docs/reports/prove-two-action-unattended-production-runbook.md", "src/execution/runner.ts", "src/codex/packets.ts", "src/codingAgents/adapters.ts"]
  - id: reconcile-model-selection-doc-with-provider-bindings
    title: Update docs/model-selection.md so it names the provider-adapter binding registry as a model-selection surface and states the precedence between a plan's recommended_model and a selected binding's modelArgs.
    status: open
    responsibility: agent
    effort: session
    next_action: Update docs/model-selection.md so it names the provider-adapter binding registry as a model-selection surface and states the precedence between a plan's recommended_model and a selected binding's modelArgs.
    expected_artifact: Evidence satisfying Agent Ask reconcile-model-selection-doc-with-provider-bindings
    clarification: clarified
    confidence: high
    source: Agent Ask plan-planning-agent-route-revision-2026-09-16
    acceptance_criteria:
      - docs/model-selection.md names the provider-adapter binding registry as a place a model is chosen, replacing the 'exactly two places' claim that the code already contradicts.
      - The doc states which authority wins when a plan's recommended_model (Decision 0010) and a selected binding's modelArgs disagree for the same work, consistent with Decision 0010's plan-boundary authority.
      - START_HERE.md is unchanged unless a claim it names changed; no user-facing command behavior changes.
    depends_on: []
    decisions: []
    references: ["docs/proposals/planning-agent-route-with-structural-templates.md", "docs/reports/planning-agent-route-review.md", "docs/reports/planning-agent-route-review-2.md", "docs/reports/prove-two-action-unattended-production-runbook.md", "docs/model-selection.md", "docs/decisions/0010-pin-the-agent-handoff-model.md", "src/codingAgents/providerAdapters.ts"]
  - id: revise-planning-agent-route-proposal
    title: Revise docs/proposals/planning-agent-route-with-structural-templates.md to resolve the blockers and majors both reviews converged on, so the operator can answer the proposal from a corrected document.
    status: open
    responsibility: agent
    effort: session
    next_action: Revise docs/proposals/planning-agent-route-with-structural-templates.md to resolve the blockers and majors both reviews converged on, so the operator can answer the proposal from a corrected document.
    expected_artifact: Evidence satisfying Agent Ask revise-planning-agent-route-proposal
    clarification: clarified
    confidence: high
    source: Agent Ask plan-planning-agent-route-revision-2026-09-16
    acceptance_criteria:
      - The proposal's handoff section names the channel a launched executor session actually consumes (plan Action fields and references per src/sessions/index.ts and src/commands/advance.ts), states which channel is canonical, and stops claiming the build packet prompt.md as the executor's input.
      - The executor-block validator additions are gated on a packet-derived contract flag so legacy planning artifacts keep passing, the fenced block is reconciled with the implementation-claim and validation-claim detectors, and depends_on integrity (dangling references and cycles) is among the new checks.
      - The model-selection claims are corrected against the amended doc, the gpt-5.6-luna model string is verified against the current Codex CLI model list per docs/model-selection.md, and the credit-exhausted codex-cli default is either re-pointed or carries an explicit re-pointing trigger.
      - The smallest-implementation slice includes the spawn-arg threading prerequisite by reference to the completed thread-binding-args-into-codex-spawn action.
      - Both review documents are cited from the proposal so the revision's provenance is legible.
    depends_on: [thread-binding-args-into-codex-spawn, reconcile-model-selection-doc-with-provider-bindings]
    decisions: []
    references: ["docs/proposals/planning-agent-route-with-structural-templates.md", "docs/reports/planning-agent-route-review.md", "docs/reports/planning-agent-route-review-2.md", "docs/reports/prove-two-action-unattended-production-runbook.md"]
questions: []
decisions: []
---

# Turn the two planning-agent-route reviews into a governed draft plan that repairs the provider-binding spawn defect, reconciles docs/model-selection.md with the provider-adapter registry, and revises the proposal to an acceptable, answerable form. Implementation of the planning route itself stays unplanned until the operator answers the revised proposal.

Created as an inactive draft from accepted Agent Ask plan-planning-agent-route-revision-2026-09-16; creation changed no pointer. Current activation is recorded in frontmatter.
