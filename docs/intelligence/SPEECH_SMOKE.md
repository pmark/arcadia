# Text-to-speech local smoke test

This verifies `audio.speech.generate` end-to-end through the normal Arcadia
Intelligence worker loop, against an **already-running** OpenAI-compatible
`/v1/audio/speech` server on the same Mac. Arcadia does not start, stop, or
manage the TTS server — it only submits a job and reads the durable artifact.

The reference local provider is an [MLX-Audio](https://github.com/Blaizzy/mlx-audio)
server using the Kokoro model, but any server that speaks the OpenAI
`/v1/audio/speech` contract works — the adapter is provider-neutral.

## 1. Start a local OpenAI-compatible TTS server

Start your MLX-Audio/Kokoro (or equivalent) server so that
`POST http://127.0.0.1:8000/v1/audio/speech` accepts
`{ "model": "...", "input": "...", "voice": "...", "response_format": "wav" }`
and returns WAV bytes with an `audio/wav` Content-Type.

## 2. Point Arcadia at it

```sh
export ARCADIA_SPEECH_LOCAL_BASE_URL=http://127.0.0.1:8000
export ARCADIA_SPEECH_LOCAL_ROUTE=kokoro   # the model/alias your server expects
# Optional: override the semantic voice map if your model uses other voice names
# export ARCADIA_SPEECH_VOICE_MAP='{"arcadia.narrator":"af_heart"}'
```

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
  submit → resolve route → adapter → validate → persist path as text and image.
- **The artifact exists** — bytes are written atomically under
  `<workspace>/artifacts/intelligence/<jobId>/` and tracked in
  `intelligence_job_artifacts` (with `sha256`, `byte_size`, `duration_seconds`,
  `sample_rate_hz`, `channels`).
- **The WAV is decodable and `durationSeconds > 0`** — Arcadia inspects the WAV
  header deterministically; an undecodable payload fails the job instead of
  persisting a bad artifact.
- **Route and provider metadata indicate local execution** — `routeId` is
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
| No local speech route configured | `blocked` | `ROUTE_NOT_CONFIGURED` |
| `ARCADIA_SPEECH_LOCAL_BASE_URL` unset | `blocked` | `SPEECH_UNAVAILABLE` |
| TTS server unreachable / 5xx / timeout | `blocked` | `SPEECH_UNAVAILABLE` |
| Provider returns a non-audio response | `failed` | `SPEECH_INVALID_CONTENT_TYPE` |
| Audio bytes are not decodable WAV | `failed` | `SPEECH_UNDECODABLE_AUDIO` |
| Unknown semantic `voiceId` | `failed` | `SPEECH_UNKNOWN_VOICE` |
