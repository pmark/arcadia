# Running software production from a GitHub board

This is the project manager's guide to Arcadia's production scheduling. It
covers what the system does today, how to drive it, and where its edges are.

You do not need to read code to use any of this. You do need to be comfortable
running a command in a terminal and using a GitHub Project board.

If you want the engineering reference instead — the ordering rules, the GitHub
API mechanics, what was deliberately left out — read
[`production-scheduling.md`](production-scheduling.md).

---

## What this system is for

Arcadia executes software work continuously. It picks the next thing to build,
hands it to a coding agent, and keeps going. Your job is not to assign work
item by item. Your job is to set priorities and answer the questions Arcadia
cannot answer for itself.

The GitHub board is where you see that happening and where you steer it.

**The one rule worth remembering:** Arcadia's own database decides what runs
next. The board shows you that decision and lets you influence it by dragging
cards. Nothing else you do on the board changes what Arcadia does.

---

## The vocabulary

Arcadia uses a small number of words precisely. Five of them matter here.

| Word | Means |
| --- | --- |
| **Project** | A body of work with its own repository. "Arcadia", "Private Practice Now", "Rebuster". |
| **Milestone** | The chunk of a Project currently being built. A Project has at most one active Milestone. |
| **Action** | One unit of work a coding agent can finish in a sitting. This is what becomes a card on your board. |
| **Plan** | The document listing a Milestone's Actions and their order. |
| **Decision** | A question only you can answer. Arcadia stops and asks rather than guessing. |

---

## How Arcadia decides what to build next

Two questions, in order.

**First, which Project?** You set one ordered list. Arcadia walks it from the
top and takes the first Project that has something runnable.

```
1. Private Practice Now
2. Arcadia
3. Rebuster
```

There is no clever balancing. If the first Project always has work, the third
never runs. That is intentional and visible — change the order when you want
something else.

**Second, which Action inside that Project?** Every Action sits in one of four
tiers. Arcadia takes the highest tier that has anything eligible, then the
top card within that tier.

| Tier | What it means | Who creates it |
| --- | --- | --- |
| **Interrupt** | Drop everything. | You, explicitly |
| **Blocker** | The current work cannot finish until this is done. | Arcadia, during a build |
| **Corrective** | The Milestone cannot be called finished until this is done. | Arcadia, during a build |
| **Planned** | Ordinary scheduled work. | The Plan |

A fifth class, **Follow-up**, is backlog. It never competes for execution.

**Dependencies always win.** If Action B depends on Action A, B waits for A —
no matter what tier B is in and no matter where you drag it. Queue position
expresses preference among things that *could* run. It never makes something
runnable that isn't.

---

## Setting up a board

Do this once per Project.

### Step 1 — Check the Project is ready

```bash
arcadia schedule status
```

You should see the Project, its active Milestone, its queue of Actions, and
`GitHub: not linked`.

If you instead see a line starting with `Blocker:`, the Project is not ready to
schedule. The message names what to fix — usually a missing repository path or
a Plan that isn't marked active.

### Step 2 — Create and link the board

```bash
arcadia schedule github link --project arcadia --owner your-github-login --create
```

This creates a GitHub Project called "Arcadia — Development" and links it. Use
`--number 7` instead of `--create` to attach an existing board.

This is the **only** command that changes the board's structure. It adds a
single-select field called **Arcadia status** with six options. Everything else
Arcadia does only reads the board's shape.

### Step 3 — Publish the queue

```bash
arcadia schedule reconcile --apply
```

Arcadia creates one GitHub Issue per Action in the active Milestone, adds each
to the board, sets its status, and puts the cards in queue order.

### Step 4 — Set up your views by hand

GitHub does not let anything create board views through its API, so this part
is manual and takes a minute.

1. Open the board. Group by **Arcadia status**.
2. On the main view, add the filter `-Arcadia status:Backlog,Done`. You now see
   only live work.
3. Add a second view. Filter it to `Arcadia status:Backlog`. That is your
   backlog.

### Step 5 — Set the cross-Project order

```bash
arcadia schedule prioritize --order private-practice-now arcadia rebuster
```

---

## Reading the board

Six statuses. Each answers "why is this card not being worked on right now?"

| Status | Meaning | Your move |
| --- | --- | --- |
| **Running** | A coding agent is working on it now. | Nothing. Wait. |
| **Ready** | Eligible. Waiting its turn. | Drag it if you want it sooner. |
| **Blocked** | Waiting on another Action to finish. | Nothing. It will clear itself. |
| **Needs operator** | Arcadia is stuck and needs you. | Read the reason, answer it. |
| **Done** | The Plan records it finished. | Nothing. |
| **Backlog** | Recorded, not scheduled. Includes work you deferred by answering a Decision. | Promote it when it matters. |

**Needs operator is the only status that is actually asking you for something.**
If nothing is in that column, Arcadia does not need you.

To see the same picture in the terminal, with the reason attached to every
card:

```bash
arcadia schedule status --project arcadia
```

---

## Changing priorities by dragging cards

Dragging **Ready** cards is the one thing you can do on the board that changes
what Arcadia does.

Drag a card up. Within about a minute, Arcadia notices, records the new order,
and works to it.

### What a drag can and cannot do

It can reorder cards **within one tier**. Moving a Planned card above another
Planned card works exactly as you would expect.

It cannot override the rules. Two kinds of drag get put back:

- **Across tiers.** Dragging a Planned card above a Corrective one. The
  Corrective exists because the Milestone cannot be validated without it.
- **Past a dependency.** Dragging B above A when B depends on A.

When Arcadia puts a card back, it does not ask you about it and it does not
create a Decision. It restores the correct order and writes one line to the
log explaining exactly why:

```bash
arcadia schedule log --project arcadia
```

You will see something like *"p/c (planned) cannot move ahead of p/x
(corrective)"* or *"p/b depends on p/a, so it stays behind it"*.

> **Tip.** If a drag keeps getting reverted and you genuinely want that work
> first, the drag is the wrong tool. Change the Action's tier instead:
> `arcadia schedule classify --action arcadia/some-action --class interrupt`.

### Timing

Arcadia checks the board about once a minute. A drag is not instant. This is
deliberate: checking more often would burn through GitHub's hourly API budget,
which is shared with everything else you do with GitHub from that account.

If you want it applied right now:

```bash
arcadia schedule reconcile --apply --project arcadia
```

---

## What happens when Arcadia finds a problem mid-build

This is the part that makes continuous production work. A coding agent
regularly discovers something nobody planned for. Arcadia sorts each discovery
into one of three buckets and keeps moving.

### Blocker — "I can't finish without this"

A new card appears at the top of the queue. The Action that was being worked on
flips to **Blocked** and now depends on the new one. The agent switches to the
blocker.

You see two cards change. You do nothing.

### Corrective — "The Milestone isn't done without this"

A new card appears ahead of the remaining Planned work, behind any correctives
found earlier. The current work is **not** interrupted; it finishes first.

You do nothing.

### Follow-up — "Worth doing, not now"

A new card appears in your Backlog view. The queue does not change at all.

You do nothing now. Review the backlog when you plan the next Milestone.

### The safety limits

Automatic discovery is capped so a build cannot spiral:

| Limit | Value |
| --- | --- |
| How deep discoveries can nest | 2 |
| Correctives traceable to one original Action | 3 |
| Discovered correctives in one Milestone | 8 |

Cross any of these and Arcadia stops expanding, puts a card in **Needs
operator**, and opens a Decision describing the work it wanted to create. That
is your signal that the Milestone is bigger than it looked.

---

## When Arcadia stops and asks you

Arcadia interrupts you in exactly these situations. Everything else it handles.

- **A discovery limit was crossed.** The Milestone is growing faster than
  planned. Decide whether to absorb the work, re-scope, or stop.
- **Too many builds failed.** After eight failed runs in one Milestone, Arcadia
  pauses that Project entirely and opens a Decision. It will not keep retrying
  and burning money.
- **An Action has an open question.** The Plan itself is ambiguous.
- **Work ownership is unclear.** A discovery belongs to a different Project and
  Arcadia will not guess which.

### Restarting a paused Project

A pause is deliberate friction. You must answer the Decision before you can
resume — the resume command refuses while the question is still open.

```bash
# 1. See what is being asked
arcadia review

# 2. Answer it
arcadia review approve <decision-id>      # or: arcadia review reject <decision-id>

# 3. Resume
arcadia schedule resume --project arcadia --reason "Approved two more attempts"
```

---

## The audit trail

Every scheduling change is recorded with who did it and why.

```bash
arcadia schedule log --project arcadia --limit 20
```

Each line names a source:

| Source | Means |
| --- | --- |
| `github_operator` | You, dragging a card |
| `coding_run` | A coding agent's discovery |
| `arcadia` | The scheduler itself |
| `decision` | A resolved Decision |

Use this when the board does something you did not expect. It will say what
changed, what it was before, and the reason.

---

## Caveats worth knowing before you rely on this

**The live GitHub integration has not been run against a real board yet.**
Every part of it is covered by automated tests against a simulated GitHub, and
those tests pass. But no one has yet pointed it at an actual GitHub Project.
The first time you run step 2 above, treat it as a trial: use a throwaway
Project and repository if you can.

**Board views are manual.** GitHub's API cannot create them. If you recreate a
board, you redo step 4.

**Arcadia writes to your repository.** Recording a discovery commits a change
to the Plan document in the Project's main checkout. It never pushes. If that
checkout has uncommitted changes, the discovery is refused rather than mixed
into your work.

**Only the active Milestone is on the board.** Future Milestones are not shown.
That is the point — the board is an execution surface, not a roadmap.

**Statuses are derived, not set.** You cannot move a card to Done to mark work
finished. Status comes from the Plan and from live builds. Dragging a card
between status columns has no effect on Arcadia.

**One board per Project.** There is no combined portfolio board. Use
`arcadia schedule status` for the cross-Project view.

---

## One open question

This is a known gap. It does not stop you using the system, but you should
know it exists.

**Discovered work skips the usual approval path.** Arcadia's general rule is
that new work items are proposed to you for approval. Discovery deliberately
does not do that, because a blocker has to become the next task immediately or
the build stalls waiting for you. That exception is now written up as
**Decision 0059** with three options and a recommendation, waiting for your
answer. Run `arcadia review` to see it.

---

## Possible future enhancements

Ideas, not commitments. Roughly in order of how much they would help.

**Worth doing when the need shows up**

- *One portfolio board.* A single board across all Projects, so you see
  everything in one place instead of switching.
- *Webhooks instead of polling.* Card drags would apply instantly rather than
  within a minute.
- *Milestone progress on the board.* A visible "6 of 11 Actions done" so you
  can answer "when will this be finished?" without asking.
- *Comment-driven input.* Answer a Decision by replying to the Issue instead of
  running a command.
- *Cost visibility.* What each Milestone has cost in agent time and spend.

**Deliberately not built, and why**

- *Priority scores.* Numbers invite arguing with the number instead of the
  order. Tiers plus a drag are simpler and harder to misread.
- *Automatic Milestone switching.* Changing what the team is building is a
  judgment call, not a scheduling one.
- *Estimates and capacity planning.* Every attempt at this in the MVP would
  have been fiction.
- *Syncing every GitHub field.* Two systems both claiming to own the same field
  is how drift starts. Card order is the single exception, and it earns it.

Each of these should be driven by something that actually goes wrong, not by
anticipating it.

---

## Command reference

| Command | Does |
| --- | --- |
| `arcadia schedule status` | Show every Project's queue and what runs next |
| `arcadia schedule status --project <slug>` | Same, one Project |
| `arcadia schedule log --project <slug>` | The audit trail |
| `arcadia schedule prioritize --order <slugs...>` | Set cross-Project order |
| `arcadia schedule classify --action <project/action> --class <tier>` | Change an Action's tier |
| `arcadia schedule reconcile` | Preview: what the boards say, changing nothing |
| `arcadia schedule reconcile --apply` | Apply drags, publish the queue |
| `arcadia schedule reconcile --apply --project <slug>` | Same, one Project only |
| `arcadia schedule resume --project <slug> --reason <text>` | Restart a paused Project |
| `arcadia schedule github link --project <slug> --owner <login> --create` | Create and link a board |
| `arcadia review` | List the Decisions waiting on you |
| `arcadia review approve <id>` / `reject <id>` | Answer one |

Every command takes `--json` if you want to feed it to something else.

> **Note on running commands.** From inside the Arcadia repository, prefix these
> with `mise exec -- pnpm`, for example
> `mise exec -- pnpm arcadia schedule status`. Elsewhere, `arcadia` on its own
> works if it is installed on your PATH.
