---
arcadia: v1
type: proposal
project: arcadia
question: Should an operator's direct request for new work become a first-class, tracked, parallel Plan, so it can start immediately without a queue slot and without disturbing the active Plan?
---

# Operator-directed work as parallel Plans

## Why this project needs it

Operators will ask a coding agent for a feature directly, in the agent's own
chat, or by Discord or Ingress, and expect work to start at once. The ping
feature (PR 975) is the precedent: the operator described it, the agent built
it in an isolated worktree, opened a Decision for the messaging boundary, ran
three independent review rounds and CI, and held the merge for a peer session's
rehearsal window. Every safety gate worked. What it did not leave is a trace:

- No Action existed, so no queue entry, no dashboard row, no board item, and no
  `complete` settlement. "One session completes one Action" had nothing to
  complete.
- Start-of-session retrieval (CONSTITUTION.md, PROJECT.md, the current Action)
  was skipped, because nothing pointed at the work.
- It was unclear to the agent and the operator which steps could be informal.

Arcadia manages several tracks at once; this is one more track, and today it
has no home. The natural home is a Plan of its own: one Action for simple work,
a few for complex work, running beside the active Plan. Parallel Plans in one
repository are planned, and they are the right foundation.

## What was tried, and what it showed

A workaround was drafted and tested without shipping it: an untargeted
`intent: plan` Ask opens an inactive one-Action draft Plan inside the session's
candidate worktree, and an `intent: complete` Ask with
`target_ref: plan/<slug>#<action-id>` closes it before the handoff push. An
end-to-end test against a generic governed Project (not Arcadia) showed:

- It works. The active Plan, the Project pointer, the queue and the base
  checkout stayed byte-for-byte unchanged; the record landed on the candidate
  branch; the Log gained the completion entry.
- `complete` takes no `--responsibility` (only the opening `plan` Ask does), and
  applies without `--operator`.
- A duplicate Action id across two draft Plans is not caught when the second
  opens; `complete` refuses it as ambiguous. Ids need a subject and date.
- Several Actions in a draft Plan are a hazard: a partly completed draft Plan
  carries its own `current_action`, and dispatch reports another Plan's
  `current_action` as a blocker whenever PROJECT.md's `current_action` is empty
  (`src/docs/dispatch.ts`, "designates a competing current_action"), which
  happens when the active Plan finishes. So the workaround only holds for one
  Action per request.
- It adds a Plan document and a Log entry but does not put the request on the
  GitHub board or the queue, so it buys little visibility for its ceremony.

Verdict: do not ship the workaround. It would be thrown away when parallel
Plans land.

## What we would build locally

Nothing. This is a request for Arcadia, not a local script. Interim practice is
the short guidance in `docs/agent-guidance/operator-directed-work.md`.

## What Arcadia would provide

1. **Intake.** A direct request from the operator opens a small Plan, not a
   loose PR. Today only this session's chat can carry one. Discord and Ingress
   reach `arcadia ask` (recording `--source-ingress`), but the bot authorizes by
   guild and channel only (`docs/AGENT_ORIENTATION.md`); its per-user allowlist
   (`DISCORD_ALLOWED_USER_IDS`) gates only the reply router. **A verified
   per-operator identity on the `ask` path is a prerequisite** before a remote
   request can be treated as an instruction; until then it is a signal.
2. **Triage by size, ambiguity and blast radius:** small and clear starts
   immediately; clear but multi-step lands a short written plan in the PR then
   builds; complex or ambiguous runs the two-phase planning process
   (docs/planning-process.md) and asks its open questions as Decisions with
   options, which the operator answers in Discord or the dashboard. A ping says
   "I need you"; a Decision is the two-way channel.
3. **Visible tracking.** The request appears on the queue, the dashboard and the
   GitHub board like any planned Action, linked to its PR.
4. **Parallel by construction.** It never reorders another Plan's queue, takes
   another session's claim, or bypasses a freeze window or a peer's hold.
5. **Remote asks stop at a pull request** once identity is verified (item 1),
   and are acknowledged with `arcadia ping`, never an improvised reply. Review and CI still gate everything;
   merging and restarting services from a remote ask is a later, separate
   decision once the path has proven itself.
6. **Same gates as planned work.** Isolated worktree, `work monitor`, agent
   identity, tests, PR with a QA plan, independent review, and a Decision for any
   approval boundary or change to what agents may do.

## Open questions for the operator

- Should every request be a Plan (even one Action), or only when it needs more
  than one Action?
- Is the GitHub Issue the right visibility signal until parallel Plans land, and
  should it be required or only suggested?
- Should a peer-session hold ever yield to an operator instruction in chat?
  (Today: the agent reports the hold; the operator's instruction is an ordinary
  operator decision.)

## Revival trigger

Parallel Plans in one repository land, or three or more operator-directed
requests have been run under the interim guidance, whichever comes first. At
that point turn this into a Plan with Actions for intake, triage and visible
tracking.
