# Basic recurring scheduler — session evidence

Operator-directed work: [issue #1220](https://github.com/pmark/arcadia/issues/1220),
requested 2026-10-10: “Arcadia needs a basic scheduler, and this is the perfect
use case. Build it.” No Plan pointer, Action status or Decision answer is edited.
Responsibility: Codex implementer; independent read-only reviewer at PR creation.
Artifact: recurring calendar engine, durable SQLite receipts, existing-worker
integration, CLI controls, Field Notes example definitions and operator guide.

## Retrieved instructions and evidence

Session retrieval included the current Project/Plan Action, repository context
policy, notes lookup for scheduler/cadence/timer/tick/cron (no matching remedy),
operator-directed work scope, standard harness, principles, repository
Orientation/Semantics/Model Selection/Working-Copy Safety, freeze policy, PR
procedure and semantic Git identity. Notes entries “Lint or tests fail in an
agent worktree but not in CI” and “Run one Vitest file without launching the
whole suite” were used for dependency bridging and focused test invocation.
Instruction source file sizes (UTF-8 bytes, not total retrieved sections):

- `AGENTS.md`: 9276 bytes.
- `CONSTITUTION.md`: 3320 bytes.
- `PROJECT.md`: 31700 bytes.
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539 bytes.
- `.arcadia/repo-context.md`: 703 bytes.
- `.arcadia/context-policy.json`: 870 bytes.
- `docs/agent-guidance/index.json`: 6393 bytes.
- `docs/notes-to-self.md`: 33541 bytes.
- `docs/agent-guidance/operator-directed-work.md`: 4494 bytes.
- `docs/agent-guidance/arcadia-repository.md`: 30174 bytes.
- `docs/agent-guidance/principles.md`: 13789 bytes.
- `docs/agent-guidance/pull-requests.md`: 16922 bytes.
- `docs/agent-guidance/git-identity.md`: 5248 bytes.
- `docs/agent-guidance/rehearsal-freeze-window.md`: 4690 bytes.

Implementation evidence: existing priority scheduler in `src/commands/schedule.ts`,
worker admission in `src/commands/worker.ts`, read/write database helpers,
Agent Ask preview's idempotent request receipts and settlement records, daily
orientation findings, Field Notes production instructions and Decision 0120.
The managed candidate is `codex/basic-recurring-scheduler`, based on
`origin/main` at creation. Work monitor ran before edits; dependencies were
bridged with the repository script. Other live candidate work was preserved.

## Verification and reachability

Repository lint and TypeScript checks passed. Focused tests cover weekly/monthly
windows, DST gaps and overlaps, disabled registration, strict validation,
baseline gating, downtime coalescing, persistent deduplication, competing real
processes, unsettled-proposal backpressure, failed destination isolation,
backoff, capped retries, explicit recovery, read-only pre-migration status,
real CLI JSON envelopes and existing-worker integration with production inactive.
Existing scheduling read-only and Agent Ask contract suites passed alongside it.
PR review and exact-head CI receipts belong on the PR, not inferred here.

No live schedule was registered or enabled. The sample timezone and trigger
baselines are proposed defaults; the first-run evidence collection cutoff still
requires a confirmed input. The worker submits proposals, not agent launches or
publication. Site routes/RSS/publication remain issue #1211. Runtime activation
must respect the recorded production freeze and service recovery procedure.

## Independent review repair

Round 1 on `71eec9852376a7731c3f1485a600a833fa1b8552` found that the
shared Project resolver excluded only paused Projects; completed/incubating
Projects could therefore receive proposals contrary to this feature's active
Project contract. Registration and delivery now both require status active.
Regression tests cover all non-active statuses at registration and completion
or incubation after registration. Round 2 will review this scoped delta on the
new head; no PASS for new bytes is inferred from the initial review.
