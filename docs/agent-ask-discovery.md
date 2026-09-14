# Automatic discovery of unprocessed `.arcadia/asks/` files

This is the design note the `design-and-build-the-mechanism-that` Action's
acceptance criteria call for: where automatic discovery hooks in, and why.

## The problem

An Agent Ask can be drafted into `.arcadia/asks/agent-ask-<request_id>.yaml`
in an environment that has no Arcadia workspace at all — a bare cloud
container with only the `arcadia` binary and git, per `runAgentAskDraftCommand`'s
own doc comment. Nothing previews that file until *some* later command runs
in an environment where a real Project workspace resolves. `arcadia go` is
not that trigger: a manual handoff, a differently-triggered environment, or
an operator who never runs `go` at all can all leave a validly drafted file
sitting unprocessed indefinitely, discoverable only by someone remembering to
run `arcadia agent-ask preview --file <path>` by hand.

## Where discovery hooks in

`src/ask/discovery.ts` exports `discoverUnprocessedAgentAsks(db, repoRoot)`,
called from two places in `src/commands/agentAsk.ts`:

- `runAgentAskPreviewCommand`, after its own explicit preview succeeds.
- `runAgentAskDraftCommand`'s internal call into preview (draft always calls
  preview once a workspace is ready), so drafting one Ask also surfaces every
  *other* unprocessed one sitting alongside it.

Both are commands that already resolve a real Project workspace via
`resolveReadyWorkspace` as part of doing something else. Discovery piggybacks
on that resolution rather than requiring a dedicated "scan" command, which is
the actual fix for "`arcadia go` is not a reliable trigger": *any* successful
agent-ask command becomes the trigger, not one specific launcher.

### Why not hook the universal `resolveReadyWorkspace()` instead

`resolveReadyWorkspace` is called from roughly fifty command modules — nearly
every `arcadia` command that touches a workspace, including plain read-only
nouns like `status`, `next`, and `portfolio`. Hooking discovery there would
make a noun command have the side effect of writing new proposal and capture
rows to the database, which breaks this repository's own naming discipline
("nouns read state, verbs may mutate it", `AGENTS.md`). Scoping the hook to
the two agent-ask entry points that already write proposal state (preview,
and draft's internal preview call) keeps the mutation inside commands whose
job is already exactly this kind of write, at the cost of not firing from
unrelated commands — an acceptable trade named explicitly here rather than
left implicit.

### Repository root: `--dir`, not an assumption

`.arcadia/asks/` lives in the *repository*, not in the resolved workspace (the
workspace is a separate directory holding just the SQLite database — see
`resolveReadyWorkspace`). Both `preview` and `draft` already accept `--dir`
for this reason, and the CLI layer (`src/cli.ts`) already defaults it to
`process.cwd()` via commander, so a real invocation of either command always
has a concrete `dir` with no extra flag required from the operator or agent.

Discovery only runs when `options.dir` is a defined string. A caller that
resolves a workspace without saying which repository it lives in — every
existing unit test that exercises proposal logic directly, for instance —
simply doesn't get discovery, rather than have it guess `process.cwd()` and
risk scanning whatever repository the calling process happens to sit in. This
is what keeps discovery from becoming a source of test flakiness: tests that
want to exercise it pass an isolated `dir` explicitly (see
`tests/agent-ask-discovery.test.ts`), and every other test's behavior is
unchanged.

## What counts as "unprocessed"

`discoverUnprocessedAgentAsks` reuses the exact rule `previewAgentAskRequest`
already applies to an explicit `--file` preview: a request id not yet in
`agent_ask_proposals` is new and gets previewed; a request id already there
with an identical fingerprint is a silent no-op (not re-reported as newly
"discovered" on every subsequent command); a request id already there with a
*different* fingerprint is a genuine conflict. Extracting that rule into
`src/ask/preview.ts` (`previewAgentAskRequest`) makes both call paths — a
human or agent explicitly asking to preview one file, and discovery finding
one nobody asked about — judge content identically, rather than
re-implementing dedup logic twice.

## Failure reporting

A file that fails validation, or whose request id collides with different
already-known content, is never thrown past the calling command and never
silently dropped: it lands in the command's `data.discovery.failed` list and
is appended to that command's own rendered output every time the file is
still there and still failing. There is no separate failure queue to check —
whoever is looking at `agent-ask preview` or `agent-ask draft` output sees it.

## Deliberately out of scope: `agent-ask settle`

`settle` also resolves a workspace, but its repository root is not an ambient
`--dir` — it comes from `metadata.repo_path`, resolved per-project deep inside
`settleAgentAsk`'s own transaction, after the proposal (and therefore the
project) is already known. Wiring discovery there would mean deciding *which*
project's repository to scan before the settlement logic that currently makes
that determination has run. That is real follow-on work, not something this
pass silently skipped: the trigger for picking it up is an operator or agent
settling an Ask in an environment that never previously called `preview` or
`draft` for that repository, so nothing upstream already ran discovery.

## Test coverage

`tests/agent-ask-discovery.test.ts` proves discovery fires from both named
entry points (`runAgentAskPreviewCommand` and `runAgentAskDraftCommand`),
that an already-known file is not re-reported, that a validation failure and
a content-drift conflict are both reported rather than thrown, and that
omitting `dir` (or having no `.arcadia/asks/` directory at all) is a clean
no-op.
