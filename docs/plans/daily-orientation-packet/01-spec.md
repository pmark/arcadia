# Daily Orientation Packet — Specification

> Depends on [00-findings.md](./00-findings.md) and the shared
> [Discord Reply Router](../discord-reply-router/00-spec.md).
> Specification only — not implemented.

Three parts: a **Context Ledger** (what is currently true), a scheduled
**Morning Packet** (a short daily Discord message), and a **Correction Loop**
(replies parsed into ledger operations). The goal is orientation, not tracking.

## Scope

- A small typed store (~10 live entries) of the operator's current context across
  life areas, with priority, horizon, and **staleness as a first-class fact**.
- One scheduled, skimmable Discord message per day that surfaces urgent + newly
  due items, **approaching items early** (the anti-procrastination mechanism),
  one line per active area, stale entries **as confirmation questions**, and **at
  most one** honest neglect flag.
- A reply → ledger-operation loop (one Intelligence-routed model call) that
  echoes back what it understood and refreshes `last_confirmed_at` on every
  touched entry.
- Reuse of the shared Discord reply router; **no duplicated reply machinery**.

## Non-goals

- **Not a todo/task manager.** Entries are orientation facts, not executable
  Actions. The ledger never writes to `work_items` and entries are never
  planned or Run. It holds ~10 things, not hundreds.
- **Not comprehensive capture.** Raw capture stays in the ask/intake →
  `back_burner_items` pipeline; the ledger is the curated top-of-mind subset.
- Not a replacement for `selectDailyAdvantage()` (project-execution selector);
  the packet may cite it as one line.
- No new scheduler engine, no new Discord push framework, no auth system (there
  is none — `source` is an ingress label).
- Not multi-user; single operator.

## Reuse vs. add

**Reuse:** launchd plist-builder pattern (`buildIngressServicePlist`); the bot's
`channel.send` + message-state; the generic `events` table
(`source_module="orientation"`); the **Intelligence service** as a companion app
(`submitIntelligenceRequest`, `text.generate`, `execution: "local-preferred"`,
a JSON `outputContract`); `createId()`/`nowIso()`; CLI envelope
`createSuccess`/`createFailure`; the shared reply router.

**Add:** ledger tables + `ensure*` migration; a `PacketComposer`; a
`ReplyInterpreter` (the one Intelligence call + op applier); an
`arcadia orientation …` CLI group; a `buildOrientationServicePlist`;
`ORIENTATION_*` error codes; an Orientation handler registered with the reply
router.

## Ledger schema

Additive `ensureOrientationTables()` in `src/db/schema.ts` (per the
schema-source rule). Two tables + reuse of `events`.

```sql
CREATE TABLE IF NOT EXISTS orientation_entries (
  id              TEXT PRIMARY KEY,            -- createId("orientationEntry")
  entry_type      TEXT NOT NULL CHECK (
    entry_type IN ('active_concern','standing_responsibility','time_bound','parked_idea')
  ),
  title           TEXT NOT NULL,              -- the ~one-line fact
  detail          TEXT,                       -- optional longer context
  area            TEXT,                        -- free-form life area: 'work','art','family','ideas',…
  project_id      TEXT,                        -- optional link (NEVER mutated by the ledger)
  priority        TEXT NOT NULL CHECK (priority IN ('low','normal','high','critical')),
  horizon         TEXT NOT NULL CHECK (horizon IN ('now','soon','later','someday')),
  due_at          TEXT,                        -- hard date; required when entry_type='time_bound'
  status          TEXT NOT NULL CHECK (status IN ('active','confirmed','completed','dropped')),
  last_confirmed_at TEXT NOT NULL,             -- staleness anchor; refreshed on any human touch
  asserted_at     TEXT NOT NULL,               -- when first asserted (never moves)
  source          TEXT NOT NULL,              -- ingress label: 'cli'|'discord'|'admin'|'seed'
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

-- Append-only record of each daily packet actually sent (idempotency guard + history).
CREATE TABLE IF NOT EXISTS orientation_packets (
  id              TEXT PRIMARY KEY,            -- createId("orientationPacket")
  local_date      TEXT NOT NULL UNIQUE,        -- 'YYYY-MM-DD' in the operator's tz; the once-per-day guard
  body            TEXT NOT NULL,              -- rendered message text
  entry_snapshot_json TEXT NOT NULL,           -- ids + staleness at compose time (provenance)
  discord_message_id TEXT,                     -- set once pushed; NULL if compose-only
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orientation_entries_status ON orientation_entries(status);
CREATE INDEX IF NOT EXISTS idx_orientation_entries_type ON orientation_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_orientation_entries_due ON orientation_entries(due_at);
```

TypeScript (mirrors `types.ts` const-union conventions):

```ts
export const ENTRY_TYPES = ['active_concern','standing_responsibility','time_bound','parked_idea'] as const;
export type OrientationEntryType = typeof ENTRY_TYPES[number];
export type OrientationPriority = 'low'|'normal'|'high'|'critical';
export type OrientationHorizon = 'now'|'soon'|'later'|'someday';
export type OrientationStatus = 'active'|'confirmed'|'completed'|'dropped';

export interface OrientationEntry {
  id: string;
  entryType: OrientationEntryType;
  title: string;
  detail?: string;
  area?: string;
  projectId?: string;
  priority: OrientationPriority;
  horizon: OrientationHorizon;
  dueAt?: string;
  status: OrientationStatus;
  lastConfirmedAt: string;
  assertedAt: string;
  source: 'cli'|'discord'|'admin'|'seed';
  createdAt: string;
  updatedAt: string;
}
```

## Staleness / decay rules

Staleness is derived, never stored as a status. Given `now`, an entry's
**staleness age** = `now − last_confirmed_at`. It becomes **stale** when the age
exceeds a per-horizon threshold:

| horizon | stale after |
|---|---|
| `now` | 2 days |
| `soon` | 7 days |
| `later` | 21 days |
| `someday` | 60 days |

Rules:
- A stale entry is **never asserted as fact** in the packet — it is rendered as a
  **confirmation question** ("Still true that X?"). This is the "degrade into
  questions" requirement.
- Any human touch (confirm / update / reprioritize) sets `last_confirmed_at = now`
  and clears staleness. `confirmed` status is a convenience label; the timestamp
  is the source of truth.
- `completed`/`dropped` entries leave the live set and never appear in packets.
- Thresholds are configuration, not hardcoded per entry.
- **Neglect** = an entry stale for ≥ 2× its threshold. At most **one** neglect
  flag per packet (the single most-overdue), phrased honestly, never nagging.

## Packet composition rules

Composed by `PacketComposer` from a **consistent read snapshot** of live entries
(`status IN ('active','confirmed')`). Sections, in order, each omitted when empty:

1. **Due / urgent** — `time_bound` with `due_at ≤ now` or `priority='critical'`.
2. **Approaching** (anti-procrastination core) — `time_bound` whose `due_at`
   falls within a **lead window keyed to priority** (e.g. critical 14d, high 7d,
   normal 3d, low 1d) *before* it is due. Surfaced **while still cheap**.
3. **By area** — one line per `area` that has active entries: the area name + its
   highest-priority live title.
4. **Confirmations** — stale entries as questions (bounded, e.g. ≤ 3/day, oldest
   first) so the packet stays skimmable.
5. **Neglect** — at most one flag (see staleness rules), or nothing.

Constraints: one short Discord message; degrades to questions over assertions;
composition is **read-only** over the ledger (never mutates entries); the
`selectDailyAdvantage()` line may be included as an optional project-work footer.

The composer output is deterministic given the snapshot (no model call) — the
model is used only in the correction loop, keeping packet generation cheap and
testable. (**OQ:** whether phrasing polish uses one optional Intelligence call.)

## Correction-loop / reply-parsing contract

A reply routed to the Orientation handler by the shared router
([discord-reply-router](../discord-reply-router/00-spec.md)) is interpreted by
**one Intelligence job**:

- `capability: "text.generate"` (note: `text.classify` is **unconfigured** by
  default — use `text.generate` with a JSON schema), `execution: "local-preferred"`,
  `clientApp: "arcadia-orientation"`, `outputContract.jsonSchema` = the op list
  below, `input` = `{ replyText, ledgerSnapshot }`.

```ts
type LedgerOp =
  | { op: 'add';          entry: Partial<OrientationEntry> & { title: string; entryType: OrientationEntryType } }
  | { op: 'update';       entryId: string; fields: Partial<OrientationEntry> }
  | { op: 'complete';     entryId: string }
  | { op: 'reprioritize'; entryId: string; priority: OrientationPriority }
  | { op: 'confirm';      entryId: string }
  | { op: 'context';      text: string };   // free-form; recorded, may add/update at low confidence

interface ReplyInterpretation {
  ops: LedgerOp[];
  echo: string;                 // human-readable "here's what I understood"
  confidence: number;           // 0..1
  ambiguous?: { question: string };
}
```

Application order: validate every op against the current ledger **before writing
any** (all-or-nothing per reply); apply; set `last_confirmed_at = now` on each
touched entry; emit an `events` row per op (`source_module="orientation"`); reply
in-thread with `echo`; ack with a reaction (via the router). Every accepted reply
refreshes staleness on the entries it touched.

### Failure behavior (required)

| Situation | Behavior |
|---|---|
| **Ambiguous reply** | Do **not** mutate. Post `ambiguous.question` (or the `echo` framed as a question) and wait for the next reply. `ORIENTATION_REPLY_AMBIGUOUS`. |
| **Parse failure** (invalid JSON / schema-invalid / job `failed`) | Do **not** mutate. Reply "couldn't parse that — rephrase?" with a 🚫/❓ reaction. `ORIENTATION_REPLY_UNPARSEABLE`. |
| **Intelligence unreachable/blocked** (`LITELLM_UNAVAILABLE`, route not configured) | Do **not** mutate. Reply "can't reach the local model right now — try again shortly." Log; leave the router cursor unadvanced so it is not lost. `ORIENTATION_INTERPRETER_UNAVAILABLE` (blocked/retryable). |
| **Op references a missing entry** | Reject the whole reply (all-or-nothing), echo which entry was not found. `ORIENTATION_ENTRY_NOT_FOUND`. |
| **Reply arrives while a packet is being (re)generated** | No lock contention: packet composition is **read-only** and the reply writes to the ledger. The reply applies immediately; the in-flight packet used an earlier snapshot and is unaffected; the **next** packet reflects the change. If the reply targets an entry the packet just asked to confirm, the confirmation still applies cleanly (timestamp refresh is idempotent). |
| **Duplicate/retried delivery** | The router's message-state + a per-reply idempotency key make re-application a no-op. |

## State transitions

Entry: `active → confirmed` (on any confirm/update; reversible to stale by time)
→ `completed` | `dropped` (terminal, leaves the live set). `confirmed` and
`active` are both "live"; the distinction is cosmetic — staleness is time-derived.
Packet: composed → (optionally) pushed; one terminal `orientation_packets` row
per `local_date` (UNIQUE enforces once-per-day).

## Error codes

`ORIENTATION_*` (per-module convention; `blocked`=retryable, `failed`=terminal):
`ORIENTATION_ENTRY_NOT_FOUND`, `ORIENTATION_LEDGER_FULL` (soft cap guard, e.g.
> N live entries — warns, does not hard-fail), `ORIENTATION_PACKET_ALREADY_SENT`
(the daily idempotency guard tripped), `ORIENTATION_REPLY_AMBIGUOUS`,
`ORIENTATION_REPLY_UNPARSEABLE`, `ORIENTATION_INTERPRETER_UNAVAILABLE`.

## Test plan

Vitest, temp-workspace SQLite, deterministic.

- **Staleness (unit):** per-horizon thresholds; "confirmed yesterday" not stale
  vs "asserted three weeks ago" stale; a confirm refreshes and clears staleness;
  neglect = ≥2× threshold, at most one flag chosen (most overdue).
- **Packet composition (unit, deterministic):** section ordering + omission;
  approaching-window per priority surfaces an item *before* due; stale entries
  render as questions, never assertions; ≤ N confirmations; one short message.
- **Once-per-day guard:** second compose on the same `local_date` →
  `ORIENTATION_PACKET_ALREADY_SENT`; a new local day composes again; downtime
  catch-up produces exactly one packet.
- **Reply interpretation (unit, stubbed Intelligence):** each `LedgerOp` applied;
  all-or-nothing on a missing entry; touched entries get refreshed
  `last_confirmed_at`; one `events` row per op.
- **Reply failure paths:** ambiguous → no mutation + question; unparseable → no
  mutation + prompt; interpreter unavailable → no mutation + cursor not advanced;
  reply during packet compose → ledger write applies, in-flight packet unaffected.
- **Boundary (regression):** no ledger operation writes to `work_items`; a
  `project_id` link is never mutated.
- **Integration:** seed → compose → (fake) push → threaded reply → interpret →
  ledger updated → next-day packet reflects it, all over a temp workspace with a
  stubbed Discord channel and a stubbed Intelligence job.

## Open questions

Carries **OQ-1…OQ-6** from [00-findings.md](./00-findings.md), plus:

- **OQ-7:** the live-entry soft cap (~10?) — warn only, or refuse `add` past it
  and ask which to drop?
- **OQ-8:** areas — free-form strings, or a small fixed enum tied to Projects/
  Domains? (Free-form recommended initially.)
- **OQ-9:** local timezone source for `local_date` / due comparisons (env,
  config, or system tz?).
- **OQ-10:** does the packet include the `selectDailyAdvantage()` project line by
  default, or is that opt-in?
- **OQ-11:** should a `context` op that the model can't confidently structure be
  parked in `back_burner_items` (reusing existing capture) rather than dropped?
