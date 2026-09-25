---
arcadia: v1
type: proposal
project: arcadia
question: How should Arcadia scale managed production from one Session at a time to many concurrent coding-agent Sessions across a portfolio of Projects and Plans, without breaking the concurrency Decisions already ratified?
---

# Portfolio parallel execution

New users and reviewers will want to find out how many agents Arcadia can run
at once across a whole portfolio. This document does three things:

1. It lists every existing record that already governs parallel work.
2. It checks those records against the code as it stands on 2026-09-25.
3. It proposes an architecture that scales within those records.

It asks for nothing that a ratified Decision has already refused. The one
piece that needs a new Decision is marked as such.

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
- **Provider capacity is a gate, not a budget.** `evaluateCapacityAdmission` refuses `capacity_exhausted` and waits for reset. Nothing counts how many Sessions one provider account is running.
- **Nothing that launches uses `resolveBatch`.** Lanes exist only on the board projection.
- **Storage is one SQLite workspace database** in WAL mode, with `busy_timeout=15000` and `BEGIN IMMEDIATE` writes. That is plenty for tens of writers.

So the first honest answer to "how many agents can it run?" is a configuration value that nobody raises by default, and nothing explains why a waiting Action is waiting.

## 3. Architecture

### Principle: admission is a matching problem over explicit resources

Parallelism is not a scheduler that hands out work. It is **admission**: one
eligible Action is matched to one free unit of every resource it needs. All of
those units are reserved under one fenced reservation and released together.
Every refusal names the resource that was missing.

This is the authority/isolation/capacity triple from the operator-scale
proposal, written out as resources:

| Resource | Unit | Held by | Exists today |
| --- | --- | --- | --- |
| **Authority** | Production policy revision and epoch, with the Plan in scope | Admission receipt | Yes (`production_admissions`) |
| **Host slot** | One concurrent Session on this machine | Admission | Yes, as the global `maxConcurrentSessions` |
| **Isolation lane** | One writer per lane. A lane is a repository today and could be narrower later. | Session lease | Yes (repository lease index) |
| **Action claim** | One live candidate per Action | Claim with generation | Yes |
| **Provider slot** | Concurrent Sessions per provider *account*, not per model | Admission | **No** |
| **Provider allowance** | Included capacity left in the current window | Capacity receipt | Gate only |
| **Integration throughput** | Open, unmerged candidate PRs per Project | Derived | **No** |

The last row is the one reviewers will hit first without seeing it.

### The admission loop

The tick keeps its shape. What changes is that it fills free slots on purpose:

```
free = hostSlots − liveAdmissions
for project in scheduling order:              # schedule prioritize
  for action in canonicalOrder(project):      # existing canonicalOrder
    if free == 0: stop
    lane  = laneOf(action)                    # repository today
    need  = {lane, claim(action), providerSlot(p), allowance(p), authority}
    for p in compliantProviders(action):      # selectCompliantCodingAgent order
      if reserveAll(need):                     # issue → prepare → commit, fenced
        launch detached; free -= 1; next project
    else: record wait reason (the first missing resource)
```

Three properties matter here:

1. **Priority stays total and operator-owned.** Admission walks the existing canonical order. When the top Action cannot run, Arcadia moves to other work that can, and records why the higher Action is waiting. This is contract 17's "a blocked Project must not idle every provider". It is not a new ordering heuristic, so 0023's objection to deriving the pointer does not apply.
2. **The launch primitive keeps its two-phase shape.** `launchGuardedHostSession` (`src/sessions/launch.ts`) does not reserve everything in one transaction today, and this design does not pretend it does:
   - **Issue.** `issueAdmission` takes the host slot in its own transaction. It checks the policy epoch and the live-admission count, and writes a receipt with a 30-second TTL.
   - **Prepare.** A separate `writeTransaction` reserves the worktree, the Action claim and the repository lease through `beforeCreate`.
   - **Commit.** `commitAdmission` rechecks the epoch just before the process starts.

   The provider-account slot belongs in the **issue** phase, counted in the same query as the host slot and fenced by the same epoch. It must not go in `beforeCreate`. The lane and the claim stay in the **prepare** phase. Rollback is explicit:
   - A lost lease race or a failed preparation calls `releaseAdmission`, which frees both slots, and releases the claim by its generation. This is what the code already does at `launch.ts:300–364`.
   - A worker that crashes between issue and commit leaves only an uncommitted receipt. That receipt expires within its TTL and is not counted after that.
   - A commit that finds a stale epoch refuses and releases.

   No step can hold a slot that another step believes is free, so the reservation behaves as atomic without needing one transaction.
3. **Launch is detached.** Sessions run under tmux, so the tick never blocks on a coding agent. Tick length is bounded by the number of Projects, not the number of live Sessions.

### Waits are first-class output

Every Action in scope that did not launch this tick gets **one** wait reason:

`authority · host_full · lane_busy(<session>) · claimed(<worktree>) · provider_full(<account>) · allowance(<reset>) · integration_backlog(<n PRs>) · dependency · needs_operator`

Wait reasons are derived on each tick and never stored as truth. They feed
`production status`, Flight Deck and the board's `Arcadia push` field.

This is the answer to the stress-testing reviewer: turn the dial up, and
Arcadia tells you exactly which resource stops it and why. It is also the
cheapest part of this design to build, and it is useful even at a limit of one.

### Portfolio shape determines the ceiling

With one lane per repository, the upper bound on useful concurrency is:

`min(hostSlots, Σ providerSlots, #repositories with a ready Action, integration headroom)`

On a portfolio of many repositories, like Private Practice Now's client sites,
that is high enough without any same-repository concurrency. On one large
monorepo it is **1**, and that case is what 0066's trigger is waiting for.

### Integration backpressure

Throughput is limited by review and merge, not by launches. N agents produce N
PRs, and all of them need CodeRabbit, CI and a merge. Reviewers pushing
concurrency will find that pile-up before any lock contention.

Admission should therefore stop taking new work in a Project whose
preserved-but-unlanded candidates reach a configured limit. The limit could
default to the Project's lane count plus one. The scheduler already holds the
pointer while a candidate has not landed, so this generalizes an existing rule
rather than adding one.

### Same-repository lanes (behind Decision 0066)

These are not proposed for now. The design is written down so the trigger has a
buildable target when it fires. Two concurrent candidates in one repository
break three things. Each needs a structural fix, not a lock:

1. **Governance write conflicts at merge.** Each candidate's completion settlement rewrites `current_action` and the Plan's Action block on its branch, so the second merge conflicts. The fix is 0023's option D taken further:
   - Completion evidence and status go into **per-Action append-only records**, one file per settlement under the Plan's directory. Two candidates never touch the same lines.
   - `current_action` becomes the **primary lane's** pointer only.
   - A secondary lane resolves its Action from its claim, which is what `concurrent-session-action-claims` already specifies.
2. **Semantic code conflicts.** Only Actions that declare disjoint `touches:` path globs may share a repository. The admission rule is: a lane is free only if no live candidate's globs intersect. This is the "low-blast-radius" condition in 0066 made checkable. An Action without globs defaults to the whole repository, which gives the current behavior.
3. **Shared worktree state.** Bridged `node_modules` and workspace-state files are shared across worktrees (see CLAUDE.md). A secondary lane needs its own install, or a read-only bridge, before it can be admitted.

At that point, "lane" means repository plus path scope. The rest of the
admission loop does not change. The pending Ask's `--plan` targeting becomes
one way to request a secondary lane, not a separate lease type.

### More than one installation

Decision 0022 rules out a shared coordinator, so this design does not scale out
by making installations talk to each other. It scales out by **partitioning**.
Each Project is owned by exactly one installation for managed production, and
that ownership is declared in a committed record. Two installations never admit
work in the same repository, so no live mutual exclusion is needed.

A stale owner is cleared by a commit, not a timeout. This is option B in its
cheapest form, and it stays behind 0022's own trigger: two operators report lost
work.

## 4. Sequence (the 20% first)

| Step | What | Gated by | Size |
| --- | --- | --- | --- |
| 1 | **Wait reasons and a fake-executor soak.** Add `production status --explain` so every in-scope Action shows its single wait reason. Add a deterministic `fixture` coding-agent provider that sleeps, edits one file and exits, so reviewers can push `maxConcurrentSessions` to 20 across fixture repositories at zero token cost and watch every limit engage. | None. It is read-only plus a test provider. | S–M |
| 2 | **Lease liveness.** The lease gets a heartbeat through tmux pane liveness and provider-session pointer freshness. A Session proven dead releases on the next tick instead of waiting for manual reconcile. This closes the #549 class for leases as well as claims. | Part of 0066's trigger | M |
| 3 | **Provider-account slots.** Add `providerSlots` per account to the production scope. The limit is checked in the same transaction as the lease and claim. | None. Cross-repository only. | S |
| 4 | **Integration backpressure.** Add a per-Project limit on unlanded candidates, enforced at admission. | None | S |
| 5 | **Raise the default across repositories.** Activation previews the host and provider slots it would grant. Raising the limit stays an explicit operator choice in the activation receipt. | The step 1 soak is green **and** step 4's backlog limit is active. Activation refuses a limit above 1 without it. | S |
| 6 | **Same-repository secondary lanes.** Add per-Action settlement records, `touches:` disjointness and isolated dependencies. | **Decision 0066's trigger**, then a new Decision | L |
| 7 | **Multi-installation ownership records.** | Decision 0022's trigger | M |

Steps 1–5 all fit inside the Decisions already ratified:

- Cross-repository concurrency was admitted in principle by 0012 and contract 17.
- It already exists in code behind `maxConcurrentSessions`.
- 0066 covers only same-repository concurrency.

Step 6 is the only step that needs new authority.

### What this does not build

- A distributed scheduler or a hosted coordinator. 0022 rejects both.
- A derived pointer. 0023 rejects it.
- Fairness weighting or aging across Projects. `production-scheduling.md` says these are not built until a need is observed, and strict priority plus lane constraints already spread work across repositories.
- Automatic spending to fill slots. `provider-capacity-harvesting` rules that out.

## 5. On the pending Ask

`enable-parallel-plan-dispatch-per-repository` should stay unsettled until 0066's
trigger fires. When it does fire, settle it using this document's step 6 as
the recommended option: a lane is repository plus path scope, and admission is
by claim. That is better than a per-Plan lease, because two Plans can touch the
same files and two Actions in one Plan often do not.
