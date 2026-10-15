---
arcadia: v1
type: plan
slug: recover-completed-governance-overlap-in-protected-go
project: arcadia
status: draft
milestone: Recover completed governance overlap in protected Go
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-13
actions:
  - id: reconcile-completed-governance-overlap
    title: Implement a host-owned, proof-bound recovery for local governance superseded by merged amendments and completion, retaining both histories and refusing unsupported judgment.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a host-owned, proof-bound recovery for local governance superseded by merged amendments and completion, retaining both histories and refusing unsupported judgment.
    expected_artifact: Evidence satisfying Agent Ask reconcile-completed-governance-overlap
    clarification: clarified
    confidence: high
    source: Agent Ask amend-go-overlap-broker-registry-prerequisite-2026-10-13
    why: "Protected Go cannot dispatch the next PPN Action until it can safely account for this completed governance overlap."
    acceptance_criteria:
      - The recovery pins local/remote/merge-base revisions, every affected governance commit/path and immutable settlement/authority evidence; preserves both histories and unique local evidence, and refuses missing, conflicting or stale proof. Remote completion and all subsequent correction records are audited rather than trusted from timestamps or done flags.
      - The host alone constructs and publishes a reviewed result through existing reconciliation checks. No generic ours/theirs rule, reset, direct base push or hand-written managed status is introduced. Ordinary conflicts and unresolved material authority judgments keep the current refusal; unsupported decisions require explicit operator authority.
      - Before moving the base, the exact resolved tree preserves valid amendments and accepted completion/correction boundaries, passes governed dispatch readiness, and rechecks pinned refs, cleanliness, ownership and current execution authority. Interrupted publication and identical replay are recoverable without duplicate claims or commits.
      - Deterministic fixtures cover the positive amended-and-completed overlap, unique local evidence, incorrect/counterfeit settlement proof, missing corrections, unresolved authority, non-governance paths, drift, dirty/occupied checkouts, replay and interrupted publication. Existing Go/enrollment/preservation checks and fast-rehearsal pass, with internal review, independent exact-head review, required CI and a truthful operator/end-user QA plan.
      - After reviewed capability installation and authorized execution, PPN fixed protected Go returns one clean exclusive candidate and canonical brief from the intended next Action, or retains one exact actionable refusal. No code completion, successful host dispatch, private copy acceptance or publication is inferred from a refused receipt.
    depends_on: [package-protected-broker-role-registry]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1376", "https://github.com/pmark/arcadia/issues/1280", "https://github.com/pmark/arcadia/pull/1283", "src/agentRoles/registry.ts", "src/commands/goBrokerInstall.ts", "src/sessions/hostEnrollment.ts", "docs/agent-guidance/operator-actions.md", "src/commands/go.ts", "src/sessions/enrollment.ts", "tests/go.test.ts", "docs/working-copy-safety.md", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "/Users/pmark/Dev/PrivatePracticeNow/platform/.arcadia/asks/agent-ask-repair-nagel-go-base-overlap-2026-10-11.yaml"]
  - id: package-protected-broker-role-registry
    title: Stage and validate the canonical agent role registry in the protected broker release so fixed launchers load entirely from their installed release.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-native-package-protected-broker-role-registry-20261013; no further action.
    expected_artifact: Evidence satisfying Agent Ask package-protected-broker-role-registry
    clarification: clarified
    confidence: high
    source: Agent Ask amend-go-overlap-broker-registry-prerequisite-2026-10-13
    why: "The installed launcher currently fails at module load, blocking honest host entry before a recovery candidate can be acquired."
    acceptance_criteria:
      - The staged broker release includes the canonical role-registry JSON at dist/config/defaults/agent-roles.json, bound to the compiled import and identical canonical bytes; release validation refuses a missing or malformed required registry before ready publication rather than inventing default authority.
      - A deterministic disposable-release regression loads the actual broker entrypoint or literal fixed launcher after source-tree access is removed or hidden, proves structured success with the correctly staged asset, and reproduces the missing-asset refusal. It performs no real installation, service restart, policy change or live workspace mutation.
      - "Focused release-staging/broker tests, internal review, independent exact-head review and all required CI checks pass. The PR preserves existing role/authority semantics and names separate installed verification, stale custody, packet-model and historical repair-budget gates; it claims no #1280 completion or successful PPN dispatch."
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1376", "https://github.com/pmark/arcadia/issues/1280", "https://github.com/pmark/arcadia/pull/1283", "src/agentRoles/registry.ts", "src/commands/goBrokerInstall.ts", "src/sessions/hostEnrollment.ts", "docs/agent-guidance/operator-actions.md"]
questions: []
decisions: []
recommended_model: heavy
recommended_reasoning_effort: high
---

# Recover completed governance overlap in protected Go

Created as an inactive draft from accepted Agent Ask plan-completed-governance-overlap-recovery-2026-10-11; creation changed no pointer. Current activation is recorded in frontmatter.
