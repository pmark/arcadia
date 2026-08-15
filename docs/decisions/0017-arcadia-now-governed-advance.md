---
arcadia: v1
type: decision
id: "0017"
slug: arcadia-now-governed-advance
project: arcadia
plan: portfolio-continuity-view
status: approved
question: How should Arcadia Now turn a trustworthy orientation briefing into a small dynamic menu that can advance governed work without hiding consequences or bypassing approval boundaries?
gap_type: missing-decision
recommendation: Build one deterministic Arcadia Now snapshot and a phone-friendly web view that usually offers one recommended, typed, revalidated transition with its prerequisites and consequences; mirror the summary to Discord and defer native Discord buttons until the same transition contract is proven.
confidence: high
decided: 2026-08-15
answer: "Arcadia Now is the operator's immediate orientation and action view, not a new Arcadia domain object or source of truth. It derives a concise briefing and dynamic options from current managed plans, Actions, Decisions, Runs, pull requests, and attention objects. When exactly one governed transition is eligible and recommended, the view presents one primary button. Every option names what it will do, what must already be true, what durable state or external system it will change, and what Arcadia expects to become next. Invocation re-reads and revalidates live state, calls only a typed allowlisted Arcadia operation, behaves idempotently, returns a durable receipt, and refreshes the briefing. A stale or newly unsafe option refuses legibly. Judgment, authorization, merge, deployment, spending, messaging, credential, and other approval boundaries retain their existing Decision or confirmation gates and are never smuggled behind a generic Advance button. Version one ships as a phone-friendly web view over a deterministic snapshot; Discord receives the same concise summary and a deep link. Native Discord buttons are deferred until the web transition contract has completed a live operator trial without ambiguity or manual repair."
updated: 2026-08-15
---

# Arcadia Now and governed advance

## Context

After Private Practice Now PR #39 exposed a one-character plan parsing defect,
the operator did not need another queue. He needed immediate orientation: what
changed, what the anomaly meant, what required him, what could wait, and the
one action that would restore momentum. Once #39 was reviewed and merged, the
next request was to make that experience available through Arcadia itself and
to let the common path advance with one clearly explained button.

Three existing proposals cover adjacent parts of the problem but deliberately
stop short of this capability:

- Decision 0013 proposes a read-only operator briefing over open work.
- Decision 0014 proposes durable selectable answers whose consequences are
  explicit, while answering records state rather than acting.
- Decision 0016 approves one portfolio continuity view over existing records.

Arcadia Now connects those ideas at the smallest useful seam. It is a view and
an invocation contract. It does not introduce another task model, priority
engine, workflow language, or persistence layer.

## Decision

### One deterministic briefing

`arcadia now` produces one typed snapshot from existing authoritative sources.
The operator-facing view answers, in order:

1. What materially changed?
2. What needs the operator now, and why?
3. What can safely wait?
4. What is the current Milestone and recommended next Action?
5. What will each available option do?

The deterministic snapshot selects and explains the next governed transition.
No recurring model call is required. Rich model narration may later decorate
the facts on explicit request, but it may not choose or authorize an option.

### One primary button when the state earns one

The desired steady state is one recommended primary option. Arcadia presents
that button only when live state yields exactly one eligible, recommended
transition. Zero options means the view explains the blocker or quiet state.
Multiple materially different options remain an explicit choice; Arcadia does
not collapse genuine judgment into an invented priority.

Each option carries:

- a stable type and target, never an arbitrary command string;
- a plain-language consequence and expected next state;
- prerequisites Arcadia can re-check;
- the authorization or confirmation boundary, if any; and
- whether the operation changes only Arcadia state or an external system.

### Revalidate, invoke, receipt, refresh

Clicking an option does not trust the rendered page. The server reloads current
state, confirms the option is still eligible, invokes one typed allowlisted
operation, and returns an outcome receipt. Repeated invocation must either
return the already-achieved outcome or refuse without compounding effects. The
view then refreshes from authoritative state.

Protected operations retain their existing gates. A generic **Advance** label
cannot conceal a merge, deployment, message, purchase, credential change, or
other action requiring separate approval. When operator judgment is the work,
the option records the corresponding answer or Decision first; a later
transition may advance work after that state exists.

## Pareto delivery order

1. Ship the deterministic snapshot and phone-friendly web view with one proven
   transition family.
2. Send the same summary to Discord with a deep link to the web view.
3. Add native Discord buttons only after the shared transition contract passes
   one live end-to-end operator trial without ambiguity or manual repair.

The web surface comes first because it can show context, prerequisites,
consequences, refusal details, and receipts without compressing the safety
contract into a chat component. Discord remains the notification queue and
fast entry point from the beginning.

## Consequences

- The operator gets a positive “what now?” control surface instead of having
  to reconstruct state while tired or under pressure.
- Routine state advancement can become one tap without converting Arcadia into
  an autonomous priority or execution engine.
- The same option contract can later serve the dashboard, Discord, and CLI;
  no surface becomes authoritative.
- Version one adds no arbitrary command runner, workflow DSL, second queue,
  model-selected action, native Discord interaction state, or automatic merge
  and deployment behavior.

## Revisit triggers

- A live trial repeatedly presents more than one equally valid option; Arcadia
  may need a recorded priority policy rather than a better button.
- A required transition cannot be represented by a typed allowlisted operation;
  extend the operation vocabulary from that concrete case instead of adding an
  escape hatch.
- The web transition contract completes a live operator trial without
  ambiguity or manual repair; native Discord buttons become eligible work.
- Deterministic facts repeatedly fail to provide enough orientation; evaluate
  explicit, bounded narration over the facts without giving the model authority
  to select or invoke transitions.
