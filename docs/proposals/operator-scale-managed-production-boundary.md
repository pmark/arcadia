---
arcadia: v1
type: proposal
project: arcadia
question: What is Arcadia for, what should its 80/20 Managed Production capability own, and how should it allocate constrained coding-agent capacity across many projects without becoming a large-scale agent orchestration platform?
---

# Operator-scale Managed Production boundary

## Recommendation

Define Arcadia as **mission control for a constrained operator portfolio**.

Its dependable promise is not maximum agent concurrency. It is that a busy
operator can maintain many Projects, approve bounded Plans, and let Arcadia keep
valuable work moving with the AI capacity they already have—while preserving
attention for the decisions only a human should make.

Arcadia should optimize for **continuity under constrained capacity**, not for
hundreds of simultaneous agents.

That makes the first-class target user someone like:

- an independent software maker managing several products;
- a professional with a full-time job building serious side projects;
- a consultant or small studio maintaining many client repositories;
- a creative technologist whose work spans software, content, fabrication or
  other artifact-producing projects;
- a small team whose bottleneck is operator attention and limited paid AI
  capacity rather than a shortage of parallel compute.

This target includes Arcadia's current operator and naturally covers a future
Private Practice Now portfolio with many independently deployed client sites.

## What Arcadia is

Arcadia is the control plane above execution systems.

It answers:

1. What exists?
2. What matters now?
3. What artifact or action should happen next?
4. What can progress safely without the operator?
5. What requires human judgment or authority?

For software work, Arcadia turns an approved Plan into governed progress. It
selects eligible work, admits execution under explicit authority, prepares a
safe candidate, launches an appropriate coding system, observes the result,
collects proof, preserves recoverable work, and advances or stops based on
current evidence.

Codex, Claude Code, Cursor Projects and future coding systems are executors.
Arcadia remains responsible for portfolio state, priority, authority, attention,
acceptance and durable evidence.

## What Arcadia is not

Arcadia is not intended to become:

- a general-purpose agent framework;
- a replacement IDE;
- a distributed build farm;
- a swarm scheduler optimized for hundreds of concurrent agents;
- a long-term semantic code-indexing platform;
- a generalized multi-agent collaboration protocol;
- an autonomous software factory that merges, deploys, publishes or spends
  without separately granted authority;
- a system that assumes unlimited model tokens or paid API capacity.

If a specialized coding platform becomes better at decomposition, agent
collaboration, worktree management, code search or parallel execution, Arcadia
should integrate it rather than reproduce it.

## The scarce resource is operator attention

Arcadia's product advantage is strongest when the operator has more worthwhile
work than attention.

A portfolio may contain many Projects and many ready Actions even when only one
coding session can run economically at a time. Arcadia should make that
constraint useful rather than treating it as a deficiency.

The system should continuously answer:

- Which ready Action produces the most useful progress now?
- Which higher-priority Actions are blocked, and why?
- Which work can advance mechanically?
- Which item genuinely requires the operator?
- What should consume the next available coding-agent slot?

A $20 or $40 monthly coding-agent budget may exhaust before the operator's
portfolio does. Managed Production therefore needs admission, sequencing,
continuation and waiting behavior at least as much as it needs concurrency.

Arcadia should prefer the cheapest safe executor and preserve idle time rather
than inventing work merely to consume capacity.

## 80/20 Managed Production

The minimum useful promise is:

> Given an approved, bounded software Plan, Arcadia keeps advancing its governed
> Actions through as many coding-agent sessions as necessary, without the
> operator manually relaying prompts or preparing Git state, until the work is
> complete, blocked, unsafe, capacity-limited, or genuinely requires human
> judgment or authority.

The core loop is:

1. choose the highest-priority eligible governed Action;
2. confirm current authority, provider capacity and repository availability;
3. prepare or resume its candidate workspace;
4. launch one bounded coding-agent session;
5. observe terminal or needs-input state;
6. run deterministic validation and gather evidence;
7. preserve recoverable candidate state;
8. continue the same Action, accept it, retry a known mechanical failure, or
   stop with one actionable operator item;
9. after accepted integration, advance to the next governed Action.

The durable unit is the Action and its candidate. A coding-agent session is a
temporary worker.

## Sequential by default

Arcadia should make **one useful execution at a time** the baseline, because
that is sufficient for the target operator and is easiest to reason about,
verify and afford.

Sequential execution is not a product limitation when Arcadia can:

- maintain a large ready queue across Projects;
- resume work without human relay;
- wait for provider capacity and continue automatically;
- move to unrelated eligible work when one Project is blocked;
- preserve exact state between sessions;
- surface only consequential operator decisions.

This lets one modest subscription make steady progress across many Projects over
hours, days and weeks.

## Concurrency is a capacity decision, not an identity

Arcadia should support concurrency only where it creates measurable value.

The baseline rules are:

- one live writer per candidate workspace;
- one active candidate per repository by default;
- sequential sessions may reuse the same candidate when the same Action remains
  incomplete and the previous Session is proven terminal;
- independent repositories may run concurrently when configured provider and
  host capacity permit;
- multiple concurrent candidates in one repository are deferred until a real
  workload demonstrates the need and repository isolation is proven reliable.

Concurrency is therefore bounded by three independent constraints:

1. **authority** — is this work approved to run?
2. **isolation** — can it run without conflicting with another candidate?
3. **capacity** — is an eligible execution slot actually available and within
   cost policy?

Arcadia should never create parallel work merely because a provider can run it.

## Candidate and worktree model

Bind worktrees to **active candidates**, not to individual coding-agent
sessions.

A candidate represents the in-progress implementation of one governed Action.
Its lifecycle is:

`prepare -> ready -> running -> resumable -> accepted/abandoned -> retired`

A Session obtains an exclusive live lease on that candidate while it runs.
After terminal exit:

- if the Action remains incomplete and the candidate is trustworthy, another
  Session may continue in the same worktree;
- if the Action is accepted and integrated, the next Action receives a fresh
  candidate from the current governed base;
- if the candidate cannot be reconciled safely, Arcadia preserves what it can
  and surfaces one explicit blocker rather than asking the operator to perform
  ad-hoc Git surgery.

This keeps worktree count tied to actual concurrent work rather than to historical
Session count.

The host owns Git, branch, worktree, preservation, integration and cleanup
lifecycle. Coding agents edit and validate inside the prepared workspace.

## Portfolio-scale client work

Arcadia should work particularly well for portfolios such as Private Practice
Now.

If twenty client sites each live in separate repositories, Arcadia can maintain
change requests and approved Plans across all twenty while only consuming one or
a few coding-agent slots.

For example:

- Client A requests a bio change that is deterministic and ready.
- Client B has an approved accessibility fix needing Codex.
- Client C is blocked on logo approval.
- Client D has a dependency update ready for validation.
- Client E has a redesign request that still needs product judgment.

Arcadia can sequence A, B and D as capacity permits, leave C visibly blocked,
and surface E as a Needs operator item. The operator does not need to remember
which repository, branch, prompt or agent session should come next.

That portfolio leverage is more important to Arcadia than maximizing throughput
inside one repository.

## Operator attention contract

Managed Production should interrupt the operator only when one of these is true:

- a consequential choice has more than one valid outcome;
- required authority is missing;
- credentials or private information are needed;
- product taste or subjective acceptance is required;
- destructive or irreversible recovery is necessary;
- evidence is contradictory or cannot establish completion;
- approved scope must expand materially;
- all eligible execution is blocked by capacity or dependencies and operator
  action could change that state.

Routine continuation, retry, validation, preservation, worktree preparation,
provider waiting and known mechanical recovery should not require operator
attention.

Every Needs operator item should state:

- what is blocked;
- why Arcadia cannot decide safely;
- the evidence that matters;
- the recommended choice;
- the consequence of each meaningful option;
- what work will resume after the Decision.

## Cost and capacity posture

Arcadia should assume AI execution is scarce.

Its admission policy should prefer, in order:

1. existing deterministic tooling;
2. repository scripts and CLIs;
3. local deterministic execution;
4. suitable local models;
5. included-capacity coding agents or frontier models;
6. explicitly authorized paid usage.

No managed-production loop should silently switch to paid overages merely to
stay busy.

Capacity exhaustion is an ordinary waiting state, not a failure. Arcadia should
preserve the current candidate, record when capacity may become available, and
resume or choose another eligible executor when fresh evidence permits.

## Limits of the 80/20 product

The first reliable version does not promise:

- arbitrary parallelism;
- automatic conflict resolution between concurrent candidates;
- cross-repository distributed transactions;
- unlimited unattended repair loops;
- autonomous architectural or product decisions outside the approved Plan;
- provider-specific swarm optimization;
- automatic merge/deploy/release authority;
- enterprise RBAC, organization-wide policy or multi-operator scheduling.

Those are separate products or later triggered increments.

## Definition of done

The 80/20 Managed Production capability is real when one operator can:

1. maintain multiple Projects with competing ready and blocked Actions;
2. activate one approved Plan without manually launching each implementation
   Session;
3. let Arcadia prepare a candidate and launch the selected coding agent;
4. allow one Action to continue through at least two sequential Sessions using
   the same candidate without manual Git/worktree preparation;
5. validate and preserve the candidate through trusted host-controlled paths;
6. accept/integrate the Action and create a fresh candidate for the next Action;
7. wait cleanly when provider capacity is exhausted and resume when eligible;
8. progress an unrelated Project when the current one is blocked and capacity
   exists;
9. refuse a conflicting concurrent writer;
10. stop on an injected genuine judgment case with one concise Needs operator
    item;
11. recover from an interrupted Session or lost launch response without creating
    duplicate conflicting work;
12. complete the whole demonstration without the operator manually creating a
    branch, worktree, commit, stash, rebase, cleanup step or relay prompt.

## Product statement

A concise product definition follows:

> **Arcadia is local-first mission control for people with more worthwhile work
> than attention. It coordinates a portfolio of Projects, allocates constrained
> human and AI capacity to the next useful work, keeps approved production moving
> safely, and asks the operator only for decisions that genuinely require them.**

The resulting strategic boundary is equally concise:

> **Arcadia governs work and attention. Specialized execution systems perform
> the work. Concurrency is used when valuable, not pursued as a product goal.**

## Relationship to existing Arcadia documents

This proposal refines rather than replaces:

- `docs/arcadia-development-orchestration-vision.md`;
- `docs/plans/mission-control-view/17-managed-production-contract.md`;
- `docs/plans/bootstrap-managed-production-to-build-flight-deck.md`;
- `docs/proposals/host-owned-agent-workspace-contract.md`;
- `docs/working-copy-safety.md`.

If accepted, the durable product definition and concurrency invariants should be
propagated into the canonical vision/orientation documents and the active
Managed Production acceptance criteria, without expanding the current bootstrap
scope beyond what is required to prove the 80/20 loop.
