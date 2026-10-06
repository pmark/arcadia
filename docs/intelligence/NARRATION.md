# Narration (podcast) from text or an issue thread

`arcadia intelligence narrate` turns a long piece of text — a literal string, a
local file, or a GitHub issue's full comment thread — into one playable WAV. It
reuses the same `audio.speech.generate` capability, worker loop, route
resolution, and durable artifact store as `smoke-speech`; it adds only the
long-form plumbing: deterministic chunking, per-chunk synthesis, and WAV
concatenation. No new provider, endpoint, or credential is introduced, and no
media-editing dependency is required.

## Prerequisites

Same as [`SPEECH_SMOKE.md`](./SPEECH_SMOKE.md): a LiteLLM-proxied TTS backend
whose alias is exported as `ARCADIA_SPEECH_LOCAL_ROUTE`, and the shared
`ARCADIA_LITELLM_BASE_URL` / `ARCADIA_LITELLM_API_KEY`. Speech is local-only
(`allowPaidUsage: false`); it never silently escalates to a paid cloud route.

`--issue` additionally needs an authenticated `gh` CLI, since it reads the issue
and its comments with `gh issue view --json`.

## Usage

```sh
# A GitHub issue and every comment, in one file
pnpm arcadia intelligence narrate \
  --workspace "$WORKSPACE" \
  --issue https://github.com/pmark/arcadia/issues/944 \
  --out "$WORKSPACE/artifacts/narration/issue-944.wav" \
  --json

# A local file
pnpm arcadia intelligence narrate --workspace "$WORKSPACE" --file ./notes.md --out ./notes.wav

# Inline text
pnpm arcadia intelligence narrate --workspace "$WORKSPACE" --text "Welcome to the show."
```

Exactly one of `--text`, `--file`, or `--issue` is required. `--issue` accepts a
full URL, `owner/repo#number`, or a bare number with `--repo owner/name`.

Options: `--voice-id` (default `arcadia.narrator`), `--route`, `--out`
(default `<workspace>/artifacts/narration/narration-<timestamp>.wav`),
`--max-chunk-chars` (default 1200), and `--idempotency-key`.

## How it works

1. The source is split by `splitNarrationText` — preferring paragraph breaks,
   then sentence breaks, and hard-wrapping only an oversized single token.
   Identical input yields identical chunks, so retries are idempotent.
2. Each chunk is submitted as an ordinary `audio.speech.generate` request and
   run through one worker tick; its bytes are validated (decodable WAV) and
   persisted as a durable audio artifact.
3. `concatWavBuffers` requires every clip to share one sample rate, channel
   count, and bit depth, then concatenates the PCM data behind one canonical
   header. A mismatch fails loudly rather than producing a file that plays back
   at the wrong speed.
4. The combined WAV is written to `--out`. Existing per-chunk artifacts remain
   in the workspace as ordinary Intelligence job artifacts.

For issue sources, each comment is spoken with its author's name, preferring a
*trailing* agent signature line (`— Claudia Mason <…>`) over the GitHub login so
a multi-platform thread is attributed correctly. Only an em/en dash starts a
signature — a Markdown list item is never mistaken for one. Markdown
punctuation is neutralised for speech without dropping words: emphasis markers,
links, headings, quotes and list markers are removed while their words are kept,
and a fenced code block is unwrapped rather than discarded.

Chunk idempotency keys are derived from the base key plus the chunk index, so a
retry of the same source reuses the same jobs. Reusing an explicit
`--idempotency-key` with *changed* text returns the prior job's audio for that
key rather than re-synthesizing; pick a fresh key when the text changes.

## Failure modes

| Condition | Result |
| --- | --- |
| No source, or more than one source | `VALIDATION_ERROR` before any job |
| Empty source text | `VALIDATION_ERROR` |
| No local speech route / LiteLLM unreachable | the chunk job is `blocked`; the command fails and writes no output |
| Unknown semantic `voiceId` | the chunk job is `failed`; the command fails and writes no output |
| `gh` missing or issue unreadable | `UNEXPECTED_ERROR` naming the repo, issue, and `gh` output |
| Clips differ in sample rate/channels/bit depth | concatenation throws; no output written |
