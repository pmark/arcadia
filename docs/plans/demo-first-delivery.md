---
arcadia: v1
type: plan
slug: demo-first-delivery
project: arcadia
status: active
milestone: Every software Project always exposes a stable proof surface and a governed path from candidate demo through QA-verified release
current_action: make-test-action-state-aware
token_impact: xlarge
token_budget: "Stage the program Action by Action; builds, health checks, Playwright capture, and metadata sync use no LLM tokens, while implementation, failure diagnosis, visual interpretation, and independent QA reviews are model-bearing and must be batched per Candidate."
recommended_model: claude-opus-5
recommended_reasoning_effort: high
updated: 2026-08-20
actions:
  - id: build-qa-queue-vertical-slice
    title: Give the operator one QA queue for active Candidate work
    status: done
    responsibility: codex
    effort: session
    next_action: Build an Arcadia QA tab that reads a small configured Candidate list and shows each Candidate's Project, pull request, demo link, exact test procedure, evidence freshness, and a human sign-off Decision without automatic provider discovery or release automation.
    expected_artifact: A usable Arcadia QA queue for the current PPN and Arcadia Candidates, with one-click Test links and durable operator sign-off evidence
    clarification: clarified
    confidence: high
    source: Operator direction on 2026-08-01 and Decision 0007
    acceptance_criteria:
      - The Dashboard exposes one QA tab that lists every configured active Candidate in a compact, testable order and visibly distinguishes Candidate from Stable.
      - Each Candidate shows its Project, exact source revision when known, pull-request link, demo or local-test link, short human-readable test procedure, last known validation state, and evidence freshness or absence.
      - Test opens only a configured target; an unreachable or missing target reports its state plainly and does not claim a demo exists.
      - The initial queue can represent the River Copy Studio Candidate and Arcadia Candidates using checked-in Project configuration; GitHub and Cloudflare discovery remain later additive work.
      - An operator can record pass, fail, or needs-follow-up as a Decision bound to the exact Candidate revision, with optional concise notes; this does not merge, deploy, or mark a release delivered.
      - The tab has one clear primary action per Candidate and never makes the operator reconstruct the test path from a Log or PR description.
      - No provider credentials, model calls, external deployment, merge, or outbound communication is required for this vertical slice.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Arcadia Dashboard navigation and Project configuration
          - Existing Decision and Artifact contracts
          - Configured local and remote proof targets
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0007"]
    references:
      - docs/operator-demo-and-release-contract.md
      - apps/dashboard/app/projects/[id]/page.tsx
      - apps/dashboard/components/sidebar.tsx
      - apps/dashboard/lib/types.ts
      - src/dashboard/snapshot.ts
    depends_on: []
  - id: establish-minimal-pr-qa
    title: Give Arcadia QA one independent pull-request review path
    status: done
    responsibility: codex
    effort: session
    next_action: Add a CLI-first qa pr command that freezes a configured Project pull request at its head SHA, gathers deterministic GitHub evidence, runs one separately executed read-only structured review, and persists a QA report Artifact plus a decided revision-bound Decision.
    expected_artifact: A tested minimal PR-QA command and a real QA report and Decision for Arcadia PR #54 at an immutable revision
    clarification: clarified
    confidence: high
    source: Decision 0018 and operator priority on 2026-08-15 while advancing Private Practice Now
    acceptance_criteria:
      - "`arcadia qa pr <github-pr-url>` resolves a configured Project and binds all evidence, output, and the Decision to the exact initial head SHA."
      - Evidence includes pull-request identity and body, base and head revisions, merge and draft state, changed files, the complete patch, and every reported check conclusion without executing commands copied from pull-request prose.
      - Arcadia selects the least-cost compliant read-only reviewer through the existing coding-agent profile and provider-adapter registries, establishes readable host controls for Codex auth, the Project Git control file, and GitHub network access, then requires the configured sandbox to read evidence while denying those same controls before invoking it with no arbitrary configured arguments; an unavailable baseline or mismatched result fails closed, and the verdict is exhaustively runtime-validated with exactly one result for every fixed QA criterion.
      - Pass is deterministically prevented when checks fail or remain pending, duplicate checks conflict, required evidence is absent, the head SHA changes during review, the reviewer fails, or the reviewer reports a material finding.
      - The command writes a human-readable QA report Artifact and a decided pass, fail, or needs-follow-up Decision carrying the PR URL, immutable SHA, reviewer provenance, evidence paths, and explicit not-checked reasons.
      - Repeating review for an already completed revision with unchanged pull-request evidence returns the existing receipts without another model invocation only after reconstructing the result from the persisted Decision context and cross-checking its Artifact, source, status, fingerprint, paths, and independently stored file hashes; changed evidence, any mismatch, or an explicit rerun creates a preserved new attempt and updates the cache hint.
      - The reviewer receives a patch fetched by exact base/head SHAs rather than a mutable working copy; its shell cannot read the operator home or access the network, and the command does not post, approve, merge, deploy, release, repair, or create arbitrary shell execution.
      - The real dogfood result for PR #54 truthfully explains its conflicting push and pull-request CI evidence and therefore cannot report Pass while that contradiction remains.
      - START_HERE.md documents the exact command, consequences, output locations, idempotency, and authority boundary.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Existing QA queue Artifact and Decision contracts
          - GitHub pull-request metadata and patch reads
          - Read-only coding-agent profiles and provider adapters
          - Arcadia workspace persistence
        staging: forbidden
      phases:
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0018"]
    references:
      - src/commands/qa.ts
      - src/codingAgents/providerAdapters.ts
      - src/codingAgents/adapters.ts
      - src/intent/registries.ts
      - src/db/repositories.ts
      - docs/operator-demo-and-release-contract.md
      - START_HERE.md
    depends_on: [build-qa-queue-vertical-slice]
  - id: streamline-minimal-pr-qa
    title: Remove avoidable model calls and CI noise from pull-request QA
    status: done
    responsibility: codex
    effort: short
    next_action: Add a deterministic readiness refusal before any PR-QA reviewer work, isolate the workspace-resolution test from the repository-local dogfood workspace, and document the one-pass operator sequence and triggered deferrals.
    expected_artifact: A tested zero-token not-ready path, a deterministic regression for the former CI race, and an authoritative Arcadia-orchestrated development vision with triggered follow-on Actions
    clarification: clarified
    confidence: high
    source: Operator direction and the post-PR-55 QA process audit on 2026-08-15
    acceptance_criteria:
      - A draft pull request, absent checks, any pending or non-success check, conflicting duplicate checks, or a dirty or blocked merge state is refused before patch retrieval, reviewer selection, sandbox preflight, model invocation, QA Artifact creation, or QA Decision creation.
      - The refusal is machine-readable, names every observed readiness blocker, states that no reviewer was invoked, and tells the operator to mark the pull request ready and wait for clean successful checks before retrying.
      - A ready pull request with completed successful checks and an acceptable merge state follows the existing exact-revision independent review path unchanged.
      - Mutable pull-request evidence is revalidated immediately before the model call; a changed snapshot skips the model and is preserved as Needs follow-up by the existing evidence-bound QA path.
      - The CLI-response workspace-precedence test runs from an isolated temporary directory and cannot observe `.arcadia-workspace` created by another test file.
      - START_HERE.md states the token-efficient sequence: finish the Candidate, publish its QA plan, mark it ready, await CI, then invoke Arcadia QA once; `--rerun` remains exceptional.
      - Arcadia's checked-in Project documentation states the north-star development orchestration vision and records every excluded enhancement with an observable reactivation trigger.
      - This Action does not add automatic invocation, notifications, browser proof, local validation reruns, GitHub posting, repair, merge, deployment, or release automation.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: project
        required:
          - Existing minimal pull-request QA command and receipts
          - GitHub pull-request readiness evidence
          - Vitest workspace-resolution fixtures
          - Arcadia managed documentation
        staging: forbidden
      phases:
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0019"]
    references:
      - src/qa/prReview.ts
      - tests/qa-pr-review.test.ts
      - tests/cli-response.test.ts
      - START_HERE.md
      - docs/arcadia-development-orchestration-vision.md
    depends_on: [establish-minimal-pr-qa]
  - id: build-demo-hero-vertical-slice
    title: Put one reconciled demo-first hero and proof card on Project Detail
    status: done
    responsibility: codex
    effort: session
    next_action: Build the smallest reusable proof-target contract and Project Detail hero, configure it for Private Practice Now's Stable and River Copy Studio Candidate targets, and make the primary Test action work without automatic GitHub or Cloudflare discovery yet.
    expected_artifact: A tested PPN Project Detail vertical slice with one exact next thing, Show Stable and Test Candidate actions, and truthful proof status
    clarification: clarified
    confidence: high
    source: Decision 0007 and the operator's 2026-08-01 Project Detail review
    acceptance_criteria:
      - Project Detail renders one demo-first hero above the existing control record and never presents two competing primary next actions.
      - The hero deterministically resolves one state from proof unavailable, failure, ready for operator demo, QA failed, release Decision needed, and Stable-only.
      - A Project can configure a known-good Stable target and a current Candidate target with URL, environment kind, source revision, access state, health state, and last verification time.
      - Private Practice Now shows its Stable target separately from the River Copy Studio Candidate, with a working Test Candidate action from both Mac and phone-reachable Mission Control.
      - Existing Milestone, Action, Decision, Artifact, Run, and Log detail remains available below the hero without being mislabeled as the demo.
      - No deployment, merge, credential use, production access, spending, or outbound communication is performed by this Action.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Arcadia dashboard Project Detail page and snapshot/API contracts
          - Private Practice Now local proof targets
          - Additive Arcadia workspace persistence
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0007"]
    references:
      - docs/operator-demo-and-release-contract.md
      - apps/dashboard/app/projects/[id]/page.tsx
      - apps/dashboard/lib/types.ts
      - src/dashboard/snapshot.ts
      - docs/decisions/0028-ppn-capability-reconciliation.md
      - "Prior art, read before designing the contract: PPN's .arcadia/demo.json and its demo() in scripts/arcadia.mjs already implement versioned proof targets, a primary flag, reachability probing with timeout and retry, and a go/no-go signal carrying its blocking reasons."
    depends_on: [build-qa-queue-vertical-slice]
  - id: automate-proof-artifacts
    title: Collect pull requests, deployments, health checks, and screenshots as proof Artifacts
    status: open
    responsibility: codex
    effort: project
    next_action: Add commit-bound proof ingestion behind the manual proof-target contract, starting with local Playwright screenshots and GitHub/Cloudflare read-only metadata rather than deployment automation.
    expected_artifact: Each Candidate has a timestamped proof gallery linked to its revision, PR, validation, health, and configured routes
    clarification: clarified
    confidence: high
    source: Decision 0007
    acceptance_criteria:
      - A proof capture records target URL, source revision, route, viewport, capture time, result, and screenshot Artifact without treating a stale image as current proof.
      - The default capture uses local Playwright against both local and remote HTTP targets and creates desktop and mobile screenshots for each configured demonstration route.
      - Existing GitHub pull-request and Cloudflare Pages or Workers preview metadata can be imported read-only and linked to the same Candidate revision.
      - Cloudflare preview targets are identified as public or Access-protected, and non-public Projects fail closed when access posture is unknown.
      - Pages preview targets are checked for non-indexing behavior; a missing expected noindex signal is visible QA evidence rather than silently ignored.
      - Capture failure preserves the previous Stable proof, marks Candidate proof stale or failed, and names the next corrective action.
      - No external deployment is created and no credential is stored in SQLite, Logs, screenshots, or Artifact content by this Action.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Project proof-target contract
          - Local browser automation
          - Read-only GitHub and Cloudflare deployment metadata when configured
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0007"]
    references:
      - docs/operator-demo-and-release-contract.md
      - src/domain/types.ts
      - src/db/schema.ts
      - src/db/repositories.ts
    depends_on: [build-demo-hero-vertical-slice]
  - id: make-test-action-state-aware
    title: Make Test open or recover the selected deployment safely
    status: open
    responsibility: codex
    effort: session
    next_action: Add a deterministic Test resolver that opens healthy remote targets, opens healthy local targets with a phone-reachable address, and offers to start only an explicitly configured local service when it is stopped.
    expected_artifact: A Test action that reliably reaches the selected Candidate and explains any recovery or access requirement
    clarification: clarified
    confidence: high
    source: Decision 0007
    acceptance_criteria:
      - Test performs a fresh health check before opening the target and never labels an unreachable target ready.
      - A healthy remote Candidate opens directly; a healthy local Candidate uses an address reachable from the current operator device rather than presenting localhost to a phone.
      - A stopped local target can be started only through a Project-configured, allowlisted command with visible status and logs; arbitrary shell input is never accepted from the browser.
      - Test never creates a deployment, changes production routing, merges code, or bypasses Cloudflare Access.
      - When recovery fails, the hero changes to a concrete failure state with one next action and leaves Stable available.
    decisions: ["0007"]
    references:
      - docs/operator-demo-and-release-contract.md
      - apps/dashboard/app/projects/[id]/page.tsx
      - apps/dashboard/app/api/projects/[id]/route.ts
    depends_on: [build-demo-hero-vertical-slice]
  - id: establish-arcadia-qa
    title: Establish Arcadia QA as an independent verification responsibility
    status: open
    responsibility: codex
    effort: project
    next_action: Define a QA Run profile and evidence contract that freezes one Candidate revision, executes Project validation and browser checks independently of the build Run, and returns a QA report Decision without modifying the Candidate.
    expected_artifact: An independent Arcadia QA Run, report Artifact, and pass/fail Decision bound to an exact Candidate revision
    clarification: clarified
    confidence: high
    source: Decision 0007
    acceptance_criteria:
      - QA runs against an immutable Candidate revision and invalidates its result if the Candidate changes afterward.
      - QA executes declared repository validation, target health, configured demonstration-route smoke checks, desktop and mobile screenshot capture, and basic accessibility checks.
      - Every result is pass, fail, or explicitly not checked with a reason; absence of evidence is never reported as pass.
      - The QA Run is independent from the implementation Run, cannot edit the Candidate, and cannot approve release.
      - A failed QA result blocks release readiness while preserving Stable and gives the operator one ordered finding list.
      - A human QA function can later consume and add evidence through the same Artifact and Decision contract without replacing it.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Candidate proof Artifacts
          - Managed Run worker
          - Project validation commands and demonstration routes
          - Browser automation
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0007"]
    references:
      - docs/operator-demo-and-release-contract.md
      - src/execution
      - apps/dashboard/app/runs/[id]/page.tsx
    depends_on: [establish-minimal-pr-qa, automate-proof-artifacts, make-test-action-state-aware]
  - id: govern-release-and-delivery
    title: Add release management from QA-passed Candidate to verified client delivery
    status: open
    responsibility: codex
    effort: project
    next_action: Model an immutable release candidate and its approval, merge, deployment, post-release verification, rollback, and delivery evidence without weakening existing approval gates.
    expected_artifact: A release workflow that proves exactly what shipped, where it is running, how it was verified, and whether it was delivered
    clarification: clarified
    confidence: high
    source: Decision 0007
    acceptance_criteria:
      - Release readiness binds the Candidate revision, QA report, change summary, PR, screenshots, Log, target environment, and known rollback target.
      - Only QA evidence for the exact release revision qualifies; a changed revision returns to Candidate and requires QA again.
      - Merge and external deployment remain separate explicit operator Decisions and are never inferred from QA success.
      - Post-release health, smoke checks, source revision, and screenshots are recorded before the released target can become Stable.
      - A failed release or post-release check preserves the prior Stable target and presents rollback or repair as the exact next action.
      - Client delivery and outbound communication require an explicit operator Decision and leave a durable delivery Artifact without copying credentials or private client data.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Arcadia QA evidence
          - Existing approval gates and Decision workflow
          - Git and deployment provider adapters
          - Post-release browser checks
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0007"]
    references:
      - CONSTITUTION.md
      - docs/operator-demo-and-release-contract.md
      - src/domain/constants.ts
      - src/commands/review.ts
    depends_on: [establish-arcadia-qa]
  - id: roll-out-proof-surfaces
    title: Roll the proven demo, QA, and release contract across software Projects
    status: open
    responsibility: codex
    effort: session
    next_action: After the PPN vertical slice and one real QA-to-release cycle, add Project adapters and configuration for each remaining software Project without inventing a universal deployment provider.
    expected_artifact: Every active software Project reports Stable, Candidate, proof freshness, QA state, and the exact next operator action or an explicit unsupported reason
    clarification: clarified
    confidence: medium
    source: Decision 0007
    acceptance_criteria:
      - Each active software Project has a configured proof surface or a visible reason its current work is non-demonstrable.
      - Provider differences remain adapters or Project configuration; Arcadia does not pretend Cloudflare, App Store, local service, and other release paths are identical.
      - The PPN vertical slice and at least one QA-to-release cycle are reviewed before general rollout begins.
      - Projects without a Candidate continue to expose their last known-good Stable target and do not appear broken merely because no change is in flight.
    decisions: ["0007"]
    references:
      - docs/operator-demo-and-release-contract.md
      - apps/dashboard/app/projects/[id]/page.tsx
    depends_on: [govern-release-and-delivery]
questions: []
decisions: ["0007", "0008"]
---

# Demo-first delivery

## Pareto QA slice: what ships first

The first twenty percent is a **QA tab**, not an autonomous QA system. It is a
single, truthful queue of configured Candidate work that answers the operator's
only immediate questions: *what can I test now; where do I open it; what should
I check; and have I signed off on this exact revision?*

For each Candidate, show one compact card with:

- Project and Candidate/Stable state;
- pull-request link and source revision when known;
- demo or local Test link, plus plain reachability state;
- a short, authored test procedure;
- last validation/evidence time or an explicit absence of evidence; and
- an operator Decision: pass, fail, or needs follow-up, tied to that revision.

The initial queue is configured by checked-in Project data. It deliberately
does **not** scrape GitHub, Cloudflare, or local processes; capture screenshots;
ask an LLM to judge pages; run an autonomous QA agent; merge; deploy; or send
anything to a client. Those are valuable follow-on Actions only after the
operator can reliably test the current three Candidates in one place.

This has `token_impact: none` at runtime: rendering the queue, opening links,
recording a Decision, health checks, and screenshot capture are deterministic.
The plan remains `xlarge` because later implementation and independent visual
interpretation are model-bearing; the first Action's guardrail is to keep that
work out of the vertical slice.

## Outcome

Arcadia should answer the operator's first morning question without requiring a
document-reading session: **What can I use or show right now, what changed, and
what do you need me to do next?**

The Log, plan, Runs, and validation remain available because they are how work
becomes trustworthy. They move below a proof-first handoff rather than serving
as the navigation system for finding the product.

## The vital 20 percent

The first Action is deliberately a vertical slice, not the whole release
platform. A small generic proof-target record, one Project hero, and manually
configured PPN links deliver most of the value: the operator can open Arcadia,
press Test Candidate, and see River Copy Studio while Stable remains available.

Automatic GitHub/Cloudflare discovery, screenshot scheduling, Arcadia QA, and
release management follow only after that interaction proves useful. Building
the full provider and release abstraction before the first Test button would
delay the exact relief this plan exists to provide.

## Project Detail information architecture

1. **Demo hero:** one state, one explanation, one primary action.
2. **Stable and Candidate cards:** App-Store-like descriptions of each target,
   including `What's changed`, revision, health/access, screenshot gallery,
   PR, validation, QA, Log, and last verification.
3. **Control record:** existing Milestone, Action, Responsibility, expected
   Artifact, Decisions, Runs, Artifacts, and activity.
4. **Project setup:** proof-target and demonstration-route configuration beside
   the repository and validation commands.

The hero resolves evidence rather than copying another `next_action` field.
When sources disagree, it names the disagreement and selects the safe action;
it does not silently choose the newest string.

## Cloud preview recommendation

Cloud previews are a good Candidate surface:

- Pages creates per-pull-request preview deployments, immutable hash URLs, and
  branch aliases that follow the branch.
- Workers supports versioned and human-readable aliased preview URLs.
- Both can participate in CI and both may be protected with Cloudflare Access.

They are not automatically stakeholder-safe. Preview URLs are public by
default, and preview data/config can differ from production. The plan therefore
records access state, requires Access for non-public Projects, treats preview as
Candidate, and promotes only the verified release target to Stable.

## Screenshot strategy

Use local Playwright first. It can capture a laptop service, a Cloudflare
preview, and production with the same deterministic route/viewport manifest,
without a Browser Rendering token or request cost. Store the screenshots as
normal project Artifacts keyed to revision, route, viewport, and timestamp.

Cloudflare Browser Rendering is a later optional runner when capture needs to
continue while the laptop is asleep or execute from cloud network conditions.
It is not required for the first proof gallery.

## Token impact by routine

| Routine | LLM token impact | Budget rule |
| --- | --- | --- |
| Build, typecheck, unit test, health probe | None | Run deterministically whenever needed. |
| Playwright navigation and screenshot capture | None | Capture configured routes and viewports once per Candidate revision. |
| GitHub or Cloudflare metadata synchronization | None | Read structured provider data; do not ask a model to restate it. |
| Screenshot gallery assembly and pixel comparison | None | Use deterministic manifests and image comparison first. |
| Visual interpretation of a screenshot batch | Small per Candidate | One batched model review, only when visual judgment is required. |
| Successful routine Arcadia QA | Small to Medium | Deterministic checks first; one independent summary/judgment pass over the gathered evidence. |
| Failure diagnosis and repair | Medium to Large when triggered | Invoke only after a deterministic failure and provide the smallest relevant logs, screenshots, and diff. |
| Implementation of each plan Action | Medium to Large | One bounded planning/build/review cycle per Action; do not keep an agent watching deterministic jobs. |

The plan's `xlarge` impact describes the whole multi-Action program, not every
QA run. Once built, the common successful proof and QA path should be mostly
deterministic and cheap; model cost should concentrate in implementation,
subjective visual review, and exceptional failure diagnosis.

## Arcadia QA

Arcadia QA v1 is an independent responsibility and Run profile, not a claim
that a human department already exists. It consumes the frozen Candidate and
its declared acceptance criteria, does not modify it, and produces a QA report
Artifact plus a Decision. A future human QA team can use the same contract and
add evidence without forcing a second workflow.

QA verifies correctness and declared quality. The operator retains product
judgment: whether the work is useful, feels right, and is ready to represent the
Project. Release management retains delivery authority. Keeping those roles
separate is the point.

## Activation

This plan is active under Decision 0007. Decision 0018 inserted the completed
minimal pull-request QA prerequisite when Private Practice Now made the missing
responsibility urgent. Decision 0019 now inserts the short
`streamline-minimal-pr-qa` Action to remove two proven repeat costs and preserve
the Arcadia-led development north star. When it is complete, the pointer returns
to `build-demo-hero-vertical-slice`, the first remaining usable proof.
