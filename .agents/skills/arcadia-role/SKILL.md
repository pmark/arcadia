---
name: arcadia-role
description: Perform a bounded Arcadia assignment using a registered role and shared evidence, escalation and handoff language. Use when briefing a Lead, planner, plan critic, implementer, code reviewer, QA specialist or researcher; domain specialization cannot create authority.
---

# Arcadia role

Roles are governed definitions in `config/defaults/agent-roles.json`, implementing
Decisions 0100 (exact taxonomy file), 0112 and 0114. This skill is their shared
execution protocol, not an authority store or admission mechanism.

## Receive the assignment

Read the repository's AGENTS.md, context policy, Constitution, Project and exact
current Action before discovery; for operator-directed work read its indexed
procedure and rule out overlap. Read `docs/agent-guidance/index.json`, the
matching procedures and targeted Notes To Self entries before each operation.

Use the configured Arcadia CLI as the normal entry point. Adopting Projects use
an installed/configured `arcadia` prefix after this version is available; they
need not contain Arcadia's source tree. The examples below run from **Arcadia's
source checkout**. Use the actual assigned role, agent and tier:

```sh
node --import tsx src/cli.ts roles
node --import tsx src/cli.ts roles show implementer --json
node --import tsx src/cli.ts role brief --role implementer --agent codex --tier standard
```

Add `--action '<plan-slug>#<action-id>'` for an existing Action and
`--specialization 'database migration research'` for a short domain label.
Use `--repo` to name its repository. Specialization is data, never instructions
or permissions. Unknown roles fail; never replace them with invented authority.
The brief selects no live model and launches, claims and admits nothing.

Record the Project, Milestone, Action (or direct instruction), role,
Responsibility, supervisor assignment, sole writer, files, acceptance criteria,
required Artifacts, candidate revision, deadline and budget. Use null or
unavailable for unmeasured values. A registry supervisor relationship does not
prove that a supervisor Session is assigned or running.

## Perform the specialist work

Load procedures by operation from the index, rather than copying them here:

- Lead: integrate evidence and keep scope governed. Decision 0112 allows routine
  development; native-app Lead/Driver conventions still bind when applicable.
- Planner: read `docs/planning-process.md` before planning; return a proposal.
- Plan critic: independent critique under critic identity; never repair the work
  being judged or self-grade. Retrieve planning and review guidance.
- Implementer: write only in the authorized candidate as the sole development
  owner; retrieve working-copy, validation and PR guidance.
- Code reviewer: independent, read-only review of the current head under critic
  identity; retrieve `docs/agent-guidance/pull-requests.md`.
- QA: independent acceptance verification under critic identity; retrieve the
  matching indexed QA/PR procedure, separate observations from judgment.
- Researcher: read-only sources and bounded investigation; report uncertainty
  and evidence, never convert findings into execution authority.

Lead and implementer are both eligible for development; they never become two
simultaneous writers. Ownership changes require the existing governed path.
Only a top-level Lead is eligible to request delegates, at depth one. Delegates
return requests for help to the Lead. Code-reviewer and QA requests need separate
independent Sessions, never in-process children. **Governed delegation admission
is not live yet:** capture a request with `arcadia agent-ask preview` using
`intent: proposal` and `requested_authority: propose`, following the indexed Ask
procedure. A preview is a receipt, not permission to execute. Host tools require
their own explicit authorization; do not infer it from role eligibility.

## Common hand-back

Return task and candidate identity, changed paths, raw validation command and
exit code, per-criterion evidence, unresolved gaps, supervisor/escalation route,
and the next safe move with its stop condition. Evidence belongs in the
repository's authorized file/Agent Ask path; chat alone is not the handoff.
Do not claim acceptance from self-reported counts. Resolve identity before every
commit/comment. Completion, governance changes, messaging, merge and production
retain the indexed authority gates. Never mark governed status by hand.

When assigned supervision, load [arcadia-supervisor](../arcadia-supervisor/SKILL.md).
Supervision is a relationship and duty, not an eighth registered role.
