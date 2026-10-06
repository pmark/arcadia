---
arcadia: v1
type: proposal
project: arcadia
question: Which Phase 2 direction should the operator timeline take first (a live "what is happening now" board, a scrubbable replay timeline, or a "what kind of work" lens), and how should the open attribution questions below be answered?
---

# Operator timeline: one event stream for a whole workspace

Action `arcadia/operator-timeline-phase-1`. Phase 1 collects every real event
source this workspace has into one stream and proves it on real data. Phase 2
designs the experience; this document ends with the options for it and the
questions only the operator can answer. No UI is built here.

## (a) The problem and the outcome

In the operator's words:

> I still often feel disoriented, confused and lost when navigating multiple
> session histories for multiple projects across 3 different native coding
> agent tools (OpenCode, Claude Code and Codex). Knowing which type of work is
> being performed by any agent or subagent will be extremely valuable and
> helpful to me and my sense of understanding, connectedness, presence and
> hopefully my FLOW, which is always where I want to be living. ... I as an
> operator, I should be able to monitor any and all active project work
> currently happening, as well as be able to rewind and play back significant
> events for an entire workspace and all of its projects.

**Outcome:** at any moment the operator can see, for the whole workspace and
every Project, who is doing what, in which Project, with which tool and of what
kind of work, and can rewind to any past moment and see the same picture, from
one stream whose every field says where it came from.

**What reading the real data showed about that pain** (these findings shaped
the schema and the Phase 2 options):

1. **The Sessions table sees almost nothing.** `agent_sessions` has 19 rows,
   all from managed-production rehearsals. Every interactive session (this one
   included) leaves no Session row. Its only durable traces are its worktree,
   the worktree's reflog, the commits it makes (with the agent's identity
   email), and the Asks it settles. So Git, not the Sessions table, is the
   main way to answer "who is doing what".
2. **The tool directories are mostly dead.** `~/.claude/worktrees` holds 4,677
   entries, `~/.codex/worktrees` 1,796 and `~/.opencode/worktrees` 851. Of those
   7,324 entries, 6,833 are leftover test-fixture checkouts
   (`<slug>-<timestamp>/repo`, mostly `define-contract-*` and
   `dispatch-next-*`) whose `gitdir` points at deleted temporary repositories. Only 78 linked worktrees are registered across the 14 known
   repositories. Scanning those directories is noise. The registered worktrees
   are the signal, so the collector reads each repository's own
   `worktrees/` admin directory. (This leak is a defect of its own; see open
   question 6.)
3. **The tool and the identity can differ.** Claudia Atlas (a Claude identity)
   works in worktrees Codex prepared (`~/.codex/worktrees/…`, branch
   `codex/…`). The path says codex; the commit email says Claude. The stream
   keeps both: the identity wins, and the provenance notes that weaker
   evidence names a different tool. Which one "tool" should mean is open
   question 1.
4. **One fact is recorded three to seven times.** One Ask settlement shows up
   as the settlement row, its governed-record commit, the facts that commit
   changed (Action created, pointer moved), the worker noticing main moved,
   the queue receipt, the pointer receipt and the Discord notification.
   Without de-duplication the stream is mostly echoes: on a real 24-hour
   window, 620 records became 342 events.
5. **The CLI interaction log is not an event source.** `activity_events` holds
   3.19 million rows, about 286,000 in the last week, almost all automation
   polling (about 5,400 rows a day per polled command). It is left out.
6. **Who did it is often not recorded.** Settlement rows, review items and
   pointer receipts store no actor. On the 24-hour window, 53 of 342 events
   have tool `unknown`. The stream shows `unknown` rather than guessing.
   Recording the actor where these rows are written is a cheap fix at the
   source (open question 3).

## (b) Inventory of real event sources

Each source below was checked against the code that writes it and against
this workspace (`martianrover`), read-only, on 2026-10-06. "7d" means the
seven days before 2026-10-06T05:00Z.

| Source (collector) | Where it lives | What an event looks like | Volume here | Time field and trust | Read-only access | Gaps |
|---|---|---|---|---|---|---|
| Commits (`git`) | Every Project repository registered in `project_metadata.repo_path` (14 exist on disk, including 8 rehearsal fixtures under `~/tmp`), all local and remote-tracking branches | sha, parents, author and committer email, `Co-authored-by` trailers, the ref that reached it, subject | 7d: arcadia 784, private-practice-now 217, mission-control-site 46, three-action-rehearsal 19, v5 and v6 fixtures 6 each | Committer date: when the commit entered this history. Author dates survive rebases, so they are not used. Host clock. | `git log --branches --remotes --source --since --until --max-count` under `GIT_OPTIONAL_LOCKS=0` | Commits fetched later with old committer dates fall outside a narrow window. A squash merge's author is the operator's GitHub account; the agent shows only in trailers. |
| Worktrees (`git`) | `<common git dir>/worktrees/*` of each repository: `gitdir`, `HEAD`, `logs/HEAD`, `index` | Worktree opened (first reflog line); merge, pull and rebase-finish reflog entries (URL credentials redacted); "Git last ran here" (index modification time, `observe`, never counted as activity); and the commit sha → worktree mapping that attributes commits | 78 linked worktrees registered (arcadia 43, mission-control-site 10, private-practice-now 5, rebuster 3, rehearsal fixtures 17); 6,833 dead fixture checkouts ignored | Reflog: host clock, exact to the second. Index modification time: set by any Git command that refreshes the index, including other tools' read-only scans, so it means "Git ran here", not "work happened". | `fs` reads of the reflog's last 512 KB plus `lstat`; symlinked admin directories and non-regular files (FIFOs) are skipped | Removed worktrees leave no admin directory, so their history survives only as commits. Index modification time keeps only the latest value. When the 512 KB tail does not reach the window start (the main checkout's reflog is about 3 MB), a `source.truncated` event says so. |
| PRs (`pull-requests`, opt-in `--pull-requests`) | GitHub REST through `gh api`; the runner accepts only `api repos/<owner>/<repo>/pulls?<query>` with no flags at all, so every call is a GET | PR opened, merged (folded into its merge commit) and closed | arcadia: 31 events in 24h from the newest 50 PRs | GitHub server time, to the second | One `gh api repos/<o>/<r>/pulls?state=all&sort=updated&per_page=50` per GitHub repository | Inside the sandbox TLS fails; the collector then reports one `source_error` and the rest of the stream continues (verified). Only the newest 50 PRs are read. Every agent uses the operator's login, so the account names no agent; the login is withheld from the stream. |
| Sessions (`sessions`) | `agent_sessions`, `session_role_attempts`, `session_exit_receipts` | Session prepared, started, ended or stalled; role attempt (planner, critique, development, code-review, qa) started, passed or failed; exit receipt | 19 Sessions (16 in 7d), 19 role attempts, 19 exit receipts | `workspace-db` ISO times written by Arcadia on the host clock | `SELECT` on a read-only connection | Managed Sessions only. Development attempt actor ids are opaque hashes (tool `unknown`). |
| Agent Asks (`asks`) | `agent_ask_proposals`, `agent_ask_settlements` | Ask previewed; Ask settled or rejected, with intent, first effect line, queue Action and the `documentsCommit` sha | 936 proposals and 711 settlements in total; 362 and 285 in 7d | `workspace-db` | Identifiers, intent and effect lines only; proposal bodies are never read into the stream | Settlement rows do not record who settled. |
| Decisions (`decisions` plus `governed-records`) | `review_items` (approval gates: code-review and QA verdicts, packet approvals, operator questions), `decision_deferral_receipts`; checked-in `docs/decisions/*.md` through their commits | Review item opened or decided; Decision raised or answered | 315 review items (40 in 7d, 69 open); 2 deferrals; 87 Decision documents in arcadia | `workspace-db`; Decision documents use the commit time (their `decided:` field is a date only) | `SELECT`; frontmatter compared before and after each commit | Review items do not record who decided. |
| Governed records (`governed-records`) | `PROJECT.md`, `docs/plans/*.md`, `docs/decisions/*.md`, `docs/proposals/*.md`, `MISSION_LOG.md` on each repository's base branch | Active Plan changed, pointer moved, Milestone or status changed, Plan created or status changed, Action created, Action done or other status change, Decision raised or answered, Project Log updated, proposal filed | arcadia: 72 facts in 24h; 5,561 in 30d (Action creation dominates) | Committer date on the base branch's first-parent history | `git log --first-parent --name-status` plus `git cat-file --batch-check` and `--batch` by object id, streamed in 32 MB chunks; Plans read with a line scanner (a 448 KB Plan's YAML parse cost about 50 ms per revision) | Only frontmatter changes on the base branch. A candidate branch's record changes count once merged. Missions live in PROJECT.md's body and have no frontmatter field, so a Mission change is not derived. |
| Events table (`events`) | `events` | Base branch advanced (with sha); packet approved; Session stalled; orientation packets; operator replies | 969 in total, 278 in 7d (747 base-advance rows since 2026-09-15) | `workspace-db` | `SELECT` | Records observations, not who moved the branch. |
| Managed production (`production`) | `production_policy_receipts`, `production_admissions`, `production_operator_escalations`, `production_launch_refusal_log`, `production_repair_attempts`, `production_review_steps`, `candidate_preservation_receipts` | Activated or Terminal Off (with who granted it), admission issued, committed, released or fenced, escalation, launch refused, repair attempt, PR pushed or ready, candidate preserved | Policy 39 (18 in 7d), admissions 23, escalations 3, preservation 43, review steps 5 | `workspace-db` | `SELECT` | Escalations, refusals and repairs keep only the latest row per Action; earlier occurrences are overwritten. |
| Queue (`queue`) | `action_queue_pointer_receipts`, `action_queue_receipts` | Pointer moved (with `headBefore`); queue arranged | 95 and 227 (41 and 69 in 7d) | `workspace-db` | `SELECT` | No actor. |
| Operator scripts (`operator-scripts`) | `artifacts/generated/operator-scripts/runs/*/receipt.json` in each repository's main checkout (git-ignored) | Operator ran a script: id, outcome, stage; each run is its own event | 35 receipts (28 `arcadia-operator-run-receipt-v1`, 4 plan-amendment, 3 unversioned) | The receipt's `finishedAt` or `startedAt`; file modification time as a fallback | `readdir` and JSON parse of the identifying fields only | Scripts staged but never run leave no receipt. |
| Discord (`pings`) | `operator_pings`; `agent_ask_settlements.notified_at` | Ping created or delivered (with the self-reported agent name); operator notified of a settlement | 3 pings; 285 settlement notifications in 7d | `workspace-db` | `SELECT` | `database/discord-*.json` delivery bookkeeping is not read; the rows above carry delivery state. |
| Not collected | `activity_events` (CLI interaction log); `~/.claude/projects/*` transcripts, Codex `codex-thread.json` (present in 8 worktree admin dirs), OpenCode storage | | 3.19 M activity rows | | | Left out on purpose: polling noise, and transcripts hold private conversation content. Open question 2. |

## (c) The unified event schema

One shape (`src/timeline/schema.ts`, `arcadia-timeline-event-v1`), for every source:

| Field | Meaning |
|---|---|
| `id` | Stable across runs: `<source>:<native key>`, for example `git:arcadia:commit:<sha>` or `asks:settlement:<row id>`. |
| `time`, `clock` | UTC ISO-8601 with milliseconds, and where it came from: `git-committer-date`, `git-reflog`, `workspace-db`, `receipt-file`, `file-mtime`, `github-api` or `collector`. |
| `source`, `kind` | The collector, and a dotted source-level kind (`git.commit`, `record.action.done`, `role.qa`, `production.admission.committed`). |
| `workKind` | The controlled answer to "what kind of work is this" (below). |
| `summary` | One line, at most 240 characters. Built from identifiers plus free text that agents and the operator wrote: commit subjects, Action titles, ping messages, escalation, refusal and fencing reasons, Decision questions and answers, settlement effect lines. Never prompts, proposal bodies or transcript content, but not system-only text either; see open question 8 before posting it anywhere shared. |
| `subjects` | `workspace`, `project`, `plan`, `action`, `session`, `ask`, `decision`, `pullRequest`, `commit`, `branch`, `worktree`, `repository`; empty values are dropped. |
| `actor` | `tool` (`opencode`, `claude-code`, `codex`, `operator`, `host-worker`, `unknown`), `name` (for example Claudia Atlas), `tier`, `role` (builder, critic or a Session role), `account` (the role of the account the action was recorded under when it differs, for example "GitHub merge under a human account (address withheld)"; a human's email, login or name never enters the stream), and `confidence` (high, medium, low or none). |
| `attention` | True when the event asks something of the operator: an escalation, an open review item or Decision, an attention ping, a failed QA or Session, a failed operator script. |
| `evidence` | Pointers: `sha`, `path`, `receipt`, `url`, `row`. |
| `provenance` | How the event and each derived field were obtained, keyed by field (`event`, `time`, `actor`, `workKind`, `worktree`, `action`, `dedupe`). |
| `alsoSeenAs` | The other records of the same fact that de-duplication folded in (id, source, kind, time, summary). |

**The `workKind` taxonomy** (`src/timeline/classify.ts`, one table, one value per kind):

| workKind | Answers | Mapped from |
|---|---|---|
| `plan-design` | shaping what will be done | planner role; Action created; Plan created; Asks with intent plan, split, action, milestone or project_update; proposals |
| `implement` | producing the change | development role and managed Sessions; agent commits (the default); worktree opened |
| `review` | judging someone else's change | code-review and critique roles; critic identities; code-review review items; PR marked ready for review |
| `verify` | proving it works | qa role; QA review items; `test:` commits |
| `integrate` | landing it | merges and GitHub squash merges; PRs; base branch advanced; candidate preserved or pushed; worktree merge, pull or rebase |
| `govern` | recording authority | Ask settlements with intent complete, decision or proposal; Decisions; pointer moves; Action done; queue changes; packet approval |
| `operate` | running the machine | production policy, admissions, launch refusals, repairs, escalations, operator scripts, Session preparation and stalls |
| `observe` | signals about the work | pings, notifications, orientation packets, Project Log entries, "Git last ran here" (index modification time), `source_error`, `source.truncated` |
| `unknown` | | any kind not in the table: the table is the one place a new kind gets classified |

Eight values are enough to tell the operator at a glance whether the
workspace is planning, building, checking or landing. Each maps onto a step
Arcadia already has (planner, development, code-review, qa, integration,
settlement, production). Finer kinds stay in `kind`.

## (d) How the agent tool and the semantic name are recovered

| Evidence | Gives | Confidence | Note |
|---|---|---|---|
| Commit author or committer email `<given>.<surname>@agents.arcadia.local` | tool, name, tier, role | high | Reverse lookup in the checked-in roster (`agentRoster()` in `src/codingAgents/agentIdentity.ts`). An address on the agent domain that the roster does not have is `unknown`, low. |
| `controller@arcadia.local` | host-worker | high | The Arcadia controller identity. |
| `Session.provider` (`claude-code-cli`, `codex-cli`, `opencode-cli`) with model or effort | tool; tier from the model registry or the effort; name from tool plus tier | high for the tool | A model the registry does not bind and no effort leaves the tier and name null. |
| `Co-authored-by:` an agent-roster address | tool, name | medium | This is how a GitHub squash merge, authored by the operator's account, names the agent. |
| `Co-authored-by: Claude … <noreply@anthropic.com>` only | claude-code | low | OpenCode can also run Claude models. |
| Worktree path prefix `/.claude/worktrees/`, `/.codex/worktrees/`, `/.opencode/worktrees/` | tool | medium | The app that created the worktree. Another tool may work inside it (finding 3). |
| Branch prefix `claude/`, `codex/`, `opencode/` | tool; Action slug from `<tool>/<action>-<timestamp>` | medium | This is worktree preparation's naming convention, so it is reported as a hint. |
| Commit sha in a worktree's HEAD reflog | which worktree made the commit | high for the mapping | This is what lets a commit on any ref be placed in its worktree. |
| A repository's configured `user.email` | operator | low | It is the operator's local Git identity, but Arcadia's settle and pointer commits made outside a Session use it too. It renders as `operator?`. The address itself is never written into the stream. |
| Policy receipt `authority.grantedBy` | operator | high | The name is withheld; only the role enters the stream. |
| Peer-watch commit trailers `Arcadia-Agent: <agent>/<tier>` and `Arcadia-Action: <project>/<action>` (`src/agentWatch/contract.ts`) | tool, tier, name; Project and Action | high | Parsed with the contract's own `parseAgentRef` and `parseActionRef`. No launcher writes them yet (none in the last 30 days of arcadia history), so today this row adds nothing; it takes over as soon as agents adopt the contract. |
| `/runs` operator-script receipt | operator | medium | The runner executes only on the operator's button press. |
| Role `actor_id` `host-*` | host-worker | high | `qa-reviewer:codex-terra` gives the reviewer profile's tool (medium). |
| `operator_pings.agent` name | tool and name from the roster | medium | The agent names itself. |

`strongestActor` keeps the most confident claim. A weaker claim that agrees on
the tool fills in a missing name, tier or role. All claims are kept in
`provenance.actor`, and disagreement is noted. The renderer shows
low-confidence attribution with a `?`.

## (e) Ordering and de-duplication

- **Window:** a row is selected when any of its timestamps falls in the
  window, but only events whose own time is inside the window stream (a review
  item opened inside the window and decided after `--until` shows only its
  opening). `source_error` events always stream.
- **Order:** time, then source priority, then id, compared by code unit (not
  locale). The order is total and stable, so two runs over the same data give
  the same stream on any host.
- **One fact, one event.** Records that share a dedupe key are merged
  (union-find, so the merge is transitive):
  `commit:<sha>` (git commit, settlement `documentsCommit`, governed-record
  facts, the worker's base-branch-advanced `newSha`, PR `merge_commit_sha`),
  `settlement:<request id>` (settlement, Discord notification, queue receipt
  `agent-ask:<request>`), `ask:<proposal id>` (preview and settlement),
  `pointer-after:<sha>:<action>` (a `point at <action>` commit's parent and
  the pointer receipt's `headBefore` plus its Action), `operator-run:<script
  id>` (only the *first succeeded* run of a script and the policy receipt its
  Grant produced; every other run, including refused ones, stays its own
  event), and `session-stalled:<id>`.
- **Deliberately not merged:** a candidate preservation receipt and the
  agent's commit it preserved (the receipt keeps the sha as a subject and in
  its evidence). A review item's opening and its decision are two events,
  unless the decision came within 5 seconds (machinery deciding, never waiting
  on the operator), when only the decision is emitted.
- **Which record leads:** source priority (asks, governed records, operator
  scripts, production, queue, pull requests, sessions, decisions, git, events,
  pings), then the more consequential kind (Action done before pointer moved).
  The lead keeps its time and summary. The others go into `alsoSeenAs`, and
  their evidence and subjects are added. The most confident actor among them
  wins, and provenance names the record it came from. An observation (the
  worker noticing main moved) never supplies the actor.

## (f) The point-in-time ("rewind") read model

`buildPointInTimeView(events, asOf)` (`src/timeline/rewind.ts`) is a pure fold
over the events at or before `asOf`. It runs over the records before
de-duplication, so sub-facts still move the state. It returns:

- production state and since when;
- worktrees active in the two hours before (a commit, merge, worktree opening
  or reflog merge; "Git last ran here" alone never counts), each with tool,
  name, Action and last kind of work;
- running Sessions;
- each Project's pointer, active Plan and last event;
- the last ten events that needed attention, with a review item's or a
  Decision's attention cleared once it is decided at or before `asOf`;
- the "what kind of work" lens: events per tool per `workKind` in the hour
  before.

`arcadia timeline --as-of <time> [--since <look-back>]` prints the view and
then the stream before it. Because the fold is pure and cheap, a scrubber
(Phase 2) can call it once per frame. Limits: the view knows only its window,
so a pointer last moved a week ago is "unknown in window" until `--since`
reaches it. A worktree removed since then left only its commits. Index
modification times exist only for the present.

## The command and the module

`arcadia timeline` is a read command (noun):

```sh
arcadia timeline                          # last 24h, newest 200 events, human lines
arcadia timeline --since 6h --project arcadia --tool codex --kind verify
arcadia timeline --as-of 2026-10-06T03:31Z --since 6h   # rewind
arcadia timeline --json                   # CLI envelope: events, sources (timings, errors), window
arcadia timeline --ndjson --limit 1000    # one event per line
arcadia timeline --follow [--json] [--interval 15]      # stream new events until Ctrl-C
arcadia timeline --pull-requests          # also GitHub PRs (gh api GET; network)
```

- `--since` and `--until` take ISO times or look-backs (`30m`, `6h`, `1d`,
  `2w`). A time with no zone (`2026-10-06T03:30`) is UTC, like a bare date. A
  relative `--since` counts back from the window's end.
- `--follow` polls every 15 s by default (`DEFAULT_FOLLOW_INTERVAL_MS`). Each
  poll re-reads a 10-minute overlap before the previous poll's end. A fact
  streams once: an event counts as seen if its id or any id it absorbed
  (`alsoSeenAs`) was streamed, so a later record that takes the lead does not
  re-emit it. `--follow` streams up to now and refuses `--until` and
  `--as-of`. The tests drive it with fake timers.
- `--ndjson` prints events one per line and nothing else: no blank line for
  an empty window, and a failure as one JSON line.
- `--workspace` and inline `ARCADIA_WORKSPACE=` resolve as for every other
  command.

It is **strictly read-only**:

- The database is opened with `readonly: true, fileMustExist: true`. As every
  SQLite WAL reader does, it writes the shared-memory index (`-shm`), and on
  an idle workspace (no other connection open) it leaves an empty `-wal`
  behind. The database file and its content never change; the test checks
  that.
- Git runs under `GIT_OPTIONAL_LOCKS=0` and `GIT_NO_LAZY_FETCH=1`, with
  `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` stripped
  from the inherited environment, and never runs `status`, `fetch`, `gc` or
  checkout.
- The command is `exempt` in the experiment-guard table, as `workspace
  leak-check` is, so it records no activity row.
  `tests/activity-no-record-commands.test.ts` runs it uninlined against a
  live-like default workspace and asserts it opened that database only
  read-only and recorded nothing.

The logic lives in `src/timeline/` so a dashboard can import it:

- `schema.ts`, `classify.ts`, `identity.ts`, `merge.ts`, `rewind.ts`,
  `follow.ts`, `time.ts`, `render.ts` and `index.ts` (`collectTimeline`,
  `pointInTime`, `defaultCollectors`);
- `collectors/*.ts`, one module per source.

Each collector is independently testable against injected read-only handles.
A collector that throws becomes one `source_error` event and one failed entry
in `sources`; the stream continues. That was verified live twice: once when a
30-day read overflowed a buffer (since fixed by chunked streaming), and once
for PRs when the sandbox blocked TLS. A failure to read the Project
repository list is one `source_error` too; the database sources still stream.

**Memory.** There is no total cap. Each query reads at most 5,000 rows per
table, and the commit log at most 5,000 commits per repository; a capped read
emits a visible `source.truncated` event. Governed-record facts per commit
are not capped (a settlement that creates 20 Actions yields 20 facts), and
the parsed frontmatter of every governed-file revision in the window is held
until the collector finishes: Plan revisions are reduced by the line scanner
to ids, titles and statuses. Blob contents are streamed in 32 MB chunks and
never kept. `--limit` bounds only what is printed. Measured peak RSS is
232 MB for 24 hours and 550 MB for 30 days.

**How this relates to what already exists:**

- `arcadia work monitor` is a snapshot of each working copy's preservation
  and delivery state. It runs `git status`, which can refresh an index.
- The dashboard's `/runs` page lists managed Sessions and execution runs.
- `arcadia activity` reads the CLI interaction log.
- `src/agentWatch/` is the peer-watch contract: it defines the
  `Arcadia-Agent` / `Arcadia-Action` / `Arcadia-Heartbeat` commit trailers and
  classifies a peer's liveness from them. The timeline reads the first two
  for attribution, with the contract's own parsers. A future live board
  (option A) could use the contract's heartbeat for real presence.
- `arcadia orientation timeline` is an unrelated effort-scale chart. The name
  overlap is open question 7.

None of these is an event history across sources. The timeline reuses the
agent roster, the model-tier registry, the read-only connection and the
experiment-guard classification instead of duplicating them.

**Known limits of the parsers:**
- SHA-256 repositories are untested: the reflog parser expects 40-hex object
  ids and skips other lines.
- `--no-renames` reads a renamed Plan as one deleted and one created.
- A Project `repo_path` that is itself a linked worktree is read through its
  common Git directory, so its own reflog is attributed as that repository's
  main checkout.

## (g) Phase 2 UX options (choose one to start)

**A. "Now": a live board by Project and tool.**
- **What it shows:** one row per Project and one lane per tool (Claude Code,
  Codex, OpenCode, host, operator). Each active worktree or Session is a
  card: agent name, Action, current kind of work as a colour, and time since
  its last event. An attention strip sits across the top. Delivered as a
  dashboard page, and optionally as a pinned Discord message that edits
  itself.
- **Needs from Phase 1:** `pointInTime(now)` every poll, plus `--follow` for
  the ticker.
- **Cheap:** everything above exists; a Next.js route can import
  `collectTimeline` directly instead of spawning the CLI.
- **Hard:** whether an interactive agent is alive *right now*. Git activity
  lags thinking time. Truly live presence needs transcript modification times
  (open question 2) or tmux and process probes.

**B. Replay: a scrubbable timeline.**
- **What it shows:** a horizontal time axis with one swimlane per Project, or
  per worktree within a Project. Event marks are coloured by `workKind` and
  shaped by tool. A scrubber re-renders the A board as of the scrubbed moment
  (`buildPointInTimeView` per frame). Playback at 1×, 60× or 3,600×. Clicking
  a mark opens its evidence (commit, PR, receipt).
- **Needs from Phase 1:** the raw event array for the window (a 30-day window
  is 16,292 records and 8,820 events, which fits in a browser), stable ids,
  and the pure fold.
- **Cheap:** the fold and the data.
- **Hard:** removed worktrees and past "Git ran here" times are gone, so
  replay is sparser than live. Smooth playback over months would want a
  cached projection (open question 4). Marks need layout work to stay
  legible: 30 events can share a minute.

**C. "What kind of work": an at-a-glance lens.**
- **What it shows:** a stacked band per hour (or per 10 minutes) of
  `workKind` by tool, with one sentence per active agent ("Claudia Mason:
  verify on transform-start-marker, 2 min ago"). It works as a dashboard
  header, a terminal summary, or a Discord digest posted when the dominant
  kind changes (planning → building → checking → landing).
- **Needs from Phase 1:** `view.lens` and the per-worktree `lastWorkKind`.
- **Cheapest of the three.**
- **Hard:** about 15% of events are `unknown` tool today. The lens is only
  as honest as attribution, so open question 3 is what makes it trustworthy.

A and C share almost all their data and could ship together: C as A's
header. B is the eye-candy direction, and its cost is mostly front-end.

## (h) Open questions for the operator

1. **What should "tool" mean when the app and the identity disagree?**
   - (a) The identity wins (current behaviour). Claudia Atlas in a Codex
     worktree shows as `claude-code`. Consequence: it tracks the model that
     did the work, but not the app you have to switch to.
   - (b) The worktree's app wins. Consequence: it tells you which app's
     history to open, but mislabels the model.
   - (c) Show both, e.g. `claude-code in codex`. Consequence: the most
     honest, and one more token per line.
2. **May the timeline read session-history metadata?** That means Claude Code
   transcript file names and modification times under `~/.claude/projects/`,
   Codex `codex-thread.json` thread ids, and OpenCode's session store; never
   their content.
   - (a) Yes. Consequence: "jump to this agent's conversation" from any line,
     and real live presence for option A.
   - (b) No. Consequence: presence stays Git-based and lags.
   - (c) Yes, plus local-AI one-line summaries of what each session is doing.
     Consequence: the richest "what is it doing", but it reads private
     content and spends local compute.
3. **Should Arcadia record the actor where it writes settlements, review-item
   verdicts and pointer receipts** (from the session's `GIT_AUTHOR_*` and the
   identity resolver)?
   - (a) Yes, as a small follow-up Action. Consequence: most `unknown` tools
     disappear.
   - (b) No. Consequence: about 15% of the stream stays `unknown`.
4. **Compute on read, or keep a projection?**
   - (a) Compute on every read (current): 1.2 to 2.7 s for one to thirty
     days. Consequence: no new state, nothing to drift, nothing to govern.
   - (b) A cached projection table refreshed by the worker. Consequence:
     instant replay over months, but a new database write path and a
     projection to keep honest. It would need its own Action, and a Decision
     if it changes what is authoritative.
5. **Which Phase 2 direction first?**
   - (a) A, the live board. Consequence: presence and orientation now.
   - (b) B, replay. Consequence: the "rewind and play back" wish, with the
     most front-end work.
   - (c) C, the lens. Consequence: the fastest win; pairs naturally with A.
   - (d) A with C as its header (recommended). Consequence: one page that
     answers "who is doing what, of what kind, right now"; B follows.
6. **6,833 dead test-fixture worktree checkouts** sit in
   `~/.claude/worktrees`, `~/.codex/worktrees` and `~/.opencode/worktrees`.
   They come from tests that prepared worktrees there with temporary
   repositories.
   - (a) File an Issue to stop the leak at its source, plus an operator
     script to remove only directories whose `gitdir` target is gone.
     Consequence: the tool directories become legible again.
   - (b) Leave them. Consequence: the timeline already ignores them, but any
     human browsing those directories still drowns.
7. **The name `timeline`** overlaps the existing `arcadia orientation
   timeline` (an effort-scale chart).
   - (a) Keep `arcadia timeline`. Consequence: the obvious name; the
     subcommand stays namespaced.
   - (b) Rename it to `arcadia stream`. Consequence: no overlap, a less
     obvious word.
8. **What may a stream line carry when it leaves this machine?** Summaries
   hold free text that agents and the operator wrote: commit subjects, Action
   titles, ping messages, escalation and refusal reasons, Decision questions
   and answers. Personal emails, logins and names are already withheld.
   - (a) Default-safe: anything posted to Discord or a shared view gets
     identifiers and kinds only, and a `--redact` option drops free text
     locally too. Consequence: safe to share, but less legible.
   - (b) Full summaries everywhere. Consequence: the most useful; anything an
     agent wrote into a commit subject can reach a shared channel.
   - (c) Full summaries locally, redacted when shared (recommended).
     Consequence: one rule at each delivery boundary.
9. **Delivery surface for Phase 2:**
   - (a) A dashboard page. Consequence: the best for replay and eye candy.
   - (b) Discord: a pinned live message plus digests. Consequence: ambient
     and low-friction, limited visuals.
   - (c) Both, Discord pointing at the page. Consequence: two surfaces to
     maintain.

## (i) Measured performance and a sample of real output

Measured on this host against the live workspace on 2026-10-06, after the
review fixes. The command's code ran in-process through `node --import tsx`,
calling `collectTimeline` directly: read-only database handle, no CLI activity
recording, nothing written. Before and after a run, every repository's index
and refs were unchanged, and the database content was unchanged.

| Window | Records before / after de-duplication | Wall time in `collectTimeline` | Peak RSS |
|---|---|---|---|
| 1 h | 66 / 41 | 2.2 s (cold) | |
| 24 h | 621 / 370 | 1.3–1.4 s | 232 MB |
| 7 d | 3,515 / 1,748 | 1.8 s | |
| 30 d | 16,288 / 8,948 | 3.0–3.2 s | 550 MB |

- Most of the fixed cost is about 100 short `git` processes across 14
  repositories. Running those in parallel is the obvious next step if
  `--follow` is ever tightened below 15 s.
- The governed-record reader was 4.2 s for 24 h with full YAML parsing. It is
  0.2 s with the Plan line scanner and object-id streaming.
- `--pull-requests` adds about 0.8 s per GitHub repository.

**Sample** (sanitised: home directory shown as `~`, GitHub owner as
`<owner>`; the stream itself already withholds personal emails, logins and
the operator's name). Rehearsal run 5, 2026-10-06 03:19–03:31Z; 25 of the
window's 49 events:

```text
! 10-06 03:19:14Z  -                       observe      claude-code·Claudia Atlas   Ping (attention, delivered): Run 5 G6 passed. Press G7 'grant-production-three-action-rehearsal-run5-2026-
  10-06 03:22:02Z  three-action-rehearsal  operate      host-worker                 Admission committed: three-action-rehearsal/write-start-marker launching on claude-code-cli
  10-06 03:22:02Z  three-action-rehearsal  operate      host-worker                 Admission issued for three-action-rehearsal/write-start-marker on claude-code-cli (epoch 24)
  10-06 03:22:12Z  three-action-rehearsal  implement    claude-code·Claudia Mason   Session started on write-start-marker
  10-06 03:22:29Z  three-action-rehearsal  implement    claude-code·Claudia Mason   Add MARKER.md for three-action rehearsal start (run 5)
  10-06 03:22:42Z  three-action-rehearsal  integrate    claude-code                 Candidate for write-start-marker preserved: IN PR (PR #5)
  10-06 03:23:46Z  three-action-rehearsal  govern       claude-code·Claudia Mason   Ask complete-write-start-marker-run5-2026-10-06 settled (complete): Marked Action three-action-rehearsal/w
  10-06 03:23:54Z  three-action-rehearsal  integrate    claude-code                 Candidate for write-start-marker preserved: IN PR (PR #5)
  10-06 03:24:03Z  three-action-rehearsal  review       host-worker                 PR #5 marked ready for review (three-action-rehearsal/write-start-marker)
  10-06 03:25:04Z  three-action-rehearsal  review       codex                       code-review passed on write-start-marker
  10-06 03:25:35Z  three-action-rehearsal  review       unknown                     R310 approved: Code review pass for <owner>/arcadia-three-action-rehearsal-20261004#5 at f68ec48ed4ff95772
  10-06 03:26:40Z  three-action-rehearsal  verify       unknown                     R311 rejected: QA fail for <owner>/arcadia-three-action-rehearsal-20261004#5 at f68ec48ed4ff95772fee108258
  10-06 03:27:48Z  three-action-rehearsal  verify       codex                       QA attempt 2 started on write-start-marker
  10-06 03:28:08Z  three-action-rehearsal  verify       unknown                     R312 approved: QA pass for <owner>/arcadia-three-action-rehearsal-20261004#5 at f68ec48ed4ff95772fee108258
  10-06 03:28:09Z  three-action-rehearsal  integrate    operator?                   merge f68ec48ed4ff95772fee108258d401158c26a54d: Fast-forward
  10-06 03:28:12Z  three-action-rehearsal  review       host-worker                 critique passed on transform-start-marker
  10-06 03:28:16Z  three-action-rehearsal  govern       host-worker                 Build packet approved for three-action-rehearsal/transform-start-marker
  10-06 03:28:19Z  three-action-rehearsal  govern       unknown                     R313 approved: Approve the immutable build packet for "Implement appending the start line transformed to u
  10-06 03:28:21Z  three-action-rehearsal  operate      host-worker                 Admission issued for three-action-rehearsal/transform-start-marker on claude-code-cli (epoch 24)
  10-06 03:28:59Z  three-action-rehearsal  implement    claude-code·Claudia Mason   Append transformed start marker and add marker tests
  10-06 03:29:06Z  three-action-rehearsal  integrate    claude-code                 Candidate for transform-start-marker preserved: IN PR (PR #6)
  10-06 03:29:41Z  three-action-rehearsal  observe      unknown                     Git last ran in the main checkout (main)
! 10-06 03:30:14Z  three-action-rehearsal  operate      host-worker                 Escalation (independent verdict failed) on three-action-rehearsal/transform-start-marker: Integration wait
  10-06 03:30:14Z  three-action-rehearsal  integrate    claude-code                 Candidate for transform-start-marker preserved: IN PR (PR #6)
  10-06 03:30:23Z  three-action-rehearsal  review       host-worker                 PR #6 marked ready for review (three-action-rehearsal/transform-start-marker)
```

The rewind view as of 03:31Z (`--as-of 2026-10-06T03:31Z --since 6h`),
abridged:

```text
Production: active since 2026-10-06T03:22:01.033Z

Active worktrees (activity in the 2 hours before):
  10-06 03:30:04Z  three-action-rehearsal  claude-code·Claudia Mason   govern       transform-start-marker
  10-06 03:28:09Z  three-action-rehearsal  operator?                   integrate    main
  10-06 03:23:46Z  three-action-rehearsal  claude-code·Claudia Mason   govern       write-start-marker
  10-06 02:39:05Z  arcadia                 claude-code·Claudia Atlas   govern       prepare-run-5-rehearsal-scripts

Running Sessions:
  none

Projects (latest first):
  three-action-rehearsal  pointer transform-start-marker  · last: 10-06 03:30:23Z observe Discord told the operator about settle-complete-transform-start-marker-2026-10-05
  arcadia                 pointer fix-reviewer-verdict-name-echo  · last: 10-06 03:22:01Z operate Operator script grant-production-three-action-rehearsal-run5-2026-10-06: succeeded

What kind of work (hour before):
  claude-code  implement   9
  host-worker  operate     9
  claude-code  govern      8
  codex        verify      3

Needed attention:
  10-06 03:30:14Z  Escalation (independent verdict failed) on three-action-rehearsal/transform-start-marker: ...
  10-06 03:26:06Z  QA failed on write-start-marker
```

One NDJSON event: a preservation receipt. The agent's commit it preserved
streams as its own event (line "Add MARKER.md …" above), and the
receipt's actor comes only from the worktree path and branch (medium, no
name), so it says no more than its evidence:

```json
{"schema":"arcadia-timeline-event-v1","id":"production:preservation:presv_51e8ff43ce4f404ca4","time":"2026-10-06T03:22:42.978Z","clock":"workspace-db","source":"production","kind":"production.preservation","workKind":"integrate","summary":"Candidate for write-start-marker preserved: IN PR (PR #5)","subjects":{"project":"three-action-rehearsal","action":"write-start-marker","commit":"735662021c29b5f43c669edb3b3fcddecdc69345","branch":"claude/write-start-marker-20261006T032202909Z","worktree":"~/.claude/worktrees/write-start-marker-20261006T032202909Z/arcadia-three-action-rehearsal","pullRequest":"#5","workspace":"~/Dev/MR/Arcadia/workspaces/martianrover"},"actor":{"tool":"claude-code","name":null,"tier":null,"role":null,"account":null,"confidence":"medium"},"attention":false,"evidence":[{"kind":"receipt","value":"candidate_preservation_receipts/presv_51e8ff43ce4f404ca4"},{"kind":"sha","value":"735662021c29b5f43c669edb3b3fcddecdc69345"},{"kind":"url","value":"https://github.com/<owner>/arcadia-three-action-rehearsal-20261004/pull/5"}],"provenance":{"event":"candidate_preservation_receipts.created_at","actor":"tool from worktree path prefix .claude/worktrees (the tool that created the worktree); tool from branch prefix claude/","project":"Project from the receipt's repository_path"},"alsoSeenAs":[]}
```

In twelve minutes, this sample shows run 5 as the operator lived it: the
operator's Grant, the worker admitting and launching Claudia Mason, her commit
and the candidate preserved into PR #5, Codex's reviewer passing code review,
QA failing then passing, and the second Action's QA failure escalating to the
operator. Each line names who did it, of what kind, and how that is known.
