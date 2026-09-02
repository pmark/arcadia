# Agent Ask, Work Queue, and Discord dogfood evidence

Captured from the configured local Arcadia workspace on 2026-09-01 America/Los_Angeles
(2026-09-02 UTC). This Artifact records the exact durable receipts and bounded
runtime observations used to close
`verify-the-live-work-queue-and-discord-settlement-summary-end-to-end`.

## Lifecycle count reconciliation

There are two intentional queue counts:

- **11 approved unfinished Actions at selection time.** The accepted Ask Action
  was still unfinished and appeared once at position 3 as the selected next
  Action.
- **10 active approved Actions after proof completion.** Marking that Ask Action
  `done` removed it from the active projection while its position and receipts
  remained durable. Queue revision stayed 2 because completion is not a reorder.

## Operator reorder receipt

SQLite table `action_queue_receipts` returned:

```json
{
  "id": "qorder_faac370b0f0a468384",
  "revisionBefore": 0,
  "revisionAfter": 1,
  "before": [
    "private-practice-now/audit-wide-inner-page-content-rail",
    "private-practice-now/rebalance-wide-inner-page-frame",
    "private-practice-now/refine-contact-first-viewport",
    "private-practice-now/refine-services-choice-hierarchy",
    "private-practice-now/refine-about-relationship-opening",
    "private-practice-now/refine-approach-and-specialty-routes",
    "private-practice-now/tune-inner-page-responsive-rhythm",
    "private-practice-now/prove-pilot-acquisition-readiness",
    "private-practice-now/prove-pilot-design-refinement",
    "arcadia/dogfood-agent-managed-queue"
  ],
  "after": [
    "private-practice-now/audit-wide-inner-page-content-rail",
    "arcadia/dogfood-agent-managed-queue",
    "private-practice-now/rebalance-wide-inner-page-frame",
    "private-practice-now/refine-contact-first-viewport",
    "private-practice-now/refine-services-choice-hierarchy",
    "private-practice-now/refine-about-relationship-opening",
    "private-practice-now/refine-approach-and-specialty-routes",
    "private-practice-now/tune-inner-page-responsive-rhythm",
    "private-practice-now/prove-pilot-acquisition-readiness",
    "private-practice-now/prove-pilot-design-refinement"
  ],
  "applied": true,
  "createdAt": "2026-09-02T00:56:50.342Z"
}
```

The Arcadia dogfood Action moved across eight Actions, from position 10 to
position 2, while the Private Practice Now dependency order remained unchanged.

## Settlement receipt

SQLite table `agent_ask_settlements` returned:

```json
{
  "id": "asksettle_d52f96f30a6b443497",
  "proposalId": "agentask_666ad8c7ee602a208d",
  "proposalRequestId": "agent-live-queue-discord-proof-20260901",
  "settlementRequestId": "settle-agent-live-queue-discord-proof-20260901",
  "disposition": "accepted",
  "projectSlug": "arcadia",
  "intent": "action",
  "effects": [
    "Created 1 Action in active Plan agent-ask-execution-queue: arcadia/verify-the-live-work-queue-and-discord-settlement-summary-end-to-end.",
    "Assigned Responsibility codex to the accepted Action.",
    "Inserted the Action starting at queue position 3."
  ],
  "queueActionKey": "arcadia/verify-the-live-work-queue-and-discord-settlement-summary-end-to-end",
  "queuePosition": 2,
  "previewFingerprint": "1229a176bbc4cad785080dbee86a45a8d9c05c7d5717c7ed3c229a70f6b69568",
  "applied": true,
  "authority": {
    "kind": "operator_acceptance",
    "requestedAuthority": "apply_if_approved",
    "boundedPolicyDecision": null
  },
  "createdAt": "2026-09-02T01:10:42.902Z"
}
```

`queuePosition` is the persisted zero-based index; the canonical effect and
operator surfaces render it as position 3. `Next: none` is the truthful state
at settlement time, before the separately governed pointer receipt below.

The persisted settlement row later recorded transport completion separately:

```json
{
  "notification_status": "sent",
  "discord_message_id": "1544514914092191796",
  "notified_at": "2026-09-02T01:10:51.959Z"
}
```

## Discord effect summary

Rendering the persisted settlement through `agentAskSettlementMessage` produced:

```text
Agent Ask settled: accepted
Project: arcadia
Intent: action
• Created 1 Action in active Plan agent-ask-execution-queue: arcadia/verify-the-live-work-queue-and-discord-settlement-summary-end-to-end.
• Assigned Responsibility codex to the accepted Action.
• Inserted the Action starting at queue position 3.
Queue: arcadia/verify-the-live-work-queue-and-discord-settlement-summary-end-to-end starting at position 3
Next: none
Settlement: asksettle_d52f96f30a6b443497
```

The adapter log contained exactly one matching idempotency key:

```text
match count: 1
{"ts":"2026-09-02T01:10:51.977Z","level":"info","msg":"discord notification sent","key":"agent-ask:asksettle_d52f96f30a6b443497"}
```

After delivery, `pnpm arcadia agent-ask notifications --json` returned:

```json
{"notifications":[]}
```

This proves durable `sent` state, one adapter send for the settlement-derived
idempotency key, and no pending retry. Direct visual inspection of the Discord
channel was not available to the automated browser and is not claimed.

## Governed pointer receipt

SQLite table `action_queue_pointer_receipts` returned:

```json
{
  "id": "qpointer_7fa6cb515baa45fcb1",
  "actionKey": "arcadia/verify-the-live-work-queue-and-discord-settlement-summary-end-to-end",
  "queueRevision": 2,
  "previewFingerprint": "c29d85688176006cdeb060c10946fbfc5820ca4506231513feded4325ba11e45",
  "previousAction": "dogfood-agent-managed-queue",
  "nextAction": "verify-the-live-work-queue-and-discord-settlement-summary-end-to-end",
  "applied": true,
  "createdAt": "2026-09-02T01:14:21.641Z"
}
```

## Queue projection at selection time

`pnpm arcadia advance queue --json` returned this bounded projection after the
pointer apply and before proof completion:

```json
{
  "revision": 2,
  "orderValid": true,
  "unpositionedCount": 0,
  "nextActionKey": "arcadia/verify-the-live-work-queue-and-discord-settlement-summary-end-to-end",
  "orderedCount": 11,
  "firstThree": [
    {
      "position": 1,
      "actionKey": "private-practice-now/audit-wide-inner-page-content-rail",
      "state": "attention",
      "reason": "Action is not yet eligible for dispatch."
    },
    {
      "position": 2,
      "actionKey": "arcadia/dogfood-agent-managed-queue",
      "state": "attention",
      "responsibility": "requires_review",
      "reason": "Action requires operator review and remains ordered but ineligible."
    },
    {
      "position": 3,
      "actionKey": "arcadia/verify-the-live-work-queue-and-discord-settlement-summary-end-to-end",
      "state": "ready",
      "responsibility": "codex",
      "pointerAuthorized": true,
      "reason": "The checked-in Project pointer authorizes this ready Action."
    }
  ]
}
```

The Dashboard displayed the same revision, 11-Action count, positions, labels,
reasons, and selected-next hero.

## Queue projection after completion

After managed-doc sync marked the proof Action done, the same CLI returned:

```json
{
  "revision": 2,
  "orderValid": true,
  "unpositionedCount": 0,
  "nextActionKey": null,
  "orderedCount": 10,
  "firstTwo": [
    {
      "position": 1,
      "actionKey": "private-practice-now/audit-wide-inner-page-content-rail",
      "state": "attention",
      "reason": "Action is not yet eligible for dispatch."
    },
    {
      "position": 2,
      "actionKey": "arcadia/dogfood-agent-managed-queue",
      "state": "attention",
      "responsibility": "requires_review",
      "reason": "Action requires operator review and remains ordered but ineligible."
    }
  ]
}
```

The refreshed Dashboard displayed revision 2, 10 approved Actions, the same
first two positions and reasons, and `No eligible next Action` because Decision
0041 is the remaining operator boundary.

## Browser and validation receipts

- Desktop viewport: `innerWidth: 1280`, `scrollWidth: 1280`.
- Phone viewport: `innerWidth: 390`, `innerHeight: 844`, `scrollWidth: 390`.
- At both widths the Dashboard exposed the selected-next hero before completion,
  all first-three queue positions, readiness labels, and exact reasons.
- `pnpm test`: 120 test files passed, 2 skipped; 1,164 tests passed, 6 skipped.
- `pnpm build`: passed for Arcadia core and Discord bot.
- `pnpm dashboard:build`: passed; `/work-queue` included in the production route
  manifest.
- GitHub PR #147 checks: both `fast` jobs and both `e2e` jobs passed.
- `pnpm arcadia docs sync --project arcadia --json`: `errorCount: 0`.
- `pnpm arcadia decision validate 0041 --project arcadia`: valid.

PR #146 is the merged defect-prevention Artifact for the YAML insertion failure
the dogfood exposed; it adds the trailing-top-level-field regression fixture and
is present in base commit `1d8b9d2de3220460abe71c0a165c83eb66d07821`.
