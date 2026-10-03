# Detailed Way guidance: continuation

Read this procedure before its indexed operation. The compact bootstrap and
CONSTITUTION.md still bind; retrieval grants no authority.

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

When your environment lets you name or title the current session or
conversation, title it so it stays distinguishable when a session list cuts it
to its first ~20 characters: `<kind><state> <PLAN> <current_action>` (e.g.
`🔨🔵 WD stop-dumping-rationale-into-recommendation`), never a generic label
like "Arcadia Go". The arcadia-go brief broker returns every state's title in
`data.sessionTitles`; use those verbatim. Composing one by hand:

- **kind** — 🔨 build an Action, 🔍 review or critique, 🧭 plan, 🩹 repair
  control documents;
- **state** — 🔵 working, 🟣 PR open and in review, 🟡 required
  checks running on a merge-ready head (review finished, CI is the
  last gate before merge), 🟠 waiting on the operator (a picker or question),
  🔴 externally blocked, 🟢 done or merged;
- **PLAN** — the first letter of each word of the `active_plan` slug, skipping
  `a an and at by for in of on or the to with`, uppercased and capped at four
  (a one-word slug keeps its first three letters); omit it, with its space,
  when the session has no Plan — never fill it with a placeholder.

Retitling on every state change is a required step, not a nicety — treat it
the same as updating `PROJECT.md`: do it immediately when the state actually
changes (pushing a PR, the review finishing so checks start, stopping at a
picker, hitting a blocker, finishing), never batched for later and never
skipped because the change felt minor. It is cheap: reuse the `sessionTitles`
map already returned by the current brief and call the title tool with the
matching key, with no recomputation. The map names only the Action that
brief resolved: when the session moves on to a different Action, rerun the
brief launcher and retitle from its fresh `data.sessionTitles` instead of
reusing the old map. Skip retitling only in a coding-agent runtime
that exposes no session-naming capability at all — never skip it merely
because the session is mid-task.

Commands follow the naming rule: **nouns read state, verbs may mutate it
within declared authority**. Trust the part of speech. A noun that writes is a
bug in the name as much as in the code.

### A current Action is executable only when

- it exists exactly once in the active plan;
- its status is anything but `done`;
- its clarification is `clarified`;
- its responsibility is `autonomous` or `agent`;
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

**A stopping point has exactly two valid terminals: a pull request or an
actionable picker.** Do not stop with a narrative report, a bare status update,
or an `OK to go` line. If completed work is ready to hand over, open or update
its pull request and link it. Otherwise present the live next moves as an
actionable picker the operator can select without reconstructing the state. Use
the host's native picker when it exists; where it does not, use a plainly
labelled, numbered selection prompt. A one-option picker is still a picker.

- **Every option states its consequence**, not just its name. "Merge #159" is a
  label; "Merge #159 — proposals go live for every adopting repo, and the
  pointer advances" is a choice. An option whose consequence you cannot state
  is one you have not thought through yet.
- **Offer only live options.** Something already settled is not a choice, and
  re-asking it spends the attention budget this rule exists to protect.
- **Say when the session should end, and what opens the next one.** Almost
  always that is `arcadia go` in a new session: the pointer already knows what
  comes next, so naming a task instead would be guessing ahead of it. Name a
  different opening move only when it genuinely differs, and say why.
- **Size the next batch.** Which model and effort level that work actually
  needs, not whatever is already running.

This rule applies even when there is exactly one immediate action: show that
one action as a single-option picker unless a pull request is the completed
work's handoff. The absence of both a pull request and a picker is a defect in
the handoff, not a neutral ending.
