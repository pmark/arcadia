# Isolate Agent Asks from production handoff — QA

Milestone: Bootstrap managed production to build Flight Deck.
Action: `isolate-agent-asks-from-production-handoff`. Responsibility: agent implementation.

## What changed

The 2026-09-12 failure this Action was opened against: an Agent Ask drafted
directly as the shared base checkout's root `agent-ask.yaml` left that
checkout dirty, and Arcadia Go's fail-closed clean check refused to proceed —
blocking the very handoff that would have started the next governed Action.
A prior merged change ("Recover drifted legacy agent-ask.yaml instead of
blocking Arcadia Go") fixed the exact single-file legacy case. This Action
generalizes that same recovery mechanism, and closes the gaps a survey against
its own acceptance criteria found:

1. **Generalized drift recovery** (`src/sessions/legacyAskRecovery.ts`):
   `recoverLegacyAgentAskDrift` now recognizes two shapes of drift as the sole
   dirty path in a worktree — the legacy root `agent-ask.yaml`, and any file
   already correctly placed under `.arcadia/asks/*.yaml` but nonetheless
   authored or edited directly in the shared base checkout instead of an
   isolated worktree. The second case is preserved under its own existing
   name rather than renamed, since an agent following the documented
   convention already gave it a collision-safe, request-id-derived name.
2. **Retry-safe, idempotent recovery**: the isolated branch name and file
   path are now derived from the request id and a content hash, not a
   timestamp and random bytes. A recovery interrupted after its commit but
   before cleanup, and retried later, detects the existing commit on the
   deterministic branch name and skips straight to cleanup — no duplicate
   commit, no orphaned branch with a different name holding the same content.
   A recovery interrupted before its commit leaves only an empty, contentless
   branch ref (from `git worktree add -b`, itself removed on every path), which
   a retry safely deletes and recreates rather than reusing.
3. **Fault-injection coverage** (`tests/go.test.ts`): two new tests inject a
   synthetic failure via `testHooks.askRecovery`, one before the recovery
   commit and one after it, and assert the source worktree is left exactly as
   it was (still dirty, original file present, no orphaned recovery worktree)
   or exactly recovered (idempotent retry, single commit, no duplicate
   branch) in each case.
4. **Concurrency fixture** (`tests/agent-ask-settlement.test.ts`): two Agent
   Asks against two different Projects/repositories are drafted, corrected
   (a fresh request id, since a used one is fixed to its original content),
   and settled interleaved rather than sequentially — proving their proposal
   ids, settlement receipts, project slugs, and the exact repository each
   one's effects land in stay fully disjoint regardless of authoring or
   settlement order.
5. **Request-id resolution from the isolated branch** (`src/sessions/legacyAskRecovery.ts`'s
   new `findRecoveredAsk`, wired into `runAgentAskPreviewCommand`): `arcadia
   agent-ask preview --request-id <id>` now finds and reads a recovered Ask's
   content straight off its isolated `ask/recover-*` branch when no `request`
   or `--file` is given, instead of requiring an operator to run `git show
   <branch>:<path> > /tmp/file` first and pass that scratch file. This is the
   part of the Action's acceptance criteria calling for preview to "resolve
   the Ask by request id from that isolated location."
6. **Same-repository concurrency fixture** (`tests/go.test.ts`): the prior
   concurrency fixture proved two different repositories' Ask lifecycles stay
   disjoint, which is trivially true (different `.git`s can't collide). A new
   test drifts an Ask on *both* the source worktree and the base worktree of
   one shared repository at once — the realistic race, since both recoveries
   run against the same `repo` argument (shared refs namespace, shared
   `git worktree` registrations) inside a single `arcadia go` call — and
   proves both land on distinct branches and files without one clobbering or
   racing the other's `worktree add` / commit / `worktree remove` sequence.

## What did not need to change

Settlement already resolved an Ask strictly by `id` or `request_id` (never a
glob), already refused replaying a `request_id` under different content, and
already committed only the exact paths its own file mutations touched.
Preview resolved a *live* Ask (one still passed as `request` or `--file`)
the same way; the gap was resolving one already moved onto an isolated
recovery branch, closed above by `findRecoveredAsk`. The sandbox boundary
(`assertGoBrokerHostController` refusing `go` from `CODEX_SANDBOX`) and the
Agent Ask skill's `.arcadia/asks/` convention were both already correct; this
Action closes the gap between that documented convention and what the code
actually enforced when it was not followed.

## Operator procedure

| Target | Reachability | Start/recovery | URL | Expected result |
| --- | --- | --- | --- | --- |
| Deterministic tests | Local CLI | Commands below, from this branch | Not applicable; no HTTP endpoint | Recovery, fault-injection, and concurrency checks pass |
| Reproduce the original failure | Local CLI | Steps below, in a scratch repository | Not applicable; no HTTP endpoint | Drifted Ask is recovered into an isolated branch instead of blocking the handoff |

This Action has no runnable UI or service; it changes only the `arcadia go`
CLI's internal recovery step and the Agent Ask settlement library. The
strongest available proof is the deterministic test suite plus a manual
reproduction of the original failure, both below.

1. From this worktree, run `pnpm bridge:worktree`, then
   `mise exec -- pnpm exec tsc -p tsconfig.json`. Expected: exit 0, no
   TypeScript errors.
2. Run
   `mise exec -- pnpm exec vitest run tests/go.test.ts tests/agent-ask.test.ts tests/agent-ask-settlement.test.ts tests/agent-ask-complete.test.ts tests/agent-ask-contract.test.ts`.
   Expected: all pass (see Recorded validation below for the exact counts).
3. To reproduce the original 2026-09-12 failure and its fix by hand: create a
   scratch repository with a base worktree and an agent worktree (as
   `tests/go.test.ts`'s `createFixture` does), write
   `agent_ask: v1\nrequest_id: manual-check\nproject: unknown\nintent: log\ndesired_result: manual check\n`
   to `agent-ask.yaml` at the base worktree's root, then run
   `arcadia go --repo <base> --source <agent-worktree> --apply`. Expected:
   the command succeeds, `agent-ask.yaml` is gone from the base worktree,
   `git status` there is clean, and `result.askRecoveries[0]` (or the
   equivalent CLI JSON output) names the new branch `ask/recover-manual-check-<hash>`
   and path `.arcadia/asks/agent-ask-manual-check-<hash>.yaml` — inspectable
   with `git show ask/recover-manual-check-<hash>:.arcadia/asks/agent-ask-manual-check-<hash>.yaml`.
4. To prove the isolated draft still shows up under this recovery when it is
   authored with a compliant name but in the wrong place, repeat step 3 but
   write the same content instead to `.arcadia/asks/agent-ask-manual-check-2.yaml`
   in the base worktree. Expected: the same recovery fires and the file keeps
   its original name on the isolated branch rather than being renamed again.
5. To prove the preserved Ask can still be previewed or settled after
   recovery, from the base checkout: `arcadia agent-ask preview --request-id
   manual-check --dir <base>`. Expected: a normal preview succeeds against the
   recovered content, exactly as if it had been drafted correctly from the
   start, with no intermediate `git show` step. (`git show
   <branch>:<askFile> > /tmp/recovered-ask.yaml` followed by `arcadia
   agent-ask preview --file /tmp/recovered-ask.yaml` still works too, for a
   workspace where addressing by request id alone is not convenient.)
6. To confirm the prepared production worktree starts from the unchanged
   clean base after recovery: after step 3, run `git log --oneline -1 main`
   in the base checkout and confirm it shows only the original fixture commits
   plus (if `--apply` integrated a source branch) that branch's commits — no
   trace of the recovered Ask content, which lives only on its own isolated
   branch.

## End-user procedure

Same as the operator procedure: an agent or operator who directly edits
`agent-ask.yaml` at a repository's root, or drops a `.arcadia/asks/*.yaml`
file into the shared base checkout instead of an isolated worktree, needs to
take no recovery action themselves. The next `arcadia go` (interactive or
broker-driven) recovers it automatically and reports the recovery location in
its JSON output's `askRecoveries` field before proceeding with the handoff.

## Boundaries and follow-up

This recovers drift that presents as the single dirty path in a worktree,
matching the documented failure mode. A worktree with the drifted Ask file
*and* other unrelated uncommitted changes still refuses via the existing
fail-closed `assertClean`, naming every dirty path, exactly as before — this
Action does not weaken that refusal.

Authoring inside an already-isolated per-session worktree (the documented,
recommended path) needs no additional branch or worktree of its own: that
worktree is already exclusive to one agent and one branch, so the isolation
this Action adds only matters for the shared base checkout, which is the
failure mode it exists to close.

## Recorded validation

- `mise exec -- pnpm exec tsc -p tsconfig.json`: exit 0.
- `mise exec -- pnpm exec vitest run tests/go.test.ts`: **28 passed** (0 failed),
  including the 2 same-repository recovery tests this pass adds (request-id
  preview resolution, and the source+base simultaneous-drift concurrency
  fixture) on top of the prior drift-recovery/fault-injection tests.
- `mise exec -- pnpm exec vitest run tests/agent-ask-settlement.test.ts tests/agent-ask.test.ts tests/agent-ask-complete.test.ts tests/agent-ask-contract.test.ts`:
  **73 passed** (0 failed), including the cross-repository concurrency fixture.
- Full repository suite (`mise exec -- pnpm exec vitest run`): failures are
  confined to tests that need a real socket, process boundary, or writable
  path this sandbox refuses (`EPERM`/timeouts in `test/intelligence/*`,
  `tests/discord-bot.test.ts`, `tests/ingress-service.test.ts`,
  `tests/proof-targets.test.ts`, `tests/rebuster-capability.test.ts`), a
  read-only workspace database (`tests/phase3.test.ts`), and mise/certificate
  stderr noise leaking into stdout-equality assertions
  (`tests/cli-response.test.ts`, `tests/dogfood.test.ts`,
  `tests/planning-artifact-workflow.test.ts`, `tests/project-prepare.test.ts`)
  — all pre-existing sandbox limitations unrelated to this change. None touch
  `tests/go.test.ts` or any `tests/agent-ask*.test.ts`, and this change
  touches no `src/intelligence*` code.
