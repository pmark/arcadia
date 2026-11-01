---
arcadia: v1
type: decision
id: "0163"
slug: may-the-operator-s-next-per-run-start-card-press-authorize-rowan-to-carry-that
project: arcadia
status: open
question: May the operator's next per-run START card press authorize Rowan to carry that run through to the goal, fixing each blocking defect and running successor START cards itself, without another operator press?
gap_type: missing-decision
gate_question: approval_boundary
options:
  - label: Delegate retries to Rowan until the goal (recommended)
    consequence: "The operator's next press of a per-run START card for Plan arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider (Actions bound-guidance-test-teardown-retries, assert-tmux-temp-launcher-removed, cover-retired-descriptor-byte-change; provider claude-code-cli; concurrency 1) delegates to Rowan, the sole coordinator, the authority to press successor cards for that same scope without asking again. Rowan presses only by running a newly minted one-shot card through the existing /actions runner; a host permission refusal or any denied gate stops the delegation and is reported, never bypassed. A successor is allowed when a card's run refuses before START, or when production returns to Off before every in-scope Action has reached a merged PR; an Off caused by an operator STOP card, a Decision or a stop-the-line never triggers a successor. Before each successor, every blocking defect is fixed through an independently reviewed PR merged under Decisions 0060/0080. Each successor keeps the same Plan, Actions, provider, concurrency, spend Decision 0130 and transitions; only the reviewed revision, executor hash and live pins may change. Each successor passes host preflight and an independent critic pin check, keeps every gate of Decisions 0156, 0157, 0161 and 0162, and runs one sign-in sequence per press. Delegated presses are recorded as Rowan's under this Decision; the operator's originating press is the one activation touch, and every delegated press and attempt is reported truthfully in the run record. Bounds: at most 5 START attempts in total, including the operator's press, within 72 hours of that press; each attempt may rotate the shared sign-in and consumes a new card's one-shot allowance (with no daily ceiling under Decision 0162), which is why the attempt bound exists. Rowan stops and pings the operator, without pressing, when a fix would need new authority, spend beyond Decision 0130, a credential, an interactive sign-in or a Decision; when a PR needs an operator merge; or when the bounds are exhausted. This changes no Plan scope or criteria, and excludes paid fallback, credential export, merging Decision-carrying or authority-adjacent PRs, and resetting any consumed allowance."
    recommended: false
  - label: Keep one operator press per attempt
    consequence: "No delegation: every successor card after a refusal or an early Off needs a new operator press."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-11-01
---

# Decision 0163: May the operator's next per-run START card press authorize Rowan to carry that run through to the goal, fixing each blocking defect and running successor START cards itself, without another operator press?

## Options

- **Delegate retries to Rowan until the goal (recommended)**: The operator's next press of a per-run START card for Plan arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider (Actions bound-guidance-test-teardown-retries, assert-tmux-temp-launcher-removed, cover-retired-descriptor-byte-change; provider claude-code-cli; concurrency 1) delegates to Rowan, the sole coordinator, the authority to press successor cards for that same scope without asking again. Rowan presses only by running a newly minted one-shot card through the existing /actions runner; a host permission refusal or any denied gate stops the delegation and is reported, never bypassed. A successor is allowed when a card's run refuses before START, or when production returns to Off before every in-scope Action has reached a merged PR; an Off caused by an operator STOP card, a Decision or a stop-the-line never triggers a successor. Before each successor, every blocking defect is fixed through an independently reviewed PR merged under Decisions 0060/0080. Each successor keeps the same Plan, Actions, provider, concurrency, spend Decision 0130 and transitions; only the reviewed revision, executor hash and live pins may change. Each successor passes host preflight and an independent critic pin check, keeps every gate of Decisions 0156, 0157, 0161 and 0162, and runs one sign-in sequence per press. Delegated presses are recorded as Rowan's under this Decision; the operator's originating press is the one activation touch, and every delegated press and attempt is reported truthfully in the run record. Bounds: at most 5 START attempts in total, including the operator's press, within 72 hours of that press; each attempt may rotate the shared sign-in and consumes a new card's one-shot allowance (with no daily ceiling under Decision 0162), which is why the attempt bound exists. Rowan stops and pings the operator, without pressing, when a fix would need new authority, spend beyond Decision 0130, a credential, an interactive sign-in or a Decision; when a PR needs an operator merge; or when the bounds are exhausted. This changes no Plan scope or criteria, and excludes paid fallback, credential export, merging Decision-carrying or authority-adjacent PRs, and resetting any consumed allowance.
- **Keep one operator press per attempt**: No delegation: every successor card after a refusal or an early Off needs a new operator press.

## Rationale

Operator's direct choice in Rowan's chat, 2026-11-01. They asked: "Is there any way for you to keep this process moving forward without requiring me to even press the button more than one more time until the final goal is achieved?" Rowan offered a delegation, and they answered "A", adding: "My intention should be clear. All bugs preventing achievement of the goal must be fixed without delay." Earlier: "no red tape is allowed to impede progress". Re-pressing after an early Off is included because the operator asked for no further press until the final goal, not only until START. This records an already-given operator choice. The executor and runner changes that let Rowan press under it are implementation, gated on this Decision being on main.

Proposed by Agent Ask decision-delegate-start-retries-20261101.
