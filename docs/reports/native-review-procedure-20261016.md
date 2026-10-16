# Cross-runtime review procedure evidence

Operator-directed Issue: https://github.com/pmark/arcadia/issues/1471.
Proposal receipt request: `native-review-delivery-procedure-sol-20261016`.
The operator selected implementation (option 1). This work claims no governed
Action and does not change the active native-RM Plan, pointers or queue.
Sole writer: this Codex Lead; independent review is a separate fresh context.
Candidate base: `231b611cce87985f3a43286fba9bcfb4d577c4ba`.
The first preserved candidate included unrelated local settlement `6962c26`;
replacement uses fetched remote main and only the six-file procedure change.
No settlement or governance change is carried by this replacement.

## Scope and proof

- `pull-requests.md`: one independent reviewer, risk-based additional review,
  one exact-head report, optional authorized pointer, explicit reads of all three
  GitHub feedback collections, disposition/freshness/retry rules.
- `session-roles-and-briefs.md`: distinguish proven top-level OpenCode review
  from unverified in-process delegation and governed admission.
- `START_HERE.md`: link the operator-facing summary to the owning procedure.
- `index.json`: refresh the two changed guidance fingerprints using the existing
  `guidanceFingerprint` contract (trimmed content SHA256).
- `check-agent-guidance.ts`: PASS; no delivery problems for Codex, Claude or
  OpenCode. Canonical `guidanceResources` validates all 25 resources.
- `vitest run tests/agent-guidance.test.ts`: PASS, 18 tests. This exercises
  adoption/delivery; it is not live launch proof for all three providers.
- `git diff --check`: PASS.

## Procedure walkthrough (reasoned cases, not runtime simulations)

| Case | Required outcome from the amendment |
| --- | --- |
| Successful independent review | Exact head/base, reviewer provenance, checks and limits accompany verdict on PR; authorized pointer links that report. |
| Incomplete or failed review | Clearly incomplete/failed, never a no-blockers pass; retain evidence and finite budget. |
| Head changes before publication | Preserve report, label stale, apply existing delta/push-exception rules; no current-head pass inferred. |
| Publication retry after uncertain result | Search by PR/head/context/round; do not duplicate or blindly retry an uncheckable outcome. |
| Disputed blocker | Author cannot dismiss it; existing reviewer/operator resolution gate remains. |
| Exhausted budget | Provider switch does not renew allowance; existing review-round and stopping limits remain. |
| No authorized peer transport | PR read checkpoints remain usable; no delivery acknowledgment invented. |
| Feedback outside conversation comments | Explicit paginated reads include submitted reviews and inline comments/replies. |

The same report contract applies to all three runtimes; it does not standardize
host launch commands, add automatic dispatch, require three reviews or grant
posting authority to read-only reviewers. Existing main/other live worktrees are
not candidates. No launch, installation, service restart, merge or deployment is
part of this change. Native-mail delivery awaits its existing checkpoint proof.

## Prior live evidence and limits

The independently fetched OpenCode report on PR #1469 is at
https://github.com/pmark/arcadia/pull/1469#issuecomment-6225541027.
It establishes one operator-authorized OpenCode 1.16.2 review/post, with model
`opencode-go/deepseek-v4.1-flash`, reviewed head
`4d7c8b5a69b6dcc20f75c791f3c0aca9c46ad388`. It does not prove all hosts,
receiver acknowledgment, governed admission or future launch authorization.

## Validation friction and remedy

An exploratory import from unbuilt `dist/src/projects/agentGuidance.js` failed
with `ERR_MODULE_NOT_FOUND`. The corrected check imports the source through
`node --import tsx`; it passed without a build. The first sandboxed Vitest attempt
was denied creation of Vite's temporary config folder. Ordinary approved host
execution of the same focused suite passed. Neither failure changed tests or
permissions. Full required CI belongs to the pushed PR head.

## Loaded instruction evidence

Relevant sections were retrieved in chat: independent review/merge/notifications;
roles/native dispatch; operator-directed intake/handoff; Git identity; worktree
preservation/dependency bridge; Agent Ask capture; standard harness/handoffs;
active native-RM Action acceptance and targeted Notes entries. Byte sizes below
are those in the candidate at report creation; modified procedure sections are
listed under scope above.

| Path | UTF-8 bytes |
| --- | ---: |
| `AGENTS.md` | 10451 |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31539 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 9860 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/agent-guidance/pull-requests.md` | 21758 |
| `docs/agent-guidance/session-roles-and-briefs.md` | 6818 |
| `docs/agent-guidance/native-app-sessions.md` | 9061 |
| `docs/agent-guidance/standard-harness.md` | 5569 |
| `docs/agent-guidance/git-identity.md` | 5248 |
| `docs/agent-guidance/learning.md` | 2458 |
| `docs/agent-guidance/agent-asks.md` | 22884 |
| `docs/working-copy-safety.md` | 16202 |
| `docs/planning-process.md` | 18237 |
| `.agents/skills/arcadia-role/SKILL.md` | 9080 |
| `.agents/skills/arcadia-guardrail/SKILL.md` | 5565 |
