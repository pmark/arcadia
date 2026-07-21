# Phase 1b — Discord Subscriber

> Depends on Phase 1 schemas ([01](./01-phase-1-bounded-loop-primitive.md)) and
> the conflicts in [00](./00-findings-and-conflicts.md) (esp. C6, C7, C8).
> Specification only — not implemented.

## Scope

Extend [apps/discord-bot](../../../apps/discord-bot) to make a Loop observable and
steerable from Discord:

- post a per-iteration **embed** with the generated **image attachment** and the
  evaluation rationale;
- persist the posted **message ID** on the iteration record for reply threading;
- parse **threaded replies** into either a **command** (`stop`, `accept`) or
  **feedback** (free text → `submitLoopFeedback`);
- authorize by **user-ID allowlist**;
- **acknowledge** with reactions (✅ accepted / 👀 feedback queued / 🚫 unauthorized);
- guarantee a notification failure **never** fails a Loop (they are separate
  processes — the bot polls).

## Non-goals

- No changes to the Loop state machine itself (Phase 1 owns it).
- No new event bus; the bot **polls** an events cursor (conflict **C6**) — the
  `events` table is a log, not pub/sub.
- No direct DB access from the bot; it stays **bot → CLI (JSON) → DB** (**C7**).
- No Asset/R2 (Phase 3). Images are attached from the local artifact path.

## Reuse vs. add

**Reuse as-is:**
- `startNotificationPoller` structure ([notifications/poller.ts](../../../apps/discord-bot/src/notifications/poller.ts))
  — state-file cursor, downtime-tolerant re-send, active/idle poll intervals.
- `ArcadiaCli` shell-out wrapper ([arcadia/cli.ts](../../../apps/discord-bot/src/arcadia/cli.ts))
  and the `CommandSuccess<TData>` JSON envelope.
- Reply→parent mapping via a state file, exactly as `recordReviewMessage` /
  `loadReviewMessageState` do today.
- `discord.js` `Client` (already wired with `MessageContent` intent).

**Add:**
- CLI commands the bot calls (Phase 1 or a thin addition here):
  `arcadia playground loop events --since <cursor> --json` (returns new
  `playground.*` events with the iteration's artifact `relative_path` + `/api/intelligence/artifacts/:id` URI),
  and `arcadia playground loop feedback <loopId> <text> --source discord --json`,
  `arcadia playground loop stop <loopId> --json`,
  `arcadia playground loop accept <loopId> --json`.
- An embed formatter (`formatIterationEmbed`) alongside the existing
  `src/formatters/*`.
- A user-ID allowlist config field.
- A `playground-loop` message-state file mapping `messageId → { loopId, iterationId }`.
- Reaction acknowledgements and threaded-reply routing.

## Concrete types

```ts
// New bot config fields (extends BotConfig in apps/discord-bot/src/config.ts)
export interface PlaygroundBotConfig {
  allowedUserIds: string[];          // DISCORD_ALLOWED_USER_IDS (comma-separated)
  playgroundChannelId: string;       // channel loops post to
}

// Persisted so a threaded reply resolves to the right loop/iteration.
export interface PlaygroundMessageState {
  messages: Record<string /* discord messageId */, {
    loopId: string;
    iterationId: string;
    iterationIndex: number;
    createdAt: string;
  }>;
  cursor: string | null;             // last consumed event id/created_at (downtime-tolerant)
}

// A parsed threaded reply.
export type ParsedReply =
  | { kind: "command"; command: "stop" | "accept"; loopId: string }
  | { kind: "feedback"; text: string; loopId: string }
  | { kind: "unauthorized" }
  | { kind: "ignored" };            // not a reply to a tracked message
```

Embed contents per iteration: title `Loop <shortId> · iteration <n>/<max>`,
description = `effectivePrompt`, fields = evaluation `score`/`rationale`, image =
the attached PNG, footer = loop status. Terminal `playground.loop.terminated`
posts a closing message stating `status` + `terminalReason`.

## Command parsing

A reply is authorized only if `message.author.id ∈ allowedUserIds` **and**
`message.reference.messageId` maps to a tracked iteration message. Then:

- reply body matches `/^\s*(stop|accept)\s*$/i` → `command`;
- otherwise → `feedback` (the raw body).

Unauthorized replies to a tracked message get a 🚫 reaction and no action.
Replies to untracked messages are ignored (falls through to existing
`handleArcadiaMessage`, unchanged).

## Push path & downtime tolerance (C6)

Each poll tick: `arcadia playground loop events --since <cursor>` → for each new
event, post/attach as appropriate, advance `cursor`, persist state. Because the
cursor only advances after a successful post, **events emitted while the bot is
down are delivered on reconnect** — no separate retry queue. A failed
`channel.send` leaves the cursor unadvanced and is retried next tick; it is
logged, never thrown into the Loop (separate process).

## Error handling

The bot has no `PLAYGROUND_*` domain codes of its own; it surfaces CLI failures.
Rules:

- CLI call fails → log (`logJson("error", …)`), leave cursor unadvanced, retry
  next tick. Never crash the poller (matches existing `tick()` try/catch).
- `submitLoopFeedback` on a terminal loop returns `PLAYGROUND_LOOP_NOT_RUNNING`
  → reply in-thread "loop already finished", 🚫 reaction, do not retry.
- Attachment file missing on disk → post the embed without the image + a warning
  line; do not fail the tick.

## Test plan

Extends [tests/discord-bot.test.ts](../../../tests/discord-bot.test.ts)
(pure-function tests over formatters/parsers; no live Discord).

- **Command parsing:** `stop`/`accept` (case/whitespace variants) vs free-text
  feedback; reply to untracked message → `ignored`.
- **Authorization:** author not in allowlist → `unauthorized` (🚫), no CLI call;
  author in allowlist + tracked message → routed.
- **Late-arriving feedback:** feedback posted after the loop terminated →
  `PLAYGROUND_LOOP_NOT_RUNNING` handled gracefully.
- **Events while Discord is down:** given a cursor and a backlog of events, all
  are delivered in order on the next tick and the cursor advances exactly to the
  last successfully-posted event; a mid-batch send failure leaves the cursor at
  the last success (no gaps, no dupes).
- **Notification failure isolates:** a throwing `channel.send` is caught, logged,
  and the tick reschedules — asserting the Loop process is untouched.
- **Message-state mapping:** posting an iteration records `messageId → iterationId`;
  a reply resolves back to the right `loopId`.

## Open questions (this phase)

- **Q7/Q10:** does the bot attach the image by local `relative_path`, or fetch
  `/api/intelligence/artifacts/:id` (requires the Intelligence HTTP server running
  beside the bot)? Recommend local path (same machine, launchd).
- Which reactions carry meaning, and should ✅ on the bot's own message (by an
  allowed user) also count as `accept`?
- Should each Loop post to its **own thread** (cleaner) rather than inline in the
  channel? Threads are unused today (**C8**) — additive but new.
- Do slash commands (`/loop start`) belong here or in a later phase? (Out of
  scope as written — 1b is a *subscriber*, not an initiator.)
