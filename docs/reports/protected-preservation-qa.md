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
   The status regression creates a disposable correct install without a heartbeat,
   verifies successful status and refused preservation, then separately verifies
   that a missing preserve launcher still fails status. The launcher test enters
   the actual script with `CODEX_SANDBOX=seatbelt` and verifies transport routing;
   its transport result is mocked, so it is not a native boundary proof.
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
   production policy is changed. The script runs two scenarios: a registered
   managed Session, and the real `arcadia go` **manual handoff** shape with an
   active worktree reservation and no Session, packet or production grant
   (`authorityKind: manual_handoff`, `policyEpoch: 0`). The script removes only
   its disposable runtime and fixtures, retaining
   `docs/reports/protected-preservation-fixture.json`.
5. Inspect that JSON: compare `receipt.candidateFingerprint` to passing
   validation `tree`, check the runtime digest and exact commands, and confirm
   denied writes, zero sandbox approval prompts and zero hidden interventions.
   The `scenarios.session` and `scenarios.handoff` entries record each boundary
   side by side, including the host heartbeat routes. The recorded host
   invocation is explicit; this is not unattended production.

6. After the operator installs the reviewed revision, run `arcadia go-broker status`
   on the host before starting its worker. Expected for a correct install:
   `Protected broker setup: READY`; without a fresh heartbeat, also
   `Preservation transport: NOT READY`. `arcadia go-broker status --json`
   reports `data.ready: true` and `data.preservationTransport.ready: false`.
   Start `arcadia worker start --workspace /absolute/path/to/workspace` in a
   separate host terminal using the configured workspace, then repeat status.
   Expected while the updated worker is idle: transport `READY`. A missing
   preserve launcher is still a fatal named `preservationLauncher` setup error.

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
fail closed.

A declared check that needs installed dependencies cannot run in that tree. The
dependency boundary is now explicit rather than a misleading readiness followed
by a sandbox failure: `advance`, `go` and `go-broker status` classify each
declared command and report a named `validation_requires_dependencies` blocker
whose remedy names a self-contained substitute, and the manual and managed
binding paths refuse with the same wording before any check runs. Classification
is a deterministic command scan (`src/sessions/preservationChecks.ts`); it never
executes anything, and an unrecognised command still runs and fails closed.

Arcadia's own Project declares a genuine self-contained objective check,
`node scripts/preservation-self-check.mjs` (`scripts/preservation-self-check.mjs`),
declared once per Project with:

```sh
pnpm arcadia project metadata <project-id> --validation-command "node scripts/preservation-self-check.mjs"
```

It uses only Node built-in modules against the immutable tracked tree and fails
on a missing control document, invalid JSON, an unresolved merge-conflict
marker, or an unresolvable relative import. It is a preservation gate, not a
replacement for the objective checks: `pnpm test` plus the core, Discord and
Dashboard builds remain the Action-completion and PR-QA gate, run outside the
sandbox where dependencies are available. Dependency-aware host-side validation
is separate governed work (`preserve-on-exit-and-integrate`, which validates
host-side where dependencies are available); this Action adds no network,
read, write or symlink exception to the sandbox.

The existing worker consumes preservation requests; this change does not add
continuous Session admission, reconciliation, acceptance, integration or
completion. Guarded launch and the reconciliation/completion chain remain the
next governed work. The real-host rehearsal still waits for those prerequisites
and all explicit preflight grants. Remote-preservation behavior is covered by
the existing injected-remote tests; this fixture claims local preservation only.

## Review correction and acceptance reading

Installation health and transport runtime readiness are separate. The Action's
named-readiness/fail-closed criterion is implemented by refusing missing
launchers during status and refusing actual preservation requests when transport
is unavailable. Worker downtime remains visible in a nonfatal status field.
This interpretation changes no governed document or authority.

All preservation launcher requests use the transport. The unused direct
`runGoBroker` preservation branch and its host-operation entry were removed;
the worker's host guard remains. Snapshot behavior is unchanged: Git ignore
rules exclude untracked ignored files, including rules in the candidate's
`.gitignore`. The misleading comment was corrected only.

The `protected-preservation-fixture.json` Artifact now records a fresh host run
against PR #224's exact merged source revision,
`f73a04c31089f99f2eb4db4505ea1ba17be61a34`, including its revised launcher guard
dispatch. On 2026-09-12, after the operator reported the missed pre-merge check,
the host-authorized command `mise exec -- node --import tsx scripts/prove-protected-preservation.ts`
passed from a clean isolated worktree after TypeScript compilation. Its compiled
runtime SHA-256 is `240ee876794f8709b733565f58799ec79ef96c2b7c820c6005e548396f01eec4`.

The real `arcadia-unattended` sandbox permitted candidate edits and refused
shared-Git, protected-evidence and launcher writes. Extra arguments and forged
passing evidence were refused. Successful validation and the committed tree
both identify `6d408558371d25308aa300d65d75618399ced35c`; replay returned the same
fixture commit, `012499e044bf3d7f5872f342a25f3811033d8ee4`, with exactly one commit
beyond the fixture base. The fixture Action and pointer remained unchanged.
All seven sandbox command results are recorded, including the two expected
refusals. Zero sandbox approval prompts and zero hidden interventions were
observed; host authorization was explicit and this is not unattended production.
The script retired its disposable worker, repositories and runtime, and both
temporary roots were verified absent. No installed production service was changed.

## Recorded validation

Native host validation of the manual-handoff path (2026-09-16, source revision
`ac6ee692`, from a prepared candidate worktree after the dependency bridge and
TypeScript compilation):

- `pnpm exec tsc -p tsconfig.json`: exit 0.
- Deterministic suite (`candidate-preservation`, `preservation-validation`,
  `manual-preservation`, `go-broker`, `go-broker-agent-setup`,
  `go-request-transport`, `preservation-heartbeat-freshness`): **7 files passed;
  79 passed, 7 skipped** (the seven native cases skip by design off the host).
- Native host suite
  (`ARCADIA_PRESERVATION_HOST_TEST=1 pnpm exec vitest run tests/preservation-validation.test.ts tests/manual-preservation.test.ts`):
  **2 files passed; 19 passed, 0 skipped.** The manual `go` handoff validates
  and preserves one local candidate with replay and no production activation,
  and content mutation during validation and between validation and
  preservation is refused.
- Disposable protected-boundary proof
  (`mise exec -- node --import tsx scripts/prove-protected-preservation.ts`):
  exit 0. Both the managed Session and the manual handoff scenarios reached the
  existing worker through the real installed Codex `arcadia-unattended` sandbox.
  Each created exactly one LOCAL ONLY commit whose committed tree equals the
  validated snapshot, replay returned that same commit, and the fixture Action
  and pointer stayed unchanged. The handoff scenario recorded
  `authorityKind: manual_handoff`, `policyEpoch: 0`, an empty `sessions`
  heartbeat route and one advertised `handoffs` route; the session scenario
  recorded a managed Session lease at policy epoch 1. Zero sandbox approval
  prompts and zero hidden interventions were observed.

Boundary Artifact refresh and fail-closed refusal (2026-09-17, source revision
`747be489`, prepared opencode candidate worktree after the dependency bridge and
TypeScript compilation):

- `pnpm exec tsc -p tsconfig.json`: exit 0.
- Deterministic suite (`candidate-preservation`, `preservation-validation`,
  `manual-preservation`, `go-broker`, `go-broker-agent-setup`,
  `go-request-transport`, `preservation-heartbeat-freshness`): **7 files passed;
  84 passed, 7 skipped** (the native cases skip by design off the host).
- Disposable protected-boundary proof
  (`mise exec -- node --import tsx scripts/prove-protected-preservation.ts`):
  exit 0. Both the managed Session and the manual handoff scenarios reached the
  existing worker through the real installed Codex `arcadia-unattended` sandbox
  at source revision `747be4898ac2b6cabe47316ccc2fea9910516f8a`, runtime SHA-256
  `5de0dc43a65bf058e87b65df38047debb43fbadbcdc2c2da97815310ddb64e03`, each
  creating exactly one LOCAL ONLY commit whose committed tree equals the
  validated snapshot, with zero sandbox approval prompts and zero hidden
  interventions. `docs/reports/protected-preservation-fixture.json` is the
  refreshed Artifact for this revision.
- From this prepared opencode candidate, the fixed preservation launcher
  `arcadia-preserve-broker-opencode` reached the existing host worker and was
  refused with `Manual preservation requires 1–10 host-configured objective
  validation_commands; a planning approval is not the remedy.` The agent-callable
  path is live and fails closed with a named remedy. Declaring a sandbox-runnable
  objective check for Arcadia is the dependent Action
  `preserve-projects-with-dependencies` (GitHub Issue #273), which depends on
  this Action.

Dependency remedy and self-contained check (2026-09-18, prepared opencode
candidate at base `7958bd15` after the dependency bridge and TypeScript
compilation):

- `pnpm exec tsc -p tsconfig.json`: exit 0. `pnpm lint`: exit 0.
- Focused suite (`preservation-checks`, `preservation-self-check`,
  `manual-preservation`, `preservation-validation`, `candidate-preservation`,
  `go-broker`, `go-broker-agent-setup`): **7 files passed; 73 passed, 7 skipped**
  (the seven native cases skip by design off the host).
- `pnpm test`: 1742 passed, 13 skipped, 1 failed. The single failure,
  `cli-response-contracts.test.ts` "runs a clarification Decision through open,
  list, and resolve", timed out at 30s under full parallel load; it passes 34/34
  in isolation and touches no preservation path.
- `pnpm build` and `pnpm dashboard:build`: exit 0.
- Arcadia's Project now declares `node scripts/preservation-self-check.mjs` in
  host-managed `validation_commands`, set with the exact command documented
  above. A declared `pnpm test` check is refused with the named
  `validation_requires_dependencies` remedy by `advance`, `go` and `go-broker
  status` instead of reporting readiness and then failing in the sandbox.

Review follow-up (2026-09-18, PR #324):

- `src/sessions/preservationChecks.ts` now matches only executable positions
  (the first token of each shell segment, skipping `NAME=value` prefixes and
  launcher wrappers such as `env`/`sudo`/`nice` together with their options and
  the values those options consume, so `sudo -u user vitest` resolves to
  `vitest`) instead of every token, so a self-contained check whose argument or
  filename is merely named `git`, `curl`, or `vitest` is no longer refused. It
  also classifies `python -m <module>` as dependency-backed for known
  third-party modules (`pytest`, `mypy`, …) while leaving standard-library
  modules self-contained. `node_modules` path detection is unchanged.
- `scripts/preservation-self-check.mjs` no longer skips every hidden entry; it
  skips symbolic links and `.git`, and relies on the explicit ignored-directory
  set. Tracked hidden files (`.arcadia/**`, `.claude/**`, `.github/**`,
  `.env.example`, `.gitignore`) are now inspected. The check passes on the
  tracked tree (1044 files inspected).
- Re-validation: `pnpm exec tsc -p tsconfig.json`, `pnpm lint`, `pnpm build` and
  `pnpm dashboard:build` exit 0; the four preservation test files pass (23
  passed, 7 native skips). A `pnpm test` run under heavy local background load
  (dashboard, Discord, Intelligence, worker and a second live session) recorded
  1729 passed, 13 skipped and 17 timeout failures, all `Test timed out in
  30000ms` in CLI-spawn contract files; those five files pass 127/127 together
  in isolation. The timeouts are host contention, not code regression.
- Not adopted from the review: a host-owned or digest-pinned preservation
  checker. Arcadia's declared check is candidate-owned by the approved
  mechanism (the same trust model as the repository's test suite); moving to a
  host-owned checker or pinning the checker digest into host metadata is a
  design change owned by `preserve-on-exit-and-integrate`, not this Action.

Review correction verification (2026-09-12):

- `mise exec -- pnpm exec tsc -p tsconfig.json`: exit 0.
- `mise exec -- pnpm exec vitest run tests/candidate-preservation.test.ts tests/go-broker.test.ts tests/go-broker-agent-setup.test.ts tests/preservation-validation.test.ts`:
  **4 test files passed; 50 tests passed, 5 skipped** (26.17 seconds).
  The five native host tests were explicitly skipped; no new real-host run is claimed.

Post-merge verification (2026-09-12):

- TypeScript compilation at merged source `f73a04c`: exit 0.
- Real Codex host-boundary fixture: exit 0; revised launcher dispatch verified.
- The evidence-only follow-up changes no implementation or governance state.

Original implementation evidence:

- TypeScript compilation passed (`pnpm exec tsc -p tsconfig.json`).
- Preservation, broker and agent-setup regression tests: **47 passed**.
- Native Seatbelt validation/authority/content tests: **7 passed**.
- Existing planning-worker compatibility tests: **16 passed on the host**.
  The standalone tsx CLI case requires host IPC; its agent-sandbox failure was
  not treated as an implementation pass.
- The actual Codex `arcadia-unattended` boundary fixture passed. Its exact
  source revision, compiled-runtime digest, commands, validation results and
  preserved tree/commit were recorded. The Artifact now contains the fresh
  merged-revision run described above.

The installed production worker and global broker were not upgraded by this
work. Integration, acceptance, completion and pointer advancement remain
separate governed operations. The implementation Action remains open for review.

## Bind declared checks to the authorized packet (Action `bind-preservation-checks-to-host-owned-code`, GitHub Issue #326)

The prior "not adopted" note above left `validateBoundCandidate` binding each
declared command's *text* to the packet, not the content it executes — a
candidate that replaced `scripts/preservation-self-check.mjs` with
`process.exit(0)` still passed, because the check ran from the candidate's own
materialized tree (`src/sessions/preservationValidation.ts:62-104` at the time
Issue #326 was filed).

**Chosen mechanism:** a content-digest binding, not a new host-owned checker
process. `src/sessions/preservationCheckBinding.ts` resolves, for each declared
command, the script file it actually executes — the command's own path if run
directly, or the positional argument following a known interpreter
(`node`/`python3`/`sh`/`bash`/…) — plus that file's static relative
`import`/`export from`/`import()`/`require()` closure, all read from the
*authorized base revision* (the Session lease's `base_revision`, or the manual
Go binding's `baseRevision`), never from the candidate. `validateBoundCandidate`
calls this before running anything: every bound file's Git blob at the base
must equal what the candidate tree has (or both absent); any difference is
refused by name (`Candidate changed \`<path>\`, which declared preservation
check \`<command>\` executes; a candidate cannot rewrite the check that judges
it.`) with no check executed and nothing committed.

**Security boundary, stated plainly:** this binds the command's named files and
their static relative-import closure as read from the trusted base. It does
not cover data the check reads by design (the candidate content it judges — a
check inspecting `marker.txt` is meant to see the candidate's `marker.txt`,
which is why only the resolved *executed script*, not every path-shaped
argument, is bound), specifiers computed at run time (dynamic string
concatenation into `require()`), or interpreter configuration such as
`package.json` `"type"`. Changing a genuine check therefore requires landing
the change on the base branch first, then preparing and authorizing a fresh
packet — the same path any other candidate change to shared checks already
requires. Documentation-only treatment was explicitly rejected: it cannot
refuse a rewritten check, which is the entire defect Issue #326 reported.

Evidence (2026-09-23, prepared claude candidate at base `7f4f9c94`):

- Deterministic suite (`preservation-validation`, `preservation-checks`,
  `manual-preservation`): 3 files passed, 28 passed, 7 native skips (skip by
  design off the host). Includes two new cases: a candidate that neuters its
  declared check (`process.exit(0)` in place of `check.mjs`) is refused before
  execution with the named reason, and the candidate's own files are left
  untouched — no repair, no fabricated commit; a second candidate that leaves
  its check unchanged binds without refusal.
- Native Seatbelt suite run explicitly on the host
  (`ARCADIA_PRESERVATION_HOST_TEST=1`): 4 files passed, 58 passed, including
  the pre-existing "refuses failed checks and source-writing checks" case,
  which exercises a declared check that writes into a tracked data file
  (`printf forged > marker.txt`) — confirming the binding does not refuse a
  check's own write/output targets, only the script it executes.
- `pnpm test`: 2042 passed, 15 skipped, 1 unrelated failure
  (`test/intelligence/packageBoundary.test.ts`'s `beforeAll` build hook timed
  out under load; passes standalone in 195ms — host contention, not a
  regression, matching the pattern already noted above for CLI-spawn suites).
- `pnpm build` (lint, `tsc -p tsconfig.json`, Discord bot build) and
  `pnpm --filter arcadia-dashboard build`: exit 0.

Review follow-up (2026-09-23, PR #552):

- CodeRabbit's Advanced-Tier security pass found four real closure gaps in
  the first cut of `preservationCheckBinding.ts`, all fixed in the same
  candidate: a launcher wrapper (`env node check.mjs`) left the script
  unidentified and the check unbound entirely, the tightest of the four,
  since it silently ran the declared check with no protection at all rather
  than narrowly missing one helper file; `REQUIRE_PROBES` missed a directory
  `require("./rules")` resolving to `rules/index.json`; the relative-import
  regex missed a specifier preceded by a `/* comment */`; and a directly
  invoked Python check's same-directory `import helper` closure was not
  traced at all. `LAUNCHER_TOKENS` (mirroring `preservationChecks.ts`'s own
  launcher handling), the widened `REQUIRE_PROBES`, a comment-tolerant
  `RELATIVE_SPECIFIER`, and a new same-directory Python import walk close all
  four; `tests/preservation-check-binding.test.ts` adds one regression case
  per gap (unchanged binds, rewritten refuses). The module's header comment
  states the resulting boundary plainly, including what remains uncovered by
  design (inline interpreter code, a dotted Python package import, an
  unidentifiable bare system command).
- A fifth finding asked the archived settlement record
  (`.arcadia/asks/archive/agent-ask-complete-bind-preservation-checks-to-host-owned-code-2026-09-23b.yaml`)
  and its paired `MISSION_LOG.md` entry to be corrected to a zero-failure
  `pnpm test` run. Those are immutable settled governance records per
  `AGENTS.md`'s "Asking Arcadia to change Project state" — hand-editing a
  landed completion record to read differently after the fact would
  misrepresent what was actually observed at settlement time, which is worse
  than the informational gap it would fix. The record already disclosed the
  one failure and its cause rather than hiding it. This section is the
  correct place for the superseding evidence instead: `pnpm test` immediately
  after this review round ran clean — **2050 passed, 13 skipped, 0
  failures** — confirming the earlier failure was exactly the transient host
  contention it was recorded as.
- Re-validation after the four fixes: focused suite
  (`preservation-check-binding` — new, `preservation-validation`,
  `preservation-checks`, `manual-preservation`, `candidate-preservation`,
  `preserve-on-exit-and-integrate`) with `ARCADIA_PRESERVATION_HOST_TEST=1`:
  6 files passed, 69 passed. Full `pnpm test`: 2050 passed, 13 skipped, 0
  failures. `pnpm build` and `pnpm --filter arcadia-dashboard build`: exit 0.

Review follow-up round 2 (2026-09-23, PR #552):

- CodeRabbit's second pass found two more real closure gaps in the round-1
  fix: a directory `require("./rules")` whose target resolves through
  `rules/package.json`'s `"main"` field rather than an index file left that
  manifest and its resolved entry unbound, and a comma-separated Python
  `import verifier, bypass` bound only the first name, leaving `bypass.py`
  free for a candidate to rewrite. Both closed: `visitDirectoryImport` now
  binds the directory's `package.json` and, when present, one level of its
  resolved `"main"` entry (a manifest chaining to another manifest is not
  followed further — documented as a boundary, not silently assumed away);
  the Python import walk now binds every entry in a comma-separated `import`
  list, each stripped of an `as` alias and dotted-package suffix.
  `tests/preservation-check-binding.test.ts` gained two more cases proving
  both the new binding and the refusal on a rewrite of the newly bound file.
- Fixing round 1's `env` launcher example inside a header comment
  (`` `import "./rules"` ``) tripped Arcadia's own declared preservation
  check, `scripts/preservation-self-check.mjs`: its relative-import scanner
  is comment-blind, so prose that reads like an import statement is
  indistinguishable from a real one. Reworded the comment to state the
  example without that literal shape; `node scripts/preservation-self-check.mjs`
  now passes (1152 files inspected) and `tests/preservation-self-check.test.ts`
  passes. This is itself a small, live instance of the exact class of problem
  this Action closes: a check that judges source by pattern-matching text, not
  by parsing it, and a good reason declaring-check authors should keep
  examples of import-like syntax out of scanned comments.
- Re-validation: focused suite (7 files, including the two new cases) with
  `ARCADIA_PRESERVATION_HOST_TEST=1`: 71 passed. Full `pnpm test`: 2052
  passed, 13 skipped, 0 failures. `pnpm build` and
  `pnpm --filter arcadia-dashboard build`: exit 0.

Review follow-up round 3 (2026-09-23, PR #552, the CodeRabbit loop's final
fix round before its cap):

- CodeRabbit's third pass found round 2's own regex-based comma-list capture
  silently stopped at an `as` alias inside a Python `import` list
  (`import verifier as v, bypass` bound only `verifier.py`), that a
  same-directory Python import resolving to a *package* (`helper/__init__.py`)
  rather than a same-named module was never bound, and that `REQUIRE_PROBES`
  omitted a native `.node` addon resolution. All three closed, the first two
  with a deliberately narrower approach than another incremental regex patch:
  rather than keep widening one fragile pattern, a bare Python `import` line
  is now matched in full against a strict single-line grammar (a
  comma-separated, alias-tolerant, dotted-name list with nothing else on the
  line); a line that does not match that grammar exactly — a trailing
  backslash continuation, any other construct — is **refused outright**
  (`Cannot establish the Python import closure for ...`) rather than silently
  partially bound. This is the fail-closed alternative CodeRabbit itself
  offered ("reject any import statement the scanner cannot fully bind") and
  it closes the whole class of comma/alias/continuation gaps at once instead
  of chasing the next one a fourth time. Same-directory Python resolution now
  always binds both `module.py` and `module/__init__.py` unconditionally, and
  `REQUIRE_PROBES` gained `.node`/`/index.node`.
  `tests/preservation-check-binding.test.ts` gained four more cases: an
  aliased entry before a later comma now binds correctly, a backslash
  continuation is refused rather than silently under-bound, a package
  `__init__.py` binds and its rewrite is refused, and a native addon binds
  and its rewrite is refused.
- A transient failure in `tests/preservation-validation.test.ts`'s "refuses
  worktree mutation during validation" during one `ARCADIA_PRESERVATION_HOST_TEST=1`
  run was investigated rather than dismissed on sight, since it followed a
  code change: it passed in isolation and in three repeated full-file runs
  both before and after this round's diff, at the same duration either way
  (~17-21s), and does not exercise any code path this round touched (the
  fixture's declared check is JS, not Python, and its script content is
  unchanged between base and candidate). Concluded host contention — this
  environment runs several concurrent background `arcadia` worker processes
  outside this session's control — not a regression, and not reproducible on
  retry.
- Re-validation: focused suite (7 files, including the four new cases) with
  `ARCADIA_PRESERVATION_HOST_TEST=1`: 78 passed (three repeated full-file runs
  of `preservation-validation.test.ts` alone, 12/12 each). Full `pnpm test`:
  2056 passed, 13 skipped, 0 failures. `pnpm build` and
  `pnpm --filter arcadia-dashboard build`: exit 0.
