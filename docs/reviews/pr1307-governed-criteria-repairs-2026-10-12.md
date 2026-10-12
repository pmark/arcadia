# PR 1307 — remaining governed criteria repairs

These are approval-ready proposals, not applied changes. The two historical proposals insert eight missing lists; the new probe proposal makes two existing token conditions numeric. All nine affected Actions preserve status, responsibility, next action, dependencies, references and pointers. Source attribution may record the amendment. Approved settlement also archives each disposable Ask input through the normal writer. The active Plan and queue are not reprioritized.

The earlier broad active-Plan amendment remains pending and is outside this narrow build repair. The common-planning pipeline proposal also remains pending. Superseded probe draft revisions were previewed only and have no approval or apply authority.

## Exact proposals

### precise-criteria-clarification-pass-20261012

Proposal: `agentask_53c64332a81bb3c231`
Preview fingerprint (historical evidence; refresh before apply): `9ee8aba3f356cb2a25cbdfe387ee0fab811987181875abf6e6092773102c0b8c`

Target: `docs/plans/clarification-pass.md`

```yaml
arcadia: v1
type: plan
slug: clarification-pass
project: arcadia
status: complete
milestone: Clarification loop shipped
token_impact: large
token_budget: "Historical multi-phase agentic implementation was the primary token cost; migrations, CLI checks, and tests were deterministic."
updated: 2026-10-12
actions:
  - id: phase-1-plumbing
    title: Thin CLI plumbing — artifact create and work update --expected-artifact
    acceptance_criteria:
      - CLI help lists artifact create and work update --expected-artifact; a CLI fixture creates an Artifact linked to its Action and persists the supplied expected-artifact value.
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR
    expected_artifact: Merged PR adding artifact create and --expected-artifact
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: []
  - id: phase-2-fields
    title: Structured clarification fields on work_items
    acceptance_criteria:
      - A fresh database and an upgraded database each expose clarification_status, gap_type, open_question, clarification_source and confidence on work_items; repeating migration leaves exactly one column of each name.
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR
    expected_artifact: Merged PR adding the five clarification columns
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: [phase-1-plumbing]
  - id: phase-3-decisions-subtasks
    title: Clarification Decisions and Action subtasks
    acceptance_criteria:
      - CLI fixtures open a clarification Decision and add a child Action whose parent_work_item_id equals the named parent; listing the Actions shows that parent-child relationship.
    status: done
    responsibility: agent
    effort: session
    next_action: Merged as PR
    expected_artifact: Merged PR adding review open and parent_work_item_id
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: [phase-2-fields]
  - id: phase-4-orchestrator
    title: The arcadia clarify orchestrator over Arcadia Intelligence
    acceptance_criteria:
      - A clarify fixture maps a concrete next action to clarified and an unresolved requirement to question_open with exactly one question and gap_type, preserving the original captured input.
    status: done
    responsibility: agent
    effort: project
    next_action: Merged as PR
    expected_artifact: Merged PR adding the clarify command
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-clarification-pass-20261012
    depends_on: [phase-3-decisions-subtasks]
  - id: plan-gate
    title: Gate work plan on clarified Actions
    acceptance_criteria:
      - An explicit Decision records whether work plan requires clarified Actions and names the compatibility consequences; until that Decision is answered this Action remains question_open and is not dispatched.
    status: open
    responsibility: requires_review
    effort: short
    clarification: question_open
    source: Agent Ask precise-criteria-clarification-pass-20261012
    gap_type: missing-decision
    question: Should only a clarified Action be plannable, given that gating changes existing planning tests?
    depends_on: [phase-4-orchestrator]
questions: []
decisions: []
```

### precise-criteria-portfolio-docs-protocol-20261012

Proposal: `agentask_46c417530b96c8c284`
Preview fingerprint (historical evidence; refresh before apply): `ef158d58f65f872ecdad3c7ec76aa4b18feae08d358f84098cebd9ba82f2f35a`

Target: `docs/plans/portfolio-docs-protocol.md`

```yaml
arcadia: v1
type: plan
slug: portfolio-docs-protocol
project: arcadia
status: active
milestone: docs sync ingests a real project's markdown
token_impact: xlarge
token_budget: "The historical protocol program required several agentic implementation sessions; parsing, sync, dependency resolution, and validation are deterministic, and deferred narrative summarization is the only routine model-bearing path."
recommended_model: gpt-5.6-terra
recommended_reasoning_effort: high
updated: 2026-10-12
actions:
  - id: build-parser
    title: Build the frontmatter parser and vocabulary validator
    acceptance_criteria:
      - Parsing a managed frontmatter fixture returns its declared Project, Plan or Decision fields; an invalid vocabulary value reports the exact file and field without throwing away errors in other files.
    status: done
    responsibility: agent
    effort: session
    next_action: Delivered in src/docs/parse.ts; no further work.
    expected_artifact: Frontmatter parser reporting per-field validation errors
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-portfolio-docs-protocol-20261012
    depends_on: []
  - id: build-upsert
    title: Build the upsert layer (project/plan/decision -> DB rows)
    acceptance_criteria:
      - Applying the same managed-document fixture twice leaves one row per doc_ref and no duplicate dependency links; a changed title updates the existing row rather than creating another.
    status: done
    responsibility: agent
    effort: session
    next_action: Delivered in src/docs/sync.ts, keyed by doc_ref; no further work.
    expected_artifact: Idempotent doc_ref-keyed upsert
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-portfolio-docs-protocol-20261012
    depends_on: [build-parser]
  - id: wire-docs-sync-command
    title: Wire arcadia docs sync [--project] [--apply] into the CLI
    acceptance_criteria:
      - CLI help lists docs sync with --project and --apply; a fixture dry run writes no Project rows, the same --apply run persists the declared records, and portfolio reports the synced Project.
    status: done
    responsibility: agent
    effort: short
    next_action: Delivered alongside arcadia portfolio; no further work.
    expected_artifact: docs sync and portfolio commands
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-portfolio-docs-protocol-20261012
    depends_on: [build-upsert]
  - id: contract-work-pointer
    title: Add the authoritative work pointer and dispatch resolution
    status: done
    responsibility: agent
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
    responsibility: agent
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
    responsibility: agent
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
    responsibility: agent
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
    responsibility: agent
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
    responsibility: agent
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
```

### precise-criteria-build-probe-budget-20261012-r3

Proposal: `agentask_576f2e3e049c001c1c`
Preview fingerprint (historical evidence; refresh before apply): `e95778a7d8ffe77c9d8a3f9189286f560a9a8716b7e86fcd8926464623f740e0`

Target: `docs/plans/every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in.md`

```yaml
arcadia: v1
type: plan
slug: every-production-session-is-bounded-by-a-platform-token-ceiling-and-an-in
project: arcadia
status: active
milestone: Every production Session is bounded by a platform token ceiling and an in-Session environment probe, and every stop it raises clears from /todo in at most two clicks, proven by replays of recorded sessions and one validated ledger row per session.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-12
actions:
  - id: replay-environment-wall-session
    title: "Implement a fast-rehearsal scenario built from the 2026-10-12 00:40Z Session receipts (no diff, workspace write denied, sandbox test refusals) that must end refused or stopped before a fixed token bound, and make a missing report.json fail loudly."
    status: open
    responsibility: agent
    effort: session
    next_action: "Implement a fast-rehearsal scenario built from the 2026-10-12 00:40Z Session receipts (no diff, workspace write denied, sandbox test refusals) that must end refused or stopped before a fixed token bound, and make a missing report.json fail loudly."
    expected_artifact: Evidence satisfying Agent Ask replay-environment-wall-session
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Recorded failures are free failing tests; the first run cost 11.1M tokens and a missing report.json silently wasted ten minutes (living notes frictions 11, 17)."
    acceptance_criteria:
      - The scenario exists in the fast-rehearsal set, is deterministic and runs in under 30 seconds, and on a tree without the environment-wall stop it fails.
      - scripts/fast-rehearsal.mjs prints the report path and exits non-zero when report.json is missing or unparsable.
      - The scenario asserts exactly one named environment blocker, no second launch and a recorded per-attempt token record.
      - Focused tests for the scenario builder pass and pnpm fast-rehearsal passes.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: record-session-ledger
    title: Implement docs/reports/session-ledger.jsonl with a typed schema, a deterministic validator wired into CI, and backfilled rows for A12, A3, A5 and A6 so every session records cost, review findings, touches and frictions in one compact row.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement docs/reports/session-ledger.jsonl with a typed schema, a deterministic validator wired into CI, and backfilled rows for A12, A3, A5 and A6 so every session records cost, review findings, touches and frictions in one compact row.
    expected_artifact: Evidence satisfying Agent Ask record-session-ledger
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Spend and defect data today is estimated prose; one validated row per session makes the next hardening choice evidence-based and cheap to read."
    acceptance_criteria:
      - The schema requires session_id, role, model, effort, action_id, pr, tokens_in_uncached, tokens_in_cached, tokens_out, wall_min, attempts, review_rounds, blocking_findings, operator_touches, host_touches, frictions and outcome with a stop_reason.
      - The validator rejects a row with a missing or mistyped field and the CI job runs it on every pull request that touches the ledger.
      - The ledger has four backfilled rows for A12, A3, A5 and A6 taken from the living notes, and the living notes link to the ledger.
      - Focused validator tests pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: enforce-session-token-ceiling
    title: Implement a per-Session input-token ceiling in the production policy that ends the attempt and writes a budget_exhausted stop receipt with cached and uncached tokens recorded separately.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a per-Session input-token ceiling in the production policy that ends the attempt and writes a budget_exhausted stop receipt with cached and uncached tokens recorded separately.
    expected_artifact: Evidence satisfying Agent Ask enforce-session-token-ceiling
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Platform caps, not prompt discipline, must bound spend for every failure mode including ones nobody has seen; the capacity gate is off and a heavy-tier Action ran unmetered."
    acceptance_criteria:
      - The replay scenario stops at the ceiling and the stop receipt names budget_exhausted with the ceiling value and both token counts.
      - An attempt that hits the ceiling is not relaunched automatically and raises exactly one named blocker.
      - The ceiling has a per-tier default and cannot be disabled or raised from a prompt, brief or Action text.
      - Focused tests for the ceiling and the production tick pass and pnpm fast-rehearsal passes.
    depends_on: [replay-environment-wall-session]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: probe-environment-inside-session
    title: Implement a deterministic probe script that runs as the Session first step and ends the attempt with environment_wall when the Session sandbox cannot write the workspace database, run host validation or produce a preservation receipt.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a deterministic probe script that runs as the Session first step and ends the attempt with environment_wall when the Session sandbox cannot write the workspace database, run host validation or produce a preservation receipt.
    expected_artifact: Evidence satisfying Agent Ask probe-environment-inside-session
    clarification: clarified
    confidence: high
    source: Agent Ask precise-criteria-build-probe-budget-20261012-r3
    why: "Session sandbox writable roots cannot be read offline, so only a probe inside the Session is truthful; the ceiling keeps it cheap."
    acceptance_criteria:
      - Running tests/fast-rehearsal/session-probe-wall.test.ts with its 5,000 input-token fixture budget (cached plus uncached) refuses the fake provider's read-only workspace database with environment_wall and attaches the probe JSON to the reconcile receipt.
      - The host-worker side probe is no longer counted as evidence of Session capability.
      - A passing probe records its configured numeric input-token budget and cached and uncached usage whose sum is no greater than that budget; the session-probe-wall fixture records 1,800 input tokens within a 5,000 token budget, and a failing probe raises exactly one environment_wall blocker naming its remedy.
      - Focused tests and pnpm fast-rehearsal pass.
    depends_on: [enforce-session-token-ceiling]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: one-click-clear-every-blocker-kind
    title: Implement a blocker-kind remedy registry and /todo controls so every platform-raised stop clears in at most two clicks with no typing.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement a blocker-kind remedy registry and /todo controls so every platform-raised stop clears in at most two clicks with no typing.
    expected_artifact: Evidence satisfying Agent Ask one-click-clear-every-blocker-kind
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Every new blocker kind was born without a remote clear (frictions 12, 14); a build-failing enumeration prevents the pattern."
    acceptance_criteria:
      - An enumeration test fails when any emitted blocker kind has no registered remedy; environment_wall, budget_exhausted, scope_successor_held and scope_pointer_mismatch are registered.
      - Each registered clear is a button on /todo or /actions that resolves in at most two interactions and runs through the existing operator-script machinery without copy or paste.
      - reset-repair-budget is reachable from /todo for an environment_wall and budget_exhausted stop.
      - Focused todo and dashboard tests pass and the dashboard graph has no containerAuditTransport import.
    depends_on: [enforce-session-token-ceiling, probe-environment-inside-session]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: fix-docs-sync-lock-and-activation-order
    title: Implement activation so the activated Plan Actions are positioned inside the apply transaction and docs sync retries a transient database lock.
    status: open
    responsibility: agent
    effort: session
    next_action: Implement activation so the activated Plan Actions are positioned inside the apply transaction and docs sync retries a transient database lock.
    expected_artifact: Evidence satisfying Agent Ask fix-docs-sync-lock-and-activation-order
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Activation left four unpositioned Actions and a stale pointer that needed a manual arrange and an extra pull request (frictions 3, 14)."
    acceptance_criteria:
      - A test reproduces the post-activation SQLite lock and afterwards advance queue reports orderValid true with unpositionedCount 0.
      - Other Projects relative queue order is unchanged by an activation.
      - A queue reorder stages the matching pointer change in the same settlement so current_action does not stay on a moved Action.
      - Focused settlement and queue tests pass.
    depends_on: []
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
  - id: revise-agent-roles-and-session-briefs
    title: Record the revised agent roles and a compact session brief template in the governed guidance so Lead sessions start from a generated brief and every role leaves one ledger row.
    status: open
    responsibility: agent
    effort: session
    next_action: Record the revised agent roles and a compact session brief template in the governed guidance so Lead sessions start from a generated brief and every role leaves one ledger row.
    expected_artifact: Evidence satisfying Agent Ask revise-agent-roles-and-session-briefs
    clarification: clarified
    confidence: high
    source: Agent Ask plan-autonomous-production-hardening-2026-10-12
    why: "Reviewers produced the best defect yield and Lead sessions grew large; roles and briefs should be recorded where agents retrieve them."
    acceptance_criteria:
      - docs/agent-guidance records Lead as one Action per session, Driver on standard tier returning only diff, test command and exit code, Reviewer as one fresh role replacing Critic, a deterministic Replayer script role, and the live Observer deferred with its revisit trigger.
      - "A brief template names file:line ranges, focused test files, the adversarial strings for any guard or validator Action, and forbids repeating sandbox text in hand-backs."
      - The model and effort per role are stated with the cost reasoning and the guidance index routes to the new section.
      - The documentation budget check and docs link check pass.
    depends_on: [record-session-ledger]
    decisions: []
    references: ["https://github.com/pmark/arcadia/issues/1284", "docs/reports/production-simulation-living-notes.md"]
questions: []
decisions: []
current_action: replay-environment-wall-session
recommended_model: gpt-5.6-terra
recommended_reasoning_effort: medium
```

## Validation boundary

All three settlement previews return applied:false. Their proposed Plan outputs are applied only to a disposable filesystem snapshot for deterministic validation. Ask archival outputs are receipt metadata, not control documents, and are excluded from that snapshot. This is not a replacement live workspace or database.
