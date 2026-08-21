---
arcadia: v1
type: plan
slug: idea-to-managed-build
project: arcadia
status: active
milestone: A raw software-project idea becomes governed, dispatchable coding-agent work without a manual planning-to-build handoff
current_action: promote-accepted-plan
token_impact: large
token_budget: "Project creation, document rendering, readiness checks, builds, and state transitions are deterministic. Use one bounded planning Run for the idea, one coding-agent implementation Run per accepted Action, and independent QA only when deterministic readiness passes."
updated: 2026-08-20
actions:
  - id: prepare-project-idea
    title: Turn one stated project idea into a dispatchable planning Action
    status: done
    responsibility: codex
    effort: session
    next_action: Add one project preparation command that records the full idea, classifies it as plan-first software Project work, writes a valid managed pointer chain, and prepares the exact coding-agent planning Decision without invoking the agent.
    expected_artifact: A tested project-idea preparation command whose output names the classification, Project, managed planning Action, planning packet, Decision, and exact trigger
    clarification: clarified
    confidence: high
    source: Operator direction and Decision 0029 on 2026-08-20
    acceptance_criteria:
      - A single CLI command accepts a Project name and free-form idea, with an optional repository path, and preserves the idea verbatim as planning input.
      - The command classifies the request visibly as Project work, Plan First, with Codex responsibility; it does not silently route an explicit project idea to Back Burner.
      - The resulting Project is Active because planning is authorized work, and its repository contains a valid PROJECT.md to active plan to current Action pointer chain whose current planning Action is dispatchable.
      - The command creates the immutable planning packet and one approval Decision through the existing planning preparation path, reports the exact approval trigger, and does not invoke a model or implementation agent.
      - Reusing an occupied Project name or a repository already governed by another Project fails before changing either target.
      - Focused tests cover the successful path, JSON/CLI output, full-idea preservation, dispatch readiness, and refusal paths.
      - START_HERE.md documents the command, what it writes, what approval causes, and the unchanged authority boundaries.
    decisions: ["0029"]
    references:
      - src/commands/project.ts
      - src/commands/work.ts
      - src/projects/controlDocuments.ts
      - src/docs/dispatch.ts
      - src/execution/planningPreparation.ts
      - START_HERE.md
    depends_on: []
  - id: promote-accepted-plan
    title: Promote an accepted planning Artifact into the governed build Action
    status: open
    responsibility: codex
    effort: session
    next_action: Extract the smallest implementation goal from an accepted validated planning Artifact, update the Project's managed plan and pointer atomically, sync it into operational state, and prepare the coding-agent build packet without running it.
    expected_artifact: An accepted plan deterministically produces one current dispatchable build Action and immutable build packet with no manual document translation
    clarification: clarified
    confidence: high
    source: Operator direction and Decision 0029 on 2026-08-20
    acceptance_criteria:
      - Accepting a valid planning Artifact produces exactly one smallest useful implementation Action and marks the planning Action done in the authoritative managed plan.
      - The promoted Action preserves provenance to the source idea, planning Artifact, validation result, acceptance Decision, repository, and selected execution profile.
      - Arcadia updates the managed document before syncing operational state, and a failure cannot leave two current Actions or claim that promotion completed.
      - The build Action is clarified, has observable acceptance criteria, Codex responsibility, an immutable build packet, and one exact explicit trigger; no implementation Run starts during promotion.
      - Re-acceptance is idempotent and stale or malformed planning Artifacts fail closed with one repair action.
      - Existing planning acceptance behavior remains compatible for Actions outside the project-idea workflow.
    decisions: ["0029"]
    references:
      - src/commands/review.ts
      - src/execution/runner.ts
      - src/stewardship/artifactValidator.ts
      - src/docs/sync.ts
      - src/docs/dispatch.ts
    depends_on: [prepare-project-idea]
  - id: manage-coding-agent-build
    title: Manage the coding-agent build through Candidate and independent QA
    status: open
    responsibility: codex
    effort: project
    next_action: Orchestrate the current build Action through isolated coding-agent execution, deterministic validation, Candidate proof, independent QA, and the next required Decision while preserving Stable and every approval boundary.
    expected_artifact: Arcadia advances a prepared software Project from approved build Action to evidence-bound Candidate and QA Decision with one visible next step throughout
    clarification: clarified
    confidence: medium
    source: Operator direction and Decision 0029 on 2026-08-20
    acceptance_criteria:
      - Arcadia selects the least-cost compliant configured coding-agent profile and runs the exact current build Action in one isolated branch and worktree.
      - Run state, changed files, validation commands, failures, produced Artifacts, and the next Action are durable and visible without inspecting an agent transcript.
      - Deterministic validation gates model-bearing QA, and independent QA is bound to the immutable Candidate revision.
      - Failure or requested follow-up creates one governed corrective Action without losing the accepted plan, prior Run, Candidate evidence, or Stable proof.
      - Merge, deployment, release, credentials, spending, production access, publishing, deletion, and outbound communication remain blocked without their own explicit Decisions.
      - The end-to-end path is dogfooded on one new local Project and documented as the normal operator procedure.
    decisions: ["0029"]
    references:
      - src/execution/runner.ts
      - src/dispatch/queue.ts
      - src/qa/prReview.ts
      - docs/arcadia-development-orchestration-vision.md
      - docs/operator-demo-and-release-contract.md
    depends_on: [promote-accepted-plan]
---

# Idea to managed build

This plan closes the two manual seams in Arcadia's target development loop:
turning an explicit new-project idea into governed planning work, and turning
an accepted planning Artifact into the exact build Action a coding agent can
advance.

The expensive tail is deliberately deferred to the third Action. Arcadia will
first prove that the authoritative pointer and approval chain work end to end;
automatic provider discovery, deployment, release, and general workflow-engine
abstractions add cost without improving that proof.
