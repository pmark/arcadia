# The service contract

How Arcadia starts, stops, and inspects a project's local services — and why it
does almost none of that itself.

## The contract

A project that wants its services controllable ships one executable:

```
scripts/services.sh
```

It takes exactly one argument:

| Command | Must do | Must not do |
| --- | --- | --- |
| `status` | Report what is running, one line per service, and exit 0 whether or not everything is up | Change anything |
| `restart` | Stop and start every service the project owns, from the current working tree | Pull, fetch, checkout, or otherwise touch git |
| `stop` | Stop every service the project owns | Leave orphans |

Arcadia runs it with the repository root as the working directory, never
through a shell, and with a 180-second timeout. Exit `0` is success; anything
else is a failure whose combined stdout and stderr is shown verbatim.

A project with no `scripts/services.sh` is simply not restartable. That is a
supported state — the QA queue says so plainly rather than offering a button
that would do nothing.

## Why the script lives in the project

Arcadia does not know how to run your services and should not learn. A Rails
app, a Next.js dev server, and a launchd agent have nothing in common except
that somebody knows the command. That somebody is the project.

This also keeps Arcadia installable. The alternative — Arcadia holding a
registry of every project's start commands — puts one person's machine layout
into a shared tool, which is the same mistake as checking a `/Users/...` path
into a public repository.

## Why git is Arcadia's job and not the script's

`restart` must not fetch or pull. Arcadia brings the checkout to its base
branch first, under a safety contract the script has no way to honour:

- Refuses when the working tree is dirty, before anything else happens.
- Refuses on detached HEAD, or when the checkout is on some other branch.
- Fetches, then **fast-forwards only** — never merges, rebases, resets, or
  stashes.
- Refuses when the checkout is ahead of the remote, because that is not a
  fast-forward and the local commits are somebody's unpushed work.

Splitting it this way means a script that misbehaves can cost you a restart,
never a commit.

## The three verbs are separate on purpose

`arcadia qa refresh` still does the whole thing, but the pieces are also
addressable on their own, because welding them together made every change cost
the most expensive outcome:

| Command | Touches | Refuses |
| --- | --- | --- |
| `qa fetch <project>` | Refs only — never the working tree | Only an unreadable repository |
| `qa verdict <project>` | Nothing; reads local refs | Nothing |
| `qa switch <project>` | Checks out the base branch, and only that branch | A dirty tree |
| `qa refresh <project> --skip-restart` | Fast-forwards the checkout | Dirty, detached, wrong branch, ahead, diverged |
| `qa restart <project>` | Services only; no git at all | A project with no service script |

`fetch` exists because `repoFreshness` deliberately never reaches the network,
which is right for a page load and useless in the minute after a merge: the
checkout really is up to date with a `main` whose refs are an hour old. It is
safe in a way pull is not — no working tree, no commit, no branch — so it needs
none of pull's refusals and is offered even when the pull is blocked.

`switch` is the one exception to "switching branches is yours to decide", and
only because it is not a choice: it has exactly one destination, already named
in the project config, and returning to the base branch is the normal end state
of every agent session. Checkout with a clean tree destroys no commit and
deletes no ref, so the branch left behind is still there afterwards — and the
result says whether it was merged, so moving away from unmerged work is stated
rather than silent. Selecting an arbitrary branch remains out of scope.

## Whether a restart is needed

`qa verdict` classifies the paths in `HEAD..origin/<baseBranch>` and reports the
strongest verdict any one file earns: dependencies changed means install first;
environment, build config, boot-time entry points, or migrations mean restart;
watched application source means HMR should cover it; docs and tests mean
nothing running reads them. A path no rule recognises is reported as unknown,
which offers the restart rather than assuming safety.

It is a planning signal, not a guarantee, and the wording holds that line: the
honest claim is "HMR should cover this", never "no restart needed". Every
verdict carries the files that produced it, because a verdict you cannot check
is the same unfalsifiable claim as a hand-typed freshness string.

Restart remains all-or-nothing per project — the contract above has no
per-service selector — so the verdict also names which workspace apps the
changed paths fall under, to say plainly what a restart will cost.

## You do not start from a blank file

`arcadia project setup-context` scaffolds `scripts/services.sh` when a project
has none, in this contract's shape, with three marked blocks to fill in. It
never overwrites an existing one — that is the only file adoption writes which
is hand-authored per project rather than generated, and clobbering a working
service script would be the most destructive thing adoption could do.

**The placeholder fails loudly.** Every verb exits non-zero until its block is
completed. A stub that exited 0 and did nothing would make `arcadia qa refresh`
report "services restarted" when nothing had been — plausible, wrong, and
invisible, which is the same failure as a hand-typed freshness string.

Completing it is a well-shaped task for a coding agent: the interface is fixed,
the blanks are marked, and the tests it must satisfy are the three verbs.

## Writing one

The whole contract fits in a few lines. This is enough for a project whose
services are `pnpm` processes:

```sh
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-status}" in
  status)  pgrep -fl "my-project-dev" || echo "not running" ;;
  stop)    pkill -f "my-project-dev" || true ;;
  restart) "$0" stop; sleep 1; pnpm dev >/dev/null 2>&1 & ;;
  *)       echo "usage: $0 [status|restart|stop]" >&2; exit 2 ;;
esac
```

Real ones do more — pinning a toolchain, writing logs somewhere findable,
using launchd or systemd so services survive a logout. Arcadia does not care
which, as long as the three verbs behave.

## Portability

macOS first, because that is where this is developed and tested. Nothing in
the contract is macOS-specific: it is a script, three verbs, and an exit code.
A Linux project shipping the same three verbs works unchanged. Scripts using
`launchctl` obviously do not, which is a fact about that script rather than
about the contract, and is why the script belongs to the project.

## Configuration

Machine-specific values live in the workspace, never in this repository:

```
<workspace>/config/qa-targets.json
```

See `config/qa-targets.example.json` for the shape. A project needs only its
`repoPath` and `baseBranch`; the service script is found by convention. Set
`serviceScript` to override the path when a project keeps it somewhere else.
