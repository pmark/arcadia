# Discord-To-Codex Readiness Audit

## Binary Readiness Answer

NO

## Audit Control Fields

- Current milestone: Discord-to-Codex readiness audit
- Next action: Add a minimal Discord request command that calls existing `arcadia ask`
- Work classification: Codex
- Required artifact: `artifacts/audits/discord-to-codex-readiness.md`

## Executive Summary

Arcadia is not ready for the requested Discord-to-Codex scenario today. The repository has a strong local-first core for `arcadia ask`, work item persistence, execution plans, Codex packet records, paused Requires Review runs, mission logs, and Discord status/notification readouts. The blocking gap is that Discord is intentionally implemented as read-only awareness plus notifications, with no freeform request intake and no adapter that invokes `arcadia ask` from Discord. Arcadia also cannot currently resolve `Rebuster` to a real project or target repository, and the generated Codex packet for the exact Pinterest request is a generic planning packet without repo path, project state, validation commands, credential/API gates, or implementation reporting requirements.

## Capability Matrix

| Capability | Status | Evidence | Gap | Required next step |
|---|---|---|---|---|
| Discord bot package exists | Ready | `apps/discord-bot/package.json`; `apps/discord-bot/src/main.ts` creates a Discord client and starts a poller. | None for awareness use. | Keep as thin adapter. |
| Discord receives Arcadia slash commands | Partial | `apps/discord-bot/src/commands/register.ts:4-23` registers only `/arcadia status`, `/arcadia requires-review`, and `/arcadia runs`; `apps/discord-bot/src/events/interactionCreate.ts:8-54` dispatches only those subcommands. | No command or message handler accepts "Build Pinterest posting support for Rebuster." | Add one request-intake slash command with a string option, or explicitly keep Discord read-only and reject this scenario. |
| Discord invokes existing Arcadia CLI | Ready | `apps/discord-bot/src/arcadia/cli.ts:29-61` shells out to `status`, `queue`, `run list`, and `milestone list` with JSON. | CLI adapter lacks an `ask()` method. | Add `ArcadiaCli.ask(request, options)` that calls `arcadia ask --workspace ... --json`. |
| Discord reports status/results | Partial | `apps/discord-bot/src/commands/status.ts`, `requiresReview.ts`, and `runs.ts` format current state; `notifications/poller.ts:47-110` emits failed run, Requires Review run, Requires Review count transition, and completed milestone notifications. | Successful runs with no human action are intentionally suppressed in `apps/discord-bot/README.md:63-72`; there is no direct response for a submitted request because request submission does not exist. | Return immediate ask/work item/packet summary from the new request command, and poll or query run status by ID. |
| Discord shows Requires Review items | Ready | `apps/discord-bot/src/commands/requiresReview.ts:4-6` reads `queue().queues.needs_mark`; formatter tests assert "Requires Review" and no legacy label leakage. | Internal queue key remains `needs_mark`, which is acceptable compatibility if hidden. | Keep external wording as Requires Review. |
| Natural-language request processing via CLI | Ready | `src/cli.ts:95-110` exposes `ask`; `src/commands/ask.ts:53-184` creates ask request, work item, plan, gates, Codex invocation, and packet artifacts. | Not exposed through Discord. | Reuse `runAskCommand` via the Discord CLI adapter. |
| Intent resolution for exact request | Partial | Local validation: `pnpm arcadia ask --workspace /tmp/arcadia-readiness-audit.ND1OGj "Build Pinterest posting support for Rebuster." --json` succeeded but returned `resolvedIntent.matched=false`, `intentId=codex_plan`, `work_classification=codex`, `project_id=null`, and `approvalGates=[]`. | No Pinterest/Rebuster intent, project extraction, credential gate, publication gate, or API decision gate. | Add deterministic project-name resolution and registry coverage for publishing/social posting work. |
| Project lookup | Partial | `src/commands/ask.ts:201-215` validates explicit `--project` and `--milestone`; project rows store only `id`, `name`, `mission`, and `status` in `database/schema.sql:3-10`. | No automatic lookup by project name, no repo path field, and no current Rebuster project in the repository data. | Add project alias/name lookup and a project repo metadata source. |
| Milestone association | Partial | Explicit `--milestone` is supported and validated in `src/commands/ask.ts:206-215`; projects summarize current milestone through SQLite in `src/db/repositories.ts:468-511`. | Exact Discord text cannot associate Rebuster's current milestone without project resolution. | Resolve project first, then attach active milestone by default when present. |
| Work item persistence | Ready | `database/schema.sql:22-37`; `src/db/repositories.ts:314-340` creates work items and optional expected artifact records. | None for generic work items. | Use existing persistence. |
| Execution plan persistence | Ready | `database/schema.sql:80-105`; `src/db/repositories.ts:804-860` creates execution plans and steps. | None for generic plans. | Use existing persistence. |
| Approval gates | Partial | `database/schema.sql:161-185`; `src/intent/resolver.ts:142-167` maps gate types to reasons. | Exact request created zero gates, although Pinterest posting likely needs credentials/API/product decisions and publication boundaries. | Add rules that mark social posting credentials/API/publishing choices as Requires Review. |
| Failure and blocked states | Ready | `src/execution/runner.ts:149-188` records run status and moves failed work to blocked; `apps/discord-bot/src/notifications/poller.ts:78-82` reports failed and Requires Review runs. | Discord cannot tie a failure back to a request it never accepted. | Include submitted request/work item/run identifiers in Discord responses. |
| Codex packet generation | Partial | `src/codex/packets.ts:25-82` writes `prompt.md`, `output.jsonl`, `final.md`, `metadata.json`; `src/commands/ask.ts:99-132` records the invocation and artifact. | Packet is too thin for safe feature implementation: no target repo path, current project status, relevant file discovery instructions, validation commands, non-goals beyond generic boundaries, or final reporting format. | Extend packet rendering after project repo metadata exists. |
| Codex invocation | Partial | `src/execution/runner.ts:196-258` can run Codex when `work run` is called with explicit allow flags and a profile; `docs/COMMANDS.md:141-152` documents the allow flags. | Scenario asks Arcadia to "runs or prepares Codex"; today it prepares by default, but cannot run against the correct Rebuster repo because no repo path is known. | Keep explicit allow flags, but set `--cd` to the target repo/workspace scope when project metadata allows it. |
| Artifact recording | Partial | Ask creates Codex packet artifact records; run creates mission log artifacts. Local validation produced prompt/final/output/metadata files and a mission log after `work run`. | No implementation summary, changed files, test result, or review notes artifact for a real implementation; Codex output is not linked as a run artifact when the run pauses before execution. | Add implementation-result artifact conventions for Codex runs. |
| Mission logs | Ready | `src/execution/runner.ts:170-193` creates run mission logs; local validation produced `/tmp/arcadia-readiness-audit.ND1OGj/mission_logs/2026/06/2026-06-11-execution.md`. | Mission log used "Unassigned" because project routing failed. | Fix project routing. |
| Requires Review terminology | Partial | Dashboard and Discord formatters translate `needs_mark` to Requires Review; tests cover this. | Legacy user-facing strings remain in CLI/status Markdown: `src/domain/constants.ts:38-50`, `src/commands/status.ts:84`, `src/markdown/statusReport.ts:47`, `src/commands/run.ts:78`, and docs. | Migrate user-facing CLI/report labels while keeping internal `needs_mark` for compatibility. |
| Rebuster project readiness | Missing | `rg "Rebuster|Pinterest"` found only tests/docs examples, and temp SQLite workspaces contained no Rebuster project. `database/schema.sql` has no repo path column. | No Rebuster project record, repo path, status, active milestone, or current project state in Arcadia. | Add or import Rebuster project metadata, including repo path and active milestone. |
| Pinterest feature readiness | Missing | No registry entry, work item, scenario, or artifact represents Pinterest posting support outside test fixture text. | Required credentials/API decisions are not marked Requires Review for this request. | Add an intent/template or policy rule for social posting features. |
| Smallest reproducible end-to-end proof | Missing | CLI-only validation works; Discord-only status/readout tests pass. | No test issues a Discord request and later verifies result/artifact trail without opening the repo. | Add a Discord adapter test that submits a request through a mocked interaction and verifies `arcadia ask` invocation plus response content. |

## Current End-To-End Flow

What works today is a local CLI path, not a Discord-originated implementation path:

1. Initialize an Arcadia workspace:

   ```sh
   pnpm arcadia init /tmp/arcadia-readiness-audit.ND1OGj --json
   ```

2. Submit the exact request through CLI:

   ```sh
   pnpm arcadia ask --workspace /tmp/arcadia-readiness-audit.ND1OGj "Build Pinterest posting support for Rebuster." --json
   ```

   Observed result: Arcadia created one `ask_request`, one work item, one execution plan, one Codex planning invocation, and prompt packet artifacts. It did not resolve a project or milestone, and it did not create approval gates.

3. Inspect the generated Codex packet:

   ```text
   /tmp/arcadia-readiness-audit.ND1OGj/prompts/codex/codex_620b3c331374458b95/
     prompt.md
     output.jsonl
     final.md
     metadata.json
   ```

   The packet contains request, resolved intent, work item id, plan id, generic boundaries, and no target repo or project context.

4. Run the generated plan without Codex approval:

   ```sh
   pnpm arcadia work run work_468f64b3fe07495583 --workspace /tmp/arcadia-readiness-audit.ND1OGj --plan plan_1820f5df885c491c80 --json
   ```

   Observed result: run `run_a068898bfea14d9ea9` paused as Requires Review, the work item moved to the Requires Review queue, and a mission log was written.

5. Review the run:

   ```sh
   pnpm arcadia run show run_a068898bfea14d9ea9 --workspace /tmp/arcadia-readiness-audit.ND1OGj --json
   pnpm arcadia queue --workspace /tmp/arcadia-readiness-audit.ND1OGj --json
   pnpm arcadia status --workspace /tmp/arcadia-readiness-audit.ND1OGj --json
   ```

   Observed result: the run audit trail includes the paused Codex planning step, `queue` shows one Requires Review item, and `status` reports `requiresReviewCount: 1`.

Discord currently supports only awareness:

```sh
pnpm --filter arcadia-discord-bot register
pnpm --filter arcadia-discord-bot dev
```

Available Discord commands are `/arcadia status`, `/arcadia requires-review`, and `/arcadia runs`. The bot polls CLI state and posts notifications for failed runs, Requires Review runs, Requires Review count transitions, and completed milestones.

Validation run during this audit:

```sh
pnpm exec vitest run tests/discord-bot.test.ts tests/phase3.test.ts tests/ingress.test.ts
pnpm test
```

Results: targeted tests passed `3` files / `22` tests; full suite passed `6` files / `85` tests.

## Missing Pieces

1. Discord cannot accept or submit the work request. The current bot is intentionally read-only plus notifications and has no request command or message handler.
2. Arcadia cannot resolve `Rebuster` from the request to a known project, active milestone, or repository path.
3. The exact request falls back to a generic Codex planning packet and does not identify Pinterest posting as a build request with credential/API/publication decisions requiring review.
4. Codex packets do not yet include enough implementation context for this scenario: target repo, project state, relevant discovery instructions, validation commands, non-goals, expected artifacts, or final reporting format.
5. Discord does not report successful implementation completion for a submitted request, because submitted Discord requests and run correlation are not implemented.
6. User-facing CLI and Markdown output still contain legacy Mark-specific wording in some places, even though Discord and dashboard translate it to Requires Review.

## Recommended Implementation Plan

### Phase 1: Prove The Request Path

Objective: From Discord, accept one explicit Arcadia request and create the same ask/work item/plan/packet that the CLI creates.

Concrete implementation tasks:

- Add `ArcadiaCli.ask(request)` in `apps/discord-bot/src/arcadia/cli.ts`.
- Add `/arcadia request text:<string>` or `/arcadia ask request:<string>` in `apps/discord-bot/src/commands/register.ts`.
- Dispatch the new subcommand in `apps/discord-bot/src/events/interactionCreate.ts`.
- Return a concise Discord response containing ask id, work item id, plan id, classification, Requires Review/gate count, and packet path.
- Add a mocked interaction/CLI adapter test proving the request text becomes an `arcadia ask` invocation.

Acceptance criteria:

- A Discord command can submit `Build Pinterest posting support for Rebuster.`.
- The bot invokes `arcadia ask --workspace <workspace> "<request>" --json`.
- Discord returns a trustworthy created-work summary or exact failure reason.
- Discord owns no state beyond notification dedupe.

Likely files/packages affected:

- `apps/discord-bot/src/arcadia/cli.ts`
- `apps/discord-bot/src/commands/register.ts`
- `apps/discord-bot/src/events/interactionCreate.ts`
- `apps/discord-bot/src/formatters/*`
- `tests/discord-bot.test.ts`

Classification: Codex.

### Phase 2: Prove Codex Packet Generation

Objective: Generate a useful implementation packet for project-scoped code work while preserving explicit approval gates.

Concrete implementation tasks:

- Add project repo metadata to Arcadia without changing the whole architecture. Prefer a minimal SQLite migration or a project metadata artifact that can be read deterministically.
- Add name/alias lookup so request text can resolve `Rebuster` to a project id.
- Attach the active milestone when a project is resolved and no milestone is supplied.
- Extend `renderPrompt` in `src/codex/packets.ts` to include target repo, objective, current project state, discovery instructions, validation commands, expected artifacts, approval boundaries, non-goals, and final reporting format.
- Add a test for exact request text proving the packet includes Rebuster repo context when metadata exists.

Acceptance criteria:

- The exact request creates a work item linked to Rebuster.
- The Codex packet identifies the target repository and validation commands.
- Credential/API/publication uncertainty is represented as Requires Review.
- Packet generation still avoids running Codex by default.

Likely files/packages affected:

- `database/schema.sql`
- `src/db/repositories.ts`
- `src/domain/types.ts`
- `src/commands/ask.ts`
- `src/intent/resolver.ts`
- `src/codex/packets.ts`
- `tests/phase3.test.ts`

Classification: Codex, with Requires Review for the exact Rebuster repo path and Pinterest API/credential policy if not already known.

### Phase 3: Prove Discord Result Reporting

Objective: Let Discord show the lifecycle of a submitted request through completion, failure, or Requires Review.

Concrete implementation tasks:

- Include work item id and run id correlation in Discord response text.
- Add a `/arcadia run <id>` or reuse `/arcadia runs` formatting to show mission log path, artifacts, failure reason, and Requires Review reason.
- Decide whether successful run notifications should be enabled only for Discord-submitted work, because the README currently suppresses routine successful runs.
- Add tests for failed run and Requires Review messages tied to a submitted request.

Acceptance criteria:

- Discord can report "implemented and validated" only when a run is completed and validation artifacts exist.
- Discord can report "blocked" with the exact failed step/error or Requires Review reason.
- The report includes links/paths to mission log and artifacts.

Likely files/packages affected:

- `apps/discord-bot/src/notifications/poller.ts`
- `apps/discord-bot/src/formatters/runFormatter.ts`
- `apps/discord-bot/src/events/interactionCreate.ts`
- `tests/discord-bot.test.ts`

Classification: Codex.

### Phase 4: Prove Full Rebuster Pinterest Scenario

Objective: Demonstrate the full target request without implementing Pinterest posting as part of this audit.

Concrete implementation tasks:

- Add Rebuster as a project with active milestone, status, and repo path.
- Add or import a Rebuster project state artifact if needed.
- Add a Pinterest/social posting intent or policy rule that classifies implementation as Codex build or Codex planning plus Requires Review gates for credentials/API/publication.
- Run the Discord request path against a local fake or test workspace.
- Verify `ask_request`, work item, execution plan, approval gates, Codex packet, run record, mission log, artifacts, and Discord response.

Acceptance criteria:

- From Discord, submit `Build Pinterest posting support for Rebuster.`.
- Arcadia resolves Rebuster to the correct project and repo.
- Arcadia produces a useful Codex packet and does not use credentials or publish without review.
- Discord returns either implemented/validated with artifact trail, or blocked/Requires Review with exact reason.
- The proof is executable with local commands and tests.

Likely files/packages affected:

- Project metadata storage
- `config/intent-registry.json`
- `src/intent/resolver.ts`
- `src/codex/packets.ts`
- Discord bot adapter/formatters/tests
- A local test fixture workspace

Classification: Codex plus Requires Review for credentials, Pinterest API decisions, and any publication boundary.

## End-To-End Binary Test

Smallest reproducible test that would prove readiness:

1. Create a disposable workspace with a Rebuster project record, active milestone, and repo path.
2. Start the Discord bot with a mocked Discord interaction or local integration harness.
3. Submit `/arcadia request text:"Build Pinterest posting support for Rebuster."`.
4. Assert the bot calls `arcadia ask --workspace <workspace> "Build Pinterest posting support for Rebuster." --json`.
5. Assert SQLite contains one ask request, one Rebuster-linked work item, one execution plan, required approval gates, one Codex invocation, and a Codex packet whose prompt includes the Rebuster repo path and validation commands.
6. Run the plan in safe/default mode and assert it pauses as Requires Review, writes a mission log, updates the queue, and emits a Discord Requires Review message.
7. For a fake approved Codex agent, run the plan with explicit allow flags and assert the final Discord report includes run status, mission log path, Codex output artifact, and validation artifact.

Today this test cannot pass because steps 3, 4, and 5 lack Discord request intake and Rebuster repo metadata.

## First Next Action

Implement `ArcadiaCli.ask(request)` and a mocked `/arcadia request` Discord test that proves the bot invokes `arcadia ask --workspace <workspace> "<request>" --json` and returns ask/work item/plan ids.
