# Data Model And Provenance

## Smallest Arcadia-Side Additions

Use a capability module first. Proposed tables:

- `intelligence_requests`: request metadata, Project attribution, capability, policy result, status, hashes, idempotency key, correlation ID, timestamps.
- `intelligence_executions`: executor attempt metadata, executor class, LiteLLM endpoint label, model alias, provider metadata, usage/cost fields, validation status, error summary.
- `intelligence_artifact_links`: request-to-Artifact links if the existing `artifacts` table is not enough for many-to-many links.

Prefer linking to existing core records:

- Project through `project_id`.
- Action through `work_item_id`.
- Artifact through `artifacts`.
- Decision through `review_items`.
- Log through `mission_logs`.
- Events through `events`.

## Request Metadata

Store:

- `id`
- `idempotency_key`
- `correlation_id`
- `project_id`
- `work_item_id`
- `capability`
- `output_contract`
- `quality_tier`
- `execution_mode`
- `cost_policy_json`
- `policy_version`
- `policy_decision_json`
- `status`
- `input_hash`
- `prompt_template_id`
- `prompt_template_version`
- `created_at`
- `updated_at`

## Execution Metadata

Store:

- `request_id`
- `attempt`
- `executor_class`
- `executor_alias`
- `litellm_endpoint_label`
- `litellm_request_id`
- `model_alias`
- `provider_name`
- `provider_model`
- `finish_reason`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `estimated_cost_usd`
- `reported_cost_usd`
- `result_validation_status`
- `result_validator_version`
- `output_hash`
- `error_code`
- `error_summary`
- `started_at`
- `completed_at`

## Idempotency And Hashes

Idempotency should use caller-provided keys when present. Otherwise derive a stable key from Project ID, capability, output contract, normalized input hash, and policy-relevant options.

Input and output hashes should use SHA-256 over canonical JSON for structured data. Hashes are for dedupe and audit, not security.

## Data Outside SQLite

Do not store credentials, raw provider keys, large media assets, or large prompt/output payloads in SQLite. Store large or human-readable outputs under `artifacts/` or `prompts/` with Artifact records and hashes in SQLite.

Prompt bodies may be persisted as Artifacts only when useful for audit and scrubbed for secrets. Sensitive request bodies should use hashes and summaries.

## Migration And Retention

Capability migrations should create the first tables. A later core migration is justified only if multiple capabilities need shared query surfaces.

Retention should keep metadata, hashes, costs, and Artifact links indefinitely by default. Raw prompt/output files should be retainable per Project policy with a future cleanup command.
