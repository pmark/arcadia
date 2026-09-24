# Notes To Self

Indexed answers to things agents here keep re-deriving. **Grep before you dig:**

```sh
grep -n -i -B2 -A25 "keys:.*<word>" docs/notes-to-self.md
```

Every entry has a `keys:` line of the words you would search for, so one grep
lands on the answer instead of a codebase sweep. `docs/AGENT_ORIENTATION.md`
explains *how the system is built*; this file answers *how do I do X right now*.

## The rules

1. **Look first.** Before searching for a path, command, flag, id, or database,
   grep this file.
2. **Pay it forward.** If something took more than two failed tool calls to
   learn and the answer is stable, add an entry in the same change. Five lines
   max: the exact command, what it prints, and one gotcha.
3. **Fix on contact.** If an entry is wrong, correct it in the change that
   found out. A stale note costs more than having no note.
4. **Workarounds expire.** An entry that works around a defect names its Issue
   (`expires: when #NNN closes`). The PR that closes that Issue deletes the
   entry. Friction should end up fixed in code, not written up in notes.
5. **Graduates to `arcadia learn`.** When the `build-agent-agnostic-learning-loop`
   Action lands, these entries migrate into lesson records and this file
   becomes that command's seed. Until then, plain grep is the index.

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

keys: ask, capture, capture_, back burner, lost, shelved, dashboard ask, trace

Expires when #591 closes (a command for this). Until then, the downstream rows
carry neither the capture id nor its request id; only the raw text links them.
Identical text submitted twice is ambiguous, so also match `created_at` to within
a second of the capture's `captured_at`:

```sql
SELECT original_text FROM ask_capture_envelopes WHERE id = 'capture_…';
SELECT id, resolved_intent, output_kind, stewardship_json FROM ask_requests WHERE raw_request = '<text>';
SELECT id, classification, confidence, reason, status, project_id FROM back_burner_items WHERE original_input = '<text>';
```

Rescue a shelved one with `arcadia back-burner promote <bb_id>`, or plan it
properly with an Agent Ask and then `arcadia back-burner archive <bb_id>`.

## Why did the Ask classifier shelve a real request?

keys: classify, classification, idea, hedge, could, maybe, back burner, intake

`classifyDeterministically` in `src/intake/index.ts`. When no earlier branch
matches (a resolved `CreateWork`-style intent, a bug report, a question, and so
on), a hedge word (`could|maybe|might|idea|consider|worth|…`) *anywhere* in the
text makes it an `Idea` → Back Burner. A plain imperative such as "Improve X"
resolves to no intent, so one incidental "could" shelves it. Expires when #589
closes.

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

## `agent-ask draft` printed "Failed to auto-discover N files"

keys: auto-discover, already used with different content, draft noise

Ignore it when the listed files are old, already-settled Asks: it is a false
positive. Look only at the lines above it (`Agent Ask drafted`,
`Previewed: fingerprint`). Expires when #592 closes.

## Claude Code sandbox: `pnpm arcadia` floods "failed to copy trust settings"

keys: sandbox, trust settings, certificate, gh, TMPDIR, claude code

Arcadia CLI calls, `gh`, and `git push` need to run outside the Bash sandbox. The
sandboxed shell also has a **different `$TMPDIR`** from the unsandboxed one, so a
file written in one mode is missing in the other. Write and read scratch files
in the same mode.

## Where is the Runs page / "This push" section?

keys: runs, this push, next push, dashboard, production control panel

`apps/dashboard/app/runs/page.tsx` (sections: Operator actions, Active now,
Recent history) and `apps/dashboard/components/production-control-panel.tsx`
("This push" lanes and "Next push").
