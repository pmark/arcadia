# Continue feedback — Issue #1889

Operator-directed source fix: “Fix #1889 so Continue gives clear feedback and makes it obvious where to follow the launched Session.” No governed Action is claimed. The selected Action remains `implement-go-live-delivery-checklist`; this change does not settle it or alter Plan/queue pointers. Operator requested a fresh worktree and a ping when ready to merge; leave the PR open.

Candidate: `codex/continue-feedback-1889`, prepared from `55637a5d7cc71f6213321eff6bb1504dadab2e82`. Native chat: `01a18a17-9d5f-7cb2-afa6-5715fe6d89a2`. No canonical managed Session admission claimed.

Changes: visible loading labels and bordered feedback; focus/scroll to each transition; stable request and Session receipts; reuse versus launch distinction; existing Session log and Sessions and runs link; unknown outcomes retain identity and withhold new launch controls. Protected launch, one-Action scope and approval/Production gates are unchanged.

Evidence is source-only. Mocked browser responses do not establish installed adoption or live delivery. No live Continue, restart, installation, production start or merge is performed.

## Validation

- Focused Go route, workspace resolver and log tests: 25 passed.
- Desktop (1280 px) and phone (390 px) browser tests exercise preview loading/focus, launch loading, changed facts, gated confirmation, cancellation, success, reuse, log, stable identity, network failure, server error and missing structured receipt. Screenshots retained in Playwright output.
- `pnpm build:artifacts`, `pnpm dashboard:build`, `pnpm lint`, `node scripts/preservation-self-check.mjs` (3321 files), `pnpm check:session-ledger` and `git diff --check`: passed.
- `pnpm exec playwright test tests/e2e/workspace-go.spec.ts`: all 3 passed (22.2 s); phone Session receipt and desktop preview screenshots visually inspected.
- Main checkpoint before commit: fetched main remains the preparation revision; no new governed records.

## Friction and prevention

Initial `git fetch origin` was denied writing `.git/FETCH_HEAD` in the sandbox. The ordinary approved host execution of the same command succeeded; no alternate workspace or Git rewrite was used. Worktree dependency bridge used the documented script. Retained lesson search for workspace Continue Session returned no matches. Capturing the required lesson first refused with `SQLITE_WORKSPACE_WRITE_DENIED`; ordinary approved host execution of the identical command recorded `lesson_57c98d7d926c9c6b7a02`. No sandbox restriction was weakened. Bounded search found no dedicated Continue remedy in Notes; existing dependency, test and permission guidance was applied.

## Retrieved instructions

The following source paths were loaded (UTF-8 file bytes, not an assertion that every unrelated section was needed). Arcadia repository sections used: Orientation, Semantics, Operator Guide, PR QA Plan and Working-Copy Safety. Plan read: current Action and adjacent Continue acceptance. Notes: dependency bridge, targeted Vitest and host-permission recovery. Native-mail not assigned; Git checkpoint observed the unchanged preparation base before edits.

- `CONSTITUTION.md` — 3320 bytes
- `PROJECT.md` — 31429 bytes
- `.arcadia/AGENT_CONTEXT_POLICY.md` — 539 bytes
- `.arcadia/repo-context.md` — 703 bytes
- `.arcadia/context-policy.json` — 870 bytes
- `docs/agent-guidance/index.json` — 8771 bytes
- `.agents/skills/arcadia-guardrail/SKILL.md` — 5565 bytes
- `docs/agent-guidance/continuation.md` — 8704 bytes
- `docs/agent-guidance/operator-directed-work.md` — 4536 bytes
- `docs/agent-guidance/learning.md` — 2458 bytes
- `docs/working-copy-safety.md` — 16202 bytes
- `docs/plans/make-arcadia-go-orient-one-caller-truthfully-before-authorized-work.md` — 25404 bytes
- `docs/agent-guidance/pull-requests.md` — 21758 bytes
- `docs/agent-guidance/git-identity.md` — 5248 bytes
- `docs/agent-guidance/native-mail-checkpoints.md` — 11015 bytes
- `docs/agent-guidance/chat-titles.md` — 6539 bytes
- `docs/agent-guidance/arcadia-repository.md` — 30312 bytes
- `docs/arcadia-semantics.md` — 22613 bytes
- `docs/agent-guidance/session-roles-and-briefs.md` — 15378 bytes
