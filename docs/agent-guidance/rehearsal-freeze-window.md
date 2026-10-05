# Detailed Way guidance: rehearsal freeze window

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

A live managed-production rehearsal shares one host with every other agent:
one main checkout, one go-broker, one set of launchd services and one live
workspace. Agents keep working in parallel with it, but nothing may change the
shared state the run depends on while it is live. This procedure changes no
authority. It only says when that shared state is frozen.

## The window

The window opens at a successful `arcadia production activate` (or
`reactivate`) and closes at the run's terminal production Off receipt. Observe
it with the read-only command; it is authoritative over any message:

```sh
arcadia production status    # Active · … means the window is open
```

`Inactive` means closed. `Observation unavailable` is not a confirmed Off:
treat the window as open. The orchestrator also announces opening and closing
on the round's coordination Issue; read it, but trust `production status`.

## Forbidden inside the window

- `reinstall-go-broker.sh`, `arcadia go-broker install` and
  `arcadia go-broker ensure`.
- `recover-arcadia-host-services.sh` and `scripts/services.sh restart|stop`,
  except through the run's own Off-first terminal step (G8), which turns
  production Off before it restarts.
- `arcadia production activate|deactivate|reactivate` outside the run's own
  G-steps.
- Edits to workspace config or the provider registry.
- Editing, pausing, docs-syncing or tidying the in-scope fixture Project.
- A whole-queue arrange, or moving any in-scope queue key.
- Fast-forwarding or dirtying the main checkout across commits that touch
  runtime paths: `src`, `scripts`, `apps`, `package.json`, `pnpm-lock.yaml`,
  `tsconfig.json`.

The CLI enforces the first two items. While the policy is Active,
`go-broker install|ensure` (and so `reinstall-go-broker.sh`, before it
installs) and `scripts/services.sh restart|stop` (and so
`recover-arcadia-host-services.sh`) refuse with `production_active_freeze` and
name the read-only alternative. Because the broker and services are
host-wide, the check reads both the workspace the command resolves and the
user-config default (the live workspace), and refuses if either is Active.
The CLI refuses when a configured or resolved workspace's production status
cannot be read. With no workspace configured or resolvable, as in first-time
setup, production cannot be Active, so it proceeds and notes that in its
receipt. An experiment workspace never reads the live default; its own guard
refuses these steps first.
`services.sh` warns and proceeds instead, because a recovery restart must not
depend on a runnable CLI. Shell callers can ask first with
`arcadia production freeze-check <operation>`. The other items are
procedure: no code stops them, so do not do them.

## What continues

- Worktree commits, pull requests and reviews.
- Merges on origin. The main checkout is not fast-forwarded past a
  runtime-path commit until the window closes.
- Arcadia-only Agent Ask settles from the main checkout, when the fast-forward
  range they need is docs-only.
- Read-only commands, including `production status`, `go-broker status` and
  `scripts/services.sh status`.
- `arcadia go` sessions, each in its own worktree.
- Modest `gh` reads.

## Override

`ARCADIA_FREEZE_OVERRIDE=<reason>` set inline on one command bypasses the
refusal. Where the reason is recorded: `go-broker install|ensure` print it on
stderr and keep it in the JSON receipt (`warnings`, `data.freeze`);
`production freeze-check` keeps it in its receipt (`warnings`, `data`);
`scripts/services.sh` prints it on stderr only. An override covers only its
own step: the `go-broker ensure` that follows a restart runs without it and
refuses while production is Active, so reinstalling needs its own override.
It is for the operator, or an agent holding an explicit operator instruction
for that one step. Never export it, and never use it to unblock routine work.

## After the window closes

The release-manager or orchestrator session runs the batched install once,
from the clean main checkout fast-forwarded past everything held back:
`reinstall-go-broker.sh`, then `recover-arcadia-host-services.sh` when
services need the new runtime. Other agents do not reinstall or restart on
their own; they report the need on the coordination Issue.
