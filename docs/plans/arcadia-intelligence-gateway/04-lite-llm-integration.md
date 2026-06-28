# LiteLLM Integration

## Deployment Boundary

Arcadia should integrate with a self-hosted LiteLLM Proxy through an OpenAI-compatible HTTP endpoint. The first phase should not install or manage LiteLLM unless a safe local dev environment already exists and is explicitly enabled.

Arcadia stores endpoint labels and non-secret references. LiteLLM stores provider credentials, virtual keys, budgets, rate limits, model aliases, and provider routing.

## Local-First Configuration

Recommended workspace files:

- `config/intelligence-gateway.json`: feature flag, endpoint label, base URL, model alias names, timeout, health check path, and policy file reference.
- `config/intelligence-policy.json`: Project/default capability policy.

Secrets should stay outside SQLite and committed config. Use environment variable names or OS secret references, for example `LITELLM_ARCADIA_KEY`, not raw key values.

## Required Configuration Categories

- Endpoint: base URL, health path, timeout.
- Authentication reference: environment variable name or secret reference.
- Model aliases: local, standard, and premium text aliases.
- Attribution: LiteLLM virtual key strategy or metadata fields that carry Arcadia Project/request IDs.
- Budgets: LiteLLM-side budget names and Arcadia-side max request/project defaults.
- Rate limits: LiteLLM-side enforcement with Arcadia-visible failure handling.
- Logging: LiteLLM request IDs, Arcadia correlation IDs, and local Arcadia events.
- Health checks: endpoint reachable, auth works, configured aliases available.

## Responsibilities

LiteLLM remains responsible for provider routing, credentials, provider fallback, usage returned by providers, budgets, and rate limits.

Arcadia remains responsible for whether a request should call LiteLLM at all, which alias class is allowed, and how the result is validated, linked, and shown.

## Operational Risks

- Misconfigured fallback could spend money unexpectedly.
- Usage fields may be incomplete or provider-specific.
- Endpoint downtime could block Actions.
- Secrets may leak if stored in SQLite, Logs, Artifacts, or dashboard snapshots.
- Provider content safety or schema failures can produce invalid results.

## Verification Steps

1. Health command returns endpoint status without exposing secrets.
2. Dry-run policy shows the intended LiteLLM alias without making a provider call.
3. Fake OpenAI-compatible server passes contract tests.
4. Optional local LiteLLM test verifies auth, alias routing, usage capture, and budget-denial behavior without paid credentials.
5. Dashboard snapshot shows health and recent failures without request body leakage.
