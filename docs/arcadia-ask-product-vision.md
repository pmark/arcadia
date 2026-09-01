# Arcadia Ask: Ask and You Shall Receive

## Product thesis

Arcadia Ask is the intent interface for Arcadia.

The operator should be able to say what they want to become true with extremely
little ceremony. Arcadia should preserve that expression, work out which
Project and Arcadia structures can carry it forward, make its interpretation,
risks, and proposed effects legible, obtain the authority the operator actually
understands and intends to grant, and then turn that authority into observable
progress.

The operator should not need to manually author a proposal, Outcome, Milestone,
Action, Artifact, Decision, or CLI sequence before Arcadia can help. Choosing
and proposing the right structure is part of Arcadia's work.

Planning and Project management should not require the operator to create or
coordinate a coding worktree, implementation branch, or pull request. A PM-only
Ask should produce governed records without pretending implementation has
begun. When checked-in managed documents require a Git transition, Arcadia owns
the exact preview and governed persistence path; the operator supplies judgment
and authority rather than hand-authoring files or managing delivery ceremony.

The promise is:

> Ask for what should become true. Arcadia determines the project-management
> machinery, secures informed authority, and makes it so—with the entire
> transformation visible and traceable.

"Ask and you shall receive" is not a promise of unconstrained autonomous
execution. It is a promise that the operator can express their will naturally,
understand the relevant implications and known risks, approve enough for
Arcadia to act, and rely on Arcadia to carry that intent through its existing
foundations without dropping the thread.

## The experience

### One request begins a visible working session

When an input reaches Arcadia and appears in Ingress, the operator can open it
and watch Arcadia work in real time. The session exposes:

- the immutable original input and its provenance;
- current state and every state transition;
- deterministic extraction and routing evidence;
- model and processing-profile choices;
- the shared interpretation Arcadia is forming;
- proposed Outcomes, Milestones, Actions, Artifacts, Decisions, Logs, and
  activation conditions;
- Artifacts as they are produced;
- logs, validation evidence, approval gates, and side effects; and
- a trace from the original request to every resulting record and effect.

Ingress is therefore not merely an inbox. It is the live, corrigible provenance
record of what Arcadia heard, how it interpreted the request, what it proposed,
what the operator authorized, and what actually happened.

### Arcadia chooses the least costly sufficient intelligence

If an Ingress item resembles a prompt, request, idea, or project-management
concern, Arcadia determines what kind of interpretation it needs and which
configured model, if any, is sufficient.

Validated, safe raw input should first yield an explicit working
representation. A local-preferred model may help propose:

- a concise summary and probable intent;
- the likely Project, Outcome, or other destination;
- possible Milestones, Actions, Artifacts, Decisions, or Log entries;
- ambiguity, missing information, confidence, and risk;
- authority and approval boundaries; and
- whether deterministic processing is enough or a stronger model would add
  material value.

This representation gives Arcadia and the operator something inspectable to
correct and approve. It also supplies bounded context for routing, planning,
retrieval, prioritization, and safe execution. Model-derived suggestions remain
labelled and never replace the original capture or deterministic facts.

### Project assignment needs almost no syntax

A recognizable Project name at the beginning of a request should normally be
enough signaling:

> Arcadia: make every Ingress item open into a live execution trace.

Explicit routing wins over inferred routing. Arcadia preserves the original
wording, shows why it chose the destination, and asks only when an answer would
materially change routing, safety, or committed records.

### The operator asks for progress, not schema

Arcadia Ask accepts anything vaguely shaped like a contribution to Project
progress or success. Arcadia translates it into the smallest useful Arcadia Way
structure, such as:

- a proposed Outcome or Milestone;
- one or more executable Actions;
- a Decision requiring operator judgment;
- a plan or plan amendment;
- a research, proof, or implementation Artifact;
- a clarification question;
- a deferral with an observable reactivation trigger; or
- safely authorized execution.

The operator may correct that structure before it becomes durable truth. They
should not have to know which structure is appropriate in advance.

## The authority contract

Arcadia's leverage comes from building on foundations it already has: immutable
capture, canonical Project semantics, managed documents, deterministic routing,
least-cost Intelligence, explicit Decisions, approval boundaries, executable
Actions, proof Artifacts, validation, and durable Logs.

The Ask loop uses those foundations in order:

1. Preserve the operator's original expression of intent.
2. Interpret it using deterministic evidence and the least costly sufficient
   Intelligence.
3. Show the interpretation, uncertainty, proposed structures, risks, and
   effects in a corrigible working session.
4. Ask at most the questions that materially affect what may safely happen.
5. Present the exact commit or execution boundary.
6. Act only within the authority the operator granted with sufficient
   understanding.
7. Produce and validate the resulting Artifacts and effects.
8. Trace every result back to the request and report what remains next,
   deferred, refused, or blocked.

At every point, the operator can answer:

- What did Arcadia hear?
- Why did it choose this Project, structure, processor, or model?
- What is happening now?
- What will Arcadia create, change, defer, skip, or refuse?
- What authority is required, and what will granting it cause?
- What evidence proves the result?
- What is the next Action?

## Product test

Arcadia Ask succeeds when the operator can naturally express a desired change,
recognize and correct Arcadia's understanding, knowingly authorize the relevant
effects, and then watch that intent become governed, evidenced Project progress
without manually translating it into Arcadia's internal machinery.

This thesis is realized incrementally by
[`docs/plans/arcadia-ask-active-sessions.md`](plans/arcadia-ask-active-sessions.md).
That plan's Actions are implementation slices of this promise; this document is
the durable product lens by which the complete feature should be judged.

## Spare capacity as a planning resource

Arcadia may use otherwise-expiring included model allowance as a scheduling
signal for safe Back Burner work. It must distinguish included allowance,
banked resets, purchased credits, and API spend; unknown capacity is never
represented as free capacity, and a scheduling opportunity never grants new
execution or spending authority.

The provider-capacity design, modular estimates, dependency graph, critical-
usage reporting, and reset boundary are captured in
[`docs/plans/provider-capacity-harvesting.md`](plans/provider-capacity-harvesting.md).
