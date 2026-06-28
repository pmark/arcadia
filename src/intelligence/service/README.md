# Arcadia Intelligence v0.1 Service

The service is a generic local API and in-process worker.

It accepts app-defined structured generation requests and does not understand
their domain meaning.

The service owns:

- durable jobs
- route authorization
- one LiteLLM execution path
- result validation
- retry behavior
- generic status and error states

The service does not own:

- companion-app prompt content
- companion-app schemas
- companion-app workflow state
- provider-specific SDKs
- budgets, quotas, caching, image generation, Codex execution, or routing logic
  beyond the single configured LiteLLM route in v0.1.
