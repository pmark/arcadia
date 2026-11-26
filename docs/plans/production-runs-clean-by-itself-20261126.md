---
arcadia: v1
type: plan
slug: production-runs-clean-by-itself-20261126
project: arcadia
status: draft
milestone: Production runs clean by itself 20261126
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-26
actions:
  - id: rerun-a-timed-out-check-whose-tests-passed
    title: The worker re-runs, once per head, a required check that GitHub cancelled at its job time limit when the job log shows the test runner finished with zero failed tests, and records it as its own recovery.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: The worker re-runs, once per head, a required check that GitHub cancelled at its job time limit when the job log shows the test runner finished with zero failed tests, and records it as its own recovery.
    expected_artifact: Evidence satisfying Agent Ask rerun-a-timed-out-check-whose-tests-passed
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-production-runs-clean-by-itself-20261126
    why: "Twice on 2026-11-25 (#3072, #3094) an agent re-ran unit-shard-1 after a timeout with every test passing (C1, #3073); the worker's own re-trigger covers only stuck or never-started checks."
    acceptance_criteria:
      - A fixture test with injected GitHub calls shows a gating check cancelled at its job time limit, whose log carries the test runner summary with zero failed tests, gets exactly one rerun of that run id, recorded before the first GitHub call, and the review continues when the rerun passes.
      - Fixture tests show no rerun and the existing required_checks_failed escalation when the log shows a failed test, has no runner summary, cannot be read, or the head already used its one re-trigger.
      - The rerun shares the existing once-per-head record (checks_retrigger_at and checks_retrigger_json), so a worker restart never reruns the same head twice, and a test shows it.
      - The receipt names the run id, the head and the summary line it relied on, and the run's escalation list records it as a worker recovery, not an escalation; a test shows it.
    depends_on: []
    decisions: []
    references: ["src/production/independentReview.ts", "src/production/reviewRepair.ts", ".github/workflows/ci.yml", "docs/decisions/0297-amend-decision-0288-rule-2-record-the-operator-s-answer-1a-2a-which-defines-a.md"]
  - id: self-heal-a-stale-candidate-index-lock
    title: Completion auto-settle clears a stale, unheld index.lock in a finished Session's candidate worktree and retries once before any escalation, and preservation's read-only git calls take no index lock.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: Completion auto-settle clears a stale, unheld index.lock in a finished Session's candidate worktree and retries once before any escalation, and preservation's read-only git calls take no index lock.
    expected_artifact: Evidence satisfying Agent Ask self-heal-a-stale-candidate-index-lock
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-production-runs-clean-by-itself-20261126
    why: "On 2026-11-25 a stale index.lock blocked Action 6's auto-settle; it escalated as operator_gate_pending, a hand settle raced preservation and card B stalled (#3105, #981)."
    acceptance_criteria:
      - A failing-first fixture test shows a candidate worktree with a 0-byte index.lock older than a stated bound, with no live Session and no repository lease, auto-settles after one recorded retry and records no operator_gate_pending escalation.
      - A test shows a lock younger than the bound, or any lock while the Session or its repository lease is live, is never removed and today's behaviour stands.
      - Read-only git status calls made by preservation run with GIT_OPTIONAL_LOCKS=0, and a test asserts it on the spawned environment.
      - The retry receipt names the lock path, its age and the settle it unblocked, and the remedy text for this case names the host repair instead of the operator's call.
    depends_on: []
    decisions: []
    references: ["src/ask/autoSettleBeforeDispatch.ts", "src/production/tick.ts", "src/sessions/preservationStages.ts", "src/git/worktrees.ts", "src/production/blockerRemedies.ts"]
  - id: count-run-touches-by-class
    title: start-run day-evidence reports, per run, the worker's own recoveries and every recorded agent or operator touch by Decision 0297 class, with the qualifying and strict clean verdicts side by side.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: start-run day-evidence reports, per run, the worker's own recoveries and every recorded agent or operator touch by Decision 0297 class, with the qualifying and strict clean verdicts side by side.
    expected_artifact: Evidence satisfying Agent Ask count-run-touches-by-class
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-production-runs-clean-by-itself-20261126
    why: "Decision 0297 requires every report to show the strict count beside the qualifying one and a cause recurring twice to get a real fix; today both are kept by hand in a workspace file."
    acceptance_criteria:
      - arcadia coordinator note accepts an optional --class (C1, C2, C3, C4 or C5) and --cause (an Issue number) stored with the note, and a test shows a valid note and a refusal for any other class.
      - "A fixture test shows day-evidence for one run lists the C0 worker recoveries found in existing receipts (repair rounds, check re-triggers, lock self-heals), the class-tagged notes between the press and scope complete, and two verdicts: qualifying (no C3, C4 or C5) and strict (no touch at all)."
      - A fixture test shows a cause cited by C1 or C2 notes in two earlier qualifying runs, with no merged pull request naming it, makes a third such run read not qualifying, with the reason named.
      - With no class-tagged notes, existing day-evidence output and tests are unchanged apart from the added fields, and tests/pin-coordinator-note-pr-parse.test.ts still passes.
    depends_on: []
    decisions: []
    references: ["src/coordinator/state.ts", "src/commands/coordinator.ts", "src/production/policy.ts", "src/commands/startRun.ts", "docs/decisions/0298-clarify-decision-0297-s-any-touch-from-you-after-the-press-record-the-operator.md"]
  - id: launch-production-builds-on-the-plan-model-rule
    title: A production build Session launches on the model and effort that Decision 0290 A's rule selects for its Action, instead of the cheapest enabled binding.
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: A production build Session launches on the model and effort that Decision 0290 A's rule selects for its Action, instead of the cheapest enabled binding.
    expected_artifact: Evidence satisfying Agent Ask launch-production-builds-on-the-plan-model-rule
    clarification: clarified
    confidence: high
    source: Agent Ask ellis-plan-production-runs-clean-by-itself-20261126
    why: "Packets pick the cheapest enabled build binding (src/codex/packets.ts:262-285) and launch uses the start tier (src/sessions/launch.ts:452-456), so source Actions cannot run under Decision 0290 A (#3049), which Milestone 9 requires."
    acceptance_criteria:
      - A fixture test shows, under a Claude-only activation, an Action whose acceptance or references name a src/ path launches on the Opus high binding and an Action naming only tests/, docs/ or config paths launches on Sonnet medium.
      - A fixture test shows every review repair Session launches on Opus high.
      - When the selected binding is not enabled, the launch records the departure from the rule with the binding actually used and the reason, and a test shows it.
      - The launch record and the Session brief name the model, the effort and the rule that chose them, and a test shows both.
    depends_on: []
    decisions: []
    references: ["src/codex/packets.ts", "src/sessions/launch.ts", "src/codex/providerAdapters.ts", "src/sessions/partners.ts", "docs/decisions/0290-implementer-model-and-effort-rule-for-production-opus-high-for-source-work-and.md"]
questions: []
decisions: []
---

# Production runs clean by itself 20261126

Created as an inactive draft from accepted Agent Ask ellis-plan-production-runs-clean-by-itself-20261126; creation changed no pointer. Current activation is recorded in frontmatter.
