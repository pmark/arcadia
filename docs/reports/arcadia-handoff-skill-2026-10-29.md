# Arcadia handoff skill source evidence

Operator-directed implementation; no governed Action assigned. Intake:
https://github.com/pmark/arcadia/issues/1876. Proposal:
`agentask_547bbe27954fb3d4f1`. Base and main checkpoint cursor:
`3d2fdac1cb82396816e1048677b120628334ce90`.
Native helper `/root/ellis_handoff_skill` is Ellis, depth-one implementer and sole
writer; parent `/root` coordinates independent review. This is not canonical
Session admission. Candidate branch: `codex/arcadia-handoff-skill`.

## Source and validation

One `.agents/skills/arcadia-handoff/SKILL.md`, its relative template, and the
relative `.claude/skills/arcadia-handoff` alias serve all three providers.
No executable code or telemetry adapter changed. The skill uses existing
checkpoint, preservation, governance and custody procedures.

Commands run on the candidate source (before evidence-only files):

- `node --import tsx scripts/check-agent-skills.ts`: exit 0, no problems.
- `uv run --with pyyaml python /Users/pmark/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/arcadia-handoff`: exit 0, Skill is valid.
- `node scripts/preservation-self-check.mjs`: exit 0, 3302 files inspected.
- `git diff --check`: exit 0.

Native discovery remains a separate acceptance observation: the child cannot
launch delegates; parent requested to verify fresh native Codex, Claude Code
and OpenCode discovery without executing the workflow. Filesystem validation
does not claim native discovery or installed adoption. No host integration or
live context-percentage measurement is asserted.

## Review cases

The independent reviewer should exercise these cases against the instructions:

1. Compatible fresh threshold/occupancy with insufficient room for the next
   batch, checks and preservation; inspect the recommendation and safe boundary.
2. Ample compatible headroom and a small bounded next step.
3. Absent, stale or mismatched telemetry; inspect whether unknown remains explicit.
4. Repeated failure without new evidence; inspect diagnosis versus blind restart.
5. Dirty/untracked work and an unresolved running operation at handoff.
6. Stale HEAD, changed authority or unreleased custody at resumption.

These are review scenarios, not claims of completed independent behavioral tests.
The parent owns independent review and exact-head evidence before handoff.

## Operator/end-user QA

There is no web service or hosted demo for this instruction-only change.
The operator procedure is the end-user procedure:

1. In a fresh provider session rooted in the candidate, request discovery of
   `arcadia-handoff`, naming its source, without starting the workflow.
2. Invoke that skill for a simulated handoff with no context telemetry and a
   short completed edit. It should label headroom unknown and use a heuristic
   recommendation, not invent a percentage.
3. Ask it to prepare a handoff with dirty/untracked work and an owner that has
   not released custody, without mutating live records. The artifact should
   retain that work, and resumption must not authorize editing from the file alone.

## Retrieval and friction

Inherited governance/context/index and proposal were available. Retrieved
role/guardrail, skill-creator, skills, working-copy safety, identity, PR procedure,
operator-directed-work, notes, active Plan Action and repository QA guidance.
Targeted retained lesson search found no handoff/skill creation matches.
`work monitor --no-pull-requests --json` exited 0; the new candidate was created
clean and isolated after that check. Active Action is host completion repair,
which does not own this new skill folder. No existing source skill was replaced.

Sandbox denied candidate Git branch/dependency writes; ordinary approved host
execution created only this candidate branch and bridged existing dependencies.
The first generic skill validation failed because system Python lacked PyYAML;
uv's offline cache also lacked it. An isolated uv dependency environment supplied
PyYAML and validation passed; project dependencies were unchanged. These were
validation/tooling issues, not evidence that the skill failed.

Final evidence-only checks: `pnpm check:session-ledger` exit 0 after correcting
the row to the existing schema (operator-directed issue label; no invented
governed Action), `node scripts/preservation-self-check.mjs` exit 0 (3304 files),
and `git diff --check` exit 0. Before preservation, origin/main remained at the
recorded cursor; both main checkpoint history listings were empty. Primary
checkout reflog remained unchanged at `f3195e767`, `1502c0bdf`, `4c27d4c80`.

Instruction source sizes (bytes; exact loaded sections identified above):
- `CONSTITUTION.md`: 3320
- `AGENTS.md`: 12263
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539
- `.arcadia/repo-context.md`: 703
- `.arcadia/context-policy.json`: 870
- `docs/agent-guidance/index.json`: 8771
- `.agents/skills/arcadia-role/SKILL.md`: 11841
- `.agents/skills/arcadia-guardrail/SKILL.md`: 5565
- `docs/agent-guidance/skills.md`: 3305
- `docs/working-copy-safety.md`: 16202
- `docs/agent-guidance/git-identity.md`: 5248
- `docs/agent-guidance/pull-requests.md`: 21758
- `docs/agent-guidance/session-roles-and-briefs.md`: 15378
