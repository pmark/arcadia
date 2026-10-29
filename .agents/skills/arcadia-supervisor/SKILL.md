---
name: arcadia-supervisor
description: Carry out assigned Arcadia supervision on a friction or exception signal or session completion, using bounded diagnosis, bug triage and insight harvesting. Load the optional milestone workflow only for explicit release acceptance. Starts no watch; grants no messaging or dispatch authority.
---

# Arcadia supervisor

Supervision is a Behavior: a named procedural contract within assigned
authority. Supervisor remains an assigned relationship and duty, not an eighth
registered role.
Decision 0113 establishes delegate → Lead → Project supervisor → operator;
Decision 0121 amends its deterministic-only behavior with event-triggered
light-tier supervision on friction/exception signals and at session end,
possibly covering several Sessions. Read those exact approved Decisions and
[the shared role protocol](../arcadia-role/SKILL.md) before acting.
An operator-facing supervisor chat titles itself with 🚦 and each helper chat it
starts with `↳`, using `arcadia session title` as that protocol describes.

## Enter or resume

Resolve the actual assignment, supervised Sessions/owners, candidate revisions,
signal evidence, permitted operations, finite token budget, per-session cap and
stop condition. Use light tier when inference is authorized and sufficient;
read deterministic evidence first. A missing budget/cap is an explicit gap for
future automatic invocation, never an invented unlimited allowance.

Read the indexed native-app, peer-watch, learning and Ask procedures for the
operation. Revalidate prior handoff/authority and pending operations. Silence,
activity flags and missing recent chats do not release ownership or prove a
stall. Invocation grants no permission to message, dispatch, spawn, settle,
merge, install or operate production. Paused watches stay paused until the
operator requests resumption. No automatic watcher or scheduler is installed
by this skill.

## Handle a signal

1. Bind the signal to the exact Session, Action, owner, revision, observed
   failure, last proven progress and allowance. Distinguish stale evidence,
   fixable checks, exhausted recovery, missing authority and an observation gap.
2. Read matching Notes To Self entries, then perform bounded read-only
   diagnosis. Prepare the smallest reviewable recovery with validation and a
   stop condition. An unchanged refusal earns no retry; a new receipt or changed
   precondition must justify it. Do not edit a live owner's candidate or steal
   a claim.
3. Triage a defect as an immediate-fix proposal when it blocks the authorized
   acceptance path; otherwise record tech debt with an explicit revival trigger
   in the owning repository's Issue under applicable authorization. Immediate
   triage is not approval to execute. Preserve failed receipts and deduplicate
   against existing reports. **`arcadia bug` is unavailable in this foundation**;
   use the existing indexed defect/Issue and Agent Ask paths, and name that gap.
4. Deliver a precise continuation only under explicit messaging authority;
   otherwise persist it for the operator. Escalate genuine authority/input gaps
   through a governed Ask or Decision. Use numbered chat choices with
   consequences when operator judgment is required.

## Mandatory recovery trigger

On the first persistent refusal diagnose request classification and route.
After two unchanged refusals without evidence gain, or an explicit stop-the-line
request, enter [Hacker mode](../arcadia-hacker/SKILL.md) before further retries.
Repeated discussion also counts. Require one bounded recovery pass and a verified
existing route or precise unblocker; do not replace the agent to reset the budget.
Keep actual model/effort, custody and sole writer explicit. This is diagnostic
behavior within the supervision assignment, not permission to spawn, message,
steal a claim, increase spend or bypass a refusal.

## Complexity signals

Route a concrete maintainability finding through the Project's indexed
`docs/agent-guidance/code-simplification.md` and existing planner/critic/implementer
responsibilities. Keep one writer and the remaining allowance. Do not commission
routine cleanup after every Session or delay an urgent repair for cosmetic work.

## At a friction/exception signal or session completion

Harvest useful ideas, corrections, hypotheses and friction at a signal or session
end, but never delay capture or wait for the Lead. Retain raw evidence with
`arcadia learn "<exact text>" --scope project:<slug>`; bare capture is
`observation`/`high`, so use `--provenance inference --confidence low --evidence
"<source>"` for uncertainty/external evidence. Capture is zero-model evidence,
not authority: no Action, Decision, promotion or rollout. Exact replay records
supplied evidence/observations (otherwise a receipt); similar wording remains
separate. Ask the Lead only under messaging authority; otherwise prepare handoff
questions. Do not execute a harvested suggestion.

Hand back the signal disposition, evidence gained, open defects and proposals,
insights, exact owner/candidate, authority/budget remaining and next safe move.
An end-of-session pass cannot prove the milestone complete. Automatic event
wiring, budget enforcement, supervisor assignment persistence and the bug
utility remain deferred until their governed implementation is authorized.

## Optional milestone responsibility

Only for an explicit milestone/release assignment, read
[the milestone workflow](references/milestone.md) and
[checkpoint contract](references/checkpoint.md). Preserve acceptance-gap,
dependency, recovery, notification-deduplication and paused-watch state from the
existing release-manager workflow. This skill does not deprecate or replace the
installed `arcadia-release-manager`; retirement requires demonstrated coverage
and a governed migration.
