# Helper launch rule

Operator direction, 2026-11-11: every agent launch uses the proper Arcadia
identity, model and effort for that agent, and every job starts on the most
cost-effective tier. Telemetry, not memory, decides when a tier should change.

## Procedure

1. **Resolve every launch** before starting the session:

   ```bash
   arcadia role brief --role <id> --agent <codex|claude|opencode> --json
   ```

   Omit `--tier` to start on the workspace `sessionStartTier` (light by
   default). Pass `--tier` only when a named reason already requires it.

2. **Read the result.** The JSON carries:
   - `identity`: the Arcadia identity the agent commits and comments under;
   - `launch.model` and `launch.effort`: the concrete values to pass;
   - `escalationTier`: the role's ceiling, never a starting point.

3. **Pass the launch values explicitly** to the host: the model and the effort
   from `launch`. Never rely on the host's default model or effort.

4. **Give the brief the resolved identity.** Put `identity` and the role's
   brief text in the prompt, so the session signs its work under it.

5. **Start at the resolved tier.** Light is the default. Do not start higher
   because a job feels hard.

6. **Escalate one tier only after a named failure** (for example: the same test
   fails twice, or the output is wrong in a stated way). Record the failure and
   the new tier in the brief or the PR. Never jump more than one tier.

7. **Record telemetry** in the PR's work metadata for each job: role, tier,
   model, effort, outcome, tokens and minutes. This is what lets the best
   model and effort fit be learned over time.

8. **Title helper sessions with `↳`** (for example `↳ Launch rule: <state>`).
   Coordinators keep their own prefix.

## Boundaries

- The resolver grants no authority, spend or launch permission. It only says
  which identity, model and effort to use.
- A helper never delegates or messages the operator; it reports to its
  assigned coordinator.
- Commit identity follows [git-identity.md](git-identity.md); resolve it for
  the current model before every commit or comment.
- Drift between a running helper's actual model or effort and its brief is
  checked by the follow-up audit, not by this procedure.
