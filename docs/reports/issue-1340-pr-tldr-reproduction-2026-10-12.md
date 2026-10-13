# Issue #1340 — PR #1337 TLDR and audio reproduction

Date: 2026-10-12 America/Los_Angeles (2026-10-13 UTC)

## Scope and authority

This is operator-directed work for GitHub issue #1340. No governed Action
matches it. The primary checkout was revalidated read-only during the session:
its active Plan is `every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a`
and current Action is `decision-card-contract`. The prepared candidate began
from an older `origin/main` snapshot whose pointer was
`attach-the-session-probe-result-to-the-reconcile-receipt`; neither pointer nor
either queue was changed. The
operator authorized reproduction, repair, candidate branch publication and PR
handoff; installation, service restart and activation were excluded.

The tested phone-reachable URL was
`http://arcadia-1.alpine-rattlesnake.ts.net:3020/admin/pull-requests`, using
`pmark/arcadia#1337`. The running Dashboard was a Next development process from
the primary checkout. Its exact installed source revision was not proven; the
observed primary HEAD and broker revision are not sufficient installation
proof. This report therefore records runtime behavior without claiming the
candidate was installed or phone-verified.

## Reproduction evidence

1. Source GET
   `/api/pull-requests/audio?repository=pmark%2Farcadia&number=1337` returned
   HTTP 200 after **21.2496 seconds**. No summary or speech work occurred. The
   current description loader performed the complete configured-repository PR
   inventory before one `gh pr view`, so a single-source read inherited the
   inventory scan.
2. Existing coupled audio POST returned HTTP 200 after **82.0334 seconds**.
   The response exposed only `summaryError`; it omitted the summary job ID and
   terminal cause. It then queued speech job `ijob_7cbf45c9f2f54d5aa7` with the
   entire normalized PR body because the summary was unavailable.
3. A direct bounded local-summary diagnostic reached job
   `ijob_b57eefeb63cb40f0a6`. It ran for 60.031 seconds, then became `blocked`
   with `LITELLM_UNAVAILABLE`: the configured `arcadia-local-text` route at
   `127.0.0.1:4000` aborted. Its source fingerprint was
   `895a7f4051aadea6b191efbd5d645331a29de179d95342003df1818961cce5ce`.
   A second v1-order fingerprint diagnostic, job
   `ijob_d1a1a72a64cd467ab1`, was still `running` at the final bounded poll;
   no terminal result is inferred.
   A separate read-only Intelligence health request then returned no bytes and
   hit its 10.012-second client deadline. This confirms current unavailability,
   but still does not identify the failing proxy/model layer.
4. The wrong-content audio job completed after **302.076 seconds**. It produced
   MP3 artifact `iart_0bd6b0cefafc463486`, SHA-256
   `110c59209e20c4d679123053585f1e4ad2d0f8d0ec468f9318d84091af43bcd6`,
   6,491,180 bytes, duration 811.325 seconds, 22 chunks. The artifact metadata
   reports `ffmpeg-libmp3lame-cbr64k`, but the public job state exposed only
   `queued`, `running`, and `completed`; no distinct live encoding stage was
   reported. The job and artifact were observed only and were not cancelled,
   retried or deleted.

The confirmed failure chain is a 60-second local text transport failure combined
with an unsafe orchestration fallback: `LITELLM_UNAVAILABLE` proves that Arcadia
could not reach the configured route before its deadline, but does not identify
the underlying proxy or model cause. The route waited for summary completion
inside the audio preparation request, hid summary job evidence, then submitted
the full body to speech. The global PR inventory also added about 21 seconds
before the summary attempt began. Local TLDR generation remained operationally
unavailable at handoff; no route change, cloud fallback, install or restart was
attempted.

## Repair contract

- Loading a TLDR reads source and a matching cached job without inference.
- Restart recovery uses the Intelligence service's exact durable idempotency-key
  lookup rather than a newest-N history window; the read-only GET cannot create,
  queue or retry a job.
- Generation starts only from the explicit Generate/Retry TLDR action, uses
  the existing `local-required` and `allowPaidUsage: false` route, returns the
  job immediately, and exposes queued/running/completed/blocked evidence.
- Cache identity binds the PR title and body. A changed source cannot show or
  narrate the older summary, including a source change while generation is in
  flight because the source is reloaded before terminal display. The shipped
  v1 fingerprint order is retained so
  existing Intelligence results remain addressable.
- Play TLDR requires a completed matching summary and submits only the summary
  text to speech. The request carries the displayed source revision and
  summary-job identity; the server reloads the current source and exact
  completed summary and refuses a stale mismatch before speech submission.
  The player is keyed by repository, PR, revision and summary job so an older
  artifact cannot survive an in-place TLDR or PR change. There is no body or
  comment fallback.
- Source, summary, audio and browser playback remain separate stages. The UI
  shows elapsed time, safe failure text and job identity; it does not invent a
  percentage or an encoding stage.
- The configured-repository boundary remains server-side. The inventory route
  refreshes its allowlist, concurrent inventory/source requests coalesce, and
  source lookups reuse the bounded allowlist cache rather than immediately
  rescanning every configured PR.

## Validation evidence

- Initial focused Vitest command: 6 files, 18 tests passed, exit 0. PR review
  exposed five blockers; the R1 regression suite now covers 9 files and 37
  tests, including the existing description test and exact-key Intelligence
  API, and exits 0.
- R2 identity-mismatch regression: 5 focused files / 19 tests pass, including
  stale displayed-A/current-B refusal with zero speech calls, matching-pin
  success and player reset on PR/revision/summary-job change.
- Touched-file ESLint: exit 0 after R1 repair.
- Root package TypeScript compile: exit 0.
- Dashboard TypeScript currently exits 2 on the pre-existing
  `apps/dashboard/app/api/operator-script/route.test.ts:71` invalid
  `NODE_ENV="dashboard-runtime"` fixture. No #1340 file was named in the final
  diagnostic.
- Append-only session ledger: two requested snapshot rows; validator exit 0.
- `git diff --check`: exit 0 before commit.
- Dashboard production build uses the actual package name
  `pnpm --filter arcadia-dashboard build`, exit 0; the new
  `/api/pull-requests/summary` route was compiled and emitted.
- Dashboard import-edge check found no `commander` or
  `containerAuditTransport` import, exit 0.
- CI/review: PR #1343 R1 was blocking at head `d5c6c0bd7`; this report records
  the source repair in product commit `7238496c1` and the current-main
  integration in merge commit `21e2fcbf2` (`origin/main` `a4aea8999`) before
  the required new exact-head review and CI rerun.
- Phone visual/playback QA: not run because this candidate was not installed
  and installation/restart were explicitly outside scope.

## Instruction retrieval evidence

Fully read or retrieved before the applicable operation:

- `AGENTS.md` 9,750 bytes; `CONSTITUTION.md` 3,320 bytes; candidate `PROJECT.md`
  31,634 bytes and its exact Action section
  `attach-the-session-probe-result-to-the-reconcile-receipt`; read-only primary
  `PROJECT.md` and the exact current `decision-card-contract` Action were then
  retrieved after pointer drift was reported.
- `.arcadia/AGENT_CONTEXT_POLICY.md` 539 bytes;
  `.arcadia/repo-context.md` 703 bytes; `.arcadia/context-policy.json` 870
  bytes; `docs/agent-guidance/index.json` 7,623 bytes.
- `.agents/skills/arcadia-guardrail/SKILL.md` 5,565 bytes.
- `docs/agent-guidance/operator-directed-work.md` 4,494 bytes;
  `continuation.md` 6,239 bytes; `learning.md` 1,636 bytes;
  `principles.md` 13,789 bytes; `docs/working-copy-safety.md` 15,818 bytes;
  `pull-requests.md` 17,208 bytes; `git-identity.md` 5,248 bytes.
- Relevant sections of `docs/agent-guidance/arcadia-repository.md` (30,174
  byte source): Orientation, Arcadia Semantics, Model Selection, Operator
  Guide, PR QA Plan, Working-Copy Safety and Claude Code specifics.
- Targeted `docs/notes-to-self.md` entries: worktree dependency bridging,
  focused Vitest, lint/type-resolution failures and fast rehearsal.
- `docs/reports/pull-requests-page-ux-design-2026-10-12.md` 30,746 bytes,
  especially Optional TLDR and the original source; issue #1340 body and PR
  #1337 runtime source.
- `docs/intelligence/V0_1_SCOPE.md` 4,946 bytes and
  `docs/intelligence/ROUTING.md` 18,486 bytes before adding the bounded,
  read-only exact idempotency-key lookup.

Requested model alias was `gpt-5.6-sol` medium because the pinned Plan alias
was unavailable to the collaboration runtime. Actual runtime model identity,
token usage and agent minutes were unavailable and remain unknown.
