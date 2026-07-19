# Text-to-speech local smoke test

This verifies `audio.speech.generate` end-to-end through the normal Arcadia
Intelligence worker loop, against the **already-running local LiteLLM proxy**
Arcadia uses for every AI capability except coding agents. Arcadia does not
start, stop, or manage LiteLLM or whatever TTS backend LiteLLM proxies to — it
only submits a job and reads the durable artifact.

Speech is LiteLLM-routed exactly like text and image generation: Arcadia posts
to LiteLLM's OpenAI-compatible `/audio/speech` endpoint with a **model alias**
(e.g. `arcadia-tts`), and LiteLLM's own config decides which backend that
alias maps to. Arcadia has no knowledge of what's behind the alias — any
LiteLLM-proxied TTS backend that speaks the OpenAI `/audio/speech` contract
works (e.g. a local MLX-based server running a Kokoro model).

## 1. Add a TTS alias to LiteLLM's config

In LiteLLM's `config.yaml`, add a model entry whose alias points at your TTS
backend, e.g.:

```yaml
model_list:
  - model_name: arcadia-tts
    litellm_params:
      model: openai/Kokoro-82M-bf16
      api_base: http://127.0.0.1:8000
      api_key: <your local TTS server's key>
```

Restart LiteLLM so it picks up the new alias. Confirm it's live:

```sh
curl http://127.0.0.1:4000/v1/models -H "Authorization: Bearer $ARCADIA_LITELLM_API_KEY" | grep arcadia-tts
```

## 2. Point Arcadia at the alias

```sh
export ARCADIA_SPEECH_LOCAL_ROUTE=arcadia-tts   # the LiteLLM alias from step 1
# Optional: override the semantic voice map if your model uses other voice names
# export ARCADIA_SPEECH_VOICE_MAP='{"arcadia.narrator":"af_heart"}'
```

`ARCADIA_LITELLM_BASE_URL` / `ARCADIA_LITELLM_API_KEY` (already configured for
text/image) are reused as-is — speech has no separate endpoint or credential.

Semantic voices map to provider voices via a built-in default
(`arcadia.narrator` → `af_heart`, `arcadia.narrator.warm` → `af_bella`,
`arcadia.narrator.crisp` → `am_michael`), overridable with
`ARCADIA_SPEECH_VOICE_MAP`.

## 3. Run the smoke command

```sh
pnpm arcadia intelligence smoke-speech \
  --workspace ./tmp/demo-workspace \
  --text "Can you solve this rebus?" \
  --voice-id arcadia.narrator \
  --json
```

This submits one `audio.speech.generate` request and runs a single worker tick.
On success it prints the job status, resolved route, provider, artifact URI, and
duration. The `--json` form emits the full `CommandSuccess` payload.

## What it proves

- **The job completes through the normal worker loop** — same
  submit → resolve route → LiteLLM → validate → persist path as text and image.
- **The artifact exists** — bytes are written atomically under
  `<workspace>/artifacts/intelligence/<jobId>/` and tracked in
  `intelligence_job_artifacts` (with `sha256`, `byte_size`, `duration_seconds`,
  `sample_rate_hz`, `channels`).
- **The WAV is decodable and `durationSeconds > 0`** — Arcadia inspects the WAV
  header deterministically; an undecodable payload fails the job instead of
  persisting a bad artifact.
- **Route metadata indicate local execution** — `routeId` is
  `arcadia.audio.speech.generate.local.standard`, and the server log line reads
  `via LOCAL route ...`. Local speech never silently escalates to a paid cloud
  route.

## Retrieving the audio

The result manifest is an `IntelligenceSpeechGenerationResult`; its
`artifact.uri` is a durable locator. Fetch the bytes with
`GET {uri}` or `ArcadiaIntelligenceClient.getArtifact(uri)` — see
[`examples/speech-generation-example.ts`](./examples/speech-generation-example.ts)
for a full submit → poll → download walkthrough a companion app (e.g. Rebuster)
would use.

## Failure modes (all surface clearly, none silent)

| Condition | Job status | `error.code` |
| --- | --- | --- |
| No local speech route configured (`ARCADIA_SPEECH_LOCAL_ROUTE` unset) | `blocked` | `ROUTE_NOT_CONFIGURED` |
| LiteLLM proxy unreachable / 5xx / timeout | `blocked` | `SPEECH_UNAVAILABLE` |
| Alias resolves to a backend that's down | `blocked` | `SPEECH_UNAVAILABLE` |
| Provider returns a non-audio response | `failed` | `SPEECH_INVALID_CONTENT_TYPE` |
| Audio bytes are not decodable WAV | `failed` | `SPEECH_UNDECODABLE_AUDIO` |
| Unknown semantic `voiceId` | `failed` | `SPEECH_UNKNOWN_VOICE` |
