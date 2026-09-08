# Prove zero-prompt production loop — operator runbook

Current milestone: Bootstrap managed production to build Flight Deck.
Current Action: `prove-zero-prompt-production-loop`.
Work classification: staged rehearsal runbook (no code changes — every command
below already exists on `main`; this document sequences them and defines the
fill-in evidence template the Action's acceptance criteria require).

## Why this is a runbook, not a completed rehearsal

This Action's acceptance criteria require the real host controller —
`arcadia go`, the worker daemon, and the protected go-broker launchers — to
autonomously prepare worktrees, launch real Codex/Claude coding-agent
processes, and mutate shared Git state (branches, commits, pushes, draft PRs)
across two dependent Actions from one activation, with zero observed sandbox
prompts. The `arcadia-go` skill that governs every coding-agent session
explicitly forbids reproducing that logic, or invoking the mutable `arcadia
go` launcher / worker, from inside a Codex or Claude Code sandbox — the exact
boundary this Action exists to prove. The session that staged this runbook
also confirmed it has no `ARCADIA_WORKSPACE`-independent path around that
boundary: the mutable commands here must run in a plain operator terminal, not
inside a coding-agent-managed worktree.

So this session built the fixture definition and the exact command sequence,
and this document is also the fill-in template for the proof Artifact the
Action requires. Run each numbered step in your own terminal (not inside a
Claude Code or Codex session), fill in the `Evidence:` blank under each step,
then hand the completed document back for settlement.

## Prerequisites

- `pnpm arcadia go-broker status --json` reports `READY` for both the default
  Codex profile and the named `arcadia-unattended` profile. If it does not,
  run `pnpm arcadia go-broker install` first (Step 8 repeats this later
  deliberately — do it now too so Steps 1-7 aren't rehearsing a known-broken
  install).
- A disposable throwaway directory outside any existing Arcadia-managed repo,
  e.g. `~/tmp/arcadia-zero-prompt-rehearsal`.
- Your normal workspace: wherever `pnpm arcadia production status` already
  resolves a workspace without `--workspace` (this runbook omits the flag;
  add it if your setup requires an explicit path).

## Step 0 — go-broker status

```sh
pnpm arcadia go-broker status --json
```

Evidence: _(paste the JSON; confirm `ready: true` and both profiles listed)_

## Step 1 — create the disposable Project and its two dependent Actions

1. Create and initialize the throwaway repository:

   ```sh
   mkdir -p ~/tmp/arcadia-zero-prompt-rehearsal
   cd ~/tmp/arcadia-zero-prompt-rehearsal
   git init
   git commit --allow-empty -m "chore: disposable rehearsal repo root"
   ```

2. Register it as a Project and produce its first planning Action:

   ```sh
   pnpm arcadia project prepare \
     "Zero Prompt Rehearsal" \
     "Disposable fixture project for the prove-zero-prompt-production-loop rehearsal. Two trivial file-edit Actions exist only to exercise the real host controller loop; delete this Project and repository after the rehearsal." \
     --path ~/tmp/arcadia-zero-prompt-rehearsal \
     --json
   ```

   Note the returned Project slug (expected `zero-prompt-rehearsal`) and the
   planning Decision id.

3. This produces one planning Action, not the two dependent Actions the proof
   needs. Rather than running a real planning Session for a fixture this
   trivial, replace the plan directly with an Agent Ask `plan` amendment —
   this is the documented existing path for retargeting a Plan (see
   `AGENTS.md` → "Asking Arcadia to change Project state" → intent `plan`),
   and it is the only content-shaping step in this runbook that writes
   governed state, so it goes through Ask rather than a hand edit.

   First find the drafted Plan's slug:

   ```sh
   pnpm arcadia plans --project zero-prompt-rehearsal --json
   ```

   Then preview and settle this amendment (adjust `target_ref` to the slug
   found above if it differs from `plan/zero-prompt-rehearsal-bootstrap`):

   ```yaml
   # agent-ask.yaml
   agent_ask: v1
   request_id: zero-prompt-rehearsal-two-actions-2026-09-08
   project: zero-prompt-rehearsal
   intent: plan
   target_ref: plan/zero-prompt-rehearsal-bootstrap
   desired_result: Replace the drafted planning Action with two small dependent Actions that exercise the real host controller loop end to end.
   actions:
     - id: write-rehearsal-marker
       desired_result: Add REHEARSAL.md to the repository root containing exactly one line, "zero-prompt rehearsal action A", plus a trailing newline.
       acceptance:
         - REHEARSAL.md exists at the repository root and its only content is "zero-prompt rehearsal action A\n".
       dependencies: []
     - id: confirm-rehearsal-marker
       desired_result: Append a second line to REHEARSAL.md reading "zero-prompt rehearsal action B", and add tests/rehearsal.test.mjs asserting the file contains both exact lines in order.
       acceptance:
         - REHEARSAL.md contains "zero-prompt rehearsal action A" on the first line and "zero-prompt rehearsal action B" on the second line, in that order.
         - tests/rehearsal.test.mjs exists, runs under `node --test`, and fails if either line is missing, reordered, or altered.
       dependencies:
         - write-rehearsal-marker
   ```

   ```sh
   pnpm arcadia agent-ask preview --file agent-ask.yaml --json
   # review the proposal, then:
   pnpm arcadia agent-ask settle --file agent-ask.yaml --apply --json
   ```

4. Set the Project's active pointer to this Plan and its first Action
   (`write-rehearsal-marker`) using whichever activation path
   `agent-ask settle`'s response names as the next step for a freshly
   accepted Plan — the CLI response is authoritative over this runbook if
   the two disagree, since command behavior can move after this was written.

Evidence: _(paste both `preview` and `settle --apply` JSON, and the resulting
Plan frontmatter showing `current_action: write-rehearsal-marker`)_

## Step 2 — scope the production policy to only this Project

```sh
pnpm arcadia production preview \
  --project zero-prompt-rehearsal \
  --concurrency 1 \
  --transitions validation,acceptance,pointer \
  --intent "Prove the zero-prompt production loop on a disposable fixture." \
  --json
```

Review the preview, then activate with the exact `--expect-revision` it
returned:

```sh
pnpm arcadia production activate \
  --project zero-prompt-rehearsal \
  --concurrency 1 \
  --transitions validation,acceptance,pointer \
  --intent "Prove the zero-prompt production loop on a disposable fixture." \
  --expect-revision <n> \
  --granted-by "<your name>" \
  --json
```

Evidence: _(paste preview + activate JSON; confirm `scope.projects` names only
`zero-prompt-rehearsal`, so no other Project can be admitted by this grant)_

## Step 3 — Phase 1: default interactive Codex profile (`approval_policy
on-request`)

This phase proves the *common path* produces zero sandbox approval prompts
under Codex's ordinary interactive profile — not the unattended override
Arcadia's own launch code uses. Prepare the worktree the same way `arcadia
go` would, then launch Codex manually without the unattended flags:

```sh
pnpm arcadia next --project zero-prompt-rehearsal --json   # confirms write-rehearsal-marker is dispatchable
```

Follow whatever this session's own dispatch used for worktree preparation
(`arcadia go --agent codex` without `--apply`, or the packet's documented
prepare step — use the exact command `arcadia next`'s response or the
existing Session-launch surface names) to create the isolated worktree, then
launch Codex against it with the **default** profile:

```sh
codex -C <prepared-worktree-path> -m <model> "arcadia advance"
```

Watch the session run to completion (it should build REHEARSAL.md, run any
build/test step, and hand off to `arcadia advance` → the protected broker
path this session used in Step 2 of its own dispatch). Record every approval
prompt Codex shows, if any.

Evidence: _(transcript or screen recording pointer; exact count of sandbox
approval prompts on the common path — acceptance requires zero)_

## Step 4 — Phase 2: the unattended profile Arcadia's own code uses

Same Action, but this time launch with the exact command
`buildAgentLaunchCommand` in `src/sessions/worktreePreparation.ts` generates
for Codex:

```sh
codex -c default_permissions="arcadia-unattended" --ask-for-approval never \
  -C <prepared-worktree-path> -m <model> "arcadia advance"
```

Under `--ask-for-approval never`, anything that would have prompted instead
hard-fails. Acceptance requires **zero permission failures**, which is a
stronger claim than "no prompts appeared" — it means nothing the loop needed
to do was ever gated behind approval in the first place.

Evidence: _(exit code and full output; confirm no permission-denied or
sandbox-EPERM failures)_

## Step 5 — the full autonomous loop from one activation

With the production policy from Step 2 still active, start the worker and let
it run both Actions without further manual intervention:

```sh
pnpm arcadia worker start
pnpm arcadia worker status --json   # poll until write-rehearsal-marker completes
```

Confirm, without manually launching anything else:

- `write-rehearsal-marker` is admitted, launches, builds, preserves its
  branch, opens a draft PR, and is marked done with the pointer advancing to
  `confirm-rehearsal-marker` — all through the worker's own reconciliation,
  not a second manual `arcadia go --apply`.
- `confirm-rehearsal-marker` launches automatically once
  `write-rehearsal-marker` is done, with no new human Session setup or
  launch click.

Evidence: _(worker status JSON at each transition; the two branch names,
commit shas, and draft PR URLs; confirmation both launches came from the
worker, not a manual `arcadia go`)_

## Step 6 — turn production Off mid-flight

While `confirm-rehearsal-marker` is still running (mid-Session, before it
completes):

```sh
pnpm arcadia production deactivate --reason "prove-zero-prompt-production-loop: Off during Action B" --json
pnpm arcadia production status --json
```

Confirm:

- No new admission occurs after this point.
- `confirm-rehearsal-marker`'s already-committed work is not lost — its
  worktree, branch, and any partial commit remain recoverable.
- `arcadia work monitor --no-pull-requests` shows bounded, visible
  reconciliation for that Session rather than silent abandonment.

Evidence: _(deactivate + status JSON; work-monitor output for the affected
worktree)_

## Step 7 — worker restart: no duplicates

```sh
pnpm arcadia worker stop
pnpm arcadia worker start
pnpm arcadia worker status --json
```

Confirm no duplicate commit, branch, or pull request was created for either
Action after the restart, and that reconciliation of any still-open Session
from Step 6 is idempotent (running it again produces the same receipt, not a
second one).

Evidence: _(before/after commit shas and PR list for both Actions; explicit
confirmation of no duplicates)_

## Step 8 — repeat after reinstall and from a fresh worktree

```sh
pnpm arcadia go-broker install --json
pnpm arcadia go-broker status --json
```

From a newly generated worktree (not one left over from Steps 3-7), repeat
Step 0's status check and one small dispatch (reuse a disposable Action, or
create a third trivial one via the same Agent Ask `plan` amendment path as
Step 1) to prove the install is idempotent and `go-broker status` still
reports `READY`. Deliberately break one required root or profile setting
first (e.g. rename `arcadia-unattended.config.toml` aside) and confirm
`go-broker status` fails closed — names the exact missing piece — rather than
reporting `READY` from a stale cache. Restore it and confirm `READY` returns.

Evidence: _(install output; status before/after the deliberate break; status
after restore)_

## Step 9 — the boundaries that must still hold

Confirm, and record how you confirmed, that none of the following happened
anywhere in Steps 1-8 without a separate explicit approval:

- merge of either draft PR
- deployment or publication
- paid-capacity use or reset redemption
- credential expansion
- destructive cleanup (deleting the disposable repo does not count — that is
  operator cleanup after the rehearsal, not something the loop did itself)
- any network access unrelated to the declared Git/PR path

Evidence: _(explicit statement for each of the six)_

## Step 10 — settle

Once every `Evidence:` blank above is filled with real output, this document
*is* the proof Artifact the Action's `expected_artifact` names. Bind it with
an Agent Ask `intent: complete`, `candidate_revision` set to this repository's
revision that carries the completed runbook, and one `met`/`failed`/`skipped`
evidence line per acceptance criterion in
`docs/plans/bootstrap-managed-production-to-build-flight-deck.md`'s
`prove-zero-prompt-production-loop` entry, citing the step above that proves
it.

Delete `~/tmp/arcadia-zero-prompt-rehearsal` and its registered Project only
after settlement — the draft PRs and branches are the primary evidence until
then.
