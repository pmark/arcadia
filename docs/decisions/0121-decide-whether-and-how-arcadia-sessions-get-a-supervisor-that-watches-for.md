---
arcadia: v1
type: decision
id: "0121"
slug: decide-whether-and-how-arcadia-sessions-get-a-supervisor-that-watches-for
project: arcadia
status: open
question: Decide whether and how Arcadia sessions get a supervisor that watches for friction during a session, files bugs through a new arcadia bug utility, and asks the peer agent for ideas and insights after it, extending Decision 0113.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: "Event-triggered light-tier supervisor: deterministic detectors watch every session and a light-model supervisor is invoked only on a friction or exception signal and at session end, may cover several sessions, files bugs through arcadia bug and asks the lead for ideas and insights"
options:
  - label: "Deterministic additions only: build arcadia bug and an end-of-session insight harvest run by the session lead, with no supervisor agent"
    consequence: "Cheapest and works with existing detectors: bugs get filed and insights get collected with no standing model spend. Nothing watches a session for friction in real time, so problems are found only when a detector or the lead notices. Leaves 0113 unchanged and its revival trigger intact."
    recommended: false
  - label: "Event-triggered light-tier supervisor: deterministic detectors watch every session and a light-model supervisor is invoked only on a friction or exception signal and at session end, may cover several sessions, files bugs through arcadia bug and asks the lead for ideas and insights"
    consequence: "Delivers all four duties you described at bounded cost: model tokens are spent only when a signal fires or a session ends, and no long-lived process is added. A quiet session costs one short end-of-session pass. It amends 0113 for the model-bearing supervisor, adds an arcadia bug utility with an immediate-fix versus tech-debt triage rule, and needs a token budget and a cap per session. Real-time steering of a session mid-flight is still limited to what the detectors catch."
    recommended: true
  - label: A standing light-model supervisor per session or per Project that watches continuously, as 0113 option B described
    consequence: Fullest coverage and active direction during a session, and it can oversee many sessions at once. It spends model tokens for as long as sessions run and adds a long-lived lifecycle that must itself be watched, which cuts against the cost-reduction goal and the attention budget.
    recommended: false
  - label: Leave 0113 as it is and do nothing now
    consequence: No new spend or machinery. Your four duties stay undone and friction keeps reaching you only through arcadia todo and pings. The captured work item stays unplaced unless you retire it.
    recommended: false
confidence: high
plan: governed-agent-roles-one-real-action-and-one-interactive-session-each-run-as-a
updated: 2026-10-11
---

# Decision 0121: Decide whether and how Arcadia sessions get a supervisor that watches for friction during a session, files bugs through a new arcadia bug utility, and asks the peer agent for ideas and insights after it, extending Decision 0113.

## Options

- **Deterministic additions only: build arcadia bug and an end-of-session insight harvest run by the session lead, with no supervisor agent**: Cheapest and works with existing detectors: bugs get filed and insights get collected with no standing model spend. Nothing watches a session for friction in real time, so problems are found only when a detector or the lead notices. Leaves 0113 unchanged and its revival trigger intact.
- **Event-triggered light-tier supervisor: deterministic detectors watch every session and a light-model supervisor is invoked only on a friction or exception signal and at session end, may cover several sessions, files bugs through arcadia bug and asks the lead for ideas and insights** (recommended): Delivers all four duties you described at bounded cost: model tokens are spent only when a signal fires or a session ends, and no long-lived process is added. A quiet session costs one short end-of-session pass. It amends 0113 for the model-bearing supervisor, adds an arcadia bug utility with an immediate-fix versus tech-debt triage rule, and needs a token budget and a cap per session. Real-time steering of a session mid-flight is still limited to what the detectors catch.
- **A standing light-model supervisor per session or per Project that watches continuously, as 0113 option B described**: Fullest coverage and active direction during a session, and it can oversee many sessions at once. It spends model tokens for as long as sessions run and adds a long-lived lifecycle that must itself be watched, which cuts against the cost-reduction goal and the attention budget.
- **Leave 0113 as it is and do nothing now**: No new spend or machinery. Your four duties stay undone and friction keeps reaching you only through arcadia todo and pings. The captured work item stays unplaced unless you retire it.

## Rationale

Operator Ask 2026-10-11 (capture_27c07f84, now work item work_38c5a564c5db4058a6) asks that every session have a supervisor performing duties during and after completion: watch for friction, exceptions and unexpected states that disturb deterministic session management; submit bug reports through an arcadia bug utility that triages and either schedules an immediate fix or adds a GitHub Issue as tech debt; ask the peer agent to surface good ideas, opportunities and key insights; and possibly oversee several sessions. Decision 0113 (2026-10-09) chose a deterministic assignment with no running supervisor agent and named its revival trigger: a standing supervisor returns when a queued delegation outlives its bounded wait with no supervisor action twice in one week. This request goes beyond that scope, and any model-bearing supervisor spends tokens, which the operator is also trying to cut. No arcadia bug command exists today; the nearest is red-alert diagnosis in src/production/redAlertDiagnosis.ts, which files a GitHub Issue. Existing signals a supervisor would consume: stall detection, peer watch (docs/agent-guidance/agent-peer-watch.md), arcadia todo, notes-to-self.

Proposed by Agent Ask decision-extend-0113-session-supervisors-2026-10-11.
