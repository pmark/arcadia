# Capability Contract

## Internal Abstraction

An Intelligence Request is an internal Arcadia request for a capability. It is not a provider request and not a chat session.

Required fields:

- `idempotencyKey`: caller-provided or derived stable key for retries.
- `correlationId`: trace identifier for logs, events, LiteLLM metadata, and Artifacts.
- `capability`: stable capability name.
- `projectId`: Arcadia Project attribution.
- `actionId`: optional related Action.
- `input`: capability-specific structured input.
- `outputContract`: requested schema or named contract version.
- `qualityTier`: `local`, `standard`, or `premium`.
- `costPolicy`: max cost and paid fallback behavior.
- `executionMode`: `dry_run`, `plan_only`, or `execute`.
- `artifactPolicy`: whether to persist output as an Artifact.

## First Capability Vocabulary

Start with one capability:

- `structured_text.generate`: produce bounded structured text matching a named JSON contract.

Reserve but do not implement yet:

- `structured_text.rewrite`
- `structured_text.classify`
- `embedding.generate`
- `code.plan`
- `media.generate`

## Request Semantics

Client-facing capabilities must remain separate from executor/provider names. A future companion app asks for `structured_text.generate` with a contract like `rebuster_candidate_list_v1`; Arcadia policy decides whether a deterministic local tool, cache, local model, LiteLLM-backed model, or Requires Review outcome is compliant.

## Result Status

Statuses should be small and operational:

- `accepted`: validated output recorded.
- `denied`: policy denied before executor call.
- `requires_review`: approval or Decision required.
- `unavailable`: no compliant executor was available.
- `failed`: executor or transport failed.
- `invalid_result`: executor returned a result that failed validation.
- `cached`: satisfied by cache.

## Provenance

Every completed or failed request should record:

- Policy version and routing decision.
- Executor class.
- LiteLLM endpoint label and model alias if used.
- Provider/model metadata returned by LiteLLM when available.
- Input hash, output hash, prompt/template version.
- Usage and cost fields when available.
- Validation status and validator version.
- Artifact IDs and Log ID when created.

## Illustrative Request Shape

```json
{
  "idempotencyKey": "rebuster-candidates:proj_rebuster:2026-06-26:inputhash",
  "correlationId": "intel_01",
  "capability": "structured_text.generate",
  "projectId": "proj_rebuster",
  "actionId": null,
  "input": {
    "task": "Generate candidate rebus ideas from a theme list.",
    "sourceText": "transport, breakfast, weather",
    "constraints": ["short answers", "family-safe", "visualizable"]
  },
  "outputContract": "structured_text_list_v1",
  "qualityTier": "standard",
  "costPolicy": {
    "allowPaid": false,
    "maxEstimatedUsd": 0
  },
  "executionMode": "execute",
  "artifactPolicy": {
    "createArtifact": true,
    "artifactType": "intelligence_structured_text"
  }
}
```

## Illustrative Response Shape

```json
{
  "requestId": "intel_req_01",
  "status": "accepted",
  "capability": "structured_text.generate",
  "projectId": "proj_rebuster",
  "routing": {
    "policyVersion": "intelligence_policy_v1",
    "executorClass": "external_gateway_cloud_model",
    "executorAlias": "litellm.standard_text"
  },
  "result": {
    "items": [
      { "title": "Toast Coast", "rationale": "Combines breakfast and geography." }
    ]
  },
  "validation": {
    "status": "passed",
    "contract": "structured_text_list_v1",
    "validatorVersion": "1"
  },
  "artifacts": ["art_01"],
  "provenance": {
    "inputHash": "sha256:...",
    "outputHash": "sha256:...",
    "modelAlias": "standard_text",
    "providerModel": null,
    "usage": null,
    "costUsd": null
  }
}
```

These shapes are documentation examples. The implementation should refine field names to match existing TypeScript and JSON envelope conventions.
