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
    depends_on: [demo-astro-staging-loop]
  - id: demo-astro-staging-loop
    title: Prove one idea-to-live-staging loop for the tomorrow demo
    status: done
    responsibility: codex
    effort: session
    next_action: Connect the exact MartianRover Field Notes request to a populated proposed Project, one Project-scoped approval Decision, an approved coding-agent scaffold Run, and a Cloudflare Workers staging URL returned through Discord.
    expected_artifact: A tested golden-path demo in which the exact Astro blog request creates a reviewable Project and one approval advances it to a live staging URL without production deployment
    clarification: clarified
    confidence: high
    source: Operator demo direction and Decision 0030 on 2026-08-20
    acceptance_criteria:
      - The exact input "Create a MartianRover Field Notes blog site" deterministically resolves as a supported Astro blog Project proposal rather than Back Burner or generic clarification.
      - Intake creates one Incubating Project whose detail page shows the original idea, selected template, generator skill, coding agent, local repository path, GitHub repository URL field, Cloudflare staging target, current Action, and approval Decision.
      - The Discord notification for the proposal contains a direct link to that Project detail page and names what approval authorizes.
      - Entering a valid GitHub repository URL and approving the Project queues one managed worker Run; it does not require a second execution Decision.
      - The approved Run initializes only the Project repository, invokes the selected Codex or Claude Code build adapter with the declared Create Astro Site skill, runs deterministic build validation, and deploys only a Cloudflare Worker staging environment.
      - Codex receives outbound network access only inside its workspace-write sandbox for this explicitly approved proposal; no danger-full-access mode is introduced.
      - A successful staging deployment persists the URL on the Project, exposes it in the Dashboard, and produces a Discord notification containing the live link.
      - Missing repository URL, missing generator skill behavior, missing Wrangler, agent/build failure, Cloudflare authentication failure, or absent deployment URL fails legibly without claiming the Project is live.
      - Production deployment, merge, push, custom domains, publication, spending, and general multi-stack orchestration remain out of scope.
      - Focused tests cover exact intake, proposal state, approval queueing, Discord links, scoped Codex networking, Cloudflare command/result handling, and failure paths; the full Arcadia test/build suite remains green.
    decisions: ["0029", "0030"]
    references:
      - src/intake/index.ts
      - src/commands/ask.ts
      - src/commands/review.ts
      - src/execution/reviewExecutor.ts
      - src/commands/worker.ts
      - apps/dashboard/app/projects/[id]/page.tsx
      - apps/discord-bot/src/notifications/poller.ts
      - config/defaults/template-registry.json
      - START_HERE.md
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

The general expensive tail remains deferred to the third Action. The first
proven deployment slice is intentionally smaller: one registered Astro
template, one declared generator skill, and one deterministic Cloudflare
Workers Static Assets staging deploy. Automatic provider discovery, production release, and general
workflow-engine abstractions add cost without improving that proof.
