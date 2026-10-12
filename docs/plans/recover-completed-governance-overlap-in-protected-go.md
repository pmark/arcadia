---
arcadia: v1
type: plan
slug: recover-completed-governance-overlap-in-protected-go
project: arcadia
status: draft
milestone: Recover completed governance overlap in protected Go
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-12
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
    source: Agent Ask plan-completed-governance-overlap-recovery-2026-10-11
    why: "Protected Go cannot dispatch the next PPN Action until it can safely account for this completed governance overlap."
    acceptance_criteria:
      - The recovery pins local/remote/merge-base revisions, every affected governance commit/path and immutable settlement/authority evidence; preserves both histories and unique local evidence, and refuses missing, conflicting or stale proof. Remote completion and all subsequent correction records are audited rather than trusted from timestamps or done flags.
      - The host alone constructs and publishes a reviewed result through existing reconciliation checks. No generic ours/theirs rule, reset, direct base push or hand-written managed status is introduced. Ordinary conflicts and unresolved material authority judgments keep the current refusal; unsupported decisions require explicit operator authority.
      - Before moving the base, the exact resolved tree preserves valid amendments and accepted completion/correction boundaries, passes governed dispatch readiness, and rechecks pinned refs, cleanliness, ownership and current execution authority. Interrupted publication and identical replay are recoverable without duplicate claims or commits.
      - Deterministic fixtures cover the positive amended-and-completed overlap, unique local evidence, incorrect/counterfeit settlement proof, missing corrections, unresolved authority, non-governance paths, drift, dirty/occupied checkouts, replay and interrupted publication. Existing Go/enrollment/preservation checks and fast-rehearsal pass, with internal review, independent exact-head review, required CI and a truthful operator/end-user QA plan.
      - After reviewed capability installation and authorized execution, PPN fixed protected Go returns one clean exclusive candidate and canonical brief from the intended next Action, or retains one exact actionable refusal. No code completion, successful host dispatch, private copy acceptance or publication is inferred from a refused receipt.
    depends_on: []
    decisions: []
    references: ["src/commands/go.ts", "src/sessions/hostEnrollment.ts", "src/sessions/enrollment.ts", "tests/go.test.ts", "docs/working-copy-safety.md", "docs/agent-guidance/operator-actions.md", "docs/plans/bootstrap-managed-production-to-build-flight-deck.md", "/Users/pmark/Dev/PrivatePracticeNow/platform/.arcadia/asks/agent-ask-repair-nagel-go-base-overlap-2026-10-11.yaml"]
questions: []
decisions: []
recommended_model: heavy
recommended_reasoning_effort: high
---

# Recover completed governance overlap in protected Go

Created as an inactive draft from accepted Agent Ask plan-completed-governance-overlap-recovery-2026-10-11; creation changed no pointer. Current activation is recorded in frontmatter.
