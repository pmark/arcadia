# Detailed Way guidance: session roles and briefs

Read this procedure before launching, briefing or handing back a Session or
subagent. The compact bootstrap and CONSTITUTION.md still bind; roles and
briefs grant no authority. Evidence: `docs/reports/production-simulation-living-notes.md`
("What works", frictions 10 and 15 to 19).

## Roles

| Role | Does | Never |
|---|---|---|
| Lead | One Action per session. Starts from a generated brief: Plan pointer, open blockers, last three rows of `docs/reports/session-ledger.jsonl`. Owns Plan, queue, scope and merge-on-green; checks `isDraft` before calling a PR ready. | Writes product code. |
| Driver | The only code writer, standard tier. Works from one brief and returns only the diff sha, the test command with its exit code, and gaps. | Repeats sandbox text, pastes logs, or claims acceptance from its own test counts. |
| Reviewer | One fresh read-only role replacing "Critic" for sessions (identity resolution still uses the critic role). A new Reviewer each round, adversarial, given raw evidence and runnable pure functions plus the failure classes to attack. | Is the author, or the later reviewer of the same head; touches the shared checkout. |
| Replayer | A deterministic script, not a model. Turns each run's receipts into fast-rehearsal fixtures so the next run catches the defect offline. | Needs a model call. |
| Observer (live) | Deferred. Revisit when the ledger shows repeated `stop_reason` `none` with zero diffs, or a stop needs judgment the platform cannot make. | Is built before that trigger. |
| Planner | Opus, for Plan design only. | Executes Actions. |

Self-reported test counts are not evidence: on guards and validators the
Reviewer's adversarial strings found bypasses the Driver's tests missed.

## Model and effort

- Lead: Sonnet, medium. Coordination and merge gating are bounded reads; a
  larger model adds cost without changing outcomes.
- Driver: Sonnet, medium; high only for guards and validators, where a missed
  bypass costs review rounds that cost more than the extra effort.
- Reviewer: Sonnet, high. Review yield per token was the best of any role, and
  a fresh context each round is what finds new defects.
- Planner: Opus, only when designing a Plan; its output is a document, not a loop.

## Brief template

Keep the brief under one screen. Fields:

1. **Task**: the Action id and one sentence.
2. **Context**: file:line ranges to read, and the exact focused test files.
   Name `rg -n` patterns, not whole files.
3. **Acceptance**: observable criteria copied from the Action.
4. **Ownership**: the files the Driver may write; everything else is read-only.
5. **Checks**: focused tests; repo lint on touched files; for dashboard-reachable
   code `cd apps/dashboard && tsc --noEmit --listFiles | rg <module>` must be
   empty; `node scripts/fast-rehearsal.mjs` run from the worktree root, and
   confirm `report.json` exists.
6. **Adversarial**: for any guard or validator Action, the strings or properties
   a reviewer would try (empty, whitespace, case variants, path traversal,
   every entry point to the write boundary), included as tests up front.
7. **Return**: diff sha, test command, exit code, gaps. Do not repeat sandbox
   text; summarize any sandbox limit in one line.

## Per-session ledger

Every session ends by adding exactly one row to
`docs/reports/session-ledger.jsonl`, validated by `pnpm check:session-ledger`.
Never guess a number; use `null` for anything unmeasured.

## Cost rules

- Targeted reads only: `rg -n` then bounded `sed -n`; no whole-file `cat`.
- Do not paste logs or tool output; cite the path and the line range.
- Cite constraints by path (`docs/agent-guidance/...`) instead of restating them.
- Reuse instructions already loaded; retrieve a section only when scope changes.
