---
id: no-agent-ask-path-to-defer-an-action
cost: 15
fix: proposed — let a decision Ask option carry effect: defer (today only a hand-written Decision can)
status: open
---
Deferral parks an Action only through an approved Decision whose option has `effect: defer` (deferringDecisionFor, src/docs/dispatch.ts). Agent Ask decision options accept only label, consequence and recommended, and `arcadia decision new` has no options flag. PR #1405 therefore gated four Actions behind `depends_on` instead of deferring them.
