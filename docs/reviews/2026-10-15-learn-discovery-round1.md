# Independent review round 1 — 2026-10-15

Exact source head `12230f4a138a3b3441b64601d36c08f4fb4f7379`. Separate canonical code-reviewer process, gpt-5.6-terra / standard / high, read-only, exit 0. Raw report below; verdict is blocking despite process success. Usage: {"input_tokens": 1177932, "cached_input_tokens": 1052928, "cache_write_input_tokens": 0, "output_tokens": 9941, "reasoning_output_tokens": 6525}.

Review findings — not pass.

1. **High / blocking — project-scoped Learn capture leaks its text into an unscoped Back Burner record.**  
   The new bootstrap directs agents to capture with `--scope project:<slug>` and promises privacy/scope gates at [AGENTS.md:54](/Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/AGENTS.md:54). But `captureLesson` copies the exact lesson text into `back_burner_items` without a `projectId` at [src/learning/lessons.ts:162](/Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/src/learning/lessons.ts:162). The resulting record has `project_id = null`, despite the lesson itself being project-scoped. This conflicts with Decision 0050’s scope-isolation rule and can expose Project material on the unscoped Back Burner surface. Bind the Back Burner record to the resolved Project—or avoid creating it for scoped lessons—and add a regression test asserting scope isolation for both `lessons` and `back_burner_items`.

2. **High / blocking — the delivered command overpromises metadata, replay evidence, and no queue mutation.**  
   [AGENTS.md:55](/Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/AGENTS.md:55) says the bare command labels provenance/evidence/uncertainty, makes no queue mutation, and that an exact replay “adds evidence.” In reality, the bare command defaults to `observation` and `high` confidence at [src/learning/lessons.ts:142](/Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/src/learning/lessons.ts:142), receives no `--evidence`, and an exact replay only adds evidence when supplied explicitly at [src/learning/lessons.ts:152](/Users/pmark/.codex/worktrees/learn-agent-discovery/arcadia/src/learning/lessons.ts:152). A new capture also creates a Back Burner item, contradicting “no … queue mutation.” The same promise is propagated through role/supervisor guidance. Document the metadata flags or exact-text convention, say replay adds supplied evidence/observations (otherwise a receipt), and accurately limit the non-mutation claim to no Action, Decision, promotion, or rollout.

Validation independently passed:

- `pnpm exec vitest run tests/agent-guidance.test.ts tests/agent-roles.test.ts tests/learn-lossless.test.ts tests/notes-to-self.test.ts` — 64 passed
- `pnpm check:agent-guidance` — passed
- `git diff --check` — passed