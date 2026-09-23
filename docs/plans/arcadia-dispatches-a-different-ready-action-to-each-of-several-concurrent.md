---
arcadia: v1
type: plan
slug: arcadia-dispatches-a-different-ready-action-to-each-of-several-concurrent
project: arcadia
status: complete
milestone: "Arcadia dispatches a different ready Action to each of several concurrent coding-agent sessions automatically, and never dispatches the same Action to two sessions at once. Evidenced by a live collision on 2026-09-22 (PR #487/#496): two worktrees were independently dispatched to the identical Action, roughly two minutes apart, before either session noticed."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-09-23
actions:
  - id: add-action-scoped-worktree-claim
    title: agent_worktree_reservations gains a second, independent uniqueness constraint keyed on active (repository_path, project, action_id) alongside its existing worktree-path uniqueness -- neither replacing the other -- with an expiry-aware conflict query (not only cleanup-on-insert), a claim generation fenced against settlement writes, and explicit release only on a successfully applied terminal settlement or on preparation failure, with the 24-hour TTL as fallback cleanup only.
    status: done
    responsibility: agent
    effort: session
    next_action: agent_worktree_reservations gains a second, independent uniqueness constraint keyed on active (repository_path, project, action_id) alongside its existing worktree-path uniqueness -- neither replacing the other -- with an expiry-aware conflict query (not only cleanup-on-insert), a claim generation fenced against settlement writes, and explicit release only on a successfully applied terminal settlement or on preparation failure, with the 24-hour TTL as fallback cleanup only.
    expected_artifact: Evidence satisfying Agent Ask add-action-scoped-worktree-claim
    clarification: clarified
    confidence: high
    source: Agent Ask plan-parallel-session-task-assignment-2026-09-22
    acceptance_criteria:
      - A new active-claim lookup keyed on (repository_path, project, action_id) coexists with the existing (repository_path, worktree_path) uniqueness on agent_worktree_reservations; neither constraint can be satisfied by breaking the other.
      - The Action-id conflict lookup filters expires_at > now in the query itself, matching getActiveWorktreeReservation's existing discipline, not only via delete-on-insert cleanup.
      - Each claim carries a generation (monotonic counter or fresh id per claim, matching how reserveAgentWorktree already replaces rather than reuses a row).
      - A settlement whose generation does not match the claim's current generation fails loudly and writes nothing; the generation check and the settlement's writes are the same atomic operation (inside transitionActionPointer's existing db.transaction, per the follow-up bound in dispatch-different-ready-action-per-session), never a check followed by a separate write.
      - "A claim is released only by a settlement that completes with apply: true, or by worktree/Session preparation that fails outright before returning its error; both release paths condition their delete atomically on (repository_path, project, action_id, generation) matching, and are no-ops on an already-released claim or a claim whose generation has since moved on."
      - The 24-hour TTL remains as fallback cleanup only, for an owning process that genuinely died mid-work -- never primary cleanup for a normal completion or a normal preparation failure.
      - Claiming an already-actively-claimed Action is a hard refusal (extending evaluateExistingCandidate's existing shape), never an advisory flag a caller can act past.
      - "Deterministic tests cover: two claims for the same Action racing (one wins, one refuses); claim release on successful settlement; claim removal on failed preparation; a stale-generation settlement refusing to write; an already-released or superseded-generation release being a no-op; and the worktree-path and Action-id uniqueness constraints being independently enforceable."
      - pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: []
    decisions: []
    references: []
  - id: dispatch-different-ready-action-per-session
    title: arcadia go, preparing a new worktree, falls back to atomically claiming the next unclaimed, dependency-ready entry in the existing ordered queue when current_action is already actively claimed by a different, still-live worktree -- instead of refusing outright. arcadia advance run inside an already-prepared worktree continues to resolve only that worktree's own claim, never reassigning it. current_action stays a single value; it does not become a list.
    status: done
    responsibility: agent
    effort: session
    next_action: arcadia go, preparing a new worktree, falls back to atomically claiming the next unclaimed, dependency-ready entry in the existing ordered queue when current_action is already actively claimed by a different, still-live worktree -- instead of refusing outright. arcadia advance run inside an already-prepared worktree continues to resolve only that worktree's own claim, never reassigning it. current_action stays a single value; it does not become a list.
    expected_artifact: Evidence satisfying Agent Ask dispatch-different-ready-action-per-session
    clarification: clarified
    confidence: high
    source: Agent Ask plan-parallel-session-task-assignment-2026-09-22
    acceptance_criteria:
      - arcadia go's queue-walk-and-claim runs inside the same writeTransaction that already serializes evaluateExistingCandidate and worktree reservation (src/commands/go.ts), attempting an atomic conditional claim per candidate in the order buildAgentQueue already computes.
      - Losing a claim race on one candidate continues the walk to the next dependency-ready, still-unclaimed entry rather than stopping or retrying the lost one.
      - arcadia advance run inside a worktree that already holds a claim resolves that claim's Action directly and never consults the queue-walk fallback.
      - current_action in PROJECT.md and the Plan document remains a single value; no reader of it (dashboard, docket, arcadia next's narrative brief) is required to change.
      - arcadia agent-ask settle (project_update and complete) loads the settling worktree's own claim, verifies its action_id matches the Action settlement is about to resolve, and carries that claim's generation through the settlement's writes and release, per add-action-scoped-worktree-claim's generation fencing.
      - "Deterministic tests cover: two concurrent arcadia go invocations against the same current_action each landing on a different ready Action; a queue-walk correctly skipping a dependency-blocked or already-claimed entry; arcadia advance never reassigning an in-progress worktree; and a settlement refusing when its worktree's claim does not match the Action it is settling."
      - pnpm test and the core, Discord and Dashboard builds pass.
    depends_on: [add-action-scoped-worktree-claim]
    decisions: []
    references: []
questions: []
decisions: []
---

# Arcadia dispatches a different ready Action to each of several concurrent coding-agent sessions automatically, and never dispatches the same Action to two sessions at once. Evidenced by a live collision on 2026-09-22 (PR #487/#496): two worktrees were independently dispatched to the identical Action, roughly two minutes apart, before either session noticed.

Created as an inactive draft from accepted Agent Ask plan-parallel-session-task-assignment-2026-09-22; creation changed no pointer. Current activation is recorded in frontmatter.
