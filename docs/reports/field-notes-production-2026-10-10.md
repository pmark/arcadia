# Field Notes production preparation — 2026-10-10

Operator instruction: "Do it in a worktree", following the evidence-first
Field Notes production strategy. This is operator-directed preparation linked
to issue #1211, not completion of the unrelated active Action. No pointer,
queue, Decision answer or Action status was changed.

## Candidate and inspected evidence

- Candidate: codex/field-notes-production, isolated app-managed worktree.
- Arcadia base: 8d34e4af39fd25615247c77187fc22ca0a80147b.
- Site main inspected: pmark/mission-control-site@5d795720dc27f393321379bb6da3f4f7d9c78713.
- Strategy and approved Decision 0120 read; its old pending wording corrected.
- Existing blog CLI/actions/artifact renderer read; help confirms scaffold and
  review commands only. No automatic publisher exists in those commands.
- Site recursive main tree: guides only, no notes or RSS routes. Deploy workflow
  and DEPLOY.md confirm a main push deploys production.
- Issue #1211 preserves prior deferral and revival trigger. The preparation
  proposal links it and leaves priority changes to the governed path.

## Validation and practical limits

- `arcadia work monitor --no-pull-requests --json`: succeeded before edits;
  inspected session-owned scope, preserved other candidates.
- `node scripts/bridge-worktree-deps.mjs`: succeeded through ordinary host
  escalation after the sandbox denied creating app dependency directories.
- `node --import tsx src/cli.ts blog --help`: succeeded; documented commands exist.
- Local Markdown links in the seven content files resolve.
- `git diff --check`: passed before commit.
- Documentation/templates only; no live workspace blog mutations, scheduling,
  site edits, publication, credential changes or service restarts performed.
- Content review and delivery cases are follow-up acceptance, not executed proof.

## PR review and notification

- PR: https://github.com/pmark/arcadia/pull/1219.
- Independent round 1 on cce185783: HOLD. Reviewer found that the exact-week
  filter would drop older unreported merges after downtime. Corrected the
  procedure and receipt to distinguish cadence window from collection interval;
  discovery now starts at the confirmed cutoff. Delta review follows.
- Primary checkout reflog unchanged after independent review.
- Standing PR notification: first attempt refused SQLITE_WORKSPACE_WRITE_DENIED.
  Notes lookup confirmed the ordinary host recovery; same command queued
  ping_2a24c129dae7404fbf for the configured default channel. Delivery is not
  assumed from queue acceptance.

## Friction preserved

- First work monitor output was large (154 copies). It completed successfully;
  subsequent discovery stayed scoped to the candidate and blog capability.
- Initial dependency bridge: EPERM creating the worktree app dependency directory.
  Same canonical command succeeded through permitted host execution; no manual
  dependency symlinks or permission-policy changes.
- GitHub read in the sandbox: network connection failed. Ordinary host execution
  succeeded; no credential material was read or changed.
- A site tree query initially hit zsh glob expansion on `?recursive=1`; quoted
  the endpoint and retrieved the exact main tree. No mutations occurred.

## Instructions loaded

Paths and UTF-8 byte sizes at retrieval; larger command output was bounded.
The active Plan retrieval was its exact define-governed-role-registry Action,
not the unrelated backlog. Repository guide sections: Orientation, Arcadia
Semantics, Model Selection, Working-Copy Safety. Notes To Self searches:
Field Notes/blog/promotion and worktree/preservation; relevant dependency bridge
and host-boundary entries read. Universal Capture M16 and its prompt read.

- `AGENTS.md`: 9276 bytes
- `CONSTITUTION.md`: 3320 bytes
- `PROJECT.md`: 31700 bytes
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539 bytes
- `.arcadia/repo-context.md`: 703 bytes
- `.arcadia/context-policy.json`: 870 bytes
- `docs/agent-guidance/index.json`: 6393 bytes
- `docs/agent-guidance/operator-directed-work.md`: 4494 bytes
- `docs/agent-guidance/principles.md`: 13789 bytes
- `docs/agent-guidance/continuation.md`: 6239 bytes
- `docs/agent-guidance/learning.md`: 1636 bytes
- `docs/agent-guidance/pull-requests.md`: 16922 bytes
- `docs/agent-guidance/agent-asks.md`: 22884 bytes
- `docs/agent-guidance/git-identity.md`: 5248 bytes
- `docs/agent-guidance/standard-harness.md`: 5569 bytes
- `docs/agent-guidance/proposals.md`: 1995 bytes
- `docs/agent-guidance/operator-actions.md`: 9315 bytes
- `docs/working-copy-safety.md`: 15818 bytes
- `docs/arcadia-semantics.md`: 14180 bytes
- `docs/AGENT_ORIENTATION.md`: 13594 bytes
- `/Users/pmark/.codex/skills/arcadia-agent-ask/SKILL.md`: read for governance boundary; no Ask settlement performed.
