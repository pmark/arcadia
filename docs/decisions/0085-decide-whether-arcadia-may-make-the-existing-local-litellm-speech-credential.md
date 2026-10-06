---
arcadia: v1
type: decision
id: "0085"
slug: decide-whether-arcadia-may-make-the-existing-local-litellm-speech-credential
project: arcadia
status: open
question: "Decide whether Arcadia may make the existing local LiteLLM speech credential available solely to render the requested Issue #944 podcast WAV."
gap_type: missing-decision
gate_question: approval_boundary
recommendation: Authorize one local-only render
options:
  - label: Authorize one local-only render
    consequence: "Make the already-configured local speech credential available to one `arcadia intelligence narrate` run for Issue #944. The resulting WAV stays in the local Arcadia workspace; no public URL, cloud mirror, blog, or podcast feed is created."
    recommended: true
  - label: Do not use credentials
    consequence: Leave the asset uncreated and retain the recorded 401 failure. The code PR remains available, but no narration is rendered until a later approved route or credential decision.
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-10-06
---

# Decision 0085: Decide whether Arcadia may make the existing local LiteLLM speech credential available solely to render the requested Issue #944 podcast WAV.

## Options

- **Authorize one local-only render** (recommended): Make the already-configured local speech credential available to one `arcadia intelligence narrate` run for Issue #944. The resulting WAV stays in the local Arcadia workspace; no public URL, cloud mirror, blog, or podcast feed is created.
- **Do not use credentials**: Leave the asset uncreated and retain the recorded 401 failure. The code PR remains available, but no narration is rendered until a later approved route or credential decision.

## Rationale

The reviewed narration command reaches the configured local speech route but receives 401 because no credential is passed. Credential use is an approval boundary. This Decision does not select a provider, disclose a secret, publish audio, mirror it to cloud storage, or alter the Artifact System proposal.

Proposed by Agent Ask decide-local-speech-credential-for-issue-944-podcast-2026-10-05.
