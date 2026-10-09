# Operator actions

> **Deprecated 2026-10-09:** the dashboard `/runs` page is deprecated, replaced by
> `/production`, `/actions`, `/review` and an upcoming `/todo` page (operator
> instruction, 2026-10-09). Do not build new operator UI on `/runs` or send the
> operator there for new steps. The generated operator-script library and the
> governed execution path it backs are unchanged until a replacement is governed;
> this note claims no new authority.

Read before preparing a bounded operator choice or publishing its /runs action.
The compact bootstrap and CONSTITUTION.md still bind; a button grants no authority.

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
  approval, credential, spend or merge, and never as a substitute for the Agent
  Ask or PR notifications above; those keep their own paths. If you need an
  answer, stop at a Decision or picker instead.
- Success means *queued*; the Discord bot delivers on its next poll. A non-zero
  exit means it was not queued: say so in the handoff rather than assuming the
  operator was told. Report a ping you could not send under the notification
  truthfulness rule in the PR procedure.
