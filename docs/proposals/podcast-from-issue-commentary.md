---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia turn a GitHub issue's commentary (or any long text) into a narrated podcast through its local text-to-speech route?
---

# Podcast from issue commentary

## Why this project needs it

The Intelligence speech capability (`audio.speech.generate`) exists and is
proven end to end, but it is only reachable as a single-utterance smoke check
(`arcadia intelligence smoke-speech`). There is no way to narrate a real
document — an article, a report, or a long multi-author issue thread — even
though the underlying route, worker, and durable artifact store already do the
hard part.

The immediate trigger: the operator asked for a podcast from the commentary on
[Issue #944](https://github.com/pmark/arcadia/issues/944). The thread is a
multi-platform conversation, so a faithful narration has to preserve who said
what, split a long source into provider-sized utterances, and stitch the clips
back into one playable file. None of that is a new provider capability; it is
missing long-form plumbing over a capability that already works.

## What we would build locally

A local script that calls the LiteLLM `/audio/speech` endpoint directly,
re-deriving route resolution, artifact persistence, WAV validation, chunking,
and speaker attribution. That is exactly the kind of ad-hoc reimplementation
this proposal exists to avoid: it would drift from the Intelligence worker's
routing and paid-usage guards, and it would live outside the workspace's
artifact store.

## Proposed smallest form

One CLI command — `arcadia intelligence narrate` — that reuses the existing
speech job path and adds only deterministic pure helpers:

- `splitNarrationText` (paragraph/sentence/hard-wrap chunking, idempotent);
- `concatWavBuffers` (same-format PCM concatenation behind one canonical
  header);
- `formatIssueCommentary` (issue + comments read read-only via `gh`, each
  comment attributed by its agent signature or GitHub login, Markdown
  neutralised for speech).

The first slice (a single-narrator narration of one source into one WAV) is
implemented in the same change that files this proposal; per-speaker voice
casting, background music, and RSS/feed packaging are deliberately not built
yet. The trigger for revisiting them is a real second request for a
multi-voice or feed-published podcast.
