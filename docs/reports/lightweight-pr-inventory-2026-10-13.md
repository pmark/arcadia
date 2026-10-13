# Lightweight PR inventory implementation evidence — 2026-10-13

Operator-directed Issue [#1370](https://github.com/pmark/arcadia/issues/1370); no governed Action is claimed. The active Plan remains `every-operator-decision-in-a-production-run-is-a-pinned-decision-card-on-a`, current Action `todo-actions-render-cards`; its pointer and queue were not touched.

Candidate: `codex/lightweight-pr-inventory`, actual base `93079517e3b25ccd1cf9ae83a28a75d4b2e53480`, at `/Users/pmark/.codex/worktrees/lightweight-pr-inventory/arcadia`. The initially supplied `1c69027ee` was the primary baseline, not the candidate base; Git HEAD and Lead subsequently verified the corrected base.

The implementer is the sole development writer, depth 1 under Lead depth 0, with the generated brief `/tmp/arcadia-lightweight-pr-implementer-brief.json`. The brief pins heavy Codex builder identity; the actual inherited runtime model and effort are unavailable, not inferred from its configured default. No children were dispatched. Lead ran the preservation monitor before edits: 129 working copies, no overlapping dirty PR paths. All edits stay in this candidate. Production state, local models, credentials, governance and shared services are unchanged.

## Behavior and deterministic proof

- Default Dashboard inventory invokes `arcadia work prs --lightweight`: normal GitHub origins resolve locally, then one `gh pr list` per repository. No per-PR body/files/briefing view is made. Unsupported origin identification retains the existing bounded GitHub identity fallback for inventory only. CI-only badges do not claim merge readiness.
- The unflagged `arcadia work prs` retains its rich behavior and deterministic portfolio briefing. A regression proves that rich mode still calls `gh pr view --json body,files` and produces its changed-path briefing.
- `--repositories-only` resolves configured GitHub origins with local Git commands, not open-PR inventory. Cold and expired Dashboard source authorization coalesces concurrent local-map reads, then reads only the requested PR's fresh title/body. Normal HTTPS, scp-style SSH and ssh:// origins pass; malformed, non-GitHub and non-Git configured paths fail closed. Custom SSH aliases/enterprise origins are intentionally not authorized by the cold local resolver. Browser-supplied paths never choose the cwd.
- Default cards read neither PR details nor TLDR sources. **Load PR details** fetches only that PR's description/files/review data and links GitHub CI/QA evidence. The view labels its checked time and resets when that card's update revision changes. Cross-PR collision/stack briefing remains in the full CLI; details do not fetch other PR bodies.
- **Load TLDR / Listen** is actionable immediately. GET only rediscovers matching existing summaries; generation remains an explicit button. Cached audio still validates fresh title/body revision and exact summary-job identity, and unknown repositories still refuse. Existing stale-pin and idempotent audio tests pass.
- Session cards remain usable while checked. The new lightweight storage namespace ignores old rich browser storage, validates stored display shapes and always restores them as stale. Visible 60-second checks, focus and visibility-return checks coalesce with an in-flight request; hidden polling is suppressed. Regressions prove cancellation cleanup and retained cards after refresh errors.

## Measured localhost evidence

These are this host's observations, not a phone/network latency promise.

| Observation | Time | Evidence |
| --- | ---: | --- |
| Prior full portfolio inventory, 15 Projects / 12 PRs | 20,599 ms | `/tmp/arcadia-cached-mp3-delay-investigation.json` |
| Prior cold source request that entered full inventory | 20,629 ms | same baseline |
| Direct single PR GitHub source view | 772 ms | same baseline |
| Existing MP3 Range read, 1 KiB | 123 ms | same baseline |
| One-repository minimal list, 8 PRs / 17,614 bytes | 1,269 ms | Lead measurement |
| Candidate local repository map, 15 Projects / 7 configured repos / zero PRs | 2,885 ms | `/tmp/arcadia-lightweight-pr-timings.json` |
| Candidate lightweight portfolio, 12 PRs / 32,705 bytes / zero briefings | 10,458 ms | same candidate artifact |
| Candidate browser cold inventory, 12 cards | 11,121 ms | Lead browser QA at localhost:3037 |
| Candidate reload: remembered cards / cached API response | 86 ms / 20 ms | same browser QA |
| Explicit details for PR #1208 | 588 ms | same browser QA; one requested PR |
| Existing merged PR #1367 TLDR load | 705 ms | same browser QA |
| Existing PR #1367 cached playback preparation / media read | 559 ms / 40 ms | same browser QA; playing at 2.99 seconds, no error |
| Built-mode cold cached playback, before any inventory request | 2,477 ms | `/tmp/arcadia-lightweight-cold-audio-timing.json`; HTTP 200, same completed job/MP3 |

The default browser load made exactly one inventory GET and zero summary GETs, with 12 cards and 12 actionable TLDR buttons. Source playback reused an existing summary and MP3; no new synthesis was performed. Source-mode CLI startup contributes to local-map latency. The final cold built-mode audio request returned the exact completed job `ijob_d9323b02c6ef4fc1b9` before any inventory read. Candidate browser console had zero exceptions; an existing form-field identifier issue remained.

## Validation and QA

Focused Vitest command (repository root):

```sh
node_modules/.bin/vitest run tests/work-pull-requests.test.ts apps/dashboard/lib/pull-request-description.test.ts apps/dashboard/components/pull-request-audio.test.tsx apps/dashboard/components/pull-request-details.test.tsx apps/dashboard/hooks/use-pull-request-inventory.test.tsx apps/dashboard/lib/pull-request-inventory-client.test.ts apps/dashboard/lib/pull-request-inventory-cache.test.ts apps/dashboard/lib/pull-request-summary.test.ts apps/dashboard/lib/pull-request-audio.test.ts apps/dashboard/app/api/pull-requests/route.test.ts apps/dashboard/app/api/pull-requests/details/route.test.ts apps/dashboard/app/api/pull-requests/summary/route.test.ts apps/dashboard/app/api/pull-requests/audio/route.test.ts
```

Final pre-handoff run: 13 files / 98 tests, exit 0, including old-storage isolation and non-Git refusal. Changed-file ESLint exited 0. Core `node_modules/.bin/tsc -p tsconfig.json` exited 0. Dashboard `node_modules/.bin/next build` exited 0; all types/static pages built. `git diff --check` and `node --import tsx scripts/check-session-ledger.ts` exited 0. No dependencies or gate weakening were introduced.

Operator procedure is also the end-user procedure. The QA candidate is localhost-only, not claimed phone-reachable:

1. From candidate `apps/dashboard`, after core compilation and Dashboard build, run `ARCADIA_DASHBOARD_CLI=built node_modules/.bin/next start -H 127.0.0.1 -p 3037` and open `http://127.0.0.1:3037/admin/pull-requests`.
2. The initial inventory shows title/number/repository and CI; no descriptions/files/TLDRs load automatically. Reload: remembered cards appear while server evidence is checked. Refresh: old cards remain usable.
3. Select **Load PR details** for one card: its body, changed paths, checked timestamp and GitHub CI/QA link appear. Other cards do not fetch detail/source data.
4. Select **Load TLDR / Listen** for a PR with an existing summary, then **Play TLDR**. Matching existing audio should reconnect; title/body changes or another summary identity must refuse stale playback. For a PR with no summary, generation remains an explicit action, never part of list loading.
5. Return to the tab or wait about a minute while visible: a single coalesced inventory check runs. Hide the tab: interval polling does not issue new checks. A failed check retains earlier cards with stale/error evidence.

Independent review, PR creation and required CI remain Lead responsibilities. This report proves implementation checks and localhost behavior, not final merge acceptance.

## Retrieval and friction

The table records loaded instruction file sizes in bytes. Lead supplied the start/retrieval receipt for native-session/role briefing, review/scope/preservation and repository sections. The implementer read the role/guardrail skills, current control/context files, operator-directed/learning/identity guidance, repository Orientation, Semantics, Operator Guide, PR QA and Working-Copy sections, and reused previously loaded unchanged procedures. Current Action was read only to rule out overlap. Targeted Notes To Self retrieval covered PR inventory/TLDR/storage and the dependency bridge/focused Vitest sections (lines 213–240).

| Loaded path | UTF-8 file bytes |
| --- | ---: |
| `AGENTS.md` | 9750 |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31542 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 7623 |
| `docs/agent-guidance/native-app-sessions.md` | 8101 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/agent-guidance/session-roles-and-briefs.md` | 5343 |
| `docs/agent-guidance/pull-requests.md` | 17585 |
| `docs/working-copy-safety.md` | 15818 |
| `docs/agent-guidance/git-identity.md` | 5248 |
| `docs/agent-guidance/learning.md` | 1636 |
| `docs/agent-guidance/principles.md` | 13789 |
| `docs/agent-guidance/arcadia-repository.md` | 30174 |
| `docs/arcadia-semantics.md` | 14180 |
| `.agents/skills/arcadia-role/SKILL.md` | 7277 |
| `.agents/skills/arcadia-guardrail/SKILL.md` | 5565 |

One bounded discovery command used unmatched zsh globs for absent test paths and returned exit 1 before reading those targets; the corrected `rg --files`/explicit-path lookup resolved it. Prevention: use existing path inventory rather than optional shell globs. No test or build failure occurred in this slice; sandbox escalation was used only for candidate writes and check output outside the primary writable roots. No production restart, publication, model inference or external messaging occurred in the implementer.
