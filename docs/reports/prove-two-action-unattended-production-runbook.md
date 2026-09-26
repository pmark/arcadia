# Prove two-Action unattended production — operator runbook and proof template

Milestone: Bootstrap managed production to build Flight Deck.
Action: `prove-two-action-unattended-production`.

## Why this is a runbook and not a completed rehearsal

Every prerequisite Action this proof depends on is `done`:
`feed-and-supervise-managed-production`, `expose-guarded-host-session-launch`,
`advance-approved-production-work`, `prove-provider-capacity-admission`,
`refuse-to-orphan-an-uncommitted-candidate`, and
`reconcile-session-exits-to-next-move`. The machinery this Action exists to
prove is real: `runManagedProductionIteration` → `attemptProjectLaunch` →
`launchGuardedHostSession` (`src/production/tick.ts`, `src/sessions/launch.ts`)
genuinely launches coding-agent processes inside tmux panes under a standing
production grant, with no per-launch operator click.

But the same rule that governed the sibling `prove-zero-prompt-production-loop`
rehearsal applies here unchanged: the `arcadia-go` skill and `go-broker
install` deliberately withhold the mutating `go` launcher and production
activation from a coding-agent sandbox (see
`docs/reports/prove-zero-prompt-production-loop-runbook.md:37-50`). An agent
driving this loop from inside its own sandbox would be exactly the hidden
intervention this proof exists to rule out. So — as with that rehearsal — this
belongs in your own plain terminal, and this document is what you fill in as
you go.

A coding-agent session (this one) prepared this runbook and verified every
command and code path it references actually exists at the revision named
below. It did not activate production, create the fixture Project, or launch
anything live.

## 2026-09-15 live rehearsal status — blocked on a real architecture gap

The operator ran this runbook live, in their own terminal, with an agent
session helping diagnose failures in real time (not driving the loop). Here is
exactly where it stands and why the next session should not simply retry
Steps 3-5 as written below without reading this first.

**What actually happened, in order:**

1. Fixture created: Project `two-action-rehearsal`, repo
   `~/tmp/arcadia-two-action-rehearsal`, two Actions
   (`write-marker-a`/`write-marker-b`, later `write-marker-a2` after the first
   got stuck — see below).
2. `arcadia docs sync --project two-action-rehearsal --apply` turned out to be
   a **missing step** in the original runbook below — the hand-authored plan
   file is never ingested into real work items without it. Added to Step 1.
3. Production activated (`--provider claude-code-cli` — the fixture's default
   agent profile is Claude, not Codex; a `--provider codex-cli` grant would
   never admit anything). Confirmed the worker (already running continuously
   for the workspace) picks up a newly-activated grant's scope with no
   restart needed.
4. **The packet-seeding problem — the actual finding.** `launchGuardedHostSession`
   / `buildLaunchPreview` (`src/sessions/launch.ts`, `src/sessions/launchPreview.ts`)
   refuses to launch anything until the Action's work item already has a
   `codex_invocations` row with `purpose: build`, `status: packet_created`
   (`src/sessions/packetLifecycle.ts`). There is **no working deterministic way
   to produce that dormant state** for a plain, already-clarified Action:
   - Routing to a `codex_planning` step (the default for any wording without
     "implement"/"code"/"prototype" — see `src/execution/skills.ts:157-178`)
     requires a real model-planning run whose output is validated against a
     template built for genuine multi-phase feature planning: ordered phases,
     risks, approval requirements, a repository impact assessment, a
     validation strategy. A planning agent honestly told "add one line to a
     file" cannot satisfy that template, and the validator correctly refuses
     it (scored 0/9 in the live run). This is not a fixable wording issue; the
     template is the wrong shape for a trivial Action.
   - Routing to a `codex_build` step and running
     `arcadia work run <id> --allow-codex-build` does **not** create a dormant
     packet at all — `executeCodexStep`'s build branch (`src/execution/runner.ts`)
     immediately `spawnSync`s a real coding-agent process **synchronously,
     directly against the Project's checked-out repository root**, with no
     worktree, no branch isolation, and no relationship to the guarded-launch/
     tmux worker path at all. It is a separate legacy single-shot execution
     mechanism, not a packet preparer. In the live run this actually completed
     the fixture's Action A2 for real (a genuine commit on the fixture's
     `main`, plus a correctly-filed and operator-settled `complete` Agent
     Ask) — which is a legitimate result, just not evidence of the guarded
     standing-policy launch this Action is supposed to prove.
5. **A real, separate bug found and fixed along the way**: that same
   `codex_build` failure path (e.g. an expired provider OAuth session) crashed
   with `SQLITE_ERROR: UNIQUE constraint failed: run_artifacts.run_id,
   run_artifacts.artifact_id` instead of recording a normal failed Run,
   because `executeCodexStep` returned the same diagnostic Artifact both as
   `artifact` and inside `additionalArtifacts`. Fixed in
   `src/execution/runner.ts`, covered by
   `tests/execution-runner-build-failure.test.ts`, on this candidate branch —
   see this Action's PR. Worth keeping regardless of how this Action itself
   resolves.

**Bottom line:** every dependency this Action lists as `done` is real, but
none of them were ever exercised against a **freshly created, non-genesis**
Action — every real Session this repository has ever launched went through
either the original `project prepare` idea→Decision→packet pipeline, or the
human-run `arcadia go` broker (the mechanism governing coding-agent sessions
themselves, entirely separate from the standing-policy guarded launch). This
Action's own proof is very likely the first time anyone has asked the guarded
launch path to admit something that isn't a project's genesis Action, and it
surfaced that the path has no seed mechanism for that case.

**What the next session should not do:** retry Steps 3-5 hoping for a
different result, or force a "pass" by treating the legacy `--allow-codex-build`
execution as if it were the guarded-launch proof. It is not — it never
touches the worker, tmux, or the standing-policy admission path at all.

**What the next session should do instead** — this is a scope decision, not
something to freelance:

- Read this section plus the diagnosis above in full before touching the
  fixture again.
- The fixture's current real state: `write-marker-a2` is `done` (via the
  legacy path, evidence real); `write-marker-b` is `current_action`, `open`,
  untouched.
- The honest options are (a) scope a small new deterministic packet-seeding
  capability as its own Action — likely needs an Agent Ask, since this is new
  governed capability work, not a fix to existing behavior — or (b)  bring
  this finding to the operator as a Decision: is a genuinely fresh non-genesis
  guarded launch even the right thing to prove next, given what real usage so
  far has actually looked like (project-genesis + human `arcadia go`, not
  standing-policy admission)? Do not pick a direction unilaterally; this
  changes what "done" means for a milestone-gating Action.

## Architecture repair — deterministic build-packet preparation

This is option (a) from the diagnosis above, taken as this Action's own scope:
a small, deterministic packet-seeding capability, filed and built as part of
this Action rather than a separate Ask.

The blocked rehearsal exposed a missing preparation boundary, not a provider
or capacity failure. Concrete `codex_build` Actions had an execution plan, but
`arcadia work plan` did not create the dormant build packet that guarded
production requires. The only existing writer was reached from
`arcadia work run --allow-codex-build`, which immediately invoked the legacy
direct-build path against the Project repository and therefore could not prove
host-owned Session launch.

The repair makes `arcadia work plan <action-id>` create the immutable build
packet and an open `CodexBuildPacketApproval` Decision for concrete build
Actions. It does not invoke a coding agent, create a Run, or approve the
Decision. After the operator approves that exact packet, the existing guarded
launch path can consume its authority; the standing production grant still
controls repeated mechanical admission. Planning Actions retain their
read-only planning Decision flow, and `--allow-codex-build` remains legacy
execution rather than proof of guarded production.

The packet's provider follows `--agent-profile`: pass
`--agent-profile opencode_build` to seed an opencode packet, and pass no flag
only when the workspace default build profile is the intended provider. The
grant's `--provider` and the packet's resolved provider must agree, or
admission refuses the launch as `provider_not_permitted`.

Focused regression coverage verifies packet creation, the open approval, zero
Runs at preparation time, the requested build profile reaching the packet, and
the existing build-failure behavior. This repair does not constitute the live
rehearsal above; the fixture must be prepared and the approval must be settled
on the host before Steps 2–6 are attempted.

## What this Action adds beyond the zero-prompt rehearsal

The zero-prompt rehearsal proved the host controller loop with **zero sandbox
prompts**, but explicitly deferred two things to this Action
(`docs/reports/prove-zero-prompt-production-loop-runbook.md:61-89`):

1. **Action B must launch with no manual session relay.** In the zero-prompt
   run, only Action A was launched by the worker; Action B needed a hand-run
   `codex …` line because the continuous worker/tmux launch path did not exist
   yet. It exists now (`launchGuardedHostSession`), so this run must prove B
   launches the same way A did — the worker admitting it on a later tick, no
   operator command between A's completion and B's launch.
2. **Decision 0051's split-session continuation**, which had no implementation
   to test in September: deliberately terminate one Action's Session mid-work,
   confirm the host reports/reuses the same candidate rather than orphaning or
   duplicating it, launch a second Session against that same worktree/branch,
   and confirm it finishes the Action.

This run also owns two checks the zero-prompt rehearsal never needed: a
concurrent-launch refusal, and a live Turn Off / restart cycle.

## Prerequisite: do not reuse the Zero Prompt Rehearsal fixture

`~/tmp/arcadia-zero-prompt-rehearsal` and its Project (`zero-prompt-rehearsal`)
belong to `prove-zero-prompt-production-loop`, which is **still open**. As of
this writing that Project has a live standing production grant (revision 1,
epoch 1, granted 2026-09-11, scoped to `zero-prompt-rehearsal` only) and a
running worker (verify with `arcadia production status --json` and check
`.arcadia/worker.pid` / `worker.heartbeat` in the workspace before touching
anything). Its Action A (`write-rehearsal-marker`) has not run yet. **Do not
activate production against it, do not delete it, and do not fold this proof
into it.** This Action needs its own disposable fixture.

## Step 0 — repin the broker, then confirm READY

Identical to the zero-prompt rehearsal's Step 0. The broker runs a frozen copy
of Arcadia; rehearsing against a stale pin would prove a controller `main`
does not ship.

```sh
cd ~/Dev/MR/Arcadia/arcadia
pnpm arcadia go-broker install --json
pnpm arcadia go-broker status --json
```

`status` must report `ready: true` and a `revision` equal to `main`'s HEAD.

Evidence: _(paste both JSON blocks; state the revision before and after)_

## Step 1 — create the disposable fixture repository and Project

**Before reusing anything, read the fixture's real state.** The directory
`~/tmp/arcadia-two-action-rehearsal` from the blocked 2026-09-15 run is still
on disk and is **not** in proof shape:

- its Action A (`write-marker-a2`) is already `done`, completed through the
  legacy `--allow-codex-build` path rather than the guarded standing-policy
  launch this proof must exercise, so it cannot serve as a fresh, splittable
  Action A;
- its Action B (`write-marker-b`) already has a seeded dormant build packet
  (`purpose: build`, `status: packet_created`) awaiting its
  `CodexBuildPacketApproval` Decision — but it was seeded with the workspace
  default build profile (`codex_build` → provider `codex-cli`), so an
  opencode-scoped grant cannot consume it; and
- the currently-live production grant's scope names
  `two-action-rehearsal/write-marker-a2` and
  `two-action-rehearsal/write-marker-b`.

This proof runs on **opencode**, per the plan: `add-opencode-production-provider`
is a done dependency precisely "so prove-two-action-unattended-production can run
with opencode instead of the credit-exhausted Codex and Claude providers"
(`docs/plans/bootstrap-managed-production-to-build-flight-deck.md`). To run the
proof you therefore need a **fresh two-Action pair targeting opencode**. Reset
the fixture to a new `write-marker-a`/`write-marker-b` pair rather than reusing
`write-marker-b`: its existing packet is already bound to `codex_build`, and
`arcadia work plan` refuses to bind a different profile to an existing packet
("Existing packet is bound to a different coding agent profile"). Seed each
Action's dormant build packet with an explicit opencode profile (see
"Architecture repair" above):

```sh
arcadia work plan <action-id> --agent-profile opencode_build
```

The profile is what pins the packet's provider. Without `--agent-profile`,
`arcadia work plan` uses the workspace's default build profile (`codex_build`
→ `codex-cli`), and Step 2's `--provider opencode-cli` grant then refuses the
launch at admission (`provider_not_permitted`,
`src/production/policy.ts:585-592`) — the same provider/scope mismatch this
section exists to prevent. The seeded packet's resolved provider must equal
Step 2's `--provider`. Settle the resulting `CodexBuildPacketApproval` Decision
on the host, and make Step 2's activation scope name the fresh pair. Without a
sealed packet the guarded launch refuses — exactly what blocked the 2026-09-15
run, and a packet seeded for a different provider fails the same way.

Pick a name distinct from every existing fixture, e.g.
`~/tmp/arcadia-two-action-rehearsal` / Project slug `two-action-rehearsal`.

```sh
mkdir -p ~/tmp/arcadia-two-action-rehearsal
cd ~/tmp/arcadia-two-action-rehearsal
git init -b main
```

Author `PROJECT.md` and `docs/plans/two-action-rehearsal-bootstrap.md` by hand
— this is a disposable external fixture, not governed Arcadia state, so
hand-authoring its bootstrap Plan is the same bootstrapping step
`arcadia project prepare`/`import` would otherwise do, not the "hand-edit
governance state" AGENTS.md forbids for Arcadia's own Projects. Use the Zero
Prompt Rehearsal fixture's files as the exact template
(`~/tmp/arcadia-zero-prompt-rehearsal/PROJECT.md`,
`docs/plans/zero-prompt-rehearsal-bootstrap.md`) with these substitutions:

- `slug: two-action-rehearsal`, `name: Two Action Rehearsal`
- Two Actions only, both trivial file edits:
  - `write-marker-a` (no dependencies) — e.g. "Add MARKER.md containing
    exactly the line `two-action rehearsal action A` plus a trailing
    newline." This is the Action you will deliberately split across two
    Sessions in Step 4.
  - `write-marker-b` (`depends_on: [write-marker-a]`) — e.g. "Append the line
    `two-action rehearsal action B` to MARKER.md, and add
    `tests/marker.test.mjs` asserting `node --test` sees both lines in
    order." This is the Action that must launch with no manual relay.
- Copy `AGENTS.md`, `CLAUDE.md`, `CONSTITUTION.md`, `docs/agent-continuation-protocol.md`
  from the Zero Prompt Rehearsal fixture verbatim — these are the standing
  files every governed repository needs, not proof content.

Commit and register the Project with the workspace database using the
deterministic, model-free path (`arcadia project import`, not `prepare` —
`prepare` runs a real planning Decision, which this fixture doesn't need):

```sh
cd ~/Dev/MR/Arcadia/arcadia
arcadia project import \
  --name "Two Action Rehearsal" \
  --mission "Disposable fixture for prove-two-action-unattended-production." \
  --outcome "Disposable fixture for prove-two-action-unattended-production; delete after the rehearsal." \
  --milestone "Plan the first usable build" \
  --next-action "Add MARKER.md containing exactly the line \"two-action rehearsal action A\" plus a trailing newline." \
  --responsibility agent \
  --status active \
  --json
```

Confirm the pointer resolves cleanly before touching production:

```sh
arcadia next --project two-action-rehearsal
```

`write-marker-a` must be dispatchable with no blockers. If `project import`'s
seeded Action doesn't match the hand-authored plan file exactly, `PROJECT.md`
and the plan file win (checked-in documentation is authoritative) — re-check
`arcadia next` after committing them.

Evidence: _(paste the fixture's PROJECT.md and plan file; the `project
import` JSON; the `arcadia next` output confirming `write-marker-a`
dispatchable)_

## Step 2 — scope the standing production policy to this Project only

A grant from the blocked 2026-09-15 run is still live against the old fixture
actions with provider `claude-code-cli`. This activation replaces its scope, so
the new `--provider opencode-cli` scope supersedes it; confirm
`scope.providers` is `["opencode-cli"]` in the preview.

```sh
cd ~/Dev/MR/Arcadia/arcadia

arcadia production preview \
  --project two-action-rehearsal \
  --plan two-action-rehearsal/two-action-rehearsal-bootstrap \
  --provider opencode-cli \
  --concurrency 1 \
  --transitions validation,acceptance,pointer \
  --integration-grant-decision 0058 \
  --integration-grant-expires-at "$GRANT_EXPIRES_AT" \
  --intent "Prove two-Action unattended production with a deliberate split-session continuation." \
  --json
```

Set `GRANT_EXPIRES_AT="$(date -u -v+12H +%Y-%m-%dT%H:%M:%SZ)"` once, before
the preview, and reuse the same value in `activate`. The bounded
candidate-integration grant (Decision 0058, approved) is what lets the worker
fast-forward Action A's finished candidate into the fixture's `main`.
Without it A is preserved but never integrated, so `main`'s pointer never
advances and Step 5 cannot launch Action B without a manual merge.

Read the preview. `scope.projects` must name only `two-action-rehearsal`, and
`scope.integrationGrant.decisionRef` must be `0058`. Then activate with the
exact revision the preview returned:

```sh
arcadia production activate \
  --project two-action-rehearsal \
  --plan two-action-rehearsal/two-action-rehearsal-bootstrap \
  --provider opencode-cli \
  --concurrency 1 \
  --transitions validation,acceptance,pointer \
  --integration-grant-decision 0058 \
  --integration-grant-expires-at "$GRANT_EXPIRES_AT" \
  --intent "Prove two-Action unattended production with a deliberate split-session continuation." \
  --request-id "prove-two-action-unattended-production-$(date -u +%Y%m%dT%H%M%SZ)" \
  --granted-by "P. Mark Anderson" \
  --expect-revision <n from preview> \
  --json
```

Use a request id that has never been used, which is why it is timestamped to
the second. `activate` treats a reused request id as a replay: it returns
`ok: true`, changes nothing, and says so only in `warnings` (Issue #704). A
date-only id collides with any earlier attempt on the same day. Confirm
`data.result.replayed` is `false` and `data.result.policy.desiredState` is
`active` before you continue.

This grant is the "bounded rehearsal authority" the plan's second criterion
names — activating it is the one non-CLI-boilerplate decision only you can
make; nothing after this step should need another one until Turn Off.

Evidence: _(paste preview + activate JSON; quote `scope.projects` and the new
revision/epoch)_

## Step 3 — start the worker, and observe Action A's automatic launch

```sh
cd ~/Dev/MR/Arcadia/arcadia
arcadia worker start --workspace <workspace path from Step 0/1>
```

(Or confirm an already-running worker for this workspace via
`.arcadia/worker.pid` / `worker.heartbeat` — do not start a second one against
the same workspace database.)

Within a few ticks (`POLL_INTERVAL_MS` is 2s), the worker should admit
`write-marker-a` and launch it under the standing grant with **no** operator
command. Confirm:

```sh
arcadia production status --json
```

`liveAdmissions` should show one admission for `two-action-rehearsal`. The
admission record names the tmux session; attach to watch it work:

```sh
tmux attach-session -t <tmux_session_name from the admission/lease>
```

Evidence: _(worker start output or confirmation it was already running;
`production status` JSON showing the admission with zero operator launch
command between Step 2's activation and this admission; the tmux session
name)_

## Step 4 — deliberately split Action A across two Sessions (Decision 0051)

This is the criterion the zero-prompt rehearsal could not test. Do the checks
below in this order — the concurrent-launch refusal is only meaningful while A1
is still live, so it must come **before** the kill.

First, while Session A1 is genuinely mid-work (visible in the attached tmux
pane, before it edits and validates `MARKER.md`), attempt a second concurrent
launch against the same candidate from the fixture repository:

```sh
cd ~/tmp/arcadia-two-action-rehearsal
arcadia-go-broker-opencode   # while A1 is still live
```

Confirm it is **refused** with a lease conflict rather than silently starting a
second execution — the existing-lease guard at `src/sessions/launch.ts:132-137`
throws "The repository already has a prepared or running Session for a
different Action." Record the exact refusal.

Then terminate A1 mid-work to simulate a crash or lost connection, **not** a
clean `arcadia advance` exit. Timing matters. A Session killed before it has
changed anything reconciles as `missing_evidence`: there is nothing to resume,
so the next launch correctly takes a fresh worktree, and the "identical
worktree" check below would fail by design. Kill it after A1 has written
`MARKER.md` into its worktree and before it commits and settles:

```sh
tmux kill-session -t <tmux_session_name>
```

Do **not** run the launcher again to resume. Since #696 the worker reconciles
the dead Session into an `incomplete_resumable` handoff on its next tick and
resumes that exact worktree/branch itself, as Session A2, with no operator
command. A manual `go` launch at this point races the worker. That is a manual
relay the proof rules out, and a lost race also counts against this Action's
repair budget. Watch instead:

```sh
arcadia session show --json    # expect a new Session id for write-marker-a
```

Record the resumed Session's worktree path and branch. Confirm they are
**identical** to Session A1's, and that A1's partial `MARKER.md` is still
present. Let A2 finish `write-marker-a`. The generated `next-steps.md` from
`prepare-two-action-rehearsal-*.sh` scripts this whole step: it captures A1's
identity, kills A1 at the right moment, and compares A2 with A1 automatically.

Evidence: _(the concurrent-launch attempt's exact refusal message and the
timestamp showing it preceded the kill; the kill command and timestamp; the
`session show` JSON showing the resumed — not new — worktree/branch; Session A1's
native id and Session A2's native id, with evidence that the worker, not an
operator, launched A2; confirmation A2 saw A1's partial state;
A2's completion, validation, and preservation result)_

## Step 5 — confirm Action B launches with no manual relay

With `write-marker-a` accepted and integrated, the pointer should advance to
`write-marker-b` and the worker should admit and launch it automatically on a
later tick — this is the capability the zero-prompt rehearsal explicitly
deferred to this Action.

```sh
arcadia next --project two-action-rehearsal    # expect write-marker-b
arcadia production status --json               # expect a new admission, no operator launch command
```

Let it run to completion (`node --test tests/marker.test.mjs` passing,
`MARKER.md` with both lines in order, preserved branch, draft PR if the
fixture has a remote).

Evidence: _(pointer advance to `write-marker-b`; the admission JSON; zero
operator command between A2's completion and B's launch; B's Session id,
commit, validation result)_

## Step 6 — Turn Off mid-work, then restart and confirm no duplicate

Time this against either Action's live work (re-run Steps 3-5 lightly if both
already finished before you get here — a real Off test needs something
in flight). While a Session is genuinely running:

```sh
arcadia production deactivate \
  --request-id turn-off-prove-two-action-<yyyy-mm-dd> \
  --reason "Mid-work Off exercise for prove-two-action-unattended-production."
```

Confirm within the documented deadline (`offAcknowledgementMs`, from Step
2/3's `production status` output) that:

- the already-running Session is **not** killed — it keeps running and is
  reconciled normally when it finishes;
- no **new** Action is admitted after Off, even once the running one
  completes;
- `arcadia production status --json` shows `desiredState: "inactive"` and the
  reserved-but-unlaunched fence taking effect.

This repository's production control is the CLI (the Action's own next_action
says a dashboard control is not required), so "close browser" from the plan
text has no literal analog here; the mechanical equivalent is stopping and
restarting the worker process itself:

```sh
# stop the worker (SIGTERM/SIGINT to the PID in worker.pid, or however you started it)
arcadia worker start --workspace <path>   # restart
arcadia production status --json          # confirm still inactive, no re-admission
```

Then reactivate (new `production activate` with a fresh `--request-id`) and
confirm the already-completed Action does not relaunch or duplicate — only a
genuinely next eligible Action would ever be admitted again.

Evidence: _(deactivate JSON and timestamp; proof the in-flight Session
finished undisturbed; proof nothing new launched after Off; worker
stop/restart transcript; `production status` after restart; the reactivation
JSON; proof of no duplicate/reactivation of already-accepted work)_

## Step 7 — the boundaries that must still hold

Same list as the zero-prompt rehearsal, checked for this run:

- [ ] neither draft pull request was merged
- [ ] nothing was deployed or published
- [ ] no paid capacity was used beyond what this rehearsal's own Sessions
      consumed, and no reset was redeemed
- [ ] no credential scope was expanded
- [ ] nothing was deleted destructively
- [ ] no network access outside the declared Git and pull-request path
- [ ] the standing production grant was scoped to `two-action-rehearsal` only
      for its entire life (re-check `production status` scope right before
      deactivating)

Evidence: _(one line per box saying how you checked)_

## The run ledger — criterion 5 (exact identities and interventions)

| Field | Value |
| --- | --- |
| Run date | |
| Arcadia revision (`main` HEAD) | |
| Broker revision after Step 0 | |
| Host | |
| Provider / profile used | |
| Model | |
| Fixture repository / Project slug | |
| Production policy revision/epoch (activate → deactivate → reactivate) | |
| Session A1 native id / tmux session | |
| Session A1 kill timestamp | |
| Concurrent-launch refusal message (verbatim) | |
| go-broker resumption JSON confirming same worktree/branch for A2 | |
| Session A2 native id | |
| Action A commit / push / PR | |
| Action A validation result | |
| Action B Session native id | |
| Action B launch: admitted automatically, yes/no, ticks elapsed | |
| Action B commit / push / PR | |
| Action B validation result (`node --test`) | |
| Turn Off request-id / timestamp | |
| Off acknowledgement time vs. `offAcknowledgementMs` | |
| In-flight Session outcome across Off (undisturbed, reconciled normally) | |
| Post-Off admissions observed | *(acceptance: 0 until reactivated)* |
| Worker restart transcript | |
| Reactivation request-id | |
| Duplicate/reactivation of completed work after restart | *(acceptance: none)* |
| **Every operator intervention beyond the documented CLI commands above** | *(acceptance: 0; list every one)* |

## Step 8 — settle

When every `Evidence:` blank and every ledger row carries real output, this
document is the proof Artifact `expected_artifact` names. Bind it with an
Agent Ask. Copy the six acceptance criteria **verbatim and in the plan's own
order** from
`docs/plans/bootstrap-managed-production-to-build-flight-deck.md` — do not
paraphrase from memory.

```yaml
agent_ask: v1
request_id: complete-prove-two-action-unattended-production-<yyyy-mm-dd>
project: arcadia
intent: complete
target_ref: action/prove-two-action-unattended-production
candidate_revision: <sha of the commit carrying the filled-in runbook>
desired_result: Record the real-host two-Action unattended production result.
evidence:
  - criterion: "Provide a disposable or explicitly approved real Project with two small dependent Actions and a reachable existing production control (CLI or dashboard) before requesting live execution."
    status: met
    note: "Step 1 — two-action-rehearsal fixture, distinct from zero-prompt-rehearsal; CLI production control used."
  - criterion: "Under bounded rehearsal authority activate once: Action A launches, validates, records canonical completion/pointer, and B launches without manual session setup or launch confirmation in between."
    status: met
    note: "Steps 2-5 — one activation in Step 2; A admitted/launched automatically in Step 3; B admitted/launched automatically in Step 5 with zero intervening operator launch command."
  - criterion: "Per Decision 0051, deliberately split one Action across Sessions: Session A edits the candidate and exits incomplete without Git common-directory writes; Session B launches in the same worktree and branch, sees Session A's changes and finishes; a concurrent second live execution against that candidate is refused; the next Action receives a fresh candidate from the new governed base; no operator branch, worktree, commit, stash, rebase or cleanup step occurs."
    status: met
    note: "Step 4 — A1 killed mid-work; go-broker resumed the identical worktree/branch for A2; concurrent launch attempt refused with a lease conflict; Action B (Step 5) received its own fresh candidate from the post-A base."
  - criterion: "Turn Off during work; prove no later launch, preserved current output and visible terminal reconciliation. Close browser/restart worker and prove no duplicate or reactivation after Off."
    status: met
    note: "Step 6 — deactivated mid-work; in-flight Session finished undisturbed and reconciled; no admission after Off; worker restarted; no duplicate/reactivation after reactivation."
  - criterion: "Record exact revision, host, provider, Action/Session identities, receipts and every operator intervention; missing real authorization/input remains one precise review, never fixture-as-live success."
    status: met
    note: "The run ledger above, filled in at <sha>."
  - criterion: "Complete this vertical proof before broad rail, capture, navigation polish or default-home cutover; reuse existing review/proof specialists as needed."
    status: met
    note: "No rail/capture/navigation work attempted in this Action; scope held to this proof."
  - criterion: "Preserve deterministic integration evidence and an exact operator procedure/target in the PR; distinguish simulated provider or capacity behavior from real proof."
    status: met
    note: "This runbook is the exact operator procedure; every step above is a real host command, not a simulation."
```

Preview it, then apply with `--operator` — a `complete` settlement refuses to
apply without it:

```sh
arcadia agent-ask draft '<json above>'
arcadia agent-ask preview --file .arcadia/asks/agent-ask-complete-prove-two-action-unattended-production-<yyyy-mm-dd>.yaml --json
arcadia agent-ask settle --proposal <id> --request-id <rid> \
  --disposition accepted --operator
arcadia agent-ask settle --proposal <id> --request-id <rid> \
  --disposition accepted --operator --apply --preview <fingerprint from the line above>
```

`complete` refuses any criterion not `met`, an unresolved required review
Decision, or a stale `candidate_revision`. If the split-session resume
actually created a second worktree, if the concurrent launch was not refused,
or if Off allowed a new launch, those criteria are genuinely `failed` — record
the finding and stop; a refused settlement there is the machinery working, not
a blocker to route around.

Keep the fixture repository, its branches, and its draft pull requests until
settlement lands — they are the primary evidence. Delete the fixture
repository and retire its Project only afterwards.
