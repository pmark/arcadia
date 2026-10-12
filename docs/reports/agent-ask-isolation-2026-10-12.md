# Agent Ask isolation evidence — 2026-10-12

Operator-directed work, Issue #1331. No governed Action exists for this fix. Registered intake: `agent-ask-noninterference-2026-10-12`, proposal `agentask_d279d0984fcfa55b9f`, capture `capture_a7112499-39fb-4b67-99e4-09f447b8b67a`.

The active Action read at startup was `attach-the-session-probe-result-to-the-reconcile-receipt`; this fix leaves its pointer and queue unchanged. Responsibility: agent for this direct request. Artifact: isolated candidate and reviewed PR.

## Validation recorded before PR review

- Draft and adversarial isolation tests: 30 passed, exit 0.
- Agent Ask settlement tests: 107 passed; final rerun is tracked in the PR.
- TypeScript and ESLint on touched files: exit 0.
- Fast rehearsal and final Go recovery run: pending at this record; final results belong in the PR.

## Preservation and failures

The first candidate inherited eight unique local governance commits from main. It was not edited; a fresh candidate was prepared from remote main and the unused candidate was archived recoverably. No peer local records were included in the fix. The primary reflog at startup ended at `9b2270769`, `f14fc522b`, `2c84a20d7`.

The initial inline intake failed with `SQLITE_WORKSPACE_WRITE_DENIED`; the same supported command succeeded through ordinary host permission recovery. No scratch Ask was written to main. A regression test showed that `git reset --paths` can execute a clean filter even on a private index; the helper now writes cache entries directly. Failed fixtures that depended on main drafting were changed to linked candidate fixtures rather than weakening the guard.

## Retrieved guidance

Sizes below identify loaded source paths; procedure sections were retrieved as the operation required. Repository guidance: `arcadia-repository.md` Orientation, Semantics, Model Selection, PR QA and Working-Copy Safety. Notes: Ask draft recovery, workspace resolution, settlement, sandbox write denial, and Git preservation. Agent Ask skill: `/Users/pmark/.codex/skills/arcadia-agent-ask/SKILL.md`.

- `CONSTITUTION.md`: 3320 bytes.
- `PROJECT.md`: 31634 bytes.
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539 bytes.
- `.arcadia/repo-context.md`: 703 bytes.
- `.arcadia/context-policy.json`: 870 bytes.
- `docs/agent-guidance/index.json`: 7623 bytes.
- `docs/agent-guidance/agent-asks.md`: 22884 bytes.
- `docs/agent-guidance/operator-directed-work.md`: 4494 bytes.
- `docs/agent-guidance/learning.md`: 1636 bytes.
- `docs/agent-guidance/continuation.md`: 6239 bytes.
- `docs/agent-guidance/pull-requests.md`: 17208 bytes.
- `docs/agent-guidance/git-identity.md`: 5248 bytes.
- `docs/agent-guidance/rehearsal-freeze-window.md`: 4690 bytes.
- `docs/agent-guidance/session-roles-and-briefs.md`: 4195 bytes.
- `docs/agent-guidance/principles.md`: 13789 bytes.
- `docs/working-copy-safety.md`: 15818 bytes.
- `docs/arcadia-semantics.md`: 14180 bytes.

No runtime deployment, provider config change, queue reorder, main-checkout settlement, or notification delivery is claimed by this evidence.
