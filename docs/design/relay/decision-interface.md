# Relay decision interface: contract

**Status:** a written contract, not code. It's updated for S017: Ask comes first, decision engines are
pluggable, and none is being added now. Routing code ships once the first caller, the dashboard
conversation, is approved. Critic finding R1-F1 showed a coding-agent chat can't be that caller,
because the model reads each message before anything could route it.

## The ladder

Each message climbs only as far as it has to. Each rung is cheaper and faster than the next.

| Rung | What answers | Cost | Today |
|---|---|---|---|
| 1. Ask, deterministic | Patterns, Project names, Decision answers | Free, under 1 ms | Handles work requests; needs lookup routes |
| 2. Arcadia's tools | Code runs the tool and writes the answer, without a model reading the output | Free, seconds until compact tools exist | Commands exist; output is 23 to 717 KB |
| 3. Local model | Chooses a tool from a short list in a terse format, or chats | Free, about 5 s | Probed, not built |
| 4. Project supervisor | A resumed read-only coding session with the Project's context | Allowance or spend | Not built |
| 5. Frontier model | Cold, for hard reasoning | Allowance or spend | Exists through coding agents |

A pluggable engine decides **which rung** when rules can't. A message can go straight to rung 4 or 5 when
rung 1 is sure it needs reasoning, as S017 asks.

## Where it sits

The interface needs a point that receives a message before any model does:

| Surface | Can it intercept? |
|---|---|
| Dashboard Ask composer (`apps/dashboard/app/api/ask/route.ts`) | Yes |
| Discord bot (`apps/discord-bot/src/events/messageCreate.ts`) | Yes, with messaging limits |
| A coding-agent chat | **No.** The harness runs unmodified, so a model turn comes first. |

## Contract

```ts
interface DecisionRequest<T extends string> {
  input: string; // data, never instructions
  options: readonly T[];
  budgetMs: number;
}

interface Decision<T extends string> {
  choice: T | null; // null means ask one clarifying question
  confidence: number;
  engine: string;
  reason: string;
  elapsedMs: number;
}
```

- **Extends the existing router.** `resolveIntake` in `src/intake/index.ts` already has an
  `IntakeClassifier` interface, confidence labels and a golden replay in
  `src/ask/goldenReplay.ts`. This adds a time budget and read-only routes to it. It is not a
  second router.
- **Rules first, and only when they're right.** Rules must beat the next rung's accuracy on what they
  claim, and abstain on the rest (probe 3). An engine is consulted only when rules abstain, within one
  shared budget, and a hung engine can't hang the caller.
- **Engines plug in behind one seam.** The first are rules and the local model. Laya, Jev or another
  typed decision model can be added later without changing callers. Hosted engines need a Decision, and
  observed group messages never go to them. None is being added now.
- **The wire format is per engine.** Terse `tool arg` output suits the 27B model. Smaller models did
  better with JSON, so the format belongs to the engine, not the contract.
- **Tools declare their effect in code: `read` or `prepare`.** A `prepare` tool only produces a card for
  the operator to confirm. No engine's output can run one past that card.
- **An engine only chooses among typed options.** A choice outside them, an error, a timeout or
  low confidence moves on, and it ends in one clarifying question.
- **A decision authorizes nothing.** Whatever it routes to keeps its own gates.
- **Every decision reports its latency,** so slow routes stay visible.

## What it must fix first

Replaying the 30 probe questions through today's router recognizes none of them as questions
(R1-F13): they come back unclear or as work, and Clarify First creates a review item. Read-only
question routes have to exist before this reaches an operator.

**`arcadia ask` is not capture.** It can create a Project at high confidence (`src/commands/ask.ts`,
R1-F6). A read-only route must never call it. Any capture route needs a path that can't change
Project state, proved against hostile input.

## Open

- The caller, which depends on CH-03.
- Time budgets, which the operator sets from a measured baseline.
- Launch cost: about 0.5 s of a compiled `arcadia` run is importing the whole CLI, and the lookup
  itself takes about 150 to 320 ms cold, depending on load. A fast caller can't shell out to the CLI on every message.
