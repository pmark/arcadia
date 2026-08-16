---
arcadia: v1
type: decision
id: "0020"
slug: compounding-agent-production-principles
project: arcadia
status: open
question: Which durable principles and operating practices should Arcadia adopt so coding-agent work compounds into faster, safer, more values-aligned production without turning the Constitution into an implementation manual?
gap_type: missing-decision
recommendation: Adopt a constitutional admission test, then apply one exact replacement of `CONSTITUTION.md` that groups its statements by kind, promotes the approval boundary it is currently missing, absorbs five durable invariants, and folds or relocates five product specifics — net 15 bullets to 13. Everything else in this Decision is Arcadia Way practice, adopted on approval and revisable without constitutional change.
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
- Let operating practice evolve from evidence without continually enlarging
  the Constitution.

## Context

The current Constitution already establishes the essential direction:
deterministic progress, usefulness under severe time pressure, 80/20
sequencing, triggered deferral, direct usable output, and token economy. The
execution policy adds capability, independence, and least-cost selection.
Decisions 0012 through 0014 propose thin Session linkage, operator briefings,
and durable tappable questions. Decision 0019 and the Arcadia-led development
vision bind QA to exact Candidates and put deterministic readiness before
independent model judgment.

Two recent QA increments provide concrete evidence. The first real Arcadia QA
Run exposed repeatable trust failures; the next increment converted them into
readiness checks, isolated test state, and one-pass instructions. That is the
kind of learning loop Arcadia should make normal. The same work also showed
the danger of promoting implementation details too early: agent model
selection, Session persistence, Discord delivery, and proof manifests each
have unresolved or explicitly deferred mechanics.

Three further observations shaped this revision.

**The Constitution was not reliably presented at dispatch.** Before the
dispatch change carried by this pull request, no dispatch code read
`CONSTITUTION.md`; an agent saw it only by following a prose reference or
opening it deliberately. The new brief surfaces it verbatim but does not lint
or enforce compliance. Once surfaced, every line becomes context-window cost
paid on every dispatched Action. That is the strongest available argument for
brevity, and it means growth is a real cost rather than a stylistic preference.

**The Constitution is missing its most important rule.** Approval boundaries —
the constraint that outranks everything else in practice — already appear in
agent guidance, operator context, generated agent packets, plans, and audits,
but not in `CONSTITUTION.md`. A Constitution that omits the hard stop while
specifying which queues exist has its priorities inverted.

**The Constitution mixes four kinds of statement without saying so.** Purpose,
authority, truth, and economy are interleaved as flat bullets, which is why
product specifics like the queue names were able to settle there unnoticed.

The missing piece is not another subsystem. It is a small set of durable rules,
grouped by kind, that make the existing mechanisms reinforce one another.

## Decision proposed

### 1. Adopt a constitutional admission test

A rule belongs in the Constitution only when it is:

1. durable across Projects, providers, interfaces, and current architecture;
2. supported by two observed incidents, one high-severity trust failure, or an
   approval boundary that already binds in practice;
3. enforceable through evidence, review, or an explicit approval boundary; and
4. shorter and more stable than the operating mechanism that currently
   implements it.

Other guidance begins in the Arcadia Way. A mechanism may be promoted after
dogfooding proves the invariant; it must not be constitutionalized merely
because one implementation presently depends on it.

The reverse also holds, and is the harder discipline: a line already in the
Constitution that fails this test should be relocated to the document that
actually owns it, not left in place because removing it feels risky.

### 2. Apply this exact replacement of `CONSTITUTION.md`

If this Decision is approved, replace the file's body with the following. This
is a replacement, not an addition: net 15 bullets to 13.

> ```markdown
> # Arcadia Constitution
>
> ## Purpose
>
> - Arcadia manages ongoing creative and software work with minimal cognitive
>   overhead, and must stay useful when the operator has almost no time.
> - Arcadia optimizes for deterministic progress, not cleverness.
>
> ## Authority
>
> - Approval boundaries are hard stops. Do not merge, deploy, publish, delete,
>   spend, use credentials, access production, or send messages without an
>   explicit Decision. Capability never grants authority.
> - Reversibility earns autonomy. Previewable, idempotent, recoverable work may
>   advance farther on its own; the boundaries above do not move.
> - Operator attention is a budget. Interrupt only when human judgment or
>   authority can change what may safely happen next.
>
> ## Truth
>
> - Checked-in managed documentation is authoritative for governed work. Each
>   other fact has one authoritative home; every other surface is a projection,
>   never a competing truth store.
> - Completion is a proven state, not a claim. The required Artifact and its
>   acceptance evidence must agree with the work actually produced.
>
> ## Economy
>
> - Spend in ascending order: deterministic scripts, then local models, then
>   frontier models, then the operator.
> - Deterministic compute and model inference are separate budgets; every
>   managed plan states its relative token impact and how model use is bounded.
> - Find the 20% that carries the 80%, do that first, and avoid over-engineering.
> - If not now, then when? A deferral must name the condition that revives it.
> - Make it real: shape work into the most direct honest form a person or system
>   can use, without crossing an approval boundary.
> - Every preventable failure leaves leverage. Convert repeated or serious
>   friction into a test, guard, orientation note, or triggered Action.
> ```

The redline intentionally says nothing about a particular model, agent
provider, queue, database table, notification service, or UI.

### 2a. What this replacement removes, and where each removal lands

Approval of this Decision authorizes these relocations in the same change. A
removal without a landing place is data loss, not streamlining.

| Removed line | Disposition |
| --- | --- |
| "maintains Inbox, Work Queue, and Requires Review queues" | Removed from the Constitution. The full queue is already defined in `src/domain/constants.ts` and documented in `README.md`; add a concise operator-facing explanation to `START_HERE.md` in the same change because the canonical daily guide does not currently explain it. |
| "distinguishes Autonomous, Codex, Requires Review, and Blocked work" | Removed, no migration needed. Already canonical in `docs/arcadia-semantics.md` and enforced as `responsibility` in `src/docs/parse.ts`. |
| "SQLite is the operational source of truth" / "Markdown stores narrative artifacts" / "Git preserves history" | Generalized into the one-authoritative-home line. The mapping already appears in `README.md`, `docs/arcadia-protocol.md`, and historical reports; add it to `docs/AGENT_ORIENTATION.md` in the same change so the canonical cold-start architecture guide owns the concrete rule. |
| "Use local scripts before AI" / "Use local AI before frontier models" | Folded into the ascending-order spend line, which adds the operator as the final and most expensive tier. |
| "Avoid over-engineering" | Folded into the 80/20 line. |

### 2b. Invariants considered and not adopted

- **"Evidence precedes judgment."** Durable and well-evidenced, but it is the
  ascending-order spend line stated twice. Adopted by merger, not as its own
  bullet.
- **"Optimize Actions for Mission, intended human Outcome, and stated values;
  surface material value conflicts or possible harms as Decisions."**
  Withdrawn from the redline. No observed incident supports it, it has no
  enforcement path, and its practical effect on a coding agent is to license
  editorializing on ordinary work. Values belong with each Project's Mission
  and Outcome, or in the triggered purpose Artifact when task-level acceptance
  is insufficient. `OPERATOR_CONTEXT.md` owns stable operator-wide preferences,
  not Project-specific values. Reactivation trigger below.

## Arcadia Way practice adopted on approval

These are operating practice, not constitutional text. They may be revised
from evidence without a further constitutional Decision, and none of them
changes what a coding agent is authorized to do.

**Attention and interruption contract.** An operator interruption states the
current Milestone and why attention is needed now, the exact Candidate or state
under consideration, the smallest relevant evidence set, the recommended
Decision, each option's immediate consequence, and the default or blocking
result if the operator does nothing. Batch non-urgent attention. Interrupt
immediately only for an expiring opportunity, a safety or authority boundary,
irreversible risk, or ambiguity that prevents honest progress. This is a
presentation contract over governed state, not a new queue or truth store;
Decision 0014 remains the schema Decision for tappable options.

**Thin receipt for delegated work.** Every Arcadia-dispatched unit of
coding-agent work eventually leaves a receipt identifying the Project, Action,
agent, execution profile, branch, worktree, and prepared time; the agent's own
stable session pointer when one exists; the terminal status and exact Candidate
produced; and the resulting Artifacts, Decisions, Log entry, and pull request.
Arcadia stores linkage and outcomes, never mirrored transcripts. Decision 0012
remains the authority for whether this is the proposed Session primitive.

**Claims point to proof.** For a material Candidate, QA maps each acceptance
claim to deterministic evidence, an operator procedure with an observable
result, independent judgment, or an explicit statement that the claim was not
verified. No universal manifest is required; Decision 0019's existing trigger
governs implementation.

**Mutable resources declared before parallel work.** Parallel agent work is
permitted only when its mutable resources are isolated or intentionally
serialized — branches, worktrees, workspace markers, databases, ports,
credentials, deployment targets, and generated files that may be shared even
when source branches are separate. One sentence in an Action or dispatch
receipt suffices. Common resources proven safe by tests may be omitted later.

**Leverage proposals, capped.** When friction repeats twice, or one
high-severity trust failure occurs, a coding agent may propose **at most one
consolidated Artifact per Action**. It may cover multiple qualifying failures,
but must identify the vital few: the observed friction and evidence, the
smallest deterministic guard, script, skill, fixture, or orientation
improvement that would prevent recurrence, the expected recurring saving, and
the observable trigger for doing it. The cap is the point: an uncapped proposal
obligation turns every session into a backlog generator, which is the
tail-gold-plating `AGENTS.md` forbids. The proposal does not preempt the current
Outcome, grant implementation authority, or excuse the current Candidate from
validation. If the improvement is tiny, directly in scope, and required by
acceptance criteria, it may ship with the current Action; otherwise it is
captured as a triggered Action.

## 80/20 adoption sequence

### Do first after approval

1. Apply the exact replacement in §2, together with the three relocations in
   §2a, as one change.
2. Add the interruption contract and the capped failure-to-leverage threshold
   to the agent continuation guidance.
3. When Decision 0012 is resolved, dogfood one thin delegated-work receipt
   before building queueing, transcript views, or orchestration analytics.

### Keep triggered

| Increment | Reactivate when |
| --- | --- |
| Mission-and-values constitutional line | An Action reveals a material value conflict or human-impact harm not legibly governed by its Project Mission, Outcome, or purpose Artifact, or a second such near-miss is recorded. |
| Purpose Artifact template or UI | The next Project approaches its first public release or an Action presents material human-impact risk. |
| Structured claim-to-proof Artifact | Decision 0019's existing second-unsubstantiated-Candidate trigger fires. |
| Cross-Project capability extraction | The same successful script, skill, or guard is independently useful in two Projects. |
| Multi-agent deliberation | Two agents reach materially different conclusions on the same governed Artifact and deterministic evidence cannot resolve the disagreement. |
| Session analytics or duration estimates | Thin receipts exist for enough real dispatches that the result would change selection or planning. |
| Automated constitutional linting | Two accepted rules are violated in ways a deterministic repository check could have prevented. |

Triggers reopen planning; none grant merge, deployment, messaging, spending,
credentials, production access, or other consequential authority.

## Consequences

- The Constitution gets shorter while gaining the approval boundary it was
  missing, and its four kinds of statement become visible.
- Three product specifics move to the documents that own them, which means the
  relocations in §2a are load-bearing work, not cleanup.
- Agent and operator attention are spent after deterministic evidence has done
  the cheap work.
- Repeated failure can improve every later Project instead of remaining local
  session knowledge.
- Session receipts, once separately approved, can power portfolio timelines,
  Arcadia Now, notifications, recovery, and throughput views without storing
  transcripts.
- The admission test creates a pressure-release valve in both directions:
  practices can be tried without constitutional churn, and stale constitutional
  lines have a defined exit.

## What this Decision does not authorize

- It does not edit `CONSTITUTION.md`; approval of this Decision is the gate for
  the exact replacement in §2 and the relocations in §2a.
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

Approve this Decision only if each line of the §2 replacement remains useful
when the current model vendors, UI surfaces, and persistence mechanisms are
replaced, and only if each removal in §2a has a landing place you accept. Move
any line that fails the first test into the Arcadia Way practice section.
Reject any operating increment whose trigger cannot visibly fire.

## Revision history

The first draft of this Decision proposed adding seven bullets to
`CONSTITUTION.md` without otherwise restructuring it, and bundled six
independently-approvable operating amendments as numbered sub-decisions.

Cross-agent review (Claude, 2026-08-15) found that the draft failed its own
admission test: five of seven proposed bullets cited no observed incident,
several were longer than any existing constitutional line, and adding without
replacing grew the file from 15 bullets to 22 — 47% growth in a proposal whose
thesis was restraint. The review also found that the approval boundary, the
constraint that binds hardest in practice, was absent from the Constitution
altogether and from the draft's redline.

This revision narrows the redline to an exact replacement, promotes the
approval boundary, withdraws the values bullet to a trigger, adds the removal
ledger in §2a, caps leverage proposals, and demotes the remaining amendments to
practice so the Decision can be approved or rejected in one act. The
alternative — a competing Decision 0021 — was considered and rejected: two
proposals on one subject would have doubled the operator attention required to
settle it, which is the cost this Decision exists to reduce.

### Codex falsification review of the Claude revision

Codex reviewed Claude's `adbdd03` revision against the current Constitution,
`AGENTS.md`, the semantic contract, the parser, Decisions 0012 through 0014 and
0019, repository reports, and the Mission Log. The review did not approve or
reject this Decision; it tested the six claims that produced the revision.

1. **Original draft failed its own admission test — disagree with the evidence
   count; agree with the resulting redline.** Evidence-before-judgment and
   completion-is-proven are supported by Decision 0019 and the PR-QA failures.
   The repository also records two distinct operator-attention incidents:
   Decision 0013's six-PR manual briefing and Decision 0014's disappearing
   questions. Failure-leaves-leverage is supported independently by the
   compute-ready-set dogfood defect and by five successive PR-QA Candidates
   turning fail-open paths into guards. One-authoritative-home is supported by
   contradictory duplicate check evidence and the repository-local workspace
   marker contaminating a supposedly isolated test. Reversibility does not
   have two comparable failure incidents, but its capability-never-authority
   half is an approval boundary that qualifies under the revised admission
   test, and `arcadia go` supplies one concrete preview-and-recovery incident.
   The mission-and-values line alone lacks an observed incident and an
   enforcement path. No supported line needs restoration because the exact
   replacement already retains or folds every supported invariant; only the
   unevidenced values line remains triggered.

2. **Approval boundaries belong in the Constitution — agree.** The current
   Constitution omits them. The exact boundary already appears in
   `OPERATOR_CONTEXT.md`, `CLAUDE.md`, generated agent packets, plans, and
   audits; `AGENTS.md` subordinates optimization to it. Promotion creates
   intentional reinforcement, not conflict. `Decision` is the canonical
   approval concept under `docs/arcadia-semantics.md`, so the proposed wording
   is consistent with the existing `explicit approval` phrasing.

3. **The replacement loses nothing that matters — agree after factual ledger
   corrections.** The claim that queue vocabulary appeared in no other
   document was false: `src/domain/constants.ts` defines the four queues and
   `README.md` documents them. `START_HERE.md` still needs the concise model
   because it is the canonical daily guide. The Responsibility claim is
   correct: `docs/arcadia-semantics.md` names Autonomous, Codex, Requires
   Review, and Blocked, while `src/docs/parse.ts` validates the imported
   `WORK_CLASSIFICATIONS` enum. The SQLite/Markdown/Git mapping also survives
   in README, protocol, and reports, but belongs in `docs/AGENT_ORIENTATION.md`
   as the canonical cold-start explanation. Section 2a now states those facts.

4. **The ascending-order economy line preserves the two local-first lines —
   agree when read with Authority.** Deterministic scripts remain before local
   models, and local models remain before frontier models. Adding the operator
   last makes attention cost explicit without delaying an authority- or
   judgment-bound Decision, because the Authority section requires that
   interruption exactly when human input can change what may safely happen.

5. **Withdrawing mission-and-values to a trigger avoids a premature
   constitutional rule — agree after correcting ownership.** No repository
   incident yet proves the constitutional line, and a global instruction could
   invite agents to editorialize beyond an Action. The revision was wrong that
   `OPERATOR_CONTEXT.md` already owns Project values; it owns stable
   operator-wide preferences. Project-specific values belong with the Mission
   and Outcome or in the triggered purpose Artifact. The text and trigger now
   preserve that destination without constitutionalizing an unproved rule.

6. **One Decision is better stewardship than a competing 0021 — agree.** The
   revision history preserves provenance and the exact replacement gives the
   operator one coherent approval surface. A second Decision would add merge
   ordering, collision risk, and another comparison without preserving any
   authority or evidence that this document cannot preserve.

The demotion of operating mechanics to Arcadia Way practice does not weaken a
required commitment. Session shape remains gated by Decision 0012, durable
questions by Decision 0014, and structured proof by Decision 0019's trigger;
the remaining practices are reversible defaults. The leverage cap was too
tight only if read as suppressing multiple findings, so it now permits one
consolidated Artifact containing the vital few qualifying failures from an
Action. That matches the QA increments, where one process review converted
several related trust failures without creating a proposal queue of its own.
