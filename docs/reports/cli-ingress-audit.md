# Arcadia CLI Ingress Audit

Date: 2026-06-12

## Executive Summary

Arcadia CLI is the stable common interface for workspace ingress paths. This report is historical, and the status below has been updated after the single-workspace alignment work.

What works today:

- `pnpm arcadia ask "<request>" --workspace <path>` is the primary natural-language entry point.
- `pnpm arcadia init <workspace> --profile arcadia` seeds Arcadia as a normal project in any workspace.
- `pnpm arcadia dogfood ask "<request>"` is a compatibility shortcut for `ask --workspace .arcadia-workspace`.
- Low-confidence or unsafe natural-language requests create persisted Requires Review items instead of invoking Codex directly.
- Review commands exist for listing, showing, approving, rejecting, and deferring Requires Review items.
- Approval of a persisted `review_items` record resumes the intended ask workflow by calling `runAskCommand` with the original source input and records the resulting ask id.
- Discord, dashboard, and local file ingress already invoke the CLI or the same command implementation.

Current compatibility notes:

- Review approval resumes ask workflow for `review_items`, but legacy `needs_mark` work items shown by `review` cannot be approved by `review approve`.
- `ask` supports deterministic Intake patterns, but it is not yet a broad arbitrary natural-language planner. Unsupported vague input is preserved as Requires Review, which is safe but limited.
- Ingress adapters can use JSON responses through the adapter contract in `docs/ADAPTER_CONTRACT.md`.

Conclusion: use normal workspace commands as the canonical interface. The `dogfood` commands remain compatibility shortcuts for `.arcadia-workspace/`.

## Current CLI Architecture

Current milestone: Unify Arcadia onto the single workspace model.

Next action: keep the `dogfood` aliases compatibility-only while continuing to use normal workspace commands for Arcadia itself.

Work classification: codex for implementation fixes; audit/report only for this document.

Required artifacts: this report, plus future CLI contract docs/tests if changes are made.

Actual entry point:

- Package name: `arcadia-core` in `package.json`.
- Binary name: `arcadia`.
- Published executable path: `dist/src/cli.js` via `"bin": { "arcadia": "dist/src/cli.js" }`.
- Repo-local pnpm wiring: `pnpm arcadia` runs `tsx src/cli.ts`.
- Parser: Commander, imported as `Command` from `commander`.
- Command registration: centralized in `src/cli.ts` inside `buildProgram()`.
- Runtime handler: `buildProgram().parseAsync(process.argv)` with normalized JSON/human success and failure output through `src/cli/response.ts` and `src/cli/errors.ts`.

Machine-readable behavior:

- Most non-interactive commands support `--json`.
- JSON success shape is `{ ok: true, command, workspace, data, artifacts, warnings }`.
- JSON failure shape is `{ ok: false, command, workspace, error: { code, message, details } }`.
- Known normalized exit codes are `1` unexpected/SQLite, `2` usage or validation, and `3` missing workspace/database/entity.

## Command Inventory

Top-level commands:

| Command | Purpose | Workspace | Other inputs | External services |
| --- | --- | --- | --- | --- |
| `init <workspace>` | Initialize workspace | positional path | `--profile arcadia`, `--json` | none |
| `dogfood init` | Compatibility shortcut for repo-local Arcadia workspace initialization | fixed `.arcadia-workspace/` | `--json` | none |
| `dogfood ask <request>` | Compatibility shortcut for natural-language ask | fixed `.arcadia-workspace/` | `--run-safe`, `--json` | creates Codex packets but does not invoke Codex directly |
| `status` | Workspace status and status report | `--workspace` | `--json` | none |
| `ask <request>` | Natural-language Intake | `--workspace` | `--project`, `--milestone`, `--run-safe`, `--json` | creates Codex prompt packets for Codex-classified work; does not directly run Codex |
| `capture` | Structured capture | `--workspace` | `--text`, `--project`, `--milestone`, `--expected-artifact`, `--json` | none |
| `queue` | Queue summary | `--workspace` | `--json` | none |
| `dashboard snapshot` | Read-only dashboard snapshot | `--workspace` | `--json` | none |
| `ingress process` | Process local file ingress | `--workspace` | `--source`, `--run-safe`, `--dry-run`, `--json` | reads files under `~/ArcadiaIngress/<source>/` |

Project commands:

| Command | Required inputs |
| --- | --- |
| `project create` | `--workspace`; interactive prompts |
| `project list` | `--workspace`, optional `--json` |
| `project show <project-id>` | project id, `--workspace`, optional `--json` |
| `project import` | `--workspace`, `--name`, `--mission`, `--milestone`, `--next-action`, `--classification`; optional `--goal`, `--status`, `--expected-artifact`, `--json` |
| `project update <project-id>` | project id, `--workspace`; optional `--status`, `--mission`, `--goal`, `--json` |
| `project metadata <project-id>` | project id, `--workspace`; optional repeated `--alias`, `--repo-path`, `--status-summary`, repeated `--validation-command`, `--json` |

Work, run, and lifecycle commands:

| Command | Required inputs |
| --- | --- |
| `inbox add` | `--workspace`; interactive prompts |
| `inbox import` | `--workspace`, `--title`, `--input`, `--queue`, `--classification`, `--next-action`; optional `--project`, `--milestone`, `--expected-artifact`, `--json` |
| `work list` | `--workspace`, optional `--json` |
| `work update <work-id>` | work id, `--workspace`; optional `--queue`, `--classification`, `--next-action`, `--status`, `--json` |
| `work done <work-id>` | work id, `--workspace`, optional `--json` |
| `work plan <work-id>` | work id, `--workspace`, optional `--json` |
| `work run <work-id>` | work id, `--workspace`; optional `--plan`, `--allow-codex-planning`, `--allow-codex-build`, `--agent-profile`, `--json` |
| `run list` | `--workspace`; optional `--limit`, `--json` |
| `run show <run-id>` | run id, `--workspace`, optional `--json` |
| `log create` | `--workspace`; interactive prompts |
| `milestone list` | `--workspace`; optional `--status`, `--limit`, `--json` |
| `milestone create <project-id>` | project id, `--workspace`, `--title`, optional `--json` |
| `milestone complete <milestone-id>` | milestone id, `--workspace`, optional `--json` |
| `artifact list` | `--workspace`, optional `--json` |
| `artifact update <artifact-id>` | artifact id, `--workspace`; optional `--status`, `--path`, `--json` |
| `report status` | `--workspace`, optional `--json` |

Review commands:

| Command | Required inputs | Result |
| --- | --- | --- |
| `review` | `--workspace`; `--json` works but is not shown in help | lists open/deferred `review_items` plus legacy `needs_mark` work items |
| `review show <id>` | review item id, `--workspace`, optional `--json` | shows a persisted `review_items` item |
| `review approve <id>` | review item id, `--workspace`, optional `--json` | reruns ask from the original source input and stores `resulting_ask_request_id` |
| `review reject <id>` | review item id, `--workspace`, optional `--json` | marks item rejected |
| `review defer <id>` | review item id, `--workspace`, optional `--json` | marks item deferred |
| `review weekly` | `--workspace`; optional `--since`, `--until`, `--json` | writes deterministic weekly review |

Codex observation commands:

| Command | Required inputs | External services/env |
| --- | --- | --- |
| `codex list` | `--workspace`; optional `--source`, `--active-only`, `--no-sync`, `--json` | may observe local Codex state and cloud task fixture/CLI depending observer configuration |
| `codex sync` | `--workspace`; optional `--source`, `--active-only`, `--json` | same observer caveat |
| `codex associate <task-id>` | task id, `--workspace`, `--project`; optional `--milestone`, `--json` | none beyond existing observed task state |

## Ingress Compatibility Assessment

CLI:

- Suitable for direct human use today.
- Natural-language entry is `pnpm arcadia ask --workspace <path> "<request>"`.
- Review workflow exists, but help/docs need tightening.

Compatibility shortcuts:

- Suitable for repo-local compatibility with older commands.
- `pnpm arcadia dogfood ask "<request>"` uses `.arcadia-workspace/` and delegates to `runAskCommand`.
- Works from repo root.
- JSON command identity reports the invoked `dogfood.*` command while preserving delegated data shapes.

Discord:

- Discord uses `apps/discord-bot/src/arcadia/cli.ts` to invoke the CLI with `--json`.
- `/arcadia request` calls `ask --workspace <workspace> <request> --json`.
- `/arcadia requires-review` calls `review --workspace <workspace> --json`.
- Discord can submit requests and show Requires Review, but it intentionally does not approve/reject/defer.

iCloud Shortcut/local file ingress:

- `ingress process` reads text files from `~/ArcadiaIngress/<source>/In`.
- Non-empty files are passed to `runAskCommand`.
- Successful files move to `Done`; failed files move to `Failed`; sidecar JSON and mission logs are written.
- This is a viable adapter path, but the file contract should be documented before relying on it broadly.

Dashboard:

- Dashboard is read-only.
- It calls `dashboard snapshot --workspace <path> --json` via `apps/dashboard/lib/arcadia-cli.ts`.
- It is suitable for status/review visibility, not for approval or request submission.

Codex-issued requests:

- Codex can invoke the same CLI commands locally.
- For code-changing work, `ask` creates Codex packet artifacts rather than directly launching Codex for vague input.
- There is not yet a special Codex-issued request adapter command; Codex should use `ask`, `review`, and `work` commands directly.

## Intake Routing Assessment

`pnpm arcadia ask "<request>" --workspace <path>` routes through Arcadia Intake.

Confirmed behavior:

- `runAskCommand` calls `resolveIntake(options.request, buildIntakeContext(db))`.
- It supports deterministic intents including `ShowStatus`, `ReviewRequired`, `UpdateGoal`, `PauseProject`, `ResumeProject`, `InstantiateProject`, `CreateWork`, and fallback `CaptureThought`.
- High-confidence status and review requests act immediately by calling existing status/review paths.
- Project goal/status updates can update project records when Intake confidently resolves a project.
- Unsafe or review-required actions create persisted `review_items`.
- Low-confidence input is preserved as Requires Review.
- Creation/build paths create work items, execution plans, approval gates, Codex invocation records, and prompt packet artifacts. They do not directly invoke Codex.

Limits:

- Natural language support is deterministic and pattern-based, not broad semantic planning.
- Unsupported arbitrary input safely becomes Requires Review rather than work.
- `run-safe` only runs deterministic safe plan steps; Codex build/planning steps remain gated.

## Review Workflow Assessment

The requested commands exist:

- `pnpm arcadia review --workspace <path>`
- `pnpm arcadia review show <id> --workspace <path>`
- `pnpm arcadia review approve <id> --workspace <path>`
- `pnpm arcadia review reject <id> --workspace <path>`
- `pnpm arcadia review defer <id> --workspace <path>`

Approval behavior:

- For persisted `review_items`, approval calls `runAskCommand` with `approvedReviewItemId`.
- The approved run creates the intended downstream work item, plan, approval gates, Codex invocation record, and prompt packet when the original request resolves that way.
- The review item is marked approved and records `resulting_ask_request_id`.
- This is more than merely closing the item.

Review gaps:

- `review` list includes legacy `needs_mark` work items, but `review show/approve/reject/defer` only operate on `review_items` ids. A legacy work item id shown in `review` cannot be approved by `review approve`.
- `review --help` omits `--workspace` and `--json` even though the top-level action accepts both through permissive parsing.
- The term `needs_mark` still appears in internal JSON fields such as `ask.status`, `work_classification`, step status, and weekly-review count names. User-facing copy mostly says Requires Review.

## Repo-Local Compatibility Assessment

`pnpm arcadia dogfood init`:

- Initializes `.arcadia-workspace/`.
- Seeds the Arcadia project, active milestone, work item, and mission log through the generic Arcadia workspace profile.
- `.arcadia-workspace/` is Git-ignored.

`pnpm arcadia dogfood ask "<request>"`:

- Supplies `.arcadia-workspace/` and uses the generic ask project routing rules.
- Calls the same ask runner used by the main `ask` command.
- Uses `.arcadia-workspace/` from the repo root.
- Avoids duplicate Intake logic.

Observed inconsistency: resolved by returning `dogfood.*` command identities from compatibility shortcuts.

- JSON output reports `command: "ask"` because the command returns the delegated ask response. This is acceptable internally but leaky for adapter observability.

## Gaps And Risks

Must-fix risks before treating the CLI as stable for all ingress:

- Top-level `review` help and option registration are misleading.
- Legacy Requires Review items and persisted `review_items` do not have one uniform approval path.
- There is no explicit adapter contract document for command inputs, JSON outputs, exit codes, and retry/idempotency expectations.

Operational risks:

- `ask` is safe for vague input, but not universally expressive. Adapters must expect `requires_review`.
- `status` writes `reports/status.md`; read-only callers that only need state should prefer `dashboard snapshot`.
- `codex list/sync` can depend on local Codex state or observer environment.

Terminology risks:

- CLI human output mostly uses Requires Review.
- JSON and database fields still expose `needs_mark`, which is acceptable as internal compatibility only if documented.

Docs risks:

- README examples cover many commands, but there is no single ingress adapter guide.
- Discord docs correctly say Arcadia remains authoritative for approvals, but the stable local approval path needs the legacy-item caveat.

## Recommended Next Steps

Resolved during single-workspace alignment:

1. Register documented `--workspace` and `--json` options on top-level `review`, removing the permissive hidden parsing if possible.
2. Add a short adapter contract document for `ask`, `review`, `status`/`dashboard snapshot`, `ingress process`, JSON shapes, exit codes, and retry behavior.
3. Decide whether `dogfood ask` JSON should report `command: "dogfood.ask"` while preserving delegated ask data.

Should fix soon:

1. Make every item emitted by `review` actionable by `review show/approve/reject/defer`, or clearly separate legacy `needs_mark` work items from persisted `review_items`.
2. Reduce user-visible `needs_mark` leakage in JSON aliases where practical, while preserving database compatibility.

Nice to have:

1. Add `--workspace` defaulting via `ARCADIA_WORKSPACE` for adapter ergonomics.
2. Add optional `--json-lines` or compact JSON for high-volume adapters.
3. Add `review list` as an explicit alias for top-level `review`.
4. Add `dogfood review` wrappers for `.arcadia-workspace/`.
5. Add an ingress adapter smoke script covering CLI, dogfood, file ingress, Discord wrapper, and dashboard snapshot.

## Exact Commands Tested

Help and discovery:

```bash
pnpm arcadia --help
pnpm arcadia ask --help
pnpm arcadia dogfood --help
pnpm arcadia review --help
pnpm arcadia project --help
pnpm arcadia work --help
pnpm arcadia run --help
pnpm arcadia ingress --help
```

Workspace and status:

```bash
pnpm arcadia init /tmp/arcadia-cli-ingress-audit --json
pnpm arcadia project import --workspace /tmp/arcadia-cli-ingress-audit --name AuditProject --mission "Audit CLI ingress behavior" --milestone "CLI audit milestone" --next-action "Audit CLI ingress" --classification autonomous --json
pnpm arcadia status --workspace /tmp/arcadia-cli-ingress-audit --json
```

Ask and Intake:

```bash
pnpm arcadia ask --workspace /tmp/arcadia-cli-ingress-audit "what should I focus on today" --json
pnpm arcadia ask --workspace /tmp/arcadia-cli-ingress-audit "capture this fuzzy idea about maybe someday doing something" --json
pnpm arcadia ask --workspace /tmp/arcadia-cli-ingress-audit "create a blog site named Audit Notes" --json
```

Review:

```bash
pnpm arcadia review --workspace /tmp/arcadia-cli-ingress-audit --json
pnpm arcadia review show review_ff79cf88773a41d2a9 --workspace /tmp/arcadia-cli-ingress-audit --json
pnpm arcadia review defer review_ff79cf88773a41d2a9 --workspace /tmp/arcadia-cli-ingress-audit --json
pnpm arcadia review approve review_8b147656a127431286 --workspace /tmp/arcadia-cli-ingress-audit --json
pnpm arcadia ask --workspace /tmp/arcadia-cli-ingress-audit "another unclear audit thought" --json
pnpm arcadia review reject review_85f51b7598c5472ab3 --workspace /tmp/arcadia-cli-ingress-audit --json
pnpm arcadia review show missing_review --workspace /tmp/arcadia-cli-ingress-audit --json
```

Dogfood:

```bash
git check-ignore -v .arcadia-workspace/
pnpm arcadia dogfood init --json
pnpm arcadia dogfood ask "what should I focus on today" --json
pnpm arcadia dogfood ask "implement CLI ingress audit report for Arcadia" --json
```

## Test Results

Passed:

- `pnpm arcadia --help` showed the expected top-level command set.
- `pnpm arcadia ask --help` showed `--workspace`, `--project`, `--milestone`, `--run-safe`, and `--json`.
- Throwaway workspace initialization succeeded.
- `project import` created a project, active milestone, and work item.
- `status --json` returned `projectCount: 1`, `queuedWorkCount: 1`, and wrote `reports/status.md`.
- `ask "what should I focus on today"` resolved `ShowStatus`, returned `result.status: "acted"`, and embedded status data.
- Low-confidence ask created a persisted Requires Review item and did not create a work item or Codex invocation.
- Unsafe high-confidence project creation created a persisted Requires Review item.
- `review show` returned the expected packet for a review item.
- `review defer` marked an item deferred.
- `review reject` marked an item rejected.
- `review approve` resumed ask workflow, created a work item, plan, approval gates, Codex invocation record, and prompt packet artifacts.
- Missing review item returned JSON failure and exit code `2`.
- `.arcadia-workspace/` is ignored by Git.
- `dogfood init` initialized and seeded `.arcadia-workspace/`.
- `dogfood ask "what should I focus on today"` used `.arcadia-workspace/` and resolved through Intake.
- `dogfood ask "implement CLI ingress audit report for Arcadia"` now uses generic ask routing against `.arcadia-workspace/`.

Failed or inconsistent:

- Historical issue: `review --help` did not show the top-level `--workspace` or `--json` options that are usable for listing.
- Historical issue: `dogfood ask` JSON returned `command: "ask"` instead of `dogfood.ask`.
- The first parallel `status` read during testing raced the project import and returned zero projects; rerunning sequentially returned the correct state. Adapter test suites should avoid assuming independent command completion when commands mutate the same workspace.
