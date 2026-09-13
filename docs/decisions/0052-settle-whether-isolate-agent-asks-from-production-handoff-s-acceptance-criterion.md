---
arcadia: v1
type: decision
id: "0052"
slug: settle-whether-isolate-agent-asks-from-production-handoff-s-acceptance-criterion
project: arcadia
status: open
question: Settle whether isolate-agent-asks-from-production-handoff's acceptance criterion 1 is satisfied by the already-merged reactive-recovery-only design, or whether proactive per-draft branch/worktree isolation is still required before this Action can be marked complete.
gap_type: missing-decision
recommendation: Reactive recovery satisfies criterion 1 as shipped
options:
  - label: Reactive recovery satisfies criterion 1 as shipped
    consequence: No further code changes to draft's authoring path; this Action's remaining open item becomes verifying criteria 2's 'status'/'cleanup' wording against existing idempotent-replay and archive-on-settle behavior, then filing an `agent-ask complete` for the whole Action.
    recommended: true
  - label: Criterion 1 requires proactive per-draft isolation
    consequence: A new Action (or an amendment to this one) is needed to make `arcadia agent-ask draft` always create its own isolated branch/worktree per request id, update AGENTS.md's documented draft ceremony accordingly, and add draft-level (not just recovery-level) concurrency fixtures. Materially larger scope; this Action stays open rather than nearing completion.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-13
---

# Decision 0052: Settle whether isolate-agent-asks-from-production-handoff's acceptance criterion 1 is satisfied by the already-merged reactive-recovery-only design, or whether proactive per-draft branch/worktree isolation is still required before this Action can be marked complete.

## Options

- **Reactive recovery satisfies criterion 1 as shipped** (recommended): No further code changes to draft's authoring path; this Action's remaining open item becomes verifying criteria 2's 'status'/'cleanup' wording against existing idempotent-replay and archive-on-settle behavior, then filing an `agent-ask complete` for the whole Action.
- **Criterion 1 requires proactive per-draft isolation**: A new Action (or an amendment to this one) is needed to make `arcadia agent-ask draft` always create its own isolated branch/worktree per request id, update AGENTS.md's documented draft ceremony accordingly, and add draft-level (not just recovery-level) concurrency fixtures. Materially larger scope; this Action stays open rather than nearing completion.

## Rationale

PR #236 (this session) and PR #234 (a prior session) together implement: (a) recovering an Agent Ask that drifted into the shared base checkout onto its own isolated branch before Arcadia Go proceeds, fully tested including fault-injection and same-repository concurrency; and (b) resolving a recovered Ask by request id straight from that branch in `arcadia agent-ask preview`. That satisfies criteria 3-7 and 9 of this Action cleanly. Criterion 1, read literally ("Every newly authored or edited Agent Ask is stored as ... an isolated Ask branch and worktree rather than the repository's shared base checkout"), reads as an unconditional requirement on every draft. What's shipped only isolates a draft that actually drifted into the shared base checkout; a draft authored correctly inside an agent's own per-Action worktree is left exactly where it was written; deliberately, per the QA doc's own 'Boundaries and follow-up' section, on the reasoning that such a worktree is already exclusive to one agent and branch. Three prior sessions attempted this Action and none settled this question outright; two of their branches (claude/isolate-agent-asks-from-production-handoff-20260913T065311886Z and -T071147378Z) sit unpushed with early, now-superseded drafts of the same recovery logic. Making draft itself always spin up a fresh isolated worktree/branch per Ask (rather than only recovering drift) is a materially larger, riskier change that would also revise the documented `arcadia agent-ask draft` ceremony in AGENTS.md ('run it from your own repository'), so I judged this a call for the operator rather than something to decide unilaterally by re-reading nine lines of acceptance-criteria prose.

Proposed by Agent Ask confirm-isolate-agent-asks-scope-2026-09-13. This Decision remains open until the operator answers it.
