## What changed

<!-- Describe the observable change. -->

## Why

<!-- Explain the operator or end-user value. -->

## QA plan

### Operator procedure

| Service / target | Reachability | Start or recovery command | Exact URL | Expected change |
| --- | --- | --- | --- | --- |
| <!-- name --> | <!-- local-only / LAN / remote / missing / unreachable --> | <!-- command or not needed --> | <!-- include protocol, host, port, and route --> | <!-- observable result --> |

1. <!-- Step -->
   - Expected: <!-- Observable result -->
2. <!-- Step -->
   - Expected: <!-- Observable result -->

### End-user procedure

<!-- Provide distinct numbered steps when they differ from the operator procedure. Otherwise write: “Same as the operator procedure.” -->

### If no runnable target exists

<!-- State why, link the strongest available proof Artifact, and name the condition that will make testing possible. Delete this section only when a runnable target is provided above. -->

## Validation run

- [ ] <!-- Command or deterministic check -->
- [ ] <!-- Command or deterministic check -->

## Risk or follow-up

<!-- State none, or name the exact follow-up and its trigger. -->

## Work metadata (80/20)

<!-- Required. When filling in, remove the HTML comment markers around the block below. Roles are the governed registry roles (Decisions 0100 and 0112); `implementer` corresponds to the attempt role `development` and `code-reviewer` to `code-review`. Keep exactly one block; never invent numbers (`unknown` is allowed); update it after each review round, push, and at merge-ready. It grants no authority and is not a merge gate. Purpose: calibrate size and token/time estimates, and model selection, from actuals. -->

<!--
```arcadia-work-metadata
version: 1
action: <plan/slug#action-id, or operator-directed:#<issue>>
size: S | M | L        # about 30 / 55 / 90 minutes of agent work in one session
operator_gate: none | <reason the operator must act: merge-authority, decision, operator-step, credentials, spend>
agents:                # one entry per agent that did work: author, reviewers, fixers
  - role: lead | planner | plan-critic | implementer | code-reviewer | qa | researcher
    provider: claude-code | codex | opencode
    model: <model id>
    tier: light | standard | heavy
    tokens: <total processed tokens from the runtime's usage report, or unknown>
    minutes: <wall minutes, or unknown>
review_rounds: <n>
ci_pushes: <n>
wall_minutes: <request to merge-ready, or unknown>
```
-->
