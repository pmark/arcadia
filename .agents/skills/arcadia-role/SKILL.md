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
Only a top-level Lead (depth 0) may request planner, plan-critic, implementer or
researcher at depth 1. Delegates return help requests to the Lead and never spawn
children. Code-reviewer and QA need separate independent Sessions, never native
children. Decisions 0112/0114 govern these limits.

## Prepare and dispatch authorized native help

Use the standard harness unmodified. Native dispatch requires explicit operator
or existing launch authorization; role eligibility alone authorizes nothing.
Read the indexed session-roles-and-briefs procedure before dispatch.

```sh
arcadia roles --json
arcadia roles show researcher
arcadia role brief --role researcher --agent codex --tier light --requested-by lead --depth 0 --json
```

Replace the target, agent and tier with the assignment's authorized values. Pair
`--requested-by` and `--depth`; depth describes the requester, so only `lead` at
0 passes. Unknown roles, nested delegates, Lead targets and code-reviewer/QA
native targets fail. This read-only command validates supplied policy labels;
it cannot prove actual Session lineage or host authorization, and launches,
claims, reserves and admits nothing.

Pass the complete generated brief to Codex `spawn_agent` or Claude `Agent`, plus
Task, Project/Milestone/Action or direct instruction, candidate/revision, files,
acceptance, raw checks, budget/deadline, sole writer and the hand-back Artifact
path. Require the child to read this skill, declare its role and depth 1, and
return help requests to the Lead. Specialization never expands authority. If an
implementer writes, the Lead pauses its edits until hand-back. A plan-critic must
be independent of the planner whose output it critiques. Other delegates are
read-only. Follow the PR procedure for separate independent review/QA Sessions.
The existing PR procedure permits a fresh read-only reviewer context (including a
sandboxed reviewer or subagent) for generic current-head verification. This is
not admission to the registered code-reviewer or qa role and proves no governed
attempt lineage. Requests for those registered roles still require separate
independent Sessions under Decision 0114; native role dispatch refuses them.

Record actual native launch and returned evidence separately from preparation.

Use the installed `arcadia` command in adopting Projects, not Arcadia's source
CLI. The Lead and child must have this skill available; if the Project has no
copy, use its explicitly installed arcadia-role skill. If neither is readable,
preserve the assignment and request installation; do not guess the protocol.
OpenCode native dispatch is unverified here: preserve the brief and request an
authorized relaunch when no native tool is available.

**Governed delegation admission is not live yet.** Native tool dispatch does not
admit or enroll an Arcadia Session, enforce capacity caps or reserve a slot. For
an unauthorized or unavailable path submit an Agent Ask proposal with
`requested_authority: propose` following the indexed Ask procedure. A preview
is a receipt, not permission to execute. Do not substitute `session start` for a
delegation broker or claim its development enrollment creates reviewer/QA
independence.

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
