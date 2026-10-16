# Approved Run infrastructure — current derived checkpoint

Project: Arcadia. Milestone: Execute one approved named Run safely with Production Off.
Current source assignment: `execute-one-approved-named-run-safely-with-production-off#enforce-durable-run-admission` (Action 2, seven acceptance criteria). The Plan remains **draft**; `PROJECT.md` still names `claude-worker-launch-replay`. This source assignment does not enroll a governed Session, activate a Plan, or move a queue.

Parent/canonical Lead with assigned supervision: chat `01a143b1-15fa-70b1-86af-9866e6e74874`. Sole Action 2 writer: chat `01a143ec-6da4-7300-a8d6-b16e76014446`, candidate `/Users/pmark/.codex/worktrees/0c59/arcadia`, branch `codex/durable-run-admission-20261016`, base `31450cff4c1c18d9b6720c308abc50c87152ded2`. Current candidate head is the commit containing this checkpoint; exact pushed/reviewed hashes belong in the PR receipt. No other candidate or primary checkout was changed.

Action 1 merged as [PR #1455](https://github.com/pmark/arcadia/pull/1455), merge `31450cff4c1c18d9b6720c308abc50c87152ded2`, after independent review/QA and seven CI jobs. Its governed completion is `asksettle_7f4a352b9a5545a19e`; Issue #1389 is closed. The manager verified these at assignment. The raw Action 1/R1 evidence below is retained as history, not current gate state. Action 3 remains unstarted and requires its own assignment after Action 2 delivery.

Authority: named source assignment relaying the actual operator message `01a143ae-bcb4-7a53-afea-728203cf34dc` in chat `01a14252-a1fc-77e3-9f7d-10d62e50ebdf`: “It’s merged, so let’s pull main and start a new session for a release manager and their team to build the entire plan without stopping”. The manager verified actual human content. No live trial, provider invocation, merge, install or restart is authorized in this assignment. Source work may continue after the live Decision expiry; it cannot renew live authority.

Budget: one 75-minute initial pass, deadline `2026-10-16T10:10:00Z`; one scoped repair pass up to 20 minutes per verified named failure, at most three per same failure, with manager notification before extra allowance. No delegation. Separate independent reviewer/QA chats are manager-owned; normally at most three rounds, significant-defect exception up to five. Actual host model, effort and token usage are unknown; the configured host model was retained. Standalone standard-tier role brief `/private/tmp/durable-run-admission-role-0c59.json` is a recommendation, not runtime/model/enrollment evidence.

## Action 2 implementation and trusted-store boundary

`src/scout/runAdmission.ts` uses the existing SQLite dependency and shared executor/claim/finalization path. It adds no workspace migration, daemon, scheduling, orphan recovery, FIFO selection or orchestration harness. Admission reads **existing stores only**, with one stable Decision 0128 HelloWorld goal independent of source, Run, invocation and fixture. Each immediate transaction checks retained cumulative attempts, repairs, first reservation/launch bound, last clock, and the separately retained witness. The ledger commits before the witness; a process crash between commits creates a detectable mismatch and fails closed. Full synchronous writes precede executor invocation. A reservation remains consumed after parent interruption; ambiguous attribution cannot retry automatically.

The independent witness is a separate SQLite file outside the ledger's restore directory and outside the fixture. It retains lineage, sequence, full-history digest, and the SHA-256 of approved exact-scope evidence. Restoring an earlier internally valid ledger while retaining a newer witness refuses admission. A ledger-local digest is insufficient. Both stores serialize on the witness write lock; partial commits reduce availability, never restore allowance.

Live mode has fixed paths relative to the supported user configuration directory: `scout-admission/decision-0128.sqlite` and sibling `scout-admission-witness/decision-0128.sqlite`. It refuses redirected HOME/config/capacity roots and verifies the protected workspace against the normal configured default. Source revision/fixture recreation or caller-supplied paths cannot choose a fresh live budget. Scripted tests explicitly seed **synthetic** stores outside their disposable fixture; those seeds are not live history. There is no runtime initialization, reset, migration, live-history fabrication or evidence-pin update command. Fresh authentic prior history and approved evidence in both trusted stores are prerequisites; absent those, remaining actual allowance is **unknown** and invocation refuses. Do not create empty live stores to make the gate pass.

Trust boundary: the operator/host custodian protects the configuration root, approved evidence pin and independently retained witness from ledger/fixture restore. This detects restoration of the ledger alone, including an internally valid old snapshot. It does **not** claim protection against privileged replacement of every trusted store or its host trust anchor. Witness approval pins prove custody of supplied evidence; session labels in test receipts do not prove governed lineage. No actual Session enrollment is fabricated.

The public consumer requires all three admission arguments even with `--fixture-script`; omission of the whole bundle is not a legacy bypass. Before reservation it rechecks current approved Ask/Run scope, Production Off, immutable clean source, clean allowed no-remote fixture repo, Node 22, exact Luna/low isolation and fresh protected observations, separate current-source review/QA and included subscription/capacity. The independent witness pins the entire evidence bundle. Missing, unknown, paid, fallback, stale, unrelated or restored evidence refuses invocation. Real execution cannot use simulated evidence or another store pair.

An opaque in-process capability binds the successful reservation to the exact Run, Ask, source, workspace/repository and mode. The shared executor consumes it once at the invocation boundary; forged/copied JSON and the ordinary worker cannot use it. The live adapter is fixed to Codex/Luna low with ChatGPT login and OpenAI provider, without configured adapter fallback, inherited billing keys or metadata shell commands. [Official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents `forced_login_method`, provider and reasoning configuration (retrieved 2026-10-16).

The existing executor uses the existing host GNU `timeout` utility for its own process-group deadline, with SIGKILL, so consumer-parent death does not remove the wall timer. Missing/unsupported GNU timeout refuses execution; nothing installs it. The effective provider bound is the smaller of 90 seconds, reservation time remaining, total-loop deadline and Decision expiry; preparation counts against it. Fixture scripts retain their tighter five-second cap. The outer synchronous timeout is a final failure guard, not the durable timer. No second worker or coding harness is introduced.

## Action 2 criterion evidence / current gates

| Criterion | Evidence and remaining gate |
| --- | --- |
| 1: stable history | `tests/scout-run-admission.test.ts` restarts a real process, changes source and recreates the fixture while retaining first launch/goal/cumulative counts. |
| 2: transactional bounds | Concurrent independent processes and crash injections prove reservation before the scripted boundary, consumed ambiguity, three-attempt/two-repair/90-second and 90-minute bounds. Public fixture checks the durable row from inside the only external executor. |
| 3: refusals/retries | Module and public fixtures reject expiry, rollback, missing/corrupt/exhausted history, authority/isolation/Node/model/review/QA/capacity/billing failures, omitted bundle and unchanged/unattributed failure or source. Retry requires changed source, named retained failure, verified fix and independently pinned review/QA. |
| 4: restore witness | An old valid SQLite ledger snapshot is restored after a newer committed reservation; the independently retained witness refuses it. Tests also kill the process after ledger commit but before witness commit. Trust boundary above is explicit. |
| 5: public integration | Mandatory admission bundle, shared opaque capability, exact product oracle, and external scripted execution only. Ordinary worker/provider refusal, timeout and parent-kill regressions from Action 1 are retained. Final clean-head test receipt pending below. |
| 6: honest allowance/spend | Actual live attempts and runtime repairs in this assignment: 0. Remaining actual allowance unknown; historical protected-config attribution unresolved. No paid credit/reset/API billing/provider fallback is admitted. Runtime usage/cost unknown; fixture incremental paid spend $0. |
| 7: independent delivery | Separate current-head Code-reviewer/QA and all seven CI jobs await PR creation/manager coordination. Local focused tests/lint/TypeScript/build and current-head fast rehearsal required before handback. Completion Ask is prepared only after all criteria are evidenced; the manager coordinates concrete authorization-reviewed apply. |

## Action 2 raw commands and friction

- `arcadia work monitor --no-pull-requests`: exit 0; unrelated historical dirty worktrees preserved. This candidate was clean and isolated at the verified base.
- `node scripts/bridge-worktree-deps.mjs`: exit 0, four dependency trees bridged through the supported script.
- `git switch -c codex/durable-run-admission-20261016`: initial sandbox refusal on shared Git metadata; the exact branch creation through ordinary host permission succeeded, exit 0. No primary working files or main branch were changed.
- `arcadia role brief --role implementer --agent codex --tier standard --action execute-one-approved-named-run-safely-with-production-off#enforce-durable-run-admission --repo /Users/pmark/.codex/worktrees/0c59/arcadia --json`: exit 0.
- Scoped Learn searches retrieved `lesson_5f2612ea3b0f890ae421`, `lesson_5af0ff4ade855263638d`, and `lesson_a55f226c43c6da10e722`; evidence was read before implementation. No new provider/model calls were used by deterministic validation.
- Initial module proof: `pnpm exec vitest run tests/scout-run-admission.test.ts`, exit 0, 20/20; expanded crash/trust-anchor proof, exit 0, 21/21. Raw receipts `/private/tmp/admission-tests1.log`, `/private/tmp/admission-tests2.log`.
- Intermediate unchanged Action 1 + isolation + initial admission proof: `pnpm exec vitest run tests/run-consume-one.test.ts tests/scout-run-admission.test.ts tests/scout-isolation-preflight.test.ts`, exit 0, 93/93. Raw receipt `/private/tmp/admission-focused1.log`. This predates mandatory bundle integration and is not final acceptance.
- TypeScript initially identified `never`-function narrowing and a generic catch return. Corrected with an explicit function declaration/return; subsequent TypeScript and focused ESLint passed. Failed raw receipts `/private/tmp/admission-tsc-initial.log`, `/private/tmp/admission-tsc2.log`; final receipts below supersede them. No test or gate was weakened.

Additional self-audit in the initial pass: mandatory public admission alone left direct shared scripted entry able to omit a reservation. The shared boundary now requires it for the approved Ask receipt in either mode, and rechecks actual clean source/Node 22 at invocation. New tests attack omitted/copied tokens and stale reserved source through that boundary. Paid credit availability or unknown credit state refuses admission; terminal authentication/quota/isolation/authority failures remain non-retryable even with changed source. A real consumer-parent SIGKILL test leaves a consumed unresolved reservation and proves the independent five-second executor timer prevents a later write.

The initial committed source `fc1d9167b` passed 114/114 focused tests (`/private/tmp/admission-focused2.log`, exit 0). That receipt predates the final self-audit delta; it is retained, not claimed as final-head proof. Expanded module proof passed 28/28 (`/private/tmp/admission-tests4.log`, exit 0). No extra repair allowance has been consumed; all changes remain inside the initial 75-minute pass.

Next safe moves: commit initial source/tests/docs; run final clean-head focused proof, lint/type/build, fast rehearsal/report and derived-record checks; preserve evidence; push/open the PR and hold code for independent review/QA. No merge or live attempt. Host refusal or the assigned budget cap requires a concrete preserved blocker, not a replacement workspace or reset budget.

## Action 2 instruction retrieval receipt

Byte counts are filesystem UTF-8 sizes, not token counts or claims that historical prose was all loaded. Project frontmatter/current active Action, exact seven Action 2 criteria and full Decision 0128 were retrieved. Procedures: startup/isolation/identity/review/CI/handoff; repository Orientation, semantics, operator guide, PR QA, working-copy and experiment boundaries. Notes: worktree dependencies, SQLite permission refusal, single-file Vitest and fast-rehearsal prior remedies. Skills: role/guardrail in full and OpenAI Docs for fixed login/provider settings. Initial combined reads were truncated; relevant active Action and procedure sections were retrieved separately. No mandatory reference was missing. Scoped retained lessons and cited R1 checkpoint evidence are named above; historical source config uncertainty was preserved.

| Loaded instruction/reference | Bytes |
| --- | ---: |
| `AGENTS.md` | 10100 |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31677 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 9449 |
| `.agents/skills/arcadia-role/SKILL.md` | 9080 |
| `.agents/skills/arcadia-guardrail/SKILL.md` | 5565 |
| `docs/agent-guidance/continuation.md` | 7256 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/agent-guidance/learning.md` | 2458 |
| `docs/working-copy-safety.md` | 16202 |
| `docs/agent-guidance/session-roles-and-briefs.md` | 6152 |
| `docs/agent-guidance/native-app-sessions.md` | 9061 |
| `docs/agent-guidance/standard-harness.md` | 5569 |
| `docs/agent-guidance/chat-titles.md` | 4766 |
| `docs/agent-guidance/agent-asks.md` | 22884 |
| `docs/agent-guidance/git-identity.md` | 5248 |
| `docs/agent-guidance/pull-requests.md` | 17585 |
| `docs/agent-guidance/arcadia-repository.md` | 30174 |
| `docs/arcadia-semantics.md` | 15647 |
| `docs/AGENT_ORIENTATION.md` | 13594 |
| `docs/notes-to-self.md` | 39635 |
| `docs/plans/execute-one-approved-named-run-safely-with-production-off.md` | 10146 |
| `docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md` | 12400 |
| `docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md` | 7256 |
| `docs/scout/CONTINUE.md` | 18829 |

## Action 1 historical checkpoint (preserved verbatim)

# Approved named Run consumer — implementer checkpoint

Project: Arcadia. Milestone: Execute one approved named Run safely with Production Off.
Action: `plan/execute-one-approved-named-run-safely-with-production-off#consume-one-approved-named-run` (six criteria; no completion settlement yet).
Writer: chat `01a143b3-0584-75a0-8afc-4db6905021ab`, implementer, sole writer in `/Users/pmark/.codex/worktrees/b855/arcadia`, branch `codex/consume-approved-named-run-20261016`.
Parent: canonical Lead/release manager `01a143b1-15fa-70b1-86af-9866e6e74874`.
Base: `df5576a639a6052c71d20e4c9f42384a1ecf7092`. Candidate head: the commit containing this checkpoint, until an exact reviewed head is recorded in the PR.
Initial deadline: `2026-10-16T09:07:50Z`. Budget: one 75-minute pass; named scoped repairs only, at most three per failure and 20 minutes each. No delegates, live trial, merge, install or restart.
Actual runtime: GPT-6 family exposed; precise model, effort, processed tokens and cost unknown. Host model unchanged. Registry recommendation `gpt-5.6-terra` / `e2_standard` is not a runtime binding. Role brief resolved codex/standard builder Cody Mason; actual identity is resolved again before every commit/comment. No provider calls were launched for implementation validation.

The operator instruction relayed by the manager is retained verbatim as a JSON string (no trailing LF inside the string):

`"It’s merged, so let’s pull main and start a new session for a release manager and their team to build the entire plan without stopping."`

The draft Plan stays inactive; the live Project points to `claude-worker-launch-replay`. This candidate implements only the first source Action. Issue [#1389](https://github.com/pmark/arcadia/issues/1389) was verified open; leave it open until the consumer repair is delivered. No Session lineage/admission is fabricated.

## Implementation and trust boundary

`run consume-one` requires an exact named Run and original Ask, a matching approved receipt and Action/Plan/scope fingerprints, an experiment workspace, Production Off, current source HEAD, and a clean repository within the experiment root with no remotes. Approval/correlation validation and the selected compare-and-set claim share one immediate transaction. No omitted-selector FIFO exists in this command.

Both the existing worker and the new command call `executeClaimedReviewRun`, extracted from existing execution/finalization. Normal worker behavior, deployment branch, queue settlement and logging are retained. The bounded caller rejects Project-proposal deployment intent. It imports no worker iteration and never invokes recurring intake, orphan recovery or a production tick.

Fixture execution selects a Node `.mjs` script explicitly under the experiment workspace, with a five-second bound and empty inherited environment. This script is trusted external test code, not an OS security sandbox. It cannot select a configured executor through the consumer. Metadata shell validation is bypassed for this explicit fixture mode; the fixed oracle checks a regular `HelloWorld.txt`, exact 13 bytes `Hello World!` + LF and exactly that changed file, then attaches a ready product Artifact. Missing/wrong/extra output, nonzero exit, signal or timeout cannot establish accepted product completion. Execution metadata alone is not product evidence.

The public live-provider branch unconditionally refuses until the separate durable-admission Action supplies reservation and independent restore detection. Output reports blocked live admission and scripted-fixture mode, not an invented count of calls made by arbitrary scripts. Tests witness zero provider/remote calls using the existing isolated HOME and guarded provider/GitHub/tmux binaries.

A full source audit of `src/commands/runConsume.ts`, `src/execution/claimedReviewRun.ts` and `src/execution/runFinalization.ts` confirms no new daemon, recurring intake, orphan recovery, global-oldest fallback or second runner. The worker retains those pre-existing scheduling responsibilities outside the shared execution function. No live pointers/queues, fixture remotes, services, Discord or GitHub are mutated by the scripted successful fixture.

## Criterion evidence and remaining gaps

| Criterion | Evidence / gap |
| --- | --- |
| 1: public exact product/correlation | Public CLI test follows Ask and its approval; checks completed Run, Ask show correlation, exact bytes and linked ready file Artifact. Scripted external executor only. 27/27 focused acceptance checks pass, including the public CLI. |
| 2: refusal/no fallback | Public function/CLI tests cover omitted/blank/invalid/unrelated/already claimed selectors, wrong Ask, rejected/missing/forged approval, other Action/Plan, stale scope/source, non-fixture and Production On; no executor invocation. Live branch fails closed without safeguards. |
| 3: concurrency/failure | Two simultaneous real CLI processes, one claim/invocation; unrelated Run, other Actions, Project/metadata, policy, Git config and service marker preserved. Nonzero, signal, missing/wrong/extra product and timeout tests retain truthful failure without ready product evidence. |
| 4: bounded source path | Source audit above; tests assert isolated guard list empty and protected fixture projections unchanged. No live provider, production or service operation in this assignment. |
| 5: durable safeguards | Live-provider invocation is unavailable and refuses before claim/executor. Durable reservation/restore detection remains Action 2, not claimed here. |
| 6: independent verification | Code-reviewer, QA and all seven current-head CI jobs pending manager coordination. Source checks below; executable QA in PR and START_HERE/COMMANDS; Scout continuation separates source acceptance, actual attempts and actual product outcome. |

Actual live Scout attempts in this assignment: **0**. Runtime repair cycles: **0**. Remaining live allowance: **unknown**. Actual Scout product outcome: **unproved**. Fixture Yes is source acceptance evidence only. Decision 0128 expiry is unchanged.

## Commands and receipts

- `arcadia work monitor --no-pull-requests`: exit 0; unrelated historical dirty worktrees preserved. This candidate started clean/detached at the base, then got its assigned branch via ordinary host permission.
- `node scripts/bridge-worktree-deps.mjs`: exit 0; four dependency trees bridged using the supported script.
- `node --import tsx src/cli.ts role brief --role implementer --agent codex --tier standard --action execute-one-approved-named-run-safely-with-production-off#consume-one-approved-named-run --repo /Users/pmark/.codex/worktrees/b855/arcadia --json`: exit 0; recommendation not actual model evidence.
- `arcadia learn search 'named Run scout consume' --scope project:arcadia`: exit 0, zero matches. Further approval-receipt search: exit 0, zero matches.
- `pnpm exec vitest run tests/run-consume-one.test.ts`: 27/27 passed, exit 0; final expanded receipt `/private/tmp/consume-acceptance.log`.
- `pnpm exec tsc --noEmit -p tsconfig.json`: exit 0 at intermediate source; build includes final TypeScript.
- `pnpm exec vitest run tests/run-consume-one.test.ts tests/worker-tick.test.ts tests/review-approval-applies.test.ts tests/cli-response-execution.test.ts tests/experiment-workspace-guard.test.ts`: first sandbox run exit 1, 135 passed / 16 failed; 14 worker failures at unchanged tmux ancestry query (`Operation not permitted`), one services-guard timeout, one now-fixed test import. Ordinary host-permission rerun: exit 1, 155 passed / 1 failed. All worker/experiment guards passed; remaining failure was this candidate's stale Scout guidance fingerprint. Refreshed through canonical `guidanceFingerprint` (trim-aware), then `pnpm exec vitest run tests/cli-response-execution.test.ts -t 'sets up Arcadia project context'` passed 1/1 (46 skipped), exit 0. No marker removed or guard weakened.
- `pnpm build`: exit 0; includes repository lint, TypeScript and Discord build. Raw receipt `/private/tmp/consume-build.log`.
- `node scripts/fast-rehearsal.mjs`: exit 0, 19 files / 72 passed + 1 expected failure / 34 scenarios. Report `/var/folders/cm/0dn1wl093f52lr7h5d7xpdn40000gn/T/arcadia-fast-rehearsal-report-EcB5Vr/report.json`. The aggregator labels two injected `session-probe-wall` lifecycle logs unexpected; `tests/fast-rehearsal/session-probe-wall.test.ts` explicitly injects and asserts that EROFS refusal and no second launch. They are retained, not suppressed.
- `git diff --check`: exit 0 before final evidence update.

Failed receipts are preserved at `/private/tmp/consume-test.log`, `consume-test2.log`, `consume-test3.log`, `consume-lint.log`, `consume-focused.log`. Corrections: fixture approval requires a declared validation command; source bug rejected Ask's exact `Approved from Ask. Execution queued.` receipt; test path canonicalized `/var` to `/private/var`; Ask show import corrected to `askTrail`; lint unused import/const corrected. Narrow source tests capture each lasting behavior rather than changing governance or guards.

`arcadia learn` first returned `SQLITE_WORKSPACE_WRITE_DENIED`; exact same command through ordinary host permission succeeded as `lesson_8dc79ebc95c6480ac541`, recording the verified receipt mismatch. The manager separately retained coordination friction as `lesson_530e7f4209b6468b2636` (manager-reported receipt).

Automatic approval review rejected one attempted progress message to the parent chat: it could not verify human destination-messaging authorization from the delegated transcript. No retry/workaround was made. Parent follows this chat through read/wait. Source delivery is unaffected. The report filename uses the required timestamp prefix because the requested unprefixed handoff basename would fail `check:session-ledger`; no second checkpoint is maintained.

Additional checks: `pnpm check:agent-guidance` exit 0 (all three agents show no problems), `pnpm check:session-ledger` exit 0, `pnpm check:frozen-records` exit 0. `pnpm check:plan-close-outs` exit 0; `pnpm check:operator-scripts` exit 0. The initial raw-file SHA refresh was insufficient because guidance fingerprints trim the content; the canonical helper fixed it. No authority text or gates changed. Full build and all 27 consumer checks already passed; subsequent source edits were only evidence/docs and the derived guidance fingerprint.

## Retrieved instructions

Reference byte counts below are filesystem UTF-8 sizes, not a claim that all historical Project prose was model-loaded. Retrieval was bounded to relevant sections; initial combined output was truncated and relevant active Action/procedures were reread separately. Notes entries: SQLite write-denial recovery, dependency bridge, sandbox Session ancestry, fast rehearsal; matching evidence paths referenced by those sections. No Notes file was missing.

| Path | Bytes | Retrieved scope |
| --- | ---: | --- |
| `AGENTS.md` | 10100 | full; plus operator-provided preferences |
| `CONSTITUTION.md` | 3320 | full |
| `PROJECT.md` | 31677 | frontmatter/current pointer; historical prose not relied on |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 | full |
| `.arcadia/repo-context.md` | 703 | full |
| `.arcadia/context-policy.json` | 870 | full |
| `docs/agent-guidance/index.json` | 9449 | full |
| `.agents/skills/arcadia-role/SKILL.md` | 9080 | full |
| `.agents/skills/arcadia-guardrail/SKILL.md` | 5565 | full |
| `docs/agent-guidance/operator-directed-work.md` | 4494 | full |
| `docs/agent-guidance/learning.md` | 2458 | full |
| `docs/agent-guidance/continuation.md` | 7256 | startup and handoff |
| `docs/working-copy-safety.md` | 16202 | full |
| `docs/agent-guidance/session-roles-and-briefs.md` | 6152 | full |
| `docs/agent-guidance/standard-harness.md` | 5569 | full |
| `docs/agent-guidance/pull-requests.md` | 17585 | review, CI, identity/notification, QA and work metadata |
| `docs/agent-guidance/git-identity.md` | 5248 | full |
| `docs/agent-guidance/arcadia-repository.md` | 30174 | Orientation, semantics, model selection, operator guide, PR QA, working-copy, experiment rules |
| `docs/AGENT_ORIENTATION.md` | 13594 | database/Artifacts/execution conventions |
| `docs/arcadia-semantics.md` | 15647 | core vocabulary and Behavior |
| `docs/agent-guidance/ask-todo-scout.md` | 2704 | full |
| `docs/scout/CONTINUE.md` | 17341 | full before changes |
| `docs/decisions/0128-record-the-operator-authorized-bounded-luna-hello-world-attempt-bug-repair.md` | 7256 | full |
| `docs/plans/execute-one-approved-named-run-safely-with-production-off.md` | 10192 | exact first Action and all six criteria |
| `docs/plans/arcadia-runs-production-unattended-on-its-own-repository-on-the-claude-provider.md` | 12400 | exact active claude-worker-launch-replay Action |
| `docs/notes-to-self.md` | 39635 | targeted matching sections |
| `docs/agent-guidance/chat-titles.md` | 4766 | full |
| `docs/agent-guidance/principles.md` | 14124 | scope, economy, preservation |

Relayed raw instruction UTF-8 SHA-256 (no terminal LF): `2f7e3b0b7f4ccbb4b169b494e5fb507453679d73a75bc8a330b9174996064066`.

Fast-rehearsal report SHA-256: `54c9a1aba66973373a4db2bbe4c105d9bb7cbc680cabd7b8861afee2ee04bce2`.

## Independent round 1 and bounded repair

PR: [#1455](https://github.com/pmark/arcadia/pull/1455). Reviewed predecessor: `1ea8e889b2423dc912cee3345838085739087bc1`. All seven CI jobs passed on that predecessor (run `38871994195`); those checks do not establish the repaired head. PR-opened FYI queued as `ping_668caae20c034b0988`, not claimed delivered. CodeRabbit skipped the draft, with no findings.

Separate Code-reviewer `01a143c4-2270-79f2-aaa6-367226960d0b` returned REQUEST CHANGES; QA `01a143c4-3026-7a73-80d7-c567876e5e97` returned NEEDS FOLLOW-UP. Their full raw receipts are preserved verbatim in `docs/reports/approved-run-1455-r1-receipts.json` (source: manager's `/private/tmp/approved-run-1455-r1-receipts.json`). No enrolled lineage or runtime binding is inferred. Their three P1 findings supersede the initial author assessment above:

1. **Shared-provider admission:** the new approved-Ask branch accidentally applied to ordinary worker/default providers. Repaired by making this receipt conditional on the checked scripted-fixture path in the shared approval check. Arbitrary fixture adapters were removed from the execution API; a workspace-local `.mjs` script always constructs the fixed Node/empty-environment/bounded fixture adapter. Direct default-provider and actual ordinary-worker regressions assert refusal with zero provider/fixture invocations. Durable live admission remains unavailable.
2. **Timeout truth/hard bound:** Node can report exit 0 and ETIMEDOUT together when SIGTERM is caught. Execution now returns error/timeout/signal evidence, and outcome reduction refuses completion for any of them, even exit 0. Executor timeout uses SIGKILL, so ignoring SIGTERM cannot defeat the bound. Metadata/follow-up diagnostics and Run summaries retain the failure. Tests write the exact product before waiting, cover SIGTERM handlers that exit 0 or ignore the signal, assert the timeout and no ready product, and separately test exit-0 error reduction.
3. **Consumer interruption:** the compare-and-set claim and unresolved `requires_review` posture commit in the same immediate transaction before execution. A process killed before commit leaves the original pending Run; after commit it leaves a conservative review-needed record, never a false running/completed claim. Only the same owning process with the fixture posture can execute; public consume rejects it thereafter. Real separate CLI tests send SIGINT, SIGTERM and SIGKILL after the external script starts, then verify the exact file alone is not accepted product evidence and no second invocation occurs. Test children expire themselves; no recovery daemon, periodic sweep, orphan rescue or second harness was introduced.

The new-EOF blank line in `runFinalization.ts` is removed. `git diff --check HEAD` checks the actual repair delta, not only unstaged lines; final base-to-head check is required before handback.

Manager assigned repair pass 1 for these named failures at 08:16–08:17Z, with at most 20 minutes per failure and a combined wall cap `2026-10-16T08:56:00Z`. This is a finite repair extension, not a reset of the initial allowance. No actual live attempt or runtime repair is consumed by source repair.

R1 repair commands: `pnpm exec vitest run tests/run-consume-one.test.ts` passed **34/34**, exit 0 (`/private/tmp/consume-r1-focused.log`); expanded exact-byte assertions also passed 34/34 (`consume-r1-acceptance.log`). `pnpm exec tsc --noEmit -p tsconfig.json` exit 0 after fixing one typed `Error.code` access using a property guard (`consume-r1-tsc2.log`); first failure retained as `consume-r1-tsc.log`. `pnpm check:agent-guidance` exit 0 after the canonical Scout fingerprint refresh (`consume-r1-guidance.log`). Final combined normal-execution regression, lint/TypeScript/build and committed-head receipts follow in the PR; no second review or completion settlement is claimed yet.

Current criterion gaps: criteria 1–5 have expanded deterministic source evidence, subject to independent delta verification; criterion 6 still requires round-2 Code-reviewer/QA and all seven jobs on the repaired head. The initial 27-test source receipt and predecessor CI are historical only. The source checkpoint remains one file; this section supersedes its prior current-state claims.

Repair validation before R2: `pnpm exec vitest run tests/run-consume-one.test.ts tests/cli-response-execution.test.ts` **exit 0, 81/81** (`/private/tmp/consume-r1-final-tests.log`), including all 34 consumer checks and the 47 normal execution/review checks. `pnpm build` **exit 0** (`/private/tmp/consume-r1-build.log`), including repository lint and TypeScript. `pnpm check:session-ledger` **exit 0**; `git diff --check df5576a639a6052c71d20e4c9f42384a1ecf7092` **exit 0** (including the repaired EOF). No unchanged full-suite repetition was needed; the unchanged managed-production rehearsal is retained, and current-head CI remains mandatory.

The review correction was captured as `lesson_5af0ff4ade855263638d`; manager separately reported `lesson_5f2612ea3b0f890ae421`. These observations narrow the original receipt-mismatch lesson rather than treating it as provider-launch authority. Actual runtime model/effort/tokens remain unknown; no source-repair delegate or live provider was launched. Independent review/QA and current-head CI still gate completion. The repaired head is the commit containing this final R1 section; its exact SHA is published in the PR and this chat before R2.

Verbatim R1 receipt SHA-256: `da2f70fb626a209653af00b3bf3b1db645ece272e687f15d924293f4ccf7bb43`.
