---
arcadia: v1
type: plan
slug: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
project: arcadia
status: active
milestone: "Arcadia runs production unattended on its own repository on the Claude provider: the worker launches a Session, preserves a reviewed PR, merges it through the PR when it is not authority-adjacent, and continues to the next Action within a spend bound, with operator touches limited to authority-adjacent merges."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-21
actions:
  - id: launch-failure-keeps-cause
    title: Make a Session launch failure keep its underlying cause in the red-alert evidence and in production status.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-launch-failure-keeps-cause-20261014; no further action.
    expected_artifact: Evidence satisfying Agent Ask launch-failure-keeps-cause
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2
    why: "The 2026-10-11 run failed 155 times with only a wrapper message; nobody can fix a launch failure whose cause is discarded."
    acceptance_criteria:
      - When tmux or the provider launch fails, the red-alert evidence file and arcadia production status --json carry the underlying error text (stderr or exception message), bounded in length.
      - A hermetic test makes the tmux launch fail with a known stderr and asserts that text appears in the red-alert evidence and in production status.
      - Focused tests, lint, tsc and pnpm build pass.
    depends_on: []
    decisions: []
    references: []
  - id: claude-worker-launch-replay
    title: Replay one production tick launch on the claude-code provider and fix whatever stops it reaching a running Session and a draft PR.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-claude-worker-launch-replay-20261017-r2; no further action.
    expected_artifact: Evidence satisfying Agent Ask claude-worker-launch-replay
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2
    why: "Codex is dormant and the launch path that failed is provider-neutral; the first supervised run needs proof that the worker can launch Claude."
    acceptance_criteria:
      - A replay test drives the real worker tick launch path on the claude-code provider in an experiment workspace (Decision 0082) or the fast-rehearsal harness, with only external services faked, and asserts the Session row reaches status running and a draft PR is recorded.
      - Every defect the replay finds is fixed with a test that fails before the fix, and the replay is kept as a regression scenario.
      - The replay names whether the 2026-10-11 tmux failure reproduces on claude-code, with its retained cause, or records it as not reproduced.
      - Focused tests, lint, tsc and pnpm build pass.
    depends_on: [launch-failure-keeps-cause]
    decisions: []
    references: []
  - id: claude-capacity-evidence
    title: Give the capacity gate a fresh unattended Claude usage reading, or a named gate-off path, and raise the spend-bound card for a Claude run.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-claude-capacity-evidence-20261017; no further action.
    expected_artifact: Evidence satisfying Agent Ask claude-capacity-evidence
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2
    why: "With the capacity gate on, Claude is refused capacity_stale because nothing refreshes its usage snapshot; Decision 0123 answered for Codex only."
    acceptance_criteria:
      - Either the worker refreshes the Claude usage snapshot unattended before admission, with a test that a stale snapshot is refreshed rather than refused, or production status names the gate-off path and its consequence for a Claude run.
      - An Agent Ask raises one Decision, as a card on /todo, asking the operator for the spend bound of a supervised Claude run, each option stating its consequence.
      - A test asserts the workspace config file hash is unchanged after the suite, and the suite makes zero live provider calls.
    depends_on: [claude-worker-launch-replay]
    decisions: []
    references: []
  - id: first-supervised-claude-run
    title: Prepare and evidence the first supervised production run on Arcadia's own repository on the claude-code provider, one Action, ending in a merged PR.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-first-supervised-claude-run-20261018; no further action.
    expected_artifact: Evidence satisfying Agent Ask first-supervised-claude-run
    clarification: clarified
    confidence: high
    source: Agent Ask cut-overlap-criterion-first-supervised-claude-run-20261017
    why: "No production run has completed an Action on a non-disposable repository; this is the first proof on the real repository."
    acceptance_criteria:
      - A production preview scoped to claude-code, one Action, concurrency 1 and remote preservation is published with its fingerprint, and the operator's activation is presented as one card; agents do not activate.
      - After the operator activates, the run's Session reaches a draft PR, an independent review of its head is recorded, and the PR merges through the batch-merge card or the operator.
      - docs/managed-production-readiness.md is refreshed under its Refresh contract with the run's observed stages, failures and operator touches.
    depends_on: [claude-capacity-evidence]
    decisions: []
    references: []
  - id: worker-review-and-merge
    title: "Build the worker's automated review-and-merge (Decision 0097): merge a candidate PR through GitHub only when an independent review of its exact head passes, required checks are green and it is not authority-adjacent."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-worker-review-and-merge-20261018; no further action.
    expected_artifact: Evidence satisfying Agent Ask worker-review-and-merge
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2
    why: "The worker never merges today, so every Action needs a supervisor; this is the step from supervised to unattended."
    acceptance_criteria:
      - The worker merges only through the pull request, never by a local fast-forward or base-branch push, and only after a recorded independent review of the exact head has no blocking finding and every required check on that head passed.
      - A PR the blast-radius assessment marks authority-adjacent is never merged by the worker and appears on the batch-merge card with its reason.
      - A moved head, a failed check or a missing review refuses the merge with a named reason, each covered by a hermetic test, and the fast-rehearsal chain merges a fixture PR end to end.
      - Focused tests, lint, tsc, pnpm build and the fast rehearsal pass.
    depends_on: [first-supervised-claude-run]
    decisions: []
    references: []
  - id: production-spend-budget
    title: Enforce the approved percent-of-window spend budget and emergency reserve (Decisions 0103 and 0111) at production admission.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-production-spend-budget-20261017; no further action.
    expected_artifact: Evidence satisfying Agent Ask production-spend-budget
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2
    why: "Without a window budget an unattended run can consume the operator's own interactive allowance on shared accounts."
    acceptance_criteria:
      - Admission refuses a launch that would breach the budget or the operator reserve set by Decisions 0103 and 0111, with the refusal shown in production status on the same tick.
      - Hermetic tests cover under-budget admission, budget refusal, reserve refusal and an unreadable usage reading treated as unknown, never as admitted.
      - A test asserts the workspace config file hash is unchanged after the suite, and the suite makes zero live provider calls.
    depends_on: [claude-capacity-evidence]
    decisions: []
    references: []
  - id: credential-preflight
    title: "Make the production preflight detect a provider credential that cannot be refreshed unattended before it launches (#1155)."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-credential-preflight-20261017; no further action.
    expected_artifact: Evidence satisfying Agent Ask credential-preflight
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2
    why: "An overnight run otherwise discovers an expired login only after launch and stalls with no operator alert."
    acceptance_criteria:
      - The preflight refuses a launch whose provider credential is expired or unrefreshable, names the provider and the remedy card, and pings the operator once.
      - Hermetic tests cover a valid credential, an expired one and an unreadable state treated as unknown.
      - No host credential configuration is modified by the code or its tests.
    depends_on: [claude-worker-launch-replay]
    decisions: []
    references: []
  - id: first-unattended-run
    title: Evidence a multi-Action unattended production run on Arcadia's own repository whose only operator touches are activation and merges of authority-adjacent PRs.
    status: open
    responsibility: agent
    effort: session
    next_action: Evidence a multi-Action unattended production run on Arcadia's own repository whose only operator touches are activation and merges of authority-adjacent PRs.
    expected_artifact: Evidence satisfying Agent Ask first-unattended-run
    clarification: clarified
    confidence: high
    source: Agent Ask add-clean-run-actions-20261021-r4
    why: "This run is the milestone's proof that Arcadia maintains momentum on its own repository without supervision."
    acceptance_criteria:
      - A production preview for at least three ready Actions on claude-code is published and its activation presented as one card; agents do not activate.
      - The run's ledger rows show every Action reaching a merged PR, with each operator touch listed and none other than activation and authority-adjacent merges.
      - docs/managed-production-readiness.md is re-derived from the run, stating the new verdict and every failure observed.
    depends_on: [worker-review-and-merge, production-spend-budget, credential-preflight, test-transient-review-retry-after-exhaustion, refresh-decision-0130-status-and-1559-fake, guard-repair-gate-upsert-role, cover-mail-ack-receipt-kind-collision, isolate-launch-preview-tmux-name, bound-guidance-test-teardown-retries]
    decisions: []
    references: []
  - id: implement-a-hermetic-test-that-an
    title: Implement a hermetic test that an over-budget production admission refusal names the 80% unattended budget and the window that breached it.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-implement-a-hermetic-test-that-an-r2-20261018; no further action.
    expected_artifact: Evidence satisfying Agent Ask implement-a-hermetic-test-that-an
    clarification: clarified
    confidence: high
    source: Agent Ask add-budget-refusal-reason-test-20261017
    acceptance_criteria:
      - In tests/provider-capacity-admission.test.ts, an over-budget production admission (85% on the 5-hour window) is refused with code capacity_refused and a reason that names the 80% unattended budget and the 5-hour window.
      - A second case refuses on the 7-day window and names it.
      - The change touches only tests/provider-capacity-admission.test.ts; focused tests, lint and tsc pass.
    depends_on: []
    decisions: []
    references: []
  - id: implement-a-hermetic-test-that-a
    title: Implement a hermetic test that a refused tmux launch leaves no launcher file behind.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-implement-a-hermetic-test-that-a-a4a78ac5e15b; no further action.
    expected_artifact: Evidence satisfying Agent Ask implement-a-hermetic-test-that-a
    clarification: clarified
    confidence: high
    source: Agent Ask add-first-unattended-run-actions-20261018
    acceptance_criteria:
      - In tests/system-tmux-long-command.test.ts, a systemTmux.launch whose tmux new-session fails (for example a PATH tmux shim that exits non-zero) throws the existing launch failure and leaves no launch-*.sh file in the launcher directory.
      - The test uses its own temporary directory and private tmux socket or shim, never the host's default tmux server.
      - The change touches only tests/system-tmux-long-command.test.ts; focused tests, lint and tsc pass.
    depends_on: []
    decisions: []
    references: []
  - id: implement-a-hermetic-test-that-an-2
    title: Implement a hermetic test that an interactive tmux launch with a 64 KiB brief keeps the brief byte-identical.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-implement-a-hermetic-test-that-an-2-dc90bc96a74c; no further action.
    expected_artifact: Evidence satisfying Agent Ask implement-a-hermetic-test-that-an-2
    clarification: clarified
    confidence: high
    source: Agent Ask add-first-unattended-run-actions-20261018
    acceptance_criteria:
      - In tests/system-tmux-long-command.test.ts, a systemTmux.launch with no launcherDirectory (the interactive temporary-directory path) on a private tmux socket delivers a 64 KiB brief to a stub provider byte-identical, and the temporary launcher directory is removed afterwards.
      - The test skips when tmux is not installed and never uses the host's default tmux server.
      - The change touches only tests/system-tmux-long-command.test.ts; focused tests, lint and tsc pass.
    depends_on: []
    decisions: []
    references: []
  - id: implement-docs-reports-first-supervised-claude
    title: Implement docs/reports/first-supervised-claude-run-2026-10-18.md, a standalone report of the first supervised Claude production run.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-implement-docs-reports-first-supervised-claude-69db38eeb760; no further action.
    expected_artifact: Evidence satisfying Agent Ask implement-docs-reports-first-supervised-claude
    clarification: clarified
    confidence: high
    source: Agent Ask add-first-unattended-run-actions-20261018
    acceptance_criteria:
      - "docs/reports/first-supervised-claude-run-2026-10-18.md exists and records the run's stages (activation, capacity, selection, launch, session, completion, review and merge), each failure with its fixing PR or issue (#1512/#1514, #1513, #1518, #1520), and the operator touches, consistent with the 2026-10-18 section of docs/managed-production-readiness.md."
      - Every PR and issue number cited resolves to the stated item on GitHub.
      - The change touches only that new report file.
    depends_on: []
    decisions: []
    references: []
  - id: test-transient-review-retry-after-exhaustion
    title: Implement hermetic tests that a transient reviewer error still retries after the review_attempts_exhausted branch and that resetProductionRepairBudget leaves that escalation in place.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-test-transient-review-retry-after-exhaustion-tests-only-20261020; no further action.
    expected_artifact: Evidence satisfying Agent Ask test-transient-review-retry-after-exhaustion
    clarification: clarified
    confidence: high
    source: Agent Ask add-next-unattended-run-actions-20261019
    why: "Issue #1582: the independent review of #1578 found neither case covered."
    acceptance_criteria:
      - tests/tick-independent-review.test.ts gains a case where a reviewer call fails with a transient error while the Action's verdict attempts are below MAX_VERDICT_ATTEMPTS, and a later tick runs the reviewer again with no review_attempts_exhausted escalation recorded.
      - tests/tick-independent-review.test.ts gains a case where, after a review_attempts_exhausted escalation is recorded, calling resetProductionRepairBudget for that Action leaves the escalation with kind review_attempts_exhausted in place and runs no reviewer.
      - The change touches only tests/tick-independent-review.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1570", "https://github.com/pmark/arcadia/issues/1582"]
  - id: refresh-decision-0130-status-and-1559-fake
    title: "Implement the two stale-text corrections from Issue #1585: record Decision 0130 as approved in docs/managed-production-readiness.md and remove the refreshToken field from the issue #1559 test's injected credentials."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-refresh-decision-0130-status-and-1559-fake-897fbd92d9f0; no further action.
    expected_artifact: Evidence satisfying Agent Ask refresh-decision-0130-status-and-1559-fake
    clarification: clarified
    confidence: high
    source: Agent Ask add-next-unattended-run-actions-20261019
    why: "Issue #1585 items 3 and 4: the readiness document still calls Decision 0130 raised and unanswered, and the #1559 test fake still returns a refresh token the read-only path no longer uses."
    acceptance_criteria:
      - In docs/managed-production-readiness.md, the Claude usage credential and window cap row (near line 101) states that Decision 0130 is approved and no longer says it is raised and unanswered; no other line of that file changes.
      - "In tests/claude-capacity-preadmission.test.ts, the loadCredentials fake inside the test named 'issue #1559: a 401 through the capacity-observer refresh never contacts the OAuth token endpoint' returns no refreshToken field, and that test still passes."
      - The change touches only those two files; the focused vitest run of tests/claude-capacity-preadmission.test.ts, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1570", "https://github.com/pmark/arcadia/issues/1585"]
  - id: guard-repair-gate-upsert-role
    title: Implement a role guard on the gated review-repair upsert in src/production/reviewRepair.ts so its ON CONFLICT DO UPDATE changes only a row whose role is REPAIR_CANDIDATE_GATE_ROLE, with a hermetic test.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-guard-repair-gate-upsert-role-5c6c22a76403; no further action.
    expected_artifact: Evidence satisfying Agent Ask guard-repair-gate-upsert-role
    clarification: clarified
    confidence: high
    source: Agent Ask amend-guard-repair-gate-test-file-20261020
    why: "Issue #1574 item 3: the DO UPDATE can overwrite the summary and reason of a non-gate review-repair row that shares its request id."
    acceptance_criteria:
      - In src/production/reviewRepair.ts, the INSERT INTO production_review_repairs ... ON CONFLICT(request_id) DO UPDATE statement that writes REPAIR_CANDIDATE_GATE_ROLE has a WHERE clause that also requires production_review_repairs.role to equal REPAIR_CANDIDATE_GATE_ROLE.
      - A hermetic test in tests/review-repair-gate-upsert-role.test.ts seeds a production_review_repairs row with the gate path's request id and a role other than REPAIR_CANDIDATE_GATE_ROLE, runs the gate path, and asserts that row's summary, reason and role are unchanged; the test fails without the guard.
      - The change touches only src/production/reviewRepair.ts and tests/review-repair-gate-upsert-role.test.ts; the focused vitest run of tests/review-repair-gate-upsert-role.test.ts, pnpm lint, tsc and pnpm build pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1570", "https://github.com/pmark/arcadia/issues/1574"]
  - id: cover-mail-ack-receipt-kind-collision
    title: "Add a native-mail test that a self-report and a disposal reusing an acknowledged message's own acknowledgment receipt id are refused by the receipt-kind collision guards, closing Issue #1470."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement a native-mail test that a self-report and a disposal reusing an acknowledged message's own acknowledgment receipt id are refused by the receipt-kind collision guards, closing Issue #1470."
    expected_artifact: Evidence satisfying Agent Ask cover-mail-ack-receipt-kind-collision
    clarification: clarified
    confidence: high
    source: Agent Ask retitle-clean-run-actions-implement-20261021
    why: "Issue #1470: the existing disposal-collision test is refused by the disposed-message guard first, so the kind-mismatch branch is not directly exercised."
    acceptance_criteria:
      - "tests/native-mail.test.ts gains a test that acknowledges a message without disposing it, then calls reportMailResult and disposeMailMessage with the request id message.id plus ':acknowledgment', and asserts both throw an error whose message contains the substring 'already recorded as a different operation (acknowledgment)'."
      - The same test asserts the message status is still acknowledged afterwards, and every other test in the file passes unchanged.
      - The change touches only tests/native-mail.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1470"]
  - id: isolate-launch-preview-tmux-name
    title: "Stop tests/launch-preview.test.ts from consulting the host tmux server for its deterministic Session name, closing Issue #1628."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement a tmux stub in tests/launch-preview.test.ts so its deterministic Session name no longer consults the host tmux server, closing Issue #1628."
    expected_artifact: Evidence satisfying Agent Ask isolate-launch-preview-tmux-name
    clarification: clarified
    confidence: high
    source: Agent Ask retitle-clean-run-actions-implement-20261021
    why: "Issue #1628: a fixed fixture clock yields a fixed tmux Session name, so a leftover host session fails the already-leased test with 'The tmux Session name already exists'."
    acceptance_criteria:
      - In tests/launch-preview.test.ts, the prepareSession call in the test named 'names an already-leased repository as a conflicting-execution prerequisite' passes a tmux stub whose available() returns true, whose hasSession returns false while recording each queried name, and whose launch is never called; the test asserts at least one name was recorded and every recorded name starts with arcadia-test-project-, so that prepareSession call no longer consults the host tmux server (the buildLaunchPreview call may also receive the stub via its tmux input).
      - The test still asserts preview.ready is false and a prerequisite starting with 'conflicting execution', and every other test in the file passes unchanged.
      - The change touches only tests/launch-preview.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1628"]
  - id: bound-guidance-test-teardown-retries
    title: "Make the scratch-directory teardown in the agent-guidance test retry a transient ENOTEMPTY instead of failing the shard, closing Issue #1419."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement bounded retries in the agent-guidance test's scratch-directory teardown so a transient ENOTEMPTY no longer fails the shard, closing Issue #1419."
    expected_artifact: Evidence satisfying Agent Ask bound-guidance-test-teardown-retries
    clarification: clarified
    confidence: high
    source: Agent Ask retitle-clean-run-actions-implement-20261021
    why: "Issue #1419: the suite failed CI in afterEach with ENOTEMPTY from an unbounded rmSync while a concurrent writer was still active."
    acceptance_criteria:
      - In tests/agent-guidance.test.ts, the afterEach rmSync of the scratch roots passes recursive true, force true, maxRetries of at least 3 and retryDelay of at least 50 milliseconds.
      - Every existing assertion in that file remains unchanged and no test in it is marked skip or todo.
      - The change touches only tests/agent-guidance.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1419"]
questions: []
decisions: []
recommended_model: standard
recommended_reasoning_effort: medium
current_action: cover-mail-ack-receipt-kind-collision
---

# Arcadia runs production unattended on its own repository on the Claude provider: the worker launches a Session, preserves a reviewed PR, merges it through the PR when it is not authority-adjacent, and continues to the next Action within a spend bound, with operator touches limited to authority-adjacent merges.

Created as an inactive draft from accepted Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2; creation changed no pointer. Current activation is recorded in frontmatter.
