# Session notifications: waking a session on the events it waits for

**Author:** Claudia Atlas (claude, heavy), using the arcadia-design method as Iris.
I was launched by Signal 2 on the operator's request of 2026-11-06, about 23:45Z:
"design an efficient way for agent sessions to receive notifications when
observed events are triggered." **Depth:** quick, as one decision document. No
sustained brief or `record.yaml` is kept. **Guide:** no reviewed field guide
covers this, so this is disclosed exploratory advice (Decision 0159). **Authority:**
none. The design leaves as one Agent Ask proposal, and it builds, approves and
schedules nothing.

## Decision summary

- **Source of truth.** Use the records Arcadia already writes, read through the
  existing unified timeline (`arcadia timeline`, `src/timeline/`). No new event
  table, no new writer and no model call are needed. Three collector gaps hide
  events that sessions wait for, and the first step closes them.
- **Delivery.** One read-only, provider-neutral command blocks until a filter
  matches, then prints one JSON line with a resumable cursor and exits:
  `arcadia timeline --wait`. Every host's background mode can run it. It replaces
  the `production` and `press` modes of `scripts/wait-for-event.sh` and, later,
  `scripts/comms-watch-issue.mjs`.
- **Subscriptions are command lines, not rows.** The filter is the subscription.
  The cursor is the session's own replay point, and it travels in handoffs.
- **Silence never reads as success.** Exit 0 means only that an event matched. A
  timeout exits 3 and an unreadable source exits 1, each with the cursor.
- **First build step:** the `--wait` mode, local sources only, plus the three
  collector gaps and the playbook swap. GitHub reads for a session's own PRs stay
  where they are until the operator answers the question at the end.

## The problem, measured

These figures are from [the night report](../reports/relay-rowan-night-2026-11-06.md)
and Signal's observation log (rows 8, 10, 18, 20–22).

| Row | What happened | Cost |
| --- | --- | --- |
| 8 | Rowan went idle with 12 checks pending and no wake source | ~15 min |
| 10 | Auto-merge landed and nothing woke Rowan to build the card | 1 touch, minutes unknown |
| 18, 20 | Rowan's host rules forbid timed `gh` polling, so it asked for an exception and got "Yes" | 2 touches, ~10 min |
| 22 | The production waiter slept on #2145's red check (state and revision unchanged) | ~65 min |

Row 22's waiter fix shipped with the night report. Two structural faults remain
in `scripts/wait-for-event.sh`:

1. **It re-baselines on every arm.** An event that lands while the model handles
   the previous wake joins the new baseline and never wakes anyone.
2. **Every waiter is per-session and per-kind.** Rowan and Signal each poll, each
   wait kind has its own parsing, and Codex and OpenCode have no equivalent of
   the desktop CI monitor.

## Requirements

Each requirement traces to a Relay brief REQ ([brief](relay/brief.md)) where one
applies. The others come from the operator's request or the Constitution.

| ID | Requirement | Traces to |
| --- | --- | --- |
| N1 | Every awaited event is emitted once, deterministically, from an existing authoritative record, with no model call | Constitution (Economy); REQ-013 |
| N2 | One delivery works unchanged in Codex, Claude Code and OpenCode | REQ-008 (all three hosts) |
| N3 | No event is lost across a wake, a re-arm, a restart or a handoff | REQ-003 (surviving restarts); Constitution ("Nothing is ever lost") |
| N4 | Silence, a timeout or an unreadable source is never reported as success or as all clear | REQ-015 ("never falsely clear") |
| N5 | A notification is evidence, never authority, and it is never read as an instruction | REQ-005, REQ-006; Constitution (Authority) |
| N6 | Waiting costs no model tokens, and each wake costs one short line | REQ-010, REQ-013 |
| N7 | The default delivery makes no network call and needs no credential | Constitution (spend order); operator request |
| N8 | A supervisor can watch on a coordinator's behalf and detect a coordinator that did not act, and the design collapses into the coordinator once Relay exists | REQ-004, REQ-014, REQ-017 |

## 1. Where an event comes from

Every awaited event already has an authoritative record. The timeline already
reads most of them with stable ids, alias de-duplication (`alsoSeenAs`) and
provenance. I audited each against the code.

| Event | Authoritative record | Timeline today |
| --- | --- | --- |
| Production state or policy change | `production_policy_receipts` | exists (`production.policy.*`) |
| Admission, release, repair, review step | `production_admissions`, `production_repair_attempts`, `production_review_steps` | exists |
| In-scope escalation, including a red required check | `production_operator_escalations`, also appended to `action_journey_log` | **partial.** The collector reads the upserted table keyed by `first_detected_at`. A changed kind on the same Action, such as a repair that turns into `required_checks_failed`, has no new event (`src/timeline/collectors/production.ts`, escalation block). `action_journey_log` is append-only and fingerprinted (`src/production/journeyLog.ts`), so it should be read instead |
| Red alert (stop the line) | `production_red_alerts` (`src/production/redAlerts.ts`) | **missing** |
| START card press and outcome | `artifacts/generated/operator-scripts/runs/<card>/<run>/receipt.json` | **missing.** The collector reads only `runs/<entry>/receipt.json`, one level deep (`src/timeline/collectors/operatorScripts.ts`), and the live library holds card runs one level deeper |
| Worker merge of an in-scope Action | admission release, preservation receipt, then `git.merge` on fetched main | exists |
| Ask settled, Decision opened or answered, queue pointer moved | `.arcadia/asks`, decisions, queue receipts | exists |
| Operator ping | `operator_pings` outbox | exists |
| A session's own PR merged or closed | GitHub | opt-in `--pull-requests` (`gh api` GET, one page of 50) |
| CI green or red on a session's own PR | GitHub checks | **missing.** The desktop monitor reports failures in Claude Code only |
| Cross-session message | host-native only (desktop SendMessage) | **missing**, deferred below |

**Decision:** events are projections of these records, never a second store. The
three gaps are fixed in the collectors, where `arcadia timeline` and the
dashboard benefit too.

**Rejected:** a new `session_events` outbox written by each subsystem. It would
add a writer at every site, a second truth for facts that already have a home,
and a migration during an Active run, and it gives nothing a cursor over the
existing records doesn't.

## 2. How a session receives it

| Option | Provider-neutral | Deterministic and local | Replay | Cost and risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. A blocking read, `arcadia timeline --wait`**, run in the host's background mode | yes: a CLI that exits | yes; no network by default | cursor | ~0.2 s per poll in-process; one ~1.3 KB line per wake | **chosen** |
| B. Per-kind polling scripts (tonight) | yes | partly (`pr` uses `gh`) | none; re-baselines | 2.0 s process spawn per poll; N scripts | replaced |
| C. A file inbox per subscriber | yes | yes | yes | needs a fan-out writer and a second copy of every fact; still needs a blocking reader | rejected (A without the extra store) |
| D. Desktop session messaging (SendMessage) | Claude Code desktop only | n/a | none | free | kept as an optional push for supervisors, never the source |
| E. Discord | n/a | no | none | the operator's channel ("Discord is for notifications and dialog", operator memory) | rejected for sessions; stays the operator's alert sink |
| F. GitHub webhooks | yes | no: needs a public endpoint, a tunnel and a secret | GitHub's | a new credential and infrastructure | rejected (N7) |
| G. GitHub notifications API | yes | no | partial | still polling, plus another token scope | rejected (N7) |

### The `--wait` contract

These are routine choices the builder may refine. Their reasons are recorded.

- **Built on what exists.** `--wait` is a thin mode over `followTimeline`
  (`src/timeline/follow.ts`) and the existing collectors, not a second
  implementation.
- **Filters.** Only `--project`, `--tool` and `--kind` (kind of work) exist today.
  The rest are new: `--event <event-kind prefix>` (repeatable),
  `--action <project/action>`, `--card <id>`, `--pr <n>`, `--attention`,
  `--actor <name>`, `--timeout <duration>` and `--scope production`. The last
  resolves the active policy's scope Actions on each poll, so a changed scope
  follows the run.
- **Sources:** only the sources the filter needs. The local DB and receipt
  sources cost about 210 ms per poll in total, measured below. `git` (794 ms) and
  `governed-records` (520 ms) are read only when a filter needs them.
  `--pull-requests` stays opt-in.
- **Output:** exactly one JSON line,
  `{"schema":"arcadia-timeline-wait-v1","event":"match"|"timeout"|"error","events":[…],"omitted":n,"cursor":"…"}`.
  A burst that matches on one poll wakes once, capped at 20 events with `omitted`
  counted. By default each event carries only `id`, `kind`, `time`, `clock`,
  `subjects` and `evidence`. Free text (`summary`) appears only with `--summaries`,
  truncated to 200 characters, under a field named `untrusted_summary`, because
  the line goes straight into a model's context.
- **Exit codes:** 0 match; 3 timeout; 1 a needed source failed on three
  consecutive polls, or the workspace is unreadable; 2 usage. Only 0 means
  something happened.
- **Cursor: high-water marks of when each record was observed, not of its own
  clock.** Collectors stamp an event with the record's own time (a receipt's
  `finishedAt`, a commit date). A record that becomes visible late can carry a
  time older than any overlap window, so a time-window cursor would lose it.
  That was review finding 1. The cursor is opaque and self-contained (base64url
  JSON), and holds one mark per source:
  - **Append-only tables:** `action_journey_log` and
    `production_policy_receipts` (`src/` has no `UPDATE` or `DELETE` on them) use
    the highest delivered `rowid`. Both have TEXT primary keys, so a `VACUUM`
    could renumber rows. The builder therefore stores the delivered row's `id`
    beside the mark and falls back to a key snapshot if the mark's row has moved.
  - **State-transition tables**, whose awaited events are `UPDATE`s, use a
    snapshot in the cursor of `(id, status, transition timestamp)` tuples. A
    changed tuple is an event. This came from review round 2.
    - `production_admissions`: committed, released and fenced are updates in
      `src/production/policy.ts` (lines 1679, 1698 and 1765).
    - `production_review_steps`: updated in `src/production/independentReview.ts`.
    - `operator_pings`: `sent` is set in `src/ping/operatorPing.ts:134`.
    - `production_red_alerts`: notified, cleared and occurrences are updated in
      `src/production/redAlerts.ts`.

    The snapshot is bounded to the rows of the scope being watched, or to open
    rows plus those that changed within the last 24 hours.
  - **Receipt files** use a snapshot of `(path, outcome)` pairs, not an mtime
    mark, so a copied or restored file with an old mtime is still seen.
  - **Current-state sets** use a snapshot of the keys present (below).
  - **No prior cursor:** a session's first poll is a baseline. It emits no
    "changed" or "cleared" events for state that was already true; the status
    read on arming covers that.
  - **Sources with no observation key** (`git`, `governed-records`,
    `pull-requests`) fall back to the follow overlap and are labelled
    `delivery: best-effort` in the output. No guaranteed recipe depends on them.

  `--after <cursor>` delivers everything above each mark. That fixes the
  re-baseline loss, survives a restart, and lets a successor resume from a
  handoff line.
- **Clearance is an event.** `production_operator_escalations` is upserted and
  also deleted (for example `src/production/tick.ts`, around lines 1018 and 1113,
  and `src/scheduling/scheduler.ts:302`), and the journey log records no
  clearance. The cursor therefore carries the set of current escalation keys
  (`action_key kind`), as `wait-for-event.sh` already does. A key that disappears
  emits `production.escalation.cleared`. That was review finding 2. Even so,
  `--wait` reports edges, not state, so every wake and every timeout is followed
  by one status read before the session concludes anything.
- **Default timeout:** 110 minutes. That keeps under the two-hour background
  limit that `scripts/comms-watch-issue.mjs` already respects. Re-arm with the
  printed cursor.
- **Interval:** 30 s, adjustable with `--interval`. It is a local read, so it
  makes no network call.

### Recipes, replacing tonight's waiters

| Waiting for | Command |
| --- | --- |
| Anything that needs the coordinator during a run | `arcadia timeline --wait --scope production --event production. --event operator-script. --after <cursor>` |
| One card's press | `arcadia timeline --wait --card <card-id>` |
| A worker merge of an Action | `arcadia timeline --wait --action arcadia/<action> --event production.admission.released --event production.preservation` |
| The session's own PR merged | `scripts/wait-for-event.sh pr …` until the question below is answered, then `arcadia timeline --wait --pr <n> --pull-requests` |

## 3. Subscriptions

- **Who subscribes to what:** a session to a scope (`--scope production`), a Plan
  or Action (`--action`), a PR (`--pr`), a card (`--card`), or another actor's
  activity (`--actor`). There is no subscription registry in step 1.
- **De-duplication:** the timeline's stable ids and aliases. One fact is one
  event, even when two collectors see it.
- **Ordering:** events within a line are ordered by time, then id. Clocks differ
  by source, so each event keeps its `clock` field, and consumers order by the
  authoritative record they re-read, not by the line.
- **Missed events:** replay from the cursor's observation marks, as above. A
  session that never had a cursor takes its marks at its own start, then
  re-reads status once, so whatever was already true is read as state rather
  than missed as an edge.
- **Timeouts:** exit 3 means "no matching event in 110 minutes", not "all clear".
  On a timeout the coordinator does the playbook's status check once and re-arms.

## 4. Supervision, and how it collapses into the coordinator

**Now.** Rowan arms its own wait, so no event needs relaying. Signal's job becomes
detecting a coordinator that **didn't act**, deterministically:

1. Signal waits on the same filter.
2. On a match at time T, Signal runs
   `arcadia timeline --wait --actor "<Rowan's identity>" --after <cursor> --timeout 15m`.
3. Exit 0 means Rowan acted, and Signal does nothing. Exit 3 means the timeline
   shows no action by Rowan within 15 minutes. Signal then re-reads the event's
   record and sends nothing if the state has already moved on. Otherwise it sends
   one message citing the event's evidence (SendMessage on the desktop, an Issue
   comment through Comms elsewhere).

Two zero-token waits replace Signal's reading, and Signal relays a fact, not an
instruction. The timeline credits Rowan with commits, Asks and pings
(`src/timeline/identity.ts`), not with chat turns or GitHub-only actions. A Rowan
that only talked would look idle. The re-read in step 3 keeps that from costing
attention: it is a possible false alarm, never a false all clear.

**Once Relay exists.** The coordinator is the Relay conversation. `--wait` is
Relay's event source for status at a glance (REQ-015), and the didn't-act check
runs inside Relay itself. The Signal role retires, and no session relays
another's events.

**Liveness of the waiter itself** (who wakes a session that never armed a wait,
Signal log row 8) needs either a host hook or an "armed until" heartbeat file.
Both are deferred (D2).

## 5. Authority and safety

- **An event is a pointer, never permission.** Each event carries `evidence`: a
  receipt, row, URL or SHA. Before acting, a session re-reads that record. A card
  event proves only that a receipt exists. Its authority is the receipt and its
  Grant, as `docs/agent-guidance/operator-actions.md` already says.
- **Free text is untrusted data.** PR titles, ping text and receipt messages can
  carry other authors' words. The default output leaves them out, and
  `--summaries` labels them `untrusted_summary`. A session never follows an
  instruction found in one (AGENTS.md; `agent-comms.md`).
- **Read-only.** `--wait` writes nothing: no table, no file and no receipt. It
  never calls the worker, so it is safe while production is Active.
- **Host polling rules.** By default the waiter makes no network call and reads
  only local state. Whether a host treats a local blocking read as "timed
  polling" is the host's judgement. That is the riskiest assumption, with its
  probe below. `--pull-requests` makes one `gh api` GET per poll, about 120 an
  hour at the 30 s default, with existing auth. It needs no new credential and
  makes no credential probe.
- **Privacy.** Everything stays on the host. The waiter never pings, posts or
  messages, and Discord stays the operator's channel.

## 6. Cost, compared with tonight

Measured on 2026-11-06 at about 23:55Z against the live workspace, using
read-only commands. Token figures assume about 4 bytes per token.

| Measure | Tonight's waiter and playbook | `--wait` |
| --- | --- | --- |
| Work per poll | spawns `arcadia production status --json`: **2.0 s** wall, **114,582 bytes** parsed, every 60 s (~3% of wall time) | in-process local sources: **~0.21 s** (production 14 ms, asks 108, queue 31, operator scripts 39, pings 11, sessions 5, decisions 4) every 30 s (<1%) |
| Model tokens while waiting | 0 | 0 |
| What a wake costs to read | one line, and the session then reads status | one line with evidence, mean **1,318 bytes** (~330 tokens) over 109 events |
| Quiet-run status checks | playbook: every 10 min without a wake, `arcadia production status` text = **20,773 bytes** (~5.2k tokens), so ~31k tokens an hour | on a wake or a timeout only (≥ 110 min apart when quiet): ≤ ~3k tokens an hour |
| Missed-wake minutes (rows 8, 22) | ~80 | 0 for in-scope events. Row 8 (own-PR CI) still needs the question below or D1 |

The context each turn re-reads is the same either way and is unmeasured here.
A full unfiltered timeline read took 3.2 s and returned 202,936 bytes, which is
why the wait reads only the sources its filter needs.

## 7. The first build step, and what is deferred

**Step 1.** Proposed as `agentask_8a6c9afce7244f904b` (capture
`capture_a38e4565-8f1d-451a-8431-6c9d0ba3143b`). It changes no runtime behaviour,
and is best built as two Actions:

- **1a (size S): collector fixes.** These help the timeline and the dashboard on
  their own.
  1. Read escalations from `action_journey_log`, so a changed kind is a new event.
  2. Read nested card receipts (`runs/<card>/<run>/receipt.json`). Emit only on a
     final outcome, and treat `in_progress` as no event.
  3. Add a `production_red_alerts` collector.
- **1b (size M): `arcadia timeline --wait`.** The contract above: observation
  cursor, clearance events, local sources only by default. Then change the
  playbook's "Supervision during a run" to the `--wait` recipes. Retire
  `wait-for-event.sh production|press` only after the host probe passes, and
  keep `pr`.

**Acceptance (fixture tests, no live run):**

- A kind change on one Action wakes.
- An escalation that clears wakes as `production.escalation.cleared`, and the
  same key reappearing afterwards wakes again as a new edge.
- An admission that existed before the cursor was taken and is released after it
  wakes as `production.admission.released`.
- An event written between a wake and a re-arm is delivered after `--after <cursor>`.
- A receipt that becomes visible late, with a `finishedAt` older than any
  overlap, is still delivered.
- A card run wakes only on its final outcome.
- A timeout exits 3 with a cursor.
- Three consecutive source failures exit 1.
- A stubbed `gh` runner records zero calls without `--pull-requests`.
- In each of Codex, Claude Code and OpenCode, `--wait` runs in background mode and
  wakes the session. Native checks and filesystem checks are reported separately.

**Measured benefit:**

- In-scope missed wakes go to 0, and the re-baseline loss is closed. Tonight
  that class cost ~65 minutes.
- Per-poll work drops from 2.0 s to ~0.2 s.
- Quiet-run status reading drops from ~31k to ≤ ~3k tokens an hour.
- Operator touches: 0 removed by itself. With answer A below, the 2 touches per
  coordinator session from rows 18 and 20 go away.

**Riskiest assumption and its probe:** that a host will arm a checked-in local
wait without asking the operator. Probe: give three fresh sessions (Codex, Claude
Code, OpenCode) only "arm the standard wake for this run". Count the permission
asks, and record each host's background-command limit: whether a 110-minute
command survives, and what the session sees if the host kills it. Only the Claude
Code limit is known, from `scripts/comms-watch-issue.mjs`. If one host still
asks, answer A below is what removes the touch.

| Deferred | Revival trigger |
| --- | --- |
| D1. One host-side GitHub observer (the Intelligence service's worker) that polls checks and merges only for PRs named by armed waits and records them locally, so sessions never poll GitHub | Answer B, or a missed own-PR wake after step 1 ships. Built only while production is Off |
| D2. Waiter liveness: an "armed until" heartbeat file per session, or a host stop hook, so a supervisor sees "Rowan has no wake armed" | The first time a coordinator idles without an armed wait after step 1. Partly built (Issue #2231): `production keeper-heartbeat` writes the Momentum Keeper's file, and the liveness timer pages when it lapses in a run window; other sessions still write none |
| D3. Cross-session messages as a timeline source | A non-Claude coordinator needs a supervisor message, or Relay v1 starts |
| D4. Replace `scripts/comms-watch-issue.mjs` and the planned `arcadia agents watch --until-event` with `--wait` | The `implement-agent-peer-watch-reader` Action becomes current |
| D5. CI red or green for non-production PRs on Codex and OpenCode | Comes with D1 |
| D6. Change detection (`PRAGMA data_version`) to skip unchanged polls | `--wait` CPU over 2% of a core on the host |

## Question for the operator

One choice needs you, because hosts read timed polling as needing your word:

- **A. Sanction the checked-in waiter as standing direction in the bootstrap**
  (through `docs/agents-context.md` and a Decision). The scope is
  `arcadia timeline --wait` only: its local reads, plus its `--pull-requests`
  `gh api` GETs under existing auth. It covers no other polling, network use or
  command. This removes about 2 touches per coordinator session from the first
  night it ships, at up to ~120 GitHub GETs an hour per waiter. A host may still
  ask, and the probe will tell.
- **B. Sanction local waits only, and build D1** so sessions never poll GitHub.
  Your word covers production and card waits now. Own-PR wakes cost a touch per
  session until D1 lands after production is Off.
- **C. No standing direction.** The per-session word continues: 1–2 touches per
  coordinator session, as tonight.

## What this does not prove

The figures come from one night and one machine, and the turn overhead is
unmeasured. No host has run `--wait` yet.

Independent review:
- **Round 1** asked for changes: two blocking findings (a time-window cursor
  loses late-visible records, and clearances were silent) and six non-blocking
  ones.
- **Round 2** asked for changes: one blocking finding (a `rowid` mark misses
  in-place updates) and three non-blocking ones.

All of them are addressed above, and the verdicts are recorded on the pull
request.
