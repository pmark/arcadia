---
arcadia: v1
type: decision
id: "0008"
slug: make-it-real-token-economy
project: arcadia
status: approved
question: How should Arcadia make output directly usable while keeping routine AI costs visible and bounded?
gap_type: missing-decision
recommendation: Add Make it real as a standing directive, distinguish deterministic compute from LLM inference, and require every managed plan to declare relative Token Impact and a plain-language Token Budget.
confidence: high
decided: 2026-08-01
answer: "Make it real is a standing Arcadia directive: shape each Action into the most direct honest form a person or system can use, without weakening approval gates. Every managed plan must declare token_impact as none, small, medium, large, or xlarge and provide a token_budget explaining what invokes a model, what remains deterministic, and how repeated model use is bounded. T-shirt impact is a planning signal, not an exact token or dollar forecast."
updated: 2026-08-01
---

# Make it real and preserve token economy

## Context

Arcadia already carries the Pareto Principle and “If not now, then when?” as
standing heuristics. They improve prioritization and deferral, but neither says
that an agent's output should land in the form the operator or downstream
system can actually use. “Make it real” closes that gap: prefer a working UI,
runnable command, linked deployment, testable Artifact, or explicit Decision
over a description that still requires human translation.

The demo-first plan also raises a cost concern. Automated builds, browser
navigation, screenshots, health checks, and deterministic QA can run often
without consuming LLM tokens. Interpretation, subjective visual review,
planning, implementation, and failure diagnosis do consume tokens. Treating
both categories as “AI work” would either create unnecessary fear of cheap
automation or hide the genuinely model-bearing loops.

## Decision

“Make it real” becomes a standing guideline, subordinate to the Constitution's
approval boundaries. Every managed plan declares:

- `token_impact`: `none`, `small`, `medium`, `large`, or `xlarge`; and
- `token_budget`: a sentence naming model-bearing steps, deterministic steps,
  and the guardrail against repeated or open-ended inference.

These fields describe the whole plan. They do not estimate exact tokens,
dollars, duration, or provider choice. Exact prediction remains deferred until
observed Run history supports it.

## Consequences

- Plan parsing fails when either budget field is absent or the impact is outside
  the fixed vocabulary.
- `arcadia next` and Project Detail expose the plan's budget posture before an
  operator prepares work.
- Routine successful QA should be deterministic first, with model judgment
  batched once per Candidate only where required.
- Failure diagnosis invokes a model after evidence identifies a failure, rather
  than keeping an agent watching successful builds or browser runs.
- An `xlarge` plan is not forbidden. It signals that the program should be
  staged into separately reviewable Actions and budgeted consciously.
