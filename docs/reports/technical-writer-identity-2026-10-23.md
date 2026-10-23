# Technical writer identity · 2026-10-23

Intake: [Issue #1715](https://github.com/pmark/arcadia/issues/1715). Operator-directed request: “I know I said I wasn't going to bloat the roles and identities, but I think we also need a technical writer who can write articles. What I'm thinking is I want to be able to ask for certain things to be done just by calling upon roles by name.” **Clara — Technical Writer** is Rowan's proposed working name, not an operator-selected name; the functional definition remains usable if the operator changes that handle. This is documentation implementation, not an article assignment or a governed Action completion.

## Assignment and result

Ellis is the depth-one implementer and sole writer in `/Users/pmark/.codex/worktrees/technical-writer/arcadia`, branch `codex/technical-writer-identity-20261023`, base `f3d49ef549ea309c947bd61c87cd6fd470933ce3`. Complete generated brief: `/private/tmp/arcadia-clara-implementer-brief.json`, role `implementer`, specialization `technical writing identity profile`. It proves preparation, not actual runtime model or effort; actual metadata unavailable. No further delegation.

Canonical semantics defines Clara as the eighth human profile over the unchanged seven registered roles. Article and documentation artifact production uses `implementer` with technical-writing specialization and writing-only Ownership. Researcher remains read-only. Clara reuses evidence from source owners, distinguishes observed/proposed/unproved facts and returns factual gaps to Rowan. This adds no mandatory review stage, runtime routing, CLI name alias, schema, registry or per-name skill.

The existing brief procedure and shared role skill retrieve that mapping. START_HERE demonstrates name plus outcome: “Clara, write a short article explaining how our agents collaborate.” Explicit destinations and existing Project/operator preferences govern. For this repository's operator, Arcadia articles/explainers default to the existing Arcadia Articles folder; resolve it or ask for its path/link when unavailable, and never silently substitute repository docs/articles. Other Projects keep their own destinations. Drafting does not authorize publication, sending or posting. No actual article was requested here, so no folder discovery or external write occurred.

## Validation and portability

- `node --import tsx scripts/check-agent-skills.ts`: exit 0, no filesystem discovery problems for Codex, Claude Code and OpenCode.
- `node --import tsx scripts/check-agent-guidance.ts`: exit 0, including after final wording/fingerprint updates. Receipt `/private/tmp/arcadia-clara-guidance-check.json`.
- `pnpm exec vitest run tests/agent-roles.test.ts tests/agent-skill-discovery.test.ts`: exit 0, 43 tests across 2 files passed.
- `git diff --check`: exit 0.
- Shared `.agents/skills/arcadia-role` and the unchanged relative Claude alias preserve the single source. Codex/OpenCode shared filesystem discovery and Claude same-source discovery are distinct from fresh native discovery, which was not performed for any provider.
- No runtime source changed; no full suite, health probe, production replay, provider call or article output was performed. No validation failures in this increment. Parent retains independent PR review and preservation responsibility.

## Retrieval and custody

Parent retained work-monitor `/private/tmp/arcadia-clara-work-monitor.json` (2026-10-23T18:42:50Z), no competing writer identified; old overlapping candidates had no exact-root cwd holders in the parent's limited check. Targeted Notes lookup for article/writer/writing/explainer/technical found no specific remedy; parent retained lesson search `/private/tmp/arcadia-clara-lessons.json` with zero matches. Dependencies were bridged using the existing documented helper before assignment.

The exact current `cover-mail-ack-receipt-kind-collision` Action limits work to native-mail tests, so it does not overlap this direct request. Project pointers, Plans, Decisions and queues were unchanged. Reused unchanged Constitution/context/working-copy/learning procedures loaded earlier; read the new complete brief, current skill/semantics/profile sections, indexed skills and operator-directed guidance, Project pointer and exact Action, and targeted Notes.

Loaded/retrieved source sizes in this candidate (UTF-8 bytes; relevant sections except complete brief and skill contract):
- `/private/tmp/arcadia-clara-implementer-brief.json`: 5322 bytes.
- `AGENTS.md`: 10562 bytes.
- `CONSTITUTION.md`: 3320 bytes.
- `PROJECT.md`: 31687 bytes.
- `.arcadia/AGENT_CONTEXT_POLICY.md`: 539 bytes.
- `.arcadia/repo-context.md`: 703 bytes.
- `.arcadia/context-policy.json`: 870 bytes.
- `docs/agent-guidance/index.json`: 11196 bytes.
- `docs/agent-guidance/skills.md`: 3305 bytes.
- `docs/agent-guidance/operator-directed-work.md`: 4494 bytes.
- `docs/agent-guidance/session-roles-and-briefs.md`: 11978 bytes.
- `docs/arcadia-semantics.md`: 21639 bytes.
- `.agents/skills/arcadia-role/SKILL.md`: 11685 bytes.
- `START_HERE.md`: 234644 bytes.
