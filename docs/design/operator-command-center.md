# The operator's command center: topics first, a scoped feed beneath

**Status:** proposed, not approved. Nothing is built. Intake: [Issue 2224](https://github.com/pmark/arcadia/issues/2224).
**Try it:** [`prototypes/operator-command-center.html`](prototypes/operator-command-center.html) is a throwaway static sketch
with sample data. It calls nothing in Arcadia.
**Builds on:** the [three Workspace layers](relay/workspace-layers.md) (approved 1A and 2A), the
[workspace feed scaffold](operator-presence.md), the [operator timeline](../proposals/operator-timeline.md), the progress-first
digest ([PR 2220](https://github.com/pmark/arcadia/pull/2220), open) and the idle-front check
([PR 2218](https://github.com/pmark/arcadia/pull/2218), open).

**What this advice rests on.** Arcadia has no reviewed field guide for interaction design, so this is disclosed exploratory advice,
not conformance to a guide. It rests on the operator's words below, the operator's earlier directions, the code, and one probe
against 48 hours of real timeline data. Taste is marked where it matters. Confidence is moderate: the clustering is checked
against real data, but nobody has used the page. This is a single design document, not a sustained brief. Say "keep a design
brief" to open one under `docs/design/command-center/`.

## The operator's request

> "I need an immediate, long-term solution for applying my (as the operator) attention asynchronously in order to get caught up
> with important progress, make decisions, unblock, take action, etc. ... I still don't have a definitive, single go-to page that
> acts as my mission control command center with everything I could possibly need to see and do."

> "I should be able to see the feed of combined updates/actions/items containing items for the given contextual scope ... mark
> items as read/unread, pin items, etc. But I think we can do better than having an endless stack of historical items like a
> database dump or another email inbox. Instead, or possibly in addition to a flat feed, I should be able to see gestalts/overviews
> of recent topics which can span agent sessions." (2026-11-07)

## The frame

- **Outcome.** After time away, the operator is caught up in minutes and can clear every waiting tap from one place, on a phone
  or a desktop.
- **Serves the mission:** Arcadia "surfaces exactly one question when it cannot proceed without an answer" (PROJECT.md), and
  "Operator attention is a budget. Interrupt only when human judgment or authority can change what may safely happen next"
  (Constitution).
- **Serves the north star** by cutting the time the critical path waits on the operator. In the 24 hours before this request,
  about 8.5 hours of critical-path time waited on one tap, and about half of roughly 12 operator touches were avoidable (operator
  direction, 2026-11-07; see [Evidence](#evidence)).

**Requirements.**

| Id | Requirement | From |
|---|---|---|
| R1 | One go-to page for catching up and acting | Operator, "a definitive, single go-to page" |
| R2 | Overviews of recent topics that span agent sessions come first | Operator, "gestalts/overviews of recent topics" |
| R3 | A combined feed for the current Workspace scope | Operator, "for the given contextual scope" |
| R4 | Read, unread and pin, per item | Operator |
| R5 | Not an endless inbox: settled work leaves on its own | Operator, "better than ... an endless stack" |
| R6 | Every waiting tap is clearable from the page, through existing governed paths only | Operator, "make decisions, unblock, take action"; Constitution |
| R7 | Works on a phone over the Tailnet as well as on a desktop | Operator works from the phone; the brief |
| R8 | Deterministic first, local AI only to name and summarize, no spend | Constitution, Economy |

**Non-goals.** No new governance record, no new write path into Decisions, Asks or queues in phase 1, no new notification channel,
no change to ping rules, and no runtime code in this PR.

## Five designs compared

| Design | What it is | Why not, or why |
|---|---|---|
| **A. Inbox** | One flat, newest-first stream of every event, with read, unread and pin | Fails R2 and R5. 48 hours held 892 events. It's the "email inbox" the operator ruled out. |
| **B. Briefing (chosen)** | Waiting on you, then topic gestalts, then a scoped feed that shows only what changed since you last read each topic | Meets R1 to R8. The feed is subordinate and bounded, so it can't become the page. |
| **C. Routes first** | The Workspace routes view: one route per Plan, with stops | Good for one Plan, but blind to work with no Plan. In the probe, 47 threads of 3 or more events had no Plan: operator-directed PRs, Decision PRs, design work. Routes stay as the View. |
| **D. Digest page** | PR 2220's digest rendered as a page | Fixed time windows, no read state, no actions. Its progress model is reused instead, and the Discord digest links here. |
| **E. Grow `/todo`** | Add read state and topic grouping to the to-do list, with no new route | `/todo` lists only what waits on the operator. It has no progress, no blockers on others' work and no history, so it can't answer "what happened?" Making it do so would mix the complete answer list with the overview. It stays the answer surface instead. |

**B wins because the topic is the unit of attention.** The operator catches up by asking "what happened with X, and do I need to do
anything?" A topic answers that once. A feed answers it once per event. B keeps A as a subordinate layer, takes C's routes as the
drill-down, and takes D's progress model and fallback rules.

## The page

It lives at `/workspace/feed`, the existing Feed route, which it replaces. It's not a new surface. It sits under the Workspace
layout, so it keeps the sky, the status pill and the Relay capsule. The header's "Feed" link becomes "Command center" (taste: the
name is the operator's call).

```text
┌──────────────────────────────────────────────┐
│ arcadia      [● Needs you · Production on]   │  existing status pill
│ Scope: All projects ▾                        │  scope chip (Workspace scope)
│ Since you were here (14 h): 6 merged,        │  arrival line, deterministic
│ 2 goals moved, 3 taps wait on you.           │
├──────────────────────────────────────────────┤
│ WAITING ON YOU · 3                           │
│ 🚨 Approve the build packet: pin-surface-…   │  blocks production
│    Waiting 6 h · production stays stopped    │  cost of waiting
│    [Open the approval →]                     │  existing control
│ 🔘 Decision 0188: continue after a fix?      │
│    Waiting 2 h · next Action can't launch    │
│    [Answer →]                                │
│ 🔀 Merge #2220 on GitHub (green, clean)      │
│    [Merge on GitHub ↗]                       │
├──────────────────────────────────────────────┤
│ TOPICS · 5 changed · 3 quiet                 │
│ ┌──────────────────────────────────────────┐ │
│ │● Record-run test pins          Arcadia   │ │  ● = changed since read
│ │  Goal: unattended production test pins   │ │
│ │  ███████░░░ 4/6 Actions · +2 since read  │ │
│ │  Two pins landed overnight; the third is │ │  AI-written, from facts
│ │  stopped on a build-packet approval.     │ │
│ │  Blocked: build packet approval (6 h)    │ │
│ │  Your move: approve the packet  [Open →] │ │
│ │  12 updates ▸        [Mark read] [Pin]   │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │● Arcadia: other work                     │ │  off-Plan threads
│ │  Digest rewrite (#2220) ready to merge;  │ │
│ │  idle-front check in review (#2218).     │ │
│ │  7 updates ▸                             │ │
│ └──────────────────────────────────────────┘ │
│ Quiet: 3 topics, nothing new ▸               │
├──────────────────────────────────────────────┤
│ FEED · this scope · since you read           │  collapsed by default
│ ▸ 09:12 #2216 merged · Record-run test pins  │
│ ▸ 08:40 Session ended: pin-safety-lines (✓)  │
│ ▸ 08:02 5 commits by Claudia Mason           │  collapsed run
│ Older settled items are in each topic ▸      │  no infinite scroll
└──────────────────────────────────────────────┘
          ( Ask Arcadia anything…  ⌃ )           existing Relay capsule
```

**Who may move what** follows the layers rule: a system event changes the sky, the counts and the dots, and nothing reorders under
the operator's thumb. New items appear on the next read with a "3 new, show" line at the top of the section, not by shifting cards.

## 1. What a topic is

**A topic is the set of recent events that share a piece of work, named by the most durable record it touches.** Clustering is
deterministic. AI only names a topic that has no record title and writes its summary.

1. **Join events** that share a strong key, using the subjects the timeline already records on every event
   (`TimelineSubjects` in `src/timeline/schema.ts`): Action, pull request, branch (not `main`), Session, Agent Ask and Decision,
   each qualified by Project. A key that is shared means the same piece of work, so a Session, its commits, its PR, its review
   and its settlement fall into one group.
2. **Name each group by its Plan** when it has one. Groups with the same Plan merge into one Plan topic, so a topic spans every
   Session, PR and Decision on that Plan. The Plan is a label, not a join key, so a busy Plan can't swallow unrelated work.
3. **Group work with no Plan by Project:** one "*Project*: other work" topic per Project. Its threads are the groups from step 1,
   such as an operator-directed PR or a Decision PR.
4. **Fold loose events into their Project's other-work topic** as counts, unless they ask for attention. Most are worktree
   bookkeeping, Ask proposals and pings that name nothing but their Project today. Events with no Project (47 in the probe)
   fold into one "Workspace" line at the portfolio scope.
5. **Topic ids are stable:** `plan:<project>/<plan>` or `other:<project>`. Read state hangs on these ids, so it survives a re-read.
   An id can still vanish: a Plan is renamed, or a thread moves from "other work" into a Plan once a record names it. Then the old
   entry is dropped and the topic shows as unread once. That costs one extra look, never a lost item.

**The probe** ([`probes/command-center-topics-1.mjs`](probes/command-center-topics-1.mjs), [how it was run](#evidence)): 48 hours
of real timeline, 892 events, clustered as above.

| Result | Count |
|---|---|
| Plan topics | 6, of 127, 72, 72, 67, 7 and 5 events. The four large ones each hold 1 to 6 Actions, 4 to 7 PRs and 3 to 5 Sessions |
| Off-Plan threads | 94 across 4 Projects. 47 have 3 or more events, and 34 are a review item's open and decide pair |
| Topics on the page | about 10: 6 Plan topics and 4 "other work" topics |
| Loose events | 162, mostly `git.worktree.integrated` (43), `ask.proposed` (31) and `ping.created` (26) |
| Loose events asking for attention | 18: pings, and review items |
| Material events | 15% |

So the deterministic join gives a screenful of topics, not hundreds. There are two weak spots:
- **Review items** (`decision.review_item.*`) name only their review id, plus a PR in 21 of 73. So a build-packet approval
  can miss its Action's Plan topic. Phase 2 joins it through what its record names, such as the to-do read's `origin`, where one
  exists. That's unverified, so until then these pairs sit in "other work".
- **Pings** carry only their Project, so an attention ping lands loose. Phase 2 links a ping to its PR or Action by the `#N` and
  Action id its text already names. It's still deterministic, but ping text is untrusted, so a link is made only when the id
  resolves to a known record in the same Project, and it's marked as inferred.

A thread can also sit in "other work" when it plainly serves a Plan but no record says so. That's honest, and the fix is the
record, not a guess.

## 2. Gestalt content and freshness

Each topic card has a fixed shape, so it reads the same on every screen and in plain text:

| Part | Source | AI? |
|---|---|---|
| Title | Plan title, or the thread's PR title. AI names only an "other work" summary line | Only for other work |
| Goal it serves | The Plan's Milestone, or its summary's `serves` (`lib/workspace-summaries.ts`) | No |
| Progress | Actions done of total, `+N since you read`, PRs merged, from the digest's progress model (`src/digests/report.ts` in PR 2220) | No |
| Summary | 1 to 3 sentences: what moved toward the goal, and what's stuck | Yes, local model |
| Blocked | Escalations, red alerts and stopped production on this topic's Actions, with how long | No |
| Your move | The one waiting item that belongs to this topic, with its control | No |
| Updates | Count of feed items since read, opening the topic's trail | No |

**The AI summary follows PR 2220's rules:**
- Its input is facts only: counts, states, durations, ids, and the titles of checked-in governed records (Plan, Action and
  Milestone), which are reviewed text in the repository. It never gets Log, Decision, PR or ping text, nor PR titles, which any
  agent can write. An "other work" thread is named to the model by its id and state ("PR #2220, open, green"), and the card shows the
  PR title beside the summary as plain text.
- The model has no tools, and its output only becomes display text. So the worst a hostile record title can do is skew one summary,
  which the "AI-written" label and the computed facts beside it expose.
- If it states a number the facts don't have, or the model is unavailable, a computed summary replaces it, labelled "Computed".
  An AI summary is labelled "AI-written".
- It runs through the Intelligence service, local-preferred, with paid use off: the enrichment layer's pattern
  (`lib/enrichment/registry.ts`), where the job store is the cache, keyed by a hash of the facts.
- Its output is shown as text, never markup.

**What makes a topic "changed".** A topic changes when it gets a new **material event**, meaning something the operator would act
on or want to know:
- a PR merged, closed, or turned red;
- an Action done;
- a Decision raised or answered;
- an escalation or red alert opened or cleared;
- production on, off or stopped on this topic;
- any event with `attention: true`.

Commits, pushes, worktree bookkeeping, Session heartbeats and review-step noise aren't material. In the probe, about 15% of events
were material.

- **A topic is unread** when it has a material event the operator hasn't seen. Mark read stores the time of the newest material
  event it saw, plus the ids of the material events from the 24 hours before that. An event is unseen when its id isn't stored and
  it's no older than that 24-hour overlap. So a topic comes back only when something material happens, never for a commit. An old
  event leaving the read window can't make it unread. A late-collected event is still caught, because the timeline mixes clocks
  (commit dates, file times, collector time).
- **The summary is rewritten** only when the topic's facts change, and the facts change only with a material event. The job is
  keyed by a hash of the facts, so identical facts reuse the cached job and a quiet topic costs nothing.
- **A topic goes quiet** when nothing material has happened in 72 hours and nothing waits on the operator. Quiet topics collapse
  into one line. A topic with no events in 14 days leaves the page; its records remain where they always were. The briefing reads
  the same 14 days, so the read window and the trail always agree.

## 3. The feed model

**Sources.** The feed adds no new event source. It reads the de-duplicated operator timeline (`collectTimeline`, which already
merges a settlement, its commit and its ping into one event) plus the three reads the Feed already uses: the to-do list
(`/api/approvals`), next steps (`/api/next-steps`) and the PR inventory (`/api/pull-requests`). Each feed item keeps the timeline's
stable id (`<source>:<native key>`).

**Scope.** The scope chip is the Workspace scope, `{ project, plan, action }` from `lib/workspace-scope.ts`, carried as the query
`?project=&plan=&action=`, so Back, Forward and links keep working. The Feed route stays one address. It's the same filter at every
level:
- **All projects:** every topic.
- **A Project:** its Plan topics and its other-work topic.
- **A Plan:** its one topic, opened, with the trail as the feed.
- **An Action:** the Plan topic's trail, narrowed to that Action.

Every Project, Plan and Action View gets a "What's new here" link into the command center at its own scope. Scope is a display
filter, never authority, as the layers design already says.

**Read, unread and pin.**
- **Per topic:** the newest material event's time at the last read and the overlap's ids, and pinned or not.
- **Per item:** read or unread, and pinned or not. Item read state matters only inside a topic's trail.
- **"Mark read" on a topic** marks its items read too.
- **A pinned topic or item** stays on the page through quiet and decay until it's unpinned, and sorts first in its section. In code
  call it `kept`, because "pinned" already means a Decision card bound to its exact text (`pinned press`). On screen it's "Pin".

**Storage, local-first and a projection.** It's one small JSON file on the host, under the checkout's ignored `.cache/`, beside the
PR inventory's (`lib/pull-request-inventory-persistence.ts`): `.cache/command-center/attention-<workspace id>.json`. It's served by
one dashboard route, `/api/workspace/attention`, with GET and a small POST that writes only that file.
- **Phone and desktop share it**, because both read the same host.
- **Never a governance record.** No gate, dispatch, digest or ping reads it. Losing it marks everything unread, and that's all.
- **Not browser storage**, because then the phone and the desktop would disagree about what has been read.
- **Bounded.** Entries for topics and items that have left the page are dropped on write, so the file can't grow without limit.
- **The POST is narrow,** because it's a new write path on a page the Tailnet can reach. It uses the dashboard's existing origin guard
  (`lib/originGuard.ts`). That guard refuses cross-site browser requests, but by the deployment's documented "reachable, not
  attributable" model it lets through a caller that sends no browser headers, such as a script on the host or the Tailnet. That's
  acceptable here only because the file is a projection: the worst such a caller can do is change what shows as read. It takes only `{ id, read | kept }` for ids the current briefing
  contains, and writes only this one file. It follows the PR inventory's file rules: owner-only mode, no following links, atomic
  rename, and a size cap. Writes are serialized in the dashboard process, and each one re-reads the file, so marks from the phone
  and the desktop never drop each other.

**Dedup and collapse.**
- The timeline's de-duplication is reused unchanged.
- Within a topic, consecutive events of the same kind by the same actor collapse into one line: "5 commits by Claudia Mason".
- A PR's open, ready, reviewed and merged events collapse into its latest state: "#2216 merged".

**How it avoids the endless inbox.**
- **Window.** The feed shows only what changed since the operator last read each topic, plus pinned items. There's no infinite
  scroll. "Older" opens the topic's trail, which is bounded to 14 days and links to `arcadia timeline` for anything older.
- **Settled work leaves on its own.** A merged PR, an answered Decision, a done Action or a settled Ask counts in the topic's
  progress, shows once in the feed, and drops out once read. It's never something to clear by hand.
- **Decay.** Quiet topics fold to a line; stale topics leave.
- **No item is ever "deleted".** Records stay authoritative and unchanged. The page only stops showing them.

## 4. "Waiting on you" at the top

**Only ready, one-tap items that block progress.** An item qualifies when all three hold:

1. **It's the operator's.** It comes from the to-do list or next steps (`lib/next-steps-server.ts`, "every operator touch, ordered
   by what unblocks the queue"), not from a wait step.
2. **It blocks progress.** It's `blocking` per `arcadia todo`, or it stops the production critical path.
3. **It's ready now.** One of these:
   - a Decision with a pressable card;
   - an Agent Ask the to-do read already marks `acceptable: true` (`Approval.acceptable` in `lib/approvals.ts`). The command
     center never runs a preview or a settle itself;
   - a pressable START card on `/actions`;
   - a blocker with a registered one-click clear;
   - a merge step that next steps offers from its own live read of the PR's head, checks and state. The item says "reviewed"
     only when an independent-review verdict for that exact head has been read, which is phase 2. Until then it names only what
     was read, such as "green, clean". If the live read fails, there's no merge item at all, because a cached inventory never
     claims a PR is ready.

Everything else that waits on the operator stays on `/todo` and on its topic card, and isn't at the top.

**Each item says what waiting costs**, in one line. It uses the digest's "If it waits, …" text (PR 2220). When PR 2218 lands, it
also shows how long the critical path has waited on this tap, from its `waiting_on_operator` minutes. Order: production stopped
first, then blocking the current Action, then longest waited.

**Each item has one control, and it's an existing one:**

| Item | The control | Taps |
|---|---|---|
| Decision | "Answer" opens the one-screen Decision page (`/todo/decision/…`), which uses the pinned press | 2 |
| Agent Ask | Opens its `/todo/agent_ask/…` page | 2 |
| START card | Opens `/actions/<id>`, where the card checks its own preconditions | 2 |
| Launch an Action | Opens `/production?launch=…`. The operator still confirms there | 2 |
| Merge | "Merge on GitHub" opens the PR. GitHub has no link to the merge button, so the label doesn't promise one | 2 |
| Blocker clear | Opens its `/todo` row, which holds the existing clear control | 2 |

**A button never grants authority by being generated.** The command center only links. It renders no Decision text it didn't get
from the pinned card, and it adds no write path into governance. Answering in place, one tap fewer, is an operator choice (below).

## 5. How it relates to the existing surfaces

The aim is fewer surfaces. Nothing below is deleted in phase 1.

| Surface | Today | With the command center |
|---|---|---|
| `/workspace/feed` | Read-only grouped list, and the Journey button over sample data | **Becomes the command center.** Same route, same sources |
| `/todo` | The full list of everything waiting on the operator, with the answer controls | **Stays the answer surface and the complete list.** The command center links into it and shows only what's ready and blocking |
| `/production` | Production state, Stop and Start, and Launch | **Linked, not absorbed.** Stop stays one obvious step away there. The status pill already carries the state |
| `/actions` | START cards and operator scripts | **Linked** from Waiting on you |
| `/review` | Decisions view | **Linked** from Decision topics |
| `/now` | The landing page: one target, one distance, one move | **Unchanged in phase 1.** Making the command center the landing page is a later choice |
| `/mission-control`, `/dashboard`, `/momentum` | Older overviews | **Unchanged.** They're candidates to retire once the command center has been the landing page for a while |
| `/runs` | Deprecated | Never linked |
| Discord digest (PR 2220) | Morning and evening push | **Same progress model.** Its "Needs you" links keep their `/todo` targets. It gains one link to the command center with `?since=<window start>`, so the page opens on what the digest covered |
| Discord pings | Real time, only for a ready tap that blocks the critical path | **Rules unchanged.** The deep link stays the one-screen control. The tap also shows here under Waiting on you, so one place clears it all |
| Relay | The overlay on every view | **Unchanged.** On the command center, "this" means the current scope |

Push and pull: the digest and pings **push** the few things that matter, and the command center is where the operator **pulls**
the rest, at their own pace.

## 6. Phone and the Tailnet link

- **Phone first, one column**, in the order Waiting, Topics, Feed. Each topic card is one thumb-height at rest, and its trail opens
  in place.
- **Wide screens:** two columns, with Waiting and Topics on the left and the selected topic's trail on the right. Desktop shows the
  same page, not a different one.
- **The interface never waits for data** (layers rule 1). The arrival line, Waiting and the topic skeletons come from the small
  cached status read, then summaries fill in, each with a line saying what it's reading. The lists are 1 MB-class reads today, so
  the page reads them once through the server's cache rather than polling each on its own.
- **Link:** `<tailnet dashboard>/workspace/feed`, which is `ARCADIA_DASHBOARD_URL` plus the route, the same base the digest uses
  for its links. Add it to the phone's home screen. With `?since=` it opens on the digest's window.
- **Accessibility:** each card reads complete as text; the changed dot also says "Changed since you read"; and reduced motion,
  keyboard use and blocked storage are acceptance conditions, as for the rest of the Workspace.

## When things go wrong

| Situation | What the operator sees |
|---|---|
| A source can't be read | The section says which read failed and shows the last good read with its age. Waiting on you never shows "Nothing waiting" on a failed read |
| The Intelligence service is down | Computed summaries, labelled "Computed" |
| The attention file is missing or unreadable | Everything shows as unread, with one line saying read state was reset. Nothing else changes |
| A hostile PR title or ping text | It's shown as text, and the summary model never sees it |
| The phone and the desktop open at once | Both read one file. Writes are serialized and each re-reads the file, so neither drops the other's marks |
| The timeline read is capped or slow | The topic says it's incomplete, never "quiet". The last good briefing is served with its age |
| A tap goes stale (answered elsewhere) | The next read drops it. The control page itself refuses a stale press, as it does today |
| Stale data looks calm | Any read older than five minutes shows Signal loss, as the sky already does |

## What exists today

| Piece | Fit | Evidence |
|---|---|---|
| Feed route under the Workspace layout | **Exists** | `app/workspace/feed/page.tsx`, `components/workspace/feed/feed-view.tsx` |
| Feed ordering from approvals, next steps and PRs | **Exists** | `lib/workspace-feed.ts` |
| Small cached status read | **Exists** | `lib/workspace-status.ts`, `/api/workspace/status` |
| Unified, de-duplicated event stream with subjects | **Exists**, CLI only. A route can import `collectTimeline` in-process | `src/timeline/`, `docs/proposals/operator-timeline.md` (24 h in about 1.3 s, 7 d in 1.8 s) |
| Scope from the URL | **Exists** | `lib/workspace-scope.ts` |
| Plan and Action summaries | **Exists** | `lib/workspace-summaries.ts` |
| Progress by goal, needs-you ranking and "if it waits" text | **Partial:** in open PR 2220, in the CLI digest | `src/digests/report.ts` (PR 2220) |
| Idle minutes on the operator | **Partial:** in open PR 2218, read-only CLI | `src/production/idleFront.ts` (PR 2218) |
| Async AI enrichment with caching | **Exists**, two kinds | `lib/enrichment/registry.ts`, `app/api/enrich/route.ts` |
| One-screen Decision page with the pinned press | **Exists** | `app/todo/[kind]`, `components/decision-answer.tsx` |
| Read, unread and pin state | **Missing** | No store in the dashboard |
| Topic clustering and material events | **Missing** | Probed only: `docs/design/probes/command-center-topics-1.mjs` |
| Pings linked to their subjects | **Missing:** a ping carries only its Project | `src/timeline/collectors/pings.ts:65` |
| Issues as a timeline subject | **Missing:** `TimelineSubjects` has no Issue | `src/timeline/schema.ts` |
| Operator-directed work linked by its PR metadata | **Partial:** the PR list response has the body; the `action:` line isn't parsed | `src/timeline/collectors/pullRequests.ts` |

## The build, in phases

Each phase is its own PR under the usual gates. Unattended production stays first, and this work yields to it whenever they compete.

**Phase 1, the vital few: a usable command center, deterministic only.** About size L: about 90 minutes of agent work, likely
two PRs.
1. `lib/command-center.ts`, pure and tested on fixtures: topic clustering, material events and unread state, feed collapse, and the
   Waiting-on-you filter and order.
2. `/api/workspace/briefing?project=&plan=&action=`: composes the timeline (in-process, 14-day window, cached about 60 s behind the
   request, like the status read) with the three existing reads. It answers from cache at once. Acceptance conditions: a single
   refresh in flight at a time (`lib/singleFlight.ts` exists), the last good answer served on error with its age, a bounded
   timeout, and a capped read shown as incomplete.
3. `/api/workspace/attention` and its `.cache/` file: read, unread and pin.
4. The Feed view rebuilt as Waiting, Topics and Feed, with computed summaries, the scope chip, and "What's new here" links from
   scoped Views.

This reuses the timeline, the three feed reads, scope, summaries and the status cache. It adds no AI, no write into governance
and no new ping. It needs no operator choice. The Journey button's sample data is removed from this page, because live topics
replace it.

**Phase 2: AI gestalts and tighter topics.** About size M.
- An enrichment kind `topic.gestalt`, with facts in and sentences out, and PR 2220's number check and fallback.
- Pings linked to their subjects by the ids their text names, only when the id resolves, and marked inferred.
- Review items joined to their Action where their record names one.
- "Reviewed" on a merge item, from an independent-review verdict for the PR's current head.
- The PR metadata `action:` line parsed, so operator-directed work groups by its Issue.
- Reuse PR 2220's progress model once it merges, and PR 2218's waiting minutes once it merges.
- The digest's link to `?since=`.

**Phase 3: answer in place, only if the operator chooses it.** About size M. The same pinned Decision card component and press
route `/todo` uses, rendered inline. Blocker clears inline. No new API.

**Phase 4: one landing page, by operator choice.** Root redirects to the command center, and the older overviews retire. Revival
trigger: the operator has used the command center as the way back in after time away on three occasions, or asks for it.

## The operator's choice

One question, registered as the Agent Ask proposal `proposal-command-center-answer-in-place-20261107` (receipt
`agentask_0772f1a0c634d2d9ec`). It grants nothing. Phase 1 doesn't wait on it.

🔘 **May the command center answer Decisions in place?**

- 🅰️ **Links only for now, and decide in place later (Recommended).** ➜ Consequence: every answer takes two taps through the
  existing one-screen page. The command center never writes governance. Phase 3 waits for a separate yes.
- 🅱️ **Answer in place from phase 3.** ➜ Consequence: one tap fewer per Decision, through the same pinned card and press
  `/todo` uses. The command center becomes a second place answers come from. This also settles the layers design's pending
  "one question at a time, answered in place" (rule 3), which needs the same yes.
- 🅲 **Hold: revise the design first.** ➜ Consequence: nothing is built. Say what to change.

**Operator answer, 2026-11-07 (in the Signal 2 session), verbatim:** "I choose A. Links only, but only for this iteration.
Ultimately I want a unified UI that I apparently never navigate away from. I should be able to see a To-Do item's overview in
plain language and be presented with options for direct action all from the same single UI, and progressive disclosure allows
me to access the full depth of detail conveniently without cluttering my default view so that I can stay in a flow state at
all times."

What this means for the build:
- Phases 1 and 2 ship links only, as designed. The command center writes no governance in this iteration.
- The destination is a single page the operator never leaves. Each To-Do item gets a plain-language overview with its
  direct-action options on the same page. Full detail sits behind progressive disclosure, so the default view stays
  uncluttered. Phases 3 and 4 are the likely route toward that destination. Each still waits on its own operator choice, as
  its heading says. This answer states the direction and grants neither phase.
- Phase 3 (answering in place) still needs its own explicit yes before it is built. Revival trigger: phase 2 is merged
  and in use. At that point, ask the operator again, citing this answer.

**Later choices, recorded but not asked now:**
- The page's name. "Command center" is my taste. Ask when phase 1 is in review.
- Making it the landing page (phase 4). Revival trigger above.

## Riskiest assumption, and open questions

- **Riskiest: that deterministic keys give topics the operator recognizes.** The probe shows the counts are right, a screenful
  rather than hundreds, but not that the operator thinks in these topics. The cheapest test is phase 1 itself on real data. If
  "other work" reads as a junk drawer, the next step is a deterministic split by Issue or design slug, not an AI clustering.
- **Read state across devices** assumes the phone and the desktop always reach the same host. They do over the Tailnet. A second
  host would need the file in the workspace instead.
- **The 72-hour quiet and 14-day leave windows** are my guesses, and easy to change.
- **Timeline cost.** It forks about 100 short `git` processes per read across the repositories. A 60-second cache keeps that to one
  read a minute however many windows are open. That's measured for the CLI, not yet in the dashboard process under load.
- **Not verified:** any phone measurement, the summary quality of the local model on topic facts, and PR 2220 and PR 2218, which
  are open and may change.

## Evidence

- **Probe, 2026-11-07:** `arcadia timeline --since 48h --limit 5000 --pull-requests --json`, read-only against the live
  workspace (892 events, nothing written), then `node docs/design/probes/command-center-topics-1.mjs <that file>`. Rerun both to
  check the numbers; a later window gives different counts. The script prints counts only, because this repository is public.
  Variants tried in throwaway copies: joining on Action, PR and branch alone left 218 loose events; adding Session, Ask and
  Decision brought it to 162. Joining on Action alone, without the Plan label, split each Plan into its Actions (largest 71
  events), which is why the Plan regroups them.
- **The 8.5 hours and about 12 touches** come from the operator's 2026-11-07 direction on the digest, recorded in the operator's
  notes rather than this repository. PR 2220's operator-interaction count is the source that will measure it from records.
- **Code read:** the files cited in "What exists today".
- **Operator directions used:** one to-do list and Ask as the main input (2026-10-08); ambient channels over dashboards
  (2026-09-27); trajectory as past, present and future (2026-10-19); morning and evening digest, real-time pings only for a ready
  critical-path tap (2026-11-07); pings only when actionable (2026-10-18, 2026-11-01); emoji menus with consequences and blockers
  first (2026-11-06); terse signal (2026-10-31); `/runs` deprecated (2026-10-09).
