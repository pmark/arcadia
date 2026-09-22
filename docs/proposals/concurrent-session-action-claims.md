---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia give an Action a visible, cross-session claim the moment a worktree is prepared for it — with a bounded, self-expiring lifetime — so two coding-agent sessions never independently start the same governed work?
---

# Two sessions dispatched to the same Action, one of them wasted

## Why this project needs it

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

## What Arcadia needs at a high level

This document's evidence actually names two distinct races, and the fix
below answers only the first one. Naming that boundary explicitly matters:
neither race's fix subsumes the other, and a reader should not assume closing
one closes both.

1. **Duplicate dispatch of the same Action** — the collision this proposal
   opens with. Two worktrees, prepared for the identical Action id, each
   believing they may start work. The claim mechanism below answers this one.
2. **Unserialized writes to `PROJECT.md`'s `current_action`** — the second,
   independently observed race in "Why this specific Action was exposed to
   it." `settleAgentAsk` (`src/ask/settlement.ts`) reads `PROJECT.md` with a
   plain `readFileSync` into `projectBefore`, computes `projectAfter` from
   it, and writes it back with no compare-and-set against the file's content
   at write time. Two concurrent settlements *for two different Actions* —
   not a claim collision at all, since each really did do its own distinct
   work — can each read the same `projectBefore`, and the second write
   silently discards the first's pointer move, exactly the "chore(arcadia):
   point at &lt;next-action&gt;" conflicts this session hit twice. **The claim
   mechanism below does not fix this.** It would need its own answer: a
   compare-and-set on `PROJECT.md`'s content (or a monotonic revision field
   checked at write time) so a settlement fails loudly and retries rather
   than silently overwriting a pointer another settlement already moved.
   Whether that is in scope for this proposal or belongs in a second one is
   an open question this document does not resolve — but it must not be
   answered by implication.

**An Action needs a visible claim the moment a worktree is prepared for it —
not only a completion record after the fact.** For race 1, the claim has to
be:

- **Keyed by Action, not by worktree path, and checked the same way the
  existing table already checks worktree paths.**
  `reserveAgentWorktree` (`src/sessions/index.ts`) already writes an
  `agent_worktree_reservations` row in the shared workspace database — already
  cross-checkout (the database, not a per-checkout file), already
  self-expiring (a flat 24-hour TTL, `AGENT_WORKTREE_RESERVATION_MS`) — every
  time `arcadia go` prepares a worktree, launched or not. It did not catch
  this collision because it is keyed by `(repository_path, worktree_path)`:
  it stops the *same* worktree path from being reserved twice, which is a
  different guarantee from stopping two *different* worktree paths from
  claiming the *same* Action. `getActiveWorktreeReservation`'s existing
  conflict lookup already filters `expires_at > now` in the query itself,
  not only via the best-effort `DELETE ... WHERE expires_at <= ?` that runs
  on each insert — an Action-id-keyed lookup must copy that exact discipline
  (filter expiry in the conflict *query*, not rely on cleanup-on-insert
  alone), or a stale, unexpired-looking row from a crashed cleanup path could
  block legitimate dispatch. The fix this proposal asks for is narrower than
  "build a claim mechanism from nothing" — it is "add `action_id` to the key
  and the expiry-filtered conflict query this table already enforces for
  worktree paths, and check it before handing out a new worktree."
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
  mid-work, never a stand-in for either of them.
- **Defined at the edges a bounded TTL creates.** A flat 24-hour expiry with
  no renewal already exists on the current table and already conflicts with a
  no-`--launch` manual session that can legitimately run longer than that
  without anything else in the repository knowing it is still active (nothing
  else emits a heartbeat for a manual handoff the way a launched Session's
  tmux/lease rows do). Whatever design answers this proposal has to say
  explicitly what happens at expiry — whether a still-working session can
  renew its own claim, what a second session that arrives after expiry but
  while the first is still actually working is told, and whether settlement
  itself becomes conditional on the claim that produced it still being the
  current one — rather than leaving that race implicit the way the existing
  table's 24-hour cutoff does today.
- **A dispatch refusal, not an advisory flag.** `evaluateExistingCandidate`'s
  existing behavior is the right shape to extend: it does not warn and
  proceed, it refuses outright and names the remedy. An Action-level claim
  needs the same property — `arcadia go`, and any automated `arcadia next` /
  `arcadia advance` caller, must be unable to receive a dispatchable worktree
  for an Action that is already actively claimed elsewhere, with an explicit,
  recorded operator override as the only way past that refusal — not a
  clearly-labeled brief a session can still act on at face value, which is
  exactly what happened here.

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
