# Detailed Way guidance: session roles and briefs

Read this procedure before launching, briefing or handing back a Session or
subagent. The compact bootstrap and CONSTITUTION.md still bind; roles and
briefs grant no authority. Evidence: `docs/reports/production-simulation-living-notes.md`
(headings "What works" and "Friction").

## Canonical roles and discovery

Read `config/defaults/agent-roles.json` through `arcadia roles --json`, then
`arcadia roles show <id>`. Read the shared execution skill
[arcadia-role](../../.agents/skills/arcadia-role/SKILL.md) before assignment;
load [arcadia-supervisor](../../.agents/skills/arcadia-supervisor/SKILL.md) when
supervision is assigned. Adopting Projects use installed `arcadia` and their
installed skill; missing skills stop affected dispatch until installed.

The registered IDs are `lead`, `planner`, `plan-critic`, `implementer`,
`code-reviewer`, `qa` and `researcher`. Historical Driver means implementer;
Reviewer must resolve to plan-critic, code-reviewer or qa for the actual task.
Replayer is a deterministic script, not a registered role. Observer automation
remains deferred. Supervisor is a relationship, not an eighth role.
Process Critic is a plan-critic specialization, not an eighth role.
Read [its standing brief](process-critic-brief.md) before use.

Decision 0112 allows the Lead to do routine development. Lead and implementer
never write concurrently. Native-app sessions retain their scoped Lead/Driver
convention: only the implementer writes product code. Decision 0114 allows only a top-level Lead at depth 0
to request planner, plan-critic, implementer or researcher at depth 1. Delegates
never delegate. Code-reviewer and qa are separate independent Sessions, never
in-process children. A plan-critic is independent of the planner it judges.

## Composable specializations and optional names

Use the [canonical identity profiles](../arcadia-semantics.md#roles-specializations-and-optional-names)
for Rowan, Mira, Ellis, Nadia, Sage, Quinn, Vida and Clara. They provide the
human interface; the seven role IDs remain the assignment contract. Resolve a request by name
or function to the appropriate profile, then bind one registered role to the
actual assignment. For Ellis, choose planner for read-only design or implementer
for source changes; the name never combines their permissions. Use the existing
brief and `--specialization` label, not a new schema or CLI alias. For example,
`--role implementer --specialization 'execution lifecycle repair'` can prepare
Ellis's repair brief; `--role Ellis` is unsupported.

In the existing **Task** prose, identify the profile and task, such as
“Ellis — stop/drain repair.” Keep the generated **Identity** block unchanged:
it contains the actual resolved provider/tier signature. Preserve that identity,
Session and attempt references in receipts. Disambiguate concurrent profiles
with task and Session references; the name supplies no shared memory or custody.
Include the canonical profile source and any selected method source/revision in
**Context**. Existing **Ownership**, **Acceptance**, **Checks** and **Return**
carry the delivery owner, sole writer, independence, allowance and stop condition.
Do not add fields to the generated role-brief JSON.

Read linked Behavior contracts when their methods apply. Select the smallest
useful combination: causal investigation, specification analysis, protocol
analysis, experimentation, architecture analysis or verification can specialize
an existing Role. Keep one accountable owner and the existing finite allowance.
Separate assignments only when ownership or independence requires it; a new
name or method never releases a claim, resets a budget or requires another
review stage. Rowan remains the operator contact when bounded help is assigned;
a depth-one helper never becomes a second Lead or dispatcher.

For Mira, load
[arcadia-release-investigator](../../.agents/skills/arcadia-release-investigator/SKILL.md)
or its installed same-source skill. For Nadia, retrieve Process Critic only
when its run/plan triggers apply. Sage and Quinn retain the separate independent
Session requirements below. A generic read-only PR reviewer context does not
become registered code-reviewer admission by using Sage's name. Missing methods
limit their specialized operation, not unrelated authorized work.

### Vida: health assessment

Bind Vida to `researcher` with system-health assessment specialization. In the
existing brief, name the assigned services, worker, broker, dependencies or
blocked/stopped work to inspect and the finite observation window. Retrieve
existing indexed read-only status/health guidance for that scope; use only
supported checks within authority. Return to Rowan a concise assessment of each
affected service/workstream, evidence source, observation time and revision when
available, impact, uncertainty, and the responsible owner's next step. Separate
observations from inference: confirmed failures support degradation; unavailable,
stale or inconclusive evidence stays unknown. These are prose assessments,
not new persisted states. Availability alone proves neither delivery progress
nor product acceptance. This method starts no background watch, restart,
credential refresh, production access or messaging; those retain their existing
capability and authority boundaries.

### Clara: technical writing

Bind Clara to `implementer` with technical-writing specialization and writing-only
Ownership in the existing brief. Name the audience, requested outcome, evidence
and destination. Write concise, conversational articles, explainers, guides or
technical documentation with practical examples. Reuse supplied evidence from
Mira, Vida, Ellis and the responsible source owners; gather necessary facts
within the assignment, distinguish observed, proposed and unproved claims, cite
authoritative evidence, and never invent provenance. Check uncertain facts with
the source owner when needed and return unresolved gaps to Rowan; this adds no
mandatory review stage or researcher writing permission.

Honor an explicit requested destination and existing Project/operator writing
preferences. In this repository, the operator's default for Arcadia articles and
explainers is the existing **Arcadia Articles** folder: resolve it or ask for its
path/link when unavailable; never silently substitute repository `docs/articles`.
Other Projects retain their own destinations and preferences. Repository
documentation uses its existing canonical destination. Return the
artifact location and factual limits. Drafting or saving does not authorize
publishing, sending or posting. “Clara, write a short article explaining …” is a
natural-language assignment for an agent that retrieves this guidance, not a
CLI alias or automatic dispatch mechanism.

## Recovery specialization

Read [Hacker recovery](hacker-recovery.md) for repeated refusals and red alerts.
Behavior is the canonical term for a named procedural contract within existing
authority; mode is its active operating state. Hacker recovery is a bounded
Behavior of existing roles, not a registered role ID.
An assigned Lead diagnoses; the authorized implementer remains the sole writer.
The mode changes neither dispatch eligibility nor admission, and supplies no
new permissions, model default or allowance. Supervision is a Behavior attached
to a Supervisor's assigned relationship and duty; requiring recovery does not
create a new role. See [canonical semantics](../arcadia-semantics.md#behavior).

## Native dispatch and model selection

Read role defaults from the registry and resolve the authorized model/identity
with `arcadia role brief`; legacy provider-specific recommendations do not
replace the registry or current model bindings. State actual model/effort and
budget before launch. A displayed default grants no spend or launch authority.

For explicitly authorized native help, prepare:

```sh
arcadia role brief --role researcher --agent codex --tier light --requested-by lead --depth 0 --json
```

Replace researcher, agent and tier with the chosen registered role and authorized
configuration. Add `--action '<plan-slug>#<action-id>' --repo <candidate>` for an
existing Action. Both requester options are required together; the command
refuses unsupported targets and depth. Supplied labels prove policy eligibility
only, not actual lineage or authorization. Standalone role briefs remain valid
for separate independent Sessions.

Use existing Codex `spawn_agent` or Claude `Agent` with the complete generated
brief and the assignment template below. Require skill retrieval, target role,
depth 1 and no further delegation in the child's prompt. Preserve candidate
ownership and raw evidence. If an implementer writes, the Lead pauses its edits.
OpenCode's in-process native delegation path remains unverified. A separately
launched top-level OpenCode Session can perform independent review using the
same contract as Codex or Claude Code: the operator-authorized PR #1469 review
[posted an exact-head signed report](https://github.com/pmark/arcadia/pull/1469#issuecomment-6225541027)
from OpenCode 1.16.2 with `opencode-go/deepseek-v4.1-flash`. This is evidence of
that host launch and GitHub post, not governed admission, reviewer independence
for another assignment, or blanket permission to launch or message. Use the
[PR procedure's runtime and feedback contract](pull-requests.md#runtime-selection-and-feedback-delivery)
for all three systems. Unavailable tools or skills require a preserved brief and
authorized relaunch/installation, never a replacement runner.

Governed capacity admission is not live. Native launch evidence is recorded
separately and does not claim, enroll or reserve an Arcadia Session. Without
explicit host authorization, submit an Agent Ask proposal; preview grants
nothing. Follow `pull-requests.md` for independent review/QA Sessions.

The existing PR procedure permits a fresh read-only reviewer context (including a
sandboxed reviewer or subagent) for generic current-head verification. This is
not admission to the registered code-reviewer or qa role and proves no governed
attempt lineage. Requests for those registered roles still require separate
independent Sessions under Decision 0114; native role dispatch refuses them.

## Brief template

Keep the brief under one screen. Fields:

1. **Task**: the Action id and one sentence.
2. **Context**: file:line ranges to read, and the exact focused test files.
   Name `rg -n` patterns, not whole files.
3. **Acceptance**: observable criteria copied from the Action.
4. **Ownership**: the files the implementer may write; everything else is read-only.
5. **Checks**: focused tests; repo lint on touched files; for dashboard-reachable
   code `cd apps/dashboard && tsc --noEmit --listFiles | rg <module>` must give
   empty output; `node scripts/fast-rehearsal.mjs` run from the worktree root, and
   confirm `report.json` exists.
6. **Adversarial**: for any guard or validator Action, the strings or properties
   a reviewer would try (empty, whitespace, case variants, path traversal,
   every entry point to the write boundary), included as tests up front.
7. **Return**: diff sha, test command, exit code, gaps. Do not repeat sandbox
   text; summarize any sandbox limit in one line.

## Per-session ledger

Every session ends by adding exactly one row as its own file,
`docs/reports/session-ledger/<YYYYMMDDTHHMMZ>-<session_id>.json` (never append to
the frozen `session-ledger.jsonl`), validated by `pnpm check:session-ledger`.
Never guess a number; use `null` for anything unmeasured.

## Cost rules

- Targeted reads only: `rg -n` then bounded `sed -n`; no whole-file `cat`.
- Do not paste logs or tool output; cite the path and the line range.
- Cite constraints by path (`docs/agent-guidance/...`) instead of restating them.
- Reuse instructions already loaded; retrieve a section only when scope changes.
