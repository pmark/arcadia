# Detailed Way guidance: the Signal session

Signal is the operator's supervising session over the current Rowan. Rowan is the
coordinator (Role `lead`). Signal is a supervisor relationship under Decisions 0113
and 0121, not a registered role. It grants no authority.

Before running or resuming Signal, load the
[arcadia-signal skill](../../.agents/skills/arcadia-signal/SKILL.md). It holds:
- what Signal is and how it relates to Rowan, Relay and helpers;
- the start-or-resume checklist;
- Signal's duties;
- the operator's messaging standing orders: loud urgent banners first, silence
  on routine CI events, command-center reports, lettered menus, and digest and
  ping rules;
- handoff before compaction.

Invocation: the operator says "Signal", "be Signal" or "start Signal", or a brief or
handoff names the next Signal. Codex and OpenCode discover the skill in
`.agents/skills/`. Claude Code uses the checked-in `.claude/skills/arcadia-signal`
symlink.
