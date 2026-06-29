# Arcadia Intelligence v0.1 Scope

## Purpose

Arcadia Intelligence v0.1 is a generic, local, SQLite-backed structured
generation service.

Any companion app can submit a structured request without Arcadia understanding
the app's domain.

## Included

- One generic structured generation request shape, routed by
  `capability` + `execution` + `profile` — never a raw LiteLLM route,
  provider name, or model ID (see `ROUTING.md`)
- One generic output-contract shape
- A small, explicit route registry resolving each (capability, execution,
  profile) request deterministically to exactly one configured LiteLLM
  route, with no automatic fallback or escalation
- SQLite-backed durable jobs
- In-process worker loop
- Generic JSON Schema validation
- Submit, status, retry, and health API endpoints
- A local artifact store for generated binary results (currently images):
  Arcadia downloads/decodes provider output, hashes and persists the bytes
  under the workspace, and returns a durable artifact-reference manifest
  (never a provider URL or inline base64) plus an HTTP endpoint to fetch
  those bytes back
- Generic TypeScript client (including artifact retrieval)
- Paid usage gated separately from routing preference via
  `executionPolicy.allowPaidUsage` — never an automatic fallback
- One retry maximum

## Explicitly excluded

- Rebuster-specific code
- MIDI Opener-specific code
- Blogging-specific code
- Codex CLI execution
- Automatic provider/model selection, cost optimization, or quality
  escalation — routing is a deterministic lookup, not a policy engine
- "local-preferred" silently escalating to cloud, or any other automatic
  fallback
- "either"/"cloud-preferred"/"frontier" execution preferences (may be added
  later without breaking the registry shape)
- Budgets and quotas
- Caching
- Prompt registry
- Image *editing*, variation, or multi-turn generation (single text-to-image
  only; `image.edit` is a typed capability with no executable transport yet)
- Vision, audio, and video capabilities are typed but unconfigured by
  default — they resolve as a typed "route_not_configured" failure rather
  than executing
- Dashboard UI
- Webhooks, streaming, and subscriptions
- Separate packages or deployable services (the public client/contracts
  subpaths still ship from this one package)
- Redis, BullMQ, RabbitMQ, or distributed workers
- Microservices
- Generic chat endpoints
- Agent frameworks

## Architectural rule

Companion apps own:

- their own request identifier (`capabilityId`)
- input payloads
- JSON Schemas
- prompt templates
- domain validation beyond JSON Schema
- workflow state
- judgment and publishing

Companion apps choose, per request:

- `capability`: the generic operation needed (e.g. "text.generate")
- `execution`: where it's allowed/preferred to run (`local-required`,
  `local-preferred`, `cloud-required`)
- `profile`: the optimization target (`economy`, `fast`, `standard`,
  `quality`)

Arcadia Intelligence owns:

- durable job execution
- the route registry and deterministic resolution of capability/execution/
  profile to one configured LiteLLM route — concrete model/provider/route
  selection is entirely internal
- generic validation
- durable storage of generated binary artifacts and their hashes/metadata
  (never companion-app domain meaning about those artifacts)
- status transitions
- retry behavior
- provenance fields (including the resolved route's semantic ID)
- operational errors, including typed route-resolution failures

## v0.1 success criterion

A second hypothetical companion app can use the same Arcadia client and service
without requiring any Arcadia code changes for that app's domain concepts.
