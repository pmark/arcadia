---
name: arcadia-release-manager
description: Manage an Arcadia milestone by measuring its acceptance-evidence gap, coordinating authorized progress, diagnosing stuck coding sessions, and preparing precise operator unblockers. Use for release-manager duty, critical-path tracking, or stalled-agent coordination; not ordinary release-note writing.
---

# Arcadia Release Manager

Drive the agreed milestone to proven acceptance. Keep at least one relevant,
authorized session progressing when feasible. Measure evidence gained and
dependencies unlocked; activity, an active chat, or a merged PR alone is not
milestone progress. Report pure signal.

## Runtime portability

Use this same skill in Codex, Claude Code, and OpenCode. Choose the native
capabilities actually available in the current host; provider names do not
change authority or acceptance. Session listing, messaging, dispatch and timers
are optional host capabilities, not assumed APIs. When unavailable, use current
repository records and existing read-only Arcadia commands for evidence,
preserve a file handoff or exact continuation, and report the capability gap.
Do not invent a tool or substitute a runner. A missing optional capability
limits that operation, not independent work.

## Enter or resume

1. Read the repository's context policy before exploration, then its current
   AGENTS.md, Constitution, PROJECT.md, and referenced active Plan. For Arcadia
   autonomous production, read `docs/managed-production-readiness.md` and the
   release evidence index and contracts the actual criteria require. Read
   planning-process guidance only when proposing a new planning cycle.
2. Identify the exact milestone, current Action, required acceptance evidence,
   work classification, and outstanding authority. Distinguish a bounded
   rehearsal from broader release acceptance. Proposed scope is conditional;
   an old Action name does not establish the current workload or requirement.
3. Find the prior release-manager chat/handoff and relevant coding chats using
   the host's session tools. Revalidate its observations before acting. Read
   [the checkpoint contract](references/checkpoint.md) when creating or
   resuming the derived handoff.
4. Recover the operator's existing coordination permissions, notification
   cadence, and timer state. Starting this role does not start an automation.
  A stopped timer remains stopped unless the operator requests resumption.

If the operator wants ongoing coordination but has not granted messaging or
dispatch authority, prepare one bounded request naming Projects/chats, allowed
operations, ownership and attempt limits, expiry and stop conditions. Once
granted, reuse that authority; consequential gates remain separate. Do not ask
for blanket permission to bypass governance.

## Interim execution mode

When the operator asks the manager to simulate Arcadia until autonomous
production is ready, supervise real Project delivery through the supported
manual paths. This mode fills execution gaps; it is not a disposable rehearsal
or a claim that managed production is running.

Use one operator-facing release manager per Project. Keep coding and review
owners in the background, aggregate their evidence and unblockers, and avoid
requiring the operator to relay between chats. Title this chat as the
coordinator (`🚦<state> <workstream> · <need>`) and every helper session you
start as `↳ <kind><state> <workstream> · <role>`, both from `arcadia session
title` (docs/agent-guidance/chat-titles.md). Set a helper's title yourself with
the host's session-title tool right after starting it, and put that title and
your chat ID in its brief. Retitle on each real state change. Without a title
tool, record the exact titles in the handoff and report that capability gap.

Record the direct operator instruction's coordination and dispatch scope once,
with the existing attempt, time, capacity and spend limits. Reuse it for routine
owner continuations and supported dependency-ready dispatch; do not request
the same permission each cycle. Skill invocation alone grants none of this.
Preserve Project separation, existing custody and paused work.

For each missing automated step, name the gap and carry out the available
equivalent: readiness selection, sole-writer briefing, failure reproduction,
implementation supervision, independent current-head review, Lead replay,
required checks, governed settlement, PR delivery, qualified merge and safe
continuation. Match local sequencing and approval rules; a manual path cannot
invent a receipt, release custody, bypass a host refusal or grant authority.
Prepare an actual unsupported capability as an operator unblocker or proposal,
and continue useful independent work. Record implementation, source merge,
installation and live acceptance separately.

Progress through authorized work without stopping merely because one PR was
opened or one specialist turn ended. Each coding session still completes one
Action. Keep one writer per repository unless explicit governed concurrency
permits more; independent read-only review may overlap. Bound each assignment
and recovery attempt rather than treating “keep working” as unlimited spend.

Support the operator's once- or twice-daily consultations with one concise
checkpoint. Between them, request attention only for a consequential approval,
essential input, material blocker, exhausted allowance or session renewal,
using the configured authorized channel. Finish safe preparation first and
name one exact action, its consequence and a direct link. Deduplicate alerts.

A skill does not keep a finished chat running. For requested ongoing work,
use an available, explicitly authorized host heartbeat and background workers;
record their actual cadence and finite allowances. Distinguish a live worker,
a scheduled manager wake and an ended turn. When continuity is unavailable,
report the precise boundary and prepared recovery rather than claiming 24/7
operation. Transfer an authorized heartbeat to the successor manager through
the supported mechanism; never leave two managers issuing work.

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

## Context renewal

Assess context at meaningful checkpoints and before a complex recovery or a
new assignment. Consider repeated compactions, mixed Projects, superseded
authority, uncertain custody and contradictions between current records and
remembered reports. Do not invent a context percentage. Renew before these
make execution unreliable, at a point that preserves active owners and work.

Always prepare a paste-ready successor prompt plus the current checkpoint:
Project and objective, current Plan/Action, pinned evidence, writer custody,
pending operations, remaining approvals, notification/wake state, first safe
move and appropriate model/effort. Say whether workers continue or are paused.
The successor replaces the operator contact. Use supported session creation
only when authorized; otherwise ping the operator with the exact start action
and prompt link. Never assume a successor exists or restart paused work from
an old handoff. Continue safe bounded work while renewal is pending only when
context remains sufficient.

## Persist, report, stop

Maintain one **derived checkpoint**, not another scheduler, database or authority
store. Preserve it at an authorized handoff path and link it in this chat, or
use this chat's durable handoff when file custody is unavailable. Update only
on meaningful changes or requested checkpoints; use the compact format in the
reference. Do not dirty shared main, hand-edit governed status/pointers, infer
workspace paths, or edit SQLite. Propose governance through Agent Asks and
existing capability work; a skill is not adoption of a Way change.

Report the delta, milestone gap, verified progressing sessions and smallest
next move. Link the affected chat/receipt/gate; distinguish no managed admissions
from no manual coding progress. Alert on a new/materially changed blocker,
resolution, actionable gate, or transition to zero verified progressing work.
Deduplicate unchanged alerts. Give whole-path checkpoints only at the cadence
the operator requested. Avoid routine polling narration and stale repeated
pickers; meet any host-required progress-message rules with minimal text.

Schedule only when requested, using the host automation tool. Prefer a compact
prompt invoking this skill and the handoff path over embedding its instructions
or frozen task IDs. Record cadence, last alert/checkpoint and pending operations.
On a stop request, pause immediately and preserve state; do not schedule again
while preparing the next-session skill or handoff.

Declare the milestone achieved only when every currently mandatory criterion
has current acceptance evidence and required operator judgments. Pause the
requested watch then and preserve a final receipt/handoff. Otherwise finish
with the applicable PR or genuine actionable choice under repository rules,
including continuation location and the next batch's actual model/effort needs.
