---
arcadia: v1
type: decision
id: "0038"
slug: authorize-real-session-dogfood
project: arcadia
plan: idea-to-managed-build
action: launch-tmux-backed-session
status: open
question: Approve one bounded real Claude Code dogfood Session, using the configured provider credentials, to verify detach, terminal-close survival, reattach, exit, and resume by the preassigned provider session id?
gap_type: missing-decision
recommendation: Approve one disposable-repository rehearsal only after reviewing the implementation and deterministic evidence. The rehearsal may invoke Claude Code through the new explicit --launch path and inspect only tmux liveness plus the agent-native interface; it may not capture panes, mirror transcripts, inject input, merge, deploy, publish, message, spend beyond the configured provider invocation, access production data, or reuse the approval for another Session.
confidence: high
updated: 2026-08-30
---

# Authorize one real Session dogfood rehearsal

## Context

The `launch-tmux-backed-session` implementation and its deterministic process
boundary are complete. The full test suite proves preview and manual launch
compatibility, explicit launch, missing tmux, name collision, spawn failure,
stable identifiers, immutable packet and authority checks, one repository
lease, liveness, reattach and resume instructions, and exhaustive Project
transition outcomes without starting a real coding-agent process.

One acceptance criterion is empirical: a real Claude Code Session must detach,
survive closing its launching terminal, reattach to the same interface, exit,
and remain resumable by its preassigned Claude session id. Performing that test
would use configured provider credentials. Decision 0012 explicitly preserves
the Constitution's separate credential and spending boundaries, so the coding
Action alone does not authorize the rehearsal.

## Consequences

- **Approve:** Run one bounded rehearsal in a disposable repository through
  the exact `arcadia go --apply --agent claude --launch` path, record only the
  Session receipt and observable detach/reattach/resume results, then complete
  the Action if every remaining acceptance criterion passes.
- **Reject:** Keep the implementation and deterministic proof, but leave the
  real-provider acceptance criterion unmet and the Action open.
- **Defer:** Name the condition that revives the rehearsal; until then the
  Action remains open and Arcadia does not ask again.

## Boundary

This Decision authorizes at most one dogfood Session if approved. It does not
authorize merge, deployment, publication, outbound messaging, production-data
access, transcript capture, input injection, or a default-on Session worker.
