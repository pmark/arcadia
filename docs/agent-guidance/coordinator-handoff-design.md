# Coordinator handoff without compaction: design

**Status:** a design, not a procedure. It builds, approves, installs and
schedules nothing. Until its changes ship, the procedure is still the
`arcadia-handoff` skill plus the release-manager and supervisor checkpoints.
The compact bootstrap and CONSTITUTION.md still bind.

**Author:** Claudia Atlas (claude, heavy), as Mira (release investigator),
launched by Signal on 2026-11-07. Evidence is pinned to main at `a53277b78`.

**Operator directions (verbatim, 2026-11-07):**

- "Compacting context is strongly discouraged. Launch a Mira agent to
  investigate and design a solution for reliable coordinator handoffs that
  eliminate the need for compaction."
- "It's crucial that coordinators are able to be transitioned to new handoff
  sessions automatically, which I assume means Arcadia needs to make it happen
  deterministically."

## Decision summary

1. **Arcadia's code runs the handoff, not the agent's memory.** A small
   deterministic loop, the *coordinator relay*, runs on the existing 60-second
   launchd timer beside `arcadia production liveness-check`. It measures each
   registered coordinator's context occupancy, decides when a handoff is due,
   assembles the state capsule, launches the successor, verifies delivery of its
   first prompt, and records the custody transfer.
2. **Trigger:** context occupancy read from the host's own transcript file. This
   was observed for Claude and Codex; OpenCode is unverified. It uses the
   formula that Claude Code's documentation gives for `used_percentage`. Prepare
   at 50% of the window, due at 60%, forced at 75%.
3. **Capsule:** a live projection per coordinator in the configured workspace,
   plus an immutable snapshot for each handoff generation. Arcadia derives most
   of it from canonical sources on every tick. The agent adds only a short
   journal of judgements, as it goes. Nothing is assembled under pressure.
4. **Launch:** coordinators run as host CLI sessions under tmux, which Arcadia
   can start, observe and stop. The operator reaches them through Remote
   Control. The desktop app's `start_session` stays a convenience and is never
   the path the relay depends on.
5. **Authority:** chat approvals cannot cross sessions, and the design does not
   pretend they can. A consequential approval goes to a durable surface the
   operator acts on once, such as the existing batch-merge card, a Decision or a
   day grant. Any session can then verify it. The one new authority needed is a
   standing Decision that lets the relay launch successor coordinators. The
   same Decision would also amend the existing rules this design changes,
   listed below. It is prepared as an Agent Ask proposal, not settled.

## Rules this design changes

Building it changes existing guidance. None of these may be built as routine
work. Each needs the operator's Decision, named here so that no change slips
through as an implementation detail.

| Existing rule | Where | What changes |
| --- | --- | --- |
| "Run the harness unmodified", "Do not add orchestration code, a queue service or a second runner" | `docs/agent-guidance/standard-harness.md` | The relay is new orchestration code: a scheduled tick that launches and stops coordinator sessions. The harness itself still runs unmodified (stock `claude`, `codex` and `opencode` binaries) |
| "Handoffs go to files … a checked-in file or an Agent Ask, never chat" | same | The capsule is a workspace file, not a checked-in one. Its precedent is the `incomplete_resumable` lease handoff receipt in the workspace. The Decision has to accept that, or require each generation's snapshot to be filed as an Agent Ask preview |
| "Use existing explicit checkpoints, not a new polling loop, hook, timer, supervisor service or session launcher" | `.agents/skills/arcadia-handoff/SKILL.md` | The design adds a timer tick, hooks and a session launcher. The skill would be amended to point at the relay once it ships |
| Posting to GitHub needs an explicit Decision | `docs/agent-guidance/agent-peer-watch.md` | The relay records custody on the coordination Issue. That comment needs Decision scope, or the record stays in the workspace only |
| Interactive launch is something "only an operator at the terminal opts in" | `src/sessions/index.ts` (`--interactive`) | The relay would start interactive sessions with no operator at the terminal |
| Launching a session needs authorization | AGENTS.md, Constitution | The standing Decision in the last section of this document |
| Hooks in `.claude/settings.json` or `~/.codex/hooks.json` are persistent configuration | AGENTS.md | Change 6 needs its own approval |

Only the read-only parts are routine without a Decision: the `budget`
measurement, `capsule --check`, `verify` and the pings, which already have
standing.

## What happened: the evidence

### Signal 2's last 27 hours

These figures come from Signal 2's own transcript:
`~/.claude/projects/-Users-pmark-Dev-MR-Arcadia-arcadia--claude-worktrees-friendly-yalow-05b6a1/41af263d-055d-47a1-b6b6-d833536ddb80.jsonl`.
Occupancy is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
on each main-chain assistant message. The model was Opus with a 1M-token window.

| Time (UTC) | Occupancy | Event |
| --- | --- | --- |
| 11-06 14:33 | 85k | Session resumes as Signal 2 |
| 11-07 00:49 | 500k | Nothing fires |
| 11-07 05:09 | 600k | Nothing fires. This design's *due* point, 12.5 h before compaction |
| 11-07 06:36 | 700k | Nothing fires |
| 11-07 16:59 | 900k | Nothing fires |
| 11-07 17:06:53 | ~910k | `start_session` for Signal 3 is refused: "The user is working over Remote Control, and this turn can't start that session, so nothing was started." |
| 11-07 17:30 | ~935k | The "HANDOFF TO SIGNAL 3" block is written in `signal-night-handoff-20261107.md` |
| 11-07 17:46:01 | 971k | The operator types `/compact` |
| 11-07 17:47:56 | 977,536 before, 101k after | `compact_boundary`, trigger `manual` |

Across the whole run, the most occupancy grew in any one hour was 117,752
tokens, or 11.8% of the window. The operator's agent memory (not a pinned
file, so unverified) records Rowan jumping from 43% to 72% in about an hour of
subagent reports. That is 29 points.

### The five hypotheses

| # | Hypothesis | Verdict | Evidence |
| --- | --- | --- | --- |
| H1 | No context-budget signal triggered a handoff early enough | **Confirmed, and sharper than stated.** The compaction was manual: the operator ran `/compact` after a failed launch. With `autoCompactEnabled: false` in the operator's settings, the session would otherwise have hit the hard limit. Nothing measured occupancy at any point | Table above; `~/.claude/settings.json` (read only) |
| H2 | `start_session` fails over Remote Control, which puts the operator in the loop | **Confirmed, and conditional.** The same tool started Rowan at 05:28Z and Momentum Keeper at 15:11Z. It refused only when the operator's latest turn arrived over Remote Control. The launch path depends on which device the operator is holding | Tool results in the same transcript |
| H3 | Chat authority words die with their session | **Confirmed.** The night note says it outright: "The approval lives in THIS Signal session ... a successor Signal must get the operator's word again." Observation rows 3, 9 and 13, plus the 11-06 handoff, add that the host classifier rejects a merge under the standing order alone and needs the operator's word in the acting session's own chat | `signal-night-handoff-20261107.md`; `signal-observations.md` |
| H4 | Live state is scattered and carried unevenly | **Confirmed.** Copies of the waiter in the scratchpad vanish on restart (exit 127). `quiet-watch.sh` lives only in a notes folder. Background subagents die with their parent: the #2211 builder and Clara were "gone with this session." Handoff notes are append-only narrative (17.6 KB, with "supersedes" blocks), so a successor has to read all of it to find the current state. Signal's 11-06 14:33Z takeover found a red check that had sat for an hour, because no handoff field carried open escalations | Night note; observation row 22 |
| H5 | Agents cannot measure their own context | **Partly wrong.** No agent tool reports it, but Claude Code and Codex were both observed writing the numbers to a file a script can read. OpenCode is unverified. See the next section | Host matrix |

## Host capabilities

Each row is marked **observed** (seen on this host), **documented** (vendor
documentation, not seen here) or **inferred** (neither).

| Capability | Claude Code 2.1.308 | Codex CLI 0.160.1 | OpenCode 1.16.2 |
| --- | --- | --- | --- |
| Occupancy in a file | **Observed:** transcript JSONL `message.usage` on each assistant line. The window size is not in the transcript; `compact_boundary.preTokens` 977,536 implies 1M | **Observed:** rollout `~/.codex/sessions/.../rollout-*.jsonl` `token_count` events carry `last_token_usage.input_tokens` and `model_context_window` (475,000) | **Inferred:** `opencode export <sessionID>` returns session JSON, probably with per-message tokens. Unverified |
| Live occupancy for the agent | **Documented:** the status line receives `context_window.used_percentage`, `context_window_size` and `session_id`, debounced at 300 ms, and only while a TUI renders it | **Documented in the skill:** app-server `thread/tokenUsage/updated` | Unknown |
| Hooks | **Observed:** SessionStart, Stop and PostCompact fired in Signal 2's desktop session. **Documented:** PreCompact (matcher `manual`/`auto`, can block, stdout steers the summary), SessionStart `source` `startup/resume/clear/compact/fork` with `additionalContext`, Stop and UserPromptSubmit can inject context. No hook input carries a token count | **Observed:** `~/.codex/hooks.json` has SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, SubagentStart, SubagentStop, Stop, Interrupt. There is no compaction event | **Inferred:** a plugin event API. Unverified |
| Start an interactive session from a script | **Observed in `--help`:** `claude [prompt]`, `--session-id <uuid>`, `-n/--name`, `--remote-control [name]`, `--bg`, `claude agents --json`, `attach`, `logs`, `stop`, `respawn`. Arcadia already launches `claude` in tmux (`src/sessions/index.ts`, `arcadia go --launch --interactive`) | **Observed in `--help`:** `codex [PROMPT]`, `resume`, `fork`, `queue --thread --message`, `remote-control` (experimental), `agents`. Arcadia launches `codex exec` in tmux | **Observed in `--help`:** `opencode run -i/--interactive`, `--session`, `--continue`, `--fork`, `serve`, `attach`, `web`, `session list`. Arcadia launches `opencode run` in tmux |
| Start a desktop-app session from a script | **Not available:** `start_session` exists only inside an agent turn, and over Remote Control it refuses. `claude agents --json` returned `[]` from this sandbox while desktop sessions were live, so it does not list them (or the sandbox hides them) | n/a | n/a |
| Deliver a later message to a running session | Desktop sessions: only from another session's turn (cross-session messages). A tmux pane: `tmux send-keys`, which reads as user input (see Authority) | **Observed in `--help`:** `codex queue` | **Inferred:** `run --attach --session` |
| Stop a session | tmux kill, or `claude stop` for `--bg` | tmux kill | tmux kill |

What this means: Claude Code and Codex already write the occupancy data
(OpenCode is unverified), and all three give a command-line launch. Arcadia already runs these launches in tmux for build
Sessions. The desktop app is the one surface a script cannot drive.

## Is the operator's assumption right?

Mostly, yes. Arcadia can run these steps deterministically: detection, the
canonical part of the capsule, the launch decision, the launch, the
prompt-delivery check, the custody record, re-arming watchers and alerting.
Five parts cannot be fully deterministic, and the design is built around them
rather than pretending otherwise.

1. **Judgement content.** "Why Rowan is holding" or "what the operator meant
   by A1" is model output. The relay cannot write it. It can make sure such
   notes are written as they happen (the journal), show each note's age, and
   hand over without them when they are stale.
2. **The successor's own run.** Acceptance is a model running deterministic
   check commands. The relay can verify the receipt those commands leave, retry
   once, and alert. It cannot make a model behave.
3. **Chat approvals.** The host's permission classifier judges each session on
   its own transcript. No Arcadia code can move the operator's "Yes merge them"
   into another session, and it must not try. The fix is to move approvals out
   of chat.
4. **Desktop-app sessions.** No external API starts or stops them. Fully
   automatic renewal means coordinators run as CLI sessions, which Arcadia can
   drive and the operator reaches through Remote Control. Whether a CLI
   `--remote-control` session shows up where the operator looks, and whether
   peer sessions can message it, is **unverified** (probe P1).
5. **Host-level stops.** An expired sign-in, an exhausted usage window
   (`autoContinueAtUsageLimit: false`), a host update or a sleeping machine
   stops any session. The relay detects these and alerts. It cannot clear them.

## Designs considered

| Design | What it is | Why not, or why |
| --- | --- | --- |
| A. Better discipline | Sharper skill text, check `/context` more often | This is what failed. It rests on the agent remembering, which the operator ruled out |
| B. Hooks only | A Stop or PreCompact hook nags the agent, and SessionStart injects the handoff | Deterministic detection, but launch still depends on the agent or the operator. Kept as backstops in C |
| C. **Coordinator relay (chosen)** | Arcadia code on the launchd timer measures, assembles, launches, verifies and records. Coordinators run as CLI sessions in tmux | The only option where no step depends on agent memory or a hidden operator step. It reuses the tmux launcher, the liveness timer, pings and the batch-merge card |
| D. Desktop `start_session` | The outgoing agent starts its own successor | Only inside a turn. Refused over Remote Control (H2). Depends on the outgoing agent |
| E. Accept compaction | PreCompact stdout steers a better summary | Lossy by construction, and it is what the operator rejected |
| F. Agent-host daemon (`claude --bg`, `codex remote-control`) | The host's own background manager | Promising, and it could replace tmux in C later. The combination with `--remote-control` and its stop semantics are unverified (probe P2) |

## The design

### (a) Trigger

- **Who measures:** `arcadia coordinator budget` (read-only). The relay runs it
  each tick for every coordinator registered in the workspace.
- **Source:** for Claude, the last main-chain (not `isSidechain`) assistant
  `message.usage` in the registered transcript. For Codex, the last `token_count`
  event in the rollout. OpenCode waits for probe P4. Occupancy counts input
  only (`input + cache_creation + cache_read`), which matches the documented
  `used_percentage`. After a `compact_boundary`, it uses the lines that follow.
- **Window:** for Codex, `model_context_window` from the rollout. For Claude, a
  new `contextWindow` field per model in the bundled model-tier registry
  (`src/codingAgents/modelTiers.ts`; there is no such field today). The relay
  refuses to report a percentage when the registry and an observed `preTokens`
  disagree.
- **Fallback when usage is missing or unreadable:** the state is
  `unmeasured`. It pings once per episode and counts main-chain turns as a
  coarse proxy. Its threshold is uncalibrated: set it from the first measured
  renewals, and until then treat `unmeasured` for more than an hour as *due*.
  It never reports a percentage it does not have.
- **Thresholds:**
  - *prepare* at 50%: tell the coordinator to bring its journal up to date.
  - *due* at 60%: start the handoff at the next safe point.
  - *forced* at 75%: the relay launches without waiting for the outgoing agent.

  At the worst growth observed (29 points per hour), 60% still leaves more than
  an hour before the 90s, and the relay acts within one 60-second tick. These
  are starting values: record every renewal's occupancy and recalibrate after
  ten.
- **Safe point:** the outgoing coordinator may defer *due*, never *forced*, by
  running `arcadia coordinator hold --until <event> --max 20m`. That is for a
  consequential operation already in flight, such as a press or merge. The relay
  records the hold. A hold ends at its event or at 20 minutes, whichever comes
  first. Only one hold is allowed per episode: a second `hold` is refused. At
  *forced*, the relay still launches, but it does not stop the predecessor
  while a hold is open (see (c) step 5).

### (b) The state capsule

Each coordinator role and Project has three files in the configured workspace,
under `<workspace>/coordinators/<project>/<role>/`. That location is never a
scratchpad or notes folder, so the files survive restarts.

- `live.json`, the live projection, rewritten each tick.
- `snapshots/<generation>.json`, written once when a handoff starts and never
  changed afterwards. Its sha is the one the launch prompt pins.
- `generations.jsonl`, append-only.

The capsule is a **derived projection**: it never grants authority, and every
field points to its canonical source. Its precedent is the
`incomplete_resumable` lease handoff that `arcadia go` resumes from (Decision
0051).

**Custody maps onto existing rows.** A coordinator holds no Action claim; it
coordinates Actions. Each generation is an `agent_sessions` row of a new
`coordinator` kind, keyed by the native session id and its transcript path:

- for Claude, the `--session-id` that the relay passes;
- for Codex, the rollout file that holds the thread id. It is found by scanning
  `~/.codex/sessions/` for the new file whose first record names the launch's
  worktree, because the native id is not exposed when the launch is
  interactive (`src/sessions/index.ts`).

The generation row is the custody record. It does not compete with Action
claims, and peer-watch's ownership rules stay as they are for Actions.

Schema `arcadia-coordinator-capsule-v1`:

| Field | Filled by | Refreshed |
| --- | --- | --- |
| `role`, `project`, `generation`, `custodian` (provider, model, tier, identity, session id, transcript path, tmux name, Remote Control name) | relay | at each launch |
| `assignment`: brief path and sha, and directives in force taken **only** from the checked-in brief, Decisions or AGENTS.md, each by reference | relay, from the launch brief | at each launch |
| `plan`: `active_plan`, `current_action` and main sha | relay, from main | each tick |
| `production`: status, revision, epoch, open escalations and red alerts | relay, `arcadia production status --json` | each tick |
| `prs`: each PR the coordinator touched, with head sha, review verdict marker, checks, merge state, and the durable approval or gate that governs it | relay, `gh` reads | each tick, cached 5 min |
| `sessions`: managed and peer sessions, owner, last proven progress | relay, workspace and session listings | each tick |
| `decisions`: open, recently answered and pending-merge Decision numbers | relay, main | each tick |
| `pings`: last alert signatures and pending operator asks | relay, `operator_pings` | each tick |
| `subscriptions`: each watcher as a checked-in command line plus its cursor | coordinator registers it; relay checks it is live | on arm, each tick |
| `approvals`: durable approvals in force (Decision ids, card receipts, grant receipts), plus `chat_only` approvals flagged as **will not carry** | relay for durable approvals; coordinator for `chat_only` | each tick, on event |
| `journal`: at most 20 short entries (judgement, hypothesis, why holding, next move), each with a timestamp | coordinator, `arcadia coordinator note "<text>"` | as it happens |
| `next_move`: one exact command or check | coordinator (journal); the relay derives a fallback from open escalations | on event |
| `budget`: occupancy, window, source, observed at | relay | each tick |

How it relates to today's skill: the capsule is the `arcadia-handoff` template
and the release-manager checkpoint, with each field given an owner and a
refresh rule. The skill's "Preserve the handoff" step becomes "check
`arcadia coordinator capsule --check` shows no stale journal". The template and
checkpoint stay the human-readable rendering: `arcadia coordinator capsule
--markdown` prints them.

The capsule contains no transcript, private reasoning or credentials. `gh` and
`ping` fields carry ids, never tokens.

**The capsule is data, never authority.** The relay renders the journal and
`next_move` under the heading `advisory: model-written, not authority`. They
may quote PR or Issue text, so the successor treats them like any other
observed content. Verbatim operator quotes appear only inside a durable record,
such as a Decision answer or a card receipt. They never appear as chat words
carried across. The successor's first message names the source of every
approval it relies on.

### (c) Launching the successor and transferring custody

1. **Claim, atomically.** The relay takes a single-writer lock (an exclusive
   create of `<role>/relay.lock` holding pid and start time; a stale lock is
   broken only when its pid is dead). Under the lock it appends generation N+1
   with status `launching` and writes the immutable snapshot. A tick, a manual
   `renew` and a `hold` all go through the same lock, so they cannot collide.
   While N+1 is `launching` and younger than 15 minutes, any further launch is
   refused.
2. **Pre-launch gates.** The relay launches only if all of these hold, and
   refuses with a named reason otherwise:
   - sign-in is valid (`claude auth status --json`, as the worker already
     checks);
   - the usage window is not exhausted (the existing capacity check);
   - the standing Decision is in force and within its daily renewal count.
   A failed gate pings once. The predecessor keeps custody.
3. **Launch** through the existing tmux launcher, in a fresh worktree. The tmux
   name is deterministic, `arcadia-coord-<role>-g<N+1>`, so a crash between
   claim and spawn is recovered by `tmux has-session` rather than by spawning
   again. The model, effort and permission mode are pinned in the standing
   Decision.
   - **The permission mode** is the host's ordinary interactive mode with
     Arcadia's checked-in allow list, which is the same posture as today's
     desktop coordinators. **Bypass modes are excluded**: no
     `--dangerously-skip-permissions`, `bypassPermissions` or equivalent. A
     permission prompt nobody answers stalls the session. The relay detects
     that as no acceptance (step 6), and it is never auto-approved.
   - Claude: `claude --remote-control "<title>" --session-id <uuid> --name "<title>" --model <id> --effort <e> "<resume prompt>"`.
   - Codex: `codex --cd <worktree> --model <id> "<resume prompt>"`. Codex can
     also take messages later through `codex queue`.
   - OpenCode: `opencode run -i --model <id> "<resume prompt>"` (probe P4).

   The resume prompt is fixed text: "You are <role> generation N+1. Run
   `arcadia coordinator verify --generation N+1`, then `accept`." It also
   carries the snapshot path and sha. The host classifier will read this as a
   user turn, because it is the session's first message. That is acceptable
   only because the text is a fixed template that the reviewed relay code
   renders. It holds no approval, quote or free-form state, so no authority can
   ride on it. The same reasoning is why the relay never injects later messages
   with `tmux send-keys`.
4. **Delivery check.** Within 2 minutes, the relay reads the successor's
   transcript and matches its first user message against the prompt's hash.
   This meets AGENTS.md's "verify actual prompt delivery."
5. **Acceptance and fencing.** The successor runs `verify` (section f) and then
   `arcadia coordinator accept --generation N+1 --snapshot-sha <sha>`. The relay
   marks N+1 `custodian` and N `handed_off` in one locked write. **From that
   moment, mutating coordinator commands check the caller's generation**:
   `arcadia ping send` with a coordinator role, `coordinator note`,
   `coordinator subscribe`, preparing a batch-merge card and `renew`. A
   predecessor that runs any of them gets a refusal that names its successor.
   Read commands stay open. Two coordinators can still both *read*, but only
   one can act through Arcadia.
6. **Stand-down of N.**
   - **tmux-hosted predecessor.** The relay stops its pane only when the
     predecessor is idle: its transcript shows the turn ended, no hold is open,
     and no subagent or background task is running (every `Agent` or
     background `Bash` call in its transcript has a recorded completion).
     Otherwise it waits.
     At 60 minutes it pings once instead of killing.
   - **Desktop predecessor** (only during migration). The relay cannot stop it.
     The generation fence in step 5 is what stops it acting through Arcadia.
     A project hook, once installed (change 6), adds "custody moved to
     generation N+1; stand down" to its next turn. Hooks installed after the
     predecessor started may not load. Until a predecessor has been started
     after the hook was installed, the relay also sends one `fyi` ping that
     names both sessions, so the operator can see there are two. At *forced*,
     this is the only case where a live predecessor can keep doing things
     outside Arcadia's commands (direct `gh` or `git`). The design says so
     plainly rather than claiming a fence it does not have.
   - Until acceptance, the predecessor keeps custody, so coordination never has
     a gap.
7. **If the launch fails** (no prompt delivered, no acceptance within 15
   minutes, or the process exited), the relay marks the generation `failed`,
   stops that tmux name, waits one tick, and retries once with a fresh session
   id. The retry passes the same pre-launch gates. After a second failure it
   sends one `arcadia ping send --kind attention`, naming the exact failure and
   the exact `arcadia coordinator renew` command that would retry. The
   predecessor stays custodian and is told to work in a low-context mode: no
   large reads, delegate to subagents, keep the journal current. That alert is
   a visible step for the operator, never a hidden one. Provider fallback
   (Claude to Codex) is **off** unless the standing Decision names it, because
   AGENTS.md forbids an unapproved paid fallback.
8. **Titles and records.** The successor retitles itself `⭐ 🚦` through the host
   tool. The custody record is the generation row in the workspace. A comment
   on the coordination Issue (#1929 today) is posted only if the standing
   Decision includes it (see "Rules this design changes").

### (d) Authority continuity

| Carries, because it is a record | Does not carry, because it lives in a session |
| --- | --- |
| Decisions on main (0173 day grant, 0182 C, 0187 A and so on) | Words in chat ("Yes merge them", "A", "Save waiter") |
| Operator-pressed card receipts (day grant, START, batch-merge) | The host classifier's view of what the operator approved |
| Standing directives in AGENTS.md and the launch brief | "Always allow" permission grants given in a session |
| Durable PR facts: head, verdict marker, checks | A relayed quote (relaying it would be laundering) |

The design rules:

1. **Move consequential approvals out of chat.** When the operator approves a
   merge in chat, the coordinator turns it straight into the existing
   batch-merge card (`src/decisions/batchMerge.ts`), with heads pinned. The
   operator's tap is a receipt that any session, and the script runner, can
   verify. It is one extra tap after the chat "yes", or the only input if the
   operator taps without typing. It is offered because it replaces a chat
   approval that dies with its session, not because it is free. The card's
   script runs the merge, so no agent classifier is involved.
2. **Name what will be lost.** The capsule's `approvals.chat_only` lists every
   chat approval not yet exercised. The relay warns at *prepare*. The
   coordinator then either exercises the approval or prepares the card before
   *due*.
3. **Never re-ask what a record covers.** The successor's `verify` lists the
   durable approvals in force. Signal's observation rows 6, 11 and 15 show
   coordinators re-asking for authority they already held.
4. **The one new authority:** a standing Decision that lets the relay launch
   one successor per registered coordinator role at *due* or *forced*. It pins
   provider, model, effort, permission mode, attempt limit and expiry. Launching
   sessions spends money and changes what runs, so this is the operator's call
   (see the end of this document).

### (e) Watchers and wakes

- **Watchers are checked-in commands, never scratchpad copies.** Check in
  `quiet-watch.sh`'s logic as a mode of `scripts/wait-for-event.sh`, or of
  `arcadia timeline --wait` once Decision 0184 A ships. A watcher is registered
  as `arcadia coordinator subscribe "<command line>" --cursor <c>`.
- **The resume prompt re-arms each subscription** from the capsule, with its
  last cursor, so events that landed during the handoff still fire (the
  re-baselining defect in `docs/design/session-notifications.md`).
- **The relay checks liveness:** each tick it confirms a live process for each
  subscription, matched on a marker in its argv, and pings once if a
  subscription has been dead for over 5 minutes.
- **Helpers outlive their parent:** long-running builders are started as their
  own sessions, by the relay or `start_session`, not as background subagents. A
  subagent's result must already be on a PR before the handoff. The capsule's
  `sessions` field lists both kinds.

### (f) Verification: how the successor proves it has the whole state

`arcadia coordinator verify --generation N` is deterministic and read-only:

1. The immutable snapshot's sha matches the prompt, and the generation is the
   newest `launching` row.
2. It re-derives every relay-owned field from its source *now* and prints the
   differences from the snapshot (PR heads, production revision and epoch,
   Decision numbers, pending pings, sessions alive). A difference is expected
   and fine: it shows what changed during the handoff. It is not a failure.
3. Every subscription is armed, and its cursor is not older than the snapshot.
4. Every journal entry is listed with its age. An entry older than 2 hours is
   marked `stale`.
5. Every chat-only approval is listed as lost, with its prepared card, if any.
6. One `next_move` exists and names a command.

It exits 0 only when items 1 to 3 pass. Items 4 to 6 are warnings the successor
reports in its first message. `accept` refuses unless `verify` passed against
the same snapshot sha within the last 10 minutes.

### (g) The vital few first changes

Ranked by how far each one moves toward fully automatic transitions.

| Rank | Change | What it moves | Authority |
| --- | --- | --- | --- |
| 1 | **`arcadia coordinator register` and `budget`, plus a relay tick on the launchd timer that pings at prepare, due and forced.** Read-only measurement, one ping per episode | Detection becomes code. On 11-07 it would have pinged at 05:09Z, 12.5 h before compaction | The `budget` command alone is routine: read-only, and its pings already have standing. **Scheduling it on the launchd timer is new timer work** (see "Rules this design changes"), so it waits for the Decision. Any of A, B or C covers it |
| 2 | **The capsule (live view and immutable snapshots), `note`, `verify` and `accept`, custody generations as `agent_sessions` rows, and the generation fence on mutating coordinator commands.** | Handoffs no longer depend on assembly under pressure or a narrative note. Custody becomes a record, and only the custodian can act through Arcadia | Code PR. The fence changes what agents may do, so the operator merges it |
| 3 | **Relay launch (`arcadia coordinator renew`) through the tmux launcher, with the delivery check, one retry and the alert path.** | Removes the agent and the operator from the launch. The step that failed at 17:06Z | **Needs the standing Decision** (launch authority). Probes P1 and P2 first |
| 4 | **Approvals to durable surfaces:** guidance makes a chat merge approval become a batch-merge card at once, and `approvals.chat_only` is tracked | Removes re-approval after each handoff | Guidance PR. It changes how agents seek approval, so the operator merges it |
| 5 | **Watcher continuity:** check in quiet-watch as a mode, add subscriptions and cursors to the capsule, and liveness-check them | Wakes survive handoffs and restarts | Routine. Merge in a production gap |
| 6 | **Project hooks as backstops:** PreCompact on a registered coordinator runs `arcadia coordinator renew --now` and prints the capsule path. A SessionStart hook with `source=compact` adds "you were compacted; read the capsule." The stand-down hook | Catches the exact 17:46Z event, and fences predecessors | Persistent configuration in `.claude/settings.json` (and `~/.codex/hooks.json`), so it needs an operator Decision |

Deferred, each with its revival trigger:

| Deferred | Revival trigger |
| --- | --- |
| Moving from tmux to `claude --bg` or `codex remote-control` | Probe P2 shows the combination works with Remote Control and a clean stop |
| OpenCode coordinator support | An OpenCode coordinator is assigned, or probe P4 passes |
| Provider fallback on launch failure | Two relay launches fail on one provider within a week, and a Decision names the fallback |
| Fencing a stale coordinator's direct `gh` and `git` writes, beyond Arcadia's own commands | A predecessor is observed writing to GitHub after `handed_off` |
| Recalibrating thresholds | Ten recorded renewals, or one forced renewal |
| Relay injection of mid-session wakes (`tmux send-keys`) | Never by default: typed text reads as operator input to the host classifier. Revisit only with a host-supported, labelled channel |

## Pre-mortem: how this could fail

- **The relay launches a duplicate coordinator.** Prevented by the
  single-writer lock, the `launching` generation claim, the deterministic tmux
  name checked with `has-session`, and refusing to launch while N+1 is
  `launching` and younger than 15 minutes.
- **Two coordinators act after a handoff.** The generation fence refuses the
  predecessor's mutating Arcadia commands. Direct `gh` and `git` writes are not
  fenced. That gap is named in (c) step 6 and in the Deferred table.
- **The stand-down kills in-flight work.** The pane is stopped only when the
  predecessor is idle, with no open hold and no running subagent or
  background task. Otherwise the relay pings instead.
- **Occupancy is misread after a model switch or `/fast`.** The window comes
  from the registry for the model on the *latest* usage line. A mismatch reads
  as `unmeasured`, never as a guess.
- **Measurement is wrong while the transcript lags.** The hooks documentation
  says transcripts are written asynchronously. The relay uses the newest line
  and acts on *due* or *forced*, which already leave a wide margin.
- **The relay itself dies.** The liveness-check timer already pages when the
  worker stops. The relay tick writes its own heartbeat, and liveness-check pages
  on it.
- **The successor accepts without reading.** `accept` needs a fresh `verify` at
  the same sha. The first message must quote the verify warnings, so a silent
  skip is visible in the transcript.
- **Remote Control is unavailable** (sign-in, network). The session still runs
  in tmux and coordinates. The operator loses chat access, not the run. The
  relay pings once.

## Probes to run before change 3

P1 and P2 start real sessions, so they spend tokens. Each needs the operator's
approval before it runs, with a spend bound of one short prompt per probe, and
a stop with `claude stop` or by killing the tmux pane. They use a throwaway
fixture worktree and never touch production. P3 and P4 are read-only.

- **P1:** start `claude --remote-control "probe" --name probe "say hi"` in tmux.
  Check it appears in the operator's Remote Control list, on desktop and phone,
  and whether a desktop session can send it a cross-session message.
- **P2:** the same with `--bg`. Check `claude agents --json`, `logs` and `stop`,
  and whether `--remote-control` still applies.
- **P3:** confirm `compact_boundary` and usage fields in a Sonnet transcript,
  and record its window size.
- **P4:** `opencode export <id>`: does it carry per-message tokens?

## Operator Decision needed

**Standing order: may Arcadia's relay launch successor coordinators?**

- **A. Yes, pinned.** The relay may launch one successor per registered
  coordinator role (Rowan, Signal) at *due* or *forced*, with the same provider
  and model as the outgoing coordinator. Limits:
  - at most two attempts per renewal and six renewals a day;
  - the ordinary interactive permission mode, never a bypass mode;
  - it expires after 30 days.

  The same answer also accepts the rule changes listed in "Rules this design
  changes": the relay timer, the workspace capsule as the handoff file, the
  unattended interactive launch, and an optional custody comment on the
  coordination Issue. Project hooks (change 6) stay a separate approval.
  **Consequence:** handoffs need no operator step. Each renewal costs one fresh
  session's start-up tokens. The operator is pinged only when both attempts
  fail or a pre-launch gate refuses.
- **B. Yes, but ask first.** The relay prepares everything and pings a
  one-tap "Start successor" card at *due*, and launches at *forced* only if the
  card was not pressed. **Consequence:** one tap per handoff while you are
  awake, automatic overnight. Slower.
- **C. No launches.** The relay timer only measures and alerts (changes 1, 2
  and 5). The timer and the workspace capsule are accepted; launching is not.
  **Consequence:** detection and the capsule improve, but someone still starts
  each successor by hand, so the 17:06Z failure can recur.

Recommended: **A**, after probes P1 and P2 pass. Prepared as an Agent Ask
proposal; nothing is settled.

## Open uncertainties

- Whether CLI sessions with `--remote-control` are visible and messageable
  where the operator and peer sessions look (P1). If not, change 3 still
  removes the agent from the launch, but operator chat access would need the
  desktop app.
- Whether desktop-app sessions pick up project hooks added after they start.
  Inference: settings are read at start, so the stand-down hook covers only
  sessions started after it is installed.
- Claude window sizes per model are not in any file Arcadia reads today. They
  have to be registered by hand and checked against observed `preTokens`.
- Signal 2's transcript records that compaction was manual. It does not show
  what would have happened at the hard limit with auto-compact off.
