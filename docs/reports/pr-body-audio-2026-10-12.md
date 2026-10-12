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

## Live PR #1308 test

The operator selected https://github.com/pmark/arcadia/pull/1308 for testing.
GitHub reports it merged, so direct PR URL selection and `?pr=` deep links were
added to the same page. The API allows merged PR numbers only in repositories
represented by the current open inventory; unknown repositories are refused.
A configured repository with no open PRs remains unsupported for direct links.

Initial live narration failed with `SPEECH_PROVIDER_REJECTED`, HTTP 401, because
the candidate process lacked the existing proxy credential. The retry passed
using only existing local speech/proxy settings from the main checkout's `.env`
inside the process; no credential values were printed or configuration changed.
Three chunks produced 97.6 seconds of body-only audio via LOCAL standard speech.

First live page POST then returned 502: speech progress on stdout contaminated
the CLI JSON response. Fixed speech progress output in `src/intelligence/jobs/worker.ts`
to stderr; `test/intelligence/narrate-command.test.ts` verifies stdout stays free
of those messages. All 19 focused tests and scoped lint passed after the fix.
The real endpoint retry returned HTTP 200, `audio/mpeg`, download name
`pr-1308-body.mp3`; FFprobe confirmed 97.6 seconds and 725,612 bytes.

Browser test selected merged PR1308 through the deep link with a different open
PR in its mocked inventory, then played the real generated MP3 with one tap.
Physical iOS Safari remains unverified. A read-only fourth review was justified
by the significant integration failure after round three; no blocking findings.

A standalone Dashboard `tsc --noEmit` check reported an existing unrelated type
error in `app/api/operator-script/route.test.ts:71`: `NODE_ENV: "dashboard-runtime"`
is outside Node's declared production/development/test union. The same source
was verified present on the original candidate head, unchanged by this request.
The prior Dashboard production build passed; this standalone check is not
claimed as passing. The direct-link view compiled and ran in the candidate dev
server. No gate or test was weakened.

The isolated localhost candidate remains running at
`http://127.0.0.1:3041/admin/pull-requests?pr=https%3A%2F%2Fgithub.com%2Fpmark%2Farcadia%2Fpull%2F1308`
for operator testing. Shared services were not restarted. Downloadable MP3:
`/Users/pmark/.codex/visualizations/2026/10/12/01a130f8-9330-77f0-9cd8-12622f7ee808/arcadia-pr1308-body.mp3`.
Issue/PR publication remains awaiting the prior approval question.

## TLDR and formatted body on the phone player

Operator request: add a TLDR above the actual Markdown-formatted PR body and,
if possible, include that TLDR at the beginning of the audio. The same approved
Tailscale player at `http://arcadia-1.alpine-rattlesnake.ts.net:3042/` was updated.
The summary was written from the refreshed PR body, which was verified unchanged
from the audio's source. The page renders that body's headings, numbered and
unordered lists, bold emphasis, inline code and link; source HTML is escaped.

Existing local speech generated the summary and an explicit transition in two
chunks (25.9 seconds). The WAV concatenation helper placed it ahead of the
unchanged 97.6-second description; a PCM byte comparison proves the combined
audio equals summary frames followed by body frames. FFprobe identifies the new
MP3 as 123.5 seconds and 919,436 bytes. Both the new audio URL and the prior
body-audio URL serve the summary-first recording.

A phone-width browser layout check passed: TLDR precedes the formatted body,
without horizontal overflow. The live Tailscale audio endpoint returns HTTP 206
for byte-range playback. Screenshot, rendered HTML, source JSON, summary text,
MP3 and the bounded single-file server/builder are retained in this chat's
visualization artifact directory. Physical iPhone playback remains operator QA.

The old tool session was unavailable and no port-3042 listener remained when
updating it (cause unverified). The approved single-file player now runs detached
from the chat tool turn as PID 60881, with a receipt at
`/tmp/pr1308-audio-server-process.json` and log at `/tmp/pr1308-audio-server.log`.
No shared Arcadia service, Tailscale configuration, active Plan or queue changed.
This is a PR1308-specific test page; reusable Dashboard TLDR generation has not
been added by this page update. GitHub Issue/PR publication remains awaiting
separate authorization.
