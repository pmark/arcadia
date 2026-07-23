# Arcadia Semantics

This document is Arcadia's canonical semantic contract. It defines the durable vocabulary used by humans, coding agents, CLI output, Dashboard labels, APIs, database models, documentation, prompts, reports, and logs.

Arcadia exists to maintain momentum across creative projects with minimal cognitive overhead. Its language should stay small, stable, and operational.

## Core Rule

Use canonical terms for user-facing concepts.

Do not introduce a new primary term when one of these terms already fits:

- Domain
- Project
- Mission
- Outcome
- Milestone
- Action
- Artifact
- Decision
- Log

Implementation names may preserve legacy terms when compatibility requires it, but user-facing language should converge on the canonical vocabulary.

## Concept Model

```text
Domain
  Project
    Mission
    Outcome
      Milestone
        Action
          Artifact
          Decision
    Log
```

A Domain groups Projects. A Project has a Mission and pursues Outcomes. Outcomes are advanced through Milestones. Milestones are advanced through Actions. Actions produce Artifacts, may require Decisions, and leave durable history in the Log.

## Canonical Concepts

### Domain

A broad area of life or work that contains Projects.

Examples: Products, Home, Health, Music, Writing, Consulting.

Use Domain when Arcadia needs a stable grouping above Project. Do not use Domain for a repository, folder, tag, queue, or execution context unless it represents a durable area of responsibility.

### Project

A durable container for a meaningful endeavor.

Examples: Arcadia, MIDI Opener, Rebuster, Basement Reset, Cardio Rebuild.

A Project may have metadata such as aliases, repository path, status summary, and validation commands. Those properties support routing and execution, but they are not separate semantic concepts.

### Mission

The enduring reason a Project exists.

Mission answers why the Project matters. It should remain more stable than a Milestone or Action.

Example: "Help Mark maintain momentum across creative projects with minimal cognitive overhead."

### Outcome

A concrete desired change in reality.

Outcome is the canonical replacement for Goal. Use Outcome for the durable desired result a Project is trying to create. Do not use Outcome for a single task, command, run, or generated file.

Example: "Arcadia can safely route daily project requests without requiring manual triage."

### Milestone

A meaningful checkpoint toward an Outcome.

Milestones mark progress. They are larger than Actions and smaller than Outcomes.

Example: "Natural-language request routing is deterministic and covered by regression tests."

### Action

The smallest meaningful unit of intentional work.

Action is the canonical replacement for Work Item. "Next Action" is a view or field that identifies the most important available Action; it is not a separate durable object.

Examples:

- "Run the smoke test."
- "Draft the release notes."
- "Create the Dashboard snapshot endpoint."

### Artifact

Durable evidence or output of work.

Examples: Markdown file, PR, generated report, SQLite migration plan, quote, recording, receipt, photo, test output, prompt packet.

Use Artifact for both human-facing outputs and execution inputs when they are persisted and referable.

### Decision

A point requiring human judgment.

Decision is the canonical replacement for Review when the user-facing concept is judgment, approval, rejection, deferral, or clarification. Existing "Requires Review" language is acceptable as a transitional label for items waiting on a Decision.

Examples:

- "Approve this execution plan."
- "Choose whether to publish the draft."
- "Confirm which project the request belongs to."

### Log

The durable history of a Project.

Log is the canonical replacement for Mission Log unless the longer phrase is intentionally retained as product flavor. A Log records what happened, why it mattered, blockers, next Action, and Artifact impact.

## Supporting Properties

### Status

Status describes the lifecycle state of a concept.

Durable Project statuses:

- Active
- Paused
- Incubating
- Completed

Other implementation statuses may exist for Actions, Artifacts, runs, queues, and Decisions, but they should remain subordinate to the object they describe.

### Responsibility

Responsibility describes who or what can advance an Action.

Canonical values:

- Autonomous
- Codex
- Requires Review
- Blocked

Responsibility replaces user-facing "Classification" when the value answers who can do the work. Existing internal `work_classification` fields may remain as compatibility names until a deliberate migration.

### Validation

Validation describes checks or criteria that prove work is acceptable.

Validation is a supporting property, not a top-level Arcadia object. Use "validation criteria", "validation commands", or "validation checks" when precision matters.

## Demoted And Legacy Terms

| Existing term | Canonical use | Guidance |
| --- | --- | --- |
| Goal | Outcome | Rename user-facing project goals to Outcome over time. Preserve Codex "goal" when referring to Codex's own product model. |
| Work Item | Action | Rename user-facing work records to Action. Keep `work_items` internally until schema/API migration is planned. |
| Next Action | Action view | Use only for the selected next Action, not as a separate object. |
| Review | Decision | Use Decision for judgment. "Requires Review" may remain as a transitional status/view. |
| Review Item | Decision | Rename user-facing records to Decision when migration is scheduled. |
| Mission Log | Log | Prefer Log unless retaining "Mission Log" as intentional product flavor. |
| Planning Packet | Artifact (plan) | Treat as an Artifact with planning purpose. |
| Work Packet | Artifact or execution input | Avoid making this a primary concept. |
| Packet | Artifact | Use only as a low-level implementation/detail word. |
| Back Burner | Incubating status/view | Keep as a view name only if desired; the semantic state is Incubating. |
| Classification | Responsibility | Use Responsibility when values are Autonomous, Codex, Requires Review, or Blocked. |
| Execution | Workflow or Run | Use Run for a concrete execution instance; Workflow for a process. |
| Stewardship | Routing/governance behavior | Keep for internal AI/request-routing behavior, not as a primary user object. |

## Relationships And Examples

Example project:

```text
Domain: Products
Project: Arcadia
Mission: Maintain momentum across creative projects with minimal cognitive overhead.
Outcome: Daily requests route safely into the right project flow.
Milestone: Deterministic natural-language routing is covered by tests.
Action: Add a golden request for ambiguous project updates.
Artifact: docs/reports/golden-request-suite.md
Decision: Confirm whether vague requests should become Incubating or require review.
Log: mission_logs/2026/06/...
Responsibility: Codex
Validation: pnpm test
```

## Terminology Rules

- Use canonical terms in new UI labels, CLI text, docs, prompts, and reports.
- Do not rename persisted schema fields, CLI commands, API response fields, or test fixtures opportunistically.
- Preserve legacy aliases at system boundaries until a versioned migration exists.
- Prefer "Action" when the object is work to be done.
- Prefer "Decision" when the object is a pending judgment.
- Prefer "Outcome" when the object is a desired result.
- Prefer "Log" when the object is durable history.
- Use "Run" for a concrete execution attempt.
- Use "Validation" only as criteria, commands, checks, or evidence.
- Use "Back Burner" only as a view label if the product wants that flavor; the underlying status is Incubating.
- Preserve external product terms when referring to an external system, such as Codex goals.

## Implementation Guidance

Arcadia may temporarily contain legacy implementation names:

- `projects.goal`
- `work_items`
- `work_classification`
- `review_items`
- `mission_logs`
- `prompt_packet_path`
- `execution_runs`
- `back_burner_items`

These names should be treated as compatibility names. Do not add new user-facing surfaces that make them more entrenched.

When migration work is scheduled, prefer additive and compatibility-preserving changes:

- Add canonical aliases before removing legacy fields.
- Keep old CLI flags working while documenting canonical flags.
- Emit both legacy and canonical JSON fields only when consumers need a transition window.
- Separate database migrations from UI copy changes.
- Keep tests explicit about legacy compatibility.

## Agent Guidance

Before changing user-facing terminology, data models, CLI commands, Dashboard labels, prompts, API responses, or documentation, read this file.

When auditing or editing Arcadia:

- Identify the current Milestone.
- Identify the next Action.
- Identify the work Responsibility.
- Identify required Artifacts.
- Preserve existing behavior unless the task explicitly asks for migration.
- Flag ambiguous terminology instead of guessing.
- Use this document as the source of truth for naming.

