---
arcadia: v1
type: plan
slug: portfolio-docs-protocol
project: arcadia
status: active
milestone: docs sync ingests a real project's markdown
updated: 2026-07-31
actions:
  - id: build-parser
    title: Build the frontmatter parser and vocabulary validator
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered in src/docs/parse.ts; no further work.
    expected_artifact: Frontmatter parser reporting per-field validation errors
    clarification: clarified
    confidence: high
    source: dogfooding pass against Arcadia's own repository
    depends_on: []
  - id: build-upsert
    title: Build the upsert layer (project/plan/decision -> DB rows)
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered in src/docs/sync.ts, keyed by doc_ref; no further work.
    expected_artifact: Idempotent doc_ref-keyed upsert
    clarification: clarified
    confidence: high
    source: dogfooding pass against Arcadia's own repository
    depends_on: [build-parser]
  - id: wire-docs-sync-command
    title: Wire arcadia docs sync [--project] [--apply] into the CLI
    status: done
    responsibility: codex
    effort: short
    next_action: Delivered alongside arcadia portfolio; no further work.
    expected_artifact: docs sync and portfolio commands
    clarification: clarified
    confidence: high
    source: dogfooding pass against Arcadia's own repository
    depends_on: [build-upsert]
  - id: contract-work-pointer
    title: Add the authoritative work pointer and dispatch resolution
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered as active_plan, current_action, acceptance_criteria, and arcadia next.
    expected_artifact: arcadia next resolving or refusing a dispatch with named remedies
    acceptance_criteria:
      - PROJECT.md carries active_plan and the active plan carries current_action.
      - arcadia next resolves exactly one action, or lists blockers naming file, field, and remedy.
      - A clarified current action without acceptance criteria fails validation.
      - A second plan designating a current_action is reported as a competing objective.
    clarification: clarified
    confidence: high
    source: Arcadia Coding-Agent Continuation Contract
    depends_on: [wire-docs-sync-command]
  - id: second-project-validation
    title: Validate the protocol against a non-Arcadia repository
    status: done
    responsibility: codex
    effort: session
    clarification: clarified
    confidence: high
    next_action: Completed and validated on 2026-07-25; select the next protocol increment explicitly.
    expected_artifact: Foreign-repository validation report with sync, next, execution-profile, and deterministic-refusal evidence.
    acceptance_criteria:
      - Decision 0002 records Private Practice Now as the first foreign repository.
      - Both repositories' applicable instructions and bounded context are read and the current milestone, Action, responsibility, and required artifacts are recorded.
      - docs sync is previewed before apply and the minimum managed-document changes for Private Practice Now are identified.
      - arcadia next, execution-profile resolution, and deterministic refusal behavior are demonstrated without changing Private Practice Now implementation code.
      - Findings, incompatibilities, recommended patches, and continuation state are recorded in this plan and the mission Log.
      - Focused validation passes and no deployment, publish, commit, push, credential, production, or destructive operation occurs.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Read-only inspection of Private Practice Now documentation and worktree state
          - Local Arcadia workspace and managed-document updates only
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    decisions: ["0002"]
    references:
      - docs/plans/portfolio-docs-protocol.md
      - docs/COMMANDS.md
    depends_on: [contract-work-pointer]
  - id: repair-clarification-response-ux
    title: Make clarification Decisions directly answerable in Mission Control and Discord
    status: done
    responsibility: codex
    effort: session
    clarification: clarified
    confidence: high
    next_action: Delivered and validated on 2026-07-25; monitor real operator use before broadening the response protocol.
    expected_artifact: A conversational clarification-response flow with durable answers, immediate acknowledgment, automatic re-clarification, and explicit execution boundaries.
    acceptance_criteria:
      - A free-text Discord reply to a clarification notification records the answer against that exact Decision.
      - Mission Control exposes an answer field and does not present clarification as approval.
      - AI advice can populate an editable draft but never submits an answer or grants authority.
      - The operator receives an immediate durable acknowledgment while clarification continues.
      - The resulting concrete next Action or one focused follow-up question is surfaced without a second command.
      - Approval Decisions retain deterministic approve, reject, and defer behavior; free-form text cannot authorize execution.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: cross_system
        required:
          - Shared CLI Decision-response semantics
          - Mission Control review flow
          - Discord review notifications and replies
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    references:
      - START_HERE.md
      - docs/COMMANDS.md
      - apps/dashboard/README.md
      - apps/discord-bot/README.md
    depends_on: []
  - id: ingest-mission-logs
    title: Ingest MISSION_LOG.md entries as mission_logs rows
    status: done
    responsibility: codex
    effort: short
    clarification: clarified
    confidence: high
    source: Decision 0003, which selected this increment over the other two
    next_action: Delivered as doc_ref-keyed Log ingestion in src/docs/sync.ts; no further work.
    expected_artifact: Idempotent mission-Log ingestion with focused parser, sync, and duplicate-prevention tests.
    decisions: ["0003"]
    acceptance_criteria:
      - Each dated MISSION_LOG.md entry becomes one mission_logs row, keyed so re-running creates no duplicates.
      - docs sync stops reporting log files as skipped.
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: project
        required:
          - Managed-document parser and sync changes
          - SQLite mission_logs persistence
          - Focused idempotency validation
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    depends_on: [build-upsert]
  - id: persist-dependencies
    title: Persist action depends_on ordering rather than only validating it
    status: done
    responsibility: codex
    effort: short
    clarification: clarified
    confidence: high
    source: Decision 0003, selected against the operator's stated criterion of advancing agent-managed planned work.
    next_action: Delivered on 2026-07-26 as work_item_dependencies plus a dispatch refusal; no further work.
    expected_artifact: Persisted depends_on edges with a dispatch refusal naming the unfinished prerequisite, its file, field, and remedy.
    acceptance_criteria:
      - depends_on edges survive a docs sync round trip.
      - An Action cannot be dispatched while an Action it depends on is unfinished.
    decisions: ["0004"]
    references:
      - src/docs/sync.ts
      - src/docs/dispatch.ts
      - src/db/schema.ts
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      context:
        scope: project
        required:
          - SQLite dependency-edge persistence
          - Managed-document sync changes
          - Dispatch refusal behavior
        staging: forbidden
      phases:
        planning:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        implementation:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
        verification:
          capability: c3_systems
          effort: e3_deep
          autonomy: bounded_write
          data_locality: local_only
    depends_on: [build-upsert]
  - id: narrative-summarization
    title: Queue an Intelligence summarization job for narrative docs
    status: open
    responsibility: codex
    effort: short
    acceptance_criteria:
      - A narrative doc produces an Artifact holding its summary.
      - The summary is never written back into the source document.
    clarification: unclarified
    decisions: ["0004"]
    depends_on: [wire-docs-sync-command]
questions:
  - id: plan-milestone-span
    question: If one plan's work spans multiple milestones, should the protocol split the plan, or allow a plan to reference more than one milestone?
    gap_type: missing-decision
    decision: "0005"
  - id: docs-sync-write-back
    question: Should docs sync ever write back to a repo (e.g. append Arcadia run results to MISSION_LOG.md), or must it stay strictly one-way?
    gap_type: missing-decision
    decision: "0004"
decisions: ["0003", "0004", "0005"]
---

# Portfolio Docs Protocol

## Executive Summary

Docs as the distributed database of intent across every project Arcadia
manages. Frontier-model chatbots write these files from working
conversations; Arcadia crawls, validates, and ingests them; the operator
manages the portfolio at executive level from Arcadia's views.

**Division of truth:** docs own *intent* — plans, decisions, goals, open
questions. Arcadia's database owns *execution state* — runs, queues, clarify
transitions. Sync is one-way (docs → Arcadia), idempotent, and never edits a
doc.

This plan is itself the first file that conforms to the protocol it defines —
the frontmatter above is a real `type: plan` record, carrying the work pointer
that `arcadia next` resolves.

## Status

**This section is derived data.** The frontmatter above is authoritative;
`arcadia portfolio` reads it after `docs sync`.

- Milestone: `docs sync` ingests a real project's markdown — **reached.**
  Arcadia's own repository is the first project ingested by this protocol.
- Current Action: none. This plan no longer declares one; Decision 0004 deferred
  its remaining narrative-summarization Action; `active_plan` now points to
  `narrative-digests`.
- Responsibility: none pending in this plan.
- Required Artifact: delivered — `docs sync`, `portfolio`, `next`, mission-Log
  ingestion, persisted `depends_on` ordering, and Arcadia's own conforming
  documents carrying a resolvable work pointer.
- Decisions open: the two plan-level questions above. 0004 is deferred with
  triggers, not open.
- Deferred until its trigger fires: `narrative-summarization` (a second foreign
  repository, or a summary someone actually wants). Dependency persistence was
  delivered independently on 2026-07-26 and retained through the branch merge.
- Last Log: 2026-07-31 — implemented mission-Log ingestion under Decision 0003;
  dependency persistence remains delivered from the parallel local history.
- Updated: 2026-07-31

## Foreign-repository validation — Private Practice Now

Decision 0002 selected `/Users/pmark/Dev/PrivatePracticeNow/platform` as the
first foreign repository. Its applicable `AGENTS.md`, `.arcadia` context policy,
`PROJECT.md`, continuation protocol, active plan, and mission Log were read
before discovery. The resolved state was milestone **Define the shared
production inquiry service boundary now that the bootstrap publishing model is
proven**, Action `define-shared-inquiry-service`, Responsibility **Codex**, and
required Artifact **a build-ready implementation plan covering durable capture,
site authorization, abuse controls, queued delivery, idempotency, monitoring,
retention, and minimum-data handling**.

The first Private Practice Now sync preview reported 15 creates, 14 intentional
skips, and zero errors. It recognized the managed Project, plan, 3 Actions, 11
Decisions, narrative docs, and mission Log. Narrative and Log ingestion are
not implemented; they were skipped with explicit reasons. The current plan
initially omitted a plan-level `milestone` and the current Action omitted an
execution profile. The minimum managed-document patch was therefore the
`arcadia.execution/v1` `systems_change` declaration on the current Action and
the plan-level milestone field. A second preview reported one milestone update
and 14 unchanged records; apply completed with zero errors. `arcadia next` then
resolved the same milestone and Action.

Incompatibilities and recommended patches:

- ~~Mission Logs and narrative documents are detected but not persisted.~~
  Mission Logs now persist (see below). Narrative documents remain detected and
  skipped; `narrative-summarization` is still the last gap before a foreign
  repository is fully represented.
- `depends_on` is validated, enforced at dispatch, and persisted in
  `work_item_dependencies`; the persistence half was delivered on the parallel
  local history before this plan became active again.
- A newly initialized workspace can have a newer DB Project row than a checked-in
  document, producing a deterministic stale-document skip. Preserve this
  refusal and expose the timestamp remedy in operator guidance.
- Newly authored foreign current Actions need the execution profile and plan
  milestone fields for complete continuation and profile resolution.
- Private Practice Now initially described its required Artifact only in
  `PROJECT.md`; `arcadia next` therefore returned `expectedArtifact: null`.
  Mirror the required Artifact onto the current managed Action so adapters can
  present a complete continuation packet without parsing narrative sections.

The validation Action is complete. The next pointer now names
`ingest-mission-logs` but remains `question_open` so Arcadia asks the operator
which of the three already-designed protocol increments to select rather than
inferring priority.

## Mission-Log ingestion

Decision 0003 selected this increment. The parser already produced a structured
entry per `## YYYY-MM-DD — title` heading and `mission_logs` already existed as a
table, so the work was the missing upsert rather than a new subsystem.

Entries are keyed `log/<slug>#<date>--<title-slug>` and carry that ref in a new
`doc_ref` column on `mission_logs`, added through the existing
`ensureDocRefColumns` migration rather than a new one.

**The key was built wrong first, and dogfooding caught it.** Keying on the date
alone looks safer — it survives a retitle, which is the thing doc_refs exist to
do — and the first implementation did that. Running it against Arcadia's own
repository refused five of nine entries: `MISSION_LOG.md` has five entries dated
2026-07-25. Several entries under one date is the common path in a real Log, not
an edge case, and the protocol had already said the whole `## YYYY-MM-DD — title`
heading was the entry key. The narrowing was the mistake, not the data.

So the rarer cost is the one paid: retitling an old entry forks a row, and
entries sharing a date do not collide. Ordinal-within-date was the third
candidate and is worse than both — entries are prepended newest-first, so a new
same-day entry would shift every ordinal below it and silently rewrite rows
nobody edited. Two entries sharing a whole heading remain a per-file validation
error, reported once per contested heading rather than once per repetition.

Two smaller decisions worth recording because both could have been fudged:

- **An entry with no `**Next:**` bullet records that it has none.** The column
  is `NOT NULL`, and deriving a plausible next action from the entry's prose
  would put a sentence nobody wrote into the operator's own history.
- **Re-ingestion rewrites only the four narrative fields and the path.**
  `project_id`, `milestone_id`, and `artifact_impact` are execution state that
  Arcadia's flows attach to a Log after the fact, and the division of truth puts
  execution state on Arcadia's side of the line. A re-sync must not erase it.

Narrative documents are still reported as skipped, which is now the only
intentional skip `docs sync` emits for a conforming repository. A full apply
against Arcadia's own repository reports 42 creates, 0 skips, and 0 errors, and
a second apply reports everything unchanged.

One unrelated defect surfaced during that run and was left alone rather than
folded into this Action: `syncProject` counts `name` as drift, but
`updateProject` has no `name` branch, so a Project whose database row disagrees
with its `PROJECT.md` name reports an `update` on every sync forever and never
converges. It needs its own Action.

## Clarification-response UX findings

Operator dogfooding found that the clarification protocol was durable but not
usable as a conversation. A direct Discord reply reached generic Ask unless it
looked like `approve`, `reject`, `defer`, an option letter, or explicit
feedback. Mission Control exposed the same clarification Decision through
approval-style buttons and had no way to provide the requested information.
AI advice could explain the Decision but could not hand an editable draft to
the response form. Even after adding an answer field, waiting synchronously for
the local clarification model left the interface appearing stuck.

The shared reply resolver now treats non-control free text as an answer only
when the exact Decision is an `ActionClarification`. Discord notifications
explicitly ask for a direct natural-language reply and acknowledge the durable
answer before re-running clarification. Mission Control presents **Your
answer**, removes the misleading approval action, refreshes the open-Decision
list immediately, and continues clarification without blocking the form. AI
advice can fill an editable draft but cannot submit it. Both surfaces report
that answering supplies information and does not approve execution.

Remaining incompatibilities and recommended patches:

- Direct Discord correlation depends on replying to the Arcadia notification
  message. Preserve this deterministic target; add a visible Decision-id
  fallback composer only if real use shows reply threading is unreliable.
- Automatic re-clarification depends on the local Intelligence service. The
  durable answer remains safe when that service is unavailable, but the
  operator must see the degraded-state message and the Action must remain ready
  to continue.
- Clarification and approval still share the generic `review_items` record.
  Keep intent-specific rendering and resolver tests whenever a new Decision
  type is added; do not infer authority from arbitrary free text.
- The current clarification model can legitimately ask a follow-up after an
  answer. Improve prompts or add structured sufficiency evidence only after
  collecting real follow-up quality data; do not hide a genuine unresolved gap.
- A context-free dogfood capture could be approved into a pending Run with no
  steps, and Arcadia has no canceled Run status or cancellation command. The
  accidental Run was rejected and marked failed with an explicit no-execution
  audit note. Add a first-class cancel transition and refuse execution approval
  when a Run has neither a Project nor executable steps.

## Project continuation UX findings — Private Practice Now

The first foreign-repository validation exposed a separate readiness gap: the
portfolio Daily Advantage query intentionally selects only `open` Actions, but
PPN's docs-authoritative current Action is already `in_progress`, clarified,
and dispatchable. The old Project view therefore showed a stale summary without
the information needed to understand why work was not starting.

The Project view now resolves `arcadia next --project` on demand and presents
the checked-in Milestone, current Action, source plan, responsibility, expected
Artifact, acceptance criteria, and resolved execution profile. A guarded
**Get to work** control prepares a planning Decision for that exact Action. It
does not queue a Run, invoke Codex, modify the foreign repository, or weaken
execution requirements. When continuation is unsafe, the panel lists every
document blocker with its file, field, message, and remedy. Operator questions
and project Decisions remain answerable inline through the existing
intent-specific Review resolver.

In the live PPN check, the guarded preparation reached execution-profile
resolution and refused deterministically: no configured planning provider met
`c3_systems/e3_deep` while honoring the Action's `local_only` locality. The UI
now preserves that exact refusal and rejected-mapping explanation, so “Ready to
prepare” cannot be mistaken for permission to weaken the profile or use
credentials that are not configured.

Recommended follow-ups:

- Keep repository document resolution authoritative; never infer a current
  Action from database recency or backlog order when the docs pointer refuses.
- Add an explicit docs-sync timestamp/result to this panel once narrative and
  mission-Log ingestion can report more than intentional skips.
- Add a first-class project-scoped Review filter if inline Decisions become too
  dense for a large project; preserve the same answer-versus-approval contract.

### What dogfooding changed

Using the protocol on Arcadia itself found three things the spec did not
anticipate:

1. **Dry run and apply could disagree.** `PROJECT.md` and a plan can name the
   same milestone. The preview reported two creates where `--apply` did one
   create and one adopt, because nothing written during a dry run is visible to
   the next lookup. Fixed by tracking milestones planned within a run, which is
   what makes "the preview is the real thing with writes withheld" true rather
   than merely intended.
2. **A malformed document disappeared silently.** A question containing an
   unquoted colon is invalid YAML, and the crawler treated the unparseable file
   as "not ours" — no error, no row, no explanation. Generated frontmatter
   breaks this way constantly. A file claiming `arcadia: v1` is now always
   treated as managed so the parse error surfaces.
3. **`project create` seeded documents the protocol rejects.** New Projects now
   get conforming frontmatter, with scalars quoted when a name contains a colon.
4. **The protocol had no way to say what to work on next.** Documents recorded
   plans and actions but nothing designated an objective, so a dispatched agent
   would have had to infer priority from commits or backlog order. Adding the
   work pointer was the first thing the continuation contract required, and
   Arcadia's own documents could not satisfy it until this change.

## Design principles

1. **Frontmatter is the database; the body is narrative.** Every
   machine-critical field lives in YAML frontmatter using Arcadia's exact
   vocabularies. Deterministic ingestion reads only frontmatter. The body is
   for humans, and for Arcadia Intelligence to summarize — never to parse.
2. **Discovery by marker, not path.** Any file whose frontmatter contains
   `arcadia: v1` is a managed doc, wherever it sits under the project's
   `repo_path`. The paths below are the human convention; the marker is the
   machine truth.
3. **Stable slugs make ingestion idempotent.** Every entity carries a
   kebab-case slug that never changes once assigned. Re-ingesting a file
   upserts by `(project, type, slug)` — it never duplicates.
4. **Refuse, don't corrupt.** A file with an enum value outside the
   vocabulary is rejected whole, with an error naming the allowed values.
   Same posture as `clarify` verdicts.
5. **Clarify at write time.** A doc may not contain a vague next action.
   Either `next_action` is verb-first and physically doable, or the item
   carries `question` + `gap_type` instead. The clarification rubric runs in
   the chatbot conversation, not after the fact.
6. **Exactly one action is current.** `PROJECT.md` names an `active_plan`; that
   plan names a `current_action`. Together they are the authoritative work
   pointer — the single documented answer to "what should be worked on now".
   Without it, a dispatched agent falls back to inferring priority from commits
   or backlog order, which is precisely what the continuation contract forbids.
7. **Last write wins by `updated`.** Every managed doc carries an `updated:`
   date. Ingestion overwrites a DB row only when the doc is newer; regressions
   are warned, not applied.

## File set and naming

```text
<repo root>/
  PROJECT.md                      # one per repo -- the Project record
  MISSION_LOG.md                  # append-only work log, newest entry first
  docs/
    plans/<slug>.md               # one initiative per file
    decisions/NNNN-<slug>.md      # one decision per file, NNNN zero-padded, global per project
    architecture.md               # narrative docs: summarized, never parsed
    <topic>.md                    # (type: architecture | strategy | reference)
```

## Vocabularies

These are Arcadia's shipped enums (`src/domain/constants.ts`). They are the
only legal values. Anything else fails ingestion.

| Field | Values |
| --- | --- |
| project `status` | `active` `paused` `incubating` `completed` |
| milestone `status` | `active` `paused` `completed` |
| action `status` | `open` `in_progress` `done` `blocked` |
| `responsibility` | `autonomous` `codex` `requires_review` `blocked` |
| `effort` | `quick` (≤15m) `short` (≤1h) `session` (1–3h) `project` (multi-session) |
| `clarification` | `unclarified` `clarified` `question_open` |
| `gap_type` | `missing-decision` `missing-external-input` `missing-definition` `missing-success-criteria` |
| `confidence` | `high` `medium` `low` |
| decision `status` | `open` `approved` `rejected` `deferred` |
| plan `status` | `draft` `active` `complete` `superseded` |
| artifact `status` | `planned` `drafted` `ready` `published` |

Dates are ISO `YYYY-MM-DD`. Slugs are kebab-case, stable forever.

## Schema: PROJECT.md

```yaml
---
arcadia: v1
type: project
slug: private-practice-now
name: Private Practice Now
status: active
goal: One sentence -- why this project exists.
outcome: What finished looks like, concretely.        # optional
milestone: Marketing site v1 live                     # current milestone title
active_plan: nightly-sync-rework                      # the plan governing current work
updated: 2026-07-25
---
```

Body sections (all optional, `##` headings): **Mission**, **Current State**,
**Links**. Maps to `projects` + the current active milestone.

`active_plan` is half the work pointer. `arcadia next` refuses to resolve an
objective without it rather than picking a plan on the operator's behalf.

## Schema: docs/plans/&lt;slug&gt;.md

One initiative per file. The frontmatter `actions` list is the authoritative
work breakdown; the body narrates design and rationale but never restates
field values (restated values rot) -- exactly the discipline this file itself
follows.

```yaml
---
arcadia: v1
type: plan
slug: clarification-pass
project: arcadia                  # PROJECT.md slug
status: active                    # draft | active | complete | superseded
milestone: Clarification loop shipped
current_action: plan-gate         # exactly one action id in this plan
updated: 2026-07-25
actions:
  - id: phase-2-fields            # stable within this plan
    title: Structured clarification fields
    status: done
    responsibility: codex
    effort: session
    next_action: Merge the Phase 2 PR.
    expected_artifact: Merged PR adding the five columns
    clarification: clarified
    confidence: high
    source: docs/plans/clarification-pass.md, phase table
    acceptance_criteria:            # required on the current action
      - The five columns exist and a re-run adds no duplicates.
      - Round-trip tests cover every new field and flag.
    milestone: Clarification loop shipped   # optional; defaults to the plan's
    decisions: ["0001"]             # decisions this action requires
    references:                     # paths the action depends on
      - docs/COMMANDS.md
    depends_on: []
  - id: plan-gate
    title: Gate work plan on clarified Actions
    status: open
    responsibility: requires_review
    effort: short
    clarification: question_open
    gap_type: missing-decision
    question: Should only a clarified Action be plannable, given it changes existing planning tests?
    depends_on: [phase-2-fields]
questions:                        # plan-level questions not tied to one action
  - id: rollout-order
    question: Do we cut over per-tenant or all at once?
    gap_type: missing-decision
    decision: "0007"              # optional; the decision that answers it
decisions: ["0007"]               # decision record ids this plan references
---
```

Rules:

- An action with `clarification: clarified` MUST have a verb-first, concrete
  `next_action`. An action with `question_open` MUST have `question` +
  `gap_type` and MUST NOT have a `next_action`. `unclarified` means "not yet
  evaluated" and carries neither.
- Exactly one `question` per item — the single highest-leverage one.
- `responsibility` routes the queue: `requires_review` → operator,
  `codex` → coding agent, `blocked` → waiting on outside.
- `current_action` must name an action id in this plan. A dangling pointer
  fails validation: leaving an agent with no objective is worse than leaving it
  with no pointer.
- The **current action** must carry `acceptance_criteria` when it is
  `clarified`. Other actions may omit them — requiring criteria on completed
  history would invalidate it retroactively — but work about to be started must
  say what finished means before anyone starts it.
- Only the plan named by `active_plan` may declare `current_action`. A second
  plan declaring one is a competing objective and is reported as a blocker.
- An action may name its own `milestone:` when a plan spans more than one
  (Decision 0005); absent that it inherits the plan's. Splitting the plan
  instead would sever `depends_on` across the boundary, because a dependency may
  only name an action in the same plan.
- A plan-level question may name the `decision:` that answers it. Ingestion then
  mirrors that decision's resolution onto the question. Without it, a question
  answered elsewhere stays open in the queue forever, since ingestion never
  deletes and a question's *absence* cannot mean "resolved" — a document may
  legitimately trail reality.
- A plan's status decides its milestone's: `complete` or `superseded` ends the
  milestone, anything else keeps it active. Nothing else can know when a
  milestone is over, because plans are what create them.

Body sections: **Executive Summary**, **Design**, **Log** (dated bullets,
newest first). Maps to a milestone plus `work_items` (with dependency links
becoming subtask/ordering structure), and `review_items` for open questions.

## Schema: docs/decisions/NNNN-&lt;slug&gt;.md

ADR-shaped. One decision per file, numbered globally per project.

```yaml
---
arcadia: v1
type: decision
id: "0007"
slug: sync-retry-strategy
project: private-practice-now
plan: nightly-sync-rework         # optional
action: retry-behavior            # optional action id within that plan
status: open                      # open | approved | rejected | deferred
question: Should the nightly sync retry on partial failure, or fail the whole run?
gap_type: missing-decision
recommendation: Per-batch retry; failing the whole run loses good batches.
confidence: medium
decided: null                     # YYYY-MM-DD once resolved
answer: null                      # the operator's answer, verbatim
updated: 2026-07-25
---
```

Body sections: **Context**, **Options** (each with the 2–4 criteria that
matter), **Consequences**. Maps to `review_items` with
`resolved_intent: ActionClarification` when tied to an action.

## Schema: MISSION_LOG.md

Frontmatter: `arcadia: v1`, `type: log`, `project`, `updated`. Body is
append-only entries, newest first:

```markdown
## 2026-07-25 — Shipped the clarify orchestrator

- **Did:** Implemented arcadia clarify over Arcadia Intelligence; PR #8.
- **Result:** Full capture → clarify → decide loop works end to end.
- **Next:** Merge PRs #6–#8 in order, then run the loop on real work.
- **Blockers:** none
```

Maps to `mission_logs` (`work_performed`, `result`, `next_action`,
`blockers`). The whole `## YYYY-MM-DD — title` heading is the entry key —
`log/<slug>#<date>--<title-slug>` — so several entries may share a date. Two
entries sharing a whole heading are refused, because the key cannot tell them
apart.

## Narrative docs

`type: architecture | strategy | reference`, plus `project`, `slug`,
`updated`. No further schema. Arcadia ingests these for Intelligence-generated
summaries only; nothing in the body is parsed deterministically.

## Ingestion contract (Arcadia side, to be built)

- `arcadia docs sync [--project <id>] [--apply]` — crawls each project's
  `repo_path` for `arcadia: v1` files. **Dry-run by default**, same as
  `clarify`: print every create/update/skip, write nothing without `--apply`.
- Upsert by `(project, type, slug|id)`. Never delete: an entity absent from
  docs is left alone in the DB (docs may legitimately trail reality).
- Apply a doc only when its `updated` is newer than the DB row's; warn on
  regressions.
- Reject any file with an out-of-vocabulary enum or a `clarified` action
  lacking a `next_action`; report per-file, continue the crawl.
- Narrative docs queue an Intelligence summarization job (`local-preferred`,
  unpaid) whose output is stored as an Artifact, never written into the doc.

## The Documentarian Prompt

Paste everything between the rules into a frontier-model chatbot session
(as a system prompt, project instruction, or first message). It is
self-contained.

---

You are the documentarian for a portfolio of software projects managed by a
system called Arcadia. At the end of a working conversation — or when asked —
you produce Markdown documentation files that Arcadia ingests as structured
data. Follow these rules exactly.

**Output format.** Emit complete files, never fragments or diffs. Precede
each file with its repo-relative path on its own line. End with a one-line
manifest listing every file you produced. Prefer updating an existing file
(same path, same slugs, bump `updated:`) over creating a new one; if existing
files were shown to you, reuse their slugs and ids exactly.

**File types and paths.**
- `PROJECT.md` (repo root): the project record. One per repo.
- `docs/plans/<slug>.md`: one initiative per file. The work breakdown lives
  in frontmatter under `actions:`.
- `docs/decisions/NNNN-<slug>.md`: one decision per file, `NNNN` zero-padded
  and sequential within the project.
- `MISSION_LOG.md` (repo root): append-only log, newest entry first, entries
  headed `## YYYY-MM-DD — title` with **Did / Result / Next / Blockers**
  bullets.
- Other docs (`docs/architecture.md` etc.): narrative, no structured schema.

**Frontmatter.** Every file begins with YAML frontmatter containing
`arcadia: v1`, a `type` (`project` | `plan` | `decision` | `log` |
`architecture` | `strategy` | `reference`), a stable kebab-case `slug`, the
`project` slug (except in PROJECT.md itself), and `updated: YYYY-MM-DD`.
Frontmatter is the authoritative data; never restate its values in the body.

**Quote any scalar containing a colon, `#`, or a leading `-`.** An unquoted
value like `question: Should we do X: the fast way?` is invalid YAML and makes
the whole document unusable. This is the single most common way generated
frontmatter breaks.

**The work pointer.** `PROJECT.md` sets `active_plan` to the slug of the plan
governing current work. That plan sets `current_action` to exactly one of its
own action ids. Across the entire project, only that one plan may declare a
`current_action` — never designate a second. If you cannot tell which action
should be current, do not guess: write the candidates into a decision file with
`status: open` and leave `current_action` pointing at the action that is
blocked on it.

**Acceptance criteria.** The action named by `current_action` must carry
`acceptance_criteria` — a list of objective, checkable conditions — whenever it
is `clarified`. "Works correctly" is not a criterion; "the migration runs twice
without duplicating a column" is. Other actions may omit them. An action may
also list `decisions: ["0007"]` for decisions that must be answered before it
starts, and `references:` for paths a worker needs to read.

**Vocabularies — use these exact values and no others:**
- project status: `active` `paused` `incubating` `completed`
- plan status: `draft` `active` `complete` `superseded`
- action status: `open` `in_progress` `done` `blocked`
- responsibility: `autonomous` `codex` `requires_review` `blocked`
  (`codex` = a coding agent can do it; `requires_review` = the operator must
  act or decide; `blocked` = waiting on an outside party)
- effort: `quick` (≤15 min) `short` (≤1 h) `session` (1–3 h) `project`
  (multi-session) — set it only when the conversation actually implied a
  size; otherwise omit it. Never guess.
- clarification: `unclarified` `clarified` `question_open`
- gap_type: `missing-decision` `missing-external-input` `missing-definition`
  `missing-success-criteria`
- confidence: `high` `medium` `low`
- decision status: `open` `approved` `rejected` `deferred`

**The clarification rule — the most important rule.** For every action in a
plan, apply this test: *can you name one concrete, physical next action —
something the operator or a coding agent could start in their next work
session?*
- If YES: set `clarification: clarified`, write `next_action` as one
  sentence starting with a verb, set `responsibility`, `confidence`, and
  `source` (which part of the conversation or which document justified it).
- If NO: set `clarification: question_open`, classify the gap as exactly one
  `gap_type`, and write exactly ONE `question` — the single highest-leverage
  question whose answer unblocks the item. Not a list. Do NOT write a
  `next_action`; do not write a vague placeholder like "figure out X".
- For `missing-decision`, put the 2–4 criteria that matter in the decision
  record's Options section. For `missing-external-input`, include a draft of
  the ask. For `missing-definition`, propose 2–5 subtasks in the body as a
  *proposal* — clearly labeled as not yet approved. For
  `missing-success-criteria`, phrase the question as "what does finished look
  like?", specialized to the item.

**Decisions.** When the conversation surfaced a choice that was actually
made, record it as a decision file with `status: approved`, the `answer`,
and `decided` date. When a choice was identified but not made, record it
with `status: open`. Every open decision must appear in exactly one file.
An `approved` decision must record an `answer`; one that does not is rejected,
because it reads as resolved in every rollup while recording nothing anyone can
act on.

**Style.**
- Dates ISO (`YYYY-MM-DD`). Slugs kebab-case, stable — never rename one.
- Refer to the human as "the operator"; never use a personal name.
- Keep narrative bodies under ~150 lines; link rather than duplicate.
- Never invent status, effort, confidence, or dates the conversation did not
  support. When something material is genuinely unknown, ask one question
  before generating, or mark it `question_open` — do not fill the gap with a
  plausible guess.

---

## Open questions

See the `questions` list in this file's own frontmatter for the two open
protocol-level decisions (plan/milestone span, whether `docs sync` may ever
write back). A third, lower-stakes one, not worth a frontmatter entry:

- Decision numbering across multiple chatbot sessions can collide. The
  documentarian reuses existing numbers when shown them; ingestion treats the
  slug as the key and the number as display. Good enough until it isn't.
