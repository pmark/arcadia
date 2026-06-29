# Arcadia Intelligence Configuration

v0.1 supports a small, explicit route registry (`IntelligenceV01Config.routes`)
built from at most three LiteLLM aliases — see `docs/intelligence/ROUTING.md`
for the full routing model and the environment variables that configure it
(`ARCADIA_LITELLM_LOCAL_TEXT_ROUTE`, `ARCADIA_LITELLM_CLOUD_TEXT_ROUTE`,
`ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE`, `ARCADIA_LITELLM_BASE_URL`,
`ARCADIA_LITELLM_API_KEY`).

Do not add provider-specific settings here, or one environment variable per
(capability, profile) combination — `buildDefaultRoutes` in `defaults.ts`
expands the three aliases into the full registry in code.

This stays:

- one local LiteLLM endpoint
- a small in-code route registry, not a generic rules engine
- paid usage gated per-request via `executionPolicy.allowPaidUsage`, never
  an automatic fallback
- one retry maximum
- SQLite-backed durable jobs
