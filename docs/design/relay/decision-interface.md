# Relay decision interface: contract

**Status:** a written contract, not code. The operator asked for this interface to be built
first. Critic finding R1-F1 showed it has no caller on a standard coding-agent session, because
the model reads each message before anything could route it. So no routing code ships until
CH-03 names a caller. This file answers S008's request to figure out the interface, and is
what that code would implement.

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
- **Rules first.** An engine is consulted only when rules abstain, within one shared budget.
  A hung engine can't hang the caller.
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
