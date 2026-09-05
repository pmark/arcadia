# Managed Production quality and reliability acceptance

This supporting contract strengthens the proposed bootstrap Plan. It is a set of
release requirements, not evidence that the controller already meets them.
The milestone remains proven Managed Production before Flight Deck production.
This work is specification and acceptance design; its artifacts are this contract,
the revised strict Ask, and the preview receipt. The proposed first implementation
Action is implement-evidence-bound-action-completion after governed activation;
production policy follows once bootstrap work can complete canonically.

## Excellent output is a separate gate from reliable execution

For every admitted Action, preserve its acceptance criteria and the exact source,
base revision, packet, policy and selected provider. Define observable checks for
each criterion before implementation. Mark product judgments as review-required.
Unsupported validation is a named gap, never an automatic pass. Provider selection
must meet the Action's capability requirements even when a cheaper model has quota.

Completion evidence names the resulting commit/tree, test commands and results,
artifact locations, and acceptance disposition for every criterion. Run checks in
the isolated Candidate against the exact proposed result. Test success, process
exit zero, agent confidence and a PR existing are not interchangeable with accepted
completion. Changes after validation invalidate affected evidence; a changed base
requires dependency/compatibility revalidation before dependent work starts.

Require a separate review pass for controller safety, authority, concurrency,
canonical state transitions, and nontrivial generated code before automatic
acceptance. The reviewer receives the criteria, actual diff and test evidence,
not only the author's summary; use existing review/QA infrastructure. The author
cannot silently dismiss unresolved findings. For mechanical low-risk edits, allow
explicit deterministic acceptance rules. Do not add a model call to every poll or
successful routine check. Product/UX acceptance remains an operator judgment
unless a specific objective rule was delegated.

Build the proof harness so it rejects a deliberately failing test, missing artifact,
stale commit evidence, unresolved blocking review, skipped required check and a
false agent completion claim. These negative cases are mandatory. A green harness
that only proves the happy path is not a quality gate.

## Invariants and failure injection

Use the existing worker, Session, lease, queue and canonical writer infrastructure.
No second scheduler or generic orchestration framework is required.

| Boundary | Required fault proof | Passing result |
| --- | --- | --- |
| Admission and launch | Two workers, repeated request, lost response, crash before/after spawn | At most one live conflicting execution; uncertain launch is reconciled, never blindly retried |
| Completion and pointer | Crash between evidence, document write, commit, queue projection and receipt | Recovery converges on one accepted transition; no duplicate Log or skipped Action; documents remain authoritative |
| Off | Race with claim/spawn; slow provider, blocked execution, worker restart | Durable Off fences later launch commitments; earlier committed work is identified; stale worker cannot revive policy |
| Process health | Hung agent, lost tmux identity, worker death, full disk/write failure | Explicit uncertain/failed state, preserved output and leases until resolved; finite deadlines and no false success |
| Capacity | Stale/unknown observation, limited provider, reset, observation failure | No invalid admission; fresh eligible capacity resumes automatically; no unauthorized paid fallback |
| Priority and authority | Reorder, changed packet/base, revoked policy, dependency not accepted | Revalidation refuses stale launch; unrelated eligible work may continue |
| Runtime | Candidate build, controller upgrade failure, schema incompatibility | Stable controller and independent status/Off remain available; tested recovery preserves receipts and work |

Specify crash injection points in the implementation test harness, not just a list
of end states. Repeat each deterministic race scenario at least 100 times with
reproducible seeds/interleavings. Require zero invariant violations, and retain
failing seed and timeline. This is a regression screen, not a statistical claim
of a production failure rate or exactly-once external execution.

Before live rehearsal, freeze concrete timeout, stale-observation, retry and
concurrency values in its manifest. Baseline local control target: durable Off
acknowledgment within two seconds on the recorded healthy host even when execution
or provider reads stall; if persistence is unavailable, show failure within five
seconds and never report Off as confirmed. Admit no new work without authoritative
policy state. Once prerequisites and fresh capacity are observed, the next eligible
Action should be admitted within two configured producer ticks. Record observed
latencies and failures; timeout exceptions cannot silently count as success.

Use finite per-Action repair/model-attempt budgets and provider-call deadlines.
Repeated identical failures stop that Action with one evidence-linked remedy,
without a cross-provider retry loop. Retries preserve original work. An exhausted
budget is a visible stop, not an invitation to weaken tests or select a weaker model.

## Staged evidence before Flight Deck handoff

1. Deterministic integration and crash/race tests pass against the release revision,
   including the negative quality cases above and existing affected regressions.
2. The two-dependent-Action live rehearsal passes from one activation with no manual
   Session relay. Record every human intervention; an authority decision is distinct
   from fixing controller bookkeeping by hand.
3. Both configured providers complete real bounded Actions. Capacity failure/reset
   tests name which evidence is real and which is simulated; supported automatic
   telemetry and reset recovery must be proven as required by contract 17.
4. Run a bounded real soak: at least ten accepted small Actions across at least two
   Projects and both providers, across two worker restarts, an Off/reactivation,
   and one injected recoverable failure. Obtain the rehearsal's exact scope and
   capacity authority first; do not burn tokens to reach a time quota. Require zero
   duplicate launches, lost outputs, unauthorized transitions or falsely accepted
   results, and zero manual Session relays. A fixed defect requires rerunning its
   affected proof and the end-to-end chain on the new revision.
5. Publish a single release evidence index mapping every required invariant and
   quality gate to pass/fail/unproven, revision, artifact, and reproduction procedure.
   Missing live evidence remains unproven. Any safety invariant failure, blocking
   review finding or missing required proof prevents unattended Flight Deck handoff.
6. Pin the accepted runtime; have the operator exercise Work Queue status/Off and
   the recovery procedure. Then use the first real Flight Deck Actions as further
   dogfood evidence. A later critical regression stops affected admissions, preserves
   work, and follows the existing stop-the-line repair and controlled upgrade path.

These are proposed release gates, not a guarantee of perfect software. Broader
unattended scope is earned by recorded evidence. Continuous building is subordinate
to accepted output, current authority and recoverable execution.
