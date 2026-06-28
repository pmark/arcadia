# Arcadia Intelligence v0.1 Scope

## Purpose

Arcadia Intelligence v0.1 is a generic, local, SQLite-backed structured
generation service.

Any companion app can submit a structured request without Arcadia understanding
the app's domain.

## Included

- One generic structured generation request shape
- One generic output-contract shape
- One configured LiteLLM route
- SQLite-backed durable jobs
- In-process worker loop
- Generic JSON Schema validation
- Submit, status, retry, and health API endpoints
- Generic TypeScript client
- No paid fallback
- One retry maximum

## Explicitly excluded

- Rebuster-specific code
- MIDI Opener-specific code
- Blogging-specific code
- Codex CLI execution
- Multiple providers or model routes
- Automatic fallback
- Budgets and quotas
- Caching
- Image generation
- Prompt registry
- Artifact store beyond durable result JSON
- Dashboard UI
- Webhooks, streaming, and subscriptions
- Separate packages
- Redis, BullMQ, RabbitMQ, or distributed workers
- Microservices
- Generic chat endpoints
- Agent frameworks

## Architectural rule

Companion apps own:

- capability names
- input payloads
- JSON Schemas
- prompt templates
- domain validation beyond JSON Schema
- workflow state
- judgment and publishing

Arcadia Intelligence owns:

- durable job execution
- one approved model route
- generic validation
- status transitions
- retry behavior
- provenance fields
- operational errors

## v0.1 success criterion

A second hypothetical companion app can use the same Arcadia client and service
without requiring any Arcadia code changes for that app's domain concepts.
