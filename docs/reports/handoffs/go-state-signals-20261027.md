# Go compact state signals — source hand-back

2026-10-27. LOCAL ONLY. Production stays Off. This is implementation evidence for
Rowan's independent verification/review and governed settlement; no Action is settled here.

- Project: Arcadia. Milestone: Make Arcadia Go orient one caller truthfully before authorized work.
- Plan/Action: `make-arcadia-go-orient-one-caller-truthfully-before-authorized-work#project-go-context-as-compact-state-signals`.
- Responsibility: agent. Sole source writer: implementer `/root/implement_state_signals`, depth 1; no further delegation.
- Coordinator: Rowan `/root`, chat `01a17f6d-6910-7420-bfb4-212dcdc316cb`; parent paused source edits through hand-back.
- Candidate: `/Users/pmark/.codex/worktrees/go-state-signals/arcadia`, branch `codex/go-state-signals-20261027`.
- Base: `d1b8e6d2bd70f6b79fdf0e7e9ee197d44b3b9770`. Source commit: `fa66c541a0a9668d7741b46ad66006f720f36cfa`.
- Identity: freshly resolved `Cody Mason <cody.mason@agents.arcadia.local>`, codex/standard/builder, applied on commit.
  Actual native model/effort unavailable. Standard is the assigned identity tier; the brief recommendation `gpt-5.6-terra/e2_standard` is not launch proof.
- Intake: https://github.com/pmark/arcadia/issues/1833 (parent-created).

## Per-criterion source evidence

1. **REQ-006:** existing `sessionTitlesByState` remains the title store/composer.
   Broker scope comes from the existing caller-resolved `next.context`; selected A does not replace assigned B.
   A readiness gate preserves assigned implementation kind. Without assignment, title detail says `selected; unassigned`.
   Nine checked-in broker fixtures (three cases for each provider) contain all seven state titles:
   working, PR/review, checks, needs-input, external-blocked, completed and deliberate hold.
   Existing title tests cover verified-by-caller relationship inputs and helper arrow retention;
   shared instructions require a named verified parent before applying the arrow.
   A native chat supplies no parent verification or governed Session admission.
   Observed transitions and successful host title-tool results are required; idle/end-of-turn supplies no completion, hold or custody-release evidence.
2. **REQ-007:** broker opens with a compact acknowledgment of observed assignment, selected work,
   stored canonical Session evidence, ownership count and next permitted step. It explicitly verifies no active workers,
   so no-worker examples claim no active team. One shared `renderStateSignalInstructions` is consumed by Go and managed
   Action briefs for Codex, Claude Code and OpenCode. `tests/fixtures/go-state-signals.json` freezes rendered openings,
   including exact missing-tool disclosure and source-only runtime limits. `tests/go-state-signals.test.ts` exercises the
   real broker renderer; the Action-brief tests verify shared delivery. Detailed evidence remains in the existing brief.
3. **Shared delivery/QA:** indexed shared continuation, chat-title and native-app instructions updated;
   fingerprints regenerated using existing `guidanceFingerprint`. Existing `updateAgentsMarkdown` regenerated AGENTS with no diff:
   bootstrap 8,162 bytes; root 12,236 bytes, preserving the existing limits. Canonical guidance checks and 112 focused tests pass;
   final fixture-only validation passes 10/10. TypeScript, lint and build pass. `pnpm build` is exactly
   `pnpm lint && pnpm build:artifacts`; its duplicate lint process was intentionally cancelled (143), then the single lint
   passed and `build:artifacts` passed. Offline fast rehearsal exit 0: 26 files, 102 passed, 1 expected failure.
   START_HERE includes executable QA and separates local fixtures from separately authorized installation/live proof.

## Raw commands and receipts

Commands ran from the candidate. Required passing commands:

```sh
node_modules/.bin/vitest run tests/session-title.test.ts tests/action-brief.test.ts tests/go-broker.test.ts tests/go-state-signals.test.ts tests/agent-guidance.test.ts
node_modules/.bin/vitest run tests/go-state-signals.test.ts
node --import tsx scripts/check-agent-guidance.ts
node_modules/.bin/tsc --noEmit -p tsconfig.json
mise exec -- pnpm lint
mise exec -- pnpm build:artifacts
mise exec -- pnpm fast-rehearsal
git diff --check
```

`node scripts/bridge-worktree-deps.mjs` succeeded under ordinary host approval after the sandbox's EPERM creating
`apps/dashboard/node_modules`. It linked four existing dependency trees; nothing was copied or deleted.
Identity command: `node --import tsx src/cli.ts identity resolve --agent codex --tier standard --role builder --json`.
The source commit used the returned author/committer environment. No Git config or operator identity was used.

| Receipt | Exit | Raw path | SHA-256 |
| --- | --- | --- | --- |
| initial focused (failed fixture contract) | 1 | `/tmp/go-signals-focused.log` | `9e73b437c5cc889cf8128fe2c527b324a8031c2d5116a39fd4c01ee4057e4adc` |
| focused repaired | 0 | `/tmp/go-signals-focused-r2.log` | `15869f28f7d8b39dbb4f05a58652a94c188e3e2dce91949e7c47aa515f297ea0` |
| focused final (5 files,112 tests) | 0 | `/tmp/go-signals-focused-final.log` | `95a4552ee6ba64116f3b08153e5f3b084cdedcc825f2778221fa9de7eb80a8f3` |
| final fixture-only (10 tests) | 0 | `/tmp/go-signals-fixture-final.log` | `d77aa799aa36c5eaf56d3fba47ec013f4e75424af5802f4d82a9349acc72808a` |
| canonical guidance final | 0 | `/tmp/go-signals-guidance-final.log` | `a8fd24e5bfdd01fcb3a40cb5d5d612b50aa9392fa951f61bf52f71c9d1a52ef4` |
| TypeScript final | 0 | `/tmp/go-signals-tsc-final.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| lint | 0 | `/tmp/go-signals-lint.log` | `9432bc11c2a9783c7837761ca96fb6440cb89b22c99b978d6cf809fa8e804ae4` |
| duplicate canonical build intentionally cancelled | 143 | `/tmp/go-signals-build.log` | `54d19b955ca312457fc8385056d421d01d8abf684d0c5842bb1d58ae25d4292c` |
| build artifacts | 0 | `/tmp/go-signals-build-artifacts.log` | `8b4025be8b7f493c260b47b8200c1d01d8e4c3e5d5fd57d19c0dc779b49effed` |
| fast rehearsal | 0 | `/tmp/go-signals-fast-rehearsal.log` | `e3c376ad9c9aad84a20751a6b484ac1cc8ce74111b955431db7e4e38a8fe895b` |
| source commit | 0 | `/tmp/go-signals-source-commit.log` | `82b5fd595f4c5e209441d227decc343bf6191eae704f972181e036d10ef181ad` |

Fast-rehearsal report:
`/var/folders/cm/0dn1wl093f52lr7h5d7xpdn40000gn/T/arcadia-fast-rehearsal-report-9kotuP/report.json`.

## Failed receipts and limitations

- Initial focused command (the same four source files without guidance) exited 1: six new rendered fixtures had incomplete
  synthetic DispatchContext values, so the actual detailed renderer threw at render. Three existing files passed 81 tests.
  One bounded repair completed the fixture contract and corrected the assigned-plan acronym to AP. The same four files then
  passed 87/87; later planned fixtures/guidance passed 112/112. Raw failed receipt is retained above.
- First dependency bridge was denied EPERM outside sandbox writable roots. Ordinary host approval allowed the named candidate bridge.
  A read-only `ps` was likewise sandbox-denied; approved targeted inspection confirmed only owned validation processes.
  Two early discovery commands hit zsh unmatched-glob/missing-path errors; bounded explicit-path searches replaced them with no source effects.
- Duplicate `pnpm build` wrapper was deliberately stopped at exit143 per Rowan's resource correction; no required check was omitted.
- Rehearsal took 409,114 ms (6m49s), over its five-minute target. It recorded 69 errors, including two labelled UNEXPECTED
  in `session-probe-wall`. That existing fixture explicitly injects EROFS and asserts one environment_wall/no relaunch
  (`tests/fast-rehearsal/session-probe-wall.test.ts:28`, `:55`). Its report classification is not a new source failure;
  no harness changes or rerun were made. Revival trigger for classification cleanup: a task changes that fixture/reporting
  or requires a zero-unexpected-errors report. Parent owns any further intake.
- No installed adoption, real provider execution, successful native title update, capacity reservation, governed Session
  admission or live performance guarantee is proved. Runtime title-tool support remains unverified for all three providers.
  Rehearsal providers/GitHub are simulated; its reported validator modes remain as emitted.
- No installation, activation, restart, credentials, provider probe, spend, production, merge, governed state edits,
  settlement, push, PR or external messages were performed by this implementer.

## Retrieval and hand-back

Loaded instruction paths/byte sizes/fingerprints are in the adjacent `go-state-signals-20261027-instructions.json`;
these are final source-byte measurements, not a claim of provider effective-load telemetry. Targeted Notes sections:
“Protected brief fails at next”, “Brief launcher returned BRIEF_DEADLINE_EXCEEDED”, “Reproduce a rehearsal defect offline”.
Scoped retained-lesson searches for title/brief/native acknowledgment, fixture contract, and probe-wall report each returned 0 matches.
The read-only work monitor ran successfully under parent custody before assignment; candidate started clean at the declared base.
Native assignment proves no governed Session admission/capacity reservation.

Changed source paths:

```text
START_HERE.md
docs/agent-guidance/chat-titles.md
docs/agent-guidance/continuation.md
docs/agent-guidance/index.json
docs/agent-guidance/native-app-sessions.md
src/goBroker.ts
src/sessions/actionBrief.ts
src/sessions/sessionTitle.ts
tests/action-brief.test.ts
tests/fixtures/go-state-signals.json
tests/go-broker.test.ts
tests/go-state-signals.test.ts
```

Next safe move: Rowan verifies the committed source and raw receipts, obtains independent review of the current head,
handles any findings, then performs canonical settlement and routine push/PR within existing authority. Stop before
installation/activation/merge or any other separate gate. Parent retains coordination; source writing is handed back.
