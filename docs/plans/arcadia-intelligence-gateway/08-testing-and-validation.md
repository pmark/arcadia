# Testing And Validation

## Unit Tests

Add deterministic tests for:

- request validation,
- output contract validation,
- policy selection order,
- paid fallback denial,
- unavailable executor,
- idempotency key reuse,
- input/output hash stability,
- provenance field mapping.

## Integration Tests With Fakes

Use temporary workspaces and a fake OpenAI-compatible HTTP server, following the Rebuster fake server pattern.

Test:

- successful structured text request,
- LiteLLM-like error response,
- timeout,
- usage metadata capture,
- invalid JSON result,
- schema-valid result that creates an Artifact and Log,
- event emission,
- dashboard snapshot fields.

## Contract Tests

Add tests for the CLI JSON envelope:

- `intelligence request`,
- `intelligence show`,
- `intelligence list`,
- `intelligence health`.

The tests should assert stable fields but avoid overfitting to full provider payloads.

## End-To-End Tests

A local end-to-end test may run only when explicit environment variables are set, for example:

- `ARCADIA_LITELLM_TEST_BASE_URL`
- `ARCADIA_LITELLM_TEST_KEY`
- `ARCADIA_LITELLM_TEST_MODEL_ALIAS`

These tests must be skipped by default and must not require paid provider credentials.

## Required Deterministic Cases

- Policy chooses cache before external gateway.
- Budget denial prevents executor call.
- Unavailable executor records unavailable status.
- Duplicate request reuses idempotent result.
- Result validation failure records `invalid_result`.
- Artifact and Log creation occur for accepted results.
- Provenance records policy version, executor class, alias, hashes, validation, and usage/cost when present.

## Validation Commands

Expected repository checks:

```sh
pnpm test
pnpm build
```

For documentation-only changes, `pnpm test` is sufficient unless TypeScript files change.
