# Explicit terminal candidate recovery — source evidence

Issue: https://github.com/pmark/arcadia/issues/1915. Operator-directed source
repair; the active Plan and queue are unchanged. Ellis acted as the depth-one
sole implementer, reporting to Rowan. No live recovery, launch, claim change,
installation, service restart or production start is part of this evidence.

## Behavior and boundaries

Ordinary preview now reports a retained Action claim. Existing resumable
handoffs, safely preserved superseded-input candidates, pending review repairs
and never-launched draft-only candidates use
their established routes; draft readiness uses the complete read-only evaluator.
An unsafe draft remains not ready. Its launch path may record the existing
refusal disposition, but cannot turn an improved blocked preview into authority.

`session preview-launch --recover-session <id> --request-id <fresh-id>` inspects
one terminal no-op candidate. `session launch` with the same recovery id,
request and approved fingerprint explicitly authorizes one successor. Standing
production or fixture-standing authority cannot recover it. Decision 0096's
post-exit preservation grant is optional and separately confirmed.

Eligibility requires a completed exit-zero Session with its retained
successful-exit receipt, receipt revision and clean candidate HEAD both equal
to the recorded launch revision, matching Project/Plan/Action/packet, branch,
repository and claim, and positive process-liveness evidence. Other, active,
changed or uncertain candidates refuse. The approved fingerprint binds the
documents, queue, packet, candidate identity and expected claim generation.

Inside `prepareSession`'s `BEGIN IMMEDIATE`, the launcher re-derives the approved
preview, rotates the expected claim, inserts the successor and records the unique
original-to-successor request binding. Optional post-exit authority commits with
those records. Insert failure rolls everything back. The old exit receipt is
never superseded or rewritten; no attempt counters are reset. A competing
request cannot clear the winning claim or create another successor.

An unknown-response replay may return only its own successor. Before a prepared
successor starts, the documents, queue, primary revision, packet, receipt,
current claim generation, clean candidate and liveness are checked again.
Ordinary launch cannot resume that recovery-bound prepared lease. A failed
successor remains an explicit blocker: inspect its receipt and retained claim
before separately authorizing further repair. Automatic void/retry of that
post-preparation failure is deliberately unsupported.

## Validation evidence

- Corrected full composition against the original launcher: exit 1 at recovery
  launch (`The launch preview is stale or was altered since it was approved`).
  The test retained the new claim-aware preview to reach the missing original
  launch behavior. Original launcher bytes were substituted only for this test;
  the implementation was restored in a `finally` block before final checks.
- Recovery suite before final two added cases: 20 passed, 64 skipped, exit 0.
  Includes no-op composition, fresh authority, stale generation, active/unknown
  process evidence, wrong Project/packet, changed branch/HEAD/dirt, preserved
  receipt and attempt rows, two-request interleaving, insertion rollback,
  unknown-response replay, changed prepared replay facts and failed spawn.
- Existing draft-only parity group: 7 passed, 79 skipped, exit 0.
- Existing review-repair trigger: 1 passed, 78 skipped, exit 0.
- TypeScript `pnpm exec tsc --noEmit`: exit 0.
- Preservation self-check: exit 0, 3337 files inspected before this report.
- Complete `pnpm exec vitest run tests/session-launch.test.ts`: 86 passed,
  exit 0, 229.79 seconds. This preceded the final request-prefix replay delta.
- Final request-prefix replay and in-transaction claim-generation delta: 2 passed,
  84 skipped, exit 0. The ordinary request was correctly refused by its earlier
  ownership check; the assertion now accepts either applicable ownership message.
- `pnpm build` (whole-repository lint, root TypeScript and Discord TypeScript):
  exit 0. Final replay delta also passed focused ESLint and `tsc --noEmit`.
- `pnpm check:session-ledger`: exit 0. `git diff --check`: exit 0.
- Pre-handoff origin/main checkpoint: `2a7c786e03e9444e2ace14f000112e83a6a65b58`.
  One first-parent merge added draft naming/design work; the active Project
  pointer and this direct source-repair authority did not change.

Raw successful and failed command outputs are retained locally for the
coordinator. This report contains no private operational Session identifiers,
workspace paths or live recovery approval. No deployment or installed-runtime
claim follows from source tests.

## Failures and corrections

The first composition fixture had no host assignment revision, so the fixed
reconciler correctly released its no-change claim; that failure was not proof
of the historical defect. The corrected fixture records a host-created launch
revision and reproduces the historical successful-exit receipt without changing
its final bytes. Four added prepared-replay tests exposed a missing callback
binding; wiring the recheck into the actual reuse branch made them pass. The
first review-repair compatibility run used the Session lookup with a request id;
using the existing request lookup restored the supported repair path.

Rowan's read-only feedback also separated explicit recovery approval from the
optional post-exit authority, required the failed-successor blocker, and replaced
a draft-dirt-only preview exemption with the full existing evaluator.

## Independent review R1 and bounded repair

An independent read-only Codex gpt-6.1-terra/high reviewer inspected
`fd6d0b4ac09f45d2be5cb41a4aa1115bcb995781` against
`bde2f65d1a71f3ae11799f315a3df14f674fac49`. R1 ran no tests; its macOS lsof
sample exited zero. R1-01 was its only blocking finding: the shared cwd probe
accepted lsof status 1 or diagnostics as an empty result, allowing partial
process coverage to authorize terminal recovery.

The recovery-only complete-scan option now rejects nonzero macOS lsof status,
any stderr, missing cwd records and malformed output. Its option is passed
through the real recovery evaluator, including prepared-successor replay.
Existing non-recovery callers retain their default behavior. Tests inject the
lsof runner so status 1, status-zero warnings, complete clear output, live
candidate processes and incomplete records are deterministic on every CI host.

- Baseline with the injected runner but no strict behavior: 3 failing partial-
  coverage cases, 2 passing controls, exit 1.
- Fixed focused recovery/liveness run: 15 passed, 84 skipped, exit 0 (11.54s).
- Complete recovery and liveness files: 99 passed, exit 0 (143.26s).
- Whole-repository `pnpm build`: exit 0.
- Final retained-claim/no-op composition delta after compatibility repair:
  2 passed, 86 skipped, exit 0 (8.56s).
- Final focused ESLint and `tsc --noEmit`: exit 0.
- Complete run-2, run-3 and run-4 amended-Action rehearsal files: 14 passed,
  exit 0 (41.88s). The prior run preserved its 1-failed/13-passed receipt.
- Session-ledger, preservation self-check and `git diff --check`: exit 0.

CI on the first head also exposed two amended-Action rehearsal failures: preview
blocked the existing superseded-input release route. Preview now shares the
exact existing read-only holder, clean-worktree and preserved superseded-input
proof. Actual release still rechecks that proof and fences the claim generation.
Tests verify preview proof cannot change the claim and still rejects live,
foreign, unpreserved, current-input and dirty candidates. The broader run-2
check initially failed only on its old late-refusal wording; it now pins the
early not-ready refusal and directly proves the dirty claim is ineligible,
while retaining all no-dispatch, attempts, claim and unsaved-file assertions.

Latest source checkpoint is `e444fe02a04675c8d853ecad52cdc006c696f157`;
the stacked base remains `bde2f65d1a71f3ae11799f315a3df14f674fac49`.
The four new main commits include draft planning and a tidy-log bootstrap
Action activation. Their Project pointer/current Action were read; neither
overlaps this directly authorized source repair. No governed pointer changed
in this candidate.

The finding is addressed in source, pending independent delta review and CI;
no installed-runtime or live-recovery proof is claimed.

## Independent review R2 and bounded cwd repair

R2 reviewed `c318beb6625eb0328f6adcf0d8370a9edbfca0c4` against the first
head. It confirmed the R1 and superseded-input repairs, then found one blocker,
R2-01: a status-zero `nunknown` cwd record was treated as outside the candidate.
The strict recovery parser now requires ordered process/command/cwd-field/name
records and an absolute cwd that resolves to a directory. Matching uses that
resolved path directly; an unknown, missing, deleted or unreadable cwd refuses.
Default non-recovery callers retain their existing behavior.

- Failing-first cwd/record regressions: 10 failed, 2 passed, 97 skipped, exit 1.
- Initial focused fix: 21 passed, 88 skipped, exit 0 (10.05s).
- Final complete liveness file: 19 passed, exit 0 (1.19s).
- Final recovery composition and macOS refusal cases: 5 passed, 85 skipped,
  exit 0 (11.41s).
- Focused ESLint and root TypeScript: exit 0. The earlier full build remains
  the broad baseline; this bounded parser delta received the focused checks.
- Coordinator-authorized read-only strict probe of the retained host candidate:
  exit 0, `ok: true`, no process observed. This is a point-in-time observation,
  not approval of live recovery or proof that later launch preconditions hold.

Independent final delta review and required CI remain pending. No live recovery,
claim transfer or installed-runtime change occurred.

## Operator and end-user QA

No new UI or service is published. The operator procedure is the end-user
procedure. Before adoption, use the disposable source regression file:

1. Run `pnpm exec vitest run tests/session-launch.test.ts`. The recovery tests
   create temporary repositories and fake provider transport, with no live
   recovery or launch.
2. Verify that the composition starts one successor in the original candidate,
   preserves the original receipt and attempts, and replays without another
   process. The interleaving test must retain the winner's exact claim.
3. Verify changed, foreign and uncertain cases refuse and failed insertion
   restores the original claim. A failed spawn must retain its successor record
   and candidate rather than clearing ownership.
4. After separate review, required CI and authorized adoption, a separately
   approved read-only preview may inspect a real candidate. Live claim transfer
   and launch still need their own fresh explicit approval.

## Retrieved instruction evidence

The following file byte sizes identify the retrieved sources. Reads were
bounded to the relevant sections where noted; sizes describe source files,
not a claim that unrelated sections were loaded.

| Source | UTF-8 bytes | Retrieved scope |
| --- | ---: | --- |
| `AGENTS.md` | 11060 | contract |
| `CONSTITUTION.md` | 3320 | authority and truth |
| `PROJECT.md` | 31429 | frontmatter and current pointer |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 | context policy |
| `.arcadia/repo-context.md` | 703 | repository context |
| `.arcadia/context-policy.json` | 870 | allow/deny roots |
| `docs/agent-guidance/index.json` | 8771 | trigger index |
| `.agents/skills/arcadia-role/SKILL.md` | 11841 | implementer assignment and hand-back |
| `.agents/skills/arcadia-guardrail/SKILL.md` | 5565 | bounded implementation and verification |
| `docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md` | 25404 | exact current Action; no overlap |
| `docs/agent-guidance/continuation.md` | 8704 | onboarding and custody |
| `docs/working-copy-safety.md` | 16202 | monitor, preservation and isolation |
| `docs/agent-guidance/operator-directed-work.md` | 4536 | source repair scope |
| `docs/agent-guidance/learning.md` | 2458 | targeted retrieval |
| `docs/notes-to-self.md` | 45459 | claim, launch, replay, worktree, tests and repair matches |
| `docs/agent-guidance/native-mail-checkpoints.md` | 11015 | Git checkpoint |
| `docs/agent-guidance/session-roles-and-briefs.md` | 15378 | Ellis role and ledger |
| `docs/agent-guidance/arcadia-repository.md` | 30312 | Orientation, Semantics, Operator Guide, PR QA and Working-Copy Safety |
| `docs/AGENT_ORIENTATION.md` | 13594 | schema, CLI, operational truth |
| `docs/arcadia-semantics.md` | 22613 | canonical terms and optional profiles |
| `docs/agent-guidance/pull-requests.md` | 21758 | independent review boundary |
| `docs/agent-guidance/git-identity.md` | 5248 | commit/comment identity boundary |
