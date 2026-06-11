# Discord-To-Codex Readiness Audit

## Binary Readiness Answer

YES, for Discord request intake, deterministic safe progression, Codex packet preparation, and status/result readout. Discord remains intentionally outside approval, credential, publishing, social-posting, and Codex-execution authority.

## Audit Control Fields

- Current milestone: Discord-to-Codex request/readout readiness
- Next action: Use Discord to submit and inspect requests; keep approvals in Arcadia/local review unless an explicit approval design is created later
- Work classification: Codex
- Required artifact: `artifacts/audits/discord-to-codex-readiness.md`

## Executive Summary

Arcadia is ready for the requested Discord-to-Codex request/readout scenario with explicit approval boundaries. Discord is no longer read-only: it can submit natural-language requests through `arcadia ask`, optionally run deterministic safe steps with `--run-safe`, list recent runs, and inspect a single run with mission log, artifacts, Requires Review items, and blocking reasons. Arcadia can resolve the exact Rebuster/Pinterest request in the real workspace, produce a project-scoped Codex build packet, attach the active milestone, include validation context, and preserve approval gates for credentials, publication, and social posting/messaging.

Discord intentionally cannot approve gates, run Codex, publish, post to social platforms, or use credentials. That boundary is part of the readiness answer, not a blocker for request intake and remote understanding.

## Progress Update - 2026-06-11

- Phase 1 request intake is implemented: `/arcadia request text:<request>` calls `arcadia ask --workspace <workspace> "<request>" --json`.
- Phase 2 packet generation is implemented for metadata-backed project work: the exact request `Build Pinterest posting support for Rebuster.` resolves to `build_social_posting_support`, links Rebuster metadata, attaches the active milestone, writes a Codex build packet scoped to the target repository, and records credential/publication/social messaging approval gates.
- Phase 3 result lookup is implemented: `/arcadia run id:<run-id>` calls `arcadia run show <run-id> --workspace <workspace> --json` and returns status, mission log, artifacts, Requires Review count, blocking step, and reason.
- Safe remote progression is implemented: `/arcadia request text:<request> run-safe:true` calls `arcadia ask ... --run-safe --json`, which can run deterministic safe steps while Codex, credentialed, publishing, and messaging work still pauses behind existing approvals.
- Discord-origin correlation is implemented: successful completed runs notify only when the ask/work/run id was recorded from a Discord-submitted request.
- The combined local fixture is implemented: it initializes a real workspace, seeds Rebuster metadata, submits the exact Discord request through the real CLI adapter, verifies packet/gate context, runs safe work, and evaluates notifications.
- Project metadata seeding is deterministic: `arcadia project metadata` can upsert aliases, repo path, status summary, and validation commands in a real workspace.
- Real workspace verification is complete: `/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover` now contains Rebuster project metadata, active milestone `Pinterest publishing support`, and a real ask result for `Build Pinterest posting support for Rebuster.` with Codex packet `prompts/codex/codex_ff5ebeab3bd549ab8e/prompt.md`.
- Current validation: `pnpm exec vitest run tests/discord-bot.test.ts` passes `18` tests; `pnpm exec vitest run tests/cli-response.test.ts` passes `44` tests; `pnpm test` passes `6` files / `98` tests.

## Capability Matrix

| Capability | Status | Evidence | Gap | Required next step |
|---|---|---|---|---|
| Discord bot package exists | Ready | `apps/discord-bot/package.json`; `apps/discord-bot/src/main.ts` creates a Discord client and starts a poller. | None for awareness use. | Keep as thin adapter. |
| Discord receives Arcadia slash commands | Ready | `apps/discord-bot/src/commands/register.ts` registers `/arcadia status`, `/arcadia request`, `/arcadia requires-review`, `/arcadia runs`, and `/arcadia run`; `apps/discord-bot/src/events/interactionCreate.ts` dispatches those subcommands. | None for request/readout. | Keep approvals out of Discord unless a clear explicit approval model exists later. |
| Discord invokes existing Arcadia CLI | Ready | `apps/discord-bot/src/arcadia/cli.ts` shells out to `status`, `queue`, `ask`, `run list`, `run show`, and `milestone list` with JSON. | No Discord command currently invokes `work run` with Codex allow flags, intentionally. | Preserve thin adapter behavior; add only explicit, audited CLI calls. |
| Discord reports status/results | Ready | `apps/discord-bot/src/formatters/requestFormatter.ts` returns ask/work/plan/run/packet/repo scope; `apps/discord-bot/src/formatters/runFormatter.ts` returns run detail; notifications cover failed runs, Requires Review runs, Discord-origin completed runs, Requires Review count transition, and completed milestones; `tests/discord-bot.test.ts` includes a combined fixture. | None for readout. | Keep approval workflows separate. |
| Discord shows Requires Review items | Ready | `apps/discord-bot/src/commands/requiresReview.ts:4-6` reads `queue().queues.needs_mark`; formatter tests assert "Requires Review" and no legacy label leakage. | Internal queue key remains `needs_mark`, which is acceptable compatibility if hidden. | Keep external wording as Requires Review. |
| Natural-language request processing via CLI | Ready | `src/cli.ts:95-110` exposes `ask`; `src/commands/ask.ts:53-184` creates ask request, work item, plan, gates, Codex invocation, packet artifacts, and optional safe run. | None for request creation. | Continue using CLI as the authority. |
| Intent resolution for exact request | Ready | `config/defaults/intent-registry.json` includes `build_social_posting_support`; `tests/phase3.test.ts` proves the exact request resolves when Rebuster metadata exists; the real workspace ask resolved `build_social_posting_support`. | None for the target request. | Use generated packet after review. |
| Project lookup | Ready | `project_metadata` stores aliases, repo path, status summary, and validation commands; `resolveProjectContextFromRequest` resolves project name/alias; `arcadia project metadata` upserts the metadata through the CLI; the real workspace has Rebuster metadata. | None for Rebuster. | Keep metadata current as projects move. |
| Milestone association | Ready | `resolveAskContext` attaches the active milestone when a project is resolved and no milestone is supplied. | Depends on an active milestone existing. | Ensure Rebuster has one active milestone in the real workspace. |
| Work item persistence | Ready | `database/schema.sql:22-37`; `src/db/repositories.ts:314-340` creates work items and optional expected artifact records. | None for generic work items. | Use existing persistence. |
| Execution plan persistence | Ready | `database/schema.sql:80-105`; `src/db/repositories.ts:804-860` creates execution plans and steps. | None for generic plans. | Use existing persistence. |
| Approval gates | Ready for social posting | `config/defaults/intent-registry.json` maps `build_social_posting_support` to `credentials_required`, `publication`, and `send_email_or_messages`; tests assert those gate types. | Approval resolution itself remains outside Discord. | Design explicit approval workflows separately. |
| Failure and blocked states | Ready | `src/execution/runner.ts:149-188` records run status and moves failed work to blocked; Discord notifications report failed/Requires Review runs; `/arcadia run id:<run-id>` shows blocking step and reason; `discord-submissions.json` records Discord-origin ids for completed-run notifications. | None for readout. | Keep approval and remediation workflows separate. |
| Codex packet generation | Ready with metadata | `src/codex/packets.ts` writes target repo, project status summary, validation commands, approval boundaries, and final reporting requirements; `tests/phase3.test.ts` proves the Rebuster/Pinterest prompt context. | Depends on project metadata being present. | Seed/import real Rebuster metadata. |
| Codex invocation | Partial | `src/execution/runner.ts:196-258` can run Codex when `work run` is called with explicit allow flags and a profile; `docs/COMMANDS.md:141-152` documents the allow flags. | Scenario asks Arcadia to "runs or prepares Codex"; today it prepares by default, but cannot run against the correct Rebuster repo because no repo path is known. | Keep explicit allow flags, but set `--cd` to the target repo/workspace scope when project metadata allows it. |
| Artifact recording | Partial | Ask creates Codex packet artifact records; run creates mission log artifacts. Local validation produced prompt/final/output/metadata files and a mission log after `work run`. | No implementation summary, changed files, test result, or review notes artifact for a real implementation; Codex output is not linked as a run artifact when the run pauses before execution. | Add implementation-result artifact conventions for Codex runs. |
| Mission logs | Ready | `src/execution/runner.ts:170-193` creates run mission logs; `/arcadia run id:<run-id>` surfaces the mission log path. | None for readout. | Use run detail for mobile follow-up. |
| Requires Review terminology | Partial | Dashboard and Discord formatters translate `needs_mark` to Requires Review; tests cover this. | Legacy user-facing strings remain in CLI/status Markdown: `src/domain/constants.ts:38-50`, `src/commands/status.ts:84`, `src/markdown/statusReport.ts:47`, `src/commands/run.ts:78`, and docs. | Migrate user-facing CLI/report labels while keeping internal `needs_mark` for compatibility. |
| Rebuster project readiness | Ready | Real workspace project `proj_bfe29e0038994a36ae` has aliases, repo path `/Users/pmark/Dev/MR/Rebuster/rebuster`, active milestone `Pinterest publishing support`, status summary, validation commands, and a generated ask/Codex packet for the target request. | None for request/readout readiness. | Review the generated packet before any Codex build execution. |
| Pinterest feature readiness | Ready for packet/gates | `build_social_posting_support` exists and creates credential/publication/social messaging gates. | It does not implement Pinterest posting itself. | Use the generated Codex packet after approvals. |
| Smallest reproducible end-to-end proof | Ready | `tests/discord-bot.test.ts` includes a combined fixture with initialized workspace, seeded Rebuster metadata, Discord request intake through the real CLI adapter, packet verification, safe-run behavior, and notification evaluation; real workspace verification also passed. | None for request/readout readiness. | Keep approvals local/explicit. |

## Current End-To-End Flow

What works today is a Discord-originated request and readout path backed by the existing local CLI:

1. Initialize an Arcadia workspace:

   ```sh
   pnpm arcadia init /tmp/arcadia-readiness-audit.ND1OGj --json
   ```

2. Submit the exact request through CLI or Discord:

   ```sh
   pnpm arcadia ask --workspace /tmp/arcadia-readiness-audit.ND1OGj "Build Pinterest posting support for Rebuster." --json
   ```

   ```text
   /arcadia request text:"Build Pinterest posting support for Rebuster."
   ```

   Observed expected result when Rebuster metadata exists: Arcadia creates one `ask_request`, one Rebuster-linked work item, one active-milestone-linked execution plan, credential/publication/social messaging approval gates, one Codex build invocation, and prompt packet artifacts. Discord returns ask id, work item id, plan id, packet path, repo scope, and run status.

3. Inspect the generated Codex packet:

   ```text
   /tmp/arcadia-readiness-audit.ND1OGj/prompts/codex/codex_620b3c331374458b95/
     prompt.md
     output.jsonl
     final.md
     metadata.json
   ```

   The packet contains request, resolved intent, work item id, plan id, target repository, project status summary, active milestone, validation commands, approval boundaries, and final reporting requirements.

4. Run deterministic safe steps from CLI or Discord:

   ```sh
   pnpm arcadia work run work_468f64b3fe07495583 --workspace /tmp/arcadia-readiness-audit.ND1OGj --plan plan_1820f5df885c491c80 --json
   ```

   ```text
   /arcadia request text:"Prepare a weekly Martian Rover Labs update from recent mission logs." run-safe:true
   ```

   Observed expected result: deterministic safe steps can run immediately. Codex, credentialed, publishing, posting, messaging, and other approval-gated steps still pause as Requires Review.

5. Review the run from CLI or Discord:

   ```sh
   pnpm arcadia run show run_a068898bfea14d9ea9 --workspace /tmp/arcadia-readiness-audit.ND1OGj --json
   pnpm arcadia queue --workspace /tmp/arcadia-readiness-audit.ND1OGj --json
   pnpm arcadia status --workspace /tmp/arcadia-readiness-audit.ND1OGj --json
   ```

   ```text
   /arcadia run id:run_a068898bfea14d9ea9
   /arcadia requires-review
   /arcadia status
   ```

   Observed expected result: Discord can show run status, mission log path, artifact paths, Requires Review count, blocking step, and reason.

Discord currently supports request intake, safe progression, and status/result readout:

```sh
pnpm --filter arcadia-discord-bot register
pnpm --filter arcadia-discord-bot dev
```

Available Discord commands are `/arcadia status`, `/arcadia request`, `/arcadia requires-review`, `/arcadia runs`, and `/arcadia run`. The bot polls CLI state and posts notifications for failed runs, Requires Review runs, Discord-origin completed runs, Requires Review count transitions, and completed milestones.

Validation run during this audit:

```sh
pnpm exec vitest run tests/discord-bot.test.ts tests/phase3.test.ts tests/ingress.test.ts
pnpm test
```

Latest targeted Discord validation passed `1` file / `18` tests; CLI project import/metadata validation passed `1` file / `44` tests; full suite passed `6` files / `98` tests.

## Remaining Boundaries And Follow-Ups

1. Discord cannot approve gates, run Codex, publish, post to social platforms, or use credentials. This is intentional unless an explicit approval model is designed later.
2. User-facing CLI and Markdown output still contain legacy Mark-specific wording in some places, even though Discord and dashboard translate it to Requires Review.

## Recommended Implementation Plan

### Phase 1: Prove The Request Path

Status: Implemented. Discord can submit `/arcadia request text:<request>` through `arcadia ask`, and tests prove the CLI invocation and response summary.

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

Status: Implemented for metadata-backed project requests. Tests prove the exact Rebuster/Pinterest request resolves project metadata, active milestone, repo scope, validation context, and approval gates.

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

Status: Implemented for request/run lifecycle reporting. `/arcadia run id:<run-id>`, optional `/arcadia request ... run-safe:true`, and Discord-origin completed-run notifications are covered by focused tests.

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

Status: Implemented as a disposable local fixture and verified against the real Arcadia workspace.

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

Today this test passes as a local fixture in `tests/discord-bot.test.ts` for steps 1-6 and notification evaluation, and the real workspace has a Rebuster-linked ask/Codex packet for the exact request. Step 7 remains intentionally limited because approved Codex execution and validation artifact conventions require a separate explicit approval model.

## First Next Action

Review the generated Rebuster Codex packet and approve any Codex build, credential, publication, or social-posting work through Arcadia/local review, not Discord.
