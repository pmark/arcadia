# Direction receipts — bounded source recovery

Native implementer Ellis (`/root/direction_receipts_recovery`, depth 1), supervised
by Rowan in chat `01a1805b-684e-7e13-adb4-304cb6f41af2`. This identifies native
evidence, not canonical Session admission. Actual inherited model, effort and
usage are unavailable. Parent remained read-only while Ellis held sole source
writer custody.

Project Arcadia; Milestone **Make Arcadia Go orient one caller truthfully before
authorized work**; Action `show-receipts-for-operator-directions`. PR
[#1838](https://github.com/pmark/arcadia/pull/1838), Issue #1837. The operator
explicitly authorized a replacement managed checkout from `0742d314`, preserving
history and this PR. The replacement is
`/Users/pmark/.codex/worktrees/direction-receipts-recovery/arcadia`, existing branch
`codex/go-direction-receipts-20261027`; starting revision
`0742d314dfbc6a44c4be245c20d1ea403f4b0e57`. Parent verified current main cursor
`3eeb90d7c4a4163a2ef3119f3e98381861158157` adds documentation only and changes no
governing record for this Action. The primary checkout remains `7b9434bb`.

Final checkpoint: fetched main advanced to
`62b2b5c0b4008c98075d61c83eef58499387ba4f` (PR #1840). Both canonical history
listings were inspected from `3eeb90d7`; no Project/Plan/Decision changed.
The cursor is one main first-parent step forward, with verified ancestry.
The merge changes identity display loading, including the QA producer's
reviewer identity rendering, plus Go/advance display paths and tidy evidence.
Relevant identity/QA diffs were read. Parent must integrate the base and obtain
current-head evidence; this source pass did not merge it into the candidate.

This is source/test evidence and an implementer hand-back. It neither completes
the Action nor grants merge, installed adoption, live proof or Production
authority. No candidate CLI was run against the live workspace. Fixture
activation below applies only to the existing hermetic automated-test harness;
no operational experiment workspace was created or used.

## Recovery changes

1. Removed only the unused local `AskTrailCapture` import; its public type export
   remains. This repairs R1-01 / required lint.
2. The existing workspace recovery scenario asserts focus on the explicit
   direction checkbox after its first Tab, then Tabs to Send. It keeps its
   navigation, recovery, storage, viewport and accessibility assertions.
3. Split the composite 60-second CLI/HTTP test into three independently bounded
   scenarios: actual CLI lifecycle; read-only CLI success/missing snapshots;
   actual HTTP-to-source-CLI capture/read. Each retains the 60-second limit.
   The snapshot retains populated native receipt history and the original
   held-after-acknowledgment state through actual producer setup. No adapter is
   mocked and no original assertion is removed. Old timeout contention remains
   a hypothesis, not a proved cause.
4. The migration fixture preserves all six old kinds (`offer`, `exposure`,
   `acknowledgment`, `self_report`, `effect_receipt`, `disposal`) and explicitly
   initializes twice successfully. It checks exact receipt/message values,
   transactional rollback, message index, unique request IDs, foreign keys,
   cascade deletion and replay. Historical unsupported effect JSON stays
   unsupported; it is a migration fixture, never acceptance proof. A separate
   genuine complete-writer fixture omits `direction`, archives exact original
   bytes and commits only its candidate, proving actual absent-direction legacy
   archive compatibility.
5. Added `tests/direction-managed.test.ts`, reusing the existing Rehearsal
   harness. Actual canonical register/approval/fixture activation/tick APIs
   produce admission, packet and Session; capture/offer/recipient producers
   establish the correlation; actual complete settlement writes/commits it;
   the exit tick executes a named test and produces canonical completion
   evidence; actual QA command produces a terminal exact-head QA attempt; a
   separate `observeDirectionQa` reader checks it and projects `verified`.
   Assertions bind completion to the Session, packet hash and Action, require
   successful terminal executions and named reports, bind the resulting commit
   to its writer receipt, and require the exact-head QA attempt to be passed.
   Only harness tmux/provider/external-model dependencies are simulated. No
   Session, identity or positive acceptance receipt is inserted by this test.

## Acceptance evidence map

| Current criterion | Source evidence supplied | Limits |
| --- | --- | --- |
| Stable explicit target/request; exact replay; changed input refuses | Existing capture/replay/refused-target receipt tests, actual CLI capture/routing conflict | Final exact-head review/CI belongs to Rowan |
| Evidence-specific submitted/delivered/acknowledged/continued states | Actual native checkpoint/compact ack and complete-writer producer chain; CLI lifecycle | Recipient consumption is attestation, never host cognition |
| Stopped/paused held; unknown submission; never automatic resend | Existing held/unknown transition fixtures and seven-state browser scenario | No new live recipient or transport attempt |
| Accepted durable submitted receipt, refusals, artifact/source/time per state | Existing transition provenance assertions plus expanded native migration and legacy archives | Persistence alone does not imply acknowledgment |
| Separately observed positive acceptance tied to result; stale/mismatch refusal | Genuine unmanaged producer fixture plus new genuine managed Session/packet/tree/QA producer-reader test; existing wrong managed Action/packet and altered/negative QA refusals | Canonical test proof, not live registered QA admission or installed acceptance |

## Validation receipts

Commands ran from the replacement candidate unless a stable absolute entry is
explicitly named. Raw receipts remain at the exact host-local paths below.

- Solo split CLI suite: `pnpm exec vitest run tests/direction-cli.test.ts`,
  exit 0, 3/3, 24.73 s (test bodies 22.42 s),
  `/private/tmp/direction-recovery-cli-host.log`.
- Expanded legacy receipt suite initially passed 9/9; the parallel first
  managed fixture failed on the incorrect `launch.kind` assertion. Preserved
  together at `/private/tmp/direction-recovery-receipts-host.log`.
- Managed fixture after named-test strengthening: `pnpm exec vitest run
  tests/direction-managed.test.ts`, exit 0, 1/1, 12.70 s (body 9.68 s),
  `/private/tmp/direction-recovery-managed-batch2.log`.
- Final focused set: `pnpm exec vitest run tests/direction-cli.test.ts
  tests/direction-receipts.test.ts tests/direction-managed.test.ts`, exit 0,
  13/13, 32.57 s, `/private/tmp/direction-recovery-final-focused-strengthened.log`.
- Touched-file ESLint exit 0,
  `/private/tmp/direction-recovery-final-lint.log`.
- Core `pnpm exec tsc --noEmit` exit 0,
  `/private/tmp/direction-recovery-final-tsc.log`.
- `pnpm build:artifacts` exit 0,
  `/private/tmp/direction-recovery-build-artifacts.log`.
- `pnpm dashboard:build` exit 0,
  `/private/tmp/direction-recovery-dashboard-build.log`; existing import.meta
  and Next ESLint plugin warnings remain disclosed.
- Initial `pnpm exec playwright test tests/e2e/workspace-shell.spec.ts`: one
  seven-state/held/unknown scenario passed; recovery got past keyboard focus
  and failed its later stale wording expectation at line 264. Receipt
  `/private/tmp/direction-recovery-e2e.log`; see batch 3 below for final replay.
- Batch 3 `pnpm exec playwright test tests/e2e/workspace-shell.spec.ts -g
  'workspace navigation preserves its sky, scope, and Ask receipt recovery'`,
  exit 0, 1/1, 7.0 s, `/private/tmp/direction-recovery-e2e-batch3.log`.
  Together with the preceding seven-state scenario pass, both workspace
  scenarios have passed; they were not both rerun in a single green invocation.
  Raw replay log SHA-256:
  `9e3541e292680914e7049a761bf309a9684eb6067072b5032d760cd6a5bbd22f`.
- `pnpm check:session-ledger` exit 0 and `git diff --check` exit 0.

The historical broader 287 shared regressions and 102-pass/1-expected-fail
rehearsal are not relabelled as current-head reruns. No broad rehearsal was
repeated solely for freshness. Rowan owns final independent R2 review and CI;
R1 remains historical NO-GO and has consumed one review round.

## Stable-primary completion mechanics rehearsal

Host-only scratch script `/private/tmp/direction-stable-route-proof.ts` invokes
the stable primary absolute `src/cli.ts` entry with its absolute tsx loader
from a disposable fixture candidate cwd. It supplies only legacy complete
fields, explicitly names its fixture workspace/config, and exercises actual
draft, preview and apply. It does not import the candidate schema into live
management.

Receipt `/private/tmp/direction-stable-route-proof.json` (SHA-256
`22d6bcdc1496652d0b865cd371d019ad358d39cb093753de0a94c555dcdd23c1`)
records exit 0 for all three CLI calls (1,151 / 1,817 / 4,099 ms), stable
revision `7b9434bb6b94db2bc942235a4533ce42f7a081de`, fixture base
`527dc1b16cb260f475f84982987d4545ef417ce0`, candidate documents commit
`e7fcb7e2a3a15a66589fd3ede12610602d82b5ab`, absent direction field, exact archive
bytes and clean unchanged fixture primary. This validates a supported route;
it is not the Action's live complete Ask or permission to submit one early.

## Failures, allowance and prevention

Named source pass `direction-receipts-source-qa-recovery-20261028` was assigned
45 minutes and two repair batches. The prior session's two local repairs plus
one harness recovery remain historical; no managed counter was reset.

- Dependency bridge and Vite cache creation initially hit sandbox EPERM.
  Ordinary host permission for the same documented bridge/test commands
  succeeded. CLI startup refusal is preserved in
  `/private/tmp/direction-recovery-cli.log`; it was not a test pass.
- Batch 1 fixed the fixture assertion from nonexistent `launch.kind` to the
  existing `launch.outcome`. Its ensuing genuine managed reader correctly
  refused because default marker-only criteria produced no named-test
  completion evidence; `/private/tmp/direction-recovery-managed-batch1.log`.
- Batch 2 strengthened the fixture's genesis acceptance criteria and actual
  named marker test. It preserved `completionExecutionPassed` and every
  Session/packet/tree guard; the canonical producer/reader then passed.
- New browser failure after those batches: the old test still expected
  “Submission acknowledged via receipt.” while the source deliberately
  renders “Submission recorded via receipt.” Rowan independently verified
  that exact mismatch and explicitly extended the internal allowance for one
  named mechanical batch, `e2e-recorded-receipt-copy`, without counter reset.
  Batch 3 changes only that expected copy and replays the affected scenario
  once. It keeps every surrounding recovery/storage/viewport assertion and
  changes no UI/product wording. The replay passed 1/1 in 7.0 s. No further
  source repair allowance remains.

Prevention ships in the split real-adapter coverage, populated read-only
snapshot, every-old-kind/second-migration and actual legacy archive tests,
named-test genuine managed producer fixture and exact keyboard/copy assertions.
Learned observation returned to Rowan: accepted completion without a named
test can lack retained execution evidence and must not become verified.
Rowan retained it through the stable CLI as `lesson_26a511d9f4fef99a9de4`;
the later recorded-versus-acknowledged copy mismatch is retained as
`lesson_f08ac6aeee85a7dc1161`. Both are evidence, never execution authority.

## Retrieval evidence

Fully read: role brief `/private/tmp/direction-receipts-recovery-role-brief.json`,
`AGENTS.md` (12,236 bytes), `CONSTITUTION.md` (3,320), context policy files
(539 / 703 / 870), guidance index (12,038), role skill (11,841), learning
procedure (2,458). Targeted retrieval: PROJECT pointer/Mission opening, exact
Action/all five criteria, repository Experiment section (lines 204–331),
Notes lint/focused-test entries (217–247) and symptom search; working-copy
safety/preservation sections (1–170); orientation (1–100); semantic contract
opening (1–140); native-mail checkpoints (1–105); continuation (1–65);
roles/briefs/ledger protocol (214–272), principle scope/economy sections and
ledger source schema. File sizes for targeted references were observed
separately; these section reads are not claims of whole-file retrieval.
Stable-primary `learn search 'direction receipts migration keyboard timeout'
--scope project:arcadia` returned zero matches. Parent performed work-monitor,
freeze and fetched-main checkpoint before assignment. Denied secrets/env paths
were not read. No external messaging, commits, pushes or governance mutation
was performed by this implementer.

## Rowan integration checkpoint

Ellis released writer custody with all owned check handles terminal. Rowan
preserved the seven-file recovery in `0015a437e`, then merged pinned main
`62b2b5c0b4008c98075d61c83eef58499387ba4f` automatically without conflicts.
Integrated source head: `0375ce3f56af68256a4cbb1531c812feeb04b2c9`.
The primary checkout and stable management CLI remain at `7b9434bb`; no
installation, restart or live schema adoption occurred.

The integrated focused suite passed 13/13 in 22.50 seconds, exit 0
(`/private/tmp/direction-recovery-integrated-focused.log`, SHA-256
`e46063c208d06a88217ef25675de90e0e6ecfa0866a906a829abe2c5f3ee462b`).
Integrated TypeScript `--noEmit` and full repository `pnpm lint` passed,
both exit 0; full lint receipt is
`/private/tmp/direction-recovery-integrated-lint.log`. Ledger validation and
`git diff --check` passed. Independent generic R2 is
assigned to a fresh read-only native context, scoped to the recovery delta
since `0742d314` and the QA identity-loader integration. It has no source
custody or registered reviewer/QA admission. The final signed review, required
remote checks and any canonical completion receipt belong on PR #1838; this
checkpoint does not predict their outcomes.

The replacement was created by the supported app tool only after the operator
explicitly amended the earlier no-duplication constraint. Existing local and
remote history and PR lineage were retained. The verified route is retained
as `lesson_9ee2b106486dbc0ed2fa`; it grants no future takeover authority.
The earlier ownership-blocker Discord ping `ping_f9572a73dc054418a5` was last
observed pending; queued does not mean delivered.
