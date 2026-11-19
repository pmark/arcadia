---
arcadia: v1
type: decision
id: "0266"
slug: defer-check-tonights-card-at-noon-until-derived-cards-ship
project: arcadia
status: approved
question: "Defer check-tonights-card-at-noon in Plan draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production until derived cards ship?"
gap_type: missing-decision
recommendation: "A. Defer check-tonights-card-at-noon"
options:
  - label: "A. Defer check-tonights-card-at-noon"
    consequence: "Dispatch stops selecting this Action and the governed pointer moves to the next eligible Action, so it never enters a card and Plan F can close. Revival trigger: the Decision 0241 E card-integrity Actions are done and derived cards ship, or the operator asks. Nothing is deleted; reversing the deferral re-opens it."
    recommended: true
    effect: defer
  - label: "B. Keep it in the queue"
    consequence: "It stays dispatchable and enters a per-run card segment; Plan F cannot close Friday without it."
    recommended: false
confidence: high
plan: draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production
action: check-tonights-card-at-noon
updated: 2026-11-19
answer: A. Defer check-tonights-card-at-noon
decided: 2026-11-19
---

# Decision 0266: Defer check-tonights-card-at-noon in Plan draft-an-inactive-plan-of-five-bounded-actions-that-keep-unattended-production until derived cards ship?

## Options

- **A. Defer check-tonights-card-at-noon** (recommended): Dispatch stops selecting this Action and the governed pointer moves to the next eligible Action, so it never enters a card and Plan F can close. Revival trigger: the Decision 0241 E card-integrity Actions are done and derived cards ship, or the operator asks. Nothing is deleted; reversing the deferral re-opens it.
- **B. Keep it in the queue**: It stays dispatchable and enters a per-run card segment; Plan F cannot close Friday without it.

## Rationale

The operator answered "A" in Signal 15's chat at about 8:35 AM Pacific on 2026-11-19 to a bundle that settles N3-A+ (final step-back plan, 13-ellis-plan-final-aplus.md), which stops this Action as POLISH: it only fixes a failure intrinsic to per-run pinned cards or the shared checkout. Signal reads this text back to the operator and verifies the words under Decision 0229 before the record is merged. Arcadia's deferral route parks an Action only through an approved Decision that names it in `action:` and whose chosen option carries `effect: defer` (src/docs/dispatch.ts deferringDecisionFor; src/docs/types.ts DECISION_OPTION_EFFECTS); an Agent Ask cannot set Action status or an option effect, so this is a Decision record. Allocate the number from fresh origin/main at commit (Issue #2369), and apply with `arcadia decision approve <id> --project arcadia --answer "<A label>" --expect-no-pointer-move` if the pointer is elsewhere. This PR carries a Decision, so the operator merges it.

Drafted by ↳ Ellis (planner); grants nothing until recorded.
