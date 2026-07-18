# Arcadia Intelligence v0.1 Scope

## Purpose

Arcadia Intelligence v0.1 is a generic, local, SQLite-backed structured
generation service.

Any companion app can submit a structured request without Arcadia understanding
the app's domain.

## Included

- One generic structured generation request shape, routed by
  `capability` + `execution` + `profile` — never a raw LiteLLM route,
  Codex command, provider name, or model ID (see `ROUTING.md`)
- One generic output-contract shape
- A small, explicit route registry resolving each (capability, execution,
  profile) request deterministically to exactly one configured execution
  route, with no automatic fallback or escalation — restricted to a
  narrow, intentional matrix (see `ROUTING.md`), not every
  capability/profile permutation an alias could theoretically serve
- A narrow `requirements` shape (`structuredOutput`, `imageSize`,
  `transparency`) validated before a job runs — not a generic
  capability-negotiation system
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
- Read-only current-day job-usage and coding-agent-availability reporting for
  the Dashboard; remaining quota and reset time remain unknown unless a
  provider reports them authoritatively

## Explicitly excluded

- Rebuster-specific code
- MIDI Opener-specific code
- Blogging-specific code
- Codex CLI execution beyond the explicit local image-generation route
- Automatic provider/model selection, cost optimization, or quality
  escalation — routing is a deterministic lookup, not a policy engine
- "local-preferred" silently escalating to cloud, or any other automatic
  fallback
- "either"/"cloud-preferred"/"frontier" execution preferences (may be added
  later without breaking the registry shape)
- Budget or quota enforcement, provider usage polling, and any inference of
  remaining provider quota from locally recorded usage
- Caching
- Prompt registry
- Image *editing*, variation, or multi-turn generation (single text-to-image
  only; `image.edit` is a typed capability with no executable transport yet)
- Vision, audio, and video capabilities are typed but unconfigured by
  default — they resolve as a typed "route_not_configured" failure rather
  than executing
- Webhooks, streaming, and subscriptions
- Separate packages or deployable services (the public client/contracts
  subpaths still ship from this one package)
- Redis, BullMQ, RabbitMQ, or distributed workers
- Microservices
- Generic chat endpoints
- Agent frameworks

## Architectural rule

Companion apps own:

- their own workflow identifier (`operationId`) — never used for routing
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
  profile to one configured execution route — concrete executor/model/
  provider/route selection is entirely internal
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
