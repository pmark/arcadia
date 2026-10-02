# Notes To Self

Indexed answers to things agents here keep re-deriving. **Grep before you dig:**

```sh
grep -n -i -B2 -A25 "keys:.*<word>" docs/notes-to-self.md
```

Every entry has a `keys:` line of the words you would search for, so one grep
lands on the answer instead of a codebase sweep. `docs/AGENT_ORIENTATION.md`
explains *how the system is built*; this file answers *how do I do X right now*.

## How the cache works

This file is a **hot cache**, not an archive. It holds only friction that is
still live. Git history is the backing store, so an evicted entry is never lost.

| Cache idea | Here |
| --- | --- |
| Key | The `keys:` line. Grep it. |
| Capacity | **At most 25 entries.** `tests/notes-to-self.test.ts` enforces this. |
| Validation | Every backticked repo path in an entry must still exist, and the same test fails when one moves. |
| Expiry | `Expires when #NNN closes` marks a workaround. The PR that closes #NNN deletes the entry. |
| Write-back | The best eviction fixes the friction at its source: a clearer error, a `--help` line, a command that prints the answer. Then delete the entry. |
| Eviction | At capacity, remove an expired or written-back entry first. Next, remove the one whose friction you have not hit in the longest time. |

**Rules:**
1. **Look first.** Before searching for a path, command, flag, id, or database, grep this file.
2. **Pay it forward.** If something took more than two failed tool calls to learn, add an entry in the same change. Keep it to five lines or fewer: the exact command, what it prints, and one gotcha.
3. **Fix on contact.** If an entry is wrong, correct it in the change that found out.
4. **Prefer write-back to write-in.** If fixing the friction takes less effort than writing its entry, fix it instead.

**When this outgrows a file.** Move to the indexed lesson store that the
`build-agent-agnostic-learning-loop` Action builds (`arcadia learn`) when any
of these first happens:
- the cap is hit and no entry is evictable, because all of the friction is still live;
- a second repository needs its own notes and agents must search across them;
- the same friction is rediscovered while its entry exists, which shows grep-on-demand
  isn't reaching agents and answers have to be put in the dispatch brief instead; or
- that Action lands anyway.

---

## Where is the live workspace and its database?

keys: workspace, database, sqlite, db path, arcadia.sqlite3, config

```sh
pnpm -s arcadia workspace resolve --json   # data.workspacePath
sqlite3 -readonly "<workspacePath>/database/arcadia.sqlite3"
```

Resolved from `~/.config/arcadia/config.json` (`defaultWorkspace`). Do not
`find` for `arcadia.sqlite3`: stale ones exist (e.g. `~/Arcadia/workspace`, old
schema) and throwaway test ones under `/tmp`.

## What happened to an Ask? (capture id → outcome)

keys: ask, capture, capture_, back burner, lost, shelved, dashboard ask, trace, trail

```sh
pnpm -s arcadia ask-trail <capture_…|request id|ask_…> [--json]
```

It prints the classification and reason, the routed Project, and every
Action, Decision, or Back Burner item the Ask produced. Rescue a shelved item
with `arcadia back-burner promote <bb_id>`, or plan it with an Agent Ask and
then `arcadia back-burner archive <bb_id>`.

## Show the ordered queue

keys: queue, order, position, revision, advance queue, next

```sh
pnpm -s arcadia advance queue --json | jq -r '.data.revision, (.data.ordered[] | "\(.projectSlug)/\(.actionId) \(.state) \(.planSlug)")'
```

`arcadia queue` is a different, grouped view with no revision. Use
`advance queue`.

## Settle an Agent Ask that adds Actions to the queue

keys: agent-ask, settle, apply, fingerprint, --after, --top, revision, proposal

Queue-placing Asks must settle from the **main checkout**, and the main
checkout must stay clean. So `draft` inside a worktree and settle by proposal id:

```sh
# in a worktree
pnpm -s arcadia agent-ask draft '<json>'
# in the main checkout: preview, which prints "Preview fingerprint: <fp>"
pnpm -s arcadia agent-ask settle --proposal <request_id> --request-id settle-<request_id> \
  --disposition accepted --responsibility agent --after <project>/<action> --revision <queue revision>
# same command plus: --preview <fp> --apply
git push origin main   # settlement commits locally and never pushes
```

`--request-id`, `--disposition`, and one of `--top/--before/--after` are all
required. A draft-Plan or log Ask places nothing in the queue and can settle
inside the worktree, so it ships with that PR.

`complete` and `decision` (and other non-queue-placing) intents settle inside
your own **candidate worktree** instead — no `--top/--before/--after`, no
main-checkout requirement — but still need both `--proposal <request_id>` and
`--request-id <settle-id>` (two different ids) plus `--disposition accepted`
just to get the preview/fingerprint; expect `USAGE_ERROR: required option
'--proposal'` or `'--request-id'` or `'--disposition'` in some order if you
guess the flag set instead of passing all three from the start.

## Publish a `/runs` action that settles an Agent Ask

keys: operator script, runs, agent-ask, settlement, fingerprint, plan amendment, retry

Use the shared settlement runner; fresh-preview and validate the pinned effects before applying the same fingerprint.
After a failure, reproduce the entire preview → apply → commit → publication path in a disposable workspace before offering a retry; shell syntax and descriptor checks are insufficient.
Include an untracked Ask archival case: preview `before` content can exist on disk without existing in the Git parent; validate its pinned bytes separately from tracked parent documents.
Changing only a stale queue revision/fingerprint does not repair the transaction. Expires when #830 closes.

## Operator action failed after settlement: was the work accepted?

keys: applied true, accepted, publication, LOCAL ONLY, failure handoff, operator script, process launch

Read the run's settlement receipt, failure handoff, publication receipt, and Git history separately: `applied: true` proves local acceptance, not publication or pointer advancement.
An absent publication receipt after an applied settlement is an unresolved publication stage; verify current remote state before claiming it is local only.
Preserve the accepted commit and failed run; recovery must validate the exact existing result rather than reapply acceptance or reset the button.
See `docs/reports/autonomous-production-session-friction-2026-10-02.md` for the untracked-Ask failure and exact retained receipts.

## Preserve exact generated-script preparation

keys: dirty main, recovery, ignored, generated script, force add, custody, test shim

Inspect `git status --porcelain`, `git ls-files` and `git check-ignore`: new generated pairs can be ignored while older pairs are tracked; normal explicit `git add` can refuse the ignored directory. Stage only named tracked paths with `-u`, and force-add only the reviewed new pair.
Preserve unrelated runtime receipts with exact hashes in ignored custody; inspect private metadata before choosing what a public recovery PR may contain.
Hermetic Git shims must pass through `-c` options unchanged; stripping `core.hooksPath` invalidates the hook-isolation test. See `docs/reports/three-action-managed-production-scope-design-2026-10-02.md` for the disclosed operator recovery boundary.

## `agent-ask draft` printed "Failed to auto-discover N files"

keys: auto-discover, already used with different content, draft noise

Ignore it when the listed files are old, already-settled Asks: it is a false
positive. Look only at the lines above it (`Agent Ask drafted`,
`Previewed: fingerprint`). Expires when #592 closes.

## Protected brief fails at `next` despite the correct Codex profile

keys: sandbox, brief broker, arcadia-unattended, SQLITE_WORKSPACE_WRITE_DENIED, readonly database, restart

Issue #836 reproduced a mismatch in installed broker release
`df6589f932b670960340acbda85d42f127439cb0`: `brief` called the host's journaled
`runNextCommand`, which opened SQLite read-write and initialized schema, while
the named sandbox excluded that shared database. Profile selection and restart
could not repair the code path. The corrected broker uses
`runNextReadOnlyCommand`, sharing canonical dispatch and operator gates with the
host command while making no schema or journal writes. Reinstall the reviewed
broker using the existing **Reinstall the protected go broker** `/runs` action.
Do not widen permissions, copy the database, or build a replacement reader in
the adopting Project. Shared Git writes likewise belong to host preservation.
Regression: `tests/dispatch-journal.test.ts`, sandbox-callable broker section.

## Claude Code sandbox: `pnpm arcadia` floods "failed to copy trust settings", or `next`/`work monitor` fail with SQLITE_WORKSPACE_WRITE_DENIED

keys: sandbox, trust settings, certificate, gh, TMPDIR, claude code, SQLITE_WORKSPACE_WRITE_DENIED, readonly database, pnpm arcadia next, dispatch brief

`gh` and `git push` always need to run outside the Bash sandbox. Most
`pnpm arcadia` calls do too, but **stay sandboxed by default and bypass only on
an actual failure**, per the sandbox's own reactive-only policy — never
pre-disable it for a whole worktree or session, since that also runs whatever
`src/cli.ts` and its command modules do with host access. Recognize the
symptom instead of guessing: a read-only-looking noun like `arcadia next` or
`arcadia work monitor` still opens the workspace SQLite db read-write (WAL
journal) and fails `Error [SQLITE_WORKSPACE_WRITE_DENIED]: ... attempt to
write a readonly database` inside the sandbox — that specific error is the
signal to retry the *same single command* with `dangerouslyDisableSandbox:
true`, not a reason to disable it ahead of time. The
sandboxed shell also has a **different `$TMPDIR`** from the unsandboxed one, so
a file written in one mode is missing in the other — write and read scratch
files in the same mode.

## Lint or tests fail in an agent worktree but not in CI

keys: lint, worktree, bridge, node_modules, discord.js, no-unnecessary-type-assertion, error type, vitest

Bridge dependencies with the script, never with a hand-made symlink:

```sh
node scripts/bridge-worktree-deps.mjs   # links root and every app's node_modules
```

A root-only `ln -s …/node_modules` leaves the `apps/dashboard` and
`apps/discord-bot` dependencies unresolved. Then `pnpm lint` reports false
errors ("`Message` is an error type", "assertion is unnecessary") and those
app tests fail to load, even in files you changed. The script skips a tree
whose target already exists, so rerunning it is safe. CI does a clean install
and is the source of truth.

## Where is the Runs page / "This push" section?

keys: runs, this push, next push, dashboard, production control panel

`apps/dashboard/app/runs/page.tsx` (sections: Operator actions, Active now,
Recent history) and `apps/dashboard/components/production-control-panel.tsx`
("This push" lanes and "Next push").

## Run one Vitest file without launching the whole suite

keys: vitest, focused test, pnpm test, double dash, whole suite

Use `pnpm exec vitest run tests/notes-to-self.test.ts` for this document's checks.
Here, `pnpm test -- tests/notes-to-self.test.ts` launched unrelated tests; avoid the extra `--` on this pnpm installation.

## Do not reuse a succeeded rehearsal Grant

keys: v6, Grant, recovery, rehearsal, literal split, browser close, ledger

The succeeded v6 recovery Grant and B candidate are consumed evidence, not a
shortcut for a new proof. `/runs` reads only the main-checkout library, so a
fresh Grant needs a reviewed merged pair, a new fixture/candidate, hermetic
replay, and a current-revision preview. The CLI-only control has no browser
close event; do not relabel worker restart as literal browser proof.
