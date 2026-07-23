# Architecture Boundary

## Arcadia Mission Control

Arcadia owns durable Project context and work visibility:

- Project, Mission, Outcome, Milestone, Action, Artifact, Decision, and Log linkage.
- Project-aware policy and explicit overrides.
- Approval gates and Requires Review outcomes.
- Request attribution, correlation IDs, idempotency keys, hashes, and provenance summaries.
- Operator visibility through CLI, dashboard snapshot, events, and Logs.
- Result validation status and Artifact creation for accepted outputs.

Arcadia does not own provider-specific SDK behavior, token counting internals, virtual key enforcement, provider fallback, or model routing.

## Arcadia Intelligence Policy And Orchestration

The Intelligence layer should be a narrow Arcadia capability. It accepts an Intelligence Request, evaluates deterministic policy, chooses an executor class, invokes a compliant executor, validates the result, and records the outcome.

It should expose capabilities such as `structured_text.generate`, not provider names such as `openai.gpt-4.1` or `anthropic.claude`. It may map a quality tier to a LiteLLM model alias, but the alias remains configuration, not a companion-app contract.

## LiteLLM Proxy

LiteLLM owns:

- OpenAI-compatible provider normalization.
- Model aliases and provider routing.
- Virtual keys or project attribution strategy.
- Budgets, rate limits, fallback, and provider usage where supported.
- Provider credentials.

LiteLLM does not own Arcadia Projects, Actions, Artifacts, Decisions, Logs, approval gates, or Project policy.

## Companion Apps

Companion apps own their domain workflows and domain validation. A future Rebuster integration should request a capability from Arcadia, then validate whether the returned structured candidate list fits Rebuster's creative constraints.

Companion apps should not hard-code provider keys, cloud model names, paid fallback rules, or Arcadia policy overrides.

## Local Models And Future Executors

Local model executors may later satisfy the same capability contract. Codex-style executors may later be optional for special workflows, but only after authentication, usage-limit, interaction, sandbox, and completion semantics are proven.

## Why Local Integration First

Arcadia is currently local-first: a CLI, local SQLite workspace, local files, and a local dashboard. A distributed microservice architecture would add authentication, remote secrets, multi-user policy, deployment, and network operations before the first capability is proven.

The first implementation should keep the boundary inspectable: local config, local SQLite metadata, local LiteLLM endpoint, local fake tests, and optional local integration tests. This matches the existing Arcadia pattern and keeps failure modes visible.
