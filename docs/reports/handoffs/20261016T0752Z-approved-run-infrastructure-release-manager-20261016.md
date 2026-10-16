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
