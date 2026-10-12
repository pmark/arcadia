# PR body audio — candidate evidence, 2026-10-12

Operator-directed implementation; no governed Action exists for this request.
The active Plan/current Action (`replay-environment-wall-session`), queue and
other candidates were not changed. Candidate: `codex/pr-body-audio`.

Operator request: “I want a simple Arcadia utility built into the existing pull requests page that uses text-to-speech in order to produce an audio file so that I can have the pull request text read aloud to me. I just want to hit a play button and have it read to me. Start with just the body and then we'll figure out what to do about comments. Ideally it would be converted to MP3.”

## Behavior and validation

- Outstanding PR cards provide Play body, an audio player and download. Only the GitHub body enters local narration; Markdown formatting is stripped while body words/code are retained. Comments and titles are excluded.
- Existing local-required Intelligence narration chunks and joins WAV; the Dashboard encodes MP3 using FFmpeg, falling back to WAV if conversion is unavailable. No paid/cloud fallback is introduced.
- Only configured open PR inventory entries can reach the endpoint. In-flight duplicate requests share synthesis; other simultaneous PR generation is refused within a Dashboard process. Temporary combined files are removed after success/failure; ordinary durable Intelligence chunk artifacts follow the existing store lifecycle.
- 30 tests passed across PR narration source, audio generation, HTTP endpoint, existing narration command and PR inventory suites.
- Full lint and core/Discord build passed. Final focused lint and Dashboard production build also passed.
- An actual FFmpeg encode of a synthetic PCM WAV was inspected with FFprobe: MP3 format, 0.1-second duration.
- Browser test: isolated Next dev server at `http://127.0.0.1:3041/admin/pull-requests`, Chromium with `--autoplay-policy=user-gesture-required`, 390×844 viewport, mocked inventory and delayed audio endpoint. One click starts the element synchronously; delayed MP3 plays and a download appears, with exactly one synthesis request. Server was stopped after verification. This does not prove live TTS availability or physical iOS Safari behavior.

## Independent internal review

Two rounds by read-only reviewer `/root/review_pr_audio`. First found a blocking mobile playback initialization flaw and a nonblocking five-minute narration deadline. The fix starts the same audio element synchronously on the tap with looping silent PCM, then switches to generated audio; playback rejection is now visible. Second round: no unresolved blocking finding. Primary checkout reflog was unchanged before/after review.

Real iPhone Safari verification remains operator QA. Each request has a five-minute synthesis deadline. If a healthy local engine exceeds it on a real PR, revive a queued generation/polling enhancement; do not silently raise budgets. Browser autoplay permission can still be refused by explicit settings; the UI displays a recovery message.

## Friction and boundaries

- Issue publication was rejected by automatic approval review: creating a GitHub Issue was treated as external publication requiring explicit authorization/Decision. No Issue, push, PR or notification was performed. Publication must be approved before continuing. The precise request and prepared PR text are preserved locally.
- First Dashboard build ran before core package exports were generated and failed resolving `@pmark/arcadia/intelligence/client`. Core build succeeded; Dashboard build was then rerun sequentially. Source: `docs/AGENT_ORIENTATION.md` worktree/package build guidance. No source workaround was needed.
- Identity through `pnpm arcadia` failed because mise attempted a protected host trust write. Direct `node --import tsx src/cli.ts identity resolve --agent codex --tier heavy` succeeded, matching the existing Notes To Self remedy. No trust config was changed.
- Initial browser assertion selected an unrelated empty global Dashboard alert. Scoping the assertion to the PR audio component proved there was no playback alert. The failure was in the test selector.

## Instruction retrieval

Byte counts name the source files loaded; sections were bounded where noted.
Active Plan: exact `replay-environment-wall-session` Action. Arcadia repository
procedure: Orientation, Arcadia Semantics, Operator Guide, PR QA Plan and
Working-Copy Safety. Notes: targeted speech/audio/PR/agent-ask/worktree searches,
matching settlement, dependency bridging, sandbox trust and preservation sections.
The Agent Ask skill was inspected but not invoked: operator-directed work applies.

| Instruction source | UTF-8 bytes |
| --- | ---: |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31609 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 6393 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/agent-guidance/agent-asks.md` | 22884 |
| `docs/agent-guidance/continuation.md` | 6239 |
| `docs/agent-guidance/learning.md` | 1636 |
| `docs/working-copy-safety.md` | 15818 |
| `docs/agent-guidance/pull-requests.md` | 17208 |
| `docs/agent-guidance/git-identity.md` | 5248 |
| `docs/agent-guidance/arcadia-repository.md` | 30174 |
| `docs/arcadia-semantics.md` | 14180 |
| `docs/AGENT_ORIENTATION.md` | 13594 |
| `docs/intelligence/NARRATION.md` | 4312 |
| `docs/notes-to-self.md` | 34925 |
