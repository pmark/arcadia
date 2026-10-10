---
arcadia: v1
type: plan
slug: guard-the-operator-s-machine-against-data-loss-from-arcadia-s-own-scripts-and
project: arcadia
status: draft
milestone: "Guard the operator's machine against data loss from Arcadia's own scripts and tests: shell scripts cannot delete through an empty path variable, the test suite cannot reach the live workspace, and unsaved or local-only working copies are surfaced as alerts."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-10
actions:
  - id: lint-shell-scripts-for-safe-deletes
    title: Every checked-in bash script fails fast and cannot remove a path built from an empty variable.
    status: open
    responsibility: agent
    effort: session
    next_action: Every checked-in bash script fails fast and cannot remove a path built from an empty variable.
    expected_artifact: Evidence satisfying Agent Ask lint-shell-scripts-for-safe-deletes
    clarification: clarified
    confidence: high
    source: Agent Ask operator-machine-data-safety-guards-2026-10-09
    acceptance_criteria:
      - "A check that runs in `pnpm lint` (or the unit suite) fails when a tracked bash script under scripts/ or runs/ lacks `set -e` (as `set -euo pipefail` or equivalent) or runs `rm -r`/`rm -rf` on an unguarded variable expansion; a guarded form such as `${VAR:?}` passes."
      - Every existing violation is fixed or carries a one-line justified allowlist entry, and the check passes on the base branch.
      - A test proves the check rejects `rm -rf "$DIR"` without a guard and a script without errexit.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/pull/1181", "https://github.com/pmark/arcadia/issues/1154", "docs/working-copy-safety.md", "scripts/services.sh", "scripts/release.sh"]
  - id: keep-tests-off-the-live-workspace
    title: The test suite cannot resolve or write the operator's live workspace or user config.
    status: open
    responsibility: agent
    effort: session
    next_action: The test suite cannot resolve or write the operator's live workspace or user config.
    expected_artifact: Evidence satisfying Agent Ask keep-tests-off-the-live-workspace
    clarification: clarified
    confidence: high
    source: Agent Ask operator-machine-data-safety-guards-2026-10-09
    acceptance_criteria:
      - The vitest configuration points Arcadia's user config at a path inside the test temp directory and sets ARCADIA_REQUIRE_INLINE_WORKSPACE=1 for every test process, so a command that omits an inline workspace fails with INLINE_WORKSPACE_REQUIRED instead of resolving martianrover.
      - A test proves a default-workspace resolution inside the suite refuses, and that no test process inherits the operator's ARCADIA_WORKSPACE.
      - The full unit suite passes on CI with the guard on; any test that legitimately needs a workspace names a temporary one inline.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/pull/1181", "https://github.com/pmark/arcadia/issues/1154", "docs/working-copy-safety.md", "vitest.config.ts", "docs/agent-guidance/arcadia-repository.md"]
  - id: alert-on-unsaved-and-local-only-work
    title: Unsaved and local-only working copies reach the operator as an alert instead of sitting silently on one disk.
    status: open
    responsibility: agent
    effort: session
    next_action: Unsaved and local-only working copies reach the operator as an alert instead of sitting silently on one disk.
    expected_artifact: Evidence satisfying Agent Ask alert-on-unsaved-and-local-only-work
    clarification: clarified
    confidence: high
    source: Agent Ask operator-machine-data-safety-guards-2026-10-09
    acceptance_criteria:
      - "`arcadia work monitor` (or its existing summary consumer) raises one operator alert, not a blocking gate, listing working copies that are UNSAVED or LOCAL ONLY for longer than a threshold the operator can change, each with its preservation remedy."
      - The alert reaches the default notification channel at most once per day per working copy, and clears when the copy is pushed or retired.
      - A test covers threshold, de-duplication and clearing.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/pull/1181", "https://github.com/pmark/arcadia/issues/1154", "docs/working-copy-safety.md"]
  - id: reconcile-vulnerable-working-copies
    title: One read-only command classifies every UNSAVED or LOCAL ONLY working copy by outcome, so the operator sees what is safe, what already shipped and what is the only copy.
    status: open
    responsibility: agent
    effort: session
    next_action: One read-only command classifies every UNSAVED or LOCAL ONLY working copy by outcome, so the operator sees what is safe, what already shipped and what is the only copy.
    expected_artifact: Evidence satisfying Agent Ask reconcile-vulnerable-working-copies
    clarification: clarified
    confidence: high
    source: Agent Ask add-reconcile-and-recover-work-to-data-safety-plan-2026-10-09
    acceptance_criteria:
      - "A read-only command (for example `arcadia work reconcile`) lists every working copy the monitor reports as unsaved or local only and assigns each exactly one outcome: landed-equivalent (with the settlement or merge evidence that shows its effect shipped), superseded (a newer candidate for the same Action exists), unique work (changes found nowhere else), or unknown, with the evidence for each."
      - It changes no file, ref, worktree, branch or workspace record, and a test proves the repositories are byte-identical before and after.
      - Each line names the one next step for that outcome (retire with tidy, recover, or inspect), and the alert from alert-on-unsaved-and-local-only-work links to it.
    depends_on: [alert-on-unsaved-and-local-only-work]
    decisions: []
    references: ["docs/working-copy-safety.md", "docs/proposals/reconcile-problematic-branches-and-worktrees-by-outcome.md"]
  - id: recover-unique-work-to-draft-prs
    title: Unique work in a vulnerable working copy is preserved off the machine by an automated version of the recovery playbook, never by cleaning or resetting.
    status: open
    responsibility: agent
    effort: session
    next_action: Unique work in a vulnerable working copy is preserved off the machine by an automated version of the recovery playbook, never by cleaning or resetting.
    expected_artifact: Evidence satisfying Agent Ask recover-unique-work-to-draft-prs
    clarification: clarified
    confidence: high
    source: Agent Ask add-reconcile-and-recover-work-to-data-safety-plan-2026-10-09
    acceptance_criteria:
      - "A preview-then-apply command takes one working copy classified as unique work and, without changing its files: creates a clearly named recovery branch when detached or on the default branch, refuses if a secret scan or the repository's generated-file policy flags any changed path, commits the scope with a message that says whether it is mixed, pushes it, and opens a draft recovery PR."
      - It never runs clean, reset, checkout of other content, stash, or worktree removal, and a test proves the working tree is byte-identical after apply.
      - It refuses a working copy that a live Session is writing to, names that Session, and writes a receipt for every apply or refusal.
      - Replaying recovered commits onto main stays a separate, normal PR step in a fresh worktree, as the playbook requires.
    depends_on: [reconcile-vulnerable-working-copies]
    decisions: []
    references: ["docs/working-copy-safety.md", "docs/proposals/reconcile-problematic-branches-and-worktrees-by-outcome.md"]
questions: []
decisions: []
---

# Guard the operator's machine against data loss from Arcadia's own scripts and tests: shell scripts cannot delete through an empty path variable, the test suite cannot reach the live workspace, and unsaved or local-only working copies are surfaced as alerts.

Created as an inactive draft from accepted Agent Ask operator-machine-data-safety-guards-2026-10-09; creation changed no pointer. Current activation is recorded in frontmatter.
