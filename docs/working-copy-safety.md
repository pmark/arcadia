# Working-Copy Safety

Arcadia treats the repository as the recovery source of truth for coding work.
Agent conversation state is useful context, but work is not preserved until Git
can name it and a remote can recover it.

## The safety states

| Preservation | Meaning | Required response |
| --- | --- | --- |
| `UNSAVED` | Modified, staged, or untracked files exist only in one working copy. | Review the scope, create a branch if necessary, commit intentionally, and push. |
| `LOCAL ONLY` | One or more commits are not present on the upstream branch, or an unmerged branch has no upstream. | Push the branch and open a draft PR. |
| `PUSHED` | The remote can recover the commits. Arcadia reports whether an open PR was found or PR state is unknown. | Open a draft PR when none exists. |
| `IN PR` | A pull request records the branch, purpose, and delivery state. | Validate, review, and merge or close deliberately. |
| `LANDED` | No unique or uncommitted work remains. | Nothing required to preserve it — but see "Retiring safely landed work" below; `LANDED` state that nobody clears is exactly what accumulated into 15 worktrees and 54 branches before `arcadia tidy` existed. |

Delivery is reported separately. A branch can be safely preserved in a draft PR
while still being blocked, failing Validation, or far from merge-ready.

## Daily check

Run the read-only monitor whenever the Morning Packet reports an exception:

```sh
pnpm arcadia work monitor
pnpm arcadia work monitor --json
```

The command starts from every active Project's configured repository path. It
finds linked Git worktrees, dirty files, detached work, unpushed commits,
unmerged local branches, remote branches, and pull requests. It does not fetch,
checkout, stage, commit, push, open a PR, or change repository state. Use
`--no-pull-requests` when offline or when only local Git evidence is wanted.

## Retiring safely landed work

`work monitor` answers one question: is anything at risk of being lost? It
deliberately says nothing about the opposite failure — a worktree or branch
whose work is entirely safe, already on the base branch, and simply never
retired. Left alone, `LANDED` state accumulates silently, because nothing in
the preservation model above has any reason to flag it. That accumulation is
not hypothetical: this repository reached 15 worktrees and 54 local branches
before anyone noticed, and two of the branches that looked most alarming when
finally reviewed — reported as "the only copy" of their work — turned out to
be stale content that would have *damaged* `main` if merged, not work at risk
of being lost. The report itself was the problem.

`arcadia tidy` is the counterpart tool. Run it from any repository:

```sh
arcadia tidy              # dry run; nothing is changed
arcadia tidy --apply      # retires exactly what the dry run listed
```

Its removal rule is one sentence, true by construction rather than by careful
checking: **nothing is removed unless every commit it carries is already
reachable from the base branch, and its working tree is clean.** A branch
whose commits are all ancestors of base has no commits of its own to lose, so
this cannot destroy work — there is no state in which it does.

Proving "already reachable" takes three checks, run in order, each catching
what the others miss:

1. **Ancestry** — the ordinary case: the branch's commits are literal
   ancestors of the base branch.
2. **Patch equivalence** (`git cherry`) — catches cherry-picks, rebases, and
   amended commits, which rewrite history so the branch is never a literal
   ancestor even though its content landed. Local, offline, no credentials.
3. **Verified pull-request merge** — checks GitHub for a merged pull request on
   the branch and verifies *that commit's* ancestry, not merely GitHub's
   "merged" label. This is what catches a squash or rebase merge, which
   rewrites history the same way a manual rebase does.

A branch is only reported unmerged once all three decline it. Before comparing
anything, `tidy` fetches `origin` by default — every worktree in a repository
shares one set of refs, so a base branch nobody has pulled in recently makes
every worktree's ancestry check stale at once, with nothing to indicate it.
That staleness is what produced this repository's false alarms in the first
place.

When git's own `branch -d` refuses a branch this process has already proven
safe — which happens for squash/rebase merges and for any branch whose remote
counterpart still exists, since git compares against the upstream rather than
the base — `tidy` writes an `archive/<branch>` tag before forcing the delete,
and prints the restore command. Push those tags and the commit is recoverable
by name, forever, from any clone, independent of the branch that pointed to it.

`arcadia go` reports a local-only count of extra worktrees and already-merged
branches at the end of every run, pointing at `tidy` when there is anything to
clear. No fetch, no GitHub call — it costs nothing at the session boundary
where it runs, and its only job is to make sure this state is never silently
invisible again.

See `START_HERE.md`'s "Working across many projects without losing the
thread" for the operator-facing walkthrough, including every flag.

## Start-session rule

One coding session gets one branch and one worktree. Do not start agent code
changes on `main`, and do not point two coding sessions at the same working
directory. A session title is not an isolation boundary; a worktree is.

Before editing:

1. Run the monitor.
2. Confirm the intended working directory is clean or contains only the work
   explicitly assigned to this session.
3. Create a dedicated branch/worktree from the current remote default branch.
4. Record the Project, branch, and intended module in the session title or Run.

## Stop-session rule

A coding session may stop only in one of these states:

- The work is merged.
- The branch is pushed and represented by a draft or ready PR.
- The operator has explicitly chosen a local-only exception, and the final
  report names the exact repository, worktree, branch, dirty paths, and recovery
  action.

Never silently leave dirty files on `main` or a detached HEAD.

Settling an Agent Ask (`arcadia agent-ask settle --apply`) is a second,
easy-to-miss way to land in `LOCAL ONLY` state on a branch nobody was actively
committing to — it writes and commits the managed documents its effects
describe, but by design never pushes them. See the shared `AGENTS.md` region's
"Settling commits locally and never pushes" for why, and push before this rule
lets the session stop.

## Recovery playbook

When the monitor finds vulnerable work, preserve before reconciling:

1. Stop every session writing to the same working directory.
2. Inspect `git status`, changed paths, and the last commits. Do not clean or
   reset anything.
3. If detached or on the default branch, create a clearly named recovery branch
   without changing the files.
4. Check for credentials, generated binaries, unrelated files, and overlapping
   features before staging.
5. Commit the understood scope. If the scope is mixed, say so in the commit and
   draft PR instead of pretending it is ready.
6. Push immediately and open a draft recovery PR.
7. Validate on that branch.
8. Replay coherent commits onto current `main` in a fresh worktree. Resolve
   conflicts there, never in the only preserved copy.
9. Merge only after the recovered behavior and current behavior both pass their
   Validation.

Automatic WIP commits are intentionally deferred. Reconsider them only when a
second overnight `UNSAVED` incident occurs after this monitor is in normal use,
and only after a repository-specific secret scan and generated-file policy are
configured.
