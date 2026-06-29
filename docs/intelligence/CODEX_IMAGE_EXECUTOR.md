# Codex Image Executor

Current Milestone: Arcadia Intelligence can route generic image-generation
requests to a local Codex CLI executor and return durable image Artifact
references.

Next Action: Companion apps can integrate against the standard Intelligence
request/result contract using `capability: "image.generate"`.

Work Responsibility: Codex.

Required Artifacts: route config, executor code, tests, this design note, and
example request payloads.

## What changed

Arcadia Intelligence now supports a local Codex CLI-backed route:

```text
arcadia.image.generate.local.quality
```

Companion apps still submit a normal `IntelligenceRequest`. Arcadia resolves
`capability + execution + profile` deterministically, claims the SQLite job,
runs the selected executor, validates the result against the companion app's
`outputContract.jsonSchema`, and stores the terminal job state.

The Codex image executor:

- creates `.arcadia/intelligence/jobs/<job-id>/`
- writes `request.json` and `instructions.md`
- optionally stages `input.referenceImages` into `reference-images/`
- invokes the configured Codex CLI command
- preserves `logs/codex.stdout.log` and `logs/codex.stderr.log`
- requires `output/manifest.json`
- validates declared image files before trusting them
- persists final images through the existing Intelligence artifact store
- returns the standard `IntelligenceImageGenerationResult`

## Why

Image generation should be available to Rebuster and any other companion app
without a special app-specific path. Routing remains Arcadia-owned and
deterministic; Codex is only an execution backend for a resolved route, not a
router, policy engine, or hidden agent layer.

SQLite remains the source of truth for jobs and artifact metadata. Generated
bytes are stored under the workspace `artifacts/` directory and referenced by
stable API URIs.

## Contract changes

Route entries now have an optional executor type:

```ts
executor?: "litellm" | "codex-cli";
```

Existing routes default to `litellm`. The Codex route is enabled by setting:

```sh
ARCADIA_CODEX_IMAGE_ROUTE=codex-cli
```

The Codex workspace output manifest must be valid JSON:

```json
{
  "status": "completed",
  "artifacts": [
    {
      "kind": "image",
      "path": "output/image-01.png",
      "mimeType": "image/png",
      "width": 1024,
      "height": 1024,
      "metadata": {
        "prompt": "optional",
        "version": "optional",
        "seed": 123
      }
    }
  ],
  "warnings": []
}
```

Arcadia does not trust this manifest blindly. It verifies that each path stays
under `output/`, exists, has a supported image MIME type (`image/png` or
`image/jpeg`), has readable dimensions, and matches any declared MIME type or
dimensions. Arcadia computes its own SHA-256 and byte size when persisting the
artifact.

The completed job result remains:

```json
{
  "artifacts": [
    {
      "id": "iart_...",
      "kind": "image",
      "uri": "/api/intelligence/artifacts/iart_...",
      "mimeType": "image/png",
      "sha256": "...",
      "byteSize": 12345,
      "dimensions": { "width": 1024, "height": 1024 },
      "metadata": { "seed": 123 }
    }
  ],
  "generation": { "requestedCount": 1, "returnedCount": 1 }
}
```

## Setup

Default Codex invocation:

```sh
codex exec --skip-git-repo-check --ephemeral --sandbox workspace-write -C "{workspace}" -
```

`{workspace}` is replaced with the isolated job workspace. Override if needed:

```sh
ARCADIA_CODEX_CLI_COMMAND=codex
ARCADIA_CODEX_CLI_ARGS='["exec","--skip-git-repo-check","--ephemeral","--sandbox","workspace-write","-C","{workspace}","-"]'
ARCADIA_CODEX_CLI_TIMEOUT_MS=120000
```

The local Codex CLI must be installed, authenticated, and able to satisfy the
image request locally. Arcadia does not configure Codex auth and does not fall
back to external services automatically.

## Smoke check

Run a single local Codex image job through the normal SQLite job lifecycle:

```sh
ARCADIA_CODEX_IMAGE_ROUTE=codex-cli \
pnpm arcadia intelligence smoke-image \
  --workspace ./tmp/demo-workspace \
  --prompt "a simple black square centered on a white background" \
  --json
```

This command submits a normal `image.generate` request, runs one worker pass,
and returns the terminal job plus artifact URIs. It does not start the HTTP
API. Fetch artifact bytes through the API when running `intelligence serve`,
or inspect the persisted artifact metadata in SQLite and files under
`artifacts/intelligence/<job-id>/`.

## Failure handling

Codex image jobs end in normal Intelligence terminal states:

- `blocked / CODEX_CLI_UNAVAILABLE`: command missing or Codex executor not configured
- `failed / CODEX_CLI_TIMEOUT`: command exceeded timeout
- `failed / CODEX_CLI_NONZERO_EXIT`: command exited nonzero
- `failed / CODEX_MISSING_MANIFEST`: `output/manifest.json` missing
- `failed / CODEX_MISSING_IMAGE_FILE`: manifest declared a missing file
- `failed / CODEX_INVALID_IMAGE`: MIME type or dimensions are invalid
- `failed / CODEX_MANIFEST_VALIDATION_FAILED`: manifest shape or declarations are invalid
- `failed / EXECUTION_ERROR`: unexpected artifact persistence or runtime error

Logs remain in the isolated job workspace for audit.

## Companion app usage

Rebuster or any other app submits:

```ts
const request: IntelligenceRequest = {
  idempotencyKey: `rebuster-image-${Date.now()}`,
  operationId: "rebuster.generate-image-candidates",
  clientApp: "rebuster",
  capability: "image.generate",
  execution: "local-required",
  profile: "quality",
  requirements: { imageSize: "1024x1024", transparency: false },
  input: {
    prompt: "a rebus tile for ICE + CREAM, flat illustration style",
    n: 1
  },
  outputContract: {
    schemaId: "rebuster.generated-image.v1",
    schemaVersion: 1,
    jsonSchema: {
      type: "object",
      properties: { artifacts: { type: "array", minItems: 1 } },
      required: ["artifacts"]
    }
  },
  template: { id: "rebuster.image-candidates-prompt", version: "1" },
  executionPolicy: { allowPaidUsage: false, maxRetries: 1 }
};
```

Then poll `waitForCompletion(job.id)`. On `completed`, read
`job.result.artifacts[*].uri` and fetch bytes with
`ArcadiaIntelligenceClient.getArtifact(uri)`.
