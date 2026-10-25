# Production run playbook

How a release manager prepares, presses, supervises and closes an unattended
managed-production run. It is a method, not authority: every gate in
AGENTS.md, the Constitution and the Decisions still applies. Read it before
preparing a press and again before closing a run. **Update it in the same PR
as any run's readiness re-derivation**: add what that run taught, delete what
it disproved. The record of each run is the dated derivation and failure
table in `docs/managed-production-readiness.md`; this file is the reusable
method distilled from them.

## Goal: the most bugs per run

A live press is the most expensive test there is. One bug per press is the
failure mode to avoid (2026-10-18 to 2026-10-21: planning route, capacity
margin, settled-head QA plan, verdict budget, each cost a press). Before any
press, exercise every post-launch stage offline, fix everything found as one
batch, and only then ask for the press.

## Pre-press gate (all must hold)

1. **Full-chain replay.** Use the existing source-state runner with a pinned
   receipt (`--grant`), explicit initial/repair file maps and the scripted
   executor; test both passing and `fail-repairable` simulated verdicts with
   simulated GitHub writes. The runner now supports completion validation,
   settlement, review/QA, local fake-origin integration and subsequent Action
   admission (#1684), with bounded batched preservation (#1689). Require every
   pinned Action's merge for a complete scope proof. A run that proves recovery
   and a following Action but stops on an inherited hold is only that bounded
   proof. Label simulated reviewers/writes and trusted edits; preserve earlier
   failures, unchanged run bounds and all live holds. Reuse existing full-scope
   and repair evidence when an explicit map accounts for changed inputs and code
   paths; no blanket rule requires two fresh full-scope runs. A partial recovery
   report remains partial and cannot stand in for the full-scope component.
   Never use the replay to reset live attempts or claim actual
   provider/independent-verdict acceptance.
2. **Real validator dry run.** Each pinned Action's named test passes
   `validateCompletionCandidate` (Seatbelt, dependencyRoot = main checkout)
   twice, well under the 900 s bound. A test that needs host tools (tmux) can
   silently skip there.
3. **Real reviewer dry run when review code or prompts changed.** Re-run the
   QA and code-review reviewers on a real past candidate's evidence with the
   new prompt, old vs new.
4. **Process Critic pre-mortem** (`arcadia-process-critic`) on the exact card,
   reading the code paths past the furthest stage any run has reached. Act on
   every finding ranked above "low" before pressing.
5. **Action shape.** Pinned Actions touch only `WORKER_MERGE_SAFE_PATHS`
   (`src/production/workerMerge.ts`), never `src/production` or
   `src/sessions` (those are never repaired unattended). Each Action routes
   to build, not a Decision-gated planning run: `planStepsForWorkItem`
   (`src/execution/skills.ts`) matches lowercase "implement", "code" or
   "prototype" in title, input or `next_action`; "planning" or
   "implementation plan" forces a planning run; a declared `execution:
   build` route outranks both. Criteria pass the deterministic checker
   (`src/docs/acceptanceCriteria.ts`); criteria a headless Session cannot
   evidence (lint, tsc) are verified by required CI.
6. **Governed records on remote main.** Settlement and pointer commits merged
   as merge commits (never squash); `current_action` names an eligible in-scope
   Action and the scheduler preview identifies the first pinned Action; the
   managed-documents contract test passes. Verify the canonical queue too:
   an earlier out-of-scope held terminal candidate must not capture the pointer
   after the first merge. Priority-only corrections use the supported queue move
   under Decision0054, preserving every key and unrelated relative order; they
   do not need a new priority Decision or authorize dispatch.
7. **Host.** Primary checkout clean, on main, level with origin; actual owning
   worker and reviewed installed release are bound and healthy. Governance-only
   commits do not require a restart: prove the release is an ancestor and there
   is no code/configuration delta in the guarded runtime paths. A material
   runtime delta requires its separate guarded adoption authority; a method
   checklist never grants installation, recovery or restart permission.
8. **Capacity.** Gate stays on. Every actual launch requires the Active worker's
   fresh, known, admissible reading under Decision0130 and its numeric amendment
   0134; stale, unknown, exhausted or failed refresh never admits work. Preserve
   the actual worker-context diagnostic and credential expiry; sign-in alone
   is not quota evidence. The existing guarded START path may offer activation
   with a **stale-only cached reading** when it enforces that fresh worker read
   before any launch. Disclose that distinction; never relabel an old diagnostic
   as fresh quota, inject telemetry or disable the gate. Do not add another
   Off-state credential probe merely to refresh a display. Use exact existing
   authority: Decision0141's daily Off renewal/verification allowance is bounded
   and consumed once per local day; Decision0131's separate fallback applies
   only to the Active worker's recorded401, not403 or a new Off operation.
9. **Production is Off at press time.** Once Active, nothing merges except
   the worker's own merges and operator-approved merges; remind the operator
   to STOP first.

## Retained preparation lessons

- Reconcile evidence before repeating expensive checks. Record exact scope,
  source changes, receipt provenance and limitations. A missing raw historical
  file is a coverage limit; retain its published report as such, never invent it.
- A required command's timeout is a refusal. Distinguish the per-command bound
  from the enclosing validation budget: current command120seconds and total
  900seconds are different. A lint pass taking127seconds exposes a reliability
  risk, not permission to count a timeout as pass, reset an attempt or silently
  increase a limit. Capture and independently assess the smallest correction.
- Reuse actual operator approval for its stated class and effects. A blocked
  operation does not block independent preparation. Present only a genuinely
  needed external decision through a verified remote surface, preserving the
  separate explicit START gate and all custody and consumed-attempt records.

## Supervision during a run

- Poll every 10 minutes: `arcadia production status` (escalations, red
  alerts), recent `operator_pings`, open PRs for the pinned Actions, and the
  worker log tail. A quiet log is not progress: the tick logs each escalation
  once, so treat 20 minutes without a new line while a lease or review is
  open as a check trigger.
- If you keep a log watcher, match every escalation kind
  (`Escalated .* \((review_repair_rounds_exhausted|repair_budget_exhausted|review_attempts_exhausted|operator_gate|terminal_candidate|environment_wall|budget_exhausted|scope_pointer_held)\)`,
  `Review repair .*: escalated`, `Worker merge refused`, `Independent (qa|code-review) .*: (fail|needs)`),
  not only the success line you hope for.
- On the first escalation, read the verdict or refusal artifact, decide
  within one cycle whether the run can still meet its criteria, and if not,
  ask for STOP and start the batch fix immediately.

## Operator communication

- Ask decisions as numbered options, each with its consequence and a
  recommendation; Agent Ask "decision" proposals are invisible on a phone.
- Every press or merge request carries the exact button or PR title and the
  full tailnet deep link to it
  (`http://arcadia-1.alpine-rattlesnake.ts.net:3020/actions/<card-id>`,
  verified 200), in chat and in `arcadia ping send --link`.
- Ping only when the operator can act now (press, merge a green PR, answer).
- A build-packet approval ping the policy's `packet_approval` delegation
  will approve seconds later is noise (#1659); tell the operator not to act on
  it, since a manual approval is an operator touch.

## Hotfix path (proposal, not yet a Decision)

Not in force: until a Decision ratifies it, AGENTS.md and the Decision
0060/0080 independent review apply to every PR.

When the operator decides a small named change in chat: record the decision,
make the change with its tests, open a PR labelled `hotfix` quoting the
operator, and hand it over at green CI. All other gates stay. Independent
review is skipped only on the operator's explicit instruction for that PR,
and is owed afterwards. Proposal: Agent Ask `proposal-hotfix-path-20261021` (workspace proposal, `arcadia agent-ask pending`).

## Closing a run

Settle `first-unattended-run` (or the run's evidence Action) only with a
complete Ask whose every criterion is met; otherwise keep it open. Re-derive
`docs/managed-production-readiness.md` with every failure observed, score the
pre-mortem's predictions, and update this playbook in the same PR.
