# Daily Orientation Packet — Reliability Follow-Up Context

*A portable brief for continuing this design conversation in a fresh chatbot
session (no repo access assumed). Written after the first night of real use
surfaced four real bugs and one unresolved architectural tension. Copy this
whole document as your opening message.*

---

## Why this matters (read this first)

I (the user) am trying to get Arcadia to hold the ~10 things I'd otherwise
juggle mentally across life, work, art, and family — and push me a daily
morning report, correctable by replying, so it perpetually stays accurate.

**The stakes are not hypothetical.** I have a real pattern of procrastinating
boring-but-mandatory tasks (bills, filings, renewals) until they become urgent
and costly. The entire point of this system is to catch those *before* they
become expensive — visibility while a task is still cheap to handle. If this
system fails silently, or I can't trust it, it has actively made things worse:
I'll have stopped checking on my own the things it was supposed to be
checking for me.

**My stated commitment:** I will always use Arcadia if it can keep me from
dropping the ball while minimizing stress and needless expense. That's a real
bar, not enthusiasm. Anything we design from here has to earn that bar or be
honest that it doesn't clear it yet.

---

## What exists today (architecture, no code required to reason about it)

**Context Ledger** — a small store (~10 live entries, explicitly *not* a task
manager). Each entry has:
- `entryType`: active_concern | standing_responsibility | time_bound | parked_idea
- `priority`: low | normal | high | critical
- `horizon`: now | soon | later | someday
- `dueAt`: optional hard date (time_bound entries)
- `status`: active | confirmed | completed | dropped
- `lastConfirmedAt`: the staleness anchor — refreshed by any human touch
- `source`: cli | discord | admin | seed

**Staleness is derived, not stored**, per-horizon thresholds:
| horizon | stale after | neglected at (2x) |
|---|---|---|
| now | 2 days | 4 days |
| soon | 7 days | 14 days |
| later | 21 days | 42 days |
| someday | 60 days | 120 days |

A stale entry is never asserted as fact in the packet — it degrades into a
confirmation question ("Still true that X?").

**Morning Packet** — composed once per local day (idempotency-guarded, with
crash-recovery: if the process dies between "composed" and "sent to Discord,"
the next check retries the send rather than silently losing that day's
packet). Sections: Due/urgent, Approaching (lead window sized by priority —
critical=14d, high=7d, normal=3d, low=1d — the actual anti-procrastination
mechanism), by-area one-liners, stale-entries-as-questions (capped at 3/day),
at most one neglect flag. Fully deterministic — no model call to compose it.

**Correction loop** — a Discord reply is parsed by **one Intelligence
(local-LLM) call** into typed ledger operations (add/update/complete/
reprioritize/confirm/context), applied all-or-nothing, with every touched
entry's staleness clock refreshed. Failure modes are explicit: ambiguous
(model asks a clarifying question, nothing mutates), unparseable (model
output didn't fit the schema, nothing mutates), interpreter unavailable
(local model unreachable, nothing mutates, user told to retry).

**Discord Reply Router** — a shared piece of infrastructure (also used by an
unrelated image-generation feature) that tracks which Discord message IDs are
"live" conversation targets, authorizes replies by a user-ID allowlist, and
dispatches to the right feature's handler with a reaction ack (✅/❓/🚫).

**Everything runs locally**: a local LLM server (behind a LiteLLM proxy
behind Arcadia's own routing layer, which enforces "local-preferred never
silently escalates to cloud" as a hard rule — cost control is architectural,
not incidental), a Discord bot process, and Arcadia's own CLI, all as
long-running processes on one Mac.

---

## What broke on the first real night (this is the important part)

I built and shipped this in one session, then dogfooded it live. In order:

1. **A wrong `--workspace` flag position** in the bot's CLI-invocation code
   caused every correction-loop reply to fail outright with a Commander.js
   parse error. Silent-ish: surfaced as a confusing CLI error string, not a
   clean failure.

2. **Stacked timeouts too short for a cold local model load.** The local LLM
   (a 14B parameter model) needs real time to load into memory after being
   idle. Two different timeouts (60s in one client, 30s in a subprocess
   wrapper) were both shorter than that cold-load time, so the *first* real
   reply after any idle period failed with "can't reach the model" even
   though the model was, technically, going to become available shortly.

3. **A silently wrong working directory** (`repoRoot()` computed one
   directory level too shallow) meant the bot's spawned CLI subprocess could
   not find the repo's environment config. It fell back to a default,
   unauthenticated route and failed with a 401 error — a *completely
   different, unrelated-looking* failure from a config path bug three layers
   away. This one was genuinely hard to diagnose: the error message was
   accurate but pointed nowhere near the real cause. It only got found by
   reproducing the exact subprocess environment by hand.

4. **The reply chain died after exactly one hop.** When the bot asked a
   clarifying question, that new message was never registered as a valid
   reply target. Replying to the bot's own question fell through to an
   unrelated, older feature and looked exactly like being ignored — no error,
   no reaction, nothing. This is the scariest bug of the four: it fails
   *silently*, with no signal to the user that anything went wrong.

5. **No query capability existed at all.** The correction loop only ever
   understood *write* operations. There was no way to ask "what's in the
   ledger?" — a reply like that either got misinterpreted or came back
   unhelpfully ambiguous. (Partially fixed: a plain-text pattern match now
   answers list/show queries directly from the ledger with no model call —
   but it's a regex, not a real query capability, and it's easy to imagine
   phrasings that miss it.)

Every one of these was fixed the same night, live, with me able to tail logs,
reproduce failures by hand, and restart services on command. **That's not a
sustainable trust model.** The whole point of this system is that it works
when I'm *not* paying close attention.

---

## The central tension that needs harder thinking

**Cost-minimization and reliability are pulling in opposite directions, and
the current design has only really committed to the cost side.**

Arcadia's Intelligence layer has a hard architectural rule: "local-preferred"
requests never silently escalate to a paid cloud route, even if the local
route is down. This is a deliberate, good rule for most of what Arcadia does
— routine generation work shouldn't quietly start costing money. But the
correction loop's *entire job* is making sure I don't drop something
important. If the local model is asleep, cold, or the Mac itself is off, the
correction loop is unavailable — and per the failure design, it correctly
tells me so rather than mutating incorrectly. But "correctly failing" isn't
the same as "not dropping the ball" if I don't notice the failure, or if the
thing I was trying to tell it was itself time-sensitive.

Put concretely: if I reply "the inspection deadline moved up to Friday" and
the local model is unreachable, today's design gives me a clean rejection
message in Discord — which I have to actually see and act on manually. That's
better than silent corruption, but it's not the reliability guarantee that
matches "critical/urgent" stakes.

## Open questions to think harder about

1. **Should there be a reliability tier, separate from priority?** A
   `critical`/`high` ledger item (a real deadline with real cost if missed)
   might deserve a stronger processing guarantee than a `low`/`normal`
   creative idea — including, possibly, an explicit opt-in to pay for a cloud
   model call *specifically* for that item's corrections, overriding the
   local-only default. Is that the right lever, or is it solving the wrong
   layer of the problem?

2. **What is the actual disaster-recovery story?** The whole stack — local
   model server, LiteLLM proxy, Discord bot, Arcadia's own worker — has to be
   running on one Mac. None of the model-serving pieces currently start
   automatically at boot (this was discovered, not designed). If the Mac is
   asleep, rebooting, or mid-update at the target delivery time, what
   actually happens, and does *anything* tell me it didn't happen?

3. **What would "loud failure" look like for the pieces that currently fail
   quietly?** The reply-chain bug is the sharpest example: a failure with
   zero signal is strictly worse than an error message. Is there a design
   principle here — e.g., every reply must produce *some* visible reaction
   within N seconds, and the router itself watches for that and escalates if
   it doesn't happen?

4. **Should the daily packet include its own health check?** E.g., a line
   like "Correction loop: ✅ reachable" or "⚠️ local model unreachable, replies
   won't be processed until this is fixed" — composed deterministically by
   actually probing the stack, not assumed. This seems cheap and high-value.

5. **Is Discord + one channel + one bot process the right single point of
   contact for something this important?** Should a `critical` item ever get
   a redundant channel (e.g., also an email, or an OS notification) rather
   than trusting one delivery path end to end?

6. **How should staleness thresholds differ for financially/legally
   consequential entries vs. everything else?** The current 2/7/21/60-day
   windows were chosen for a general orientation ledger, not specifically
   calibrated against "this one has a real penalty if missed." Should
   `time_bound` entries with a real `dueAt` get a materially different
   (tighter, more redundant) check-in cadence than open-ended concerns?

7. **What's the right self-diagnostic surface?** Tonight's debugging required
   me to manually tail raw process logs and reproduce subprocess environments
   by hand. Is there an `arcadia orientation doctor`-style command (Arcadia
   already has this exact pattern for its ingress service) that could surface
   "is the whole pipeline actually healthy right now" on demand, so problems
   don't require a live debugging session to even notice?

8. **Should the correction loop's failure mode ever be "escalate to a human
   review queue" instead of "tell the user and hope they see it"?** Arcadia
   has an existing "requires review" / Decision concept elsewhere in the
   system for exactly this kind of "something needs a human, don't guess"
   situation. Should a repeatedly-failing critical-item correction land there
   instead of just sitting in a Discord thread?

## Constraints already decided (don't re-litigate these)

- **Not a todo/task manager.** Explicitly out of scope. The ledger holds
  orientation facts, not executable work items, and never writes to Arcadia's
  separate task/execution system.
- **~10 live entries, by design.** Not meant to scale to hundreds.
- **Deterministic before AI**, everywhere it's viable. The packet composition
  and the new list-query shortcut are both already fully deterministic; only
  free-form correction actually needs the model.
- **Local-first is a value, not just a cost accident** — most of what this
  system does should stay free and private. The question above is specifically
  about whether *high-stakes exceptions* to that default are warranted, not
  whether to abandon it generally.

---

**What I want out of the next conversation:** don't just propose fixes to the
four bugs (those are already fixed) — help me think through the reliability
tension above, and land on a small number of concrete, buildable next steps
that actually close the gap between "clever demo" and "I will bet a real
financial or legal deadline on this."
