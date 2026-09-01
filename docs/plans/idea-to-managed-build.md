---
arcadia: v1
type: plan
slug: idea-to-managed-build
project: arcadia
status: active
milestone: A raw software-project idea becomes governed, dispatchable coding-agent work without a manual planning-to-build handoff
token_impact: large
token_budget: "Project creation, document rendering, Session lifecycle checks, builds, and state transitions are deterministic. Use one bounded planning Run for the idea, one explicitly launched coding-agent Session per accepted Action, and independent QA only when deterministic readiness passes."
recommended_model: gpt-5.6-sol
recommended_reasoning_effort: high
updated: 2026-08-30
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
    status: done
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
      - src/projects/planningPromotion.ts
      - src/execution/runner.ts
      - src/stewardship/artifactValidator.ts
      - src/docs/sync.ts
      - src/docs/dispatch.ts
      - tests/project-plan-promotion.test.ts
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
  - id: build-operator-attention-board
    title: Make scarce operator attention obvious and actionable
    status: done
    responsibility: codex
    effort: session
    next_action: Replace the flat Review queue with a minimal Needs you board that selects the most consequential operator-only item, explains why it is first and what it costs, and presents outcome-specific choices with their immediate consequences.
    expected_artifact: A phone-reachable Needs you board where the operator can understand and resolve the highest-leverage pending judgment without reconstructing Project state
    clarification: clarified
    confidence: high
    source: Decisions 0034 and 0036, with explicit operator priority on 2026-08-27
    acceptance_criteria:
      - The operator-facing surface is named `Needs you` and shows one dominant item followed by a short ranked queue, rather than presenting every open record at equal weight.
      - The active board contains only judgment or authority that can change what may happen next; retryable agent work, deterministic repairs, stale deferrals whose triggers have not fired, and work Arcadia can resolve safely remain off the active board and are accounted for explicitly.
      - Ranking reuses the existing dispatch-readiness resolution and visibly explains each item's urgency or temporal trigger, relevance to the current Outcome or release path, significance measured by what it unlocks, estimated operator attention, and immediate versus downstream Token Impact; no unexplained composite score becomes a competing source of priority.
      - The selected item names its Project, kind, affected plan and Action, why it is first, Arcadia's recommendation, the evidence available, and the uncertainty that still requires the operator.
      - Clarifications request a natural-language answer, approvals state the exact authority granted, choices use outcome-specific labels, and deferrals require a named trigger; generic approve, reject, and defer controls are not shown where those words do not match the Decision.
      - Before confirmation, every option previews its immediate consequence, what it unblocks, what remains blocked, and whether any Run or external effect will start; the confirmation control repeats the selected outcome instead of saying only `Approve`.
      - After confirmation, the same surface gives a durable receipt naming the Decision recorded, the state transition, and the next Action or remaining blocker, replacing silent background continuation.
      - Open items outside the active ranking remain reachable behind one explicit control and are never deleted or silently hidden; empty, loading, and failed states are visibly distinct.
      - The Needs you page can save workspace `reviewFocus` to bound the focused set, order primary and secondary Projects, and park Projects without mutating or deleting their Decisions, packets, Runs, or evidence.
      - The board and its Decision interaction remain usable at phone width and by keyboard, and focused tests cover ranking, exclusion, each typed response, consequence preview, receipt, and empty and failure states.
    decisions: ["0034", "0036"]
    references:
      - apps/dashboard/app/review/page.tsx
      - apps/dashboard/app/api/review-action/route.ts
      - apps/dashboard/components/dashboard-ui.tsx
      - src/docs/dispatch.ts
      - src/commands/next.ts
      - docs/decisions/0036-prioritize-operator-attention-board.md
      - docs/arcadia-audit-command-notes.md
      - START_HERE.md
    depends_on: []
  - id: build-plan-approval-surface
    title: Approve or defer a prepared plan from the Review page
    status: done
    responsibility: codex
    effort: project
    next_action: Present each prepared planning Artifact on the Review page as a readable plan with its idea, milestone, Actions, and token budget, and offer exactly three governed outcomes — approve now, defer against a named trigger, or send back for refinement.
    expected_artifact: A phone-reachable surface where a prepared plan is read and approved now, deferred against a named trigger, or returned for refinement, with the promotion path unchanged
    clarification: clarified
    confidence: medium
    source: Decision 0034 on 2026-08-25
    acceptance_criteria:
      - A prepared planning Artifact renders as a readable plan — original idea, milestone, proposed Actions, token impact and budget, and the repository it targets — without requiring the operator to read raw markdown or JSON.
      - Approve routes through the existing acceptance and promotion path rather than a parallel one, and starts no implementation Run by itself.
      - Defer requires a named trigger condition before it is accepted, and a deferral with no trigger is refused with that reason stated.
      - Send back for refinement records what was unclear and returns the plan to its planning Action without discarding the prepared Artifact.
      - Every outcome is recorded as a Decision with provenance to the plan, the idea, and the revision judged.
      - The surface is usable at phone width, since its whole justification is being reachable away from the terminal.
      - Merge, deployment, release, credentials, spending, production access, and outbound messaging remain gated by their own Decisions; approving a plan authorizes planning-to-build promotion and nothing else.
      - Focused tests cover rendering, each of the three outcomes, the missing-trigger refusal, idempotent re-approval, and the unchanged terminal path.
    decisions: ["0034", "0029"]
    references:
      - apps/dashboard/app/review/page.tsx
      - src/commands/review.ts
      - src/execution/planningPreparation.ts
      - src/stewardship/artifactValidator.ts
      - docs/plans/idea-to-managed-build.md
      - START_HERE.md
    depends_on: [promote-accepted-plan, build-operator-attention-board]
  - id: launch-tmux-backed-session
    title: Launch one governed coding-agent Session through tmux
    status: open
    responsibility: codex
    effort: session
    expected_artifact: A tested opt-in tmux launch path whose durable Session receipt lets the operator leave, find, and reattach to the exact governed Claude Code work without inspecting its transcript
    clarification: clarified
    next_action: Prepare one disposable-repository rehearsal through the exact explicit Claude Code launch path and record only the bounded detach, reattach, exit, and resume evidence.
    confidence: high
    source: Decision 0038 approved by the operator on 2026-08-30, with Decision 0012
    acceptance_criteria:
      - An explicit launch option on arcadia go is the only new authority to start a process; preview and the existing manual launch-command path remain non-launching and backward compatible.
      - Launch is allowed only after the existing dispatch, clean-worktree, agent-owned branch, isolated-worktree, pinned-model, and optional-effort checks have passed; tmux availability and session-name collision checks fail before Arcadia claims a Session is running.
      - Before process start, Arcadia persists one workspace-owned Session receipt linking Project, plan, Action, execution profile, provider, model, effort, branch, worktree, prepared time, stable Claude Code session id and display name, and tmux session name.
      - The Session binds immutably to the promoted build packet id and hash, authorizing Decisions, selected provider profile, and base revision; a stale Action, packet, authority set, or provider mismatch refuses before launch.
      - Arcadia permits only one prepared or running Session lease per repository by default, while allowing separately admitted Sessions in different repositories.
      - arcadia go, arcadia advance, and the Agent Queue consume one deterministic project-transition resolver whose exhaustive outcomes are launch, plan, Decision, repair, reconcile, wait, or Milestone completion; a non-launch outcome creates or names the one governed step that can advance the Project instead of returning an unstructured dead end.
      - Arcadia starts tmux around the worktree it already created instead of invoking Claude Code's worktree-owning tmux mode, so Arcadia remains the single authority for branch and worktree creation and retirement.
      - A read-only Session view reports prepared, running, or exited from stored linkage plus tmux process liveness and prints the exact reattach command; it never captures panes, mirrors transcripts, estimates progress, or injects input.
      - A real Claude Code dogfood Session can detach, survive closing its launching terminal, reattach to the same interactive interface, and remain resumable by its preassigned Claude session id after exit.
      - Cross-repository work is decomposed into linked single-repository Actions and Sessions; the first fixtures prove a dispatchable PPN Action, an operator-owned Rebuster Action that must produce a Decision rather than launch, and a new idea that must produce planning before implementation.
      - Focused tests cover preview, explicit launch, missing tmux, name collision, spawn failure, stable identifiers, liveness, reattach instructions, and unchanged manual behavior; START_HERE.md documents the operator procedure and limits.
    decisions: ["0012", "0038"]
    references:
      - src/commands/go.ts
      - src/commands/worker.ts
      - src/db/schema.ts
      - docs/decisions/0009-agent-neutral-go-handoff.md
      - docs/decisions/0010-pin-the-agent-handoff-model.md
      - docs/decisions/0012-the-session-primitive.md
      - docs/working-copy-safety.md
      - START_HERE.md
    depends_on: [promote-accepted-plan]
  - id: reconcile-session-exit
    title: Turn a finished Session into the next governed state
    status: open
    responsibility: codex
    effort: session
    next_action: Reconcile a tmux-hosted Session after its agent process exits, persist its terminal outcome, resolve the repository's resulting Action or Decision, and link the strongest existing Log, Artifact, pull-request, Git, and validation evidence without reading the transcript.
    expected_artifact: A completed Session receipt that explains what was dispatched, what Candidate and governed records came back, and the one next Action or operator Decision
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-08-29, Decision 0012, and the thin delegated-work receipt in Decision 0020
    acceptance_criteria:
      - Arcadia records agent-process exit time and exit status once, idempotently, and distinguishes completed, failed, and needs-input outcomes without treating a live tmux pane as semantic progress.
      - After exit, Arcadia reruns the existing document readiness resolver and computes needs input only when authoritative repository state resolves to an open Decision; it does not scrape terminal output for questions.
      - The Session receipt links the resulting Log entry, Decisions, Artifacts, Candidate revision, pull request, changed-file evidence, and validation receipts when those records exist, while leaving missing proof explicitly missing.
      - Session outcome remains distinct from implementation acceptance: a zero agent exit does not mark an Action done, approve a Candidate, merge, push, deploy, publish, spend, message, use credentials, or cross any other Decision boundary.
      - One real dogfood Session proves the complete prepared to running to exited to next-state path, including a failure or needs-input fixture and a recovery instruction for an orphaned tmux or agent process.
      - The Agent Queue and Needs you projections consume the Session receipt and computed dispatch state rather than maintaining a second session-attention truth store.
      - Focused tests cover normal exit, non-zero exit, missing governed output, open-Decision resolution, idempotent reconciliation, stale process identity, and preservation of prior receipts.
    decisions: ["0012"]
    references:
      - src/docs/dispatch.ts
      - src/dispatch/queue.ts
      - src/commands/go.ts
      - src/commands/worker.ts
      - docs/decisions/0012-the-session-primitive.md
      - docs/decisions/0014-tappable-operator-questions.md
      - docs/decisions/0020-compounding-agent-production-principles.md
    depends_on: [launch-tmux-backed-session]
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
    depends_on: [build-plan-approval-surface, reconcile-session-exit]
---

# Idea to managed build

This plan closes the two manual seams in Arcadia's target development loop:
turning an explicit new-project idea into governed planning work, and turning
an accepted planning Artifact into the exact build Action a coding agent can
advance.

Decision 0034 adds the operator half of the second seam. Decision 0036 moves its
80/20 foundation to the front of the line: the flat Review queue becomes the
`Needs you` operator attention board before accepted-plan promotion resumes.
The first slice reuses existing Review records and dispatch readiness, makes the
ranking reasons and attention costs visible, and gives each Decision an
outcome-specific consequence preview and receipt. `promote-accepted-plan` and
the prepared-plan approval surface remain queued, not cancelled; their relative
order is reconsidered after the board's core interaction is proven in use.

`build-operator-attention-board` is now complete. Review Decisions, standalone
coding-agent packets, and failed or review-required Runs all use a two-step
interaction on `Needs you`: the preview names the immediate consequence,
unlock, remaining blocker, and external-effect boundary; the resulting receipt
either records the Decision transition or states truthfully that the handoff
changed no Arcadia state and points to the durable Run record or guarded
command. The board is covered at phone width through the complete Playwright
suite.

Dogfood then exposed a stale-question failure: a document-backed clarification
from a non-current plan could age upward in Needs you despite having no link to
the current governed Action. The board now offers **Reassess** for clarification
Decisions. It compares the source plan and question with the Project's
authoritative active plan, withdraws provably disconnected Decisions while
preserving their history, and labels questions found in the active plan **Still
declared** without pretending semantic applicability was reviewed. The operator
can **Flag for agent review** to park one outside Needs you in a dedicated Agent
Queue lane. Both transitions are deterministic and start no Run.

`promote-accepted-plan` and `build-plan-approval-surface` are now complete.
Needs you renders a validated planning Artifact as a readable plan with its
original idea, Milestone, proposed Actions, Token Impact and Budget, target
repository, and exact content revision. Approve reuses the deterministic
promotion path and starts no Run; Defer requires a named trigger; and Send back
requires feedback, preserves the Artifact, and reopens the planning Action for
Codex refinement. Each outcome remains one provenance-bearing Decision.

The operator then selected tmux as the first concrete Session transport. With
the accepted-plan and operator-approval seams closed, `launch-tmux-backed-session`
now records and starts one
addressable Claude Code Session in Arcadia's own worktree, and
`reconcile-session-exit` turns its process exit and repository outputs into the
next governed state. The full managed-build Action waits for the Session
before/after path.

tmux is intentionally infrastructure, not a new source of truth. The first
slice uses it only to keep an interactive terminal alive and reattachable.
Queueing through the worker, Discord completion or attention notifications,
automatic daemon installation, session analytics, transcript views, prompt
injection, and default-on background launch remain deferred. Queueing
reactivates after the first real tmux-backed Session completes and the operator
chooses unattended launch for a second Action; notifications reactivate when a
completed or needs-input Session waits unnoticed or requires manual status
relay; analytics reactivate only when enough thin receipts exist to change
planning or provider selection.

The general deployment tail remains deferred. The first proven deployment
slice is intentionally smaller: one registered Astro
template, one declared generator skill, and one deterministic Cloudflare
Workers Static Assets staging deploy. Automatic provider discovery, production release, and general
workflow-engine abstractions add cost without improving that proof.
