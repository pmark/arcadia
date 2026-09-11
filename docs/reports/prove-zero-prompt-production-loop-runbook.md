# Prove zero-prompt production loop — operator runbook and proof template

Milestone: Bootstrap managed production to build Flight Deck.
Action: `prove-zero-prompt-production-loop`.
Work classification: operator-run rehearsal. No Arcadia code changes — every
command below already exists on `main`. This document sequences them and is
also the fill-in proof Artifact the Action's third acceptance criterion names.

## Why this is a runbook and not a completed rehearsal

The Action's acceptance requires the **real host controller** to prepare
worktrees, launch real coding-agent processes, and mutate shared Git state
across two dependent Actions from one activation, with zero observed sandbox
prompts and **zero hidden interventions**.

Two independent things put that outside an agent session:

1. The `arcadia-go` skill that governs every coding-agent session forbids
   invoking the mutable `arcadia go` launcher or the host `go` controller from
   inside a Codex or Claude Code sandbox. That boundary is the thing under
   test; an agent stepping around it would invalidate the proof.
2. `go-broker install` deliberately withholds the host-controller executable
   from both agent allowlists — see the comment at
   `src/agentSetup/goBrokerAgentSetup.ts:203`. Only `advance`, `preserve`, and
   `work-monitor` are agent-callable. `go` is the operator's.

An agent driving the loop would itself be a hidden intervention. So the run
below belongs in a plain terminal, and this document is what you fill in as
you go.

## Scope: happy path only

Agent Ask `split-zero-prompt-loop-happy-path-2026-09-10-v3` split this Action
in two. Mid-flight `production deactivate`, worker restart without duplicates,
reinstall idempotence, and deliberate fail-closed breakage all moved to
`harden-zero-prompt-production-loop`, which runs **after** this happy path has
run clean twice. Do not run them here; they are no longer this Action's
acceptance.

The three criteria this run must satisfy, verbatim from
`docs/plans/bootstrap-managed-production-to-build-flight-deck.md`:

1. Use the Zero Prompt Rehearsal fixture Project with two dependent small
   Actions and the same Codex profile, protected launchers, workspace root,
   dependency bridge, build, test, SQLite, Git, network and pull-request path
   that managed production will use.
2. From one activation, Arcadia prepares Action A's worktree, advances and
   monitors it, edits, builds, tests, preserves its exact branch and draft pull
   request, reconciles evidence, advances the governed pointer, and starts
   Action B without a sandbox approval prompt or manual Session relay.
3. One proof Artifact records every command, profile, writable root, sandbox
   denial, approval event, worktree, branch, revision, Session, Action,
   validation result, commit, push, pull request and operator intervention for
   this single run; zero observed prompts and zero hidden interventions are
   acceptance conditions.

## State verified 2026-09-11 — do not rebuild the fixture

An earlier draft of this runbook told you to create the fixture. That work is
done and pushed; re-running it would fork the Project. Confirmed on this host:

| Fact | Verified value |
| --- | --- |
| Fixture repository | `~/tmp/arcadia-zero-prompt-rehearsal`, clean, `main` |
| Fixture remote | `https://github.com/pmark/arcadia-zero-prompt-rehearsal.git`, `main` pushed |
| Project | `zero-prompt-rehearsal`, active |
| Active plan | `zero-prompt-rehearsal-bootstrap`, active |
| Pointer | `current_action: write-rehearsal-marker` |
| Action A | `write-rehearsal-marker` — open, no dependencies |
| Action B | `confirm-rehearsal-marker` — open, `depends_on: [write-rehearsal-marker]` |
| Fixture progress | `REHEARSAL.md` does not exist yet; neither Action has run |
| Production policy | **Inactive**, revision 0, epoch 0 |
| Broker | `READY`, pinned at `f2a377e` |
| Arcadia `main` | `4a49b8c` |

The last two rows are the one prerequisite defect: the installed broker is
pinned five merges behind `main`. Step 0 repins it.

## Step 0 — repin the broker, then confirm READY

The broker runs a frozen copy of Arcadia taken at install time. Rehearsing
against `f2a377e` would prove a controller that is not the one `main` ships.
From the Arcadia repository on `main`:

```sh
pnpm arcadia go-broker install --json
pnpm arcadia go-broker status --json
```

`status` must report `ready: true` and a `revision` equal to `main`'s HEAD.
If `ready` is false it names the exact missing root, profile, or guardrail —
fix that before going further rather than rehearsing a known-broken install.

Evidence: _(paste both JSON blocks; state the revision before and after, and
confirm it now matches `git rev-parse HEAD` on `main`)_

## Step 1 — confirm the fixture preconditions, do not recreate them

```sh
cd ~/tmp/arcadia-zero-prompt-rehearsal
git status --short          # expect: empty
git log --oneline -1
ls REHEARSAL.md             # expect: No such file or directory
cd -
pnpm arcadia next --project zero-prompt-rehearsal
```

`next` must resolve `write-rehearsal-marker` as dispatchable with no blockers.
If it resolves anything else, stop: the pointer moved since this was written
and the run would not prove what the criteria describe.

If `REHEARSAL.md` does exist, a previous rehearsal left state behind. Reset
the fixture to its initial commit before continuing, or the run passes for the
wrong reason.

Evidence: _(paste the four outputs; confirm clean tree, no `REHEARSAL.md`,
and `write-rehearsal-marker` dispatchable)_

## Step 2 — scope the standing production policy to this Project only

```sh
pnpm arcadia production preview \
  --project zero-prompt-rehearsal \
  --concurrency 1 \
  --transitions validation,acceptance,pointer \
  --intent "Prove the zero-prompt production loop on a disposable fixture." \
  --json
```

Read the preview. `scope.projects` must name `zero-prompt-rehearsal` and
nothing else — this grant must not be able to admit Arcadia's own work or any
other Project. Then activate with the exact revision the preview returned:

```sh
pnpm arcadia production activate \
  --project zero-prompt-rehearsal \
  --concurrency 1 \
  --transitions validation,acceptance,pointer \
  --intent "Prove the zero-prompt production loop on a disposable fixture." \
  --request-id prove-zero-prompt-production-loop-<yyyy-mm-dd> \
  --granted-by "P. Mark Anderson" \
  --expect-revision <n from preview> \
  --json
```

`--request-id` and `--granted-by` are required; `--expect-revision` is what
makes the grant refuse to apply if the policy moved between preview and
activate.

Evidence: _(paste preview + activate JSON; quote `scope.projects` and the new
revision/epoch)_

## Step 3 — one activation: prepare and run Action A

This is the activation the second criterion counts from. Everything after it
must happen without you relaying a permission or hand-assembling a Session.

From the **fixture repository root**, in a plain terminal — not inside a Codex
or Claude Code session:

```sh
cd ~/tmp/arcadia-zero-prompt-rehearsal
arcadia-go-broker-codex
```

The launcher takes no arguments. It runs Arcadia's canonical safety checks
twice — once as a read-only preview, then as the identical apply
(`src/goBroker.ts:74`) — fast-forwards, and prepares the next isolated
worktree for `write-rehearsal-marker`. Record the prepared worktree path and
branch it returns.

Then start the coding agent against that worktree with the **exact** command
Arcadia's own launch code builds (`buildAgentLaunchCommand`,
`src/sessions/worktreePreparation.ts:57`):

```sh
codex -c default_permissions="arcadia-unattended" --ask-for-approval never \
  -C <prepared-worktree-path> -m <plan recommended_model> "arcadia advance"
```

`--ask-for-approval never` is what makes this a real test rather than a
hopeful one: anything that would have prompted instead hard-fails. Zero
prompts and zero permission failures are both required.

If you drive this from Codex Desktop instead of the CLI, select the
**arcadia-unattended** profile in the permissions control beneath the composer
and wait for the environment to refresh **before** starting the task; Desktop
cannot receive a profile selection from the task-creation call. If that named
profile is not offered, fail closed — do not start the task. The remedy is
`pnpm arcadia go-broker install`, a full Codex Desktop restart, then select
the profile again.

The session should create `REHEARSAL.md`, validate it, and hand off through
`arcadia-advance-broker-codex` to preserve its branch and open a draft pull
request.

Evidence: _(the `arcadia-go-broker-codex` JSON; prepared worktree path and
branch; the launch command verbatim; the session transcript or its pointer;
the exact count of approval prompts — acceptance requires zero; exit code and
any permission-denied or sandbox-EPERM line — acceptance requires none;
`REHEARSAL.md` contents; commit sha; pushed branch; draft PR URL)_

## Step 4 — continuation: does Action B start without a relay?

With Action A preserved, the loop must reconcile its evidence, advance the
governed pointer to `confirm-rehearsal-marker`, and start Action B.

```sh
pnpm arcadia work monitor --no-pull-requests
pnpm arcadia next --project zero-prompt-rehearsal
pnpm arcadia production status --json
```

**Record honestly how Action B started.** This is the one place where the
criterion's wording and the current code may disagree, and the answer decides
whether criterion 2 is `met` or `failed`:

- The pointer advance and worktree preparation are the controller's work.
- But `arcadia-go-broker-codex` does not launch the agent — `runGoBroker`
  calls `runGoCommand` without `--launch` (`src/goBroker.ts:100-108`). The
  guarded server-side launch lives in `expose-guarded-host-session-launch`,
  which is still `open` and depends on this Action.

So if starting Action B required you to run the `codex …` line again by hand,
**say so plainly in the evidence and mark criterion 2 `failed`**, naming the
manual step. That is a real finding, not a failed run: it says this Action's
happy path is proven except for automatic launch, and that
`expose-guarded-host-session-launch` is the work that closes it. Recording it
as `met` because everything "basically worked" is the exact false-completion
the Constitution's Truth section forbids.

Whatever the answer, let Action B run to completion the same way Action A did.

Evidence: _(monitor + next + status output; how Action B was started, verbatim;
its worktree, branch, commit sha, `node --test` result for
`tests/rehearsal.test.mjs`, pushed branch, draft PR URL; the final
`REHEARSAL.md` showing both lines in order; every operator keystroke between
Step 3's activation and Action B's completion, counted and listed)_

## Step 5 — the boundaries that must still hold

State explicitly, and how you confirmed it, that none of these happened
anywhere in Steps 0-4 without a separate explicit approval:

- [ ] neither draft pull request was merged
- [ ] nothing was deployed or published
- [ ] no paid capacity was used and no reset was redeemed
- [ ] no credential scope was expanded
- [ ] nothing was deleted destructively
- [ ] no network access outside the declared Git and pull-request path

Deleting the fixture repository afterwards does not count — that is operator
cleanup, not something the loop did.

Evidence: _(one line per box saying how you checked)_

## The run ledger — criterion 3

Criterion 3 asks for one record of the whole run. Fill this in as you go
rather than reconstructing it afterwards.

| Field | Value |
| --- | --- |
| Run date | |
| Arcadia revision (`main` HEAD) | |
| Broker revision after Step 0 | |
| Codex profile used | `arcadia-unattended` |
| Model | |
| Writable roots in effect | |
| Workspace root | |
| Dependency bridge used | |
| Action A worktree / branch | |
| Action A commit / push / PR | |
| Action A validation result | |
| Action B worktree / branch | |
| Action B commit / push / PR | |
| Action B validation result (`node --test`) | |
| Sessions created (native ids) | |
| **Approval prompts observed** | *(acceptance: 0)* |
| **Sandbox denials observed** | *(acceptance: 0)* |
| **Operator interventions after Step 3** | *(acceptance: 0; list every one)* |

## Step 6 — settle

When every `Evidence:` blank and every ledger row carries real output, this
document is the proof Artifact `expected_artifact` names. Bind it with an
Agent Ask:

```yaml
agent_ask: v1
request_id: complete-prove-zero-prompt-production-loop-<yyyy-mm-dd>
project: arcadia
intent: complete
target_ref: action/prove-zero-prompt-production-loop
candidate_revision: <sha of the commit carrying the filled-in runbook>
desired_result: Record the real-host zero-prompt rehearsal result.
evidence:
  - met|failed|skipped   # criterion 1, citing the step that proves it
  - met|failed|skipped   # criterion 2
  - met|failed|skipped   # criterion 3
```

`complete` refuses any criterion that is not `met`. If criterion 2 came back
`failed` at Step 4, do not force it — file the finding instead and let
`expose-guarded-host-session-launch` close the gap, then re-run this runbook.
A refused settlement here is the machinery working.

Keep `~/tmp/arcadia-zero-prompt-rehearsal`, its branches, and its draft pull
requests until settlement lands: they are the primary evidence. Delete the
fixture repository and retire its Project only afterwards.
