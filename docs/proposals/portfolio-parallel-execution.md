---
arcadia: v1
type: proposal
project: arcadia
question: Should Arcadia admit work from the portfolio's ready set, in operator-owned queue order, so the operator moves forward as fast as they can afford, instead of advancing one stored pointer per Project from one Session to the next?
---

# Portfolio parallel execution

New users and reviewers will want to find out how many agents Arcadia can run
at once across a whole portfolio. The answer this document gives is not "as
many as possible". Arcadia is not a swarm manager. Its promise is that **the
operator moves forward as fast as they can afford**: every unit of capacity
they are willing to spend goes to the most valuable work that is ready, and
nothing waits for a reason Arcadia could have avoided.

This document does four things:

1. It lists every existing record that already governs parallel work.
2. It checks those records against the code as it stands on 2026-09-25.
3. It proposes **ready-set admission**. Work is chosen from everything that is
   ready, in the operator's queue order. It no longer advances a stored
   pointer from one Session to the next.
4. It names the one Decision this needs. That is a reopening of Decision
   0023, filed as
   `.arcadia/asks/agent-ask-reopen-0023-ready-set-admission-2026-09-25.yaml`.

## 1. What is already written

### Ratified Decisions

| Decision | What it settles for parallelism |
| --- | --- |
| [0011](../decisions/0011-agent-session-queue-and-alerting.md) | The original worker was serial: one Run at a time, blocking each tick. It records this as a deliberate default, not a limitation to fix ahead of need. |
| [0012](../decisions/0012-the-session-primitive.md) | Introduces the **Session** and the **repository lease**: only one `prepared`/`running` Session per repository. "Concurrency across repositories may be admitted later; concurrency inside one repository requires a separate explicit design." |
| [0022](../decisions/0022-instance-coordination-boundary.md) | **Git is the only channel between Arcadia installations.** There is no hosted coordinator, and no installation reads another's database. Committed claim records are allowed as a fallback but not adopted. |
| [0023](../decisions/0023-work-pointer-under-concurrency.md) | `current_action` stays a stored value. One dispatched agent per repository. Deriving the pointer from the ready set is rejected, because a tiebreak would replace the operator's judgment. Claims (option B) and moving the pointer into the Plan (option D) are held behind triggers. |
| [0051](../decisions/0051-decide-whether-sequential-coding-agent-sessions-for-the-same-governed-action-may.md) | **Candidate continuation**: at most one live execution per candidate worktree. Later Sessions for the same Action reuse the candidate once the earlier one is proven terminal. |
| [0066](../decisions/0066-record-when-arcadia-should-widen-beyond-one-coding-agent-session-per-repository.md) | **Same-repository concurrent Sessions are deferred.** The trigger has three parts: `prove-two-action-unattended-production` lands cleanly in real use, the fixes for #505, #507 and #549 are done, and then a secondary lane for low-blast-radius Actions becomes cheap. A ready-set multi-Session scheduler was explicitly rejected for now. |
| [0054](../decisions/0054-should-plan-and-action-priority-live-only-in-the-queue.md) | **Priority lives in the queue.** The explicit ordered queue is the only record of Plan and Action priority. |
| [0058](../decisions/0058-should-the-standing-managed-production-authorization-delegate-a-bounded.md) | **Bounded candidate integration.** Under a named, expiring grant, a finished and validated candidate may be merged into the base branch with no per-Action operator merge. |
| [0070](../decisions/0070-decide-whether-an-action-s-completion-settles-after-its-pr-merges-applied.md) | **Completions settle after merge, serially, on `main`, and the host pushes them.** A PR carries only its drafted `complete` Ask. The host settles merged completions in merge order. Governance files leave every PR, so parallel PRs stop conflicting on `PROJECT.md`, the Plan and `MISSION_LOG.md`. Its build (`settle-squash-merged-completion-drafts`, `sweep-merged-completions-before-dispatch`) is held behind the proof. |
| [0057](../decisions/0057-should-prove-two-action-unattended-production-be-deferred-until-the-next-live.md) / [0061](../decisions/0061-retarget-decision-0057-s-reactivation-trigger-so-prove-two-action-unattended.md) | Defer the two-Action proof that 0066 depends on. It revives on any configured provider with capacity, once the managed-production defects are fixed. |

### Proposals and plans

| Record | Status | What it contributes |
| --- | --- | --- |
| [`operator-scale-managed-production-boundary`](operator-scale-managed-production-boundary.md) | Proposal, unanswered | The product boundary. Arcadia is "mission control for a constrained operator portfolio", not a swarm scheduler. Its rule is "Concurrency is a capacity decision, not an identity". Admission is bounded by **authority**, **isolation** and **capacity**. Sequential is the default. Independent repositories may run concurrently within host and provider limits. |
| [`concurrent-session-action-claims`](concurrent-session-action-claims.md) | Proposal, implemented | Evidence of a live collision on 2026-09-22 (#487/#496). Specifies three things: **assignment** (a queue walk to the next unclaimed Action), a **claim** fenced by generation, and **serialized pointer writes**. |
| [`arcadia-dispatches-a-different-ready-action-…`](../plans/arcadia-dispatches-a-different-ready-action-to-each-of-several-concurrent.md) | Plan, **complete** | Built the Action-scoped claim and the queue-walk fallback in `arcadia go`. |
| [`host-owned-agent-workspace-contract`](host-owned-agent-workspace-contract.md) | Answered by 0051 | The host owns Git and the worktree lifecycle. Agents only edit and validate. There is one candidate per Action. |
| [`mission-control-view/17-managed-production-contract`](../plans/mission-control-view/17-managed-production-contract.md) | Contract | "Reserve capacity/worker slots atomically, at most one conflicting execution per canonical repository. Run independent Projects concurrently up to the configured host and provider limits." It also says a blocked Project must not leave every provider idle. |
| [`mission-control-view/10-session-unit-ledger-deferred`](../plans/mission-control-view/10-session-unit-ledger-deferred.md) | Deferred with trigger | A weekly Session Unit budget. Allowance belongs to the **provider**, never to the work. Assignment is a solve: the cheapest compliant binding that still has allowance. |
| [`provider-capacity-harvesting`](../plans/provider-capacity-harvesting.md) | Plan, proposed | A normalized usage and reset receipt. Unknown capacity never counts as unlimited. Paid credits are never spent just to stay busy. |
| [`agent-advance-queue#budget-aware-admission`](../plans/agent-advance-queue.md) | Blocked | Checks daily and weekly provider limits before admission. It is waiting on comparable telemetry. |
| [`docs/production-scheduling.md`](../production-scheduling.md) | Reference | Canonical order and `schedule prioritize` across Projects: "no fairness, weighting, or aging". Batch **lanes** are one per repository, and a lane is marked sequence-advised. |
| `.arcadia/asks/agent-ask-enable-parallel-plan-dispatch-per-repository-2026-09-25.yaml` | Ask, **unsettled** | Asks for a second live Session per repository. The recommended route is `--plan` targeting with a per-Plan lease. [`managed-production-readiness.md`](../managed-production-readiness.md) warns that settling it now would reopen 0066. |

## 2. What the code does today

Checked against source on 2026-09-25:

- **Cross-repository concurrency is already built. It is switched off by default.**
  - `runManagedProductionTick` (`src/production/tick.ts:434`) makes a launch attempt for **every** active Project on every tick, in `schedule prioritize` order.
  - The global limit is `ProductionScope.maxConcurrentSessions` (`src/production/policy.ts:303`). It **defaults to 1**, so the worker is serial across the whole portfolio.
  - Raising it lets independent repositories run side by side, and nothing else in the code has to change for that.
- **The repository lease is a unique partial index.** It is `agent_sessions(repository_path) WHERE status IN ('prepared','running')` (`src/db/schema.ts:337`). There is no TTL and no heartbeat. The lease holds until tmux exits and `reconcileSessionExit` runs. A silent Session is flagged as stalled after 20 minutes but keeps the lease.
- **Action claims are live on both launch paths.** Claims live in `agent_worktree_reservations` with `claim_generation`. `launchGuardedHostSession` and `arcadia go` both use them, and settlement checks the generation fence (`src/ask/settlement.ts:1210`).
- **Settlement already uses compare-and-set for `PROJECT.md`**, through `writePointerPairWithCompareAndSet`. The open part of #505 is the pointer write in `applyDecisionDeferral`.
- **Every completion also picks the next Action.** `settleAgentAsk` calls `selectNextAfterCompletion` (`src/ask/settlement.ts:2086`), writes the result into `current_action` and appends to `MISSION_LOG.md`. That write is why the scheduler has to hold the pointer while a candidate is unmerged (`docs/production-scheduling.md`). The next Session cannot start until that candidate's pointer rewrite lands.
- **An unknown dependency counts as satisfied.** `canonicalOrder` (`src/scheduling/order.ts:64`) releases an Action whose `depends_on` names an id it does not know. This is harmless when work runs one Action at a time. It is a hole when work runs in parallel.
- **Provider capacity is a gate, not a budget.** `evaluateCapacityAdmission` refuses `capacity_exhausted` and waits for reset. Nothing counts how many Sessions one provider account is running.
- **Nothing that launches uses `resolveBatch`.** Lanes exist only on the board projection.
- **Storage is one SQLite workspace database** in WAL mode, with `busy_timeout=15000` and `BEGIN IMMEDIATE` writes. That is plenty for tens of writers.

So the first honest answer to "how many agents can it run?" is a configuration value that nobody raises by default, and nothing explains why a waiting Action is waiting.

## 3. Architecture: ready-set admission

### The goal is affordable speed, not maximum concurrency

The operator sets what they can afford:

- host slots;
- provider accounts, and how many Sessions each account may run;
- whether usage stays inside included allowance or may reach an explicit
  spend ceiling;
- how many unmerged PRs they are willing to review.

Arcadia's job is to keep all of that capacity busy on the highest-priority
ready work, and nothing more. A portfolio with one provider account and one
review hour a day should run one Session at a time and never idle it. A
portfolio with three accounts across twenty client repositories should run
three. The same mechanism covers both, and it never creates work to fill
capacity.

### The model

Each tick:

```
ready  = every Action in the in-scope Plans of every active Project where
           status is not done, deferred or needs_operator,
           every depends_on is done on the base branch (landed),
           and no live claim holds it
order  = canonicalOrder over ready          # Project priority, then class,
                                            # queue position, declaration
for action in in-scope Actions not in ready:
  record its blocking reason                # dependency, needs_operator, claimed, ...
for action in order:
  if host has no free slot:
    record host_full; continue              # read-only: reason, no launch
  if any required resource is missing: record its wait reason; continue
  for provider in compliantProviders(action):      # cheapest sufficient first
    if reserve(action, provider): launch detached; break
  else: record the missing provider resource
```

Every in-scope Action that does not launch ends the tick with exactly one
reason, including those left over after host capacity runs out.

That is the whole scheduler. The following things disappear:

- **Choosing the next Action at settlement.** A completion records its evidence
  and releases its claim, and that is all it does. The next tick recomputes the
  ready set. `selectNextAfterCompletion` and every "wrong Next" race (#507) go
  with it.
- **Advancing the pointer between Sessions.** Which Action a Session is working
  on is its **claim**, which already exists and carries a generation.
  `current_action` becomes a derived display value: the highest-priority Action
  that is claimed, or ready if nothing is claimed. Only the scheduler writes
  it, as a projection. No settlement, deferral or `advance` writes it, so
  #505-class read-modify-write races lose their subject.
- **Holding the pointer until the PR merges.** That hold exists only because the
  candidate branch rewrote `current_action`. Once settlement stops writing the
  pointer, the next independent Action can start while the previous PR waits
  for review. This is pipelining, and it is where most of the speed-up comes
  from for someone with one repository: the agent works while the human
  reviews.

Decision 0023 rejected this option. Its reason was that ordering the ready set
needs "an ordering heuristic standing in for the operator's judgment".
Decision 0054 has since made the explicit queue the only record of priority,
and `canonicalOrder` is a total order the operator controls by dragging cards.
No heuristic is left to object to.

### Dependencies

The ready set is only as safe as its dependency edges. The rules are:

1. **Ready means every dependency has landed**, not merely been settled. Readiness
   is read from the plan documents on the base branch, and a completion reaches
   the base branch only when its PR merges. A dependent Action therefore always
   starts from a base that contains the code it depends on. This is already how
   `canonicalOrder` behaves, and it must stay that way.
2. **An unknown dependency blocks.** `order.ts:64` currently releases an Action
   whose dependency id is not in the current Plan. Ready-set admission needs the
   opposite: resolve the id across Plans by `plan/<slug>#<action>`, or refuse
   with a `dependency_unresolved` wait reason. This must ship before any
   pipelining.
3. **Missing edges are contained by lanes, not trusted away.** One-at-a-time
   execution hides a missing `depends_on`, because everything runs in
   declaration order. Parallel admission exposes it. Two defaults contain the
   damage:
   - Pipelining in one repository admits only an Action the queue places
     *after* the unmerged one. The unmerged candidate's diff must not touch
     paths the new Action declares in `touches:`.
   - An Action with no `touches:` is treated as touching the whole repository,
     so it never pipelines. Declaring scope is how a Plan opts into speed.
4. **Cross-repository dependencies are ordinary edges.** They are enforced the
   same way, through the landed-on-base rule in the dependency's own
   repository.

### Resources and admission

Admission reserves one unit of every resource the Action needs:

| Resource | Unit | Exists today |
| --- | --- | --- |
| **Authority** | Production policy revision and epoch, with the Plan in scope | Yes (`production_admissions`) |
| **Host slot** | One concurrent Session on this machine | Yes, as `maxConcurrentSessions` |
| **Live lane** | One live Session per repository (Decision 0066) | Yes (repository lease index) |
| **Action claim** | One live candidate per Action | Yes, with generation |
| **Provider slot** | Concurrent Sessions per provider *account* | **No** |
| **Allowance** | Included capacity left in the window, or the remaining explicit spend ceiling | Gate only |
| **Review headroom** | Unmerged candidates per repository, below the operator's limit | **No** |

The reservation keeps the launch primitive's existing two-phase shape. There is
no single transaction today, and this design does not pretend there is one:

- **Issue.** `issueAdmission` takes the host slot in its own transaction. It
  checks the policy epoch and the live-admission count, and writes a receipt
  with a 30-second TTL. The provider-account slot belongs here, counted in the
  same query as the host slot.
- **Prepare.** A separate `writeTransaction` reserves the worktree, the Action
  claim and the repository lease through `beforeCreate`.
- **Commit.** `commitAdmission` rechecks the epoch just before the process
  starts. A stale epoch refuses and releases.

Rollback:

- **Today.** `src/sessions/launch.ts` releases the Action claim by its
  generation on every failure path. It calls `releaseAdmission` only when the
  launch lost a lease race to a matching winner (`launch.ts:314`). Other
  preparation failures keep their admission until the 30-second TTL expires.
- **Proposed.** Every failure path after issue calls `releaseAdmission`. A
  crash between issue and commit leaves only an uncommitted receipt, which
  expires within its TTL.

Launch stays detached under tmux, so a tick never blocks on a coding agent.

### Waits are the product surface

Every in-scope Action that did not launch gets exactly one derived reason:

`authority · host_full · lane_busy(<session>) · claimed(<worktree>) · provider_full(<account>) · allowance(<reset or ceiling>) · review_backlog(<n PRs>) · dependency(<id>, unlanded) · dependency_unresolved(<id>) · scope_overlap(<candidate>) · needs_operator`

The reason is recomputed on every tick and never stored as truth. It feeds
`production status`, Flight Deck and the board's `Arcadia push` field. This is
what a reviewer pushing the limit should see: which resource they would need to
buy or free to go faster. That might be another account, a higher ceiling,
fewer unreviewed PRs, or better `touches:` scoping.

### What limits speed

`throughput ≈ min(host slots, Σ provider slots, allowance, repositories with ready work × pipeline depth, review rate)`

For most operators the last term dominates. That is why review headroom is a
resource and not an afterthought. A limit on unmerged candidates per repository
stops Arcadia from producing PRs faster than the operator merges them. Once the
limit is reached, Arcadia's reason is "review the PRs you have", not "buy more
agents".

### What pipelining needs from settlement

Two unmerged candidates in one repository must merge cleanly in either order.
**Decision 0070 already provides this.** A PR carries only its drafted
`complete` Ask, which lives at a unique path. The host settles merged
completions serially on `main`, in merge order. No PR rewrites `PROJECT.md`,
the Plan or `MISSION_LOG.md`, so candidates conflict only where their code
does, and `touches:` scoping is what prevents that.

0070 also fits ready-set admission directly:

- **The host settler is the single serial writer.** Recomputing the
  `current_action` projection is one more thing it does after settling. The
  pointer then has exactly one writer and no race.
- **"Done" appears on `main` only after merge**, which is exactly the
  landed-dependency rule above.

So pipelining depends on 0070's two held Actions,
`settle-squash-merged-completion-drafts` and
`sweep-merged-completions-before-dispatch`, rather than on any new settlement
work.

### Unchanged boundaries

- **Two live Sessions in one repository** remain deferred by Decision 0066.
  Pipelining keeps one live Session per repository and only lets its next
  independent Action start before the previous PR merges. When 0066's trigger
  fires, "lane" narrows from repository to repository plus `touches:` scope, and
  nothing else in the model changes. The pending
  `enable-parallel-plan-dispatch-per-repository` Ask should then be settled
  that way, not with a per-Plan lease, because two Plans can touch the same
  files and two Actions in one Plan often do not.
- **More than one installation** stays behind Decision 0022. Scale-out is by
  partitioning: each Project is owned by one installation for managed
  production, declared in a committed record, and a stale owner is cleared by a
  commit.
- **Candidate continuation** (Decision 0051) is unchanged. A single Action can
  still span several Sessions in one candidate.
- **No automatic spending.** Allowance means included capacity unless the
  operator set an explicit ceiling. `provider-capacity-harvesting` and the
  Constitution rule this out.

## 4. Sequence (the 20% first)

| Step | What | Gated by | Size |
| --- | --- | --- | --- |
| 1 | **Wait reasons and a fake-executor soak.** Add `production status --explain` with one reason per in-scope Action. Add a deterministic `fixture` coding-agent provider that sleeps, edits one file and exits, so reviewers can push limits at zero token cost and watch each one engage. | None. It is read-only plus a test provider. | S–M |
| 2 | **Unknown dependencies block.** Resolve cross-Plan ids, or refuse with `dependency_unresolved`. | None. It is a correctness fix. | S |
| 3 | **Ready-set admission across repositories.** The tick admits from the portfolio ready set in canonical order, one live Session per repository. Settlement stops choosing the next Action. The host settler from Decision 0070 becomes `current_action`'s only writer, as a projection. | **The reopened Decision 0023** | M |
| 4 | **Provider-account slots and review headroom.** Add per-account slot limits in the issue phase and a per-repository limit on unmerged candidates. Release the admission on every failure path. | None | S–M |
| 5 | **Pipelining.** An independent Action whose `touches:` do not overlap may start in a repository whose previous candidate is unmerged, up to the review limit. | Step 3's Decision, and Decision 0070's two held Actions are built | M |
| 6 | **Raise the defaults.** Activation previews the host slots, provider slots, allowance or ceiling, and review limit it would grant, and the throughput they imply. Raising any of them stays an explicit operator choice. | Step 1's soak is green and step 4 is active | S |
| 7 | **Two live Sessions in one repository.** | Decision 0066's trigger, then a new Decision | L |
| 8 | **Multi-installation ownership records.** | Decision 0022's trigger | M |

Steps 1, 2, 4 and 6 fit inside the Decisions already ratified. Steps 3 and 5
need the reopened Decision 0023. Steps 7 and 8 stay behind their existing
triggers.

### What this does not build

- A swarm scheduler, a distributed scheduler or a hosted coordinator.
- Fairness weighting or aging across Projects. Strict queue order plus resource
  limits already spreads work, and `production-scheduling.md` defers fairness
  until a need is observed.
- Spending to fill idle capacity.
