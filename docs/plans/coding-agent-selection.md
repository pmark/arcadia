---
arcadia: v1
type: plan
slug: coding-agent-selection
project: arcadia
status: complete
milestone: vendor-neutral coding-agent selection
updated: 2026-07-26
actions:
  - id: execution-profile-contract
    title: Add the vendor-neutral execution-profile contract
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered in src/execution/profiles.ts and schemas/arcadia-execution-profile-v1.schema.json.
    expected_artifact: Versioned execution-profile types, defaults, parser support, and validation tests
    acceptance_criteria:
      - Plans declare vendor-neutral capability and reasoning-effort requirements without model identifiers.
      - A concise named profile expands into a complete effective profile with optional phase overrides.
      - Invalid profiles, weakened phase requirements, and incompatible authority or autonomy combinations fail with actionable errors.
      - Token estimation and predictive budgeting are not part of the v1 contract.
    clarification: clarified
    confidence: high
    source: Operator-reviewed design conversation on 2026-07-25
    references:
      - docs/arcadia-protocol.md
      - docs/arcadia-semantics.md
      - config/defaults/coding-agent-profiles.json
    depends_on: []
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
      phases:
        review:
          capability: c3_systems
          effort: e3_deep
          review_independence: separate_run
  - id: compliant-provider-selection
    title: Select the least costly compliant coding-agent configuration
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered in src/codingAgents/providerAdapters.ts and config/defaults/provider-adapters.json.
    acceptance_criteria:
      - Provider mappings bind abstract capability and effort requirements to replaceable provider-specific configuration.
      - Selection rejects weaker substitutions and filters for tools, context, sandbox, locality, and availability.
      - Equivalent-provider and stronger-tier fallbacks are deterministic and preserve authority boundaries.
    clarification: clarified
    confidence: high
    depends_on: [execution-profile-contract]
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
  - id: execution-profile-provenance
    title: Record resolved profiles and runtime escalation
    status: done
    responsibility: codex
    effort: session
    next_action: Delivered through additive provenance columns and append-only execution-profile events.
    acceptance_criteria:
      - Each managed Run records the abstract profile and immutable provider-mapping identifier it used.
      - A newly discovered higher-tier trigger stops at a safe boundary and records an escalation event.
      - Model escalation never changes Responsibility or approval-gate state.
      - Completed legacy work remains explicitly unknown rather than receiving invented execution history.
    clarification: clarified
    confidence: high
    depends_on: [compliant-provider-selection]
    execution:
      schema: arcadia.execution/v1
      profile: systems_change
  - id: continuation-policy-migration
    title: Adopt execution profiles in Arcadia's continuation workflow
    status: done
    responsibility: codex
    effort: short
    next_action: Delivered in docs/agent-execution-policy.md, docs/arcadia-protocol.md, and START_HERE.md.
    acceptance_criteria:
      - The continuation protocol uses abstract tiers and effort instead of vendor model names.
      - Current dispatchable Actions require a resolvable execution profile after the compatibility window.
      - START_HERE.md explains the operator-visible selection and refusal behavior.
      - Existing completed Actions retain unknown legacy execution provenance.
    clarification: clarified
    confidence: high
    depends_on: [execution-profile-provenance]
    execution:
      schema: arcadia.execution/v1
      profile: routine_implementation
questions: []
decisions: []
---

# Coding-Agent Selection

## Executive Summary

Arcadia will describe coding-agent work through vendor-neutral capability,
reasoning-effort, tool, context, autonomy, delegation, and review requirements.
Provider-specific model identifiers remain in replaceable adapter mappings.
The runner selects the least costly compliant configuration and refuses weaker
substitution. Predictive token estimation and budgeting are explicitly deferred
until observed Run history demonstrates that they would improve scheduling.

## Status

- Milestone: vendor-neutral coding-agent selection
- Next Action: none; restore the prior portfolio-docs-protocol work pointer
- Responsibility: Codex (complete)
- Required Artifact: delivered — authoritative policy, portable schema,
  provider adapters, deterministic selection, provenance, and continuation docs
- Decisions open: none
- Last Log: 2026-07-25 — validated the implementation and restored the prior
  active plan after dogfooding
- Updated: 2026-07-26

## Design

Capability, reasoning effort, confidence, and authority are independent.
An Action carries a concise named profile with sparse phase overrides. The
resolved profile is checked before each phase. Stronger models do not gain
permission to deploy, publish, use credentials, spend money, access production
data, delete data, merge, or make operator-reserved product Decisions.

Usage telemetry remains observational in v1. Arcadia may stop or choose an
equivalent compliant provider when a reported limit is reached, but it does not
predict token consumption or schedule from speculative budgets.

## Log

- 2026-07-25 — Documented complete authoring examples, deterministic failure
  cases, validation boundaries, migration and stewardship, and evaluated the
  Teach With Connection editable-content vertical slice and shared
  inquiry-service planning Action. Focused tests, typechecking, and builds pass;
  the broad Vitest process has an existing open-handle shutdown issue after
  assertions complete.
- 2026-07-25 — Added replaceable Codex and Claude Code bindings, an explicitly
  unavailable Gemini provider entry, lowest-cost compliant selection, exact
  model/effort invocation arguments, equivalent-provider fallback, weaker-model
  refusal, additive invocation/Run provenance, and append-only escalation
  events that keep authority separate.
- 2026-07-25 — Added `arcadia.execution/v1`, five named profiles, phase
  overrides, authority-aware validation, plan-parser integration, a portable
  JSON Schema, and focused tests. Predictive token budgeting remains excluded.
- 2026-07-25 — Created the implementation plan from the reviewed
  vendor-neutral selection policy and made its first Action current.
