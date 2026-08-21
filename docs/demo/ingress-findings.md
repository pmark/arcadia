# Why iCloud ingress stopped processing anything

Investigated 2026-08-20. The operator reported text notes sent to `ArcadiaIngress`
sitting unprocessed, while `arcadia ingress activity` reported `healthy` with
`Pending: 0`.

## Root cause — confirmed

**The periodic ingress service crashes on every single run.** Running the installed
LaunchAgent's exact `ProgramArguments` reproduces it immediately:

```
Error [SQLITE_NATIVE_ABI_MISMATCH]: SQLite native addon ABI mismatch:
/opt/homebrew/Cellar/node/25.6.1/bin/node is running Node ABI 141,
but better-sqlite3 was built for ABI 127.
```

The installed plist is **stale** — written by an older version of Arcadia. It runs
`node_modules/.bin/tsx` directly, with `/opt/homebrew/Cellar/node/25.6.1/bin` first on
`PATH`, so the service executes under Homebrew's Node 25.6.1 while the repository pins
22.23.1 in `mise.toml` and `better-sqlite3` is built for that ABI.

`buildIngressServicePlist` in `src/commands/ingressService.ts` already generates the
correct form — `mise -C <repo> exec -- node <tsx> <cli> …`, with mise's directory first
on `PATH`. The installed file simply predates it.

### The fix

```sh
arcadia ingress service install
```

Reinstalling regenerates the plist from current code and reloads the agent. Nothing
else needs to change; `better-sqlite3` is already built correctly for the pinned Node
(verified: it loads cleanly under `mise exec -- node`).

## Still unknown — needs the operator

Whether the notes are also in the wrong place. The background probe confirms
`ArcadiaIngress/iCloudIdeas/In/` exists and reports `observed: 0`, so once the service
runs it will still find nothing if either of these is true:

1. **Wrong folder.** The watcher reads `<root>/<source>/In` only. Notes dropped in
   `ArcadiaIngress/` itself are never seen.
2. **Undownloaded iCloud placeholders.** An evicted file is `.name.txt.icloud`, a
   dotfile — and the scanner filters every entry starting with `.`
   (`runIngressListCommand`). It is invisible and uncounted.

One command distinguishes them:

```sh
ls -la ~/Library/Mobile\ Documents/com~apple~CloudDocs/ArcadiaIngress ~/Library/Mobile\ Documents/com~apple~CloudDocs/ArcadiaIngress/iCloudIdeas/In
```

## Product defects worth fixing separately

These are real, and each one contributed to the failure being invisible for so long.

1. **`ingress service doctor` reports `healthy` while every pass crashes.** The health
   probe writes its own state file and is evaluated independently of whether the
   ingress pass succeeded. "Recent service errors: No errors since the last successful
   background probe" was printed while the error log held twelve crashes. The health
   verdict should incorporate the outcome of the last actual pass.

2. **An unreadable ingress root surfaces as `UNEXPECTED_ERROR`.** `arcadia ingress list`
   against a TCC-denied folder prints `Error [UNEXPECTED_ERROR]: Unexpected error.`
   with no path, no code, and no remedy. `src/docs/dispatch.ts` already argues at length
   against exactly this, for exactly this reason: it "tells the operator nothing about
   which file to fix." EPERM on the ingress root should name the folder and say that
   Full Disk Access is required.

3. **Undownloaded iCloud files are silently invisible.** Filtering dotfiles is right for
   `.DS_Store` and wrong for `.name.txt.icloud`, which is a real queued note that has
   not materialised. These should be counted and reported as waiting on iCloud, not
   skipped in silence — the code already has an `ingressDownloadState` concept for
   materialised files.

4. **Ingress provenance is not recorded on Actions.** `back_burner_items` carries
   `ingress_source`, but `work_items` has no equivalent column, so an Action created by
   an ingress pass is indistinguishable from one created by hand. That makes ingress
   output unauditable, and is why `scripts/demo/unseed-2026-08-21.sh` has to match its
   one ingress-created Action on `raw_input` text.

5. **Latent: the service's Node is unpinned by construction.** Even after reinstalling,
   nothing re-checks the plist when the pinned Node changes. A future `mise` bump plus a
   stale plist reproduces this exact failure, silently, with the same misleading
   `healthy` verdict.

## What was verified working

The ingress pipeline itself is sound. Pointed at a local root, it is deterministic and
fast — 3 notes discovered and processed in 1.32s with no model call, byte-identical
across two independent runs from a clean copy of the live workspace:

| Note | Becomes | Routed to |
| --- | --- | --- |
| `pinterest.txt` | an Action, open | Rebuster |
| `intake-link.txt` | Back Burner Question | Private Practice Now |
| `weekly-digest.txt` | Back Burner Idea | unscoped |

Two of the three were routed to the correct Project from the note text alone, with no
project named on the command line.
