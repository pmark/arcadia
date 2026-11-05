---
arcadia: v1
type: plan
slug: arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider
project: arcadia
status: active
milestone: "Arcadia runs production unattended on its own repository on the Claude provider: the worker launches a Session, preserves a reviewed PR, merges it through the PR when it is not authority-adjacent, and continues to the next Action within a spend bound, with operator touches limited to authority-adjacent merges."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-11-05
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
    source: Agent Ask seed-third-serial-action-20261105-r3
    why: "This run is the milestone's proof that Arcadia maintains momentum on its own repository without supervision."
    acceptance_criteria:
      - A production preview for at least three ready Actions on claude-code is published and its activation presented as one card; agents do not activate.
      - The run's ledger rows show every Action reaching a merged PR, with each operator touch listed and none other than activation and authority-adjacent merges.
      - docs/managed-production-readiness.md is re-derived from the run, stating the new verdict and every failure observed.
    depends_on: [worker-review-and-merge, production-spend-budget, credential-preflight, test-transient-review-retry-after-exhaustion, refresh-decision-0130-status-and-1559-fake, guard-repair-gate-upsert-role, bound-guidance-test-teardown-retries, assert-tmux-temp-launcher-removed, cover-retired-descriptor-byte-change, pin-worker-merge-allowlist-carve-outs, pin-blast-radius-safety-patterns, pin-work-monitor-malformed-record, pin-recovery-unparseable-time-order, pin-reconcile-refuses-activation-commit, pin-qa-plan-status-must-be-fail]
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
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-cover-mail-ack-receipt-kind-collision-2026-10-31-b; no further action.
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
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-isolate-launch-preview-tmux-name-dbd2bc77c0f9; no further action.
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
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-bound-guidance-test-teardown-retries-ab83c27800b7; no further action.
    expected_artifact: Evidence satisfying Agent Ask bound-guidance-test-teardown-retries
    clarification: clarified
    confidence: high
    source: Agent Ask route-test-only-actions-to-build-20261101
    why: "PR1783 was rejected because its test passed without exercising the real cleanup; the tightened criteria make that shape fail."
    acceptance_criteria:
      - "tests/agent-guidance.test.ts defines removeScratchRoots(roots: string[], remove = rmSync), which calls remove(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) (or larger maxRetries and retryDelay values) for each root and then empties the array; the afterEach body is exactly one call to removeScratchRoots(roots) and contains no rmSync literal."
      - A new test calls removeScratchRoots with a vi.fn() as remove and two paths and asserts each call's options object has recursive true, force true, maxRetries of at least 3 and retryDelay of at least 50; it also asserts the default is the real rmSync by removing a real mkdtemp directory with no remove argument.
      - Every existing assertion in that file remains unchanged and no test in it is marked skip or todo.
      - The change touches only tests/agent-guidance.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1419"]
  - id: rebuild-cover-mail-ack-receipt-kind-collision
    title: Implement a fresh native-mail acknowledgment receipt-kind collision test from the then-current reviewed base, preserving held PR1662 and obtaining fresh canonical evidence for the replacement.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-mail-ack-source-concurrent-20261027-01a17e94; no further action.
    expected_artifact: Evidence satisfying Agent Ask rebuild-cover-mail-ack-receipt-kind-collision
    clarification: clarified
    confidence: high
    source: Agent Ask prepare-native-mail-replacement-action-20261022-v2
    why: "A fresh substantive rebuild can use existing governed dispatch without resetting or borrowing evidence from held PR1662."
    acceptance_criteria:
      - "tests/native-mail.test.ts gains a test that acknowledges a message without disposing it, then calls reportMailResult and disposeMailMessage with the request id message.id plus ':acknowledgment', and asserts both throw an error whose message contains the substring 'already recorded as a different operation (acknowledgment)'."
      - The same test asserts the message status is still acknowledged afterwards, and every other test in the file passes unchanged.
      - The change touches only tests/native-mail.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/pull/1662", "https://github.com/pmark/arcadia/issues/1470"]
  - id: preserve-codex-config-on-semantic-no-op
    title: "Preserve existing Codex config bytes when the protected installer finds the requested managed configuration already semantically correct; implementer, standard tier, size S, operator gate: reviewed source merge only, no live setup operation."
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-installer-semantic-no-op-final-28e-20261027; no further action.
    expected_artifact: Evidence satisfying Agent Ask preserve-codex-config-on-semantic-no-op
    clarification: clarified
    confidence: high
    source: Agent Ask add-installer-semantic-no-op-action-20261027
    why: "Prevent the observed needless config rewrite from consuming a future adoption attempt."
    acceptance_criteria:
      - A disposable-file regression supplies semantically correct managed permission/trust settings with different table ordering, comments and whitespace; configuration preserves the exact original bytes and creates no backup. A repeated invocation remains byte-identical and reports no change.
      - Disposable-file regressions supply missing and genuinely different managed values; configuration applies the exact required managed change and verifies the requested profile/trust semantics, without weakening permission boundaries or treating an incorrect value as a no-op.
      - Disposable-file regressions prove unrelated user tables, values and comments survive both no-op and necessary-change paths; relevant focused tests plus required lint/typecheck/checks pass. Tests never access or change live user configuration, credentials, services or production.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1800", "src/agentSetup/goBrokerAgentSetup.ts", "docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md"]
  - id: assert-tmux-temp-launcher-removed
    title: "Make the no-launcherDirectory tmux long-command test prove its temporary launcher directory is removed, closing Issue #1536."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-assert-tmux-temp-launcher-removed-86741794d510; no further action.
    expected_artifact: Evidence satisfying Agent Ask assert-tmux-temp-launcher-removed
    clarification: clarified
    confidence: high
    source: Agent Ask route-test-only-actions-to-build-20261101
    why: "The test is named for temporary-directory removal but never checks it, so a cleanup regression would pass."
    acceptance_criteria:
      - In tests/system-tmux-long-command.test.ts, the test named 'delivers the brief byte-identical with no launcherDirectory (temporary directory removed)' points TMPDIR at a directory the test owns for the launch, and after the provider has written its argv asserts that no entry starting with arcadia-launch- remains in that directory.
      - TMPDIR is set before systemTmux.launch is called and restored in a finally block (deleted if it was originally unset); the PR body reports that temporarily removing the launcher's rm -rf cleanup in writeSessionLauncher makes this test fail, and that it passes again once reverted, while the final diff touches only the test file.
      - The same test still asserts argv equals ['--print', LONG_BRIEF], and every other test in the file passes unchanged.
      - The change touches only tests/system-tmux-long-command.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1536"]
  - id: cover-retired-descriptor-byte-change
    title: "Cover a pinned retired operator-script entry whose descriptor bytes changed while its script bytes did not, closing the first item of Issue #1262."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-cover-retired-reland-20261103; no further action.
    expected_artifact: Evidence satisfying Agent Ask cover-retired-descriptor-byte-change
    clarification: clarified
    confidence: high
    source: Agent Ask amend-run-criteria-provable-20261102
    why: "The retirement rule requires both hashes to match, but only the changed-script case is covered."
    acceptance_criteria:
      - apps/dashboard/app/api/operator-script/retired-entries.test.ts gains a test in which the retirement pins the sha256 of the original descriptor and the original script, only the written descriptor bytes differ (for example a trailing newline) while the script bytes equal the pinned bytes, the changed descriptor stays invalid, and GET returns no scripts with console.error called exactly once.
      - Every other test in that file passes unchanged.
      - The change touches only apps/dashboard/app/api/operator-script/retired-entries.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1262"]
  - id: pin-worker-merge-allowlist-carve-outs
    title: Pin the worker-merge allowlist's carve-outs with a table-driven test so that widening the allowlist fails a test.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-worker-merge-allowlist-carve-outs-d173bcd61b63; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-worker-merge-allowlist-carve-outs
    clarification: clarified
    confidence: high
    source: Agent Ask amend-pin-worker-merge-allowlist-criteria-20261102
    why: "isWorkerMergeSafePath decides what the worker may merge without the operator, but only its agent-guidance targets are tested; dropping a carve-out for fixtures, helpers or governed documents would pass unnoticed."
    acceptance_criteria:
      - "tests/worker-merge.test.ts gains, in the describe block titled 'the worker-merge allowlist and the agent-guidance index', a table-driven test asserting isWorkerMergeSafePath returns false for each of: tests/helpers/x.ts, tests/fast-rehearsal/helpers/x.ts, tests/setup.ts, tests/e2e/global-setup.ts, tests/e2e/fixtures/x.json, tests/fixtures/x.txt, docs/decisions/0001-x.md, docs/agent-guidance/x.md, docs/plans/x.md, docs/scout/x.md, docs/agents-context.md, docs/managed-production-readiness.md, AGENTS.md, src/cli.ts, docs/guide.txt and tests/.hidden/x.test.ts."
      - The same test asserts isWorkerMergeSafePath returns true for tests/worker-merge.test.ts, docs/guide.md and notes.md.
      - Every other test in that file passes unchanged, and no test in it is marked skip or todo.
      - The change touches only tests/worker-merge.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1987"]
  - id: pin-blast-radius-safety-patterns
    title: Pin the blast-radius safety patterns with a table-driven test so that dropping a controller-safety path fails a test.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-blast-radius-safety-patterns-ffed77df7f39; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-blast-radius-safety-patterns
    clarification: clarified
    confidence: high
    source: Agent Ask amend-run-criteria-provable-20261102
    why: "BLAST_RADIUS_SAFETY_PATTERNS decides which candidates count as never-narrow, but tests exercise only src/production; losing another path would pass unnoticed."
    acceptance_criteria:
      - "tests/pr-blast-radius.test.ts gains, inside the existing describe block titled 'computeBlastRadius', a table-driven test importing BLAST_RADIUS_SAFETY_PATTERNS from src/stewardship/prBlastRadius.ts and asserting at least one pattern matches each of: src/production/x.ts, src/ask/x.ts, src/sessions/x.ts, src/dispatch/x.ts, src/db/x.ts, src/git/x.ts, .github/x.yml, package.json, pnpm-lock.yaml and pnpm-workspace.yaml."
      - "The same test asserts no pattern matches any of: src/commands/x.ts, tests/x.ts, docs/x.md, apps/dashboard/package.json and src/production."
      - Every other test in that file passes unchanged, and no test in it is marked skip or todo.
      - The change touches only tests/pr-blast-radius.test.ts; the focused vitest run of that file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1989"]
  - id: recovery-signal-replay-gate
    title: Add a pure no-model recovery-signal classifier and a checked-in replay of real ledger rows that gates the watchdog work.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-recovery-signal-replay-gate-20261102-r2; no further action.
    expected_artifact: Evidence satisfying Agent Ask recovery-signal-replay-gate
    clarification: clarified
    confidence: high
    source: Agent Ask add-worker-recovery-build-actions-20261102
    why: "Decision 0169 needs proof that the checks fire on runs h and i and stay silent on healthy work, and this lands green first so nothing else is blocked."
    acceptance_criteria:
      - src/production/recoverySignals.ts exports a pure function that takes ledger rows (Session exits with launch and candidate revisions, review repair rows with their failed checks, and operator-held marks) and returns ordered signals, using no database, Git, clock or network access.
      - "tests/recovery-replay.test.ts loads tests/fixtures/recovery-replay/ledger-rows.json, copied from real rows of 2026-11-02, and asserts a no-progress signal at the 04:44:50Z receipt for pin-worker-merge-allowlist-carve-outs and a QA plan signal at 07:11:19Z for pin-blast-radius-safety-patterns, classed as mixed there and as sole failure at 07:26."
      - The same test asserts no signal for bound-guidance-test-teardown-retries (one failed review, one repair, merged) and no signal for the gated wait on cover-retired-descriptor-byte-change.
      - "The same test proves sensitivity with altered rows: a changed candidate revision yields no no-progress signal, an operator-held mark yields no signal, and an added failed check turns a sole failure into mixed."
      - The change touches only those three paths; the focused vitest run of that test file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["docs/decisions/0169-choose-how-the-next-unattended-production-run-recovers-and-gets-noticed.md"]
  - id: session-proposal-stays-out-of-candidate
    title: A Session's non-completion Ask draft lands outside its candidate from the start, and the host still receives it as a recorded proposal.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-session-proposal-stays-out-of-candidate-20261102; no further action.
    expected_artifact: Evidence satisfying Agent Ask session-proposal-stays-out-of-candidate
    clarification: clarified
    confidence: high
    source: Agent Ask add-worker-recovery-build-actions-20261102
    why: "In run h a blocked Session's proposal made the candidate authority-adjacent and changed its revision, which reset the repair budget and bought extra futile Sessions."
    acceptance_criteria:
      - tests/session-proposal-outside-candidate.test.ts drives src/commands/agentAsk.ts with a proposal-intent draft in a disposable Git worktree and asserts the file is outside the set preservation would commit, the worktree counts as clean, and a preserved candidate's revision and changed-file list do not change.
      - The same test asserts the host, at Session exit, records the proposal's text with its Session and Action, so it remains readable after the worktree is retired, and that nothing is settled or approved by that record.
      - The same test asserts that a Session exit whose only output is that proposal leaves the candidate revision unchanged, so the unchanged-resume accounting counts the attempt and does not reset the repair budget.
      - The same test asserts complete and split drafts keep their existing canonical location and settlement behavior.
      - tests/agent-ask-draft.test.ts and tests/stray-ask-files.test.ts pass; pnpm lint and tsc pass.
      - The change touches no file under src/production/.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1988", "docs/decisions/0169-choose-how-the-next-unattended-production-run-recovers-and-gets-noticed.md"]
  - id: worker-reconciles-own-pointer-commits
    title: Before reporting base_not_synced, the worker reconciles local main when its only local-only commits are its own pointer commits; anything else still refuses.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-worker-reconciles-own-pointer-commits-20261102; no further action.
    expected_artifact: Evidence satisfying Agent Ask worker-reconciles-own-pointer-commits
    clarification: clarified
    confidence: high
    source: Agent Ask amend-worker-reconciles-keep-local-pointer-20261102
    why: "Pointer commits are written locally and never pushed, so a worker merge in run i stopped falsely on base_not_synced after GitHub had already merged the PR."
    acceptance_criteria:
      - "tests/worker-pointer-reconcile.test.ts uses disposable local Git repositories to show that when local main is ahead of its remote only by pointer commits (subject matching chore(arcadia): point at and a diff limited to PROJECT.md and the active Plan document) and the remote has advanced, sync integrates the remote without rewriting or discarding those commits, and the merged head is contained in local main."
      - "The same test shows sync still refuses, leaving the checkout untouched, for: a local-only commit of any other shape, a dirty checkout, a checkout on another branch, and any conflict other than the pointer-only conflict below."
      - "The same test shows that a conflict confined to PROJECT.md and the active Plan document, where the local-only commits changed only current_action lines in those files, resolves per file: when the remote moved the pointer, to the remote value; when it did not, to the local value with the remote other lines. Sync refuses instead if the merged pointer pair disagrees, names no Action of the active Plan, or names a done Action."
      - The same test shows that both the worker-merge sync and the per-tick base sync use this behavior, and that nothing is pushed.
      - tests/worker-merge.test.ts passes, including its existing base_not_synced refusal; pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: ["docs/decisions/0169-choose-how-the-next-unattended-production-run-recovers-and-gets-noticed.md"]
  - id: headless-session-resolves-arcadia-cli
    title: A headless Session launched by the worker can resolve the arcadia command its allow list permits, from a host-resolved location.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-headless-session-resolves-arcadia-cli-20261102; no further action.
    expected_artifact: Evidence satisfying Agent Ask headless-session-resolves-arcadia-cli
    clarification: clarified
    confidence: high
    source: Agent Ask add-worker-recovery-build-actions-20261102
    why: "Headless Sessions hit exit 127 on arcadia and only recovered by finding pnpm arcadia, which does not exist in other Projects, so the escalation route must work first time."
    acceptance_criteria:
      - tests/session-launcher-arcadia-path.test.ts renders a Session launcher with an injected host-resolved CLI directory and asserts that directory is on the launcher's PATH after the pinned Node directory, so the Node choice does not change.
      - The same test asserts that directory comes only from the host, never from a file in the Session's worktree, and that the launcher is unchanged when the host resolves no CLI.
      - The focused vitest run of that test file, pnpm lint and tsc pass.
    depends_on: []
    decisions: []
    references: []
  - id: qa-plan-sole-failure-spends-no-repair
    title: A QA verdict whose only failure is the host-written operator QA plan uses no repair rounds, stops blocking, and files an Issue; and the plan renderer inspects what the candidate changed rather than a path a criterion names as a sample.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-qa-plan-sole-failure-spends-no-repair-20261103; no further action.
    expected_artifact: Evidence satisfying Agent Ask qa-plan-sole-failure-spends-no-repair
    clarification: clarified
    confidence: high
    source: Agent Ask amend-qa-plan-renderer-non-code-path-20261102
    why: "All 3 repair rounds in run i went on a plan step no Session could change. Decision 0169 authorizes this rule, and every other failure still blocks."
    acceptance_criteria:
      - tests/qa-plan-sole-failure.test.ts asserts that a QA verdict failing only the operator-qa-plan check launches no repair Session, records no repair round, lets the independent verdict gate treat QA as not blocking on that head, and records that one operator check step went unverified.
      - The same test asserts a verdict still blocks and follows the existing repair path when any other check fails or is not-checked, when a finding concerns anything else, when the plan was refused as unavailable, and when the role is code review; it uses the mixed and sole-failure shapes from the recovery-signal classifier.
      - The same test asserts one Issue is requested per Action and head through an injected runner, a replay requests no second Issue, and a failure to file is logged without changing the verdict outcome.
      - tests/operator-qa-plan.test.ts asserts that when a criterion names an unchanged existing non-code path and the candidate changes a test file, the step inspects the changed test file and not the named path, that a criterion naming a changed file keeps inspecting that file, and that a criterion naming a source or test file is never redirected, with any substitution stated in the step.
      - src/sessions/operatorQaPlan.ts, src/production/reviewRepair.ts and src/production/independentReview.ts carry the change; the focused vitest runs of those two test files, pnpm lint and tsc pass.
    depends_on: [recovery-signal-replay-gate]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1999", "docs/decisions/0169-choose-how-the-next-unattended-production-run-recovers-and-gets-noticed.md"]
  - id: red-alerts-for-repair-stops-and-no-progress
    title: Red alerts fire and reach Discord when review repairs are exhausted, when a candidate is gated, and when a resumed Session leaves its candidate unchanged, through the existing alert path.
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask complete-red-alerts-for-repair-stops-and-no-progress-20261103; no further action.
    expected_artifact: Evidence satisfying Agent Ask red-alerts-for-repair-stops-and-no-progress
    clarification: clarified
    confidence: high
    source: Agent Ask amend-red-alerts-classifier-parity-20261103
    why: "Run i raised no alert after 06:00 because no trigger covers review repair stops, and the first notice came from Rowan polling."
    acceptance_criteria:
      - tests/review-repair-red-alerts.test.ts asserts that a review_repair_rounds_exhausted escalation and a review_repair_gated escalation each raise one open red alert of their own trigger in src/production/redAlerts.ts, raised by the tick from production_operator_escalations rows with no change to src/production/reviewRepair.ts, queue one notification through the existing alert notification path, and do not notify again on later ticks.
      - The same test asserts each alert clears when its escalation clears, and that a raising failure is logged without changing the tick's outcome.
      - tests/no-progress-red-alert.test.ts asserts that a resumed Session exiting incomplete with its candidate unchanged raises one notify-only red alert of a new no-progress trigger, reusing the existing unchanged-resume detection at the exit receipt with no second detector, and queues one notification.
      - The same test asserts no alert for a resumed Session that changed its candidate, a fresh first Session, and an Action in an operator-held state; and that repair attempts, the next launch decision and the Action's status are identical with and without the alert.
      - A parity test feeds the same exit rows to the recovery-signal classifier and to the tick detection, on the fixture rows of tests/recovery-replay.test.ts plus a dirty-worktree case, and asserts they agree on no-progress; tests/review-repair-red-alerts.test.ts asserts each repair trigger follows the repair row outcome on those fixture rows, and that a QA verdict the classifier reads as sole failure raises no stop alert unless its outcome is escalated.
      - tests/fast-rehearsal/review-repair-red-alerts.test.ts shows a repair loop running out of rounds raises the alert and repeated unchanged resumes raise the notice while the existing retry budget alone stops retries, and a healthy chain raises none; its focused vitest run passes.
      - tests/blocker-remedies.test.ts passes with a remedy registered in src/production/blockerRemedies.ts for each new trigger; the focused vitest runs, pnpm lint and tsc pass.
    depends_on: [recovery-signal-replay-gate, worker-reconciles-own-pointer-commits]
    decisions: []
    references: ["docs/decisions/0169-choose-how-the-next-unattended-production-run-recovers-and-gets-noticed.md"]
  - id: pin-work-monitor-malformed-record
    title: "Pin the work monitor's fallback for a malformed batched branch record with a test, covering the untested parse fallback in Issue #2015."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin the work monitor's fallback for a malformed batched branch record with a test, covering the untested parse fallback in Issue #2015."
    expected_artifact: Evidence satisfying Agent Ask pin-work-monitor-malformed-record
    clarification: clarified
    confidence: high
    source: Agent Ask amend-pin-work-monitor-criteria-20261105
    why: "Removing the field-count check currently passes every test, so a malformed record could reach the monitor's safety report unnoticed."
    acceptance_criteria:
      - tests/work-monitor-failures.test.ts gains a test in which the stdout of the batched branch listing is altered so one record keeps only its branch name and object id and loses every other field, the test asserts that the alteration was applied at least once, and the scan result equals the scan of the same repository without the alteration.
      - The alteration applies only to the batched branch listing and is cleared after each test, and every other test in that file passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only tests/work-monitor-failures.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2015"]
  - id: pin-recovery-unparseable-time-order
    title: "Pin how recovery signals order an unparseable time with tests, covering the epoch fallback named in Issue #2004."
    status: done
    responsibility: agent
    execution: build
    effort: session
    next_action: Completed via Agent Ask auto-settle-arcadia-pin-recovery-unparseable-time-order-b711b0e13aa2; no further action.
    expected_artifact: Evidence satisfying Agent Ask pin-recovery-unparseable-time-order
    clarification: clarified
    confidence: high
    source: Agent Ask seed-serial-run-test-only-actions-20261104-r2
    why: "Nothing tests the fallback in epoch(), so a garbled ledger time could reorder recovery signals unnoticed."
    acceptance_criteria:
      - tests/recovery-replay.test.ts gains a test in which classifyRecoverySignals receives two failing operator-qa-plan repair rows, the first with an unparseable at value and the second with a parseable one, and returns the signal of the parseable row first.
      - A second new test gives two such repair rows that both have unparseable at values and asserts that their signals keep input order.
      - Every other test in that file passes unchanged.
      - The change touches only tests/recovery-replay.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2004"]
  - id: pin-reconcile-refuses-activation-commit
    title: "Pin that the worker's base sync refuses a local plan-activation commit with a test, recording today's behaviour named in Issue #2018."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin that the worker's base sync refuses a local plan-activation commit with a test, recording today's behaviour named in Issue #2018."
    expected_artifact: Evidence satisfying Agent Ask pin-reconcile-refuses-activation-commit
    clarification: clarified
    confidence: high
    source: Agent Ask seed-serial-run-test-only-actions-20261104-r2
    why: "A run crossing a Plan boundary stops on this refusal, and pinning it means any change to the behaviour must be deliberate."
    acceptance_criteria:
      - "tests/worker-pointer-reconcile.test.ts gains a test in which the local base has an unpushed commit whose subject starts with chore(arcadia): activate and which changes PROJECT.md, the remote has advanced, and syncBaseWithOwnPointerCommits returns outcome refused with a reason saying the local-only commits are not pointer commits."
      - The same test asserts that the refusal leaves the local HEAD, the checked-out branch, the git status and the remote's main unchanged.
      - Every other test in that file passes unchanged.
      - The change touches only tests/worker-pointer-reconcile.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2018"]
  - id: pin-qa-plan-status-must-be-fail
    title: "Pin that a QA repair row whose operator-qa-plan check did not fail raises no recovery signal, with a test covering the status check named in Issue #2004."
    status: open
    responsibility: agent
    execution: build
    effort: session
    next_action: "Pin that a QA repair row whose operator-qa-plan check did not fail raises no recovery signal, with a test covering the status check named in Issue #2004."
    expected_artifact: Evidence satisfying Agent Ask pin-qa-plan-status-must-be-fail
    clarification: clarified
    confidence: high
    source: Agent Ask seed-third-serial-action-20261105-r3
    why: "Dropping the fail-status check in classifyRecoverySignals passes every test today, so a not-checked QA plan could raise a stop signal unnoticed."
    acceptance_criteria:
      - tests/recovery-replay.test.ts gains a test in which classifyRecoverySignals receives a qa review repair row whose only failed check is operator-qa-plan with status not-checked, and one with status inherited, and one with status not-applicable, and returns no signal for each.
      - The same test gives each of those three statuses on operator-qa-plan beside a second check, tests-and-evidence with status fail, and asserts no signal is returned for each.
      - Every other test in that file passes unchanged.
      - Apart from the settlement records Arcadia writes, the change touches only tests/recovery-replay.test.ts. Proof that this file, lint and tsc pass comes from the required CI jobs on the pull request's head, not from the Session, which cannot run them under headless validation.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/2004"]
questions: []
decisions: []
recommended_model: standard
recommended_reasoning_effort: medium
current_action: pin-work-monitor-malformed-record
---

# Arcadia runs production unattended on its own repository on the Claude provider: the worker launches a Session, preserves a reviewed PR, merges it through the PR when it is not authority-adjacent, and continues to the next Action within a spend bound, with operator touches limited to authority-adjacent merges.

Created as an inactive draft from accepted Agent Ask plan-autonomous-production-on-arcadia-2026-10-14-v2; creation changed no pointer. Current activation is recorded in frontmatter.
