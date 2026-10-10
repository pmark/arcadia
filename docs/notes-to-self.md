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

## Why does a public Docker image pull hang?

keys: Docker, pull, credential-desktop, Chromium, Lighthouse, 847

From the host: `docker --config "$(mktemp -d)" --host "unix://$HOME/.docker/run/docker.sock" pull mcr.microsoft.com/playwright:v1.61.1-noble` prints layer progress and an immutable digest.
Gotcha: the default config can stall in `docker-credential-desktop get` even for public MCR images; the fresh empty config avoids it without reading credentials.
Runtime must use the reviewed local SHA256 image ID with `--pull never`. See `docs/reports/issue-847-container-route-2026-10-02.md`; expires when #847 closes.

## How do I preserve a revised manual candidate without widening authority?

keys: 878, manual preservation, snapshot identity, fixed launcher, replay, LOCAL ONLY

Run only `/Users/pmark/.local/bin/arcadia-preserve-broker-codex` with no arguments from the registered candidate; a revised validated tree must get a distinct `preserve:<reservation>:<tree>` identity and an unchanged retry reuses its receipt.
Gotcha: if an older installed runtime returns the reservation-only identity or refuses the revised candidate, retain that exact receipt/refusal; do not raw-commit, install, restart, or alter production/PPN to work around it.
The hermetic fixed-launcher proof is retained with the host receipts; an explicit operator recovery exception may preserve exact pending docs and reconcile canonical Log appends, retaining both histories. See `docs/reports/issue-878-manual-preservation-continuation.md`; this older-runtime workaround expires after the reviewed repair is installed.

## Preserve launcher failed with a git timeout, or left the candidate staged

keys: 889, 896, preserve, broker, launcher, timeout, ETIMEDOUT, PRESERVATION_GIT_TIMEOUT, PRESERVATION_INDEX_LOCKED, read-tree, index.lock, index_locked, index_lock_malformed, holderPids, staged, retry, managed tick

A fixed runtime refuses with `PRESERVATION_GIT_TIMEOUT` (`retryable: true`, `reason: timeout`; details name the command, `gitSubcommand`, `args`, `cwd`, `timeoutMs`, `stage`, `remedy`): follow the stage-aware remedy and rerun the same launcher unchanged; it reuses the request id and recovers an existing commit by trailer. A timed-out `gh pr create`/`edit`: check `gh pr view <branch>` first. Timeouts skip the refusal budget; 10 identical ones stop automatic retries. The CLI and the managed tick share that budget per Session id (#896). A blocked lock is `PRESERVATION_INDEX_LOCKED`, never a timeout, on its own 10-attempt limit: `index_locked` (retryable) or `index_lock_malformed` (`retryable: false`: a directory or symlink; remove it by hand, then rerun). An old lock is kept while any process holds it open (`holderPids`), a probe cannot tell, or any Git process runs in the candidate (a `git fsmonitor--daemon` too: `git -C <candidate> fsmonitor--daemon stop`).
`liveness: changed` = the lock's inode/mtime moved between the probes and removal (another preservation): rerun. `holderProbeWarning` is lsof's stderr behind an `unknown`. Held-open never protects an editor-waiting `git commit` (its lock fd is closed); only the Git-cwd probe does (#913).
Gotcha: an older installed runtime instead says `UNEXPECTED_ERROR`/`spawnSync git ETIMEDOUT`, "base branch could not be resolved" or "not a forward advance", and a refusal after `preserve.snapshot` left ` M` as `M ` in the real index. Retain that receipt and the staged index; never raw-commit or reset. Per-call bound: `ARCADIA_PRESERVATION_GIT_TIMEOUT_MS`, a positive integer (default 90000, capped at 120000 under the 150000 stage watchdog).
The fix is live only after the separate reviewed **Reinstall the protected go broker** `/runs` action (managed tick: after the host-services recovery restarts the worker). Regressions: `tests/preservation-git-timeout.test.ts` (and its `-stages`, `-commit-stages`, `-base` siblings), `tests/preservation-index-lock.test.ts`, `tests/candidate-preservation.test.ts`.

## Go refused or resumed a never-launched candidate holding only Agent Ask drafts

keys: 884, draft-only, never launched, orphan candidate, already holds uncommitted changes, candidateKind, disposition, candidate_draft_recoveries, liveness, lsof, handed out

Go and the managed tick (same rule) hand the worktree and branch out ONCE when its only dirt is `??` `.arcadia/asks/agent-ask-*.yaml` drafts, no Session row or `.arcadia-go-request`/`.arcadia-preserve-request` shows a session ran, HEAD equals the current local base tip, the claim is its own and the host probe (`/proc`, else `lsof`; `src/sessions/worktreeLiveness.ts`) finds no process with its cwd inside. `data.draftRecovery` is the receipt in `candidate_draft_recoveries`: hashes and origin only; the drafts stay on disk. `resumed_at`/`resumed_route` mark the handout, voided if the launch fails before a Session row exists.
Anything else draft-only refuses with `details.disposition` (receipt id, `handedOut`, drafts, next step); a probe that cannot tell refuses too. Base check is against local base: once main moves the candidate must be re-prepared. Residual risk: the probe cannot see a session whose cwd is outside the worktree or another user's process; the one-shot marker bounds it. Other dirt keeps "already holds uncommitted changes" + `details.candidateKind`. Do not widen `uncommittedChanges`. Code: `src/sessions/draftOnlyCandidate.ts`.

## Where is the live workspace and its database?

keys: workspace, database, sqlite, db path, arcadia.sqlite3, config

```sh
pnpm -s arcadia workspace resolve --json   # data.workspacePath
sqlite3 -readonly "<workspacePath>/database/arcadia.sqlite3"
```

Resolved from `~/.config/arcadia/config.json` (`defaultWorkspace`). Do not
`find` for `arcadia.sqlite3`: stale ones exist (e.g. `~/Arcadia/workspace`, old
schema) and throwaway test ones under `/tmp`. With
`ARCADIA_REQUIRE_INLINE_WORKSPACE=1` on, that fallback is refused:
`data.workspacePath` is null and `data.refused` names the default it would
have used; any other uninlined command fails `INLINE_WORKSPACE_REQUIRED`.

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

## Brief launcher returned `BRIEF_DEADLINE_EXCEEDED` (or seemed to hang)

keys: brief broker, hang, timeout, deadline, correlationId, stage, recovery, BRIEF_DEADLINE_EXCEEDED, go-broker status

The fixed brief supervises itself: one JSON document on stdout within 25s.
A failure names `error.details.stage`, `correlationId` and `recovery`; it is read-only, so rerun the same launcher once.
`work-monitor` = many worktrees or a hung git; `advance`/`next` = a SQLite lock. Never run mutable `next` or widen the sandbox.
Older releases lack this until the reviewed **Reinstall the protected go broker** `/runs` action (their status self-test runs one real read-only brief and reports NOT READY); then `Brief supervisor: READY`.
Code: `src/briefSupervisor.ts`; proof: `tests/brief-supervisor.test.ts`.

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

## Accept a draft Plan before activating it

keys: editor, draft Plan, acceptance, activation, --activate, responsibility, target_ref

Untargeted `intent: plan` creation accepts an **inactive draft**; it cannot activate that Plan in the same settlement.
Then draft a separate `intent: plan` Ask with `target_ref: plan/<slug>` and no Action amendments.
Preview activation with `--activate --action <id> --model <model> --effort <level> --top`; omit `--responsibility`, which makes activation refuse as an amendment.
Apply only with operator authority and that exact preview fingerprint; preserve unfinished work in the previous Plan.

## Check the operational queue after settlement commits

keys: activation, operational sync, Batch order, database locked, orderValid, unpositionedCount

`applied: true` and `documentsCommit` prove the managed documents landed, even when operational sync subsequently fails; retain the receipt rather than accepting or activating again.
Run `arcadia docs sync --project <slug> --apply --json`; a transient database lock warrants a bounded retry of that same command.
Inspect `arcadia advance queue --json`: require `orderValid: true`, `unpositionedCount: 0`, and the intended selected Action and positions.
If batch repair is needed, preview/apply canonical `advance queue arrange` at the current revision, retaining every approved key and every other Project's relative order; never edit SQLite or infer success from exit code alone.

## Recover a primary checkout without guessing authority

keys: primary checkout, beta branch, recovery Ask, non-agent-owned, merge conflict, hooks, prepared worktree

Check the clean primary branch, worktree inventory, and local-only commits first: protected Go refuses an ordinary beta branch, and an ad hoc reviewed worktree may have no registered host route.
An `intent: proposal` recovery Ask preserves evidence; accepting it does not execute recovery. Use protected Go first; any manual exception requires explicit operator authority and preservation of every history.
For the authorized PPN overlap, the merged Plan already contained the beta Action marked done: retain both histories and take the exact landed records, rather than writing new completion state or resetting away commits.
Keep normal Git hooks enabled. Verify the recovered tree against the landed commit, publish authorized settlements, then rerun protected Go; hand off its exact returned path with `arcadia advance`, model, effort, and required profile.

## Test operator scripts behaviorally outside the agent sandbox

keys: operator script, bash, ERR trap, BASH_SUBSHELL, /dev/fd, process substitution, receipt, fake gh, fake mise, fixture, docs sync, passthrough, stub codex, codex app-server, headless provider, test-headless-provider-single-action

The library's `exec > >(tee -a "$LOG")` needs `/dev/fd`, which the agent sandbox denies (`/dev/fd/62: Operation not permitted`): the script exits before writing any receipt. Run `tests/three-action-rehearsal-operator-scripts.test.ts` unsandboxed.
Under `set -E` an ERR trap also runs inside `$(...)` and wrapper subshells, even when the parent handles the failure with `||` or `if`; return early when `BASH_SUBSHELL > 0` so only the top-level shell writes the receipt and handoff. Host bash is 3.2: no associative arrays, and avoid heredocs inside `$(...)`.
A fake CLI that `process.exit`s right after `process.stdout.write` truncates a pipe answer over 64 KB (the real `advance queue --json`: `jq: parse error: Unfinished string`); set `process.exitCode` and return instead.
A generated managed document is judged by real Arcadia code, never a canned `errorCount`: the fake's `{ passthrough: "probe" | "cli" }` reply runs the checkout's code (G1's fixture once hid invalid YAML behind a faked docs sync).
A stub `codex`/`opencode` must exit quietly unless `args[0]` is `exec`/`run` (and answer `codex exec --help` with `--json --sandbox`, which the launch preflight checks): Arcadia's capacity probe spawns `codex app-server` with the PATH `codex` in the checkout's directory (an always-acting stub once committed a MARKER.md on the checkout's branch). The headless-provider test keeps its experiment workspace in `$TMPDIR`, not `workspaces/exp-*`, because Codex's workspace-write sandbox can write the temp directory and not the workspaces directory; its provider-side `arcadia` shim pins that workspace. A Codex workspace-write sandbox cannot create Git's `index.lock` even in a gitdir under `$TMPDIR` (`.git` stays read-only inside writable roots), so the commit is the host's job: the test then runs `runPreserveCommand` (the manual-handoff path after reconcile; the worker's leased path needs an Active production policy that an experiment workspace cannot hold, and the Seatbelt validation cannot nest inside the agent sandbox), falling back to "PASS (agent); host preservation not exercised". OpenCode `run` auto-rejects any `external_directory` prompt, and its allowlist in `~/.config/opencode` omits `/private/var/folders`, so the test grants its own tree through `OPENCODE_CONFIG_CONTENT`. Codex persists `[projects."<repo>"] trust_level = "trusted"` to `~/.codex/config.toml` for a new project directory (it showed as a changed `hashes.codexConfig` in the leak check, ruled by the operator on 2026-10-09 to be neither attributed nor a Decision 0082 stop condition (the test now reports it as "Codex trust entry (operator ruled 2026-10-09: not a stop condition)"); any other leak-check change, including Claude's `hashes.claudeTrust`/`claudeSettings`, is still a possible stop condition to attribute); the test passes a per-invocation `--config projects."<path>".trust_level="trusted"` for its own paths to try to avoid the write (unverified until a run), and `codex exec` also has `--ignore-user-config` and `--ephemeral`, untried. The library checker refuses an operator `.sh` whose text names the Agent Ask command without a declared settlement, so `test-headless-provider-single-action` keeps its logic in `scripts/headless-provider-test.ts`; `mise exec` writes a trust link the agent sandbox denies, so test that entry with `node --import tsx` and the launcher with a fake `mise`. The test now tries Codex, OpenCode and Claude independently (a missing precondition SKIPs only that provider); Claude runs the builder's exact argv (`--print --output-format stream-json --verbose --permission-mode acceptEdits --settings <per-session file> --setting-sources ""`), its allow list carries only the Project's registered validation command (`node scripts/check-fixture.mjs`) and `arcadia agent-ask draft`, so it cannot commit and the host step commits (its result event's `permission_denials` is the evidence); a stub `claude` must answer `--help` with the six headless flags and `auth status --json`, and a model already bound in another tier cannot be a light-tier override (ambiguous identity), so `--model-<provider>` selects that tier via `sessionStartTier` instead.

## Re-run a passed Action on a reused fixture

keys: rehearsal run 2, rehearsal run 3, rehearsal run 4, rehearsal run 5, rehearsal run 6, chain set, parameter file, UNFILLED, reset, amend Action, requirement input revision, attempt_retry_not_authorized, docs sync skipped, older than the record, superseded candidate, Action claim, Transition: decision, pending Agent Ask, operator_gate_pending, Issue 968, Issue 997

A passed development attempt is never relaunched for the same input. `requirementIdentity` hashes `next_action`, the acceptance criteria, the responsibility and the execution; editing the title changes nothing. Docs sync skips a Plan whose `updated:` date is older than the synced record, and its JSON still reports `errorCount: 0`, so also bump `updated:` and require the Action's change to be `update` (`unchanged` only when resuming an already-synced reset).
A finished, unmerged candidate from the earlier input used to stop dispatch twice: the tick's terminal handoff deferred every admission, and the Action claim refused the new worktree. Both now skip it only when the worker preserved it and its own passed attempts are all for a superseded input (`developedForSupersededInput`). See `tests/rehearsal-run-2-amended-action.test.ts`.
An equal `updated:` date applies (day-granular `stalenessOf` in `src/docs/sync.ts`); only an older one is skipped.
A pending (unsettled) Agent Ask proposal naming the selected Action makes `resolveProjectTransition` answer `Transition: decision`, and the tick launches nothing (#968; run 2 lost 33 minutes); since #997 `production status` shows it as one `operator_gate_pending` entry with the settle command or the reason it cannot settle. Read it with `arcadia agent-ask pending`; the run-3 reset rejects only run 2's own one (the run-4 reset only run 3's, the run-5 reset only run 4's), and only while it is pending, and refuses any other. See `tests/rehearsal-run-3-amended-action.test.ts` to `tests/rehearsal-run-5-amended-action.test.ts`.
Run 4's Plan says `updated: 2026-10-05`, so a reset on a later UTC day bumps the date line; the run-5 tests prove that bump (and the reopening of a `done` record) with the real docs sync. Pin the records' `updated_at` before such a test so it stays valid on any later day.
From run 6 on, do not clone a run-N set: write `artifacts/generated/operator-scripts/rehearsal-chain/params/<run-id>.json`, render with `scripts/render-rehearsal-chain-operator-scripts.ts`, and preview the reset with `--dry-run` (runbook section 5). The chain reset refuses a pending fixture proposal instead of settling it. In its jq, `all($ids[]; ...)` rebinds `.` to each id: bind the document first (`.x as $changes | all($ids[]; ...)`), or every check silently compares against a string (`Cannot index string`).

## Rehearsal G6 receipt voided, or G8 refused "launch this action through /runs or from an interactive host terminal"

keys: rehearsal, G6, G7, G8, preflight voided, arcadiaHead, brokerRevision, freeze, non-interactive, TTY, Terminal panel, launch_context

G7 accepts a G6 receipt only while `arcadiaHead` equals main now and `brokerRevision` the installed broker now: any push to Arcadia main (even a governed settle commit) or reinstall/restart (an accidental G8 press) between G6 and the G7 press voids it. Run 2's G6 was rerun twice for that; push nothing from G6 until the press.
G8 refuses at `launch_context` when stdin is not a TTY and no `/runs` context is set, so an agent's or script's shell cannot run it; run it from the Terminal panel or `/runs`. That refusal runs no Arcadia command, and the run-3, run-4 and run-5 resets ignore such receipts when they look for the previous run's terminal Off.

## Reproduce a rehearsal defect offline before a live run

keys: fast rehearsal, fast-rehearsal, harness, live run, rehearsal loop, scripted executor, fake gh, it.fails, expected failure, Issue 987, Issue 989, long chain, nine-Action, Grant expiry, operator launch, olauth, Launch, /production, preview-launch, planning_required, build_packet_approval_pending, work plan, haiku, light tier, OAuth expired, failed_execution, incomplete_resumable, agent-ask draft, completion recipe, fixture reset, request id used, run 8, services restart, ARCADIA_WORKSPACE, self-approval, approval queue

Run `mise exec -- pnpm fast-rehearsal` unsandboxed before any live run and after changing the tick, preservation, review steps or settlement (a few minutes; the nine-Action chain files dominate): the real worker tick and settlement with only tmux, GitHub, the reviewer models and the agent faked; it prints per-phase timings and every error and writes `report.json` to a temporary directory. Reproduce a live defect there first (`tests/fast-rehearsal/README.md`, "Add a scenario").
Its `it.fails` tests are open defects: the fix that flips one changes it to `it`.
A long serial chain's likely stop is the Grant's 12-hour expiry: an Action finishing after it is preserved but never readied, reviewed or integrated, now shown as `terminal_candidate_not_integrable` "The integration grant expired at ..." (it showed nothing before); see `long-chain-grant-expiry.test.ts`.
A zero-finding non-pass reviewer verdict ("variance", Issue #1018) is rerun by the tick up to 3 attempts per kind per head (`MAX_VARIANCE_REVIEW_ATTEMPTS`, counted from lineage receipts' `variance`); `world.github.verdict` returns `"variance"` to simulate it (`serial-verdict-variance.test.ts`); the gate's own "code-review: failed; qa: none" wait line during a rerun needs `world.expectError`.

Live single-Action run on a fixture (operator Launch, 2026-10-09):
- Prove the path on a one-line fixture Action first. The Plan's current Action can be large (`preserve-unchanged-baseline-skill-symlinks` has five security-sensitive criteria); count its criteria before offering it for a live proof.
- A fresh Action's preview is `planning_required` until `arcadia work plan <work-id>` prepares its packet (the tick does this automatically), and then `build_packet_approval_pending` until the operator approves the packet. Only then does Launch work.
- `claude auth status --json` reports `loggedIn: true` while a dead OAuth refresh token is still in the keychain; the session then fails in under a second with "OAuth session expired and could not be refreshed" and uses up the one-shot authorization (Decision 0096). Since #1159 the exit reason says "Provider sign-in failure". The preflight half is #1155. `claude setup-token` into the workspace token file outlives `claude auth login`.
- The rehearsal fixture's Action text names a per-run completion request id. After a run settles or uses it, reset with the next run's chain reset (`reset-rehearsal-chain-fixture-<run-id>.sh --dry-run` first; it refuses until the checkout's main is level with origin). The reset takes about a minute.
- A headless light model given only "`arcadia agent-ask draft` it instead" fought refused git calls and hand-wrote a non-canonical Ask, and the host committed it into the preserved candidate (#1162). Since #1163 the brief carries one exact `agent-ask draft` command with the criteria prefilled, and draft refuses unfilled `<REPLACE:` notes.
- Read a headless Claude log by parsing `.arcadia/sessions/<id>.log` as stream-json: `assistant` tool_use entries, `user` tool_result errors and the final `result` (`is_error`, `permission_denials`).
- Before #1161 the worker logged every superseded terminal candidate on every tick (651k lines); filter `superseded input of its Action` when reading older `worker.log`.
- `scripts/services.sh restart` from the checkout refuses without an inline `ARCADIA_WORKSPACE=<live workspace>` and leaves the old services running.
- An agent cannot settle its own Agent Ask (the auto-mode classifier denies it as self-approval). The operator accepts it in the approval queue on /runs, then answers the Decision it opens (Discord or /review).
- The desktop app's built-in browser pane blocks the dashboard's `/_next` assets (`ERR_BLOCKED_BY_CLIENT`), so pages look empty there; check with `curl` against `127.0.0.1:3020` instead.
- A rehearsal handoff prompt (runbook section 10) goes stale within a day: before acting, `git log` the runbook, `rg -l -i "chain|rehears" docs/decisions` for Decisions answered since (0097 retired stacked chains on 2026-10-09), list open PRs and ask the peer session that last held the fixture. A fix a prior release manager left as a dirty open PR (#1033) is cheaper to port with `git apply --3way` onto fresh main than to rebase.
