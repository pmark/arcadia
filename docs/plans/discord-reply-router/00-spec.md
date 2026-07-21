# Discord Reply Router — Shared Seam Specification

> Extracted because **two** features depend on the same bidirectional Discord
> reply machinery: the [Daily Orientation Packet](../daily-orientation-packet/01-spec.md)
> correction loop and the [Image Playground Phase 1b](../playground-image-loop/02-phase-1b-discord-subscriber.md)
> subscriber. This is the single owner of that machinery; both features are
> **consumers**. Specification only — not implemented.

## Why this exists

Both features independently need: outbound `messageId → target` mapping,
per-user-ID authorization, reaction acknowledgements, downtime-tolerant delivery,
and threaded-reply routing. Only the *handler* (what a reply means) differs.
Building it twice guarantees drift. This spec factors out everything except the
handler.

## Scope

A small module inside [apps/discord-bot](../../../apps/discord-bot) that owns:

1. **Message registry** — when any feature posts a message the operator may reply
   to, record `messageId → { feature, entityId, threadId? }` in a state file
   (same mechanism as today's `recordReviewMessage` /
   [notifications/state.ts](../../../apps/discord-bot/src/notifications/state.ts)).
2. **Authorization** — a **user-ID allowlist** (`DISCORD_ALLOWED_USER_IDS`).
   Today authorization is guild+channel only; this adds the per-user gate both
   features require.
3. **Routing** — on `messageCreate` that is a reply to a registered message,
   look up the feature and dispatch to its registered handler.
4. **Acknowledgement** — react to the reply (✅ applied / ❓ needs clarification /
   🚫 unauthorized-or-rejected) on the handler's behalf.
5. **Downtime tolerance** — a cursor/state file so replies and outbound events
   are not lost across bot restarts (the existing poller pattern).

## Non-goals

- No feature-specific parsing (Loop commands, ledger ops) — those live in the
  handlers.
- No new event bus; consumers still emit domain `events` and the bot polls with a
  cursor (`events` is a log, not pub/sub — see AGENT_ORIENTATION).
- No auth beyond the allowlist (Arcadia has no identity layer).
- Does not own scheduling or composition — features push their own messages.

## Contract

```ts
export type ReplyFeature = 'playground' | 'orientation';

export interface RegisteredMessage {
  messageId: string;
  feature: ReplyFeature;
  entityId: string;          // loopId | orientationEntryId | packetId | 'ledger'
  threadId?: string;
  createdAt: string;
}

export interface IncomingReply {
  feature: ReplyFeature;
  entityId: string;
  authorId: string;
  text: string;
  messageId: string;         // the reply's own id (idempotency)
  inReplyTo: string;         // the registered message id
}

export type ReplyAck =
  | { kind: 'applied'; note?: string }        // ✅ + optional in-thread note
  | { kind: 'clarify'; question: string }     // ❓ + question
  | { kind: 'rejected'; reason: string };      // 🚫 + reason

export interface ReplyHandler {
  (reply: IncomingReply): Promise<ReplyAck>;
}

export interface DiscordReplyRouter {
  register(message: RegisteredMessage): Promise<void>;
  registerHandler(feature: ReplyFeature, handler: ReplyHandler): void;
  // called from messageCreate; resolves author + registered target, authorizes,
  // dispatches, and applies the reaction ack. Never throws into the gateway.
  handle(message: import('discord.js').Message): Promise<void>;
}
```

## Authorization & failure rules

- Author not in `DISCORD_ALLOWED_USER_IDS` **and** replying to a registered
  message → `🚫`, no handler call, log.
- Reply to an **unregistered** message → ignored by the router (falls through to
  today's `handleArcadiaMessage`, unchanged — no behavior regression).
- Handler throws or a downstream CLI/Intelligence call fails → router catches,
  reacts `❓`/`🚫` per the returned/typed error, **leaves the cursor unadvanced**
  so the reply is retried, never crashes the gateway (matches the poller's
  try/catch discipline).
- Duplicate delivery of the same reply `messageId` → no-op (idempotency).

## How each consumer uses it

- **Image Playground 1b:** on posting a per-iteration embed, `register({ feature:
  'playground', entityId: loopId, … })`; its handler maps `stop`/`accept`/free-text
  to Loop commands/feedback and returns a `ReplyAck`.
- **Daily Orientation:** on posting the morning packet, `register({ feature:
  'orientation', entityId: 'ledger', … })`; its handler runs the one Intelligence
  interpretation call and returns `applied` / `clarify` / `rejected`.

Both features drop their bespoke allowlist/state/reaction logic and keep **only**
a `ReplyHandler`.

## Test plan

- Author allowlist: allowed vs disallowed; disallowed never reaches a handler.
- Registered vs unregistered reply: unregistered falls through unchanged.
- Dispatch: a `playground` reply reaches the playground handler, `orientation`
  the orientation handler; `entityId` passed through.
- Ack mapping: `applied → ✅`, `clarify → ❓`, `rejected → 🚫`.
- Idempotency: duplicate reply id applied once.
- Isolation: a throwing handler is caught, cursor unadvanced, gateway alive.

## Open questions

- Do the two features share one Discord channel (distinguished only by
  registration) or one channel each? (Registration works either way.)
- Should acks also include an in-thread text reply, or reaction-only for terse
  features? (Recommend: reaction always, text when the handler returns a note.)
- Is `ReplyFeature` a closed union (compile-time) or a string registry
  (open)? (Closed union recommended while there are two consumers.)
