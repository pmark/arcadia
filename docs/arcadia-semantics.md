# Arcadia Semantics

This document is Arcadia's canonical semantic contract. It defines the durable vocabulary used by humans, coding agents, CLI output, Dashboard labels, APIs, database models, documentation, prompts, reports, and logs.

Arcadia exists to maintain momentum across creative projects with minimal cognitive overhead. Its language should stay small, stable, and operational.

## Core Rule

Arcadia is a public, open-source project. Refer to the person using it as
"the operator" and use "Needs operator" for personal-attention labels. Never
name a specific person in product copy, generated instructions, or generic
examples. Preserve legacy identifiers only where compatibility requires them.

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

Example: "Help the operator maintain momentum across creative projects with minimal cognitive overhead."

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

### Behavior

A **Behavior** is a named procedural contract followed by an existing eligible
Role within its assigned authority. It states when the procedure applies, its
scope and duties, required evidence or Artifacts, finite allowance and deadline,
and stop or escalation conditions.

Role determines responsibility, lineage and eligibility. Behavior describes how
the assigned work is carried out. A **mode** is the active operating state while
a Behavior is being followed; **acts as** may describe composition in prose, but
is not the canonical noun for this concept.

For example, supervision is a Behavior carried by a Supervisor's assigned
relationship and duties (Decisions 0113 and 0121). Hacker recovery is a Behavior
followed in recovery mode: the assigned Lead diagnoses and the authorized
implementer repairs. Neither example creates an eighth registered role.

Compatible Behaviors may apply together, but none overrides authority, custody,
the sole-writer rule or a tighter existing bound. A Behavior grants no identity,
permission, delegation, model binding, additional budget or runtime admission.
It is a supporting execution concept, not a new primary work object or registry
entry. Defining source guidance proves neither installed adoption nor automatic
invocation; schema and runtime changes require their own justified work.

Use **Behavior** as the umbrella term, **mode** for an active state, and **acts
as** only as descriptive phrasing.

### Roles, specializations and optional names

Arcadia presents a small set of named **identity profiles** to people. Each
profile has a stable functional purpose and maps to existing registered Roles,
skills and Behaviors. People can address the name or the function; they need
not learn internal role IDs. Rowan is the normal point of contact, answers
questions by finding the relevant evidence, and coordinates action with the
existing owners.

| Identity profile | Purpose and handoff | Assigned Role and reusable methods |
| --- | --- | --- |
| **Rowan — Coordinator** | Establish what matters, who owns it, what is blocked and the next permitted move; integrate delivery evidence for the operator. | `lead`; [release management](../.agents/skills/arcadia-release-manager/SKILL.md) and [supervision](../.agents/skills/arcadia-supervisor/SKILL.md) when assigned. |
| **Mira — Investigator** | Explain a failure using evidence and competing causes; give the owner the smallest testable correction and remaining uncertainty. | `researcher`; [release investigation](../.agents/skills/arcadia-release-investigator/SKILL.md), including causal and protocol analysis. |
| **Ellis — Engineer** | Design a bounded correction or build it; return a design with proof obligations, or a candidate with regression evidence. | `planner` **or** `implementer`, explicitly bound per assignment; [planning](planning-process.md), architecture analysis when needed, and [implementation guardrails](../.agents/skills/arcadia-guardrail/SKILL.md). |
| **Nadia — Critic** | Challenge assumptions, expose missing evidence and test whether a proposed plan achieves its Outcome. | `plan-critic`; independent plan critique and [Process Critic](../.agents/skills/arcadia-process-critic/SKILL.md) when its triggers apply. |
| **Sage — Reviewer** | Examine the exact candidate for defects and return actionable findings with locations and failure cases. | `code-reviewer`; [independent PR review](agent-guidance/pull-requests.md). |
| **Quinn — Verifier** | Verify acceptance against observed behavior, including relevant interruption and recovery cases; report what is proved and missing. | `qa`; the assignment's indexed acceptance and [PR QA procedure](agent-guidance/pull-requests.md). |

The assigned Lead is accountable for turning the bounded acceptance gap into a
reviewed candidate with exact-revision evidence, or returning the precise
unresolved gate; the implementer owns source changes. Rowan preserves existing
Project custody and approval boundaries. Mira returns evidence to that owner;
Ellis returns technical work; Nadia, Sage and Quinn return their distinct
independent judgments. Use only the responsibilities the work requires: this
is not a mandatory six-stage pipeline or six continuously running agents.

Keep the seven registered Roles in `config/defaults/agent-roles.json` as the
responsibility and eligibility contract. A **specialization** narrows the domain
or method of an assignment; a reusable procedural method is a Behavior. These
compose within the assigned Role, rather than creating a role for every skill.
Choose only methods needed for the concrete uncertainty or acceptance gap.
Ellis's architecture specialization does not create an Architect role or make
planning authority to implement. A change of assignment follows existing
ownership rules; no identity may claim independence from its own work.

Agent collaboration names the identity profile and task for readability, plus
the registered role ID, specialization or Behavior source (and revision when
relevant), inputs, expected output, ownership, independence, finite allowance
and stopping condition in the existing brief. No new envelope, registry or
mandatory stage is needed. Compatible methods share the assignment's allowance;
composition does not multiply budgets. Resolve conflicting methods or
independence requirements before the affected step.

Names are optional handles for these documented profiles, not executor
identities. They never select a provider, prove expertise, authenticate a sender,
establish independence or authorize dispatch. Commits, comments and receipts
retain the actual resolved provider/tier identity and Session or attempt lineage.
Several Sessions may use the same profile: distinguish them by name, task and
Session reference. Continuity comes from retained evidence, not shared memory
or a uniquely persistent named actor.

This contract is usable by agents that retrieve it. It adds no CLI name aliases,
automatic routing, scheduler, installed adoption or new runtime capability.
Functional requests remain supported. See
[roles and briefs](agent-guidance/session-roles-and-briefs.md) for translating a
named request into an existing bounded assignment.

### Red Alert

A managed-production failure that meets the Stop the line test in `AGENTS.md`:
it blocks work unrelated to itself, its only workaround is one a person has to
remember, or it blocks its own repair. A Red Alert is a supporting property of
managed production, not a top-level Arcadia object and not work state: it is a
signal with evidence, raised by the worker tick with no model call.

Triggers (each is detected deterministically; the list is closed):

- `admission_refused_consecutive`: an Action's admission is refused on
  consecutive ticks, past a minimum tick count and a minimum duration.
- `session_stalled`: a live Session is past its stall window (no pane output
  and no Run/receipt activity for the stalled-session deadline).
- `reconcile_failed`: reconciling a Session's exit throws.
- `repair_budget_repeat`: the same launch failure has repeated until the
  Action's repair budget is exhausted.

One Red Alert exists per distinct failure. It records the Project, Action,
Session id, trigger, first-seen time, and an evidence path; a repeat of the
same failure updates the alert instead of creating another, and an alert
clears when the failure resolves. Each new alert posts once to the configured
notification channel, and `arcadia production status` lists open Red Alerts
before every other section.

Detection makes no model call. An optional, workspace-flagged diagnosis
(`redAlertDiagnosis.enabled`, off by default) runs at most once per alert
episode, within a declared token budget, through the Intelligence service only:
it files or updates one bug Issue, drafts (never settles) a fix Action Ask, and
records its outcome (`proposed`, `needs_operator`, `budget_exceeded`,
`no_cause`, `failed`), route and budget on the alert. It never retries, edits
code, or merges, and a fix touching the concurrency gate, admission policy,
approval boundaries or credentials is `needs_operator`.

### Grant

A **Grant** is a one-shot operator action that delegates bounded authority to
Arcadia. It is not a standing permission, a production state, or a Session
launch: the operator presses the specific action, and only its declared scope
may change.

Every Grant pins the policy revision it was built against, names the exact
scope it covers, carries an expiry, refuses before mutation when any
precondition has drifted, and records a durable receipt. A Grant also states
plainly what it never does. A descriptor identifies one with optional
`kind: "grant"`; descriptors that omit `kind` remain ordinary operator actions
for compatibility.

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
- Agent
- Requires Review
- Blocked

Responsibility replaces user-facing "Classification" when the value answers who can do the work. Existing internal `work_classification` fields may remain as compatibility names until a deliberate migration.

### Validation

Validation describes checks or criteria that prove work is acceptable.

Validation is a supporting property, not a top-level Arcadia object. Use "validation criteria", "validation commands", or "validation checks" when precision matters.

### Token Impact

Token Impact is a supporting planning property describing relative LLM-token
exposure: None, Small, Medium, Large, or Extra Large. It is not an exact token
forecast, a dollar quote, an effort estimate, or a new top-level Arcadia
concept. A plan also states its Token Budget in plain language: which steps
invoke a model, which remain deterministic, and how repeated model use is
bounded.

Deterministic builds, tests, health checks, browser navigation, and screenshot
capture have no LLM Token Impact by themselves. Interpreting screenshots,
judging subjective criteria, summarizing results, writing code, and diagnosing
failures may have Token Impact.

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
| Classification | Responsibility | Use Responsibility when values are Autonomous, Agent, Requires Review, or Blocked. |
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
Responsibility: Agent
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
- Use "Session" only for one bounded coding-agent dispatch. A Session is a thin
  operational pointer to its governed Action, immutable packet, agent-native
  session id, and optional terminal transport; it is not a transcript or a
  claim that the Action completed.
- Use "Token Impact" for relative LLM-token exposure and keep it distinct from compute time and Action effort.
- Use "Validation" only as criteria, commands, checks, or evidence.
- Use "Back Burner" only as a view label if the product wants that flavor; the underlying status is Incubating.
- Preserve external product terms when referring to an external system, such as Codex goals.

## Command Naming

These rules were developed in Private Practice Now and adopted for every
repository on the Arcadia Way by Decision 0021. They bind new commands.

**Nouns for looking, verbs for acting.** The part of speech carries the
authority boundary, so it can be felt before it is read. A noun command
(`arcadia next`, `arcadia portfolio`, `arcadia queue`) reads state and never
mutates. A verb command (`arcadia advance`, `arcadia sync`) may mutate, and
only within declared authority. Do not name a mutating command with a noun; the
reader will trust it not to change anything.

**Use the word someone already reached for.** A command is named after what the
operator called the job in conversation, not after its implementation. When a
job recurs without a name, that is a defect in the vocabulary, not in the
operator.

**Aliases are first-class, not sugar.** A capability carries the phrases people
actually say for it. Populating them is part of shipping the command.

**Say the next step in the operator's words.** A command that ends without
telling the operator what to do next has offloaded its last step onto them.

## Implementation Guidance

Arcadia may temporarily contain legacy implementation names:

- `projects.goal`
- `work_items`
- `work_classification`
- `review_items`
- `mission_logs`
- `prompt_packet_path`
- `execution_runs`
- `agent_sessions`
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
