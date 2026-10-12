# Shared read-aloud and MP3 artifacts

Arcadia Intelligence owns speech generation, long-text chunking, CPU MP3 encoding,
job state and durable audio bytes. Companion apps own the text, summaries and
source meaning. Audio is retrieved through the existing range-aware artifact
endpoint; no separate audio server, temporary file URL or provider URL is needed.

## Request

Submit the normal `audio.speech.generate` job with
`input: { text, voiceId: "arcadia.narrator", format: "mp3" }`.
WAV remains the default for existing callers. Use `local-required`, `standard`,
and `allowPaidUsage: false` for unpaid local narration. The generic client's
`audio.defineSpeechOperation` accepts either format; `IntelligenceSpeechInput`
and `IntelligenceSpeechGenerationResult` are public companion-app contracts.

A completed result contains `artifact.id`, `uri`, `mimeType`, `format`, SHA-256,
byte size, duration, sample rate and channels, plus `chunkCount` and route/voice
provenance. Poll the job until terminal; then use the artifact URI. Generation
can outlive a page load or HTTP request. Completed jobs and artifacts remain in
the workspace after server/page restarts.

MP3 uses FFmpeg with libmp3lame on the Intelligence host's PATH. A custom
executable can be set with `ARCADIA_FFMPEG_COMMAND`. The provider is asked for
WAV; Intelligence concatenates compatible PCM and performs encoding once.
MP3 output is mono at 24 kHz with a constant 64 kbit/s bitrate, so duration
and seeking do not depend on a seekable-file VBR header; reported duration is the original narrated PCM
length, with small encoder padding possible in the compressed file. No silent
WAV or paid/cloud fallback occurs when MP3 was requested. Missing FFmpeg is a
`MP3_ENCODER_UNAVAILABLE` blocked job, detected before provider inference.

Limits: 100,000 text characters, 256 utterance chunks, and 128 MiB of generated
PCM. The existing speech resource pool and renewable lease govern long jobs.
The encoder has a 60-second CPU deadline and a 64 MiB output bound. Existing
single-retry rules apply; exhausted jobs do not create unbounded retries.

## Dashboard integration

`POST /api/read-aloud` accepts `{ text }`, requests the generic local MP3 job,
and returns its reference immediately. A content/voice/format/template hash
keys reuse: identical narration reuses the completed asset; changed text gets
a new job. A repeated Play can request the existing bounded retry of a failed
job. It cannot reset Intelligence's retry budget.

`ReadAloud` is the shared player. Its default endpoint is `/api/read-aloud`;
other surfaces can use `<ReadAloud request={{ text: decisionText }} />` when
that text is already prepared. It polls the existing job endpoint, plays the
stable same-origin artifact URL and downloads through the existing artifact
proxy. The proxy supports byte ranges for iPhone Safari and attachment downloads.
Playback is initialized during the user's original tap. A browser's explicit
playback refusal remains visible and recoverable with the native controls.

The Outstanding PR page provides the first application workflow. It reads the
current original description, prepares a bounded local TLDR through a separate
`text.generate` job, and submits TLDR plus the original body as one speech job.
Markdown punctuation is normalized for speech; the original GFM description is
rendered below the generated TLDR. Comments are excluded. A missing/failed TLDR
is labelled, and original-body narration remains available without cloud fallback.
Opening the page or reading the original description performs no model call;
summary and speech start on Play. Merged PR links work even when the configured
repository has no open PRs, using the configured-repository registry projection.

The standalone PR1308 Tailnet page is a preserved test artifact. Once the
reviewed change is installed in the managed services, normal Dashboard routes
and the Intelligence artifact store replace that temporary delivery path.
Retiring its exact owned listener is part of that approved installation step;
it must not alter other listeners or Tailnet proxy configuration.

Future long-form surfaces should supply text to this shared player. No global
read-aloud menu, automatic narration on page load, voice marketplace, comments
pipeline or separate asset database is introduced here. Add those only when a
concrete follow-up is approved/requested.
