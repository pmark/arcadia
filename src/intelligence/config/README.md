# Arcadia Intelligence Configuration

v0.1 intentionally supports one configured LiteLLM route.

Do not add provider-specific settings here.

The intended future configuration shape is:

- one local LiteLLM endpoint
- one approved route for generic structured generation
- paid fallback disabled
- one retry maximum
- SQLite-backed durable jobs

Codex should reconcile this configuration with Arcadia’s existing environment,
configuration, secrets, and database patterns before implementation.
