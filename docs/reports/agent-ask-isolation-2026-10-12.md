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

Candidate sizes below identify the instruction path inventory; startup reading used the primary control documents; procedure sections were retrieved as the operation required. Repository guidance: `arcadia-repository.md` Orientation, Semantics, Model Selection, PR QA and Working-Copy Safety. Notes: Ask draft recovery, workspace resolution, settlement, sandbox write denial, and Git preservation. Agent Ask skill: `arcadia-agent-ask/SKILL.md`.

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

## Independent review and CI repair

PR #1332 head `0aa2de8ad44aa95ea778d2db56820bf9feaf1eb5` received an independent read-only review. Three reproduced blockers were repaired: moving/symbolic HEAD during ref publication, replacing a recovery source with a symlink, and replacing an index lock during publication. Reproductions remained in temporary directories; primary reflog was unchanged. The fix holds HEAD and index locks, publishes a pinned non-dereferenced ref through an unregistered private admin context, never publishes a foreign lock, and binds recovery cleanup to the original regular single-link file.

Initial required CI exposed downstream callers/fixtures that relied on primary-checkout drafts: clarification handoff, reviewer smoke, completion/brief tests, and plan-amendment runner fixtures. Clarification now registers the Ask inline with a truthful registered receipt. Smoke uses a linked candidate; fixtures retain their acceptance assertions with isolated input. The stale-pointer race still proves fresh reapplication, with its competing settlement before the first Git reservation rather than under an already-owned lock.

Final focused race/brief output: `/private/tmp/arcadia-driver-check-14158.log`, 53 passing. Core regression output: `/private/tmp/arcadia-driver-check-97691.log`, 230 passing. Final runner, type/lint and rehearsal outputs were still running when this note was written; final results and current-head review/CI are recorded in PR #1332. Failed first-head CI evidence remains recoverable in GitHub run `38310015302` and temporary unit-shard logs. The rejected PR notification was not sent; automatic approval review required an explicit messaging Decision. No messaging workaround was attempted.

Available advisory CodeRabbit feedback was considered: the machine-specific skill path was made portable, and tracked Ask recovery was corrected to restore the Git executable bit. Its rate limit is not a merge blocker.

Final local repairs verified before the ownership/mode followup commit: isolation/race/mode suite 27/27, plan runner 28/28, clarification 13/13, TypeScript and touched ESLint exit 0. The fresh fast-rehearsal report at `/var/folders/cm/0dn1wl093f52lr7h5d7xpdn40000gn/T/arcadia-fast-rehearsal-report-Ma4V2F/report.json` has `vitestStatus: 0`, 34 scenarios, with 72 passing tests and one expected failure. Source additionally refuses a pinned branch already checked out in another registered worktree before acquiring Git locks. Current-head review and remote required checks remain merge gates, recorded in PR #1332.
