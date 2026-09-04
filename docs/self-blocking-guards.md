# How Arcadia blocked itself five times in one day

Findings from 2026-09-03, written after a session that set out to close one
delivered Action in an adopting project and instead spent its length clearing
the governance system's own refusals.

This is a plain document on purpose. It carries no `arcadia: v1` marker, is not
a managed document, and asserts nothing about any Project's state. It exists to
be argued with, and to be lifted into an Agent Ask when the queue and the
database can accept one.

## The pattern

Five separate guards each had the same shape:

> Refuse everything until X is perfect — where X was something no available
> capability could fix.

None of them was wrong to care about what it cared about. Each one converted a
**local** defect into a **global** block, and then offered no way out. That
combination is what turned a ten-minute closeout into a day.

## The five

**1. Settlement validated the entire corpus.** One document with a `type:` the
schema no longer accepted refused every settlement in that repository. The
adopting project had 49 such errors, none introduced by the work being
attempted. Fixed by Decision 0044: settlement now answers for the documents it
wrote.

**2. Nothing could correct a document.** Every Agent Ask intent creates or
appends; none amends. So the documents blocking (1) could not be fixed through
Arcadia at all, and the rule against hand-editing managed documents forbade
fixing them outside it. Partly addressed by narrowing that rule to governance
*state* rather than document *hygiene*. The capability is still absent.

**3. Settlement left its own output uncommitted.** `assertClean` refuses a
dirty repository, so settlement N+1 was refused by settlement N. Two Asks could
not settle without a person committing in between. Fixed: settlement commits
what it writes.

**4. The queue refuses new Actions while any approved Action is unpositioned.**
38 rows were unpositioned. They were not a backlog — they were ~3 real pieces
of work duplicated across 12 titles, and one `arcadia ask` invocation at
`2026-08-25T16:31:56` had minted ten byte-identical rows in a single second.
Junk that nobody could delete blocked Action filing in *every* project,
including the two projects that mattered. Not fixed.

**5. SQLite lock contention.** Four long-running services hold the workspace
database open. Settlement writes intermittently fail with `database is locked`;
during this session one settlement was blocked for over seven minutes and
another could not be retried at all until a service was killed. **Fixed
2026-09-04.** The error was `SQLITE_BUSY_SNAPSHOT`, not ordinary contention:
`db.transaction()` issues a deferred `BEGIN`, taking a read snapshot and
asking for the write lock only at the first write, so any commit by a service
inside that window invalidates the snapshot and SQLite refuses to upgrade it.
`busy_timeout` cannot help — waiting does not make a stale snapshot fresh —
which is exactly why retrying was useless until a service was killed.
`writeTransaction` in `src/db/connection.ts` runs write paths under `BEGIN
IMMEDIATE`, taking the lock before reading anything. Nineteen other write
transactions still use the deferred form and are deliberately left alone until
one is observed failing.

## The rule that would have prevented all five

Three clauses, in priority order:

**A guard may block the thing it protects. It may not block everything.**
Scope a refusal to the blast radius of the defect. A malformed document should
refuse writes *to that document*, not writes to unrelated documents in the same
repository. A duplicated Action should stall *its own* dispatch, not the filing
of Actions in other projects.

**Every blocking guard must name a capability that can clear it.** Before
adding a refusal, answer: who fixes this, with which command? If the honest
answer is "nobody can, through any available path," the guard is not a
safeguard — it is a trap that has not sprung yet. Guards (1) and (4) were both
traps by this test, and both sprang on the same day.

**Inherited defects warn; introduced defects block.** A change should be
refused for what it breaks, not for what it found already broken. Full-corpus
health remains worth knowing — as a command someone runs deliberately, not as a
silent gate on unrelated work.

## Contributing causes worth their own work

**Two registries.** The SQLite work database and the checked-in plan documents
are both treated as authoritative, and they disagree. Observed twice today: the
adopting project's entire active plan was absent from the database, and 33
`arcadia work update --queue inbox` calls returned `ok` while changing nothing
visible, because the queue is derived from documents rather than from the rows
that were updated. One of the two must be the source and the other derived.
This is the deepest of the problems here and the most likely source of the next
one.

**Ask has no idempotency.** Ten identical Actions from one invocation in one
second is not a race, it is a missing key. A repeated Ask should match the
existing Action rather than mint a new id.

**Nothing retires an Action.** Statuses are open, in_progress, blocked, done.
Junk can be created and cannot be removed, only marked as work that finished —
which would be a lie in the record. Retirement needs to exist before cleanup
can be honest.

**Decisions cannot offer choices.** Filed separately as Agent Ask
`decisions-should-offer-choices-proposal-2026-09-03`. A Decision carries a
`recommendation` string and no options, and settlement writes the filing Ask's
entire rationale into that field. The operator answered four multiple-choice
questions in seconds that the prose form had stalled on for days.

## What to do first

The guard rule, ahead of any individual fix. It is cheap, and it converts every
future instance of the other four problems from "everything stops, with no way
out" into "one thing warns." The other items are then ordinary work rather than
emergencies.

## Disclosure

The 33 `arcadia work update --queue inbox` calls described above were made by a
coding agent during this session, on the mistaken belief that the queue read
from those rows. They returned `ok`, changed nothing the queue displays, and
their prior `queue` values were not captured beforehand, so they cannot be
precisely reverted. The affected rows are duplicates in the Rebuster and Martian
Rover bootstrap plans.
