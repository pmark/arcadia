You are an independent reviewer. Do not modify code or governance state — your
only write is the report file named at the end.

Review docs/proposals/planning-agent-route-with-structural-templates.md
("Planning agent route with structural templates").

A prior review already exists at docs/reports/planning-agent-route-review.md.
Read it LAST, after forming your own conclusions, and treat it as a peer to
challenge, not a baseline to confirm: your job is to (a) independently verify,
(b) find what it missed, and (c) rebut any of its findings you believe are
wrong, citing evidence. Do not copy its severity rankings.

Read first:
- CONSTITUTION.md (approval boundaries, Economy/80-20, "make it real")
- AGENTS.md (Arcadia context, agent-ask boundaries)
- docs/model-selection.md
- docs/managed-documents.md
- docs/reports/prove-two-action-unattended-production-runbook.md
  (sections at lines 33-122 and 124-150)

1. Verify every factual claim in the proposal against the code, citing exact
   file:line for each. Check at minimum:
   - src/codex/packets.ts:216-235 (selectAgentProfileForWorkItem null path),
     :267-301 (selectAgentProfile), :303-421 (renderPrompt), :81-86 (command build)
   - src/codingAgents/adapters.ts:20-34 (buildCodingAgentCommand)
   - src/codingAgents/providerAdapters.ts:92-197 (selectCompliantCodingAgent,
     purpose/effort/costRank filters and sort), :199-262 (validateProviderAdapterRegistry)
   - src/stewardship/artifactValidator.ts:60-207 (validatePlanningArtifact,
     score at :197), :215-246 (extractPlanningPromotionFields), :417-465
     (claim detectors and approval-contradiction scan)
   - src/execution/runner.ts:300-431 (executeCodexStep spawn path), :676-727
     (planning validation review item)
   - src/commands/review.ts:962-1010 (CodexPlanningRetryApproval creation)
   - src/commands/work.ts:1120-1202 (ensureBuildPacketForPlan)
   - src/projects/planningPromotion.ts:85-189, :250-272, :334-448 (promotion lift)
   - src/intent/registries.ts:70-111 (registry loading pattern)
   - src/execution/skills.ts:140-179 (keyword routing)
   - config/defaults/provider-adapters.json and coding-agent-profiles.json
   Report anything wrong, outdated, unverifiable, or citation-drifted.
   Pay particular attention to whether binding modelArgs/effortArgs actually
   reach a spawned coding-agent process on each path (packet display command
   vs. real spawn), and to which document the opencode executor session
   actually consumes at launch.

2. Assess the design, ranking findings blocker/major/minor/nit:
   - Does it reuse existing machinery or introduce a parallel pipeline? (YAGNI)
   - Does few-shot templates + deterministic validation actually constrain a
     tier-two model, or is it theater? Name the failure modes it does not catch.
   - Does it preserve planning-only and separate build approval boundaries?
   - Is the proposed executor-step block sufficient for an opencode executor
     to act without interpretation? What is missing (context, ordering,
     dependency integrity, failure/rollback semantics, who runs validation)?
   - Is the smallest-implementation slice the real 80/20, or missing a
     prerequisite? Which of its verification criteria could pass while the
     feature remains inert?
   - Any conflict with docs/model-selection.md, Decision 0010
     (docs/decisions/0010-pin-the-agent-handoff-model.md), or the
     provider-adapter validation contract?

3. Deliver a verdict (accept / revise / reject), severity-ranked findings with
   evidence, and the smallest set of changes that would make the proposal
   acceptable. State explicitly where you agree with the prior review, where
   you disagree (with evidence), and what the prior review missed.

Write the report to docs/reports/planning-agent-route-review-2.md.
