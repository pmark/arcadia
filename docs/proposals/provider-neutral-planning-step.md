---
arcadia: v1
type: proposal
project: arcadia
question: Can the planning step (work plan, planning packet, planning Run) run on any configured coding-agent provider, so an operator running a single non-Codex provider such as opencode is not forced through Codex?
---

# Provider-neutral planning step

## Why this project needs it

The operator runs managed production on opencode only (`opencode-cli`; capacity
is treated as unmetered by workspace config). Every Action still needs an
approved planning packet before the guarded launch will proceed
(`session preview-launch` reports "planning required"), and that step is
Codex-only in code:

- `arcadia work plan` builds a single step of executor type `codex_planning`
  and writes the packet under `prompts/codex/`.
- `src/execution/planningAuthorization.ts` selects steps by
  `executor_type === "codex_planning"`.
- `src/codex/packets.ts` and `src/stewardship/critic.ts` are keyed on
  `codex_planning_packet`.
- `coding-agent-profiles.json` defaults `planning` to `codex_planning` and only
  defines an opencode profile for `build`.

Observed 2026-09-19: Planning Decision R214 for
`clean-up-preserve-transport-request` would authorize a Codex Run while Codex
reported its 7-day window at 100% used, so production sat idle with nothing
runnable on opencode.

## What we would build locally

Nothing. Adding an `opencode_planning` profile to workspace config would change
the packet text without changing which agent plans, and opencode has no
read-only sandbox mode to make a "read-only" profile honest. A local workaround
would drift from the Way.

## What we are asking Arcadia for

1. A provider-neutral planning executor type (or the planning purpose resolved
   from `defaults.planning` rather than a hard-coded `codex_planning`), so the
   planning packet and Run follow the configured profile's provider.
2. An honest statement of what "read-only planning" means for a provider with no
   sandbox flag (for example, run in a scratch worktree and discard changes), or
   a Decision that planning stays Codex-only and `defaults.planning` may not name
   another provider.
