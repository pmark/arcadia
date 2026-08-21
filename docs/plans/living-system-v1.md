---
arcadia: v1
type: plan
slug: living-system-v1
project: arcadia
status: active
milestone: Every managed software Project can reveal what it is, what is changing, how it got here, and what proves that story through one free living-system navigator
current_action: derive-living-system-state
token_impact: xlarge
token_budget: "Routine parsing, derivation, projection, link validation, and refresh make zero model calls. Use one bounded coding-agent implementation pass per Action, deterministic tests before model-based diagnosis, and operator attention only for final usability judgment and governed external effects."
recommended_model: gpt-5.6-sol
recommended_reasoning_effort: high
updated: 2026-08-21
actions:
  - id: define-living-system-v1-contract
    title: Define the shared contract for capability maps and Action timelines
    status: done
    responsibility: codex
    effort: session
    next_action: Implement and document the versioned `docs/living-system.yaml` parser and normalized contract for Project-defined Topics, Relationships, and Views plus derived Episode and Signal records.
    expected_artifact: A tested living-system v1 contract that gives every Arcadia-managed Project one safe, extensible source for structural meaning and one stable target model for authoritative change history
    clarification: clarified
    confidence: high
    source: Operator refinement and Decision 0032 on 2026-08-21
    acceptance_criteria:
      - "A Project can declare `docs/living-system.yaml` with `arcadia_living_system: v1`, its stable Project slug, a concise purpose, Project-defined Topics, Relationships, and Views; Pages, Models, Workflows, and Persistence are possible Topics or Views, never required categories."
      - "Every Topic has a stable id, title, `why`, `use_when`, concise summary, and one or more repository-relative source paths; every Relationship has `from`, `to`, and a Project-defined type; every View has a stable id, title, purpose, selectors, and deterministic order."
      - "Validation rejects unsupported versions, duplicate ids, missing values, dangling references, ambiguous selectors, missing sources, absolute paths, traversal, symlink escape, and Project-slug mismatch while permitting additive Topic and relationship vocabulary without code changes."
      - "The normalized target types define Episodes, Signals, source and freshness receipts, and impact provenance without permitting `docs/living-system.yaml` to duplicate operational status or history."
      - "The Mission Log convention accepts an optional explicit `Action: plan-slug#action-id` reference with a validated plan and Action id; absent links remain representable as unlinked rather than inferred."
      - "Unchanged inputs produce byte-stable normalized data with zero model calls, and fixtures representing both Arcadia and Private Practice Now prove extensibility, deterministic ordering, optional fields, and every refusal class."
    decisions: ["0031", "0032"]
    references:
      - docs/decisions/0032-living-system-v1.md
      - docs/managed-documents.md
      - src/docs/parse.ts
      - src/memory/obsidian.ts
      - src/projects/contextSetup.ts
      - docs/living-system-contract.md
    depends_on: []
  - id: derive-living-system-state
    title: Derive trustworthy Episodes, Signals, and Topic impact from Arcadia truth
    status: open
    responsibility: codex
    effort: session
    next_action: Assemble the normalized living-system model from the Project manifest, managed plans and pointer, Action-linked Mission Log entries, Decisions, Runs, Artifacts, pull-request and Git receipts, and validation evidence without guessing missing history.
    expected_artifact: A deterministic source adapter and impact resolver that explains current and previous Actions, affected Topics, evidence, freshness, and gaps with explicit provenance
    clarification: clarified
    confidence: high
    source: Operator refinement and Decision 0032 on 2026-08-21
    acceptance_criteria:
      - "Episodes are derived from Milestones and Actions, retain dependency and `next_action` continuation links, attach only explicitly Action-linked Mission Log entries, and preserve unmatched entries in a visible unlinked-history collection."
      - "Signals are derived from the current pointer, Decisions, Runs, Artifacts, pull requests, Git revisions, and validation evidence when those sources exist; each carries its authoritative source, observed time or explicit absence, freshness, and uncertainty."
      - "Action references matching Topic sources are labelled `declared`, changed files matching Topic sources are `observed`, one-hop effects through declared Relationships are `downstream`, and unsupported Actions are `unmapped`; no semantic or historical link is guessed."
      - "The current Action and its affected Topics are directly addressable, historical Actions remain ordered by explicit dates and plan structure without fabricating timestamps, and contradictory sources remain visible rather than being silently reconciled."
      - "Derivation is deterministic, byte-stable for unchanged inputs, makes zero model calls, tolerates legitimately absent operational sources, and fails legibly on malformed authoritative records."
      - "Focused Arcadia and Private Practice Now fixtures prove current work, prior work, Action continuation, declared and observed impact, downstream impact, unmapped Actions, unlinked Logs, missing evidence, stale evidence, and conflicting evidence."
    decisions: ["0031", "0032"]
    references:
      - docs/decisions/0032-living-system-v1.md
      - docs/managed-documents.md
      - src/docs/dispatch.ts
      - src/db/repositories.ts
      - src/domain/types.ts
    depends_on: [define-living-system-v1-contract]
  - id: build-living-system-map-and-timeline
    title: Project equal capability-map and Action-timeline views into Obsidian
    status: open
    responsibility: codex
    effort: session
    next_action: Build the atomic idempotent projector for Home, capability maps, Project-defined submaps, the Project evolution timeline, Current Work, Topic and Action episode notes, and a side-by-side Obsidian Canvas under `Projects/<project-slug>/`.
    expected_artifact: A reusable zero-model projector whose linked map and timeline make current structure, current work, causal history, proof, and gaps navigable at progressively deeper attention levels
    clarification: clarified
    confidence: high
    source: Operator refinement and Decision 0032 on 2026-08-21
    acceptance_criteria:
      - "The projector writes only beneath the configured vault's `Projects/<project-slug>/` subtree and never changes `Arcadia/Records/`, `Arcadia/Ideas/`, or `.obsidian/`."
      - "Output includes `Home.md`, `Maps/00_Capability_Map.md`, one map per declared View, `Timeline/00_Project_Evolution.md`, `Timeline/Current_Work.md`, one stable note per Topic and Action episode, a generated README, and `Living_System.canvas` with the capability map and timeline arranged side by side."
      - "Home answers Project purpose, current focus, recent change, evidence freshness, and where to go next; it links directly to the current Action and every deterministically affected Topic."
      - "Every Topic links to its relevant Action episodes, and every episode links back to affected Topics while answering why the Action existed, what changed, what proves it, which Decisions mattered, and what came next."
      - "Headings and lists render as useful Markmap trees; WikiLinks, transclusions, and portable source links remain useful in ordinary Obsidian Reading View or a plain Markdown reader; plugin-specific frontmatter uses only options supported by the pinned viewer."
      - "Every status and impact claim displays source, freshness, and provenance; declared, observed, downstream, unmapped, stale, missing, and unlinked states are visibly distinct, and unknown data is never presented as fact."
      - "Writes are atomic and idempotent, refuse unmarked or foreign-owned files, update changed generated files, and report removed content as stale without deletion; tests prove containment, symlink safety, byte-stable reruns, collision refusal, valid Canvas JSON, resolvable links, and isolation between at least two Projects."
    decisions: ["0031", "0032"]
    references:
      - docs/decisions/0032-living-system-v1.md
      - src/memory/obsidian.ts
      - src/workspace/config.ts
      - tests/obsidian-memory.test.ts
    depends_on: [derive-living-system-state]
  - id: integrate-living-system-sync
    title: Make free living-system refresh part of normal Arcadia operation
    status: open
    responsibility: codex
    effort: session
    next_action: Add `arcadia memory system sync` for one Project or all eligible Projects with preview-by-default output, explicit apply, JSON receipts, independent failures, and a non-blocking refresh hook after accepted Action transitions when vault sync is enabled.
    expected_artifact: A documented operator and automation path that creates and updates any managed Project's living-system documentation with zero model calls and no paid Arcadia dependency
    clarification: clarified
    confidence: high
    source: Operator refinement and Decision 0032 on 2026-08-21
    acceptance_criteria:
      - "`arcadia memory system sync (--project <project> | --all) [--apply] [--json]` resolves each configured Project repository and the workspace Obsidian vault without requiring a model, network service, or paid Arcadia feature."
      - "Without `--apply`, the command reports every create, update, unchanged, stale, skipped, and refused result without writing; apply performs exactly the previewed in-scope projection."
      - "`--all` processes eligible active Projects independently; a missing repository, vault, or manifest produces an actionable skip or failure without preventing valid Projects from syncing and without assigning guessed Topics."
      - "Machine output uses Arcadia's standard JSON envelope; unchanged inputs do not rewrite files; generated output includes source hashes and refresh time; and all routine create and update paths make zero model calls."
      - "After an accepted Action state transition, Arcadia attempts a refresh only when vault synchronization is configured and enabled; refresh failure is a visible non-blocking warning that cannot roll back or falsify the authoritative transition."
      - "`START_HERE.md`, `docs/COMMANDS.md`, and the generated README explain authority, manifest setup, Action-linked Mission Log entries, preview/apply behavior, Markmap panes, transclusions, Canvas split view, freshness, rollback, and the no-plugin fallback."
    decisions: ["0031", "0032"]
    references:
      - docs/decisions/0032-living-system-v1.md
      - src/commands/memory.ts
      - src/cli.ts
      - src/cli/response.ts
      - START_HERE.md
      - docs/COMMANDS.md
    depends_on: [build-living-system-map-and-timeline]
  - id: dogfood-living-system-v1
    title: Prove the living-system v1 on Arcadia and Private Practice Now
    status: open
    responsibility: codex
    effort: project
    next_action: Add governed manifests for Arcadia and Private Practice Now, generate both living-system projections, verify the linked capability and history journeys in Obsidian and plain Markdown, record discovered gaps, and complete QA before restoring the displaced pointer.
    expected_artifact: Two genuinely useful living-system navigators, evidence for every v1 usability and trust criterion, a bounded post-v1 gap list with triggers, and a QA-reviewed handoff back to idea-to-managed-build
    clarification: clarified
    confidence: high
    source: Operator refinement and Decision 0032 on 2026-08-21
    acceptance_criteria:
      - "Arcadia's manifest explains capture, clarification, prioritization, planning, coding-agent build, QA and proof, delivery, and persistent memory; its timeline makes priority insertions, continuations, pauses, and resumptions legible without rewriting history."
      - "Private Practice Now's manifest explains practitioner interview, structured evidence, normalized profile, authentic section copy, human acceptance, site assembly, client repository, staging proof, inquiry delivery, and launch; its projection exposes missing or weak links rather than hiding them."
      - "Private Practice Now's repository is edited only through its own governed pointer or an explicit approved cross-Project Action, and each repository retains authority for its manifest."
      - "Mindmap NextGen 1.16.0 is verified or installed once in the configured Arcadia1 vault with prior `.obsidian` configuration preserved for rollback; routine synchronization never installs or upgrades executable plugin code."
      - "For both Projects, preview and apply agree; generated links, transclusions, source references, frontmatter, and Canvas JSON validate; capability map and timeline navigate both directions; Home reaches the current Action and its affected Topics in one click; and the Markdown remains usable with the plugin disabled."
      - "Operator QA confirms that a fresh reader can understand purpose and current focus in about ten seconds, reach a major capability in one click, follow map-to-timeline and timeline-to-map links, understand the primary journey in about two minutes, and audit every status claim's provenance and freshness."
      - "Relevant focused tests, the full test suite, and builds pass; the pull request carries the required operator-facing QA plan and independent Arcadia PR-QA evidence; routine projection invokes no model and no paid service."
      - "Observed misses are recorded with Decision 0032's explicit triggers rather than implemented speculatively; no custom plugin, AI history inference, watcher, snapshot playback, universal ontology, or unbounded impact analysis enters v1."
      - "On accepted completion, this plan has no `current_action`; `PROJECT.md` restores `active_plan: idea-to-managed-build` and its milestone; `idea-to-managed-build` restores `current_action: promote-accepted-plan`; and the Mission Log records the exact proof and resumption."
    decisions: ["0031", "0032"]
    references:
      - docs/decisions/0032-living-system-v1.md
      - docs/AGENT_ORIENTATION.md
      - docs/operator-demo-and-release-contract.md
      - docs/plans/idea-to-managed-build.md
      - src/memory/obsidian.ts
    depends_on: [integrate-living-system-sync]
questions: []
decisions: ["0031", "0032"]
---

# Living system v1

## Outcome

An Arcadia-managed Project gains a highly accessible representation of its
living system without asking a person to begin with lengthy documentation. The
capability map explains the current system; the Action timeline explains how
and why it changed. Both lead back to authoritative source and proof.

## The vital few

V1 ships only five dependency-ordered pieces:

1. an extensible repository contract for Project meaning;
2. deterministic derivation of living state and impact provenance;
3. equal, cross-linked map and timeline projections with progressive detail;
4. a free preview/apply sync path plus safe accepted-Action refresh; and
5. real Arcadia and Private Practice Now dogfood with operator usability QA.

That slice makes the idea useful at session start, review, handoff, and
historical orientation. Decision 0032 names the measured-use triggers for the
expensive tail and keeps it out of v1.

## Interaction contract

Home answers purpose, current focus, recent change, evidence freshness, and the
next useful destination. A person can reach a major capability, the current
Action, or a Topic affected by current work in one click. Topic notes link to
their Action history. Episode notes link back to affected Topics and explain
why, change, proof, Decisions, and continuation. Canvas presents map and
timeline side by side; Markdown, WikiLinks, transclusions, and source links
remain the durable fallback.

Progressive disclosure supports four attention levels: glance, orient,
understand, and audit. Exhaustive coverage is less important than a truthful
and legible primary journey.

## Truth and cost contract

The repository manifest owns durable meaning. Managed documents and operational
records own current and historical state. Projection is deterministic, labels
provenance and freshness, preserves contradictions and gaps, and never guesses
history. Every routine create or refresh path makes zero model calls and uses no
paid Arcadia dependency.

## First proof Projects

Arcadia proves its capture-to-delivery loop and the priority changes that have
shaped it. Private Practice Now proves its practitioner-interview-to-launched-
site journey. Their different vocabulary is the test that Topics and Views are
truly Project-defined rather than a renamed fixed software taxonomy.

## Sequencing and exit

This dedicated plan supersedes the temporary placement of the work inside
`demo-first-delivery`; it does not supersede that plan or
`idea-to-managed-build`. On accepted v1 dogfood, the sole pointer returns to
`idea-to-managed-build/promote-accepted-plan` and restores that plan's milestone
exactly as Decisions 0031 and 0032 require.
