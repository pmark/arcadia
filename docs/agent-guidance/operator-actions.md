# Operator actions

> **Deprecated 2026-10-09:** the dashboard `/runs` page is deprecated, replaced by
> `/production`, `/actions`, `/review` and an upcoming `/todo` page (operator
> instruction, 2026-10-09). Do not build new operator UI on `/runs` or send the
> operator there for new steps. The generated operator-script library and the
> governed execution path it backs are unchanged until a replacement is governed;
> this note claims no new authority.

Read before preparing a bounded operator choice or publishing its /runs action.
The compact bootstrap and CONSTITUTION.md still bind; a button grants no authority.

### The host is offsite

Operator direction, 2026-10-11: every rehearsal and supervised run must behave
increasingly like the way sessions are ultimately meant to proceed, and the
operator (and soon alpha testers) must never need to act directly on the host
machine. Design and report as if the host were permanently offsite.

- Never hand the operator a terminal command, a file to edit, a service restart,
  a checkout fast-forward or an install as the way forward. Offer only
  remote-reachable surfaces: an `/actions`, `/review` or `/production` button, a
  Discord reply, or a PR merge (the operator's merge only where Decision
  0060/0080 leaves it to the operator). If none exists for a needed step, that
  missing surface is the blocker: say so plainly.
- Until a remote surface replaces them, existing descriptors, runbooks and the
  `/runs` script library that name the Terminal panel or `/runs` as a fallback
  (for example G8) stay valid and are not removed or refused. Treat each as a
  defect to record under the next bullet; for any new step offer only the
  remote surfaces above.
- Every host-touching step you find (reinstalling the broker after main moves,
  restarting services to load merged code, approving a Decision by CLI,
  reading a path on disk to learn why something refused) is a defect: record
  it as an Issue (a defect) or an Agent Ask proposal (a missing capability)
  naming the remote surface that should replace it.
- Prefer designs that self-heal or fail with a remote-visible reason and a
  one-press remedy, never a shell command or a path on disk.
- Agents may use the host for their own work; the operator's progress must not
  depend on it.

### Make operator steps executable

Whenever the operator must provide input or perform one or more steps after an
agent handoff — approving a Decision, selecting a prepared choice, merging a
pull request, installing or restarting local software, running a credentialed
command, completing manual QA, or carrying out any other operator-only action
— **do not leave that input or those steps as prose commands alone.** When the
input can be represented as a bounded executable choice, give the operator a
button for it in the `/runs` operator-action library.
Create or update a paired generated operator script and descriptor under
`artifacts/generated/operator-scripts/`, following the format already present
there:

- an executable `<id>.sh` with only `run` and `--describe` entrypoints;
- an `arcadia-operator-script-v1` `<id>.json` descriptor naming the problem,
  desired effect, exact operator command, authority, success, and failure;
- `repeatable: true` only when repeating the completed operation is safe and
  useful; omit it or set it to `false` for approvals and other one-shot input;
- bounded waits, fail-closed preconditions, an idempotent retry story, and a
  timestamped `runs/<timestamp-pid>/` log plus failure handoff; and
- one command for the operator to run that performs every safe, automatable
  step in order and prints the resulting receipt or exact remaining blocker.

That directory is the dashboard's execution path. A valid pair appears
automatically on `/runs`; the browser never supplies a command or filesystem
path. Put every custom executable operator action there so the operator can
run it from the phone. Prefer reusing or safely generalizing an existing
library entry over creating a near-duplicate. Build common recurring actions
as reusable scripts when their target and current authority can be discovered
and validated at run time. Keep one-off scripts when the authority is specific.
For example, a Decision-approval script must pin or read the exact Decision,
answer, proposal fingerprint, and expected open state, then refuse stale or
different state; never turn it into a blanket approval command.

### Publishing `/runs` actions

`/runs` reads the main checkout's generated-script library at
`artifacts/generated/operator-scripts/`; it does not discover candidate
worktree files. Publish the executable `<id>.sh` and descriptor `<id>.json`
there, then verify the live `/api/operator-script` response lists the action
before handoff. A descriptor must include `schema`, `id`, `title`, `script`,
`problem`, `desired_effect`, `authority.does`, `authority.never_does`,
`success.effect`, `success.next`, `failure.effect`, and `failure.next`; its
script must be executable and expose only `run` and `--describe`.

When an operator script delegates bounded authority, tag its descriptor
`kind: "grant"`. Follow the [Grant definition](../arcadia-semantics.md#grant):
it is one-shot, pins its policy revision, names its scope and expiry, refuses
precondition drift before mutation, records a receipt, and states what it
never does. Do not use the tag for ordinary preparation, observation, or
deterministic completion evidence.

An operator script that settles Agent Asks declares the exact scope it may
settle: `agentAsk` (one proposal), `planAmendment` or `planActivation` (the shared runner), or, for
an accepted bulk cleanup, a one-shot `agentAskRejections` block naming the
reviewed list (`manifest`, `sha256`) and every proposal id it may reject. The
settlement guard then admits only disposition `rejected` for those ids.

An operator-owned workspace-config change uses a pinned `workspaceConfigEdit`
block (`arcadia-workspace-config-edit-v1`: exact absolute `workspace`,
`operation: "remove"`, an allowlisted `field`, its exact `expected` value) and
exactly the `workspaceConfigEditLauncher` text, which runs
`scripts/workspace-config-edit-worker.ts`. The worker refuses a different
resolved workspace, field drift, non-canonical JSON, Active or unreadable
production, and any second press after a recorded success; it removes only that
key and records before/after sha256 in a durable receipt. The field allowlist in
`src/operatorActions/workspaceConfigEditContract.ts` is the only way to widen it,
by reviewed code change. The inverse is never built as a card; the receipt names it.

One-shot actions (`repeatable: false`) never delete themselves: `/runs` keeps
their disabled succeeded state and receipt as the durable audit trail. Keep a
reusable action repeatable only when rerunning is safe and useful. Do not add
operator actions for deterministic completion evidence: the agent validates,
preserves, and settles it automatically. Buttons are for genuine external or
irreversible authority only.

The dashboard records each launch as available, running, succeeded, or failed.
It polls while work runs, exposes failure instead of treating process launch as
completion, and disables a successful one-shot action. A reusable action stays
available after success. Do not work around that lifecycle with background
wrappers or by resetting its state merely to make a stale button clickable;
repair the script or descriptor, preserve the failure receipt, and retry only
when the represented operator action is still live.

Before adding a script, inspect the existing descriptors for the same desired
effect. Reuse an exact match. If extending a reusable entry, preserve its
current callers and safety boundaries and update its descriptor. Do not delete
an old library entry merely because the immediate handoff is over: repeatable
operations are the beginning of the shared script library. If the operator's
input is genuinely free-form and cannot yet be represented safely by the
button contract, ask for that value directly, then generate the narrow script
that validates and applies it; do not smuggle arbitrary arguments, shell text,
or paths through the dashboard endpoint.

Generating a script does not widen authority: a merge, deployment, approval,
credential use, or other operator gate stays gated until the operator runs the
script. The script must state those effects plainly and must never hide manual
Git reconciliation, governance settlement, or another unsupported shortcut
inside automation.

### Every Project has its own library

You never need Arcadia's checkout to give the operator a button. The dashboard's
`/actions` page reads Arcadia's library and, for every registered Project, that
Project's own `artifacts/generated/operator-scripts/` in its **main checkout**
(the registered repository path). An entry there is published only when its
descriptor names its Project (`"project": "<slug>"`); the card shows that name
and opens at `/actions/<slug>--<id>`. The same contract, validation, one-shot
lifecycle and receipts apply. Run state and receipts for a Project entry are
kept on the host beside Arcadia's library, never inside the Project checkout.
A Project entry may not use `planAmendment`, `planActivation`,
`workspaceConfigEdit`, `next_after`, `agentAskRejections`, or an `agentAsk`
scope without the pinned `agentAskSettlement` below: those runners and hints
exist only in Arcadia's library, and a bare request id is not bound to the
Project, so it could settle another Project's Ask under this one's name. The
dashboard and the check refuse such an entry (`UNSUPPORTED_PROJECT_ENTRY`), and
the settle path refuses any entry that names a Project other than the Ask's.
Check a Project library with
`node --import tsx scripts/check-operator-scripts.ts --project <slug> <repository>`
from Arcadia's checkout (or `pnpm check:operator-scripts` there, which checks
every registered Project's published entries too).

**Agent Ask settlement is a button, never a command.** When an Ask you
submitted needs the operator's settlement, publish a pinned one-shot button
instead of telling the operator to run `arcadia agent-ask settle`:

```sh
arcadia operator-action settle-ask --project <slug> --proposal <request_id> \
  --fingerprint <proposal preview fingerprint> --disposition accepted [--top]
```

Run it from your own worktree of that Project. It checks the recorded proposal,
its full fingerprint and that nobody has settled it, previews the settlement
(writing nothing), and writes `settle-<request_id>.json` and `.sh` into this
checkout's library. Commit both and include them in your PR; the button appears
once the PR is in the Project's main checkout. Arcadia's own repository is the
exception: `artifacts/generated/` is git-ignored there, so there is nothing to
commit. For a Project whose registered repository is Arcadia's, pass
`--dir <Arcadia's main checkout>` so the pair lands in the host-local library
`/actions` reads, as Arcadia's other buttons do. The card states the pinned
Project, proposal, disposition and placement from the pin itself. The press runs Arcadia's shared
runner, which re-checks the pin, refuses a stale fingerprint, another proposal
or an Ask settled another way, applies exactly the previewed settlement through
the canonical settle path, and replays rather than settling twice. It never
pushes, merges or answers the Decision a settlement opens; its settlement commit
stays local to the main checkout until published.

### Answering a Decision: letters, and when it is not answerable

Operator direction, 2026-10-21. A Decision is answered by choosing a letter, never by typing its wording.
Every Decision raised from a Decision document carries an `answerMenu` (`src/decisions/answerMenu.ts`):
A, B, C... from the document's own `options` (each with its consequence and the recommended marker), or
Approve / Reject / Defer when the document offers none. Dashboard `/review` shows one button per letter,
Discord lists the letters and accepts a reply of just `A` (or `0132 A` without replying), and the CLI is
`arcadia review answer <id> <letter>`. An agent may only relay the letter the operator chose; it never picks one.
An Agent Ask `decision` draft carries its choices as `options` so letters always exist.

A Decision is answerable only when its document is on the Project's checkout, because the answer is written
there. A settlement from a candidate worktree opens its review item before the candidate merges (or before its
commit is even pushed), so the menu then reports `answerable: false` with the remedy ("merge the pull request
for branch X", or "the settlement commit is not published") and every surface shows that instead of an answer
form. It becomes answerable by itself once the document is on the main branch; nothing needs repairing. Never
send the operator a path on disk.

Two kinds of Ask are refused here. A `complete` Ask is settled by the agent
that proves it, in its candidate (`arcadia agent-ask settle`), not by an
operator button. An existing-Plan amendment (`intent: plan` with `target_ref`)
needs the shared Plan-amendment runner, which only Arcadia's library can run,
and no generator writes one for a Project yet. For that amendment, keep the
submitted Ask. In your handoff, name its request id and fingerprint as waiting
for the operator. Submit a proposal Agent Ask asking for its Plan-amendment
button. Handing the operator a terminal command for any of this is a defect,
not a fallback.

### Retiring a library entry

A legacy local entry that `pnpm check:operator-scripts` refuses, and that can
never run honestly again (already succeeded, superseded, or pinned to stale
state with no derivable declaration), may be retired from that gate only by
adding an exact entry to the tracked
`src/operatorActions/legacyRetirements.json`: its id, the sha256 of its `.json`
and `.sh`, its outcome, and the reason. The checker skips an id only when both
hashes match and reports it under `retired`; any new, renamed or changed file
gets full validation. No globs, prefixes or id-only entries. Retirement never
changes `/runs`: the shared contract still refuses to load or run the entry.
Never edit, move or delete ignored local descriptors, scripts, `runs/state` or
`runs/receipts` by hand; state and receipts stay as the audit trail. A retired
operator choice that was never executed is discarded; if it is still wanted,
re-ask through a fresh Agent Ask and publish a new declared entry.

If a load-bearing detail is unclear — repository, pull request, workspace,
merge method, service target, credential boundary, desired effect, or recovery
route — ask the operator before generating the script. In a continuation where
a previous agent established the setup, inspect its generated descriptor,
run/failure handoff, and thread first; if the needed detail is still absent,
ask that previous agent or the operator rather than guessing. Do not finish the
handoff until the script and descriptor match the final reviewed state.

`docs/agent-continuation-protocol.md` carries these rules with the reasoning
behind each. It is a reference, not a prerequisite: everything you must do is
stated above.

### Per-run START cards (Decisions 0156, 0157 and 0161)

Do not hand-write a START card. One shared, independently reviewed executor,
`scripts/start-run.sh`, runs every START; a card is only a thin launcher plus a
pinned descriptor, so per-card review is small.

- **The card** is `<id>.sh`, exactly `startRunLauncher(id)` (three lines, no logic;
  `check:operator-scripts` refuses any other text), and `<id>.json`, a one-shot
  `kind: "grant"` descriptor with `expires_at` and a `startRun` block
  (`src/operatorActions/startRunPins.ts`: reviewed main sha, executor sha256,
  workspace, Plan, ordered Actions, production revision and epoch, queue
  revision, worker label, Decisions, files, preserved receipts). A Plan that is
  still a draft embeds its `planActivation` block beside it (the only runner that
  may). Get the pins from live state with
  `arcadia start-run pins --plan <slug> --actions a,b,c --provider claude-code-cli --expires-hours <n>`;
  it writes nothing and emits no script.
- **What one press may do:** fast-forward the clean main checkout to the pinned sha
  only, `go-broker ensure`, then reinstall the pinned worker label from that
  compiled release (`worker install --replace-label`, run by the release itself,
  so the plist is protected) and restart it so the worker is bound to the pinned
  release and handler; then (Decision 0161) reuse a fresh usage receipt of that
  bound worker or run the Decision 0143 sequence once: claim today's Decision
  0141 sequence (America/Los_Angeles), one Haiku renewal, and only on its success
  one diagnostic Decision published to main through the Agent Ask route and one
  bound-worker usage check. START needs that check to succeed, the credential to
  expire more than 5 minutes later and both usage windows below 100%. Then
  activate the pinned Plan and START production (every older START gate stays;
  the installed-revision pin is now the reviewed-revision pin, checked by
  `production runtime-check`; the retained pre-press sign-in receipt pin is
  gone). Preflight refuses, before any mutation, when today's sequence is
  already in the ledger. The allowance is consumed at the first mutation; there
  is no rollback, a later failure leaves the runtime upgraded and an activated
  Plan active, a renewal or check failure also consumes that day (no retry), and
  only this Grant is returned to Off. A later `scripts/restart-services-impl.sh`
  (restart-arcadia-services) rewrites that same worker label back to a
  source-run worker and so unbinds it; the next START card binds it again.
- **Run it** with `<id>.sh preflight` first (phases P0 to P2, no mutation, no
  /actions context, writes only `runs/<id>/<run>/`), then press the card. Every
  phase rewrites `receipt.json` and `failure-handoff.md` there.
- **Review of a card** is a mechanical diff of its `startRun` pins against the live
  `start-run pins` output, plus an independent critic check of the reviewed-hash
  manifest `reviewed/<id>.json` (`sh`, `json`, `executor` sha256). A change to
  `scripts/start-run.sh` is reviewed once and invalidates the hash in every older
  card, which then refuses.

### Pinging the operator (read-only)

`arcadia ping "<message>"` queues one short Discord nudge. It is not an Agent
Ask: no `request_id`, no governed record, no Decision. Use it when you want the
operator's eyes on something that is not a durable event — you added a button
to the Actions page, a page is ready to look at, something odd turned up and
nobody is blocked. One ping per thing; never for routine progress.

```sh
arcadia ping "Added a Retry button to the Actions page" --kind look --link http://localhost:3020/actions
```

- `--kind look|fyi|attention` (default `fyi`) sets the headline; `--link` takes
  an http(s) URL; `--channel <alias>` aims it at a channel the operator listed
  in `DISCORD_PING_CHANNELS` (an unlisted name lands in the default channel
  with a note); `--agent` names you in the message.
- At most 500 characters. The same message to the same channel inside ten
  minutes is one ping, and at most 30 queue per hour; the command refuses past
  that. Put detail in the PR and link it.
- **Authority: Decision 0084 (approved).** The operator authorized standing
  read-only pings: send one on your own judgment for a look-at-this or FYI item,
  to the default channel or a configured alias. That authority covers nothing
  else; a later Decision can revoke it, so re-read the Decision if in doubt.
- **It is read-only and grants nothing.** Never use it to ask for a Decision,
  approval, credential, spend or merge, and never as a substitute for an Agent
  Ask; the PR-opened and PR-ready notifications are themselves pings (see
  `pull-requests.md`, "PR lifecycle notifications"), while CI-blocked stays an
  Ask. If you need an answer, stop at a Decision or picker instead.
- Success means *queued*; the Discord bot delivers on its next poll. A non-zero
  exit means it was not queued: say so in the handoff rather than assuming the
  operator was told. Report a ping you could not send under the notification
  truthfulness rule in the PR procedure.
