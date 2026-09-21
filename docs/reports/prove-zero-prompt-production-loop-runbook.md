# Prove zero-prompt production loop — operator runbook and proof template

Milestone: Bootstrap managed production to run unattended from the GitHub board.
Action: `prove-zero-prompt-production-loop`.

## Required preflight before a counted run

The authoritative Plan requires `advance-approved-production-work` in addition
to protected preservation. All three prerequisites named in the Action's
`depends_on` are now `done`:

- `broker-candidate-preservation`
- `let-agent-preserve-its-candidate`
- `advance-approved-production-work`

The missing reconciliation/completion bridge those Actions were waiting for now
ships, so criterion 3's refusal clause ("until a supported bridge is shipped and
verified, preflight refuses") is satisfied by verifying this entry point, not
waived:

- `arcadia session reconcile <session-id> --workspace "$WORKSPACE" --repo "$REPO" --json`
  (registered in `src/cli.ts`, implemented by `runSessionReconcileCommand` in
  `src/commands/advance.ts`, core in `src/sessions/reconciliation.ts`). It
  reconciles a dead-but-unreconciled Session into a durable exit receipt and the
  resulting canonical next move; under an Active production policy it completes
  the Action when the declared evidence is complete; it is idempotent by request
  id. `docs/COMMANDS.md` carries the operator procedure. `arcadia advance` and
  `arcadia-advance-broker-*` report the same `kind: reconcile` case without
  writing.
- The revision-pinned host `arcadia-go-broker-opencode` host controller prepares
  Action B's worktree. That is a **predeclared, visible operator step**; it is
  not autonomous execution.

Before starting the counted run, record and verify every launch,
remote-preservation, integration and mechanical-completion grant, its fixture
scope, policy epoch and receipt. Missing or stale authority stops preflight.
Criterion 5's integration grant is separate from the validation/acceptance/pointer
production grant: record how the host controller is authorized to integrate the
exact candidate branch, and confirm it reports `commitsToIntegrate` greater than
zero. The `preserve-on-exit-and-integrate` Action (Decision 0058) is the standing
form of that grant and is still `open`; if it has not shipped, the integration
grant is the visible operator `go` invocation recorded in preflight.

Any explicit host invocation must be a predeclared, visible operator step.
Verify actual Action and pointer document effects. This rehearsal proves **zero
sandbox approval prompts** and **zero hidden interventions**. It does not claim
fully unattended execution; `prove-two-action-unattended-production` owns that
proof after the continuous worker exists.

## Historical preparation notes

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

Agent Ask `break-launch-dependency-loop-2026-09-11` then narrowed the
launch-scope wording (now criterion 6). The earlier wording required Arcadia to
*start* Action B with no manual Session relay — a capability no built code path
has, and one whose own Actions were sequenced downstream of this rehearsal, so
this Action could never pass. That requirement already existed, correctly
placed, on `prove-two-action-unattended-production`. It now lives only there.

**What that changes for you at Step 4:** if Action B's Session has to be started
by hand, that is no longer a failure. Zero sandbox prompts is still absolute.
The decision rule:

- A sandbox approval prompt **anywhere in Steps 3–4** → criterion 6 `failed`.
- Action B needing a hand-run `opencode run` line to start → expected; record how, and
  it does not affect the verdict.

The seven criteria this run must satisfy, verbatim from
`docs/plans/bootstrap-managed-production-to-build-flight-deck.md`:

1. Use the Zero Prompt Rehearsal fixture Project with two dependent small
   Actions and the same OpenCode provider profile, protected launchers,
   workspace root, dependency bridge, build, test, SQLite, Git, network and
   pull-request path that managed production will use.
2. Before the counted run, record and verify every required launch,
   remote-preservation, integration and mechanical-completion grant, with its
   exact fixture scope, policy/receipt identity, freshness and limits. A missing,
   stale or insufficient grant stops preflight before the run begins; no new
   approval halfway through the proof is part of a successful run.
3. Before the counted run, identify and verify the exact supported host entry
   point delivered by reconcile-session-exits-to-next-move and
   advance-approved-production-work that drives reconciliation and canonical
   completion without the continuous worker. Record its command and the
   revision-pinned arcadia-go-broker-opencode host-controller invocation that
   prepares Action B, or the supported combined entry point if the prerequisite
   implementation provides one. Current go prepares work but does not supply the
   missing reconciliation bridge; until a supported bridge is shipped and
   verified, preflight refuses. Any explicit host-controller invocation is a
   visible, predeclared operator step, not autonomous execution.
4. From one bounded activation and the predeclared visible host steps, Arcadia
   prepares Action A's worktree, advances and monitors it, edits, builds, tests,
   preserves its exact branch and authorized draft pull request, reconciles
   evidence through the implemented canonical completion bridge, advances the
   governed pointer to Action B and prepares Action B's worktree. Record and
   verify the actual authoritative Action completion and both pointer document
   effects; a successful command response alone is insufficient.
5. After protected preservation, prove the host controller reports
   commitsToIntegrate greater than zero and integrates the exact candidate branch
   under the separately explicit integration grant recorded in preflight. Prove
   acceptance/completion and pointer advancement use their existing governed
   writers and applicable authority, never preservation alone.
6. Keep zero sandbox approval prompts, zero hidden interventions and fully
   unattended execution distinct. This rehearsal requires the first two, permits
   only the predeclared visible operator steps, and makes no fully unattended
   execution claim. prove-two-action-unattended-production owns unattended
   Action B launch and execution after the continuous worker exists.
7. One proof Artifact records preflight grants, exact supported entry points, all
   predeclared manual steps, and every command, profile, writable root, sandbox
   denial, approval event, worktree, branch, revision, Session, Action,
   validation result, commit, push, pull request, actual document transition and
   operator intervention. Zero sandbox approval prompts and zero hidden
   interventions are acceptance conditions; record visible manual invocation
   explicitly and never label it autonomous execution.

Criterion 3's bridge now ships as `arcadia session reconcile` (see preflight
above); record that verification. Criteria 2 and 5 require grants that preflight
records before the counted run begins.

## State — read it live, never from this page

An earlier draft of this runbook told you to create the fixture, and a later one
asserted a verified snapshot of the host. That snapshot went stale, and its
staleness was its own hazard: on 2026-09-21 the fixture Project was `paused`,
the standing policy was Active at revision 8 / epoch 7 and scoped to `arcadia`
rather than the fixture, and `codex-cli` had no capacity until 2026-09-26. A
page cannot stay true about values that move, so this section no longer claims
them. See Issue #454.

**Step 0 is the `/runs` operator action
`preflight-zero-prompt-rehearsal-2026-09-21`, not a hand-run sequence.** It
reads every value below from the live host, refuses with the exact unmet
precondition and changes nothing, and repins the protected broker only once
everything else is green. Run it and keep its receipt; the manual commands in
the historical note below are what it performs, not a procedure to follow
first.

What is stable, and what the fixture must still look like when the run begins:

| Fact | Expected value |
| --- | --- |
| Fixture repository | `~/tmp/arcadia-zero-prompt-rehearsal`, clean, `main` |
| Fixture remote | `https://github.com/pmark/arcadia-zero-prompt-rehearsal.git`, `main` pushed |
| Project | `zero-prompt-rehearsal`, **`status: active`** |
| Active plan | `zero-prompt-rehearsal-bootstrap` |
| Pointer | `current_action: write-rehearsal-marker` |
| Action A | `write-rehearsal-marker` — open, no dependencies |
| Action B | `confirm-rehearsal-marker` — open, `depends_on: [write-rehearsal-marker]` |
| Fixture progress | `REHEARSAL.md` does not exist yet; neither Action has run |

Everything else — the production policy's state, revision, epoch and scope, the
installed broker's revision, OpenCode's launch adapter and capacity — is read by
Step 0's preflight. The one invariant that still matters here: after Step 0 the
broker's revision **equals `main`'s HEAD at the moment you rehearse**.

## Historical note — what Step 0 does by hand

The broker runs a frozen copy of Arcadia taken at install time, and it drifts
behind `main` with every merge. From the Arcadia repository on `main`:

```sh
pnpm arcadia go-broker install --json
pnpm arcadia go-broker status --json
```

`status` must report `ready: true` and a `revision` equal to `main`'s HEAD.
If `ready` is false it names the exact missing root, profile, or guardrail —
fix that before going further rather than rehearsing a known-broken install.
The preflight above performs exactly this and asserts the revision for you.

Evidence: _(paste the preflight run log and receipt, or both JSON blocks if you
ran this by hand; state the revision before and after)_

## Step 1 — confirm the fixture preconditions, do not recreate them

```sh
cd ~/tmp/arcadia-zero-prompt-rehearsal
git status --short          # expect: empty
git log --oneline -1
ls REHEARSAL.md             # expect: No such file or directory

cd ~/Dev/MR/Arcadia/arcadia
arcadia next --project zero-prompt-rehearsal
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

Run Arcadia's CLI **from the Arcadia checkout, not the fixture repository**.
`pnpm arcadia` resolves through Arcadia's own `package.json`, so it fails with
`ERR_PNPM_NO_PKG_MANIFEST` anywhere else — including the fixture root you were
standing in at the end of Step 1. The bare `arcadia` command works from any
directory; the `cd` below removes the question entirely.

```sh
cd ~/Dev/MR/Arcadia/arcadia

arcadia production preview \
  --project zero-prompt-rehearsal \
  --plan zero-prompt-rehearsal/zero-prompt-rehearsal-bootstrap \
  --provider opencode-cli \
  --concurrency 1 \
  --transitions validation,acceptance,pointer \
  --intent "Prove the zero-prompt production loop on a disposable fixture." \
  --json
```

`--provider` is **required** — omitting it fails with "Production scope needs at
least one permitted provider." The value is `opencode-cli`, not `opencode`:
`SESSION_PROVIDER` maps the `opencode` session agent to that string
(`src/sessions/index.ts:70`), and admission compares the policy scope against it
directly (`src/production/policy.ts:585`), so `opencode` would be accepted at
grant time and then refuse every launch with `provider_not_permitted`.

> **Rescoping replaces, it does not add.** When this runbook was written the
> standing policy was Inactive, so the sentence below — "must name
> `zero-prompt-rehearsal` and nothing else" — read as a pure safety property.
> It is not one any more. On 2026-09-21 that same policy is **Active**,
> revision 8, epoch 7, scoped to Project `arcadia` and Plan
> `arcadia/bootstrap-managed-production-to-build-flight-deck`. Activating the
> spread below therefore moves live production authority **off Arcadia's own
> bootstrap Plan and onto the fixture**. Do it deliberately, record the previous
> scope in the ledger, and restore it after the rehearsal.

Read the preview. `scope.projects` must name `zero-prompt-rehearsal` and
nothing else — this grant must not be able to admit any other Project's work.
Then activate with the exact revision the preview returned:

```sh
arcadia production activate \
  --project zero-prompt-rehearsal \
  --plan zero-prompt-rehearsal/zero-prompt-rehearsal-bootstrap \
  --provider opencode-cli \
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
activate. Pass `--plan` explicitly here: `preview` defaults it to every Plan of
the named Projects, but `activate` does not, and an omitted `--plan` fails with
"Production scope needs at least one Plan."

Evidence: _(paste preview + activate JSON; quote `scope.projects` and the new
revision/epoch)_

## Step 2.5 — record the separate integration grant (criterion 5)

The production policy above deliberately permits only
`validation,acceptance,pointer` mechanical transitions. Criterion 5 requires
integration to happen under a **separately explicit** grant, so do not fold
integration into this policy.

The standing form of that grant is the `preserve-on-exit-and-integrate` Action
under the authority recorded by Decision 0058. That Action is still `open`, so
unless it has shipped before your run, the integration grant is the visible
host-controller `arcadia-go-broker-opencode` invocation run from the governed base
that reports `commitsToIntegrate` greater than zero and fast-forwards the exact
candidate branch, recorded here as a predeclared operator step naming the exact
Project, Plan, Action, agent-owned branch and governed base branch it may
integrate.

Record that grant before the counted run. A missing or stale integration grant
stops preflight: preservation alone must never be recorded as completion.

Evidence: _(the integration grant you recorded, and the `go` invocation with its
`commitsToIntegrate` and `integration` fields)_

## Step 3 — one activation: prepare and run Action A

This is the bounded activation criterion 4 counts from. Everything after it
must happen without you relaying a permission or hand-assembling a Session.

From the **fixture repository root**, in a plain terminal — not inside a coding
agent session (Codex, Claude Code or opencode):

```sh
cd ~/tmp/arcadia-zero-prompt-rehearsal
arcadia-go-broker-opencode
```

The launcher takes no arguments. It runs Arcadia's canonical safety checks
twice — once as a read-only preview, then as the identical apply
(`src/goBroker.ts:74`) — fast-forwards, and prepares the next isolated
worktree for `write-rehearsal-marker`. Record the prepared worktree path and
branch it returns.

Then start the coding agent against that worktree with the **exact** command
Arcadia's own launch code builds for opencode (`buildAgentLaunchCommand`,
`src/sessions/worktreePreparation.ts:86-97`):

```sh
cd <prepared-worktree-path> && \
  opencode run --model <resolved model> [--variant <resolved variant>] "arcadia advance"
```

`opencode run` is non-interactive: it presents no approval composer, so any
permission it would have asked for either resolves from opencode's own
configuration or fails the run. Take the model and variant from the Action's
packet rather than from this page — `arcadia session preview-launch` reports
the automatic selection and the bound identity, and the standard-tier binding
is `opencode-zen` (`opencode-go/deepseek-v4.1-flash`, variant `low`). Record
the resolved values in the ledger.

**Zero prompts is still absolute, and it is now measured differently.** Unlike
Codex, this build ships no `arcadia-unattended` profile for opencode: go-broker
installs the opencode worktree root but deliberately leaves opencode's
sandbox and permission configuration alone — deferred by
`add-opencode-production-provider` against a named trigger. So record what
opencode actually did: every prompt shown and every permission-denied line.
A prompt appearing is criterion 6 `failed`; do not answer it and continue.

The session should create `REHEARSAL.md`, validate it, and hand off through
`arcadia-advance-broker-opencode` to preserve its branch and open a draft pull
request.

Evidence: _(the `arcadia-go-broker-opencode` JSON; prepared worktree path and
branch; the launch command verbatim; the session transcript or its pointer;
the exact count of approval prompts — acceptance requires zero; exit code and
any permission-denied or sandbox-EPERM line — acceptance requires none;
`REHEARSAL.md` contents; commit sha; pushed branch; draft PR URL)_

## Step 4 — continuation: reconcile evidence, advance the pointer, prepare B

With Action A preserved, the loop must reconcile its evidence through the
canonical completion bridge, advance the governed pointer to
`confirm-rehearsal-marker`, and prepare Action B's worktree. **Those things are
criterion 4's finish line** — not Action B's Session starting by itself.

```sh
cd ~/Dev/MR/Arcadia/arcadia

arcadia work monitor --no-pull-requests
arcadia session reconcile <session-id> --workspace "$WORKSPACE" --repo ~/tmp/arcadia-zero-prompt-rehearsal --json
arcadia next --project zero-prompt-rehearsal
arcadia production status --json
```

`arcadia session reconcile` is the supported bridge named in criterion 3: it
turns the dead-but-unreconciled Session's exit into a durable receipt and the
canonical next move, and under the Active policy it completes Action A and
resolves the governed pointer. Run it a second time with the same request id and
confirm it reports `(already reconciled)` — idempotence is part of the proof.

**Record honestly how Action B started**, but understand what it does and does
not decide:

- Reconciliation, the pointer advance and worktree preparation are the
  controller's work, and they **are** criterion 4's acceptance. Confirm each
  happened and that the Plan and Project documents actually changed.
- `arcadia-go-broker-opencode` does not launch the agent — `runGoBroker` calls
  `runGoCommand` without `--launch` (`src/goBroker.ts`). The guarded server-side
  launch lives in `expose-guarded-host-session-launch`, which is `done`, but this
  rehearsal still expects you to start Action B's Session by hand.

So expect to run the `opencode …` line by hand to start Action B. **That is not a
failure and does not fail criterion 4.** Record the exact command you ran and
note that automatic launch is `prove-two-action-unattended-production`'s
acceptance, not this one.

What *would* fail: any sandbox approval prompt (criterion 6 `failed`), any
permission-denied or EPERM line, a reconciliation or pointer that does not
advance to `confirm-rehearsal-marker`, or a worktree the controller did not
prepare (criterion 4 `failed`). Recording those as `met` because everything
"basically worked" is the exact false-completion the Constitution's Truth
section forbids.

Let Action B run to completion the same way Action A did.

Evidence: _(monitor + reconcile + next + status output; the second idempotent
reconcile; how Action B was started, verbatim; its worktree, branch, commit sha,
`node --test` result for `tests/rehearsal.test.mjs`, pushed branch, draft PR URL;
the final `REHEARSAL.md` showing both lines in order; every operator keystroke
between Step 3's activation and Action B's completion, counted and listed)_

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

## The run ledger — criterion 7

Criterion 7 asks for one record of the whole run. Fill this in as you go
rather than reconstructing it afterwards.

| Field | Value |
| --- | --- |
| Run date | |
| Arcadia revision (`main` HEAD) | |
| Broker revision after Step 0 | |
| Production grant (scope / revision / epoch) | |
| Remote-preservation grant | |
| Integration grant (separate, per Step 2.5) | |
| Mechanical-completion grant | |
| Reconciliation entry point verified (`arcadia session reconcile`) | |
| OpenCode provider / binding / model | `opencode-cli` / `opencode-zen` / `opencode-go/deepseek-v4.1-flash` |
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
| Pointer advanced to `confirm-rehearsal-marker` | *(acceptance: yes)* |
| Action B worktree prepared by the controller | *(acceptance: yes)* |
| Action completion / pointer writers used | *(acceptance: canonical writers, never preservation alone)* |
| Actual Plan and Project document effects | |
| How Action B's Session was started | *(hand-run `opencode run` line expected; paste it verbatim)* |
| **Other operator interventions after Step 3** | *(acceptance: 0; list every one)* |

## Step 6 — settle

When every `Evidence:` blank and every ledger row carries real output, this
document is the proof Artifact `expected_artifact` names. Bind it with an
Agent Ask:

Each `evidence` entry is a mapping with exactly `criterion`, `status`, and
`note`. `criterion` must repeat the plan's text **verbatim and in the plan's own
order** — copy the seven criteria from the "Scope" section above, not from
memory. `status` is `met`, `failed`, or `skipped`.

```yaml
agent_ask: v1
request_id: complete-prove-zero-prompt-production-loop-<yyyy-mm-dd>
project: arcadia
intent: complete
target_ref: action/prove-zero-prompt-production-loop
candidate_revision: <sha of the commit carrying the filled-in runbook>
desired_result: Record the real-host zero-prompt rehearsal result.
evidence:
  - criterion: "Use the Zero Prompt Rehearsal fixture Project with two dependent small Actions and the same OpenCode provider profile, protected launchers, workspace root, dependency bridge, build, test, SQLite, Git, network and pull-request path that managed production will use."
    status: met
    note: "Step 1 — fixture confirmed, not rebuilt; provider opencode-cli via the opencode-zen binding."
  - criterion: "Before the counted run, record and verify every required launch, remote-preservation, integration and mechanical-completion grant, with its exact fixture scope, policy/receipt identity, freshness and limits. A missing, stale or insufficient grant stops preflight before the run begins; no new approval halfway through the proof is part of a successful run."
    status: met
    note: "Steps 2-2.5 — production, remote-preservation, integration and mechanical-completion grants recorded before the run; none added mid-run."
  - criterion: "Before the counted run, identify and verify the exact supported host entry point delivered by reconcile-session-exits-to-next-move and advance-approved-production-work that drives reconciliation and canonical completion without the continuous worker. Record its command and the revision-pinned arcadia-go-broker-opencode host-controller invocation that prepares Action B, or the supported combined entry point if the prerequisite implementation provides one. Current go prepares work but does not supply the missing reconciliation bridge; until a supported bridge is shipped and verified, preflight refuses. Any explicit host-controller invocation is a visible, predeclared operator step, not autonomous execution."
    status: met
    note: "Preflight — arcadia session reconcile verified against the shipped bridge; the revision-pinned arcadia-go-broker-opencode invocation was recorded as a visible operator step."
  - criterion: "From one bounded activation and the predeclared visible host steps, Arcadia prepares Action A's worktree, advances and monitors it, edits, builds, tests, preserves its exact branch and authorized draft pull request, reconciles evidence through the implemented canonical completion bridge, advances the governed pointer to Action B and prepares Action B's worktree. Record and verify the actual authoritative Action completion and both pointer document effects; a successful command response alone is insufficient."
    status: met
    note: "Steps 3-4 — reconciliation ran, the pointer advanced to confirm-rehearsal-marker, and B's worktree was prepared; actual Plan and Project document effects confirmed."
  - criterion: "After protected preservation, prove the host controller reports commitsToIntegrate greater than zero and integrates the exact candidate branch under the separately explicit integration grant recorded in preflight. Prove acceptance/completion and pointer advancement use their existing governed writers and applicable authority, never preservation alone."
    status: met
    note: "Step 2.5 — the host controller reported commitsToIntegrate greater than zero and integrated the exact candidate branch under the separate grant; completion used the canonical writers."
  - criterion: "Keep zero sandbox approval prompts, zero hidden interventions and fully unattended execution distinct. This rehearsal requires the first two, permits only the predeclared visible operator steps, and makes no fully unattended execution claim. prove-two-action-unattended-production owns unattended Action B launch and execution after the continuous worker exists."
    status: met
    note: "Steps 3-4 — 0 prompts and 0 denials; Action B started by hand and recorded as a visible step, not claimed as unattended."
  - criterion: "One proof Artifact records preflight grants, exact supported entry points, all predeclared manual steps, and every command, profile, writable root, sandbox denial, approval event, worktree, branch, revision, Session, Action, validation result, commit, push, pull request, actual document transition and operator intervention. Zero sandbox approval prompts and zero hidden interventions are acceptance conditions; record visible manual invocation explicitly and never label it autonomous execution."
    status: met
    note: "This runbook, filled in, at <sha>."
```

Preview it, then apply with `--operator` — a `complete` settlement refuses to
apply without it:

```sh
arcadia agent-ask preview --file agent-ask.yaml
arcadia agent-ask settle --proposal <id> --request-id <rid> \
  --disposition accepted --operator
arcadia agent-ask settle --proposal <id> --request-id <rid> \
  --disposition accepted --operator --apply --preview <fingerprint from the line above>
```

The settle dry run prints its **own** fingerprint, which is not the preview's —
pass that one to `--apply`, with identical flags between the two calls.

`complete` refuses any criterion that is not `met`, and refuses a stale
`candidate_revision`. If a sandbox prompt or denial appeared, criterion 6 is
genuinely `failed`: do not force it — record the finding and stop. A refused
settlement there is the machinery working.

Keep `~/tmp/arcadia-zero-prompt-rehearsal`, its branches, and its draft pull
requests until settlement lands: they are the primary evidence. Delete the
fixture repository and retire its Project only afterwards.
