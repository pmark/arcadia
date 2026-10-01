---
arcadia: v1
type: proposal
project: arcadia
question: Can the operator-action library reject a fingerprint-pinned historical Plan amendment through canonical settlement, without requiring a terminal or accepting the old amendment?
---

# Reject historical Plan amendments from the operator surface

## Why this project needs it

On September 30, six historical proposals prevented the protected Go launcher
from updating the host checkout for merged PR #849. All six canonical rejection
previews preserved the proposals and produced no document or queue changes.
Two proposals target existing Plans: the original 80/20 amendment and the old
Flight Deck production-console amendment.

`assertOperatorSettlementContract` requires existing-Plan amendments to use
the shared Plan-amendment runner even when their disposition is rejected.
That runner's contract permits only `accepted`. The operator library also
supports only one declared `agentAsk`, so a bespoke batch cannot legitimately
retire all six. A proposed batch was rejected by the contract and removed
before execution. No proposal was settled by this session.

## What we would build locally

A bespoke rejection writer, a batch that misdeclares its scope, or a launcher
that clears the operator execution context. Those would bypass the canonical
contract rather than fix it, and are excluded.

The requested capability should reuse canonical rejected-disposition
settlement, exact preview fingerprints, explicit operator answers, retained
receipts, and idempotent recovery. It should never apply historical proposal
contents, alter current Plans or queue order, or grant production authority.
