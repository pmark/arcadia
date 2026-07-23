# Semantic Vocabulary Audit

## Executive Summary

Arcadia already has a coherent operational model, but the repository uses several legacy names for concepts that the permanent vocabulary now wants to stabilize.

Overall terminology health: moderate. Project, Mission, Milestone, Artifact, Status, and Validation are mostly aligned. The largest inconsistencies are:

- Goal vs Outcome
- Work Item vs Action
- Review / Requires Review / Review Item vs Decision
- Mission Log vs Log
- Work Classification / Classification vs Responsibility
- Back Burner vs Incubating
- Execution vs Workflow / Run

The safest migration path is documentation first, user-facing labels second, JSON/API compatibility third, and database schema last. No implementation behavior was changed by this audit.

## Audit Scope

Searched repository text across source, documentation, tests, CLI, Dashboard, prompts, SQL, schemas, JSON, Markdown, comments, UI labels, and API-adjacent code, excluding generated dependency/build folders such as `node_modules`, `dist`, `.next`, and temporary workspaces.

Search terms included:

`goal`, `goals`, `outcome`, `work item`, `work_item`, `next action`, `review`, `review item`, `planning packet`, `work packet`, `packet`, `mission log`, `log`, `artifact`, `execution`, `execute`, `validation`, `classify`, `classification`, `steward`, `stewardship`, `milestone`, `mission`, `project`, `action`, `back burner`, `incubating`.

Approximate occurrence counts from the audit pass:

| Term family | Count |
| --- | ---: |
| project | 1405 |
| review | 996 |
| action | 557 |
| artifact | 471 |
| milestone | 402 |
| execution / execute | 355 |
| mission | 321 |
| goal / goals | 286 |
| packet | 274 |
| validation | 260 |
| classify / classification | 198 |
| steward / stewardship | 198 |
| work item / work_item | 135 |
| next action | 132 |
| review item | 102 |
| mission log | 90 |
| back burner | 74 |
| outcome | 44 |
| incubating | 34 |
| planning packet | 32 |
| work packet | 1 |

Counts are directional, not migration counts. Many occurrences are tests, implementation names, compatibility fields, or external product terminology.

## Current Vocabulary Inventory

| Current term | Current meaning | Representative locations | Overlap | Classification | Recommendation | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| Project | Durable endeavor with mission, status, metadata, milestones, work, artifacts, logs | `src/domain/types.ts`, `database/schema.sql`, `README.md`, Dashboard pages | Domain could eventually group Projects | KEEP | Keep as primary concept | Low |
| Domain | Not materially implemented as a first-class object | Only appears in new semantics guidance | Project grouping | MISSING | Introduce only when product needs cross-project grouping | Medium |
| Mission | Enduring reason for a Project | `projects.mission`, project create/update flows, Dashboard project page | Sometimes adjacent to Mission Log | KEEP | Keep | Low |
| Goal | Project desired result; also Codex local/cloud goal source | `projects.goal`, `CreateProjectInput.goal`, `project update --goal`, docs, tests, `codex_tasks.source = local_goal` | Outcome | RENAME / LEGACY | Rename user-facing project Goal to Outcome over time. Keep Codex goal when referring to Codex. | High |
| Outcome | Proposed canonical desired result | New semantics doc; limited existing use | Goal | MISSING / KEEP | Add as user-facing alias before schema migration | High |
| Milestone | Checkpoint under Project | `milestones`, `Milestone`, CLI `milestone`, Dashboard milestone rows | Outcome | KEEP | Keep | Low |
| Work Item | Persisted unit of work | `work_items`, `WorkItem`, `arcadia work`, `work_item_id`, docs, tests | Action | RENAME / LEGACY | Rename user-facing labels to Action; keep table/API fields until planned migration | High |
| Action | Currently used both as generic operation and next/proposed action fields | `next_action`, `proposed_action`, Dashboard button handlers, command code | Work Item, Next Action, Proposed Action | AMBIGUOUS | Use Action for work records; qualify UI operations as commands/buttons where needed | High |
| Next Action | Field/view for the next available step | `next_action`, `ProjectSummary.next_action`, status reports, Dashboard project detail | Action | KEEP as view | Keep as a view/field, not a top-level object | Medium |
| Artifact | Durable output/evidence | `artifacts`, `Artifact`, `expected_artifact`, `artifact_path`, docs, Dashboard | Packet, plan files, logs can be artifacts | KEEP | Keep | Low |
| Planning Packet | Prompt/context file for Codex planning | `src/codex/packets.ts`, planning artifact fixtures, reports | Artifact | RENAME | Present as planning Artifact; keep packet implementation names | Medium |
| Work Packet | Rare execution input phrase | Sparse references | Artifact / execution input | RENAME | Avoid as a primary term | Low |
| Packet | Prompt/context payload | `prompt_packet_path`, `Codex Packet`, `packet_created`, `packets.ts` | Artifact | IMPLEMENTATION / LEGACY | Keep internally; user-facing copy should say Artifact where durable output matters | Medium |
| Review | Human judgment workflow and weekly review report | `src/commands/review.ts`, `review_items`, `review_feedback`, Dashboard review pages, Discord review commands | Decision, Log/report review | RENAME / AMBIGUOUS | Rename judgment records to Decision; keep weekly review where it means retrospective report | High |
| Requires Review | Queue/status/view for work needing human judgment | constants, CLI output, Dashboard, Discord docs | Decision, Requires Review | LEGACY / RENAME | Accept as transitional status/view; pair with Decision in future UI | Medium |
| Review Item | Persisted item awaiting approval/rejection/deferral | `review_items`, `ReviewItem`, `review show/approve/reject/defer` | Decision | RENAME / LEGACY | Future user-facing name: Decision. Schema remains legacy until migration | High |
| Decision | Existing field names `decision_needed`, `decision_note`; not first-class object name | `review_items.decision_needed`, Dashboard run follow-up review | Review Item | MISSING / KEEP | Promote as canonical user-facing concept | High |
| Mission Log | Durable project history record | `mission_logs`, `MissionLog`, `arcadia log create`, `MISSION_LOG.md`, docs | Log | RENAME / LEGACY | Prefer Log in new user-facing docs; preserve `mission_logs` until planned migration | Medium |
| Log | Generic logging and mission log abbreviation | worker logs, file logs, `log create`, mission log paths | Mission Log, runtime logging | AMBIGUOUS | Use Log for durable project history; qualify runtime logs as worker/system logs | Medium |
| Status | Lifecycle state | project/work/artifact/run/review statuses | Responsibility sometimes encoded as status | KEEP | Keep | Low |
| Work Classification | Who can advance work: autonomous, Codex, review, blocked | `work_classification`, CLI `--classification`, reports | Responsibility | RENAME / LEGACY | Rename user-facing label to Responsibility; preserve field/flag initially | High |
| Classification | Intake category or work responsibility | `IntakeClassification`, Back Burner classification, golden request tests | Responsibility, intent type | AMBIGUOUS | Keep for intake categorization; avoid for Action responsibility | Medium |
| Responsibility | Proposed canonical owner/capability for an Action | New semantics doc | Work Classification | MISSING | Add as user-facing label/alias | High |
| Validation | Commands/checks/criteria for project/run acceptance | `validation_commands`, run validation output, planning fixtures | Status, artifact evidence | KEEP | Keep as supporting property, not object | Low |
| Execution | Plan/run/step machinery | `execution_plans`, `execution_runs`, `Execution Run`, `executeApprovedReview`, docs | Workflow, Run | IMPLEMENTATION / RENAME | Keep internals; use Run for concrete attempts and Workflow for process language | Medium |
| Run | Concrete execution attempt | `run list`, `run show`, Dashboard runs | Execution | KEEP | Prefer Run in user-facing labels | Low |
| Back Burner | Holding area for ideas/thoughts not ready for work | `back_burner_items`, Dashboard Back Burner page, `recommendedExecutionPath = "Back Burner"` | Incubating | RENAME / VIEW | Treat as Incubating view; keep name only if desired product flavor | Medium |
| Incubating | Project status and Back Burner status | project statuses, back burner statuses | Back Burner | KEEP | Use as semantic state | Low |
| Stewardship | AI/request governance and routing behavior | `src/stewardship`, `stewardIntent`, prompts, operator context | Responsibility, validation, routing | IMPLEMENTATION | Keep as internal/system behavior, not a user object | Low |
| Approval Gate | Safety gate for sensitive work | `approval_gates`, execution planning | Decision, Validation | KEEP as implementation support | Keep under Decision/Validation semantics; do not promote as primary concept | Low |
| Ask Request | Natural-language ingress/request record | `ask_requests`, `arcadia ask` | Action, Decision | IMPLEMENTATION | Keep as request/audit implementation detail | Low |
| Capability | Extension/module concept | `src/capabilities`, blog capability code | Domain, Project | KEEP | Keep technical/module concept | Low |
| Codex Task | Observed external Codex task/goal | `codex_tasks`, Discord docs, architecture artifact | Action, external goal | KEEP with qualification | Preserve external product wording | Low |

## Canonical Vocabulary

The permanent model is:

- Domain: broad area containing Projects.
- Project: durable endeavor.
- Mission: enduring reason the Project exists.
- Outcome: concrete desired change in reality.
- Milestone: checkpoint toward an Outcome.
- Action: smallest meaningful unit of intentional work.
- Artifact: durable evidence or output.
- Decision: point requiring human judgment.
- Log: durable Project history.

Supporting properties:

- Status
- Responsibility
- Validation

Action Responsibility values:

- Autonomous
- Codex
- Requires Review
- Blocked

## Findings

### Safe To Leave

Project, Mission, Milestone, Artifact, Status, Validation, Incubating, and Run are largely compatible with the semantic model.

Representative locations:

- `src/domain/types.ts`: `Project`, `Milestone`, `Artifact`, status-bearing interfaces.
- `database/schema.sql`: `projects`, `milestones`, `artifacts`, status checks.
- `apps/dashboard/components/dashboard-ui.tsx`: Dashboard fields for Project, Artifact, Milestone, Validation.
- `README.md`: core CLI command descriptions.

Validation should remain supporting language. `validation_commands` and run validation output are appropriate because they describe acceptance checks, not a primary Arcadia object.

### Rename Recommended

Goal should become Outcome for Arcadia project semantics.

Representative locations:

- `database/schema.sql`: `projects.goal`.
- `src/domain/types.ts`: `Project.goal`, `CreateProjectInput.goal`, `UpdateProjectInput.goal`.
- `src/commands/ask.ts`: deterministic updates for `goal`.
- `README.md` and `docs/reports/deterministic-natural-language-routing.md`: user-facing `--goal` examples.
- `tests/phase0.test.ts`: goal migration and project creation expectations.

Exception: Codex local/cloud goals are external product terminology and should remain "goal" when referring to Codex.

Work Item should become Action for user-facing language.

Representative locations:

- `database/schema.sql`: `work_items`, `work_item_id`.
- `src/domain/types.ts`: `WorkItem`, `CreateWorkItemInput`, summaries.
- `src/commands/work.ts`, `src/commands/queue.ts`, `src/commands/status.ts`.
- `README.md`: `arcadia work` command copy.
- `tests/phase0.test.ts`, planning workflow tests.

The `arcadia work` command can remain as a CLI noun for a transition period, but labels should gradually say Action.

Review / Review Item should become Decision where the concept is human judgment.

Representative locations:

- `database/schema.sql`: `review_items`, `review_feedback`, `decision_needed`, `decision_note`.
- `src/domain/types.ts`: `ReviewItem`, `ReviewFeedback`.
- `src/commands/review.ts`, Dashboard review routes, Discord review commands.
- `apps/dashboard/app/review/page.tsx`, `apps/dashboard/app/api/review-action/route.ts`.
- `README.md`, `apps/discord-bot/README.md`.

Exception: weekly review is a retrospective report, not a pending Decision. It can keep "review" if product meaning is clear.

Mission Log should become Log for the canonical durable-history concept.

Representative locations:

- `database/schema.sql`: `mission_logs`, `mission_log_id`.
- `src/domain/types.ts`: `MissionLog`, `CreateMissionLogInput`.
- `src/markdown/missionLog.ts`, `MISSION_LOG.md`, `mission_logs/README.md`.
- CLI and Dashboard labels: "Mission Log".

Work Classification should become Responsibility for user-facing Action assignment.

Representative locations:

- `database/schema.sql`: `work_classification`.
- `src/domain/constants.ts`: `WORK_CLASSIFICATIONS`, labels.
- `src/commands/queue.ts`, `src/commands/status.ts`, reports.
- `README.md`: `--classification` flag and examples.
- Dashboard project details: "Work Classification".

Back Burner should become an Incubating status/view.

Representative locations:

- `database/schema.sql`: `back_burner_items`.
- `src/commands/backBurner.ts`.
- `apps/dashboard/app/back-burner/page.tsx`.
- `src/commands/ask.ts`: `recommendedExecutionPath === "Back Burner"`.

Execution should become Run or Workflow in user-facing copy.

Representative locations:

- `database/schema.sql`: `execution_plans`, `execution_runs`, `execution_run_steps`.
- `src/execution/*`.
- Dashboard runs page: "Execution Run".
- `README.md`: "execution plan", "execution runs".

### Legacy Aliases

The following names are acceptable internal compatibility names until a planned migration:

- `goal`
- `work_items`
- `work_item_id`
- `work_classification`
- `review_items`
- `review_feedback`
- `mission_logs`
- `mission_log_id`
- `prompt_packet_path`
- `execution_*`
- `back_burner_items`
- `requires_review`

Compatibility should be explicit in tests and migration notes. New user-facing copy should avoid expanding the legacy surface.

### Human Decisions Required

The product owner should decide:

- Whether "Mission Log" remains as intentional product flavor or fully collapses to "Log".
- Whether "Back Burner" remains as a friendly view name for Incubating material.
- Whether `arcadia work` remains the command name while UI labels say Action.
- Whether `arcadia review` remains the command group while records become Decisions.
- Whether `Requires Review` should appear as a canonical Responsibility or whether user-facing labels continue to prefer "Requires Review".
- Whether Domain is needed soon or should remain documented but unimplemented.
- Whether existing JSON responses should expose canonical aliases before database migration.

## Inconsistencies

### Goal vs Outcome

Goal is implemented and documented. Outcome is the desired canonical term but is mostly absent. This is the highest-priority vocabulary gap because Goal appears in schema, CLI flags, docs, tests, and project summaries.

### Work Item vs Action

Work Item is the persisted object. Action is used as `next_action`, `proposed_action`, Dashboard event handler names, and command/action labels. The model should make Action the object and qualify UI operations as commands, decisions, or button actions where needed.

### Review vs Decision

Arcadia already stores `decision_needed` and `decision_note` inside `review_items`, which shows the underlying concept is Decision. The top-level noun is still Review Item. "Requires Review" is currently a queue/status/view and can remain transitional.

### Mission Log vs Log

Mission Log is consistently implemented but conflicts with the proposed simpler canonical Log. Runtime logging also uses "log", so future copy should distinguish project Logs from worker/system logs.

### Classification vs Responsibility

`work_classification` values answer who can act: autonomous, Codex, needs review/Requires Review, blocked. That is Responsibility. `IntakeClassification` is different: it categorizes incoming text. Both should not share the same user-facing label.

### Back Burner vs Incubating

Back Burner is a feature/view and storage table. Incubating is already a status. The semantic model should treat Incubating as the state and Back Burner as optional product flavor.

### Execution vs Run

The code uses execution for plans, runs, steps, and executors. User-facing copy also says "Execution Run", which doubles the concept. Prefer Run for concrete attempts and Workflow for abstract process.

### Packet vs Artifact

Prompt/planning packets are persisted files and therefore Artifacts in the canonical model. "Packet" can remain an implementation term for Codex prompt assembly.

## Missing Or Underdeveloped Concepts

| Concept | Current state | Suggested future introduction |
| --- | --- | --- |
| Domain | Not first-class | Add only when Arcadia needs durable cross-project grouping. |
| Outcome | Represented by `goal` | Add user-facing Outcome aliases before schema changes. |
| Decision | Implemented under `review_items` | Rename user-facing review records to Decisions. |
| Responsibility | Represented by `work_classification` | Rename labels and docs; keep internal fields initially. |
| Log | Implemented as `mission_logs` | Decide whether full rename is worth churn. |

## Migration Plan

### 1. Documentation

Priority: immediate.

- Use `docs/arcadia-semantics.md` as the canonical contract.
- Update future docs to use Outcome, Action, Decision, Log, and Responsibility.
- Leave historical reports unchanged unless they are actively revised.

Estimated scope: small.

### 2. User-Facing Labels

Priority: high.

Low-risk label changes can happen without schema changes:

- "Goal" -> "Outcome" in new docs and Dashboard project details.
- "Work Classification" -> "Responsibility" in CLI/Dashboard/report labels.
- "Work Item" -> "Action" in human-readable CLI output.
- "Review Item" -> "Decision" where records require approval/rejection/deferral.
- "Execution Run" -> "Run".

Keep CLI flags and command names unchanged at first.

Estimated scope: medium.

### 3. CLI Compatibility

Priority: medium.

Add canonical aliases while preserving legacy flags:

- `--outcome` alias for `--goal`.
- `--responsibility` alias for `--classification`.
- Consider descriptions that say `arcadia work` manages Actions.
- Consider `decision` aliases for `review` commands only if command churn is acceptable.

Estimated scope: medium.

### 4. API And JSON Responses

Priority: medium-high, because consumers may depend on fields.

Additive aliases are safer than replacements:

- `outcome` alongside `goal`.
- `responsibility` alongside `workClassification`.
- `actionId` or `action` alongside `workItemId` / `workItem`.
- `decision` alongside `review` where response shape represents a pending judgment.
- `logPath` alongside `missionLogPath` if Log migration proceeds.

Document deprecation windows before removing legacy fields.

Estimated scope: medium to large depending on consumer count.

### 5. Database

Priority: last.

Do not rename tables or columns until user-facing copy and API aliases have settled. Schema migration would touch:

- `projects.goal`
- `work_items`
- `work_item_id`
- `work_classification`
- `review_items`
- `review_feedback`
- `mission_logs`
- `mission_log_id`
- `back_burner_items`
- `execution_*`

Recommended approach:

- Add canonical views or columns first if necessary.
- Backfill aliases.
- Keep compatibility reads/writes.
- Migrate external consumers.
- Remove legacy names only in a major version or explicit migration.

Estimated scope: large.

### 6. Internal Code

Priority: after schema/API decisions.

Internal TypeScript renames should be mechanical and test-backed, but they will touch many files. Defer until the public model is stable.

Estimated scope: large.

## Compatibility Risks

- Database renames would break existing workspaces without careful migrations.
- JSON response renames would break Dashboard, Discord adapter, tests, and external scripts.
- CLI flag renames would break existing automation and docs.
- `review` has two meanings: pending Decisions and retrospective reviews. Renaming all occurrences blindly would damage clarity.
- `goal` sometimes refers to Codex's external goal model. Renaming those references would be inaccurate.
- `classification` is valid for intake categorization but misleading for Action responsibility.
- `log` can mean durable project history or process/runtime logging. Copy must qualify runtime logs.

## Estimated Scope By Migration Group

| Group | Scope | Notes |
| --- | --- | --- |
| Documentation-only alignment | Small | New docs and active docs can be updated incrementally. |
| Dashboard label changes | Small-medium | Mostly labels, but type names may remain legacy. |
| CLI human output labels | Medium | Many commands and snapshots print legacy names. |
| CLI alias flags | Medium | Requires parser changes and tests. |
| JSON/API additive aliases | Medium-large | Requires snapshot tests and adapter updates. |
| Prompt and stewardship wording | Medium | Must avoid changing routing behavior accidentally. |
| Database schema rename | Large | Highest compatibility risk; defer. |
| TypeScript internal renames | Large | Broad churn; do after compatibility plan. |

## Recommended Next Actions

1. Treat `docs/arcadia-semantics.md` as the source of truth for future work.
2. Open a separate implementation milestone for label-only user-facing terminology cleanup.
3. Add CLI flag aliases for `--outcome` and `--responsibility` before deprecating legacy flags.
4. Add JSON compatibility aliases only after deciding which consumers need them.
5. Defer schema and internal code renames until after the vocabulary has stabilized in user-facing surfaces.

## Audit Classification Summary

KEEP:

- Domain as documented future grouping
- Project
- Mission
- Milestone
- Artifact
- Status
- Validation
- Incubating
- Run

RENAME:

- Goal -> Outcome
- Work Item -> Action
- Review Item -> Decision
- Review -> Decision when judgment is meant
- Mission Log -> Log if product flavor does not intentionally keep Mission Log
- Work Classification -> Responsibility
- Back Burner -> Incubating view/status
- Execution -> Workflow / Run
- Planning Packet -> Artifact (plan)

LEGACY:

- Existing schema fields and table names listed above
- Existing CLI command names and flags until aliases exist
- `requires_review` compatibility values
- `Requires Review` transitional view/status

IMPLEMENTATION:

- Stewardship
- Ask Request
- Approval Gate
- Packet assembly
- Execution plan/run/step internals
- Worker/system logs

AMBIGUOUS:

- Review when used for retrospective weekly review vs pending judgment
- Log when used for runtime logging vs durable project history
- Action when used for UI operation vs durable work object
- Classification when used for intake category vs work responsibility

