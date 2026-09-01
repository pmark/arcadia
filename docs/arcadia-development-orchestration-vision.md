# Arcadia-Led Development

## Vision

Arcadia is the operator's development control plane. The operator should be
able to state intent, answer the few questions only they can answer, exercise
working Candidates, and authorize consequential transitions without manually
coordinating repositories, coding-agent sessions, validation commands, QA
reports, or status updates.

Arcadia turns that interaction into governed progress. It captures the intent,
associates it with the right Project and Outcome, maintains one legible current
execution order over approved Actions, names the first eligible Action and why
higher items are waiting, selects the least-cost configured coding agent that
satisfies the work, stages independent work safely, gathers deterministic proof,
invokes independent QA when the evidence is ready, and advances until human
authority or judgment is actually required.

When the operator is needed, Arcadia sends one concise, actionable notification
through Arcadia Now or the configured delivery surface. That notification says
what happened, why attention is needed, what evidence matters, and what each
available Decision will cause. The common case should be one safe button that
advances the state after its named conditions are satisfied.

## Goals

- Preserve momentum while minimizing the operator's cognitive load.
- Make all past, current, planned, deferred, and blocked development work
  visible across the portfolio and within each Project.
- Orchestrate configured coding agents through vendor-neutral capability,
  effort, locality, independence, and cost policy.
- Prefer deterministic collection, validation, and routing; spend model tokens
  only on interpretation, implementation, diagnosis, or judgment that needs a
  model.
- Bind every Candidate, proof Artifact, QA Decision, approval, and transition to
  exact evidence so stale work cannot silently advance.
- Keep publication, credentials, spending, production access, outbound
  messaging, merge, deployment, and release behind explicit authority.

## Target development loop

```text
Operator intent
  -> Capture and clarify
  -> Project / Outcome / Milestone / Action
  -> Accept and explicitly position Actions in the execution queue
  -> Select and dispatch configured coding agent
  -> Record one thin, reattachable Session
  -> Produce Candidate and deterministic proof
  -> Readiness gate (zero model tokens)
  -> Independent Arcadia QA (one bounded judgment)
  -> Operator question, feedback, or approval only when required
  -> Authorized transition
  -> Post-transition verification and durable Log
```

At every point Arcadia can answer: what is happening, what evidence exists,
what is waiting, the complete operator-owned work order, who or what can advance
each item, and why one Action is next.

## Immediate 80/20 boundary

Decision 0039 makes the agent-to-Arcadia management seam the current 80/20
boundary. First, a coding agent submits one conventional Ask that Arcadia can
normalize into exact proposed Project records without granting the agent
approval. Next, every accepted Action receives an explicit position and the
first dispatch-eligible item becomes Arcadia's explainable next work. Only then
does the Dashboard add direct reorder controls and the full ordered projection.
This sequence does not build a general workflow engine, autonomous priority
model, transcript viewer, or autonomous software factory.

## Triggered increments

| Deferred increment | Reactivate when |
| --- | --- |
| Unattended worker execution of coding-agent Sessions | One real tmux-backed Session completes successfully and the operator chooses unattended launch for a second governed Action. |
| Session completion and needs-input notifications | A completed or needs-input Session waits unnoticed, or its state must be manually relayed to the operator. |
| Session analytics and duration estimates | Enough thin Session receipts exist that aggregate history would change planning, admission, or provider selection. |
| Automatic QA invocation and Arcadia Now or Discord delivery | A QA-ready Candidate waits unnoticed, or a real review requires the operator to relay the CLI result manually. |
| Claim-to-proof manifest, local validation, or browser proof | A second real Candidate contains a material behavioral claim that completed green CI cannot substantiate. |
| Managed QA Runs | Artifact and Decision receipts no longer make QA history or recovery operable. |
| GitHub review/comment posting | The operator manually copies the same QA result into a pull request twice. |
| Patch chunking or staged review | A complete patch cannot fit the selected reviewer's bounded context or exceeds a configured token budget. |
| Exact QA token telemetry | Executor usage is reliably available and two real QA reviews need cost comparison. |
| Timezone-portable digest fixtures | The next digest scheduling change begins, or CI is expanded to validate a non-UTC runner. |
| Automatic diagnosis and repair | Repeated QA findings show a bounded repair class with deterministic validation and an acceptable authority policy. |
| Merge, deployment, release, or outbound messaging | A separately approved Action defines the exact authority, preview, rollback, and post-transition verification contract. |

A trigger reopening an increment does not pre-approve its consequential effects.
It means Arcadia may plan the smallest useful next slice without re-litigating
why the capability matters.
