# Future Executors And Companion Apps

## Local Ollama Models

Ollama or another local model runtime may fit when it can reliably satisfy a capability contract, run locally without credentials, and expose health and failure states. Evidence needed: acceptable quality on fixture prompts, bounded latency, deterministic-enough output validation, and no hidden cost.

## Codex CLI

Codex CLI should remain a future optional executor for planning or implementation workflows, not a normal API model. Evidence needed: stable non-interactive auth, usage-limit visibility, completion semantics, safe sandboxing, and clear handling of interactive constraints.

## Cloud Providers

Cloud providers should stay behind LiteLLM aliases. Direct provider SDKs are justified only if LiteLLM cannot support a required provider capability and the need is proven by a concrete Project.

## Image, Audio, And Video

Media generation is out of current scope. Evidence needed: a specific Project workflow, Artifact storage/retention policy, cost controls, review requirements, and validation approach.

## Companion Apps

Rebuster should eventually request capabilities and validate domain outputs rather than call specific providers directly. Rebuster owns creative state and strict spec validation; Arcadia owns Project policy, attribution, Decisions, Logs, and provider access policy.

## Adding Executor Types

Add an executor type only when:

- at least one Project needs it,
- it can satisfy a stable capability contract,
- policy can make deterministic decisions about it,
- failures are observable,
- cost and credentials are controlled,
- tests can run without paid credentials by default.
