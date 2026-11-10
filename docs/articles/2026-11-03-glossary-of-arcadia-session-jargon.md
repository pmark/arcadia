---
title: "A glossary of Arcadia session jargon, and whose word each one is"
date: "2026-11-03"
type: essay
slug: "glossary-of-arcadia-session-jargon"
summary: "Arcadia sessions mix words from Arcadia, Claude Code, Git and GitHub, outside tools and plain engineering. This glossary defines about seventy-five entries, labels whose each one is, and flags the words that mean two things, starting with 'classifier'."
author: "Arcadia (drafted by Claudia Mason, as Clara)"
status: draft
claims_receipt: "docs/articles/receipts/glossary-of-arcadia-session-jargon.md"
not_done: true
canonical: "https://arcadiamissioncontrol.com/notes/glossary-of-arcadia-session-jargon/"
channels: [site, rss]
---

# A glossary of Arcadia session jargon, and whose word each one is

Read a few minutes of an Arcadia coordinator session and you will meet words
from five different places, mixed into the same sentence. "The classifier
refused the merge." "Settle the Ask, then make-next." "Tick found
`base_not_synced`." If you are new, you cannot tell which words belong to
Arcadia, which belong to the coding-agent app, and which are just engineering
habit. This glossary says what each word means and whose it is.

## How to read the labels

Every entry carries one of these owner labels.

- **Arcadia** — defined by this project's code or checked-in documents.
- **Claude Code** — the coding-agent app and its built-in tools.
- **Git/GitHub** — version control and the hosting service around it.
- **Outside tool** — another product, such as CodeRabbit, tmux or Anthropic's
  models.
- **General engineering** — a common industry word that Arcadia simply uses.

Some words carry two labels, because the same word means two different things.
Those entries say so plainly. Look for **Two meanings**.

## The one that started this: "classifier"

**Two meanings (and a third look-alike).** When a session says "the
classifier," it usually means one of two unrelated things.

- **Arcadia: `classifyRecoverySignals`.** A plain function in
  `src/production/recoverySignals.ts`. It reads rows from Arcadia's ledger and
  sorts them into named recovery signals, such as "this Session made no
  progress" or "the independent QA check failed only on the operator QA
  plan." The file header states it is pure and no-model: it reads no database,
  Git, clock or network. It uses no AI model. It is ordinary `if` logic. Today
  its one caller is the independent-review code that decides whether the QA
  plan waiver applies (see **waiver**).
- **Claude Code: the "auto mode classifier."** Claude Code, the app the agent
  runs inside, has an auto mode in which a permission check reviews tool calls
  instead of asking the person each time. When that check refuses a
  command, such as a merge, the refusal comes from Claude Code's permission
  system, not from Arcadia. Arcadia cannot see inside it or change it. Its
  logic is Claude Code's own and is not documented in this repository, so this
  glossary does not describe how it decides.

**Claude Code: the permission check.** Claude Code asks, or in auto mode
decides, whether a tool call may run. That check, not Arcadia, is what blocks a
command in a session.

A similar Arcadia word, `classifySession` in `src/production/sessionSignals.ts`,
is also plain code with no model. It sorts one live Session into a fixed set of
states (for example `permission_prompt` or `provider_limit`), using text read
from the Session's terminal. A "permission prompt" in that list is Claude
Code's or Codex's ask-the-user dialog, which Arcadia only recognizes by its
text. Arcadia also has other `classify...` functions (for commits, patches,
captured ideas). Same naming habit, separate code.

Rule of thumb: if a refusal comes from a tool call that was blocked in the
session itself, think Claude Code. If it comes from an Arcadia command, a
ledger, or a status line, think Arcadia.

## Arcadia's work vocabulary

These are the nouns Arcadia treats as canonical. They come from
`docs/arcadia-semantics.md`.

**Operator** — Arcadia. The person who directs a Project and holds its
approvals. Documents say "the operator" instead of using a name.

**Project** — Arcadia. A durable container for an endeavor, with a Mission and
Outcomes. Example: Arcadia itself is a Project.

**Mission, Outcome, Milestone** — Arcadia. The Mission is why a Project
exists. An Outcome is a concrete change it wants in the world. A Milestone is a
checkpoint toward an Outcome.

**Action** — Arcadia. The smallest unit of intentional work, with acceptance
criteria (observable conditions that decide when it is done), a
responsibility, and dependencies. Example: "Add a test that asserts the
launcher file is removed."

**Responsibility** — Arcadia. Who may advance an Action: `autonomous`,
`agent`, `requires_review` or `blocked`.

**Plan** — Arcadia. An ordered set of Actions toward a Milestone, kept as a
checked-in document. A Plan is a `draft`, then `active`, then `complete` or
`superseded`.

**Artifact** — Arcadia. Durable evidence or output of work: a file, a pull
request, a receipt, test output.

**Decision** — Arcadia. A point that needs human judgment, recorded as a
numbered document in `docs/decisions/`. Example: Decision 0169 chose how the
next unattended run recovers and gets noticed. "Decision 0060" and "Decision
0080" are the ones people cite for the merge exception (see **merge gate**).

**Log** — Arcadia. The durable history of a Project.

**Pointer** — Arcadia. `PROJECT.md` names the `active_plan`, and that Plan
names its `current_action`. Together they say what the Project works on next.
An active Plan has at most one current Action. A completed Plan can still be the Project's `active_plan` while it waits for a successor. [Completed Plan example](../plans/record-run-unattended-test-pins-20261107-part-2.md)

**`current_action`** — Arcadia. The field in the active Plan that names the Action selected for work when the field is present. A Plan's final settlement clears it. Continuing a Project starts with its recorded pointer.

**Governed** — Arcadia. Changed only through Arcadia's own checked, recorded
path (an Agent Ask), never by hand-editing. Pointers, Action status, Decision
answers and queues are governed.

**Agent Ask** — Arcadia. The one door into governed state: a small structured
request with a unique `request_id`, an `intent` and a desired result. Anyone
may file one. See
[How an idea becomes governed work](2026-10-23-how-an-idea-becomes-governed-work.md).

**Preview** — Arcadia. Registering an Ask and getting a receipt, while changing
no Project document. A preview approves nothing.

**Settle, settlement** — Arcadia. Applying exactly the changes a previewed Ask
described, once the operator or a deterministic proof accepts them. Settling a
`complete` Ask marks an Action done only if every acceptance criterion is
recorded as met against a named revision. Settling does not push.

**Receipt** — Arcadia. The recorded proof that something was registered or
done, keyed by a request id. A replay with the same id returns the same
receipt.

**Queue** — Arcadia. `arcadia advance queue` is a revisioned ordering of
approved, unfinished Actions across Projects. It is a view and an ordering; the
checked-in pointer stays the authority for what runs next.

**make-next** — Arcadia. `arcadia advance queue make-next --action <key>`
promotes one eligible Action that is `waiting_for_pointer` into the pointer
through a governed transition. It previews first, then applies with `--apply`.

**Grant** — Arcadia. A one-shot operator action that delegates bounded
authority, with a pinned scope, an expiry and a receipt.

## Sessions, roles and who is in the room

**Session** — Arcadia. One coding-agent run that Arcadia launches and tracks.
One Session completes one Action.

**Lead** — Arcadia. The registered role that holds the development attempt,
does routine work and may request bounded help. Seven roles are registered:
`lead`, `planner`, `plan-critic`, `implementer`, `code-reviewer`, `qa` and
`researcher`.

**Rowan** — Arcadia. The default identity profile, "Coordinator," bound to the
`lead` role. Unless a brief assigns something else, a session starts as Rowan.

**Other named profiles** — Arcadia. Optional handles over the same seven roles:
Mira (Investigator), Ellis (Engineer, planner or implementer by assignment),
Nadia (Critic), Sage (Reviewer), Quinn (Verifier), Vida (Health Assessor) and
Clara (Technical Writer, which is who drafted this) and Flynn (Momentum Keeper, a bounded supervisor-class helper). The [canonical profiles](../arcadia-semantics.md#roles-specializations-and-optional-names) specify the assignments and their limits.

**Implementer** — Arcadia. The role that makes the assigned bounded change as
the sole writer. A **helper** is a role Rowan requests at depth one; helpers
never delegate.

**Independent review** — Arcadia. A read-only review of a pull request's exact
head by a reviewer who is not the author. **Round** — one pass of it; at most
three per pull request, and never past five (see `pull-requests.md`).

**GO and NO-GO** — General engineering, used by Arcadia reviewers. A reviewer's
verdict: proceed, or stop. Example from the readiness record: a change got
"R1 NO-GO and then R2 GO" after fixes.

**Blocking** — Arcadia. A finding that could lose or corrupt data, broaden
authority, expose credentials, hand the same work to two agents, open a
security hole, or break a required check or acceptance criterion. A blocking
finding is fixed before merge.

**Subagent** — **Two senses of one idea, across two owners.** In **Claude Code**, a child agent that a
session starts with its Agent tool to do a side task. In **Arcadia**, the same
idea sits under the rules above: only a top-level Lead may request a helper,
helpers never delegate, and reviewers and QA are separate Sessions, never
children. Say which you mean.

**Tier** — **Two meanings.** In **Arcadia**, a logical model level an Action
names: `light`, `standard` or `heavy`, resolved to a concrete model per coding
agent. Sessions start on `light` and call in help. Separately, Arcadia's **Token Impact** scores (None to Extra Large), which the
scheduler calls "tier points," size how much model use an Action needs. Token
Impact is not a model tier. This is a split inside Arcadia, not an owner split.

**Sonnet, Opus, Haiku** — **Outside tool** (Anthropic's models). Arcadia's
model-tier table maps `light` to Haiku, `standard` to Sonnet and `heavy` to
Opus for Claude Code. These session notes use the names as shorthand for those
tiers.

**Escalation** — **Two uses, both Arcadia's (not an owner split).** In model tiers, escalating means
calling in a bigger model than the one the Session started on. In
production, an escalation is also a named operator-facing stall, shown in
`production status` and pinged once, such as `base_not_synced`. One word, two
unrelated uses.

## Working with code: Git, worktrees and delivery

**Worktree** — **Git/GitHub.** A second checked-out copy of a repository,
sharing the same history, on its own branch. Arcadia runs each Session in its
own worktree so it never touches `main` or another Session's files.

**Candidate** — Arcadia. The branch and worktree holding a Session's finished
work, waiting to be preserved, reviewed and merged.

**Claim** — Arcadia. A recorded hold that says one live worktree owns an
Action, so two agents are not handed the same work.

**Walk** — **Two meanings.** In **general engineering**, to visit items one by
one along a chain. In **Arcadia**, `arcadia go` has a "queue walk": if the
pointer's Action is already claimed by another live worktree, it may move to
the one queue-ready Action that passes the same eligibility checks, or refuse.
The production scheduler also "walks" a plan from `current_action` in order.

**go (`arcadia go`, `arcadia advance`)** — Arcadia. The command that finishes a
completed worktree, fast-forwards it into the local base branch, retires clean
merged state, prepares a fresh isolated worktree and continues the governed
Action. It changes shared Git metadata, so it runs on the host rather than in
the sandbox.

**Broker** — Arcadia. A protected host-side program that a sandboxed agent
asks to do work it cannot do itself. The go broker handles operations such as
`go`, `preserve`, `advance` and `work-monitor`. The agent requests; the broker
acts and records a receipt.

**Host** — General engineering, used by Arcadia. The real machine and its
background services, outside the agent's sandbox. "Host-written" means
written by Arcadia's own code there, not by an agent.

**Sandbox** — **Claude Code** (Arcadia depends on it). In Claude Code on a Mac,
shell commands run inside an operating-system sandbox that limits where they
may write; some Git and GitHub commands need it lifted per command (see
`native-app-sessions.md`). Arcadia's guidance says the sandbox protects the Git
common directory, which is why a broker exists.

**Fast-forward** — **Git/GitHub.** Moving a branch forward to a newer commit
when the history is a straight line, creating no merge commit.

**Squash merge** — **Git/GitHub.** Merging a pull request as one combined
commit. Arcadia's pull-request guidance uses it, then checks the record is
whole.

**Reconcile** — **Two meanings.** In **Arcadia**, to bring a Session, a branch
or a record back into agreement. Example: `src/git/pointerReconcile.ts` brings
the local base branch onto its remote when the only local-only commits are its
own pointer commits. Reconciling a Session's exit is a different, separate
step. Note: this pointer-reconcile code merged on 2 November 2026.

**`base_not_synced`** — Arcadia. A worker-merge refusal code meaning GitHub
merged the pull request but the local base branch could not be moved onto it
yet. The next tick retries. It is also a named operator escalation.

**Merge gate** — Arcadia. Under Decisions 0060 and 0080, a pull request may be
merged when independent review of the current head has no unresolved blocking
finding, its required checks pass, and the merge is clean. Important Decisions
and authority changes still wait for the operator.

**Pull request (PR), head, base** — **Git/GitHub.** A proposed change; the head
is its newest commit and the base is the branch it would merge into.

**Issue** — **Git/GitHub.** A tracked report. In Arcadia, an Issue is an intake
signal and a place to record defects. It is not authority to do work.

**CodeRabbit** — **Outside tool.** An automated pull request reviewer. In
Arcadia its comments are advisory: read them, but never wait for it, and its
silence or rate limit is not a reason to stop.

**Auto-fix** — **Claude Code** (the desktop app). A per-pull-request setting
under which the app watches CI and review events and sends them to the session
as messages. Arcadia's guidance says to act on them rather than poll. It is a
Claude Code feature, not an Arcadia command.

**tmux** — **Outside tool.** A terminal multiplexer. Arcadia's managed
Sessions run in tmux, and its stall and pane-text checks read what tmux shows.

## Production: the unattended path

**Production, On and Off** — Arcadia. The standing switch that lets the
managed worker admit and launch Actions on its own. Off stops new admissions,
fences reserved but unlaunched work, and lets already-committed launches finish
and be reconciled. Only the operator turns it On. "Active" or a saved
configuration alone proves nothing.

**Worker** — Arcadia. The managed-production process running on the host. Its
work comes in passes called **ticks**.

**Tick** — Arcadia. One pass of that worker: reconcile Sessions that exited,
flag a stalled one, admit and launch the next eligible Action, and notice if
the base branch moved.

**START card** — Arcadia. A one-shot operator script plus a pinned
descriptor, run from the operator's `/actions` page. One press may install the
pinned reviewed revision, bind the worker, activate the named Plan and start
production, as the current readiness record describes.

**Press** — Arcadia. The operator running one such card. Pressing is the
operator's act; no agent presses.

**Pre-mortem** — **General engineering**, with an Arcadia procedure. Imagine
the run failed and ask why, before it starts. Arcadia's operator-actions
guidance requires an independent, read-only one before any START card is made.

**Red alert** — Arcadia. A signal, raised by the worker tick with no model
call, that a managed-production failure meets the "stop the line" test. Four
triggers exist today in code: `admission_refused_consecutive`,
`session_stalled`, `reconcile_failed` and `repair_budget_repeat`. Anything
beyond those four is not part of this glossary: treat additional triggers as
not live until they merge.

**Operator QA plan** — Arcadia. A numbered, observable test procedure for the
operator, included in every pull request and written by the host's code from
the candidate's real changed files.

**Waiver** — Arcadia. Under Decision 0169, a failed QA verdict whose only
failing check is the host-written operator QA plan gets a narrow exception. It
uses no repair rounds, because no repair Session can change that plan. The
finding stops blocking, an Issue is filed, and exactly one named plan step goes
unverified, so the Action can merge with one operator check step unchecked. It
applies only under strict conditions: the failed checks must be exactly the
operator QA plan check, with one finding and one named step, and nothing in the
change touching authority. The check lives in
`src/production/independentReview.ts` (merged 3 November 2026) and uses
`classifyRecoverySignals`. A waiver does not establish that the code is
correct; it only says the one unchecked step is not a reason to block.

**Fixture** — **General engineering.** A disposable, controlled setup used for
a test. Arcadia's rehearsals ran against a fixture repository so a mistake
cost nothing real.

**Replay** — Arcadia. `scripts/production-replay.ts` predicts what the
worker would do for a given grant or card, using a copy of the live state and
refusing any write to GitHub, tmux or a provider. The readiness checklist asks
for a hermetic replay before a press.

**Mutant, mutation testing** — **General engineering.** Deliberately breaking
code in one small way to check that a test notices. A mutant the tests fail on
is "killed." An **equivalent mutant** is a change that cannot alter behavior,
so no test can catch it. Arcadia's evidence index and a test comment use the
word; the method is done by hand there, by disabling a guard, rerunning the
matrix, and restoring it.

## More session vocabulary

**Constitution** — Arcadia. `CONSTITUTION.md`, the top rule set. Its approval
boundaries are hard stops: no deploy, publish, delete, spend, credential use,
production access or messaging without an explicit Decision.

**Brief** — Arcadia. The written assignment for a Session or helper, with
sections such as Task, Identity, Context, Ownership, Acceptance, Checks and
Return.

**Dispatch** — Arcadia. Launching a Session for an Action. A Session is one
bounded coding-agent dispatch, per the semantics document.

**Handoff** — Arcadia. The record a Session leaves so a successor can resume:
Plan and Action, revisions, owners, pending work, approvals and next move.

**Preserve** — Arcadia. The host-side step that turns a finished candidate
worktree into one recoverable commit on its agent-owned branch, with a receipt
keyed by request id.

**Stop the line** — Arcadia. The rule that a defect blocking work outranks the
plan it interrupted; promoting it to first priority is the default.

**Process Critic** — Arcadia. A read-only specialization of the `plan-critic`
role that critiques a run or the process around it. It grants no authority.

**Hacker (recovery)** — Arcadia. A Behavior, not a role or a bypass: when a
route keeps failing, find the smallest existing authorized path, prove it, then
resume.

**Rehearsal** — Arcadia. A live practice run of the unattended path against a
fixture repository, recorded in the rehearsal runbook.

**Lane** — Arcadia. In the push projection, Actions grouped by repository. One
repository is one lane, and the production policy allows one lease per
repository.

**Discord** — **Outside tool**, used by Arcadia. The chat service where the
configured channel receives alerts about new or material blockers.

## What this glossary leaves out

Words the author could not tie to a definition in the repository are not
defined here, such as `enroll`, the "replay gate" and any further red-alert
triggers. They are listed in the receipt rather than guessed.

## What is not done

This is a reference draft. The November 3 fact-check applies to the earlier text. The November 9 refresh adds the completed-Plan case and Flynn; those edits await independent review. The [claims receipt](receipts/glossary-of-arcadia-session-jargon.md) records the review scope.
