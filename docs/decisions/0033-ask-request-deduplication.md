---
arcadia: v1
type: decision
id: "0033"
slug: ask-request-deduplication
project: arcadia
status: approved
question: arcadia ask never checks whether an unresolved packet already covers a request. Should it refuse or fold a near-duplicate request into the existing one instead of creating another packet?
gap_type: missing-decision
answer: "Yes: before writing a planning or build packet, check the target Project's undecided packets for an exact-match request (after whitespace/case normalization) and refuse, naming the existing packet, instead of writing a duplicate. A coding agent builds it, scoped to ask.ts and packets.ts."
recommendation: Before creating a planning or build packet, check the target Project for an existing undecided packet whose stored request text is the same or near-identical. If one exists, refuse and point at it instead of creating a new packet.
confidence: high
decided: 2026-08-23
updated: 2026-08-23
---

# Decision 0033: Ask request deduplication

## Problem

`arcadia ask` creates a new packet every time, with no check for an existing
one. Rebuster now carries sixteen unresolved Pinterest-publishing packets,
created 2026-06-11 through 2026-06-15, each a restatement of the same request:
"Plan and implement Pinterest publishing for Rebuster." None were ever
decided. `advance queue` lists all sixteen as separate needs-attention items.

## Why

`ask` was built early, before there was any notion of checking prior state.
`src/commands/ask.ts` resolves intent and writes a packet
(`src/codex/packets.ts`) with no query against existing undecided packets for
the same Project. Asking the same thing twice — including by accident, e.g. a
retry after a slow response — always produces two packets.

## Fix

Before `ask` writes a planning or build packet:

1. Look up the target Project's undecided packets (no recorded Decision yet).
2. Compare the new request text against each one's stored request, using
   exact match after whitespace/case normalization as the bar — no
   similarity scoring, no model call.
3. On a match, refuse and name the existing packet's path instead of writing
   a new one.

This is a guard on packet creation, not a cleanup job — the sixteen existing
packets stay as they are until someone resolves or discards them by hand.

## Resolution

Approved as recommended on 2026-08-23. Exact match is deliberately the
starting bar; loosen it only if it proves too narrow in practice. A coding
agent builds it — the change is deterministic and scoped to `ask.ts` and
`packets.ts`.

## Revisit triggers

- Operators report exact-match refusing requests that were genuinely
  different, meaning the comparison needs to loosen.
- A second capability (besides `ask`) starts creating packets outside this
  path, meaning the guard needs to move lower, into `packets.ts` itself.
