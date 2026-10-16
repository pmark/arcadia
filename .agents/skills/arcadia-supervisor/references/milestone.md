# Optional milestone acceptance workflow

Adapted from the existing Arcadia release-manager skill. This is a derived
evidence workflow, loaded only for an explicit milestone assignment.

## Derive the gap

Resolve requirements from governed records and dependencies. Prefer canonical
settlements, revision-bound evidence and installed-host receipts over chat
claims or derived summaries. Name contradictions and verification gaps rather
than silently choosing the convenient account. A current source change can
invalidate older passing evidence.

Maintain a small derived map of milestone requirements, prerequisite edges,
status, evidence/revision, owner, next safe move and gate. Use these statuses:
`proven`, `in progress`, `ready`, `awaiting operator`, `externally blocked`,
`unproved`, `conditional/deferred`. They describe this projection, not new
canonical Action statuses. Keep implementation, approval, publication,
installation and live proof distinct.

Measure the gap with unmet mandatory criteria, the dependency-ready frontier,
current blockers and which requirements each unblocker unlocks. Use counts only
when the criterion set is stable and explicit; never turn backlog completion
into a readiness percentage. No ETA without defensible remaining-work estimates.
Explain any scope change before comparing counts. Keep deferred expansion off
the immediate path unless its governed trigger fires; retain any conflicting
mandatory release gate as an unresolved scope question.

## Make each cycle useful

Batch independent read-only checks. List relevant chats once, use the host’s
read-only session status/wait tools with returned cursors when available, and read
history only for changed/new signals. Retain IDs of dispatched or pending chats
even if they disappear from the recent list; an unknown create outcome is not
permission to create a duplicate. Flag inaccessible hosts as a coverage gap.

When the host lacks session tools, use current repository evidence and existing
read-only Arcadia commands, retain a file handoff, and report the observation
gap. Do not invent session state or a substitute runner; continue independent
authorized work.

Then choose the smallest move that reduces the acceptance gap:

- Verify and attach missing evidence, reconcile stale projections, or diagnose
  an exact failure using bounded deterministic checks.
- Prepare a reviewable repair, Agent Ask or executable operator gate within
  current authority; do not stop at describing an automatable remedy.
- When explicitly authorized to coordinate, send a precise continuation to the
  existing owner, or dispatch one governed, dependency-ready, unclaimed Action
  through the supported host path. Preserve the approved packet and ownership.
- If no authorized path can advance, prepare the single operator intervention
  with greatest demonstrated unblock value. Do not invent parallel work,
  rerun an unchanged refusal, or cross a gate to manufacture activity.

Separate role invocation from messaging/dispatch authority. Sending another
chat a prompt, creating a chat, launching a Session, or starting subagents needs
the applicable explicit authorization. Never launch a second writer against
an occupied candidate. Waiting for CI/review is observable waiting, not verified
coding progress; continue any authorized independent useful work.

## Recover stuck agents

Titles and idle/active flags are leads. Confirm the latest failure, last proven
progress, affected Action/candidate and revision, attempted recovery, preserved
output, and the event that permits retry. Deduplicate old chats for the same
Action; do not reissue a superseded remedy or a consumed one-shot button.

Distinguish an agent-repairable check/conflict, exhausted repair budget, missing
authority or input, host/capacity failure, governance refusal, and an observation
gap. A fixable red check is work for its owner, not automatically an operator
block. A quiet or long-running session is not automatically stalled: compare
progress evidence against its declared deadline and allowance.

Provide the owner, when messaging is authorized, an exact continuation with
criterion, failure evidence, candidate, permitted recovery, validation and stop
condition. Confirm recovery through new receipts and actual resumed work.
Process launch or a promise to continue does not resolve a blocker. Do not kill,
reset, discard, edit a live owner's files, or steal a claim to free capacity;
use existing governed recovery mechanisms with their required authority.

For operator help, first finish safe preparation. Reuse an existing matching
`/runs` action and verify its final reviewed contract, fresh preconditions and
live listing before presenting it as ready. If a browser security policy or
other boundary prevents verification, record that limitation without a
workaround. Follow local script/descriptor requirements when preparing a new
gate. UI-only or free-form input may require a direct instruction or question.
Every numbered choice states its consequence. Never ask again for a settled
decision merely because mechanical execution remains.


## Persist and finish

Maintain one derived checkpoint using [its contract](checkpoint.md), not a
second scheduler or authority store. Update on meaningful changes. Report
evidence gained, unmet mandatory criteria, verified progressing Sessions and
the smallest safe move; deduplicate unchanged blocker alerts. Keep requested
notification cadence, automation ID/state, last alerts and pending operations.
An existing stopped or paused timer remains stopped until an explicit resume
request. Do not create a timer merely because this skill is invoked.

Declare the milestone achieved only when every currently mandatory criterion
has current evidence and required operator judgments. Approval, implementation,
installation, publication and live proof remain distinct. Preserve a final
handoff; stop a requested watch on operator request under its existing authority.
This reference introduces no scheduling, messaging, dispatch or production grant.
