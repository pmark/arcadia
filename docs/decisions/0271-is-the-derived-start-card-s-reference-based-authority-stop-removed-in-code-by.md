---
arcadia: v1
type: decision
id: "0271"
slug: is-the-derived-start-card-s-reference-based-authority-stop-removed-in-code-by
project: arcadia
status: open
question: "Is the derived START card's reference-based authority stop, removed in code by #2864, removed permanently rather than only for Decision 0268's window?"
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "A. Permanent: the reference stop is gone; merge-time gates unchanged"
options:
  - label: "A. Permanent: the reference stop is gone; merge-time gates unchanged"
    consequence: "The reference-based stop is removed permanently, as #2864 (merged at 7f48854dd) does in code: a derived START card no longer stops before an Action because its references name an authority path. It still stops before an Action citing an unanswered Decision. Every merge-time gate is unchanged: candidateChangeGate, the worker's refusal of authority-adjacent PRs, and the in-run merge conditions of whatever Decision is in force (0268 until 8:00 AM Friday 2026-11-20, then N7 or N8); outside such a Decision, authority-path PRs still park for your merge. This supersedes 0268's words 'for this window only' for that clause, and supersedes the stop half of the criterion in the done Action bind-replay-and-authority-scope-to-the-derived-card ('the deriver stops the card before any Action that cites an open Decision or names an authority path'), keeping its open-Decision half. 0241 E's own text is unchanged: it never stated the stop, only that the card-integrity Actions be built, and they were. Consequence: derived cards can carry authority-path work on any day; what lands is still controlled at merge. Risk: more authority-adjacent PRs are built and then parked, which costs tokens, not authority."
    recommended: true
  - label: "B. Window only: restore the stop after 8 AM Friday"
    consequence: "Keep the removal only for 0268's window: after 8:00 AM Friday 2026-11-20 the reference stop must come back, which means reverting #2864's change to src/operatorActions/startRunDerive.ts in a reviewed PR. Consequence: derived cards again derive almost nothing (all open Plan F and G Actions reference authority paths)."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
updated: 2026-11-19
---

# Decision 0271: Is the derived START card's reference-based authority stop, removed in code by #2864, removed permanently rather than only for Decision 0268's window?

## Options

- **A. Permanent: the reference stop is gone; merge-time gates unchanged** (recommended): The reference-based stop is removed permanently, as #2864 (merged at 7f48854dd) does in code: a derived START card no longer stops before an Action because its references name an authority path. It still stops before an Action citing an unanswered Decision. Every merge-time gate is unchanged: candidateChangeGate, the worker's refusal of authority-adjacent PRs, and the in-run merge conditions of whatever Decision is in force (0268 until 8:00 AM Friday 2026-11-20, then N7 or N8); outside such a Decision, authority-path PRs still park for your merge. This supersedes 0268's words 'for this window only' for that clause, and supersedes the stop half of the criterion in the done Action bind-replay-and-authority-scope-to-the-derived-card ('the deriver stops the card before any Action that cites an open Decision or names an authority path'), keeping its open-Decision half. 0241 E's own text is unchanged: it never stated the stop, only that the card-integrity Actions be built, and they were. Consequence: derived cards can carry authority-path work on any day; what lands is still controlled at merge. Risk: more authority-adjacent PRs are built and then parked, which costs tokens, not authority.
- **B. Window only: restore the stop after 8 AM Friday**: Keep the removal only for 0268's window: after 8:00 AM Friday 2026-11-20 the reference stop must come back, which means reverting #2864's change to src/operatorActions/startRunDerive.ts in a reviewed PR. Consequence: derived cards again derive almost nothing (all open Plan F and G Actions reference authority paths).

## Rationale

Operator, 2026-11-19 afternoon, relayed verbatim by Signal 15: 'merge #2864 a', where disposition (a) is 'removing the card-level reference stop in code is permanent and intended'. Read-only evidence on origin/main 7f48854dd: #2864 changes src/operatorActions/startRunDerive.ts (10 lines) and tests/start-run-replay-binding.test.ts. Decision 0268 option A says the removal amends '0241 E's reference-based stop for this window only'. Ellis drafted that wording, and it is inaccurate: 0241 E's text never states the stop. It came from the criterion of Action bind-replay-and-authority-scope-to-the-derived-card in the standing-autonomy Plan, one of the card-integrity Actions 0241 E required. So this Decision records the permanence against the two places that actually state the window-only limit, and leaves 0241 E's text alone; Decision answers are never hand-edited. Next free number at drafting: 0270 (0269 taken at 12:18 PM); allocate from fresh main at settle (Issue #2369). Signal reads the option text back before anything is recorded. This draft grants nothing.

Proposed by Agent Ask ellis-decision-reference-stop-permanent-20261119.
