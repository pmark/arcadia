---
name: arcadia-guardrail
description: Apply focused implementation, validation, and delegation practices to Arcadia coding work. Supplements existing governance; does not establish execution authority.
---

# Arcadia guardrail

Produce the smallest complete, maintainable change that satisfies the
authorized task. Minimize total inference, coordination, and rework—not
line count or individual prompt length.

## Governing procedures

Paths below are relative to the repository root. Follow `AGENTS.md`,
`CONSTITUTION.md`, and the triggered procedures in
`docs/agent-guidance/index.json`. Reuse instructions already loaded;
retrieve only relevant sections when the operation changes. Search with
bounded `rg`, read matching sections only, honor the denied paths in
`.arcadia/context-policy.json`, and do not re-read unchanged files.

- Authority and Action: `docs/agent-guidance/continuation.md`.
- Direct operator requests: `docs/agent-guidance/operator-directed-work.md`.
- Prior remedies: `docs/agent-guidance/learning.md`.
- Scope and deferrals: `docs/agent-guidance/principles.md`.
- Candidate isolation and preservation: `docs/working-copy-safety.md`.
- Model selection and Claude Code specifics:
  `docs/agent-guidance/arcadia-repository.md`.
- Harness use (run it unmodified): `docs/agent-guidance/standard-harness.md`.
- Validation, independent review, CI, and merge:
  `docs/agent-guidance/pull-requests.md`.
- Governed records and completion: `docs/agent-guidance/agent-asks.md`.
- Commit and comment identity: `docs/agent-guidance/git-identity.md`.

This skill grants no authority and replaces none of these procedures.

## Focus the change

1. Identify the authorized task, acceptance criteria, affected behavior,
   known file targets, and required evidence. A file list is provisional;
   expand targeted reads when evidence requires it.
2. Search the Project's notes before implementation or validation and on
   each new failure. Inspect existing capabilities before designing additions.
3. Prefer existing project utilities and dependencies. Add dependencies or
   abstractions only when a concrete requirement justifies them.
4. Keep code readable. Use concise comments for non-obvious reasons,
   invariants, and constraints. Preserve required telemetry and documentation.
5. Resolve routine implementation uncertainty through bounded evidence.
   Raise material requirement or authority questions through the governed
   path; continue unaffected authorized work.

## Delegate economically

Use the required independent reviewer. Add implementation subagents only
when the Action, the Plan, or the PR procedure names that role and
separable work saves more effort than briefing, duplicated discovery,
integration, and review cost.

Assign disjoint write ownership. Parallel reads may overlap; concurrent
edits must not. The lead owns integration and acceptance evidence.
Use the least costly sufficient configured model and effort, subject to
the task's profile and runtime restrictions.

Give each agent only relevant evidence and applicable instructions.
Prefer a focused brief over inherited conversation history when supported.
Never omit governing constraints to save tokens: cite them by path
(`AGENTS.md` essential constraints, the triggered procedure) rather than
pasting them into the brief.

Brief template:

    Task: <one concrete outcome>
    Context: <candidate path/revision; relevant evidence and procedures>
    Acceptance: <observable criteria>
    Ownership: <writable files, or read-only>
    Checks: <required checks for this task>
    Return: <changes or findings; evidence; unresolved blockers>

Every reviewer and engineer brief must prohibit edits, checkout, stash,
reset, or worktree creation in the primary checkout or other live
worktrees. Engineers write only their assigned candidate.

Reviewer briefs additionally specify read-only operation, the exact head,
acceptance criteria, and relevant failure classes. Prohibit commits,
pushes, governance settlement, host brokers, messaging, and policy changes.
Request actionable findings with location, failure case, and severity;
follow the PR procedure's review verification and round limits.

## Validate and converge

- Run the narrowest deterministic check that covers the change first
  (a focused test file, not the whole suite), then the checks the task and
  governing procedures require; run the full suite only when the PR
  procedure requires it.
- Validate a schema only when the task supplies an authoritative contract.
  Identify the output instance, schema source, and existing validator.
  Structural validation does not replace behavioral acceptance.
- Remove verified exploration artifacts this session created inside its
  own candidate; never use `git clean`, reset, or stash. Preserve required
  observability, existing work, and failed receipts.
  Validate the resulting change.
- Batch related repairs. Repeat checks or review when a change, failure,
  or unresolved risk warrants it; reuse evidence that remains valid.
- Review subsequent deltas under the PR procedure. Give reviewers raw
  evidence, not the author's confidence or desired verdict.
- On failure, preserve the candidate and diagnose the named cause within
  the applicable repair budget. Never discard work automatically, invent
  an error contract, or weaken a gate.

Report the change, acceptance evidence, and material limitations concisely.
Record completion and handoff through the governing procedures; passing
tests or a schema alone does not establish completion.
