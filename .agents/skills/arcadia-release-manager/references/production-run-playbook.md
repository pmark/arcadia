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

1. **Full-chain replay.** `pnpm production-replay --source-workspace <live>
   --card <card> --github live --simulate-github-writes` reaches launch, and
   with a scripted or real candidate and real reviewers continues through
   completion validation, settlement, PR, code review, QA, simulated green
   CI, worker merge, pointer advance and the next Action's launch. The replay
   must not stop at `Stop: launched` without that extension. Record every
   refusal it prints.
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
   `src/sessions` (those are never repaired unattended). Each `next_action`
   contains "Implement" so `planStepsForWorkItem` routes it to build, not a
   Decision-gated planning run. Criteria pass the deterministic checker
   (`src/docs/acceptanceCriteria.ts`); criteria a headless Session cannot
   evidence (lint, tsc) are verified by required CI.
6. **Governed records on remote main.** Settlement and pointer commits merged
   as merge commits (never squash); `current_action` names the first pinned
   Action; the managed-documents contract test passes.
7. **Host.** Primary checkout clean, on main, level with origin; services
   restarted at HEAD (`scripts/services.sh restart`, inline
   `ARCADIA_WORKSPACE`); `arcadia go-broker status` revision = HEAD; the
   worker process started after the last merge.
8. **Capacity.** `arcadia production capacity --refresh` admits the provider
   now (a stale read is not proof). Press within minutes of that read.
9. **Production Off and nothing merges while Active** except the worker's own
   merges.

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

When the operator decides a small named change in chat: record the decision,
make the change with its tests, open a PR labelled `hotfix` quoting the
operator, and hand it over at green CI. All other gates stay. Independent
review is skipped only on the operator's explicit instruction for that PR,
and is owed afterwards. Proposal: `proposal-hotfix-path-20261021`.

## Closing a run

Settle `first-unattended-run` (or the run's evidence Action) only with a
complete Ask whose every criterion is met; otherwise keep it open. Re-derive
`docs/managed-production-readiness.md` with every failure observed, score the
pre-mortem's predictions, and update this playbook in the same PR.
