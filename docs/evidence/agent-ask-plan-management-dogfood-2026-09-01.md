# Agent Ask Plan-management dogfood evidence

Date: 2026-09-01 (America/Los_Angeles)

## Outcome

Coding agents can now use one conventional Agent Ask envelope to create a
complete inactive draft Plan or to amend and reprioritize an existing active
Plan. The agent does not choose document paths, queue row ids, database writes,
or Git operations. Preview remains non-mutating, apply requires the exact
fingerprint and current queue revision, and only operator-accepted settlement
crosses into checked-in Project truth.

## Deterministic Plan creation proof

`tests/agent-ask-settlement.test.ts` settles a strict `intent: plan` envelope
whose Actions arrive out of dependency order. The resulting temporary Git
repository contains `docs/plans/deliver-release-readiness.md` with:

- `status: draft`;
- two complete governed Actions with Responsibility, acceptance criteria,
  dependencies, and merged shared/per-Action references;
- dependency-safe document order (`build-release-proof` before
  `publish-release-guide`); and
- no Project pointer, dispatch-authority, or execution-queue change.

The adjacent refusal proof shows that missing acceptance evidence and any
attempt to create an empty draft or place a new draft in the queue produces no
managed-document write.

## Live targeted Plan Ask

The committed implementation was dogfooded against the real Arcadia Project
with strict request `agent-plan-priority-dogfood-20260901`:

- proposal: `agentask_b7f8de65eff986b852`;
- target Plan: `plan/agent-ask-execution-queue`;
- target Action:
  `action/enable-coding-agents-to-naturally-create-amend-and-reprioritize-plan-shaped-work`;
- queue placement: `--top` at expected revision 5; and
- exact preview fingerprint:
  `b33cdf8ab4846aef8405df181d2adc56a1dc17e35b50782d8aa2d2f146a3bf43`.

Applied settlement `asksettle_1c38b693b26b492999` recorded:

1. the named Action amendment in Plan `agent-ask-execution-queue`;
2. the complete dependency-safe Plan segment
   `arcadia/dogfood-agent-managed-queue`,
   `arcadia/enable-coding-agents-to-naturally-create-amend-and-reprioritize-plan-shaped-work`;
3. segment start at queue position 1;
4. resulting next eligible Action
   `arcadia/enable-coding-agents-to-naturally-create-amend-and-reprioritize-plan-shaped-work`;
5. authority `operator_acceptance` with no invented bounded-policy Decision;
   and
6. notification state `pending` only after the checked-in Plan and queue
   transaction completed.

## Discord proof

The live Discord adapter drained that durable outbox item and updated the
settlement row to:

- `notification_status: sent`;
- `discord_message_id: 1544532698129891468`; and
- `notified_at: 2026-09-02T02:21:31.901Z`.

The message was rendered from the durable receipt. It names the accepted
disposition, Arcadia Project, Plan intent, amended Action, full moved Plan
segment, queue position 1, resulting next eligible Action, and settlement id.
Preview and refused attempts emitted no notification.

## Live queue and phone-width Dashboard proof

Private Practice Now changed its active Plan concurrently after the first live
settlement and introduced two unpositioned Actions. Arcadia correctly showed no
next Action rather than inventing their priority. The complete explicit
arrangement was then previewed and applied as receipt
`qorder_68d100e95ecc489991`, advancing the portfolio to revision 7 with all 11
approved unfinished Actions positioned.

The restarted Dashboard at `http://127.0.0.1:3020/work-queue` was inspected at
390×844. Evidence:

- document viewport width and scroll width were both 390 pixels;
- queue position 1 remained the blocked operator-owned Arcadia proof;
- queue position 2 was the ready, pointer-authorized Plan-management Action;
- the **Arcadia works here next** panel named that Action and its concrete next
  step; and
- Project/readiness filters and batch reorder controls remained reachable in
  the phone viewport.

## Validation

- `pnpm exec vitest run tests/agent-ask.test.ts tests/agent-ask-settlement.test.ts`
  — 23 passed after the independent-QA corrections.
- `pnpm test` — 1,170 passed, 6 skipped across 122 test files after the
  independent-QA corrections.
- `pnpm build` — core and Discord TypeScript builds passed.
- `git diff --check` — passed before the implementation checkpoint.
- `/Users/pmark/.codex/skills/restart-arcadia-services/scripts/restart-services.sh restart /Users/pmark/Dev/MR/Arcadia/arcadia`
  — Intelligence, managed-Run worker, Dashboard, and Discord adapter all
  reached ready state.

## Boundaries

Natural free text remains a labelled `auto` fallback. It cannot invent a
Project, intent, approval, dependency, or priority. Draft creation does not
activate a Plan. Queue order remains metadata over canonical checked-in
Actions and does not grant dispatch authority.

## Independent QA correction

The first independent review of PR #148 at `475d3226a1b8` failed and was
preserved as QA Decision R150. It correctly found that explicit empty
dependency/reference lists retained stale values and that an untargeted Plan
Ask could still create an empty draft. The Candidate now treats those lists as
replacement values, tests removal of real stale metadata, and refuses an empty
new Plan at preview before capture or settlement. Focused coverage passes 23/23
and the corrected full suite passes 1,170 tests with 6 skipped.
