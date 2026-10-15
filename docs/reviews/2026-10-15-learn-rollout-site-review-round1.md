## Review: BLOCK

Candidate: `13bebd57e1c761bb820288cae76d3ccbc391eeb3`
Base: `5d795720dc27f393321379bb6da3f4f7d9c78713`

- **P1 — integrity index is wholly stale.** All 24 `sha256` values in [index.json](/Users/pmark/.codex/worktrees/learn-rollout-site-20261015T220730420Z/mission-control-site/docs/agent-guidance/index.json:5) differ from the committed files. This contradicts the rollout report’s “all 24 … pass canonical fingerprint validation” claim in [the report](/Users/pmark/.codex/worktrees/learn-rollout-site-20261015T220730420Z/mission-control-site/docs/reports/learn-guidance-rollout-2026-10-15.md:9). The bootstrap requires stopping on stale mandatory references, so the on-demand system is not trustworthy as shipped.

- **P1 — migrated mandatory references are unreachable.** The review found 18 broken local Markdown targets. Examples: the required role skill linked by [native-app-sessions.md](/Users/pmark/.codex/worktrees/learn-rollout-site-20261015T220730420Z/mission-control-site/docs/agent-guidance/native-app-sessions.md:18) does not exist in this repository; [managed-documents.md](/Users/pmark/.codex/worktrees/learn-rollout-site-20261015T220730420Z/mission-control-site/docs/managed-documents.md:310) links absent Arcadia-only orientation, commands, semantics, and operator-context files. These make affected indexed workflows stop rather than guide work.

- **P1 — notification retry is not demonstrably deduplicated.** [pull-requests.md](/Users/pmark/.codex/worktrees/learn-rollout-site-20261015T220730420Z/mission-control-site/docs/agent-guidance/pull-requests.md:190) retries `arcadia ping send` when no receipt arrives, but supplies no idempotency key or safe retry condition. The CLI interface exposes no such key. A lost response after a successful queue can produce duplicate Discord notifications, violating the repository’s deduplication requirement. Restore a receipt-bound/idempotent mechanism or state a verified server-side guarantee.

Confirmed passes:

- Scoped Learn capture, evidence-only scope, privacy boundary, and exact same-scope replay caveat are clearly surfaced in [AGENTS.md](/Users/pmark/.codex/worktrees/learn-rollout-site-20261015T220730420Z/mission-control-site/AGENTS.md:39).
- Root budget passes: 10,235 bytes total; managed bootstrap 7,882 bytes (limits: 12 KiB and 8 KiB).
- Constitution is unchanged; the deployment paragraph and guide-authoring section are preserved.
- `git diff --check` passes. No site code or deployment-workflow change was included.

Remaining boundary: repair the three blockers, create a new candidate SHA, and obtain a fresh independent exact-head review. Because this changes agent governance guidance and merging `main` deploys the site, it remains operator-gated; no merge, push, message, or deployment was performed.
