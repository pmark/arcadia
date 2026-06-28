# Arcadia Intelligence Gateway Plan

## Executive Summary

Arcadia should add an Intelligence Gateway as a narrow Mission Control capability: Arcadia evaluates Project-aware policy, records attribution and provenance, creates Artifacts, Decisions, and Logs, and exposes operator visibility. A self-hosted LiteLLM Proxy should handle provider normalization, OpenAI-compatible routing, model aliases, virtual keys, budgets, rate limits, fallback, and provider usage where available.

The first implementation should prove one capability: structured text generation for a future Rebuster candidate-list workflow. It should run through Arcadia policy, use local configuration, call a local LiteLLM Proxy when allowed, validate the structured result, record provenance, and leave durable Artifacts and Logs.

## Problem Being Solved

Companion apps and future Arcadia workflows need AI help without scattering provider keys, model names, budget rules, and provenance across projects. Arcadia needs a local-first way to say what capability is needed, why it is allowed, how it is attributed to a Project, what it produced, and what Decisions or Logs resulted.

## Intended Architecture

- Arcadia owns Mission Control: Project attribution, policy evaluation, approval gates, Action visibility, Artifact linkage, Decision creation, Log entries, and high-level observability.
- Arcadia owns an internal Intelligence Request abstraction and deterministic routing decision.
- LiteLLM Proxy owns provider normalization, model aliases, request routing, virtual keys, budgets, rate limits, fallback, and provider usage where supported.
- Companion apps eventually call Arcadia for capabilities, not providers.
- Local tools, cache, and local models remain preferred before paid cloud models.

## Explicit Non-Goals

- Do not make Arcadia a generic agent framework, chatbot platform, or provider SDK.
- Do not build direct Rebuster integration in this phase.
- Do not add image, audio, video, agent swarms, automatic publishing, arbitrary shell execution, plugin marketplace, or remote multi-user infrastructure.
- Do not reimplement LiteLLM provider routing, token accounting, virtual keys, or budget enforcement inside Arcadia.
- Do not treat Codex CLI as a normal always-available API provider.

## Recommended First Vertical Slice

Implement one structured text capability:

1. Accept an internal Intelligence Request with Project attribution.
2. Evaluate deterministic local-first policy.
3. Route to a configured local LiteLLM-backed executor only when allowed.
4. Validate a JSON response against a small documented contract.
5. Persist request metadata, hashes, policy decision, LiteLLM provenance, result validation, Artifact linkage, and a Log.
6. Expose status through CLI JSON and the dashboard snapshot.

## Dependency-Ordered Implementation Sequence

1. Add configuration schema and disabled-by-default feature flag.
2. Add capability module, repository functions, and migrations for request/provenance metadata.
3. Add policy evaluator with fake executors.
4. Add the structured text contract and validator.
5. Add a LiteLLM-compatible executor adapter behind local config.
6. Add CLI commands for submit/show/list/health.
7. Add dashboard snapshot fields for health, budget summary, blocked work, and recent high-cost requests.
8. Add optional local LiteLLM integration tests.

## Definition Of Success

- A Project-attributed structured text request can complete locally through Arcadia policy and a LiteLLM-compatible endpoint.
- The same request can be denied predictably when budget, approval, executor availability, or validation rules fail.
- No provider key, model name, or paid fallback is hidden in companion app code.
- Arcadia records enough provenance to answer: who requested it, for which Project, which capability, which policy decision, which executor class, which LiteLLM alias, what validation happened, which Artifact was produced, and what it cost if usage is available.
- The implementation remains local-first, disabled by default, and testable without paid credentials.

## Document Order

1. [Current State And Assumptions](00-current-state-and-assumptions.md)
2. [Architecture Boundary](01-architecture-boundary.md)
3. [Capability Contract](02-capability-contract.md)
4. [Policy And Routing](03-policy-and-routing.md)
5. [LiteLLM Integration](04-lite-llm-integration.md)
6. [Data Model And Provenance](05-data-model-and-provenance.md)
7. [API, CLI, And Dashboard](06-api-cli-and-dashboard.md)
8. [First Vertical Slice](07-first-vertical-slice.md)
9. [Testing And Validation](08-testing-and-validation.md)
10. [Rollout And Operations](09-rollout-and-operations.md)
11. [Future Executors And Companion Apps](10-future-executors-and-companion-apps.md)
12. [Implementation Backlog](11-implementation-backlog.md)
13. [Decisions Needed](12-decisions-needed.md)
