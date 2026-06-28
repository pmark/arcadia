# Arcadia Intelligence v0.1

The bootstrap established a domain-neutral skeleton.

Your job is to inspect the existing Arcadia repository and implement the v0.1
vertical slice using repository conventions.

Do not rewrite this into packages, microservices, provider adapters, agent
frameworks, or a generalized AI platform.

## Required behavior

Implement a generic Arcadia Intelligence service that:

1. Accepts a companion-app-defined structured generation request.
2. Persists a durable SQLite job.
3. Uses a client-supplied idempotency key.
4. Runs an in-process worker with a restart-safe SQLite lease.
5. Sends the request through one configured LiteLLM route.
6. Validates output against the app-supplied JSON Schema.
7. Stores the validated result and generic provenance metadata in the job.
8. Returns queued, running, completed, failed, or blocked states.
9. Supports one retry maximum.
10. Blocks clearly when LiteLLM is unavailable.
11. Does not know anything about Rebuster or any other companion-app domain.
12. Does not automatically use paid fallback.

## Required API

- POST /api/intelligence/jobs
- GET /api/intelligence/jobs/:jobId
- POST /api/intelligence/jobs/:jobId/retry
- GET /api/intelligence/health

## Required client API

- submit(request)
- getJob(jobId)
- retry(jobId)
- waitForCompletion(jobId)

## Implementation constraints

- Prefer existing Arcadia server, database, migration, config, and test patterns.
- Use Fastify only if Arcadia does not already have an established compatible API pattern.
- Use SQLite as the source of truth.
- Use LiteLLM over localhost.
- Do not add provider SDKs.
- Do not add Codex execution yet.
- Do not add budgets, quotas, caching, artifact services, dashboards, or image support.
- Do not add a domain-specific capability registry.
- Do not embed any app-specific schema or prompt into Arcadia.

## Required tests

At minimum:

- submit creates one queued job
- duplicate idempotency key returns the same job
- worker moves queued -> running -> completed
- valid fake LiteLLM output completes the job
- invalid output fails validation
- unavailable LiteLLM blocks the job
- retry works once and rejects further retries
- a synthetic second app with unrelated capability/schema works unchanged
- client can poll until terminal status

## Deliverables

- Working implementation
- Database migration integrated with Arcadia conventions
- Configured LiteLLM client
- API route integration
- In-process worker lifecycle integration
- Test coverage
- Updated local development documentation
- Brief implementation report listing files changed, tests run, and deferred work
