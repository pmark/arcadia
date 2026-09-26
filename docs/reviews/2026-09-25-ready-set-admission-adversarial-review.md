# Adversarial review: ready-set admission

Answers [`2026-09-25-ready-set-admission-adversarial-review-prompt.md`](2026-09-25-ready-set-admission-adversarial-review-prompt.md),
reviewed against `main` at `2f8f0fff` (after the gate was widened in `751f90d6`
and `prove-concurrent-ready-set-admission` was added in `bb9b457e`). Nothing
here is implemented yet; every finding attacks acceptance-criterion text or
the existing code those criteria will change.

Reviewer: Critic Claudia Atlas (Claude Opus 5.5, critic role). Settlement bug found while filing the Asks: #654.

## Verdict

**Hold — build the sequential proof first** for the part of
`admit-ready-set-across-repositories` that changes settlement and
`current_action`.

The concurrency gate (AC6) holds back `maxConcurrentSessions > 1`. It does not
hold back AC2 and AC3, which stop settlement writing the pointer and hand the
pointer to a new writer. Those take effect the moment the PR merges, and
`managed-production-readiness.md` says B1/B2 "land, review, and merge now". The
operator's worry was debugging exactly that mechanism, and the one proof meant
to validate it would then run against a different mechanism than its own
criteria describe.

What can ship now without breaking the hold: B1 with F6/F7 fixed; the gate on
its own, enforced per admission in `issueAdmission`; and the split fix (F4).
Two Agent Asks, both settled on `main`, encode this:

- `add-concurrency-gate-and-split-rewire-after-review-2026-09-25` (`e83cc3b9`)
  creates `enforce-concurrency-gate-at-admission` (F5, and the rehearsal
  exception F3 needs) and `rewire-dependents-on-split` (F4), queued right after
  `resolve-cross-plan-dependency-ids`.
- `amend-ready-set-admission-actions-after-review-2026-09-25` (`ad1e05be`)
  amends `resolve-cross-plan-dependency-ids` (F6, F7),
  `admit-ready-set-across-repositories` (F1, F2, F8, F9: its old AC6 moves to
  the gate Action, and it now depends on the proof and the 0070 host settler),
  `pipeline-independent-actions-while-pr-unmerged` (F10) and
  `prove-concurrent-ready-set-admission` (F3).

## Blocks proceeding

### F1. The gate holds back the wrong change

- `admit-ready-set-across-repositories` AC2/AC3 retire settlement's
  `selectNextAfterCompletion` pointer write and name a new writer. Both land on
  merge, ungated.
- AC6 only refuses a concurrency limit above 1.
- `prove-two-action-unattended-production` AC2 requires that A "records
  canonical completion/pointer" — the old mechanism. Run after B2, the proof
  validates something other than what its criteria describe, and never
  validates the mechanism it was written for.

### F2. AC3 names a writer that cannot exist yet, and the fallbacks stall the proof

- AC3: `current_action` is written "only by the host settler established under
  Decision 0070". That settler is `settle-squash-merged-completion-drafts` +
  `sweep-merged-completions-before-dispatch`, both
  `depends_on: [prove-two-action-unattended-production]`. B2 depends only on
  `resolve-cross-plan-dependency-ids`.
- A writer AC3 never mentions already exists: `alignPointer`
  (`src/scheduling/scheduler.ts:251-321`) rewrites `current_action` every tick
  via `transitionActionPointer`.
- The single writer is named three incompatible ways: the proposal says "only
  the scheduler", AC3 says "only the host settler", Decision 0070 says "the
  host worker (or arcadia go preflight)".
- Every way to build AC3 today breaks something:
  - build the host settler inside B2 — bypasses 0070's hold;
  - remove `alignPointer`'s write too — nothing moves the pointer, and
    `resolveProjectTransition` (`src/production/tick.ts:643`) dispatches from
    the pointer, so B never launches after A; the proof fails, the gate never
    opens;
  - keep `alignPointer` — AC3 is violated, and AC5's "#505/#507 closed" tests
    exercise a scheduler write, not the design.

## Should fix before building

### F3. `prove-concurrent-ready-set-admission` cannot run, and cannot observe the race it claims to test

This item was retargeted after `prove-two-action-unattended-production` was
found not to exercise concurrency. The new Action has three problems:

- **Circular with the gate.** Its AC2 activates `maxConcurrentSessions >= 2`
  "permitted for this proof specifically, ahead of the general gate". B2's AC6
  refuses that until *both* proofs are `done` and defines no exception. Either
  the proof cannot run, or whoever builds it invents an unscoped bypass.
- **Two repositories cannot race on the pointer.** #505/#507 are races on one
  Project's `current_action` (its `PROJECT.md` and active Plan). Two Actions in
  two different repositories write two different pointer files. AC4's
  "a #505/#507-class race … does not occur" is true by construction and
  proves nothing. The shared state that two repositories actually contend on
  is the workspace database (admissions, host slot, claims) — AC4 does not
  name it.
- **The escape hatch leans on tests of the deleted path.** AC4 allows one live
  completion order plus "reason explicitly about the other order using the
  existing deterministic settlement-race tests". Those tests cover
  `selectNextAfterCompletion`, which B2 AC2 removes. After B2 they are evidence
  about code that no longer runs.

Nothing stops a deterministic test suite from using `maxConcurrentSessions > 1`,
and nothing should — fake-tmux tests are cheap and useful. The risk is only
that they be cited as live proof; the new Action's AC6 already forbids
fixture-as-live, which holds.

The proposal's own step 1 (a fixture-provider soak, which step 6 "raise the
defaults" is gated on) still has no Action.

### F4. `split` marks the original id done, which opens the gate and releases dependents early

- `split` (`src/ask/settlement.ts:835-1010`) accepts any strict, verbatim,
  in-order subset of the criteria and calls `markActionDone` on the original
  id.
- Split `prove-two-action-unattended-production` with only AC1 ("Provide a
  disposable … Project") as the finished slice: its status becomes `done`, the
  gate's check passes, and the real proof lives under remainder ids the gate
  never names. `prove-multi-provider-production-recovery` depends on it and is
  released too.
- Wider than the gate: today one-at-a-time dispatch keeps dependents behind the
  remainder only because it is queued immediately after the split Action
  (`insertQueueKeys … "after"`). Ready-set admission drops queue order as a
  serializer, so dependents of *any* split Action become ready while the
  remainder is still open.

### F5. The gate is placed where it can be bypassed, checked once, and can lock forever

- AC6 names "the validation path in src/production/policy.ts" — that is
  `normalizeProductionScope` (`policy.ts:277`), a pure function that cannot
  read a Plan. `activateProduction` (`policy.ts:545`) never calls it and
  writes `input.scope` raw; `readProductionPolicy` parses `scope_json`
  unvalidated; `issueAdmission` (`policy.ts:771`) trusts the stored
  `maxConcurrentSessions`. A gate in the validation path misses a direct
  `activateProduction` caller, a fixture, or a stored row. `issueAdmission` is
  the only chokepoint every launch passes through.
- Checked once at activation: a later reopen of a proof Action leaves an active
  policy's limit in force indefinitely.
- "done in the active Plan": once the bootstrap Plan closes and `active_plan`
  moves, the proof Actions are not in the active Plan, so the gate either
  refuses forever or, written loosely, treats "not found" as a pass.
- There is no gate today: `production activate --concurrency N` is accepted
  (`src/commands/production.ts:390`). The policy was Inactive at revision 15
  when checked, so no stored row exceeds 1 yet.

### F6. The unknown-dependency fix targets the wrong function

- `canonicalOrder` never excludes an Action. When no candidate satisfies the
  dependency predicate it emits the first remaining one anyway, as its cycle
  fallback (`src/scheduling/order.ts:66-68`). Making unknown ids fail the
  predicate still lets the Action out through the fallback.
- The readiness check that actually gates dispatch, `collectUnmetDependencies`
  (`src/docs/dispatch.ts:692-718`, used by `deriveStatus` in
  `src/scheduling/schedule.ts:247`), also skips dangling ids. B1's AC1 does not
  name it.
- The parser (`src/docs/parse.ts:525-535`) reports every id outside the
  Action's own Plan as dangling, including a valid `plan/<slug>#id`. Cycle
  detection is per-Plan, so a cross-Plan cycle A→B→A is never caught and both
  wait forever.
- `schedule.ts:207` drops deferred Actions before ordering, so a dependency on
  a deferred Action looks unknown and would be reported `dependency_unresolved`
  — a typo signal for what is really a deferral.
- `dependency_unresolved` never escalates ("recomputed every tick and never
  stored as truth"). Compare `recordOperatorEscalation` (`tick.ts:319`). A typo
  leaves an Action unready forever, visible only to someone who runs the status
  command.

### F7. Cross-Plan ids can be ambiguous

- Only Ask-created ids are checked for Project-wide uniqueness; hand-written
  Plans can repeat an id (the `complete` intent's "ambiguous id across Plans"
  refusal exists for this reason).
- `plan/<slug>#id` has no Project segment, and Plan slugs can repeat across
  Projects, while the ready set spans the portfolio.
- B1's AC1 does not say what happens on two matches. It should wait, never
  pick.

### F8. There is still more than one pointer writer

- Decision 0070 names two settler processes (worker and `arcadia go`
  preflight), plus `alignPointer`.
- `writePointerPairWithCompareAndSet` (`src/dispatch/pointer.ts:249`) protects
  the file's text, not the freshness of what was computed: a projection derived
  from an older Plan read can still land after a newer settlement. Both writers
  commit in one checkout, and `alignPointer` reduces a failed commit to a log
  line.

### F9. One stalled Session holds a portfolio-wide slot

- `countLiveAdmissions` (`policy.ts:964`) counts a committed admission, with no
  epoch bound, until its Session is completed, failed or needs_input.
- A stalled Session whose tmux is alive is flagged and keeps its lease
  (`tick.ts`, stall branch) — and its host slot, which every repository shares.
  N stalls at `maxConcurrentSessions = N` stop the whole portfolio, and
  `host_full` would not say which Session holds the slot.

### F10. `touches:` can invert its safe default

- If parsed with `stringArray` (`parse.ts:966`), a scalar `touches: src/foo`
  becomes `[]`; an explicit `touches: []` is "declared" under B3's AC1, overlaps
  nothing, and always pipelines. Same absent-versus-empty trap the
  `depends_on` comment at `parse.ts:494` describes.
- Nothing checks that the new candidate's actual diff stays inside its
  declared `touches:`, and the unmerged candidate's diff changes after
  admission (CodeRabbit fix rounds push to it), so a one-time overlap check
  goes stale.

## Worth noting

### F11. The SQLite claim is untested

"Plenty for tens of writers" has no test; the only contention test
(`tests/db-write-transaction.test.ts`) uses two connections with
`busy_timeout = 200`. `better-sqlite3` is synchronous, so a 15 s
`busy_timeout` wait freezes the worker's event loop, heartbeat included.
