# Rowan handoff, 2026-10-31: route B (cut presses before the fresh unattended run)

## Objective

Make a fresh `first-unattended-run` possible with as close to one operator press as possible. Plan `arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider` (draft), Action `first-unattended-run` (open). This is operator-directed work; no governed Action holds the press-cutting work yet. The Go delivery probe is parked; do not resume it (see PR #1927).

## Verified state

- **Readiness checklist refreshed and merged:** [PR #1931](https://github.com/pmark/arcadia/pull/1931), merge `d8cdabf`. Independent R1 and R2 reviews both returned GO. All CI passed on `e8b8eb9`, which is a pure automatic base merge of the reviewed `3245a3b`.
- **Live (read-only, 2026-10-31T18:47Z):**
  - Production is Off, `inactive_idle`, rev 83 / epoch 46, with 0 admissions.
  - Broker and worker are at `24c4ee0`, which includes PR #1794.
  - Main has since moved past `1ac59bd`. Runtime adoption of PR #1926 and later commits is unassessed.
- **The original trio cannot close acceptance:**
  - PR #1787 was merged by hand-assisted repair.
  - PR #1783 was closed after review rejection.
  - PR #1779 is the only worker delivery.
  - A fresh run of at least three Actions is required. The operator chose route B on 2026-10-31: cut presses first.
- **Friction:** [Issue #1929](https://github.com/pmark/arcadia/issues/1929), items F1–F7. Its follow-up comment records that F3 (capacity) is mostly solved: the worker refreshes before each admission (`src/production/capacityPreAdmission.ts:82`). F1 (adoption) and F6 (activation + START) are the real press generators.
- **Proposal:** `agentask_48c56762f4b7dff8f2` (`propose-one-press-run-start-20261031`) has been previewed and is unsettled. It names three candidate Actions:
  1. A generic live installed-equals-main START precondition.
  2. START-time adoption while Off.
  3. A combined Plan-activation + START card.
- **Lesson captured:** `lesson_e325c7e38e85d041dc67`. Verify each PR the checklist names before acting on it.
- **Code map:**
  - START cards are host one-shot scripts in the ignored main-checkout library `artifacts/generated/operator-scripts/` (newest `start-fixed-three-claude-actions-20261026.sh`). They hard-code HEAD, broker and policy revision. Only the cards compare installed with main; admission does not.
  - Activation (`planActivation`, `src/dispatch/planActivationApply.ts`) is separate from START (`src/commands/production.ts:298`).
  - `next_after` chaining exists in `src/operatorActions/libraryContract.ts:97,186`. Whether it auto-presses is unverified.
- **Tests:** none run. The changes were docs only.

## Resume location

- **Repository:** `pmark/arcadia`.
- **This handoff:** branch `claude/rowan-handoff-20261031`, from `d8cdabf`.
- **Session worktree:** `.claude/worktrees/rowan-readiness-refresh-20261031`, a disposable Claude worktree. Its earlier branch is merged.
- **Work state:** no local-only work and no running operations.

## Authority and custody

- **Coordinator:** Rowan (Claude Code, Opus, `Claudia Atlas`) holds sole coordinator custody until a successor confirms.
- **Not approved:** production START, adoption, restart, renewal and Plan amendment.
- **Approval needed:** folding adoption or Plan activation into START changes what one press authorizes, so it needs an operator Decision before implementation.

## Unresolved

- The operator's Decision on the scope of the one-press START.
- Whether `next_after` already chains cards.
- Whether current main must be adopted before a fresh run.
- The open acceptance Plan still needs a governed amendment:
  - supersede the delivered `cover-mail-ack-receipt-kind-collision`;
  - tighten the criteria of `bound-guidance-test-teardown-retries` so its test fails when the `afterEach` retries are removed;
  - add at least two more ready Actions.

## Handoff reason

**Outcome:** prepare. **Basis:** heuristic; headroom unknown; no host telemetry. This is a natural boundary, because the next step waits on the operator's Decision.

## Next action

Read the operator's answer.

- **If they approve the scope:** settle the proposal through the governed path, then implement Action 1 (generic START precondition). It has no authority change, so it can start now. Add `next_after` verification.
- **If they decline folding:** implement Action 1 only.

## Stop condition

A merged PR delivering the approved press reduction, with independent review and CI. Then a re-derived checklist showing the press count for a fresh run.
