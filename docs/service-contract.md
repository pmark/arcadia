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
