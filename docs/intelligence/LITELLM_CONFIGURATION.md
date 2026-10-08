# Local LiteLLM model configuration

This guide describes the **current local macOS setup** as observed on
2026-10-06. It separates the two configuration layers that are easy to
confuse:

1. **LiteLLM decides which provider/backend model an alias means.**
2. **Arcadia decides which LiteLLM alias a semantic route uses.**

Changing an underlying model generally needs one edit at each layer. Companion
apps, including Rebuster, do neither: they request a capability and Arcadia
selects the semantic route.

## Current local topology

```
Arcadia Intelligence / Rebuster
        │ semantic route (for example, local speech)
        ▼
Arcadia route environment ──► LiteLLM alias (for example, arcadia-tts)
                                      │
                                      ▼
                          provider/backend model
```

The local LiteLLM proxy is the Docker container `litellm-proxy`, with
`litellm-postgres` as its database dependency. It listens on port `4000`.
Arcadia talks to it through the OpenAI-compatible API; it does not call model
providers directly.

## Files and settings to change

| Goal | Change this | Do not change this |
| --- | --- | --- |
| Point an existing LiteLLM alias at a different backend/provider model | The local, untracked LiteLLM config: `../litellm-database/litellm_config.docker.yaml`, under `model_list` | Arcadia source code or a companion app |
| Give the new LiteLLM alias a different name | The same `model_list[].model_name` value | An Arcadia route variable until the alias is available |
| Change which alias Arcadia uses for text, cloud text, cloud image, or speech | The environment of the Arcadia Intelligence process; use the `ARCADIA_*_ROUTE` variables below | A request from Rebuster or any other companion app |
| Change which semantic routes Arcadia supports or their defaults | `src/intelligence/config/defaults.ts` (code change, test and PR required) | The LiteLLM config alone |
| Change a semantic voice mapping | The Intelligence-process `ARCADIA_SPEECH_VOICE_MAP` environment variable | `model_list` unless the backend/model itself changes |

`litellm_config.docker.yaml` is a **local runtime file**, not an Arcadia
repository file. It can contain credentials; never commit it, paste it into an
Issue, or copy values from it into a shell script. The checked-in
`scripts/apple/com.litellm.proxy.plist` is only a launchd reference template;
it starts Docker Compose but does not define model aliases.

### Arcadia alias-selection variables

Set these in the environment used to launch Arcadia Intelligence. An unset
optional variable disables that route. `ARCADIA_LITELLM_BASE_URL` defaults to
`http://127.0.0.1:4000`; `ARCADIA_LITELLM_API_KEY` is the LiteLLM *proxy*
credential, never an upstream provider key.

| Variable | Current intended alias | Purpose |
| --- | --- | --- |
| `ARCADIA_LITELLM_LOCAL_TEXT_ROUTE` | `arcadia-default` | Local text generation |
| `ARCADIA_LITELLM_CLOUD_TEXT_ROUTE` | `arcadia-cloud-text` | Cloud text generation (still requires per-request paid-use authority) |
| `ARCADIA_LITELLM_CLOUD_IMAGE_ROUTE` | `arcadia-cloud-image` | Cloud image generation (still requires per-request paid-use authority) |
| `ARCADIA_SPEECH_LOCAL_ROUTE` | `arcadia-tts` | Local text-to-speech |
| `ARCADIA_SPEECH_CLOUD_ROUTE` | *(unset)* | Optional cloud text-to-speech |

The exact route registry and defaults are implemented in
[`src/intelligence/config/defaults.ts`](../../src/intelligence/config/defaults.ts).
See [ROUTING.md](./ROUTING.md) for its semantic capability/profile matrix.

> **Current installation gap:** the checked-in service adapter delegates to an
> operator-installed launchd script, and the live Intelligence service was
> observed without the proxy credential or speech-route variables. Until
> [#1003](https://github.com/pmark/arcadia/issues/1003) supplies a managed
> local secret/config source and doctor command, do not treat a shell export as
> a durable service configuration. Use the bounded local-only recovery process
> recorded there; never encode a credential in the repository or launchd
> template.

## Current alias inventory

The local proxy reported these aliases on 2026-10-06. This is an operational
snapshot, not a promise that every alias is an Arcadia route.

| LiteLLM alias | Current provider/backend model | Arcadia use |
| --- | --- | --- |
| `arcadia-default` | `openai/Qwen2.5-Coder-14B-Instruct-4bit` via the local OpenAI-compatible backend | Default local text alias |
| `arcadia-local-text` | `openai/Qwen2.5-Coder-14B-Instruct-4bit` via the local OpenAI-compatible backend | Available alias; not the intended default above |
| `arcadia-cloud-text` | `openai/gpt-5.6-luna` | Intended cloud text alias |
| `arcadia-cloud-image` | `gpt-image-2` | Intended cloud image alias |
| `arcadia-tts` | `openai/mlx-community/Kokoro-82M-bf16` via the local OpenAI-compatible backend | Intended local speech alias |
| `qwen-coder` | `openai/Qwen2.5-Coder-14B-Instruct-4bit` | Available direct proxy alias, not an Arcadia semantic route by default |
| `qwen-coder-1_5` | `openai/Qwen2.5-Coder-1.5B-Instruct-4bit` | Available direct proxy alias, not an Arcadia semantic route by default |
| `gpt-5.4-nano` | `gpt-5.4-nano` | Available direct proxy alias, not an Arcadia semantic route by default |
| `gpt-image-2` | `openai/gpt-image-2` | Available direct proxy alias, not an Arcadia semantic route by default |

## Safe model-change sequence

1. Edit the desired `model_list` entry in
   `../litellm-database/litellm_config.docker.yaml`. Preserve its alias unless
   an alias rename is intentional.
2. Restart **only** `litellm-proxy` using the bounded service procedure; do not
   restart Docker Desktop or unrelated Arcadia services.
3. Authenticate to `GET /v1/models` with the existing local proxy credential
   and confirm the alias is present. Do not use LiteLLM's broad `/health` route
   as an authentication-only test: it also performs deployment health work and
   can be slow or unavailable for reasons unrelated to token validity.
4. If the alias name changed, update the matching Arcadia process environment
   variable from the table above and restart Arcadia Intelligence through its
   managed service procedure once the configuration mechanism in [#1003] is
   available.
5. Run the narrow capability smoke test: for speech, follow
   [SPEECH_SMOKE.md](./SPEECH_SMOKE.md); for text/image, submit one explicitly
   authorized local job. A successful LiteLLM alias inventory does not prove a
   backend can produce valid output.

## Manage the local LiteLLM service

Changing `model_list`, an alias, a backend `api_base`, or a backend model in
`../litellm-database/litellm_config.docker.yaml` requires a **single restart
of `litellm-proxy`**. LiteLLM reads that file at startup; Arcadia cannot make a
running proxy reload it.

Before a restart, check whether a managed-production window is active:

```sh
pnpm -s arcadia production status --json
```

If its display state is `Active`, defer the restart until the terminal Off
receipt, unless the operator explicitly authorizes that one interruption. A
LiteLLM restart changes the shared local provider boundary even though it is
not one of Arcadia's four launchd services.

When the window is inactive, use this exact bounded procedure:

```sh
# Confirm the target. Do not substitute a container ID or a broad Docker command.
docker ps --filter name=litellm-proxy --format '{{.Names}} {{.Status}} {{.Ports}}'

# Reload only the LiteLLM proxy after a configuration change.
docker restart litellm-proxy

# Wait for the proxy's unauthenticated liveness endpoint to respond.
curl -fsS http://127.0.0.1:4000/health/liveliness
```

`litellm-postgres` stays running: it is the proxy's dependency, not a normal
part of a model-config reload. Do **not** restart Docker Desktop, use
`docker compose up` as a substitute, or restart Arcadia Intelligence, the
worker, dashboard, or Discord bot just because LiteLLM's model config changed.

If liveness does not recover, stop after that bounded restart and collect only
non-secret diagnostics:

```sh
docker ps --filter name=litellm-proxy --format '{{.Names}} {{.Status}}'
docker logs --tail 100 litellm-proxy
```

Do not repeatedly restart the container and do not paste its configuration or
environment into an Issue: either can expose credentials while obscuring the
first useful failure. See [#1003](https://github.com/pmark/arcadia/issues/1003)
for the planned managed doctor and installation flow.

Liveness proves only that the proxy process has started. Then use the safe
model-change sequence above to verify the intended alias and run the narrow
capability smoke test; an authenticated model inventory proves proxy access,
while the smoke test proves the changed backend can actually serve requests.

## What not to edit for a normal model change

- Do not change `src/intelligence/litellm/httpClient.ts`; it is the generic
  transport, not a model registry.
- Do not change a companion application's provider configuration to choose a
  LiteLLM model. Rebuster deliberately depends on Arcadia's semantic routes.
- Do not add a provider API key to `ARCADIA_LITELLM_API_KEY`; that variable is
  only for the local LiteLLM proxy.
- Do not use `scripts/bootstrap-arcadia-intelligence-v0.1.sh`; it is a historic
  bootstrap artifact, not the live configuration surface.
