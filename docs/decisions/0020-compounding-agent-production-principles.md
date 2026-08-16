---
arcadia: v1
type: decision
id: "0020"
slug: compounding-agent-production-principles
project: arcadia
status: open
question: Which durable principles and operating practices should Arcadia adopt so coding-agent work compounds into faster, safer, more values-aligned production without turning the Constitution into an implementation manual?
gap_type: missing-decision
recommendation: Keep the Constitution small and add only seven cross-project invariants covering attention, evidence, truthful completion, reversible autonomy, learning from failure, purpose traceability, and authoritative state; place Session receipts, interruption packets, proof maps, resource isolation, leverage proposals, and outcome feedback in the Arcadia Way with explicit activation triggers.
confidence: high
updated: 2026-08-15
---

# Compounding agent production principles

## Vision

Arcadia should help an independent developer turn values-driven intent into
useful outcomes quickly without requiring them to become the dispatcher,
bookkeeper, integration layer, and institutional memory for every coding
agent. Each completed Action should produce its intended Artifact and leave the
production system a little easier to trust and operate than it was before.

The desired compounding loop is:

```text
Intent -> governed Action -> Candidate -> evidence -> Outcome
   ^                                               |
   |                                               v
Reusable capability <- captured learning <- result in reality
```

Failures become guards. Proof becomes QA and release evidence. Delegated work
becomes the portfolio timeline. Successful methods become reusable skills.
Observed outcomes improve later prioritization. Arcadia remains the control
plane around agents, not another coding-agent transcript store.

## Goals

- Protect operator attention as deliberately as authority and model tokens.
- Advance work autonomously until human judgment or authority is genuinely
  necessary, then ask one durable question with legible consequences.
- Make completion depend on evidence about the exact work produced.
- Convert recurring friction into deterministic portfolio leverage.
- Preserve one authoritative home for each fact across Discord, Dashboard,
  CLI, agent, Git, managed documents, and workspace projections.
- Keep Actions traceable to the Mission, intended human Outcome, and stated
  values that make a Project worth doing.
- Let operating practice evolve from evidence without continually enlarging
  the Constitution.

## Context

The current Constitution already establishes the essential direction:
deterministic progress, usefulness under severe time pressure, 80/20
sequencing, triggered deferral, direct usable output, approval boundaries, and
token economy. The execution policy adds capability, independence, and
least-cost selection. Decisions 0012 through 0014 propose thin Session
linkage, operator briefings, and durable tappable questions. Decision 0019 and
the Arcadia-led development vision bind QA to exact Candidates and put
deterministic readiness before independent model judgment.

The missing piece is not another subsystem. It is a small set of durable rules
that make those mechanisms reinforce one another.

Two recent QA increments provide concrete evidence. The first real Arcadia QA
Run exposed repeatable trust failures; the next increment converted them into
readiness checks, isolated test state, and one-pass instructions. That is the
kind of learning loop Arcadia should make normal. The same work also showed
the danger of promoting implementation details too early: agent model
selection, Session persistence, Discord delivery, and proof manifests each
have unresolved or explicitly deferred mechanics. They belong in the Arcadia
Way until real use stabilizes them.

## Decision proposed

### 1. Keep a constitutional admission test

A rule belongs in the Constitution only when it is:

1. durable across Projects, providers, interfaces, and current architecture;
2. supported by two observed incidents or one high-severity trust failure;
3. enforceable through evidence, review, or an explicit approval boundary; and
4. shorter and more stable than the operating mechanism that currently
   implements it.

Other guidance begins in the Arcadia Way. A mechanism may be promoted after
dogfooding proves the invariant; it must not be constitutionalized merely
because one implementation presently depends on it.

### 2. Proposed constitutional redline

If this Decision is approved, add these seven bullets to `CONSTITUTION.md`
without otherwise restructuring it:

> - Operator attention is a first-class budget. Interrupt only when human
>   judgment or authority can change what may safely happen next.
> - Evidence precedes judgment. Run deterministic readiness and proof before
>   spending model inference or human attention.
> - Completion is a proven state, not an agent claim: the required Artifact
>   and acceptance evidence must agree with the work actually produced.
> - Reversibility earns autonomy; capability never grants authority.
>   Previewable, idempotent, recoverable work may advance farther
>   autonomously, but approval boundaries remain intact.
> - Every preventable failure leaves leverage. Convert repeated or serious
>   friction into a test, guard, orientation note, reusable tool, or triggered
>   Action so the operator does not have to remember the lesson.
> - Optimize Actions for their Project's Mission, intended human Outcome, and
>   stated values rather than task completion alone; surface material value
>   conflicts or possible harms as Decisions.
> - Each fact has one authoritative home. Discord, dashboards, CLIs, and
>   coding agents are projections or interaction surfaces, never competing
>   truth stores.

The redline intentionally says nothing about a particular model, agent
provider, queue, database table, notification service, or UI.

### 3. Add an attention and interruption contract to the Arcadia Way

An operator interruption must contain:

- the current Milestone and why attention is needed now;
- the exact Candidate or state under consideration;
- the smallest relevant evidence set;
- the recommended Decision;
- every offered option's immediate consequence; and
- the default, expiry, or blocking result if the operator does nothing.

Batch non-urgent attention. Interrupt immediately only for an expiring
opportunity, a safety or authority boundary, irreversible risk, or ambiguity
that prevents honest progress. The common path should expose one safe action
that advances state after its named preconditions are satisfied.

This is a presentation contract over governed state, not a separate queue or
truth store. Decision 0014 remains the schema Decision for tappable options.

### 4. Require a thin receipt for delegated work

Every Arcadia-dispatched unit of coding-agent work must eventually leave a
receipt that identifies:

- the Project, Action, agent, execution profile, branch, worktree, and prepared
  time;
- the agent's own stable session or task pointer when one exists;
- the terminal status and exact Candidate produced; and
- resulting Artifacts, Decisions, Log entry, and pull request.

Arcadia stores linkage and outcomes, not mirrored transcripts or speculative
progress. Decision 0012 remains the authority for whether this receipt is
implemented as the proposed Session primitive.

### 5. Make claims point to proof

For a material Candidate, QA should map each acceptance claim to one of:

- deterministic evidence;
- an operator procedure and observable result;
- independent judgment; or
- an explicit statement that the claim was not verified.

No universal manifest is required yet. Decision 0019's existing trigger still
governs implementation: reactivate a structured claim-to-proof Artifact when
a second real Candidate makes a material behavioral claim that green CI cannot
substantiate.

### 6. Declare mutable resources before parallel work

Parallel agent work is permitted only when its mutable resources are isolated
or intentionally serialized. Planning must account for branches, worktrees,
workspace markers, databases, ports, credentials, deployment targets, and
generated files that may be shared even when source branches are separate.

The declaration may be one sentence in an Action or dispatch receipt. It is
not a new top-level Arcadia concept. Common resources proven safe by tests may
be omitted from later declarations.

### 7. Let agents propose leverage without silently expanding scope

When friction repeats twice, or one high-severity trust failure occurs, a
coding agent may propose an **Artifact** containing:

- the observed friction and evidence;
- the smallest deterministic guard, script, skill, fixture, cache, index, or
  orientation improvement that would prevent recurrence;
- expected recurring savings or risk reduction; and
- the Action boundary or observable trigger for doing it.

The proposal does not preempt the current Outcome, grant implementation
authority, or excuse the current Candidate from validation. If the improvement
is tiny, directly in scope, and required by acceptance criteria, it may ship
with the current Action; otherwise Arcadia captures it as a triggered Action.

### 8. Add proportional outcome and purpose feedback

Before a Project's first public release, or before work with material human
impact, preserve a lightweight purpose Artifact stating:

- who should benefit;
- what change in reality is intended;
- non-negotiable values;
- unacceptable harms; and
- one observable signal that would show whether the Outcome is occurring.

Post-transition verification should record that signal when practical. This
is not a universal ethics bureaucracy and does not require a new schema type.
It is an Artifact used when shipping or consequential work makes task-level
acceptance insufficient.

## 80/20 adoption sequence

### Do first after approval

1. Apply only the seven-line constitutional redline.
2. Add the interruption contract and failure-to-leverage threshold to the
   agent continuation guidance.
3. When Decision 0012 is resolved, dogfood one thin delegated-work receipt
   before building queueing, transcript views, or orchestration analytics.

### Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Structured claim-to-proof Artifact | Decision 0019's existing second-unsubstantiated-Candidate trigger fires. |
| Purpose Artifact template or UI | The next Project approaches its first public release or an Action presents material human-impact risk. |
| Cross-Project capability extraction | The same successful script, skill, or guard is independently useful in two Projects. |
| Multi-agent deliberation | A C3 or C4 Action has a material unresolved disagreement after independent evidence review. |
| Session analytics or duration estimates | Thin receipts exist for enough real dispatches that the result would change selection or planning. |
| Automated constitutional linting | Two accepted rules are violated in ways a deterministic repository check could have prevented. |

Triggers reopen planning; none grant merge, deployment, messaging, spending,
credentials, production access, or other consequential authority.

## Consequences

- The Constitution gains seven stable behavioral invariants rather than a
  catalog of current product mechanisms.
- Agent and operator attention are spent after deterministic evidence has done
  the cheap work.
- Repeated failure can improve every later Project instead of remaining local
  session knowledge.
- Session receipts, once separately approved, can power portfolio timelines,
  Arcadia Now, notifications, recovery, and throughput views without storing
  transcripts.
- Claim-to-proof links can become QA plans, release evidence, and customer
  trust material as byproducts of the same work.
- Purpose feedback gives values-driven Projects a way to detect when shipping
  velocity is no longer producing the human result that justified the work.
- The admission test creates a pressure-release valve: useful practices can be
  tried and revised without constitutional churn.

## What this Decision does not authorize

- It does not edit `CONSTITUTION.md`; approval of this Decision is the gate for
  a separate exact redline.
- It does not approve Decisions 0012, 0013, or 0014 or choose their remaining
  implementation details.
- It does not create a Session schema, notification queue, transcript store,
  proof-manifest schema, purpose schema, workflow engine, or autonomous
  software factory.
- It does not broaden any coding agent's authority or permit consequential
  external actions.
- It does not displace the active demo-first Action. Constitutional follow-up
  remains separately schedulable work.

## Review test

Approve this Decision only if each proposed constitutional line remains useful
when the current model vendors, UI surfaces, and persistence mechanisms are
replaced. Move any line that fails that test into the Arcadia Way section
instead. Reject any operating increment whose trigger cannot visibly fire.
