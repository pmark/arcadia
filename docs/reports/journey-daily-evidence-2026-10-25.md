# Journey daily evidence — Ellis handback

Direct operator request, 2026-10-25 PDT; no governed Action. Intake: https://github.com/pmark/arcadia/issues/1776.
Profile Ellis; role implementer; native depth 1; supervisor Rowan. Sole writer of isolated candidate
`/Users/pmark/.codex/worktrees/journey-daily-progress/arcadia`, branch `codex/journey-daily-progress`.
Inherited runtime model/effort and token budget unmeasured; no model calls used for metrics.
Production remains Off; no shared services, Plan, pointer, queue or governance changed.

Status: [Plan Journey](http://arcadia-1.alpine-rattlesnake.ts.net:3020/journey/arcadia/plan/current).
This candidate is not installed in that shared service.

## Product and proof

Shared read-only derivation feeds Plan Journey JSON, CLI and dashboard. Select 1/7/30 rolling UTC
elapsed-day windows and compare equal prior windows. Half-open timestamp bounds and denominator
are explicit. Unique Action/head worker merges are delivered work; preserved candidates and review
passes are not. Explicit cleared_at alert IDs are dated obstacle evidence. Unique unaccepted Session
exits count interruptions/repeats separately. Closed Session spans sum elapsed time and union overlaps;
active effort stays unknown. Evidence lists source tables/IDs, Action links and PR references.

Existing agent_sessions provider/model/effort give configured service/model/effort groups, per-window
Session and closed-span denominators, time, delivery and exit outcomes. These are launch configuration;
runtime model/effort and token usage stay null/unknown. Work type is managed development Session;
independent reviewer effort and finer task taxonomy are unavailable here. No effectiveness ranking.

Focused command: `mise exec -- pnpm exec vitest run tests/journey-progress.test.ts tests/journey.test.ts apps/dashboard/components/journey-progress.test.tsx apps/dashboard/components/journey-plan.test.tsx`
Exit 0: 4 files, 43 tests. Covers duplicate delivery/exit records, exclusion of simulation/wrong Plan,
wrong Action, unbound alerts, accepted exits, exact period boundaries, overlap clipping, unknown spans,
previous window, absent optional stores, configured/runtime distinction, labels and provenance links.
`mise exec -- pnpm exec tsc --noEmit`: exit 0.
`mise exec -- pnpm build:artifacts`: exit 0.
`mise exec -- pnpm lint`: exit 0. Touched-file ESLint: exit 0. Session ledger check: exit 0.
`mise exec -- node scripts/fast-rehearsal.mjs`: exit 0; 26 files, 102 passing and one expected fail.
Combined report: `/var/folders/cm/0dn1wl093f52lr7h5d7xpdn40000gn/T/arcadia-fast-rehearsal-report-sSE5fT/report.json`.
The report labels two fixture session-probe-wall lifecycle messages unexpected despite passing assertions;
these are retained as a reporting limitation, not silently reported as zero errors.
`mise exec -- pnpm dashboard:build`: exit 0 on clean candidate output.
Standalone dashboard tsc retains eight unrelated test typing diagnostics after exports are built;
the production build's type validation passes, with no Journey diagnostics.

PR: https://github.com/pmark/arcadia/pull/1777. Independent read-only exact-head review was requested
from Rowan at creation; the PR remains draft until that review and current-head CI are complete.
No review verdict is claimed here.

Built local preview browser QA: 1-day and 30-day picker changes updated denominators successfully.
At 390px viewport, document width was 390px; at 1280px, document width was 1280px. Screenshots:
[mobile](journey-daily-evidence-2026-10-25/mobile.png), [desktop](journey-daily-evidence-2026-10-25/desktop.png).
Mobile screenshot visually inspected. These are local candidate QA, not shared service installation.

PR-open FYI delivered: `ping_10c484358221462da1`, Discord message `1564124249130541117`,
`2026-10-26T03:51:21.788Z`, verified through configured workspace read-only database APIs.

## Honest limits and revival triggers

This is recorded managed work, not all work. Manual merges, native app work and missing historical
records are absent. Reopened alert episodes overwrite prior clear times; counts of reopenings remain
unknown. Existing Journey retrospective `cleared` events retain obstacle start time, so they cannot
safely date daily clears. Launch refusals and other obstacles without explicit clear timestamps are
excluded. Rework effort cannot be separated. Counts measure records, not importance or distance.

Revive broader obstacle metrics when source writers preserve dated clear/reopen episodes. Revive
observed model/effort effectiveness when provider runtime attestations bind actual model, effort,
work type and per-invocation usage to the same Session/outcome. These are source capture capabilities,
not something a read-only report can reconstruct. No new ledger or capture system added.

## Friction and retained evidence

- Dependency bridge normal sandbox refused EPERM in this newly managed candidate. Ordinary host
  permission retry succeeded; no primary worktree changed.
- Learn normal sandbox write returned SQLITE_WORKSPACE_WRITE_DENIED. One host retry succeeded:
  `lesson_0a029be5378bc92924a6` retains the verified clearance-time/configuration limitation.
- Initial dashboard standalone tsc had missing built package imports before build:artifacts and existing
  test typing errors outside Journey. No Journey diagnostic; build/runtime verification is in PR.
- First local preview curl timed out at 55s during cold compilation; server eventually returned 200.
  Do not call shared service updated or claim a verified screenshot from that request.
- Running my candidate Next dev and build against the same generated .next directory caused a
  PageNotFound collection failure and invalid browser QA. Stopped only my port-3049 preview,
  moved its generated output to `/tmp/journey-next-mixed-dev-build`, rebuilt successfully,
  then reran picker/viewport checks against the built local candidate. No shared service changed.

## Loaded guidance

Paths/UTF-8 bytes below record loaded sources. Target sections included working-copy start/stop,
operator-directed trace/overlap, repository orientation/semantics/QA/safety, role naming/ledger,
exact current Action isolate-launch-preview-tmux-name (no overlap), identity and PR review/CI.

- `AGENTS.md`: 12236 bytes
- `CONSTITUTION.md`: 3320 bytes
- `PROJECT.md`: 31682 bytes
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539 bytes
- `.arcadia/repo-context.md`: 703 bytes
- `.arcadia/context-policy.json`: 870 bytes
- `docs/agent-guidance/index.json`: 11757 bytes
- `docs/agent-guidance/operator-directed-work.md`: 4494 bytes
- `docs/working-copy-safety.md`: 16202 bytes
- `docs/agent-guidance/learning.md`: 2458 bytes
- `docs/agent-guidance/continuation.md`: 7462 bytes
- `docs/agent-guidance/arcadia-repository.md`: 30312 bytes
- `docs/agent-guidance/session-roles-and-briefs.md`: 15378 bytes
- `docs/agent-guidance/pull-requests.md`: 21758 bytes
- `docs/agent-guidance/git-identity.md`: 5248 bytes
- `docs/arcadia-semantics.md`: 22613 bytes
- `docs/AGENT_ORIENTATION.md`: 13594 bytes
- `.agents/skills/arcadia-role/SKILL.md`: 11841 bytes
- `.agents/skills/arcadia-guardrail/SKILL.md`: 5565 bytes
- `.agents/skills/arcadia-rover-journey/SKILL.md`: 2915 bytes

## Post-R1 advisory repair

CodeRabbit inline 4373908111 identified a stale-schema availability regression at the optional
progress call site. A disposable test drops `agent_sessions.is_simulated` and verifies the Plan
still returns its Action list/current pointer, progress is unavailable, the error remains a warning,
and the projection does not migrate the stale schema. Before the guard, the test failed with
`SqliteError: no such column: is_simulated` from the new progress call; raw receipt retained at
`/tmp/journey-stale-schema-before.txt`. The repair guards only optional progress and preserves the
existing per-Action error handling. Existing passed checks are not reused as proof for this delta;
focused validation, current-head CI and independent R2 delta review are required.
After repair: the four-file focused Journey suite passes 44 tests; touched-file ESLint,
root TypeScript, Session-ledger validation and git diff --check pass (all exit 0).

R1's only P3 scaling concern is deferred to https://github.com/pmark/arcadia/issues/1778 with a
large-history/measured-latency revival trigger. R1 summary:
https://github.com/pmark/arcadia/pull/1777#issuecomment-6408010332.
Production evidence remains in its own authority/evidence store; this repair neither reads nor
modifies live first-job evidence and does not reinterpret the metric's runtime-unknown fields.

## R3 visibility and bound-attribution repair

After R2 GO on b2597240b, the pre-merge checkpoint found three new CodeRabbit outside-diff
comments (review 5648347159). R3-F1/R3-F2: CLI and dashboard omitted the warning retained in
JSON when optional progress failed. Verified against renderPlanJourneySuccess, writeSuccess and
PlanJourneyList; fixed by rendering the stored warnings in both human surfaces while preserving
Action navigation. R3-F3: service groups omitted dated alert-clear counts already bound to a real
Session; fixed by aggregating only the existing filtered evidence and showing that count in both
surfaces. No missing binding is inferred from provider/configuration. Clears without a matching real
Session remain excluded; unattributed coverage is explicitly unknown in the shared limitations and
visible dashboard copy.

Before this batch, four focused expectations failed across producer, CLI and dashboard tests
(`/tmp/journey-r3-before.txt`, exit 1). After repair the four-file suite passes 45 tests, including
visible unavailable warnings without a progress object, retained Action links, rendered group clears,
and existing unbound-alert exclusion. An initial lint failure on two literal regex spaces was corrected
to the equivalent `{2}` quantifier; the stale-schema test and touched-file lint were rechecked.
Current-head CI and independent R3 delta review remain required; no merge or live operation is
claimed. R2 was published with attribution at
https://github.com/pmark/arcadia/pull/1777#issuecomment-6410302362 and is prior-delta proof only.
