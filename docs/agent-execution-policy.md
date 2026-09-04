# Agent Execution Policy

Arcadia declares what an Action requires without naming a vendor model.
Provider-specific model identifiers and CLI arguments live only in replaceable
provider-adapter mappings.

The machine schema is
[`schemas/arcadia-execution-profile-v1.schema.json`](../schemas/arcadia-execution-profile-v1.schema.json).
The runtime contract and named-profile expansion live in
`src/execution/profiles.ts`. The bundled operational mappings live in
`config/defaults/provider-adapters.json`.

## Independent properties

- **Capability** describes the minimum class of problems the model must handle.
- **Reasoning effort** describes how deeply it must analyze this Action or phase.
- **Confidence** describes trust in the Action's clarification or result.
- **Responsibility and approval gates** describe authority.

A stronger model never grants permission to deploy, publish, merge, delete,
spend money, use credentials, access production data, send messages, or decide
an operator-reserved product question.

## Capability

| Tier | Includes | Excludes |
| --- | --- | --- |
| `c1_bounded` | Explicit, localized, reversible work with deterministic validation | Cross-package contracts, architecture, sensitive data, ambiguous requirements |
| `c2_integrated` | Routine implementation across related files using established patterns and clear tests | New architecture, independently deployed systems, difficult verification, security/privacy decisions |
| `c3_systems` | Public or persisted contracts, cross-package/system design, substantial context synthesis, or difficult-to-localize failures | Material sensitive-data, credential, financial, production, or irreversible risk |
| `c4_critical` | Security, privacy, credentials, production data, financial behavior, or destructive and hard-to-reverse changes | Operator authority; the tier supplies capability, not permission |

Mandatory runtime escalation:

- Public/persisted contracts, independently deployed systems, cross-repository
  changes, or difficult verification require at least `c3_systems/e3_deep`.
- Security boundaries, privacy-sensitive data, credentials, production data,
  financial actions, or destructive/irreversible changes require at least
  `c4_critical/e4_rigorous`, local-only data handling, serial execution, and
  independent review.

## Reasoning effort

| Level | Required behavior |
| --- | --- |
| `e1_brief` | Follow an explicit path and perform direct checks |
| `e2_standard` | Inspect relevant context, test assumptions, implement, and verify |
| `e3_deep` | Compare alternatives, trace dependencies, and examine failure modes |
| `e4_rigorous` | Challenge assumptions and produce evidence-backed high-assurance analysis |

Capability is a minimum, not a prediction that every Action at that tier will
be hard. Effort is also a minimum. Arcadia does not put a preferred tier in an
Action: provider-adapter ordering expresses operational preference, and the
selector chooses the least costly compliant binding. This prevents an
authoritative plan from becoming stale when provider pricing or product names
change.

The tier boundary is determined by observable characteristics:

| Characteristic | Minimum |
| --- | --- |
| One local, reversible edit; exact instructions; direct check | `c1_bounded/e1_brief` |
| Related files; established pattern; clear automated checks | `c2_integrated/e2_standard` |
| Public/persisted contract, cross-package or cross-repository behavior, independently deployed systems, long-context synthesis, or difficult verification | `c3_systems/e3_deep` |
| Security boundary, privacy-sensitive behavior, credentials, production data, money movement, or destructive/irreversible behavior | `c4_critical/e4_rigorous` |

Ambiguity does not automatically mean a stronger model may decide. When the
missing information is an operator-reserved product choice, the Action uses
`operator_decision_framing`, `responsibility: requires_review`, and advisory
autonomy. The model may frame options; only the operator may decide.

## Authoring Actions

Most Actions declare only a named profile:

```yaml
execution:
  schema: arcadia.execution/v1
  profile: routine_implementation
```

Add phase overrides only to strengthen a requirement:

```yaml
execution:
  schema: arcadia.execution/v1
  profile: routine_implementation
  context:
    required:
      - AGENTS.md
      - src/public-contract.ts
  phases:
    review:
      capability: c3_systems
      effort: e3_deep
      review_independence: separate_run
```

Planning defaults to draft-only autonomy and review defaults to advisory
autonomy. A phase cannot reduce the Action's capability, effort, context,
locality, or review-independence minimum.

The two required fields on every newly authored Action are `execution.schema`
and `execution.profile`. `context`, `underpowered_risk`, and `phases` are
optional because named profiles supply deterministic defaults. Existing fields
remain authoritative for other concerns:

- `responsibility` controls who may act.
- `clarification` and linked Decisions control whether requirements are ready.
- `confidence` reports epistemic certainty; it never changes capability or
  authority.
- `acceptance_criteria` define success and drive verification.
- `current_action` and dependencies control continuation and ordering.

Context is represented by semantic scope (`local`, `project`, or
`cross_system`), explicit required artifacts, and whether context may be staged
outside its source. Plans never declare token counts or context-window sizes.
An adapter is eligible only if it claims the semantic scope; the runner must
stage the named artifacts or refuse before execution.

## Complete examples

Small localized documentation edit:

```yaml
- id: fix-command-example
  title: Correct one command example
  status: open
  responsibility: agent
  clarification: clarified
  confidence: high
  acceptance_criteria:
    - The documented command matches CLI help.
  execution:
    schema: arcadia.execution/v1
    profile: localized_edit
```

Routine implementation with clear tests:

```yaml
- id: add-status-filter
  title: Add the established status filter to the list command
  status: open
  responsibility: agent
  clarification: clarified
  confidence: high
  acceptance_criteria:
    - Existing and new filter tests pass.
  execution:
    schema: arcadia.execution/v1
    profile: routine_implementation
    context:
      required: [AGENTS.md, src/commands/list.ts]
```

Cross-package architectural change:

```yaml
- id: unify-event-contract
  title: Unify the persisted event contract across API and worker packages
  status: open
  responsibility: agent
  clarification: clarified
  confidence: medium
  acceptance_criteria:
    - Both packages use one backward-compatible persisted contract.
    - Migration and compatibility tests pass.
  execution:
    schema: arcadia.execution/v1
    profile: systems_change
    context:
      scope: cross_system
      required: [AGENTS.md, docs/AGENT_ORIENTATION.md, database/schema.sql]
    phases:
      review:
        review_independence: separate_provider
```

Security- or privacy-sensitive change:

```yaml
- id: protect-inquiry-submissions
  title: Protect inquiry submissions and delivery
  status: open
  responsibility: agent
  clarification: clarified
  confidence: medium
  acceptance_criteria:
    - Abuse, disclosure, replay, and delivery-failure paths are tested.
    - No credentials or production submissions enter model context.
  execution:
    schema: arcadia.execution/v1
    profile: sensitive_change
    context:
      scope: cross_system
      required: [AGENTS.md, docs/PRIVACY.md, src/inquiry]
      staging: forbidden
    phases:
      review:
        review_independence: separate_provider
```

Ambiguous product decision requiring the operator:

```yaml
- id: choose-editorial-workflow
  title: Frame the editorial workflow choice
  status: open
  responsibility: requires_review
  clarification: question_open
  confidence: low
  question: Should editors publish directly or submit reviewable changes?
  execution:
    schema: arcadia.execution/v1
    profile: operator_decision_framing
```

These examples intentionally do not contain a model, provider, token budget, or
spending authority.

## Provider adapters

The authoritative plan contains only abstract requirements. Each Arcadia
installation owns a provider-adapter registry with:

- an immutable `mappingId` and observation date;
- enabled/disabled provider records with availability reasons;
- bindings from provider agent profiles to one capability tier;
- exact provider model and effort arguments;
- supported tools, semantic context scopes, locality, sandbox compatibility,
  and a relative `costRank`.

Codex, Claude Code, Gemini, local agents, and future providers use the same
binding shape. A provider with no verified local executable or profile remains
explicitly disabled; its name in a registry does not make it eligible. Adding a
future provider requires no plan or schema change.

Mappings are append-only operational snapshots. Changing any model
classification, CLI argument, or cost order creates a new `mappingId`; old Runs
keep the id and binding they actually used. `observedAt` reports freshness but
is not an identity. Workspace mappings override bundled defaults as a complete
registry, so changes can be reviewed and rolled back atomically.

## Selection

Before a profiled phase, Arcadia:

1. Expands the named profile and applies its phase override.
2. Validates clarification, dependencies, Responsibility, and approval gates
   independently. A failure here is an authority or continuation stop, not a
   model-selection failure.
3. Filters enabled and currently available mappings by purpose, capability,
   effort, tools, context,
   sandbox, locality, explicit profile constraints, and observed availability.
4. Orders compliant candidates by minimum sufficient capability, minimum
   sufficient effort, configured cost rank, and stable profile name.
5. Applies the mapping's exact model and reasoning-effort arguments.
6. Records the resolved abstract profile, mapping id, and binding id.

An unavailable provider may fall back to an equivalent provider. A stronger
binding may satisfy a lower minimum. Arcadia never silently selects a weaker
binding. If no candidate qualifies, it returns
`EXECUTION_PROFILE_UNSATISFIED` and does not start the Run.

`c4_critical` Actions default to local-only data handling. The bundled
configuration intentionally contains no eligible critical local binding, so
such work refuses execution until the operator installs and enables a reviewed
local adapter or explicitly changes the data policy through a Decision.

Selection is deterministic for a fixed requirement, mapping snapshot, coding
agent profile registry, and availability snapshot. A requested provider profile
is a further constraint, never permission to weaken a requirement.

## Failure and fallback rules

Before work starts:

1. If no binding meets the minimum, return
   `EXECUTION_PROFILE_UNSATISFIED`, include every rejected binding and reason,
   and create no Run.
2. If the requested provider is unavailable, retry selection across other
   enabled providers only when they satisfy the same requirement.
3. A stronger tier or greater effort may substitute upward. A weaker tier or
   effort may never substitute downward, even under quota pressure.
4. If the context cannot be staged under its locality policy, stop rather than
   truncating or omitting it silently.
5. If a required operator Decision, credential approval, deployment approval,
   or other authority is absent, report that boundary independently. Selecting
   a stronger model does not clear it.

## Runtime escalation

When a higher-tier characteristic is discovered, the runner stops at a safe
boundary, records `coding_agent.profile_escalated` with the prior and required
profiles plus evidence, and raises `EXECUTION_PROFILE_ESCALATION_REQUIRED`.
Credential, production-data, financial, and destructive triggers separately
report that operator authority is required.

Quota pressure is not an escalation reason and never permits a downgrade.

The runner may step down only at a phase boundary, before execution of that
phase, when the effective phase profile is lower than the preceding phase and
the Action-level minimum still permits it. Version 1 phase overrides can only
strengthen the Action minimum, so the common optimization is selecting a
different least-cost compliant binding for each phase, not weakening an
in-progress phase.

An escalation event records phase, reason, evidence, prior profile, required
profile, mapping, binding, Run, and invocation references. The current
invocation stops. Continuation creates a new selection against the escalated
minimum; it does not rewrite the original Action or Run history. If the trigger
also crosses an authority boundary, the event reports both stops.

Three normative failure examples:

- A `c3_systems/e3_deep` Action on a runner with only
  `c2_integrated/e4_rigorous` fails before starting. Extra effort cannot replace
  missing capability.
- A routine implementation that discovers a persisted cross-system contract or
  security boundary stops at the next safe boundary, records evidence, and
  requires respectively `c3_systems/e3_deep` or
  `c4_critical/e4_rigorous`; already written work remains reviewable but is not
  treated as verified.
- A `c4_critical/e4_rigorous` agent that reaches production credentials still
  stops for operator authority. Capability, effort, and high confidence do not
  grant access.

## Validation

Static document validation checks:

- schema version and named profile;
- allowed enum values and unknown fields;
- absence of provider/model identifiers in authoritative Actions;
- phase overrides do not weaken capability, effort, context scope, staging,
  locality, or review independence;
- `requires_review` permits only `advise` or `draft`, and `blocked` permits only
  `advise`;
- managed Actions satisfy the existing clarification, acceptance-criteria,
  dependency, and continuation rules.

Registry validation checks immutable mapping identity, observation-date format,
unique providers and bindings, provider references, valid tiers and efforts,
enforced model arguments, non-negative cost rank, and profile/provider
compatibility. Runtime checks cover executable availability, quota/health
signals, actual context staging, newly discovered risk, verification evidence,
and approval state.

Useful failures name the field and remedy. Examples:

```text
execution.model: Authoritative plans must not contain provider or model
identifiers; use a provider adapter.

execution.phases.review.capability: c2_integrated is below the action minimum
c3_systems.

EXECUTION_PROFILE_UNSATISFIED: No build configuration satisfies
c4_critical/e4_rigorous. No weaker substitution was made. codex-sol was
rejected because local-only data policy excludes this provider.
```

## Review and verification

Sufficient capability is always required. Independence is risk-based:

- `c1_bounded` and `c2_integrated` need no independent model by default when
  deterministic checks fully cover the change.
- `c3_systems` requires a separate review Run so implementation context cannot
  silently stand in for review.
- `c4_critical` requires a separate review Run; use `separate_provider` when
  provider-correlated failure is material and a compliant second provider
  exists.
- If required independence cannot be satisfied, Arcadia refuses that review
  phase. A human review may satisfy an explicit approval gate, but it does not
  falsify machine provenance.

Verification strength comes from acceptance criteria and evidence, not from
model self-confidence. Confidence may fall at runtime and cause clarification
or review, but it never authorizes a lower execution profile.

## Evaluation against current project work

The completed editable multi-page vertical slice moved route and shared
interface copy into schema-validated YAML while retaining fixed Astro layouts
and deterministic build/content checks. It is `routine_implementation`: the
change spans related files but follows a documented architecture, is reversible,
and has direct checks.

```yaml
execution:
  schema: arcadia.execution/v1
  profile: routine_implementation
  context:
    scope: project
    required:
      - AGENTS.md
      - docs/ARCHITECTURE.md
      - docs/CONTENT.md
      - docs/STATUS.md
  phases:
    verification:
      effort: e3_deep
      underpowered_risk: Literal editable copy or a missing required content key may survive.
```

The shared inquiry-service planning Action spans sites and an independently
deployed service, and its design controls personal inquiry data, abuse
protection, email delivery, and credentials. It therefore uses
`sensitive_change`. Planning remains draft-only and cannot use credentials or
production data. With the bundled mappings this Action correctly refuses rather
than silently using a remote non-critical binding.

```yaml
execution:
  schema: arcadia.execution/v1
  profile: sensitive_change
  context:
    scope: cross_system
    required:
      - AGENTS.md
      - docs/ARCHITECTURE.md
      - docs/DEPLOY.md
      - docs/STATUS.md
    staging: forbidden
  phases:
    planning:
      autonomy: draft
    review:
      review_independence: separate_provider
```

This contrast also demonstrates the independent axes. The inquiry plan may use
the strongest available capability at rigorous effort and still have only
draft autonomy, medium confidence, and no authority to read credentials or
deploy. Conversely, a high-confidence localized documentation correction may
use `c1_bounded/e1_brief` with bounded write authority.

## Usage

Version 1 records provider-reported usage, context, and availability when those
signals exist. It does not estimate Action token size, predict budgets, reserve
tokens, or schedule from speculative consumption. Revisit prediction only when
historical Run data demonstrates that it improves scheduling.

## Compatibility

- Existing Actions without `execution` continue through the legacy explicit or
  default profile path during the compatibility window.
- Newly authored managed Actions should declare an execution profile.
- Current dispatchable Actions will become mandatory-profile Actions after the
  active plans have been migrated.
- Completed legacy Runs remain `unknown_legacy`; Arcadia never invents their
  execution profile.

Migration order:

1. Install the v1 parser, schema, additive database columns, adapter registry,
   selection, and provenance without changing legacy dispatch.
2. Add profiles to current Actions first, then open backlog Actions as they are
   touched. Completed Actions may receive a prospective profile for evaluation,
   but their historical execution remains `unknown_legacy`.
3. Dry-run and apply `arcadia docs sync`; verify `arcadia next` resolves the
   same Action or the intended refusal.
4. After every active plan is migrated, make a missing execution profile a
   static error for current dispatchable Actions. Later remove legacy selection
   only through a separately reviewed schema version.

Run records are the authoritative source for the abstract profile actually
used. A completed mission-log entry should reference or summarize that Run
profile when available, but must display `unknown_legacy` rather than infer
history. This avoids duplicating mutable provider configuration in narrative
logs.

## Placement and stewardship

- Policy: `docs/agent-execution-policy.md`
- Portable schema: `schemas/arcadia-execution-profile-v1.schema.json`
- Runtime semantics and named profiles: `src/execution/profiles.ts`
- Bundled provider mapping: `config/defaults/provider-adapters.json`
- Workspace/provider overrides:
  `<workspace>/config/provider-adapters.json`
- Action requirements: managed plan frontmatter
- Actual selection and escalation provenance: immutable Run/invocation columns
  plus append-only events

Arcadia owns the abstract contract. Provider adapters own changing vendor
facts. Projects may strengthen requirements and supply required context, but
must not redefine global tier meanings.

## Operator decisions

No product Decision is required to use version 1. Arcadia uses the conservative
defaults above. These future changes require explicit operator review because
they alter trust or compatibility rather than implementation detail:

- approving and enabling a binding that claims `c4_critical`, especially a
  remote binding or one allowed to receive sensitive context;
- changing when `separate_provider` is mandatory;
- ending the legacy no-profile compatibility window;
- adopting predictive token budgets after measured Run history shows useful
  accuracy.
