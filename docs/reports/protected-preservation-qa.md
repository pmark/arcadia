# Protected candidate preservation QA

Milestone: Bootstrap managed production to build Flight Deck.
Action: `let-agent-preserve-its-candidate`. Responsibility: agent implementation.

The sandboxed launcher now submits only a nonce from its registered worktree.
The existing host worker reads the request, validates the authorized packet's
objective checks in Seatbelt, and commits the identical tested Git tree through
the existing preservation machinery. Passing checks do not accept the Action.

## Operator procedure

| Target | Reachability | Start/recovery | URL | Expected result |
| --- | --- | --- | --- | --- |
| Deterministic tests | Local CLI | Commands below, from this branch | Not applicable; no HTTP endpoint | Scope, binding, mutation and recovery checks pass |
| Disposable protected-boundary proof | macOS host CLI; requires installed Codex `arcadia-unattended` profile | `mise exec -- node --import tsx scripts/prove-protected-preservation.ts` | Not applicable; no HTTP endpoint | Real sandbox request reaches the existing host worker; one local commit, no pointer movement |
| Production request consumer | Local host worker; not upgraded or restarted by this PR | `arcadia worker start --workspace /absolute/path/to/workspace` after installing the reviewed revision | Not applicable; filesystem request transport | Fresh named transport readiness; existing scoped authority still required |

1. In the candidate checkout, run `pnpm bridge:worktree`, then
   `pnpm exec tsc -p tsconfig.json`. Expected: compiled candidate runtime and no
   TypeScript errors. No global broker install is required for the disposable proof.
2. Run `pnpm exec vitest run tests/candidate-preservation.test.ts tests/preservation-validation.test.ts tests/go-broker.test.ts tests/go-broker-agent-setup.test.ts`.
   Expected: deterministic tests pass; native sandbox tests are explicitly skipped.
3. From an authorized macOS host terminal, run
   `ARCADIA_PRESERVATION_HOST_TEST=1 pnpm exec vitest run tests/preservation-validation.test.ts`.
   Expected: actual sandbox checks pass, including refused source writes, forged
   assertions, failed checks, mutation during validation and mutation before preservation.
4. From that host terminal, run
   `mise exec -- node --import tsx scripts/prove-protected-preservation.ts`.
   Expected: the real installed Codex `arcadia-unattended` sandbox allows fixture
   edits and denies writes to the shared Git directory, protected evidence and
   launcher. The generated launcher rejects extra authority arguments. An
   agent-written passing evidence file cannot save a failing candidate. A valid
   request reaches the existing worker, produces one commit with the tested
   tree hash, and a repeated request returns that commit. Action status and
   pointers stay unchanged. No model is invoked, no remote is used, and no
   production policy is changed. The script removes only its disposable runtime
   and fixtures, retaining `docs/reports/protected-preservation-fixture.json`.
5. Inspect that JSON: compare `receipt.candidateFingerprint` to passing
   validation `tree`, check the runtime digest and exact commands, and confirm
   denied writes, zero sandbox approval prompts and zero hidden interventions.
   The recorded host invocation is explicit; this is not unattended production.

## End-user procedure

After the operator installs the reviewed broker revision and runs the updated
host worker, use `~/.local/bin/arcadia-preserve-broker-codex` (or the `-claude`
launcher) with **no arguments**, from the registered candidate worktree.
Expected: a host-protected validation/commit receipt, or a concrete refusal.
Retain LOCAL ONLY recovery instructions if remote preservation was not granted.
Do not run Git mutation, submit evidence assertions, or relax the sandbox.

## Boundaries and follow-up

The current host backend uses `/usr/bin/python3` for anchored, no-symlink raw
file capture and `/usr/bin/sandbox-exec` for checks. It supports regular files
up to 64 MiB total, at most ten checks with a two-minute deadline each, and
self-contained check commands. The immutable source tree has no writable build
or dependency directories; checks may write temporary output under `$TMPDIR`.
Network, source writes, symlinks/submodules, missing checks and unsupported hosts
fail closed. Broader build/dependency support earns work only when a real
Project's declared preservation check needs it.

The existing worker consumes preservation requests; this change does not add
continuous Session admission, reconciliation, acceptance, integration or
completion. Guarded launch and the reconciliation/completion chain remain the
next governed work. The real-host rehearsal still waits for those prerequisites
and all explicit preflight grants. Remote-preservation behavior is covered by
the existing injected-remote tests; this fixture claims local preservation only.

## Recorded validation

- TypeScript compilation passed (`pnpm exec tsc -p tsconfig.json`).
- Preservation, broker and agent-setup regression tests: **47 passed**.
- Native Seatbelt validation/authority/content tests: **7 passed**.
- Existing planning-worker compatibility tests: **16 passed on the host**.
  The standalone tsx CLI case requires host IPC; its agent-sandbox failure was
  not treated as an implementation pass.
- The actual Codex `arcadia-unattended` boundary fixture passed. Its exact
  source revision, compiled-runtime digest, commands, validation results and
  preserved tree/commit are in `protected-preservation-fixture.json`.

The installed production worker and global broker were not upgraded by this
work. Integration, acceptance, completion and pointer advancement remain
separate governed operations. The implementation Action remains open for review.
