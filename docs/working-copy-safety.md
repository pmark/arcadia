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
| `LANDED` | No unique or uncommitted work remains. | Nothing required. |

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
