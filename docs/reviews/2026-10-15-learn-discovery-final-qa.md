# Independent final QA and fresh-agent discovery — 2026-10-15

Exact product head `6130bf75e48bdb409f8fb8dde88cb6baec3ecd31`. Separate canonical read-only Session, gpt-5.6-terra/standard/high, exit 0. Usage: {"input_tokens": 2644881, "cached_input_tokens": 2487040, "cache_write_input_tokens": 0, "output_tokens": 9394, "reasoning_output_tokens": 3666}. Raw wording below; trailing Markdown whitespace is normalized.

## PASS

No actionable acceptance findings at `6130bf75e48bdb409f8fb8dde88cb6baec3ecd31`.

Fresh-agent discovery: any agent may record a durable workaround, idea, or observation with:

```sh
arcadia learn "<exact text>" --scope project:<slug>
```

Bare capture defaults to `observation`, `high`, and `current`. For an uncertain design idea or external evidence:

```sh
arcadia learn "<exact text>" --scope project:<slug> \
  --provenance inference --confidence low --evidence "<source>"
```

Allowed provenance is `operator_statement|observation|inference|imported`; confidence is `high|medium|low`; freshness is `current|stale|retracted|superseded`. Evidence is repeatable; revision defaults to HEAD and source reference to the invoking repository. No novelty proof, model call, Ask, or supervisor wait is required. Exact same-text/same-scope replay deduplicates, merges supplied evidence/observations (or records a receipt); similar text remains distinct. Supervisors may harvest when assigned but are never a dependency. This is evidence only—no Action, Decision, promotion, rollout, worker, installation, or new authority. [Bootstrap learning contract](</Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/AGENTS.md:51>), [learning procedure](</Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/docs/agent-guidance/learning.md:1>), [role brief](</Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/src/agentRoles/brief.ts:22>).

Acceptance evidence:

- Project-scoped capture and restore create no Back Burner projection; explicit `arcadia` intake retains one. Legacy scoped projections are redacted and known Projects are bound before redaction. After Project deletion, the projection remains redacted while lesson-version text remains retained. An extra disposable-fixture probe passed the requested unknown-Project legacy-row case.
- Versions, exact text, receipts, provenance, evidence, observations, correction history, and restore-graph validation remain lossless. [Implementation](</Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/src/learning/lessons.ts:139>), [migration](</Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/src/db/schema.ts:1574>), [coverage](</Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/tests/learn-lossless.test.ts:39>).
- Role and Action briefs expose capture guidance. [Action-brief test](</Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/tests/agent-guidance.test.ts:184>).
- Instruction budgets pass: bootstrap 7,822/8,192 bytes; current Codex chain 12,475/32,768; disposable adopter plus an 8 KiB global instruction source 16,087/32,768. Adopter-owned text is preserved within the root limit.
- Validation passed: `pnpm vitest run tests/learn-lossless.test.ts tests/agent-guidance.test.ts tests/agent-roles.test.ts` — 63 tests; `pnpm check:agent-guidance`; `git diff --check`. Tree remained clean.

One infrastructure-only failure was preserved: an initial direct temporary-fixture probe was denied sandbox temp/IPC access (`EPERM`); the same bounded disposable-fixture audit then passed with approved local temporary access. No live workspace, capture, service, or provider call occurred.
