---
arcadia: v1
type: plan
slug: draft-an-inactive-batch-11-plan-of-four-bounded-actions-that-make-way
project: arcadia
status: draft
milestone: Draft an inactive batch 11 Plan of four bounded Actions that make Way propagation automatic after every Arcadia main change (deterministic once-per-revision trigger, policy-respecting delivery, loud alerting plus per-project last-propagated revision, and Arcadia self-drift false positive)
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-15
actions:
  - id: add-way-sync-once-per-source-revision
    title: Add `arcadia way sync`, an idempotent once-per-Way-source-revision propagation run, and have the live worker start it as a detached bounded child whenever the Way source revision changes.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Add `arcadia way sync`, an idempotent once-per-Way-source-revision propagation run, and have the live worker start it as a detached bounded child whenever the Way source revision changes.
    expected_artifact: Evidence satisfying Agent Ask add-way-sync-once-per-source-revision
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-11-20261114
    why: "Authority path (src/commands/*, src/cli.ts, src/workspace/experimentGuard.ts). Propagation is only manual today, so a merge to Arcadia main that changes Way sources reaches no adopting repository."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: runWayPropagation has exactly one non-test caller, runWayPropagateCommand in src/commands/way.ts (rg 'runWayPropagation' src apps scripts); createWorkerTick and runWorkerIteration in src/commands/worker.ts never reference it; the tick body is synchronous (comment near line 640) so propagation must not run inline; no launchd plist or script under scripts/ calls `way propagate`."
      - "A failing-first test in a new tests/way-sync.test.ts, using an injected runPropagation and a temp workspace, shows: the Way source revision is a sha256 over the canonical bytes propagation derives from (CONSTITUTION.md, the docs/agents-context.md managed region, the indexed guidance resources and the continuation protocol), so an edit to an unrelated doc does not change it; the first sync for a revision calls propagation once and records the revision in a ledger file under the workspace; a second sync for the same revision calls nothing; a changed source calls it again; a failed run leaves the revision unrecorded so it retries; two concurrent syncs are excluded by a lock whose stale owner is reclaimed; and sync from a linked worktree or with a dirty Arcadia main checkout does nothing and says why. It fails before the command exists."
      - "`arcadia way sync [--dry-run] [--workspace] [--json] [--agent --tier]` is added in src/commands/way.ts and src/cli.ts, composes runWayPropagation without changing its behaviour, resolves commit identity from `arcadia identity resolve` defaults (builder, standard) rather than the operator, and is classified in COMMAND_CLASSIFICATION (guarded unless --dry-run, same as `way propagate`) and in tests/activity-no-record-commands.test.ts as that file requires; the existing experiment-guard test passes unmodified."
      - createWorkerTick (or its runWorkerIteration) starts `arcadia way sync` as a detached child with a 10 minute ceiling, never inline, never more than one at a time, at most once per five minutes, and a spawn failure only logs; a test with an injected spawner shows these four properties and that the tick still completes when the spawner throws.
      - pnpm vitest run tests/way-sync.test.ts tests/experiment-workspace-guard.test.ts tests/activity-no-record-commands.test.ts tests/way-propagation.test.ts --testTimeout 150000 passes, and only src/projects/waySync.ts (new), src/commands/way.ts, src/cli.ts, src/commands/worker.ts, src/workspace/experimentGuard.ts, tests/way-sync.test.ts (new) and tests/activity-no-record-commands.test.ts change; the Session records the authority-path edits in the PR description and states that merging this does not itself run a propagation against a live repository.
    depends_on: []
    decisions: []
    references: ["src/projects/wayPropagate.ts", "src/projects/wayPropagation.ts", "src/commands/way.ts", "src/commands/worker.ts", "src/workspace/experimentGuard.ts", "tests/activity-no-record-commands.test.ts", "docs/decisions/0024-way-propagation-tiers-and-push-authority.md"]
  - id: way-propagation-dedupes-and-merges-per-policy
    title: "Make propagation safe to run unattended: reuse an open Way PR instead of opening another, auto-merge only a mechanical-only PR in a repository that declares upgrade_policy auto, and report every other outcome as one operator-visible needs-review result."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Make propagation safe to run unattended: reuse an open Way PR instead of opening another, auto-merge only a mechanical-only PR in a repository that declares upgrade_policy auto, and report every other outcome as one operator-visible needs-review result."
    expected_artifact: Evidence satisfying Agent Ask way-propagation-dedupes-and-merges-per-policy
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-11-20261114
    why: "Authority path (src/projects). Without de-duplication a repeating trigger opens a PR per run, and without the merge step Decision 0024's mechanical tier never merges."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: applyPropagation in src/projects/wayPropagate.ts creates a uniquely named branch and `gh pr create` on every apply whose pinned base is still stale, never lists open `arcadia-way/propagate-*` PRs, and never calls `gh pr merge`; the only merge text is the PR body sentence about governing changes; readUpgradePolicy and declinesAutomaticUpgrades (src/projects/wayPropagation.ts) recognise only `explicit-only` as a decline; plan.hasGoverningChanges is true whenever a guidance resource, CONSTITUTION.md or the continuation protocol is written (wayPropagation.ts lines 115 to 140)."
      - "Failing-first tests in tests/way-propagation.test.ts against the existing local bare-origin fixture with an injected runCommand show: with an open arcadia-way PR whose branch already carries the same planned bytes, a second apply opens nothing and returns status `pending-review` with the existing PR URL; if the open PR is stale against a newer plan, it is updated by pushing a new commit to that branch, never a second PR; a mechanical-only plan in a repo with upgrade_policy `auto` opens the PR and then runs `gh pr merge --auto --squash` once, and merge failure leaves the PR open and returns `needs-review` with the reason; a mechanical-only plan with no policy or `explicit-only` never calls merge; any plan with a governing change never calls merge, even with policy `auto`, and returns `needs-review` naming the files; the merge call is path-checked so only AGENTS.md and CLAUDE.md can be in an auto-merged diff."
      - New statuses `pending-review` and `merged-when-green` extend WAY_PROPAGATION_STATUSES with counts and rendering in renderWayPropagateSuccess; no existing status changes meaning; Arcadia's repository, protected branches and each target repository's own required checks stay the only gate, nothing is force-pushed and no merge bypass flag is used.
      - "The PR description for this Action names the operator choice it deliberately does not make: because guidance, the Constitution and the protocol are governing tier, a typical Way change still ends as an open PR needing a human merge per repository, so 'fully automatic' needs a Decision amendment to Decision 0024 that the operator must answer separately."
      - pnpm vitest run tests/way-propagation.test.ts tests/way-status.test.ts --testTimeout 150000 passes, and only src/projects/wayPropagate.ts, src/projects/wayPropagation.ts and tests/way-propagation.test.ts change; the Session records the authority-path edit in the PR description.
    depends_on: [add-way-sync-once-per-source-revision]
    decisions: []
    references: ["src/projects/wayPropagate.ts", "src/projects/wayPropagation.ts", "tests/way-propagation.test.ts", "docs/decisions/0024-way-propagation-tiers-and-push-authority.md"]
  - id: alert-and-show-last-propagated-revision
    title: Queue one deduplicated operator ping when a way sync fails or any project stays stale past a bound, and show the last propagated Way revision, open PR and age per project in `arcadia way`.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Queue one deduplicated operator ping when a way sync fails or any project stays stale past a bound, and show the last propagated Way revision, open PR and age per project in `arcadia way`.
    expected_artifact: Evidence satisfying Agent Ask alert-and-show-last-propagated-revision
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-11-20261114
    why: "Authority path (src/projects, src/commands/*). A silent failure of an unattended trigger is the failure the operator named; propagation results are printed only to the CLI today."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report: nothing outside the CLI consumes WayPropagationSummary or reportWayDrift (rg), queueOperatorPing in src/ping/operatorPing.ts is the existing operator-visible path (kinds look, fyi, attention; it deduplicates by episodeKey), and the WayDriftReport type carries no revision or age field."
      - "Failing-first tests in a new tests/way-sync-alerts.test.ts (injected clock and a temp workspace database) show: a failed or `error` result queues exactly one `attention` ping per source revision and project with a stable episodeKey, replayed runs add none, and the ping text names the project, the file list, the PR URL if any and the exact next command; a project still [stale] more than a bound (default 6 hours after the revision was first seen, configurable by constant) queues one ping per episode; `needs-review` and `pending-review` results are folded into one ping per revision, not one per repo; a successful sync that leaves every project current queues nothing."
      - "`arcadia way` (runWayStatusCommand and renderWayStatusSuccess) reads the ledger from the first Action and shows, per project, `Way revision: <short sha> propagated <age> ago` with the PR URL when one is open, or `never propagated`; the JSON adds lastPropagatedRevision, lastPropagatedAt and pullRequestUrl; existing fields and the exit code are unchanged, and a missing ledger renders as `never propagated` without error."
      - pnpm vitest run tests/way-sync-alerts.test.ts tests/way-status.test.ts tests/way-sync.test.ts --testTimeout 150000 passes, and only src/projects/waySync.ts, src/projects/wayDrift.ts, src/commands/way.ts, tests/way-sync-alerts.test.ts (new), tests/way-status.test.ts and tests/way-sync.test.ts change; the Session records any authority-path edit in the PR description and uses no new ping kind and no schema change.
    depends_on: [add-way-sync-once-per-source-revision, way-propagation-dedupes-and-merges-per-policy]
    decisions: []
    references: ["src/ping/operatorPing.ts", "src/projects/wayDrift.ts", "src/commands/way.ts", "tests/way-status.test.ts"]
  - id: arcadia-own-way-drift-is-not-stale
    title: Stop reporting Arcadia, the canonical source, as stale on indexed guidance, or prove and fix the real divergence.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Stop reporting Arcadia, the canonical source, as stale on indexed guidance, or prove and fix the real divergence.
    expected_artifact: Evidence satisfying Agent Ask arcadia-own-way-drift-is-not-stale
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-batch-11-20261114
    why: "Authority path (src/projects). `arcadia way` reports Arcadia [stale] for guidanceResources, so a permanent red row would drown real alerts and trip the stale-bound ping from the previous Action."
    acceptance_criteria:
      - "Confirm the cause in code before editing; if the premise is false, stop and report which case holds: compareGuidanceResources in src/projects/wayDrift.ts applies adoptGuidanceResource to each file under docs/agent-guidance and docs/managed-documents.md and docs/planning-process.md in Arcadia's own checkout and ten of them (continuation, agent-asks, operator-actions, proposals, principles, pull-requests, learning, git-identity, managed-documents, planning-process) come back different, while the canonical source files themselves are the input; decide and state whether that is the adopter transform being applied to the source (a false positive) or a real difference between the checked-in file and the generated output."
      - A failing-first test in tests/way-status.test.ts shows a drift report for the Arcadia checkout itself marks guidanceResources `match` when its files are the canonical source, still marks a differing adopter copy `differs`, and still reports `missing`; for the real-divergence outcome the test instead asserts the regenerated file bytes and the fix is a regeneration, not a hand edit of governed text.
      - The fix lives in wayDrift.ts (a canonical-source short-circuit using the same arcadiaRepoRoot/sharesRepository test propagation already uses for the `self` status), changes no adopter result, and `arcadia way` for Arcadia reads [current] with no hand-edited guidance file.
      - pnpm vitest run tests/way-status.test.ts tests/arcadia-way-propagation.test.ts --testTimeout 150000 passes, and only src/projects/wayDrift.ts and tests/way-status.test.ts change (plus the single docs/agent-guidance file named by the failing assertion only if the real-divergence outcome holds, regenerated, not hand edited); the Session states the outcome in the PR description.
    depends_on: [alert-and-show-last-propagated-revision]
    decisions: []
    references: ["src/projects/wayDrift.ts", "src/projects/contextSetup.ts", "src/projects/agentGuidance.ts", "tests/way-status.test.ts", "tests/arcadia-way-propagation.test.ts"]
questions: []
decisions: []
---

# Draft an inactive batch 11 Plan of four bounded Actions that make Way propagation automatic after every Arcadia main change (deterministic once-per-revision trigger, policy-respecting delivery, loud alerting plus per-project last-propagated revision, and Arcadia self-drift false positive)

Created as an inactive draft from accepted Agent Ask ellis-batch-11-20261114; creation changed no pointer. Current activation is recorded in frontmatter.
