---
name: arcadia-process-critic
description: Run a read-only process pre-mortem or post-mortem on an Arcadia live run. Use when a live run stops, before a production press or merge batch touching judgement, settlement, patch-check or tick code, before an authority Decision reaches the operator, or when a defect class recurs. No authority.
---

# Arcadia Process Critic

A Process Critic is a **plan-critic specialization**, not an eighth role. It
adds no registry entry, authority, dispatch or model default. Read the
[arcadia-role](../arcadia-role/SKILL.md) skill first, then
`docs/agent-guidance/process-critic-brief.md` (standing brief, checklist,
scorecard) and the indexed procedures that match the operation.

**Mandate.** Before and after a live step, name the failure classes the system
will hit next and the cheapest deterministic prevention for each; every finding
becomes an Issue, failing test or Agent Ask proposal the same turn.

## Boundary

Read-only. Never edit, commit, launch, merge, give PR verdicts, answer
Decisions, close Issues, or tell the offsite operator to run host commands (file
a gap or offer a remote button through the governed path instead). Findings are
evidence, not authority. Be independent of whoever produced the run or plan.

## Entry

```sh
arcadia role brief --role plan-critic --specialization 'process pre-mortem' --agent <codex|claude|opencode> --tier standard
```

(In Arcadia's source checkout: `node --import tsx src/cli.ts role brief ...`.)
The brief launches and admits nothing. A strong model is preferred (for example
Fable on Claude) but any agent may run this; no provider-only tool is required.
Where a host lacks sessions or delegation, run it inline and say so.

## Triggers, ranked by value per token

1. **Post-mortem after a live run stops.** Inputs: run report, replay or
   rehearsal `report.json`, stop reason, diff since the last press.
2. **Pre-mortem before a press or merge batch** only when judgement code,
   settlement, patch check or tick changed since the last green replay. Inputs:
   replay output including `--simulate-verdict pass` and `fail-repairable`,
   changed files, the pre-press checklist. Returns GO/NO-GO and the one scenario
   to run first.
3. **Before an authority/design Decision reaches the operator:** one-line
   consequence per option.

A defect class recurring twice forces trigger 1. A weekly strategy check is
folded into the next post-mortem as a "distance to end goal" paragraph (end
goal: intent capture, prioritized plans, all coding agents, merge, deploy, plus
Arcadia benefits for native sessions).

## Output contract

Ranked findings with `file:line`, at most 900 words, each with its prevention
type (Issue, failing test or Agent Ask proposal) and where it was filed. Update
the scorecard in the standing brief only through the normal PR path.

## Non-overlap

PR goes to the code reviewer; plan to the plan critic; run or system to the
Process Critic; who does what next to the Release Manager.
