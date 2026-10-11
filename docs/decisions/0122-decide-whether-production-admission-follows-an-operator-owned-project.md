---
arcadia: v1
type: decision
id: "0122"
slug: decide-whether-production-admission-follows-an-operator-owned-project
project: arcadia
status: open
question: Decide whether production admission follows an operator-owned Project preference record (included Projects, shares and each Project's chosen Plan), with queue positions ordering Actions only within a Plan, amending Decisions 0048 and 0054.
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Production admission follows the Project preference record; queue positions order Actions only within a Plan
options:
  - label: Production admission follows the Project preference record; queue positions order Actions only within a Plan
    consequence: The operator changes what production runs by editing light preferences (include, shares, chosen Plan) that apply at the next Session start, with a receipt; reordering Projects no longer rewrites Action positions. 0048 and 0054 keep governing order inside each Plan. Production admission changes, so this waits for the queue-controls Plan to be built before it takes effect.
    recommended: true
  - label: Keep the global Action queue as the only priority authority
    consequence: Nothing changes in admission. Project cards stay a read-only view; changing what runs still means moving Actions in /work-queue, one previewed write per move.
    recommended: false
confidence: high
plan: every-open-github-issue-in-pmark-arcadia-is-classified-once-into-a-five-route
updated: 2026-10-11
---

# Decision 0122: Decide whether production admission follows an operator-owned Project preference record (included Projects, shares and each Project's chosen Plan), with queue positions ordering Actions only within a Plan, amending Decisions 0048 and 0054.

## Options

- **Production admission follows the Project preference record; queue positions order Actions only within a Plan** (recommended): The operator changes what production runs by editing light preferences (include, shares, chosen Plan) that apply at the next Session start, with a receipt; reordering Projects no longer rewrites Action positions. 0048 and 0054 keep governing order inside each Plan. Production admission changes, so this waits for the queue-controls Plan to be built before it takes effect.
- **Keep the global Action queue as the only priority authority**: Nothing changes in admission. Project cards stay a read-only view; changing what runs still means moving Actions in /work-queue, one previewed write per move.

## Rationale

Required before Action record-production-project-preferences of the queue-controls draft Plan can start. The operator said production stays Off until they can change what gets queued, thinks in Projects then Plans, and answered 0115 (shares) and 0116 (a blocked Plan yields to the Project's next Plan) on 2026-10-11. Today 0048 and 0054 make the global Action queue the only priority authority, so changing a Project's priority means rewriting every Action's position.

Proposed by Agent Ask decide-production-admission-follows-project-preferences-2026-10-11.
