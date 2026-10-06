---
arcadia: v1
type: decision
id: "0084"
slug: defer-celebrate-pr-1000-until-it-merges
project: arcadia
status: pending
question: Defer the celebrate-pr-1000 Action until PR #1000 merges so the team can celebrate together on the milestone.
gap_type: missing-decision
recommendation: Defer with trigger
options:
  - label: Defer celebrate-pr-1000 until PR #1000 merges
    consequence: "The Action stops being dispatched. **Trigger:** The pr-1000-merged trigger fires when PR #1000 merges (observed: true in .arcadia/triggers.json). When it fires, the Action revives and Arcadia Go dispatches it; the executing agent composes a celebration message and sends it via `arcadia ping` to coordinate across Claudia Swift, Owen, Cody, and the operator. This is a test of both the trigger system and the ping infrastructure."
    recommended: true
  - label: Keep it in the queue now
    consequence: The Action dispatches immediately and the agent has to mock the celebration or wait for PR #1000 to merge while the Action is active. The trigger system is not tested with this real-world use case.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-05
answer: null
decided: null
---

# Decision 0084: Defer celebrate-pr-1000 until PR #1000 merges

## Options

- **Defer celebrate-pr-1000 until PR #1000 merges** (recommended): The Action stops being dispatched. **Trigger:** The pr-1000-merged trigger fires when PR #1000 merges (observed: true in .arcadia/triggers.json). When it fires, the Action revives and Arcadia Go dispatches it; the executing agent composes a celebration message and sends it via `arcadia ping` to coordinate across Claudia Swift, Owen, Cody, and the operator. This is a test of both the trigger system and the ping infrastructure.
- **Keep it in the queue now**: The Action dispatches immediately and the agent has to mock the celebration or wait for PR #1000 to merge while the Action is active. The trigger system is not tested with this real-world use case.

## Rationale

This decision tests two Arcadia systems:

1. **Triggers and deferrals**: The trigger system was just documented in `docs/agent-guidance/triggers-and-deferrals.md` and formalized with `.arcadia/triggers.json` as the registry. This is its first live use.
2. **Pinging the team**: The `arcadia ping` command coordinates messages across all configured agents. Using it for a milestone celebration is a natural, low-risk test case.

The celebrate-pr-1000 Action was added to the plan specifically to test these systems in a real workflow. Deferring it with a registry-based `observed` trigger means:

- The trigger can be fired manually by changing `observed: true` in `.arcadia/triggers.json` when PR #1000 merges
- The deferral protocol will automatically revive the Action on the next `arcadia go` or polling cycle
- The agent executing it can be surprised with the actual celebration content (this document does not prescribe what the message says)
- Success is measured by: trigger fires → Action revives → message successfully pings

## Trigger Details

The trigger is registry-based (machine-checkable) in `.arcadia/triggers.json`:

```json
{
  "id": "pr-1000-merged",
  "watches": "PR #1000 (milestone PR)",
  "condition": {
    "kind": "observed",
    "observed": false,
    "lookFor": "PR #1000 has merged."
  },
  "fires": {
    "plan": "bootstrap-managed-production-to-build-flight-deck",
    "action": "celebrate-pr-1000"
  }
}
```

When PR #1000 merges:
1. Change `observed: false` to `observed: true` in `.arcadia/triggers.json`
2. Commit and push (or just flip it and dispatch)
3. Run `pnpm arcadia triggers --repo` to confirm the trigger shows as `fired`
4. Run `pnpm arcadia decision reverse 0084` to revive the Action
5. Run `pnpm arcadia go` to dispatch it

Proposed by operator-directed trigger-and-ping-test. This Decision is pending the operator's approval to formally defer celebrate-pr-1000 with the pr-1000-merged trigger.

The celebrate-pr-1000 Action is therefore parked with its reactivation trigger: it revives when the pr-1000-merged trigger fires (when PR #1000 has merged and observed is set to true in the registry).
