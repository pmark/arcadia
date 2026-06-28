# First Vertical Slice

## Objective

Prove one structured text capability through Arcadia policy and a local LiteLLM-backed executor path, without building direct Rebuster integration.

## Scope

The slice accepts a `structured_text.generate` request with Project attribution and a `structured_text_list_v1` output contract. It evaluates policy, optionally calls a configured local LiteLLM-compatible endpoint, validates JSON output, creates an Artifact, records provenance, emits an event, and exposes the result through CLI JSON and dashboard snapshot.

## User-Visible Success Criteria

- `arcadia intelligence health --json` reports disabled, unavailable, or healthy without exposing secrets.
- `arcadia intelligence request ... --json` returns `accepted` with an Artifact path when the fake or local LiteLLM endpoint returns valid structured JSON.
- `arcadia intelligence show <id> --json` shows Project, capability, routing decision, validation, Artifact, and cost/usage fields.
- Dashboard snapshot includes gateway health and recent request summary.
- A denied request explains the policy reason and does not call the executor.

## Failure Cases

- Feature disabled: request is denied before executor call.
- Missing Project: validation error.
- Missing LiteLLM config: unavailable or Needs Mark.
- Paid fallback denied: denied before executor call.
- Endpoint unavailable: failed execution with retry-safe status.
- Invalid JSON or schema mismatch: `invalid_result`, no ready Artifact.
- Duplicate idempotency key: returns the original request result or safe duplicate status.

## Deliberately Out Of Scope

- Direct Rebuster calls.
- Chat sessions.
- Image, audio, or video generation.
- Codex-as-provider execution.
- Remote multi-user API.
- Provider budget reimplementation.
- Automatic paid fallback.
