---
arcadia: v1
type: decision
id: "0157"
slug: may-a-per-run-start-card-also-activate-its-named-plan-through-the-pinned-plan
project: arcadia
status: open
question: May a per-run START card also activate its named Plan through the pinned Plan-activation runner before starting production?
gap_type: missing-decision
gate_question: approval_boundary
options:
  - label: "Yes: START activates its pinned Plan (recommended)"
    consequence: "Widens one press to include a Plan-state change. The per-run one-shot START card embeds the same pinned planActivation block a separate card uses today (exact Agent Ask, envelope and settlement fingerprints, refusing on any drift) and runs it before production activation, with every other START gate retained; the card's 'Plan is active' precondition becomes 'Plan is active, or activated by this card in this run'. The activation runner's own one-shot allowance is consumed when it runs, even if production activation then refuses, and is never reset. If production activation then fails or refuses, production stays Off but the Plan stays active: no automatic deactivation, and the receipt says so. No gate is overridden or bypassed. One press fewer per run whenever the Plan is not already active."
    recommended: false
  - label: "No: Plan activation stays its own card"
    consequence: No widening. Which Plan runs stays a separate reviewed choice pressed on its own before START. One extra press per run whenever the Plan is not already active.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-31
---

# Decision 0157: May a per-run START card also activate its named Plan through the pinned Plan-activation runner before starting production?

## Options

- **Yes: START activates its pinned Plan (recommended)**: Widens one press to include a Plan-state change. The per-run one-shot START card embeds the same pinned planActivation block a separate card uses today (exact Agent Ask, envelope and settlement fingerprints, refusing on any drift) and runs it before production activation, with every other START gate retained; the card's 'Plan is active' precondition becomes 'Plan is active, or activated by this card in this run'. The activation runner's own one-shot allowance is consumed when it runs, even if production activation then refuses, and is never reset. If production activation then fails or refuses, production stays Off but the Plan stays active: no automatic deactivation, and the receipt says so. No gate is overridden or bypassed. One press fewer per run whenever the Plan is not already active.
- **No: Plan activation stays its own card**: No widening. Which Plan runs stays a separate reviewed choice pressed on its own before START. One extra press per run whenever the Plan is not already active.

## Rationale

Today Plan activation is its own reviewed card (planActivation runner), separate from START (Issue #1929 F6). Combining them changes what one press authorizes (a Plan-state change), so the operator decides. A companion Decision asks separately about installing the runtime. Answering this gates implementation only; no activation or START follows from the answer itself.

Proposed by Agent Ask decision-start-activates-pinned-plan-20261031.
