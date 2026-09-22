---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia dispatch several coding-agent sessions in parallel, each getting a different ready Action automatically, with a visible per-Action claim so two sessions never independently start the same governed work?
---

# Running sessions in parallel needs assignment, not just collision safety

The operator asked, after reading an earlier draft of this proposal that
covered only collision prevention: "How does the proposed solution handle
task assignment? When `arcadia advance` occurs, does it choose the next
available action?" It does not, today, and the earlier draft's fix would not
have made it. This revision answers that question directly and widens the
ask to match it: **safe parallel sessions need two capabilities together,
not one** — different-Action assignment, and a claim that stops the
collision this document opens with. Either alone is not enough: assignment
without a claim just reproduces this collision with extra steps; a claim
without assignment makes a second session refuse safely and then sit idle,
which is safety, not parallelism.

## Why this project needs it: two sessions dispatched to the same Action

On 2026-09-22, `arcadia go` was run from this repository's main checkout and
returned a freshly prepared worktree and dispatch brief for Action
`refresh-managed-production-readiness-2026-09-22`. The session that received
it did the normal preflight — bridged `node_modules`, ran the read-only
work-monitor check, read the Action's acceptance criteria — before touching
any code.

A *different* worktree
(`claude/refresh-managed-production-readiness-2026-09-22-20260922T042108949Z`,
a different timestamp from this session's own
`...20260922T044804586Z`) already held the same Action and was finishing the
same work at essentially the same moment: this session's worktree was
created at `2026-09-22T04:48:04.586Z`; the other session's completion
settlement is timestamped `2026-09-22T04:49:58Z`; its pull request,
[pmark/arcadia#487](https://github.com/pmark/arcadia/pull/487), shows a
merge time of `2026-09-22T04:48:49Z`. All three land within about two
minutes of each other — close enough that the exact interleaving is not
fully reconstructable from timestamps alone, but the two sessions were
unambiguously working the same Action concurrently, not one starting after
the other visibly finished. Neither worktree, neither `arcadia go`
invocation, and nothing in between detected the collision. The second
session only discovered it by chance,
several steps into its own preflight, while separately investigating an
unrelated `PROJECT.md` merge conflict and noticing a suspicious commit
(`git log origin/main --oneline --all | grep refresh-managed-production-readiness`
surfaced `74a99e5f chore(arcadia): settle
complete-refresh-managed-production-readiness-2026-09-22` sitting right next
to a merge of the other worktree's branch). Nothing about the second
session's own `arcadia go`, `arcadia advance`, or `arcadia work monitor`
output ever said "this is already done" or "another worktree already claimed
this."

The wasted cost was real but bounded here — worktree creation, a dependency
bridge, and a read of the (already-stale) Action text, not a full
implementation — only because the second session happened to cross-check git
history for an unrelated reason before writing any code. A session that
trusted its dispatch brief at face value, as the brief itself invites it to
("Dispatchable: a coding agent may begin this action now"), would have spent
a full implementation pass reproducing already-merged work, then discovered
the collision only at `arcadia agent-ask settle --intent complete`, if a
"changed content under a used request_id" or similar conflict check even
catches an *independently reimplemented* completion rather than a literal
retry of the same request. It might not have been caught before a duplicate,
conflicting PR was opened.

### Why this specific Action was exposed to it

`refresh-managed-production-readiness-2026-09-22` was never part of the
explicit ordered queue: `arcadia schedule status --project arcadia` lists 23
positioned entries and this Action is not one of them. It reached
`current_action` through a direct Agent Ask settlement that targeted the
pointer explicitly, bypassing `arcadia advance queue make-next`. That is a
legitimate, documented mechanism (`project_update` /
`complete`'s next-Action resolution can name an Action outside queue order),
but it means the one collision check that does exist —
`evaluateExistingCandidate` in `src/commands/go.ts`, which refuses a new
`arcadia go` when this *exact repository checkout* already holds a live or
unresolved candidate for the *same* Action — never had a chance to fire,
because the two sessions used two different repository checkouts
(`.claude/worktrees/...T042108949Z/arcadia` and
`.claude/worktrees/...T044804586Z/arcadia`), and that function's protection
is scoped to one `controlWorktree` at a time, not to the Action globally. A
second, genuinely cross-checkout mechanism does already exist — see "What
Arcadia needs at a high level" below — but it is keyed on worktree path, not
Action id, so it did not catch this collision either.

The same session also independently observed the more general version of
this problem, unprompted: twice in one hour, the shared main checkout
accumulated a local-only `chore(arcadia): point at <next-action>` commit from
`arcadia advance queue make-next --apply`, written by some other process
(once traced to the live worker daemon's own tick, `arcadia worker status`
confirming PID 74961 running), that textually conflicted with a pointer
advance this session's own settlement had *also* just written. Both times the
fix was a manual `git reset --hard origin/main` plus a fresh
`queue make-next` recompute — safe here only because both commits were
provably local-only, unpushed, and mechanically superseded. `PROJECT.md`'s
`current_action` field is a single mutable file position with no lock,
written by whichever process gets there first; every concurrent writer races
every other one by construction.

### What `arcadia advance` actually does today — verified, not assumed

`runAdvanceCommand` (`src/commands/advance.ts`) resolves `current_action`
from `PROJECT.md`/the plan document via `resolveProjectTransition` and
reports whether *that one Action* is dispatchable. It does not read the
queue and it does not choose anything — it is a status check against a
single existing value. `arcadia go` is built on the same primitive: it
prepares a worktree for whatever `current_action` already says.

The only command that *chooses* is a separate, explicit one:
`arcadia advance queue make-next`, which computes the next Action from the
ordered, dependency-resolved queue (`buildAgentQueue`) and *writes* it into
that same single `current_action` field via `transitionActionPointer`. One
value, global to the Project, not scoped to a session or a worktree. Given
two sessions, both `arcadia go` invocations resolve the identical pointer
and are dispatched to the identical Action — which is exactly this
document's evidence, not a hypothetical.

## What Arcadia needs at a high level

Three capabilities, needed together. None of the three subsumes another, and
a reader should not assume building one makes the others unnecessary.

### 1. Assignment: `arcadia go` picks a *different* ready Action per session

This is the direct answer to "does `arcadia advance` choose the next
available action" — today, nothing does, for a second concurrent session.
`arcadia go`, when it prepares a *new* worktree and finds `current_action`
already actively claimed (capability 2, below) by a different, still-live
worktree, needs a fallback: instead of refusing outright, it walks the same
ordered, dependency-resolved queue `queue make-next` already computes from
(`buildAgentQueue`) and claims the first entry that is both dependency-ready
*and* unclaimed. Refusing outright is still correct for `arcadia advance`
run *inside* an already-prepared worktree — that call should resolve the
Action *this worktree's own claim* already names, not go looking for a
different one, so a session never gets silently reassigned mid-work.

Walking the queue and claiming an entry cannot be two steps: `arcadia go`
already serializes `evaluateExistingCandidate` and worktree reservation
inside one `writeTransaction` (`src/commands/go.ts`), and this fallback has
to run inside that same transaction, attempting an atomic, expiry-aware
conditional claim — enforcing capability 2's active
`(repository_path, project, action_id)` uniqueness — for each candidate
entry in order. Losing that race (another `arcadia go` claimed the same
entry a moment earlier) is not a failure, it is the normal case under real
concurrency: the walk simply continues to the next dependency-ready,
still-unclaimed entry rather than stopping or retrying the one it lost.

This does not require `PROJECT.md`'s `current_action` to become a list.
`current_action` can keep meaning "the primary pointer for serial,
single-worker use" — which is how every existing reader of it (the
dashboard, `docket`, `arcadia next`'s narrative brief, this document's own
"Refreshing this document" recipe) already treats it, and rewriting all of
those to understand multiple simultaneous "current" Actions is far more than
this capability needs. A parallel `arcadia go` invocation's own dispatch can
be resolved from the claim it made (capability 2) and the worktree it is
running in, without touching or needing to reinterpret the single pointer at
all. Whether `current_action` should eventually *also* expose "which Actions
are currently claimed, by which worktrees" is a reasonable follow-on
question this proposal does not answer — naming it here so it is not
silently decided by whoever builds this first.

That resolution has to reach all the way to settlement, not stop at launch:
`arcadia agent-ask settle` (for `project_update` and `complete`, capability
3's retry rule below) must load *this worktree's own claim*, verify its
`action_id` matches the Action settlement is about to resolve — whether that
Action came from `current_action`, the queue, or an explicit target — and
carry that claim's generation through the settlement's writes and its
release. Without that check, a queue-walk-assigned worktree (or a stale one
whose claim already expired and was reclaimed) could settle
`current_action` or a different explicit Action it was never actually
holding, which is exactly the silent-mismatch failure capability 2's claim
exists to rule out in the first place.

### 2. A claim: the same Action is never dispatched twice

The collision this document opens with. Two worktrees, prepared for the
identical Action id, each believing they may start work. **An Action needs a
visible claim the moment a worktree is prepared for it — not only a
completion record after the fact.** The claim has to be:

- **Keyed by Action *in addition to* worktree path, not instead of it — two
  uniqueness guarantees on one table, neither replacing the other.**
  `reserveAgentWorktree` (`src/sessions/index.ts`) already writes an
  `agent_worktree_reservations` row in the shared workspace database — already
  cross-checkout (the database, not a per-checkout file), already
  self-expiring (a flat 24-hour TTL, `AGENT_WORKTREE_RESERVATION_MS`) — every
  time `arcadia go` prepares a worktree, launched or not. It did not catch
  this collision because it is keyed by `(repository_path, worktree_path)`:
  it stops the *same* worktree path from being reserved twice, which is a
  different guarantee from stopping two *different* worktree paths from
  claiming the *same* Action, and the existing worktree-path constraint must
  keep doing its own job (one worktree, one reservation, so cleanup and
  ownership stay unambiguous) exactly as it does today — this capability
  adds a second, independent uniqueness constraint on active
  `(repository_path, project, action_id)`, as a new column and check
  alongside the existing one, in the same row or a linked one, never as a
  replacement for it. `getActiveWorktreeReservation`'s existing conflict
  lookup already filters `expires_at > now` in the query itself, not only
  via the best-effort `DELETE ... WHERE expires_at <= ?` that runs on each
  insert — the new Action-id-keyed lookup must copy that exact discipline
  (filter expiry in the conflict *query*, not rely on cleanup-on-insert
  alone), or a stale, unexpired-looking row from a crashed cleanup path could
  block legitimate dispatch. The fix this proposal asks for is narrower than
  "build a claim mechanism from nothing" — it is "add an `action_id`
  uniqueness constraint and its own expiry-filtered conflict query beside the
  worktree-path one this table already enforces, and check both before
  handing out a new worktree."
- **Released only by a successfully applied terminal settlement, with TTL as
  fallback, never primary, cleanup.** Two explicit release paths need to
  exist and neither is the timer: a settlement that actually completes with
  `apply: true` (never a preview, a dry run, or an apply attempt that itself
  failed) must release the claim it produced accepted evidence for, and a
  worktree or Session preparation that fails outright must remove the claim
  it just created before returning its error. Relying on the 24-hour TTL for
  either case means a normally-completed or a merely-failed-to-prepare
  Action stays wrongly claimed and blocks legitimate re-dispatch for up to a
  day. The TTL stays as the backstop only for the case those two explicit
  releases cannot cover — a claim whose owning process genuinely died
  mid-work, never a stand-in for either of them. Both release paths must be
  fenced by generation exactly the way settlement writes are (below): a
  release names the generation it believes it owns, and the delete is
  conditioned on `(repository_path, project, action_id, generation)`
  matching atomically — never a plain "delete the row for this Action." A
  release that has fallen behind (its generation already expired and a
  *different* session's newer claim replaced it) must be a no-op, the same
  as releasing an already-released claim, or a slow settlement's or a
  delayed cleanup's release could delete a newer, actively-owned claim out
  from under whoever holds it.
- **Fenced by a claim generation, not just an expiry timestamp.** A flat
  24-hour expiry with no renewal already exists on the current table and
  already conflicts with a no-`--launch` manual session that can legitimately
  run longer than that without anything else in the repository knowing it is
  still active (nothing else emits a heartbeat for a manual handoff the way a
  launched Session's tmux/lease rows do). The dangerous case is not "the
  claim expired and dispatch correctly refuses" — it is "the claim expired, a
  *second* session claimed the same Action and started genuinely new work,
  and the *first* session — still alive, just slow — later tries to settle
  against a claim that is no longer its own." Whatever design answers this
  proposal has to give each claim a generation (a monotonic counter or a
  fresh id each time an Action is claimed, matching how `reserveAgentWorktree`
  already replaces rather than reuses a row) and make settlement present the
  generation it started with; a settlement whose generation does not match
  the claim's *current* generation must fail loudly and refuse to write —
  never silently overwrite work the reclaiming session already produced. The
  generation check and the settlement's writes must be the same atomic
  operation, not two steps with a gap between them a reclaim can land in:
  checking the generation, then separately writing evidence, releasing the
  claim, and moving the pointer, leaves exactly the window this fencing
  exists to close. Capability 3 already gives this a home —
  `transitionActionPointer` wraps its own write in one `db.transaction`
  (`src/dispatch/pointer.ts`) alongside `writePairAtomically` — so either the
  claim generation becomes part of what that same transaction validates
  before committing, or the generation compare-and-branch runs inside that
  identical transaction boundary; a check performed before the transaction
  opens is not good enough. Whether a still-working session can renew its
  own claim before expiry, so
  this case is rare rather than merely survivable, is a real design question
  this document leaves open — but the fencing above must hold regardless of
  whether renewal exists, because a session can still die between a renewal
  and the next one.
- **A hard block on the claimed Action specifically, not an advisory flag.**
  `evaluateExistingCandidate`'s existing behavior is the right shape to
  extend: it does not warn and proceed, it refuses outright and names the
  remedy. Claiming an already-claimed Action must be impossible, full stop —
  not a clearly-labeled brief a session can still act on at face value, which
  is exactly what happened here. What happens *next* differs by caller:
  `arcadia go` preparing a brand-new worktree falls back to capability 1's
  queue walk rather than stopping there; `arcadia advance` run inside a
  worktree that already holds its own claim never consults this check at
  all, since it is resolving its own claimed Action, not requesting a new
  one; and any automated `arcadia next` caller with no worktree to fall back
  to must still refuse outright, with an explicit, recorded operator override
  as the only way past it.

### 3. Serialized writes to `current_action` — required once parallel dispatch exists

The second, independently observed race in "Why this specific Action was
exposed to it": `settleAgentAsk` (`src/ask/settlement.ts`) reads
`PROJECT.md` with a plain `readFileSync` into `projectBefore`, computes
`projectAfter` from it, and writes it back with no compare-and-set against
the file's content at write time. Two concurrent settlements *for two
different Actions* — not a claim collision at all, since each really did do
its own distinct work — can each read the same `projectBefore`, and the
second write silently discards the first's pointer move, exactly the
"chore(arcadia): point at &lt;next-action&gt;" conflicts this session hit
twice.

An earlier draft of this document left whether to fix this in scope as an
open question. It is not optional once capability 1 exists: today this race
is a rare accident (two writers happen to collide within the same narrow
window); a working assignment capability makes concurrent settlement of
*different* Actions the **normal, routine** case for every session running
in parallel, not an edge case. Shipping capability 1 without this would
convert an occasional silent pointer loss into a frequent one.

**The compare-and-set this needs is not new — it already exists, one call
away, and `settleAgentAsk` simply does not use it.**
`transitionActionPointer` (`src/dispatch/pointer.ts`, the function
`arcadia advance queue make-next` calls) already computes a preview
fingerprint from `headBefore` (the repository's current git HEAD) plus the
content hashes of both `PROJECT.md` and the Plan document, and `apply`
refuses outright — `"Pointer transition apply does not match the current
preview"` — when a fresh read at apply time produces a different
fingerprint than the caller's preview expected. That is exactly a
compare-and-set, already shipped, already tested. `settleAgentAsk`
(`src/ask/settlement.ts`) never calls it: it has its own independent
`readFileSync`-then-`writeFileSync`-via-temp-file path (around line 1625)
with no fingerprint, no `headBefore` check, and no retry. The fix this
capability needs is narrower than "design a new CAS scheme" — it is "route
`settleAgentAsk`'s `current_action` write through the same
`transitionActionPointer` (or the fingerprint discipline it already
implements) that `queue make-next` uses, and give the caller a defined
retry" — with one precision the retry rule must preserve: `project_update`
and `complete` can resolve an *explicit* Action outside queue order (see
"Why this specific Action was exposed to it"), and a retry must recompute
the pointer transition against *that same resolved target*, re-reading only
the base content to produce a fresh diff — never blindly re-derive
`current_action` from fresh queue state, which could silently retarget a
different Action than the one the settlement's own evidence is actually
about. The retry happens under the *same* `settlementRequestId`, since that
id is what the repository's existing duplicate-settlement guard already
keys idempotency on. Claim release (capability 2) needs the same
idempotency property: releasing an already-released claim must be a no-op,
never an error, so a retried settlement can safely repeat it.

This also means the "never dispatched twice" guarantee in capability 2 needs
one explicit qualifier: it holds only while a claim is *active*. Once a
claim expires, a second session may legitimately reclaim and start the same
Action while the first is still, unknown to anyone, still working —
generation fencing stops the *first* session's stale settlement from
overwriting the second's result, but it does not stop both from running
concurrently in the window between expiry and either one settling. Closing
that window fully is what capability 2's own still-open renewal/heartbeat
question is for; this document does not resolve it, only names it so the
gap is not silently assumed away.

## What to avoid

- **Do not build this as a local script in this repository.** A pre-flight
  "grep git log for a completion commit before starting" check, which is
  literally the manual step that caught this collision, is exactly the
  reimplementation `AGENTS.md`'s "Asking for a capability the Way does not
  have" section warns against: it would drift from whatever `arcadia`
  eventually builds, and it only catches the collision *after* one side has
  already finished, not before either side starts.
- **Do not solve this by making `current_action` writes require an
  operator-visible Decision.** That would reintroduce exactly the "ceremony
  around a settled question" cost `CONSTITUTION.md`'s Authority section
  warns against for mechanical pointer moves — Constitution says "carrying
  out a decision already made is not a second decision" — and the actual
  defect here is not that pointer moves happen automatically, it is that two
  of them can happen for the *same* Action without either knowing about the
  other.
- **Do not scope the fix to "the worker daemon should not race an
  interactive session."** That framing would miss half of what happened
  here: the collision this proposal opens with was between two *interactive*
  coding-agent sessions, with the worker daemon a spectator to a separate,
  second collision the same session hit independently. Both are the same
  underlying gap — no cross-session claim — and a fix scoped to only one
  writer would leave the other race exactly as live as it is today.
- **Do not turn `PROJECT.md`'s `current_action` into a list of simultaneously
  active Actions to build capability 1.** As capability 1 says directly: a
  parallel `arcadia go` invocation can resolve its own dispatched Action from
  the claim it made, without the single pointer needing to represent more
  than one thing at once. Rewriting every existing reader of that
  field — the dashboard, `docket`, `arcadia next`'s narrative brief, this
  document's own refresh recipe — to understand a set instead of a value is
  a much larger, separately-scoped change this evidence does not require.
- **Do not let the queue-pop in capability 1 bypass the existing ordered,
  dependency-resolved queue to go faster.** The fallback `arcadia go` needs
  is "the first *unclaimed* entry in the same order `queue make-next` already
  computes," not a separate, unordered, priority-blind pick. Parallelism is
  the reason more than one Action can be in flight at once; it is not
  license to ignore why the queue is ordered the way it is.
