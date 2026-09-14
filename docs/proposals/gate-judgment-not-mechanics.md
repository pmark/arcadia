---
arcadia: v1
type: proposal
project: arcadia
question: Should Arcadia stop gating work it can derive by itself, and spend the operator's attention only on judgment — measured by the rule that any common, critical function a local model could decide must not cost a round trip?
---

# The machinery is heavier than the work it governs

## The measurement

2026-09-11, one full operator day, start to finish:

| | |
| --- | --- |
| Lines changed on `main` | 955 |
| Lines changed in `src/` | **0** |
| Pull requests opened | 7 |
| Agent Ask settlements | 4 |
| Decisions created | 2 |
| Decisions answered that took effect | **0** |
| Governed Actions completed | **0** |
| `main` at end of day | **red** |

Four real defects were found, all of them only findable by running the system
rather than reading it. None was fixed. The day's entire output was records
*about* work.

This is not a complaint about a bad day. It is the system meeting its own
definition of failure: `PROJECT.md` sets the Outcome as work advancing "without
the operator holding the whole portfolio in their head," and `CONSTITUTION.md`
requires Arcadia to "stay useful when the operator has almost no time."

## The proposed razor

From the operator, and it is a better test than any of the above:

> Common, critical functions should be no-brainers that even a local model
> could handle.

Stated as a rule Arcadia could be measured against:

**If the answer is derivable from state Arcadia already holds, it must not cost
a round trip.**

Three tiers follow, and the whole proposal is that work be routed to the right
one:

1. **Derivable** — Arcadia already has the answer. Do it, or offer exactly one
   confirmation. *No Decision, no Ask, no ceremony.*
2. **Bounded but ambiguous** — a small set of valid answers. Present them with
   their consequences and let one click settle it.
3. **Genuine judgment** — a reasonable person could choose differently, or it
   resists reversal. *This* is what a Decision is for.

Today, tier-1 work was routinely handled as tier-3.

## The core issues, with evidence

### 1. Refusals are serial, not batched

Every validator fails on its first problem and reports only that one.
`agent-ask settle` took five refusals to learn one invocation — `--proposal`,
then `--request-id`, then `--responsibility` (rejected for amendments), then a
position flag, then a two-phase fingerprint — and this recurred later the same
day. `production preview` refused for a missing `--provider`; had that been
supplied, `activate` would then have refused for a missing `--plan` that
`preview` resolves automatically.

Enumerating every missing required field is pure deterministic computation. It
needs no model at all, let alone a frontier one.

### 2. Arcadia computes the answer, then makes the operator retype it

The sharpest example: `go` returns `nextWorktree.command` — the exact, complete,
correct launch string. The runbook instead asked the operator to reconstruct it
from a template containing `<prepared-worktree-path>` and `<model>`. Two launches
failed on that substitution before anyone noticed Arcadia had been printing the
finished command all along.

`next --ready` computes the ready set and prints `Suggested current_action:` —
and nothing anywhere can accept that suggestion. The system arrives at the right
answer and hands it over as prose to be re-entered by hand.

### 3. The read path and the write path disagree

- `arcadia next` reported an Action dispatchable while `arcadia-go-broker-codex`
  refused the same repository, at the same revision, with four blockers.
- `review show R183 --json` reports `status: approved` while its own Decision
  document reports `status: open` — an operator's answer accepted and discarded.
- `current_action` is stored in two places (`PROJECT.md` and the plan document)
  that must be kept in step by hand.

A local model cannot be handed a "no-brainer" when the system holds two answers.

### 4. Mechanically derivable governance changes have no cheap write path

Moving the pointer off an Action whose dependency is open — onto the ready Action
Arcadia itself suggested — required an Ask, a preview, a settlement, a Decision,
and an operator approval. It then silently did nothing.

Decision 0044 already settled this shape of problem once, for document hygiene,
after an adopting project was stranded with 49 schema errors and no path to fix
them. The same argument applies to any governance change that is derivable rather
than chosen.

### 5. The mechanical/judgment boundary is inverted

`CONSTITUTION.md` says: **"Gate judgment, not mechanics."**

Today, mechanics were gated continuously — flags, fingerprints, queue positions,
branch cleanliness, preview/apply pairs. Meanwhile genuine judgment was narrated
in prose inside pull request bodies: whether a `done` Action whose acceptance does
not hold should reopen; whether an acceptance criterion describing an unbuilt
system should be descoped; whether auto-granting agent trust needs explicit
approval. None of those became a Decision. All of them are exactly what a
Decision is for.

## Arcadia already says this about itself

This proposal introduces no new principle. It observes that the command surface
contradicts principles the Constitution already states:

- *"Gate judgment, not mechanics."*
- *"Carrying out a decision already made is not a second decision. Ceremony
  around a settled question spends the attention budget and protects nothing."*
- *"Operator attention is a budget."*
- *"Every preventable failure leaves leverage. Convert repeated or serious
  friction into a test, guard, orientation note, or triggered Action."*

That last one is the most damning: the settle-flag friction recurred twice in one
day, was recorded in an operator note the day before, and was still not converted
into a guard.

## Why this matters beyond one operator

The operator who hit this wrote the system. Every refusal above was one they
could diagnose from memory or source. An adopting project gets the same refusals
with none of that context.

## What we would build locally

Nothing, per Decision 0025. This is an Outcome-level judgment about where
Arcadia spends attention, not a feature request, and it may warrant a ratified
Decision rather than an implementation Action.

## What would make this answerable

1. Is the razor accepted as a standing test — "derivable means no round trip" —
   and does it belong in `CONSTITUTION.md` beside "Gate judgment, not mechanics"?
2. Which single change buys the most: batched refusals, accepting computed
   suggestions, or one source of truth per field?
3. Should a "derivable" change be applied automatically, or always offered as one
   confirmation?
4. Does this supersede, absorb, or sit beside the narrower proposals
   `validate-governed-documents` and `operator-procedure-surface`?
