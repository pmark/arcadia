---
arcadia: v1
type: decision
id: "0012"
slug: the-session-primitive
project: arcadia
status: approved
question: Arcadia models Projects, Plans, Actions, Decisions, Logs, Artifacts, and Runs, but has no first-class record of the thing that actually happens — one bounded stretch of coding-agent work. Should Session become a primitive, and if so, what exactly does Arcadia store about it?
gap_type: missing-decision
recommendation: Name Session as a primitive, but make it thin. Arcadia should store the governance linkage, provider session pointer, and terminal transport needed to leave and rejoin the work, while delegating the transcript to the coding agent. Use an explicitly launched tmux session as the first transport around Arcadia's existing isolated worktree; record process liveness and exit status only, then resolve the repository after exit. Arcadia records the before and after and never observes the during.
confidence: high
plan: idea-to-managed-build
action: launch-tmux-backed-session
decided: 2026-08-29
answer: "Yes. Session becomes a thin workspace-owned operational primitive for one bounded coding-agent dispatch. It records the exact Project, plan, Action, immutable packet id and hash, authorizing Decisions, provider profile, model, effort, base revision, branch, worktree, provider session pointer, and optional terminal transport before launch; after exit it records only process outcome and links to the resulting Log, Decisions, Artifacts, Candidate, validation, and delivery evidence. Arcadia stores no transcript and observes no semantic progress during execution. arcadia go owns repository-local reconciliation, isolated-worktree preparation, Session persistence, and explicit launch; arcadia advance and its queue consume the same total project-transition resolver, which must produce exactly one of launch, plan, Decision, repair, reconcile, wait, or milestone completion. Only one prepared or running Session may hold a repository lease by default. tmux is the first reattachable transport, not the Session model, and a successful process exit never completes or accepts an Action by itself."
updated: 2026-08-29
---

# Decision 0012: The Session primitive

## Context

Arcadia's canonical concepts (`docs/arcadia-semantics.md`) are Domain, Project,
Mission, Outcome, Milestone, Action, Artifact, Decision, and Log. Its
implementation adds ExecutionRun. None of these is the thing that actually
happens when work gets done: **one bounded stretch of coding-agent work, which
starts from a resolved Action and ends having produced commits, documents, and
a clearer next state.**

Four independent pieces of evidence say this absence is real, not theoretical.

**1. Decision 0011 had to invent it.** Proposing a queue for `arcadia go`
handoffs required a record to queue. `ExecutionRun` did not fit — it models a
pre-planned sequence of individually authorized steps, built for short codex
invocations inside a known plan, not one open-ended autonomous session. So 0011
proposed "an agent session" as a new record kind, described as an
implementation detail of queuing. It is not an implementation detail. It is the
missing primitive, discovered from one direction.

**2. `arcadia go` already computes a session and then forgets it.** At
`--apply --agent <x>`, `go` resolves the Action, the plan, the model, the
effort, the branch, and the worktree path — everything that defines a session —
assembles a launch command, returns it as JSON, and persists none of it. The
next `go` invocation reconstructs the world from Git and documents because
nothing recorded what the last session was.

**3. The operator's own framing presupposes it.** "Arcadia's role is before and
after a session, not during it" is only coherent if a session is a thing with a
before and an after. That sentence is a specification of a boundary around an
object Arcadia does not model.

**4. A managed project produced session artifacts the schema could not type.**
When `go` first validated a real repository, five documents failed on `type`.
Four (`rubric`, `contract`, `assessment`, `proposal`) were specifications
produced *during* sessions; one (`session-prompt`) was the brief handed *into*
a session. All five were remapped to `reference` to unblock dispatch. That
remap was expedient and is worth naming as a compromise rather than a fix: the
schema had no home for either the input to a session or its specification
output.

## Decision

### 1. Session becomes a primitive, and it is thin

A **Session** is one bounded stretch of agent work: it begins when Arcadia
dispatches a resolved Action to an agent, and ends when that agent's process
exits.

Arcadia does **not** build a session log, a transcript store, or a live view.
Investigation of the two supported agents found all of that already exists:

- The `claude` CLI persists sessions by default (`--no-session-persistence`
  disables it), accepts a display name (`-n`), supports `--resume`,
  `--continue`, `--fork-session`, and can run detached (`--bg`).
- Claude Code's session registry already exposes, per session: a stable id,
  title, working directory, running state, last activity, **and the pull
  request number and state it produced**.
- The `codex` CLI has `resume`, `fork`, `archive`, and `delete` for saved
  sessions, plus an experimental `cloud` surface for browsing Codex Cloud
  tasks.

Duplicating any of that would be waste, and worse, would compete with the
tool the operator already uses to read transcripts. **Arcadia stores the
governance linkage and a pointer.** The agent's own session id is the join key.

### 2. What a Session record holds

| Phase | Fields |
| --- | --- |
| **Before** (what Arcadia dispatched) | project slug, plan path, action id, immutable packet id and hash, authorizing Decision ids, provider profile, agent, model, effort, base revision, branch, worktree path, prepared-at |
| **Join** (how to return to the work) | the agent's own session id and name; optional terminal transport and tmux session name |
| **After** (what came back) | ended-at, process outcome, the Log entry it produced, any Decisions it opened, resulting Artifacts and Candidate revision, validation evidence, and delivery or pull-request evidence when they exist |

The before-fields are exactly what `arcadia go` already computes and discards.
This decision is, in large part, "stop throwing that away."

The packet and authority fields close a second loss of identity: a Session must
execute the exact prepared work, not merely launch an agent in the right
directory and ask it to reinterpret the Action. A stale packet, changed Action,
provider-profile mismatch, or changed authority set refuses before process
creation.

### 2a. One repository lease and one total transition

Only one Session in `prepared` or `running` state may hold a repository lease by
default. Cross-repository work is decomposed into linked Actions and Sessions,
one repository each; concurrency across repositories may be admitted later,
but concurrency inside one repository requires a separate explicit design.

`arcadia go` and `arcadia advance` must call one deterministic project-transition
resolver rather than grow parallel readiness rules. For any observed Project
state it produces exactly one result:

`launch | plan | decision | repair | reconcile | wait | complete_milestone`

Launching is only one successful form of advancement. When implementation is
not authorized or not yet shaped, applying the transition prepares the exact
planning Artifact and Decision, records the one operator Decision, identifies
the deterministic repository repair, waits on named acceptance or delivery
evidence, or closes the Milestone and requires its next plan. It never launches
an agent to improvise across a missing plan or Decision.

### 3. Before and after, never during

Arcadia records what a session was given and what it produced. It does not
observe, stream, sample, or intervene in a running session.

Stated as constraints with teeth, this forbids:

- storing or mirroring transcripts;
- mid-session state beyond process liveness (running / not running);
- any API for injecting instructions into a live session;
- progress estimates, step counts, or partial-output surfacing.

This is a real limit and it is chosen deliberately. It keeps Arcadia's
implementation bounded, it avoids competing with each agent's own UI, and it
matches where Arcadia's judgment is actually useful: deciding what should
happen next, and recording what happened.

### 4. One Session produces one Log entry

The Log type already records "what happened, why it mattered, blockers, next
Action, and Artifact impact" — that is a session report. Arcadia does not
introduce a second reporting artifact. A Session's governance output *is* a Log
entry, plus whatever Decisions the session opened.

### 5. Operational record in the workspace; governance in the project

The Session record is **operational data and lives in the Arcadia workspace**,
not in the project repository. Its outputs — the Log entry, the Decisions, the
commits — live in the project repository, as they already do.

This preserves the commitment in `docs/operating-model.md`: a project stays
fully understandable without Arcadia installed. A reader of the project sees
the Log and the Decisions. The record of which model ran at which timestamp in
which temporary worktree is Arcadia's operational memory, and belongs with the
rest of the private workspace data.

### 6. Outcome vocabulary

`prepared → running → completed | failed | needs_input`

`needs_input` is computed, not signalled, per the operator's answers recorded
in Decision 0011: after the process exits, re-run `resolveDispatch` on the
repository. If it now resolves to an **open Decision** rather than a
dispatchable Action, the session needs the operator. The agent did not get
stuck — it recorded a question as a document and stopped, which is the correct
behavior.

A terminal Session outcome describes the agent process, not the governed
Action. `completed` never marks an Action done, accepts a Candidate, advances a
managed pointer, merges, deploys, publishes, spends, uses credentials, accesses
production, or sends a message. Those transitions continue to require their
declared Artifact, Validation, delivery evidence, and Decisions.

### 7. Relationship to ExecutionRun — both are kept

| | ExecutionRun | Session |
| --- | --- | --- |
| Shape | Pre-planned typed steps | One open-ended agent invocation |
| Authorization | Per step, some requiring an approved Decision | Once, at dispatch |
| Duration | Short, bounded | Unbounded |
| Arcadia's role | Executes it | Dispatches and records it |
| Transcript | Arcadia's own step records | The agent's, referenced by id |

Neither replaces the other. `ExecutionRun`'s per-step authorization is doing
real safety work for planning execution and must not be diluted to accommodate
a differently-shaped thing.

### 8. Why "Session"

Rejected alternatives: **Run** (taken, and means something materially
different), **Job** (implies the queue is essential, but a session is a session
whether queued or launched by hand), **Task** (overloaded across every tool the
operator uses), **Handoff** (names only the before).

**Session** is the word both agent CLIs already use for this exact object.
Adopting their vocabulary keeps the join obvious and avoids a translation layer
between what Arcadia calls a thing and what the operator sees in their app.

### 9. tmux is the first transport, not the Session model

The first implementation hosts an interactive Claude Code process in a named
tmux session. tmux solves one narrow operator problem well: the terminal can be
left and reattached without losing the exact interactive agent interface. It
does not become the queue, transcript store, governance record, or source of
semantic progress.

Arcadia wraps tmux around the isolated worktree and launch command it already
prepared. It does not use Claude Code's native `--tmux` path because that path
requires Claude Code's `--worktree` mode and would give two systems overlapping
authority for branch creation, base selection, worktree placement, and cleanup.
Arcadia keeps those safety-sensitive responsibilities under Decisions 0009 and
0010, while Claude Code continues to own its conversation and transcript.

The first launch is opt-in and explicit. Before starting it, Arcadia persists a
stable Claude Code session id and display name plus a collision-resistant tmux
name. During execution Arcadia may ask only whether the named process is alive.
After exit it may record the exit status and re-run deterministic repository
resolution. It must not call `capture-pane`, mirror output, infer progress,
detect prompts, or send keystrokes.

tmux persistence ends with the host or tmux server. Arcadia therefore treats it
as a reattachable local terminal, not durable job execution. The workspace
Session receipt remains the durable operational linkage, and Git plus managed
documents remain the recovery and governance authorities.

### 10. Implementation order

The implementation sequence follows the existing idea-to-managed-build plan:

1. Finish accepted-plan promotion so one exact governed build Action and packet
   exist.
2. Put one total project-transition resolver beneath `go`, `advance`, and the
   Agent Queue; bind its launch result to the exact packet and one repository
   Session lease.
3. Persist and explicitly launch one tmux-backed Session, then dogfood detach,
   reattach, exit, and provider-native resume.
4. Reconcile exit into a thin receipt and the repository's resulting Action or
   Decision without reading the transcript.
5. Use those receipts in the Agent Queue and Needs you projections.
6. Reconsider opt-in worker queueing only after one real Session succeeds and
   the operator chooses unattended launch for another Action.
7. Add notifications only after a real completion or needs-input state waits
   unnoticed or must be relayed manually.

This sequence implements the operator-value core before the expensive tail.
Transcript views, prompt injection, live progress, session analytics, default-on
queueing, and a new supervisor remain out of scope.

## Consequences

- `arcadia go --apply --agent <x>` records a Session instead of discarding what
  it computed. Decision 0011's queue becomes one consumer of this primitive
  rather than the reason it exists.
- `arcadia advance` becomes the portfolio-facing consumer of the same
  transition result, while `arcadia advance --session <id>` (or an equivalent
  exact bootstrap) gives the launched agent the immutable packet rather than a
  free-form request to reinterpret Project state.
- "Where does this need me?" becomes answerable across projects from recorded
  Sessions plus computed dispatch state, without a parallel queue to keep in
  sync.
- The operator keeps both views by construction: Arcadia's abstraction over
  what mattered, and the agent's own app for the full transcript, joined by
  session id.
- Sessions launched through Arcadia remain ordinary agent sessions. Nothing
  about being Arcadia-dispatched makes one invisible to, or unresumable from,
  the tool that ran it.
- One more concept enters a vocabulary that already has nine. This is a real
  cost. It is accepted because four independent forces already produced the
  concept under different names, and leaving it unnamed means each of them
  invents it again slightly differently.

## Implementation questions that do not block this Decision

1. **Does an Arcadia-launched session appear in the Claude and ChatGPT desktop
   and mobile apps?** Investigation confirms CLI sessions are persisted, named,
   and registered with rich metadata including PR correlation — but whether a
   specific app surface lists a session started headlessly in a temporary
   worktree is an empirical question this decision cannot answer by reading
   code. It should be tested with one real dispatch before the pointer design
   is relied upon.
2. When a session is resumed or forked in the agent's UI rather than through
   Arcadia, does Arcadia learn about it, or does the Session record simply
   describe the dispatch that started the chain?
3. The four mistyped specification documents remain typed `reference`. Is
   "an approved specification that governs later work" a missing document type,
   separate from this decision? It is related but not solved here.

## Revisit triggers

- An agent CLI stops persisting sessions or stops exposing a stable id, which
  would break the thin-pointer design and force Arcadia to store more.
- The before/after boundary proves untenable — for example, if a common failure
  can only be detected mid-session rather than from its exit and the resulting
  document state.
- A third agent joins that has no session concept of its own, making the
  borrowed vocabulary a poor fit.

## Supersedes Decision 0011

The operator decided, 2026-08-09, that this Decision supersedes Decision 0011
("Agent-session queue and Discord alerting for `arcadia go`"). 0011 discovered
the same missing primitive from one direction — queuing `go` handoffs needed a
record to queue — and named it "an agent session," described as an
implementation detail of queuing. Section 1 above already credits this as the
first of four independent pieces of evidence. 0011's queue is superseded as a
standalone Decision and becomes one consumer of the Session primitive defined
here, per Consequences above ("Decision 0011's queue becomes one consumer of
this primitive rather than the reason it exists").

0011 also carries four operator answers to its own open questions, given
2026-08-07, before this Decision existed. They are not about *what a Session
is* — this Decision settles that — but about *how `go` queues one*, and remain
live and unanswered by anything written here:

1. **Opt-in `--queue` first.** Queuing must not become the default until it
   has been used successfully at least once and `go` can guarantee the worker
   daemon is present. The failure mode of default-queuing is `go` silently
   depending on a daemon that may not be running.
2. **Needs-input signal: exit plus final message for v1.** Accepted as good
   enough to ship, with the dispatch-state diff described in Section 6 above
   named as the v2 improvement — re-running `resolveDispatch` after exit and
   treating a resolved-to-open-Decision result as the needs-input signal.
   Section 6 already states the v2 mechanism; this preserves 0011's explicit
   sequencing of shipping the cheaper signal first.
3. **`go` offers to install the worker daemon** when `--queue` is requested
   and the daemon is not installed or not running, rather than refusing with
   instructions. This is what eventually allows answer 1's default to flip.
4. **Discord is a notification system first.** Alerts must be readable and
   useful standalone. Beyond that, a small fixed set of reply commands — one
   or two, not a conversational surface — lets the most common response be
   given from a phone. Which commands are most common is left to observation
   of real alerts rather than decided now.

Implementing `arcadia go --queue` against the Session primitive must honor
these four answers unchanged; they were not reopened by this Decision, only
relocated to it.
