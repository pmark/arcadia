# Daily Orientation Packet — Findings

> Grounding pass for the "Today/Now" feature. Answers the five investigation
> questions before the spec ([01-spec.md](./01-spec.md)). Verified against code
> at `PRAGMA user_version = 8`. **Not implemented — specification only.**

See also the reusable architecture facts in
[docs/AGENT_ORIENTATION.md](../../AGENT_ORIENTATION.md).

---

## Q1 — Scheduler / cron capability

**DOES NOT EXIST as a general engine. EXISTS as a launchd-poller pattern.**

- There is no cron, no time-trigger table, no internal job scheduler that fires
  work at a wall-clock time.
- Recurring background work runs as **long-lived launchd processes that poll on
  an interval**:
  - the execution worker (`src/commands/worker.ts`, `POLL_INTERVAL_MS = 2000`,
    pidfile + heartbeat under `.arcadia/`);
  - the Discord bot (`apps/discord-bot`, `setTimeout` poll loop);
  - the ingress service, whose plist Arcadia **generates itself** —
    `buildIngressServicePlist()` in [ingressService.ts](../../../src/commands/ingressService.ts)
    emits `RunAtLoad` + **`StartInterval`** (seconds) + `ProcessType Background`.
- Domain-specific scheduling exists but is not a generic trigger: `blog_schedules`
  / `blog_posts.scheduled_for` (a `TEXT` timestamp column the blog stage machine
  reads), and `selectDailyAdvantage()` (a *selector*, see Q4). Neither fires a job.

**Implication:** the morning packet needs a scheduled trigger that does not exist.
Two viable shapes, both reusing the existing plist-builder pattern:

1. **Date-guarded `StartInterval` poller** (recommended, most consistent): a
   launchd service ticks every N minutes and runs `arcadia orientation packet
   --if-due`, which is **idempotent per local day** — it composes and pushes at
   most once per day after a configured local time, recording the send. Survives
   sleep/downtime (the next tick after wake catches up), matching how the ingress
   service already tolerates gaps.
2. **`StartCalendarInterval` plist** (fires at, e.g., 07:00 daily). Cleaner
   semantically but a launchd feature Arcadia does not use today, and it does not
   self-catch-up if the machine was asleep at 07:00.

Recommend (1): reuse `buildIngressServicePlist`'s structure, add a
`buildOrientationServicePlist`, and put the "once per day" guard in the DB, not
in launchd.

## Q2 — Outbound Discord push today, concretely

`startNotificationPoller()` ([notifications/poller.ts](../../../apps/discord-bot/src/notifications/poller.ts)):

- Every tick, loads CLI JSON snapshots (`status`/`review`/`queue`/`runs`/
  `milestones`/`codex`) via `ArcadiaCli` (shell-out), **diffs against a state
  file** (`notificationStatePath`), and for each new item calls
  `channel.send({ content })` on **one configured channel** (`discordChannelId`).
- Output is **plain strings only** — no embeds, attachments, reactions, or
  threads. Review→messageId is persisted (`recordReviewMessage`) so a threaded
  reply can be mapped back to a Decision.
- Inbound: `messageCreate` → `cli.ask(content, { sourceIngress: "discord.message", replyReviewId })`.
  Authorization is **guild + channel only** — no per-user allowlist.

The packet is a *composed* daily message (not a diff of new items), so it does
**not** fit the existing diff-poller directly. It should be **pushed by the
scheduled `orientation packet` job** (Q1), which produces the message and hands
it to the bot to send — reusing the bot's `channel.send` + message-state
machinery, not the diff loop.

## Q3 — Where the ledger should live

New **capability-local tables**, following the established pattern for
feature-owned state (`back_burner_items`, `blog_*`, `rebuster_*`): `TEXT` id from
`createId("<prefix>")`, ISO timestamps from `nowIso()`, `TEXT ... CHECK (...)`
enums, additive `ensure*` migration registered in
[src/db/schema.ts](../../../src/db/schema.ts) `applyMigrations()` (per the
schema-source rule in AGENT_ORIENTATION). Concrete schema in
[01-spec.md](./01-spec.md). Audit via the generic `events` table
(`source_module = "orientation"`), consistent with `coreApi.emitEvent`.

## Q4 — Overlap with existing capture / ingress / artifact types

The ledger risks duplicating three existing systems. The boundary must be drawn
explicitly (the user's own constraint: "not another todo system").

| Existing | What it is | Overlap & ruling |
|---|---|---|
| `work_items` (queues `inbox`/`work_queue`/`requires_review`/`needs_mark`/`blocked`) | The **task/execution** system — Actions that produce Artifacts, get planned and Run. | **Highest collision risk.** "Standing responsibilities" and "time-bound items" look like tasks. **Ruling:** the ledger holds *orientation state* (~10 things I'd juggle mentally), NOT executable Actions. A ledger entry may *reference* a `work_item`/`project` but is not one and is never planned/Run. Do not write to `work_items` from the ledger. |
| `back_burner_items` (`classification` incl. `Idea`, `IncubatingThought`, `ArcadiaFeedback`; `status` `incubating`/`opportunistic`/`promoted`/`archived`; `ingress_source`) | Captured-but-not-yet-actioned inputs from the ask/intake pipeline. | **"Parked ideas" overlaps directly.** Ruling/OQ: either (a) parked-idea ledger entries are a **view over** `back_burner_items` (no new storage), or (b) the ledger owns its own parked-idea entries and back-burner stays the raw capture log. Recommend (a) to avoid two idea stores. See **OQ-3**. |
| `selectDailyAdvantage()` ([dashboard/dailyAdvantage.ts](../../../src/dashboard/dailyAdvantage.ts)) | Picks **one** codex-plannable Action to prepare today (project-execution domain). | Conceptual cousin ("today's one thing") but a *different domain* — project/codex work, not personal life/art/family context. **Ruling:** the packet may include the Daily Advantage as one line, but the ledger does not absorb or replace it. |
| `ask`/intake/stewardship classification (`src/commands/ask.ts`, `src/intake/`) | **Deterministic-first** normalization + classification of captured input into back-burner categories. | The correction loop proposes **one explicit Intelligence model call** instead. This is a deliberate divergence from "prefer deterministic before AI" — justified only for free-form context updates the deterministic classifier can't structure. See **OQ-5**. |
| domain `artifacts` | Persisted, referable work outputs. | A packet *could* be persisted as an Artifact (`artifact_type='orientation_packet'`) for history. Optional; see **OQ-6**. |

## Q5 — Sharing the reply-routing seam with the Image Playground

**Yes — extract it now.** Two features (this feature's correction loop and the
Image Playground's [Phase 1b](../playground-image-loop/02-phase-1b-discord-subscriber.md))
independently need the identical machinery:

1. map an outbound `messageId → { feature, entityId }`;
2. authorize an inbound reply by a **user-ID allowlist**;
3. route the reply to a **feature-specific handler**;
4. **acknowledge with reactions**;
5. tolerate downtime (cursor/state file).

Only step 3's handler differs (Playground: `stop`/`accept`/feedback on a Loop;
Orientation: parse into ledger ops). Duplicating 1/2/4/5 in both would drift.

**Recommendation:** promote the seam to its own spec —
[docs/plans/discord-reply-router/](../discord-reply-router/00-spec.md) — a small
router in the bot that owns message-state, allowlist auth, reaction acks, and a
`registerReplyHandler(feature, handler)` registry. The Image Playground 1b spec
and this feature both **consume** it; neither owns it. This makes the router a
**shared prerequisite** in the consolidated build order
([docs/plans/BUILD_ORDER.md](../BUILD_ORDER.md)).

---

## Open questions (carried into the spec)

- **OQ-1 (scheduler shape):** date-guarded `StartInterval` poller vs
  `StartCalendarInterval`? (Recommend the former.)
- **OQ-2 (delivery ownership):** does the scheduled `orientation packet` job push
  via the bot process, or write a "packet ready" event the bot's cursor delivers?
- **OQ-3 (parked ideas):** view over `back_burner_items`, or ledger-owned entries?
- **OQ-4 (ledger vs work_items boundary):** may a ledger entry link to a
  `work_item`/`project`, and does completing a ledger entry ever touch them? (Recommend: link-only, never mutate.)
- **OQ-5 (AI vs deterministic parse):** is one Intelligence call per reply
  acceptable given the deterministic-first default, and what is the fallback when
  it is unreachable/blocked?
- **OQ-6 (packet persistence):** persist each packet as a domain Artifact for
  history, or keep only the send record?
