# S003: Agent's first plan, 2026-11-02

Written by Claudia Atlas before Arcadia Design's gaps were filled, and before the name
and the first-time operator requirement. It earns no privilege over other sources. It
calls the module "Arcadia Thread", a working label now replaced by Relay.

## Recommendation

Build one continuous operator thread first, then have it watch group channels as a
silent observer that reports only to the operator. Arcadia speaks in a group only after
a separate Decision allows it.

## The concept in the abstract

There are two layers: the Dot idea is about the operator's experience (one continuous
thread, with sessions hidden), and the DeepSeek idea is about how events become work
(many source conversations, filtered down to authorized work). Together: one thread for
the operator and many channels behind it.

DeepSeek's six mechanisms, with Arcadia's state at the time:

| Mechanism | What it does | Arcadia then |
| --- | --- | --- |
| Source and Trigger | Turns each channel event into one immutable, deduplicated record | Partial: Ask capture envelopes, Discord bot, Ingress |
| Gate, then assessment | Code checks who sent it and whether they addressed the agent; only then does a model judge it | Partial: the allowlist exists but fails open when empty |
| Mandate | Records why the work is allowed and how far it may go | Stronger: Agent Asks, Decisions, Grants |
| Subscription | Later messages reach the work without mentioning the agent again | Partial: only replies to receipts and Decisions |
| `observe` mode | Records "would have accepted" without acting | Missing |
| Attention rule | Speaks only when someone must act or can use a result | Partial: to-do list and pings |

## Gaps named

1. No server-side conversation.
2. Ask returns receipts, not answers.
3. Proactive updates live in `/workspace/feed`, not a conversation.
4. Follow-ups don't reach the work, except replies to receipts and Decisions.
5. Nothing observes a channel safely.

## Architecture proposed

Web/PWA, Discord DM and group channels are normalized and deduplicated, then pass a
deterministic gate with no model. A Decision answer takes the existing path. A follow-up
by explicit reference reaches the linked work. A message addressed by an allowed person
reaches the thread agent. An unaddressed message is an observe record only. All of it
lands in a conversation record (evidence, never authority), and an outbox delivers to one
thread with cards.

Design rules:

- One small new store: an append-only conversation table holding only new facts. Old
  replies stay as written while current status displays separately.
- The thread agent can read and propose, nothing more: its only write tools are
  `arcadia ask`, `agent-ask preview` and `arcadia learn`.
- Cheapest answer first: code, then a local model through LiteLLM with citations, then a
  bounded read-only coding agent.
- Observed group messages only ever go to the local model.
- Follow-ups attach only by explicit reference, never by topic similarity.

## Phases proposed

1. **The Thread:** synced conversation record; code-answered status questions; feed items
   as messages; Decision, Artifact and Continue cards using existing controls; local-model
   answers.
2. **Follow the work:** the operator's Discord DM joins the same thread; replying to a
   card or Artifact attaches feedback to that work; the allowlist fails closed.
3. **Silent observer:** per-channel policy (`off` or `observe`); read position that
   survives restarts; batched local assessment; candidate cards with Capture or Dismiss,
   plus a draft reply for the operator to send.
4. **Participant, Decision required:** short read-only replies when directly addressed;
   rule-based automatic capture.

## Left out, with revival conditions

- Executor ownership and hand-back: when follow-ups regularly reach the wrong work.
- Automatic resume on a person's message: conflicts with the gate-per-Action model.
- Policy versioning and fan-out: when more than one operator shares a workspace.
- Prompt-editing UI: instruction files already do this.
- Unapproved worker commands: never.
- Slack, Feishu and iMessage: when the first real client needs each.

## Decisions and constraints named

- Sending messages to groups needs a new Decision (Decision 0084 only allows pings to the
  operator).
- Storing client messages needs a Decision on retention and consent.
- The bot accepts any member of the configured channel when its allowlist is empty.
- Two draft Plans overlap: the persistent Go conversation and the Ask superpower Plans.
- Unattended production is still the active milestone.
