# API, CLI, And Dashboard

## Smallest Useful API

The internal API should be a TypeScript function, not an HTTP service first:

- `submitIntelligenceRequest(runtime, request)`
- `getIntelligenceRequest(db, id)`
- `listIntelligenceRequests(db, filters)`
- `checkIntelligenceGatewayHealth(config)`

This matches current command and capability patterns and avoids premature service boundaries.

## Companion App Call Shape

A future companion app should call Arcadia with:

- capability name,
- Project attribution,
- structured input,
- requested output contract,
- quality/cost policy,
- idempotency key.

It should not send provider names or API keys. For the first phase, this can be exposed through CLI JSON and later through the same local adapter pattern used by the dashboard.

## CLI

Add one command group:

```text
arcadia intelligence request --project <id> --capability structured_text.generate --input-json <path> --contract structured_text_list_v1 --json
arcadia intelligence show <request-id> --json
arcadia intelligence list [--project <id>] [--status <status>] --json
arcadia intelligence health --json
```

Keep human output concise: status, Project, capability, routing decision, Artifact, cost if known, and next Action.

## Dashboard

Extend the dashboard snapshot with:

- gateway health,
- configured endpoint label,
- recent request count,
- recent failures,
- blocked/Needs Mark requests,
- recent high-cost work,
- budget status when available,
- Project attribution for recent requests.

Do not build a prompt playground, provider admin panel, model tuning UI, chat interface, or generic AI dashboard.

## Operator Controls

Operators should be able to inspect:

- why a request was denied,
- which Project and Action it was attributed to,
- whether paid fallback was allowed,
- which executor class ran,
- validation status,
- linked Artifacts and Logs,
- cost/usage if available.

Operators should control policy through local config and Decisions, not dashboard-only hidden state.
