---
id: missing-bounded-fixture-consumer
cost: unmeasured
fix: https://github.com/pmark/arcadia/issues/1389
status: open
---
Ask approval queues a Run, but the production worker is refused in an experiment workspace. The generic headless test seeds another path and cannot prove Ask-to-completion. No live Scout attempt was made.

Evidence: `src/commands/review.ts:1326`, `src/workspace/experimentGuard.ts:365` and the existing Ask/To-do report (pending Run, absent exact file, zero provider calls).

Rule/test: `COMMAND_CLASSIFICATION["worker start"]` and `tests/experiment-workspace-guard.test.ts` retain the refusal. Do not bypass it with a custom internal worker wrapper. This friction is open until a reviewed canonical bounded fixture consumer, exact assignment and durable goal budget pass the existing isolation/approval gates. Revival trigger: those capabilities land with production Off.
