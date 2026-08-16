## Arcadia Context

This repository is on the Arcadia Way. These files govern how work is done
here, and every coding agent is bound by them equally:

- `CONSTITUTION.md` — the standing constraints. `arcadia next` prints them
  with the objective, so they arrive when authority is granted.
- `PROJECT.md` — the work pointer: one `active_plan`, one `current_action`.
- `docs/managed-documents.md` — how managed documents, the pointer chain,
  and enforced fields work, when this repository has a copy.

Before broad repository exploration, read:

- `.arcadia/AGENT_CONTEXT_POLICY.md`
- `.arcadia/repo-context.md`
- `.arcadia/context-policy.json`

Use targeted searches, respect denied paths, and keep discovery bounded by the Arcadia context policy.

For continuation requests — "arcadia go", a bare "go", or "Get to work" —
resolve `active_plan` and `current_action` from `PROJECT.md`; never select
work from an unordered backlog.

Commands follow the naming rule: **nouns read state, verbs may mutate it
within declared authority**. Trust the part of speech. A noun that writes is a
bug in the name as much as in the code.

### A current Action is executable only when

- it exists exactly once in the active plan;
- its status is anything but `done`;
- its clarification is `clarified`;
- its responsibility is `autonomous` or `codex`;
- its `next_action` begins with a concrete verb; and
- its acceptance criteria define observable completion.

**`open` is executable.** An Action does not have to be `in_progress` to be
picked up, and dispatch refuses only `done`. If any condition fails, repairing
the control documents **is** the immediate work — not an obstacle to it.

### Before you stop

Do one of three things, and update `PROJECT.md`, the active plan, affected
Decisions, and `MISSION_LOG.md` wherever their authoritative state changed:

- complete the Action, validate it, record the result, and select the next one;
- record one precise operator question required for review; or
- record a concrete external blocker and the draft ask needed to resolve it.

A merged pull request, a ratified Decision, or a plan reaching its milestone
is itself a stopping condition. Open or update a pull request then — without
being asked, and without waiting for the plan to close out. Then say whether to
continue in this session or start a new one and why, and which model and effort
level the next batch actually needs.

When a message ends with exactly one concrete, immediately actionable next
step — nothing blocking, no open question, no choice pending — end it with a
fixed line, last in the message, preceded by a blank line:

```
OK to go: <verb-first, one-sentence description of exactly what will happen>
```

That prefix verbatim, never a paraphrase. Present if and only if the state is
dispatchable. **Absence is the signal** — when nothing is ready, omit the line
rather than writing "not ready yet" in its place.

`docs/agent-continuation-protocol.md` carries these rules with the reasoning
behind each. It is a reference, not a prerequisite: everything you must do is
stated above.
