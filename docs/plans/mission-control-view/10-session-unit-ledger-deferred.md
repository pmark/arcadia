# Session Unit Ledger — Deferred, With a Trigger

> Scope distinction, 2026-09-05: [17](./17-managed-production-contract.md)
> now prioritizes real capacity-aware production and automatic continuation.
> This document's synthetic weekly Session Unit planning model remains deferred;
> it is not a reason to defer operational capacity admission or worker proof.

Explored on 2026-09-04 alongside the Flight Deck board, then set aside as
independent of it. Preserved as evidence by Agent Ask
`session-unit-ledger-deferred-2026-09-04`, which creates no executable Action.

**This is a deferral, not a rejection.** Its trigger is named at the bottom.

## The question it answers

"How far can I get this week, and what is the priority?" — asked because the
coding-agent allowance resets weekly, and two agents are in use.

## The model

**One Session Unit is one agent session on a `medium`-impact Plan.**

```
cost = effort units × Plan token_impact weight

effort:        quick 0.25 · short 0.5 · session 1 · project 3
token_impact:  none 0.25 · small 0.5 · medium 1 · large 1.75 · xlarge 3
```

Two coarse t-shirt fields that already exist, multiplied. No token estimation,
for the reason `src/orientation/effort.ts` already gives about time: people
estimate specific quantities badly and stop filling the field in, but "that's
a whole session" is how they already talk.

Granularity: **the Action is the slot, the Plan is the budget row, the week is
the frame.** That falls out of the data rather than being chosen — see gap 1.

## Where allowance lives

With the **provider**, never with the work. A Codex SU and a Claude SU are
separate currencies with no exchange rate; each is declared on its own.

Assignment is then a solve, not a lookup. For each Action in priority order,
take the cheapest binding that clears its capability floor and still has
allowance, spilling to the next compliant binding rather than stopping. That
is exactly `selectCompliantCodingAgent`'s existing order — weakest sufficient
capability, then lowest `costRank` — with capacity added as the one new
constraint. Which is precisely what
[`agent-advance-queue#budget-aware-admission`](../agent-advance-queue.md) is
specified to do.

Work must never name a provider. `PROHIBITED_VENDOR_FIELDS` in
`src/execution/profiles.ts` already rejects `model`, `provider`, `model_id`
and `provider_model` inside an `execution:` block: *"Authoritative plans must
not contain provider or model identifiers; use a provider adapter."*

## What it showed against real numbers

At a placeholder 4 Codex SU and 8 Claude SU, the live backlog spends all 12
with one Action past the cut — and **8 Actions run on a costlier compliant
provider** because the cheapest one filled up. Under a model that pins work to
a provider, those 8 would have been cut instead. Setting either provider to
zero moves its work rather than stopping it.

## Three gaps it surfaced

Each is real, each is separately fixable, and none of them blocks the Flight
Deck board.

1. **`token_impact` is declared per Plan, not per Action.** 12 of the 13
   queued Actions read `medium`, so the field cannot discriminate within a
   Plan; `effort` carries all of it today.
2. **No queued Action declares an `execution:` block.** Only a handful of
   Arcadia plans use one and those Actions are mostly done, so no queued
   Action currently states a vendor-neutral capability floor at all. The
   legacy `recommended_model` in plan frontmatter is a launch hint for
   `arcadia go`, not a routing decision — it is the field the profile is meant
   to replace.
3. **No bundled binding reaches `c4_critical`.**
   `config/defaults/provider-adapters.json` tops out at `c3_systems`
   (`codex-sol`, `claude-opus`), so a `sensitive_change` Action has no
   compliant agent and would raise `EXECUTION_PROFILE_UNSATISFIED` rather than
   quietly downgrade.

## Why not now

It is orthogonal to the Flight Deck board and needs none of the same code. The
measured half is already owned by
[`provider-capacity-harvesting`](../provider-capacity-harvesting.md), whose own
`budget-aware-admission` Action is `blocked` on a named capacity trigger.
Building a hand-typed capacity view first would either duplicate that plan or
pre-empt it.

## Trigger

Reactivate when **either** fires:

- `provider-capacity-harvesting` produces a usage receipt carrying weekly
  remaining capacity for both Codex and Claude Code — the same condition
  `budget-aware-admission` already waits on; or
- the operator asks to plan a week before that telemetry exists, in which case
  the hand-declared capacity form above is the smallest thing that answers it.

Until one fires, the question is settled and does not need re-deciding.
