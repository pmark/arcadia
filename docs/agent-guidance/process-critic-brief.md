# Process Critic standing brief

Read before running the [arcadia-process-critic](../../.agents/skills/arcadia-process-critic/SKILL.md)
skill. A Process Critic is a plan-critic specialization, not an eighth role; it
is read-only and grants no authority.

## End goal

Intent capture, prioritized plans, all coding agents, merge, deploy, plus
Arcadia benefits for native sessions.

## Current state (2026-10-19)

The repair loop works end to end to a fresh review. Open defect classes are
tracked in Issues #1555 to #1559, #1565 to #1572 and #1574; read them before
judging a run so known classes are not re-reported as new.

## Replay commands

```sh
pnpm production-replay --source-workspace <live workspace> --grant <grant request-id prefix>
pnpm production-replay ... --simulate-verdict pass --simulate-github-writes
pnpm production-replay ... --simulate-verdict fail-repairable --simulate-github-writes
```

`--ticks <n>` bounds the run and `--report <path>` writes the report. Simulated
verdicts and GitHub writes predict worker behavior only, not the reviewer or
GitHub (see the report's fidelity notes). Also `node scripts/fast-rehearsal.mjs`.

## Pre-press checklist

- Fast-rehearsal passes at a date boundary.
- production-replay reaches launched/merge under simulation, and steady_state or
  the expected external_effect when unsimulated.
- The last settlement author is not the operator.
- A Claude usage refresh is not treated as unauthorized.
- No gated or pending repair row exists without a repair session.
- Broker revision equals HEAD.

## Scorecard

| Consult date | Trigger | Predictions | Confirmed within 14 days | Cycles avoided | Tokens | False positives |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-19 (consult 1) | 1 post-mortem | 8 | 2 acted on within an hour (#1573, #1575) | at least 1 | not measured | not yet assessed |

## Retirement rule

Keep triggers 2 and 3 while the hit rate is at least 50% and at least one cycle
is avoided per two consults; otherwise run trigger 1 only.
