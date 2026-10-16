# Three-agent Arcadia skill support — 2026-10-16

Direct operator request, intake #1464. No governed Action exists for this work;
the active Plan/Action and queue are untouched. Candidate:
`codex/neutral-arcadia-skills-20261016`.

## Result and acceptance

Release Manager is maintained with the repository skills. Every repository skill
has a relative Claude alias to the same source Codex and OpenCode discover.
The existing agent-guidance CI check now rejects missing, stale, absolute or
malformed discovery entries. New/modified personal and generated skills are
also covered by the indexed maintenance procedure and root instructions.

On this Mac, missing personal aliases were installed in `~/.agents/skills` and
`~/.claude/skills`, preserving existing entries. Existing personal Release Manager
remains the installed source until the repository version lands. No automation,
coordination or service operation was started. OpenCode `debug skill` confirms
Release Manager and all eleven Arcadia-named/purpose skills in its native
catalog. Raw native output stays in temporary local custody, not the repository.
Claude discovery is verified at the filesystem level only; no Claude inference
session was launched. Codex already listed the personal Release Manager at
session start. No claim of live cross-provider behavior is made from symlinks.

## Validation

- Discovery regression: 5 tests pass (valid shared source; missing Claude alias;
  stale source; nonportable absolute alias; invalid frontmatter).
- Existing generated broker skill setup: 43 tests pass.
- Agent instruction delivery and skill discovery checks pass for all 3 agents.
- `pnpm build` passes, including full lint, TypeScript and Discord build.
- `git diff --check` passes.
- Independent current-head review and CI are recorded on the PR.

## Friction and prevention

The new guidance fingerprint initially included the trailing newline; the existing
`guidanceFingerprint` trims input. Corrected the index to its actual contract;
validation now passes. The standalone Python validator lacked PyYAML in both
host and bundled Python; the repository validator uses its existing YAML package.
The `.claude/*` ignore rule hid new aliases; the candidate now allows the skill
subdirectory so required discovery links are tracked rather than host-only.

## Retrieved instructions

Startup/control/context and indexed procedures below were read. Relevant bounded
reads: current Action `claude-worker-launch-replay`; notes matches for skills,
OpenCode and guidance fingerprints; Arcadia repository Orientation, Semantics,
Model Selection, PR QA and Working-Copy Safety. Existing triage installation
reference establishes the shared-source pattern. Skill-creator and guardrail
were loaded. Sections not relevant to the operation were not imported.

| Instruction path | Bytes in candidate |
| --- | ---: |
| `CONSTITUTION.md` | 3320 |
| `PROJECT.md` | 31677 |
| `.arcadia/AGENT_CONTEXT_POLICY.md` | 539 |
| `.arcadia/repo-context.md` | 703 |
| `.arcadia/context-policy.json` | 870 |
| `docs/agent-guidance/index.json` | 9860 |
| `docs/agent-guidance/continuation.md` | 7256 |
| `docs/agent-guidance/operator-directed-work.md` | 4494 |
| `docs/agent-guidance/learning.md` | 2458 |
| `docs/agent-guidance/standard-harness.md` | 5569 |
| `docs/working-copy-safety.md` | 16202 |
| `docs/agent-guidance/pull-requests.md` | 17585 |
| `docs/agent-guidance/git-identity.md` | 5248 |
| `docs/agent-guidance/chat-titles.md` | 4766 |
| `docs/agent-guidance/session-roles-and-briefs.md` | 6152 |
| `docs/agent-guidance/rehearsal-freeze-window.md` | 4690 |
| `/Users/pmark/.codex/skills/.system/skill-creator/SKILL.md` | 15311 |
| `/Users/pmark/.codex/worktrees/neutral-arcadia-skills/arcadia/.agents/skills/arcadia-guardrail/SKILL.md` | 5565 |
