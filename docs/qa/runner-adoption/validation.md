# Mandatory Plan-amendment runner adoption

Milestone: bootstrap managed production to run unattended from the GitHub board.
Work classification: deterministic operator-protocol enforcement, issue #837.
Next action: validate and review the shared library and settlement guards.
Required artifacts: mandatory agent rule, shared validator, CI gate, hermetic
proof and reviewed PR. No unrelated governed Action is completed or advanced.

The repository's vendor-neutral `AGENTS.md` now directs every agent preparing
an existing-Plan amendment button to the versioned runner and its canonical
launcher. `pnpm check:operator-scripts` validates every generated library pair,
and the CI lint job invokes it. `/runs` uses that same contract before launch.
A new arbitrary-id fixture proves that an appended command fails the gate;
the API test proves its marker is never created and no process state is started.

The detached dashboard runner supplies the actual action id and descriptor
path to descendants, overriding stale inherited action context. The canonical
Agent Ask settlement path inspects the actual proposal before previews, apply
or receipt replay. A Plan amendment requires the shared runner's synchronous
in-process scope and pinned declaration. Claiming draft-Plan creation or using
CLI flags cannot satisfy it. Ordinary candidate/manual authority stays intact;
a declared Log settlement succeeds through the real path.

Validation on 2026-09-30:

- 112 focused tests passed in seven files: library contract, all 26 real-workspace
  runner cases, canonical settlement, API refusal, lifecycle and migrated action.
- Detached runner context test: 6 passed, including the new context-binding case.
  The combined focused set therefore contains 113 cases.
- Instruction/adopter boundary: 22 passed; incoming base notes: 3 passed.
- Full candidate library: 4 checked, 0 failures. Checker reads files only.
- Core/Discord build, lint/typecheck and Dashboard build passed.
- Preservation self-check passed (1,431 files); `git diff --check` passed.
- Full local suite: 2,607 passed, 18 skipped, 3 failures. The instruction-placement
  failure was repaired and its 22-case file passed. The two existing CLI tests
  timed out at 45 seconds under full-suite load; both passed unchanged in an
  isolated 11.23-second run. Recurrence recorded on issue #452.
- Current-head CodeRabbit and full sharded CI remain integration gates.

Operator QA (same procedure for end users):

1. In a checkout containing this PR, run `mise exec -- pnpm check:operator-scripts`.
   Expected: zero failures; no button or workspace is executed.
2. Run `mise exec -- pnpm exec vitest run tests/operator-script-contract.test.ts
   tests/plan-amendment-runner.test.ts
   apps/dashboard/app/api/operator-script/contract.test.ts
   apps/dashboard/app/api/operator-script/route.test.ts` on one shell line.
   Expected: future-id bespoke/cross-wired launchers fail validation; a real CLI
   amendment disguised as draft creation exits 2 with
   `PLAN_AMENDMENT_RUNNER_REQUIRED`; Plan bytes, HEAD, queue and settlement count
   remain unchanged. The actual shared runner succeeds once and safely replays.
3. Inspect the mandatory rule in `AGENTS.md` and the authoring/recovery contract
   in `docs/operator-plan-amendments.md`. No live amendment click is part of QA.

The API fixtures use an isolated temporary library and never launch their
rejected action. The settlement tests use temporary SQLite workspaces and local
bare origins, without network or models. There is no persistent candidate demo
URL. The installed Dashboard at `http://127.0.0.1:3020/runs` uses the main
checkout; this candidate is not claimed live and needs no service restart.

These guards enforce supported operator-action paths, not a sandbox against
malicious host code deliberately removing context or rewriting enforcement.
Such bypasses are explicitly forbidden in the agent instructions.

No live traceability settlement/retry, Grant, production activation, service
restart, deployment, credential operation or PR #826 transition is performed.
The newer traceability settlement already present on the starting base is
preserved; it was not made by this follow-up.
