```text
QA DISCOVERY: PASS
HEAD: 121af1695c63574f1b34f5355e12df39a755830b
Project scope: project:rebuster
Active pointer: escalate-rebuster-image-and-text-generation-failures-through-arcadia-ask#submit-generation-failure-to-arcadia-ask

First supported retention commands (not executed; this session is read-only):

  arcadia learn "Observation: <exact useful workflow fact>" --scope project:rebuster

  arcadia learn "Inference: <tentative explanation>" --scope project:rebuster \
    --provenance inference --confidence low \
    --evidence "<direct source or observed fact>"

The fact is an observation/high-confidence bare capture. The explanation remains explicitly tentative: inference/low with its evidence. This is durable retained learning, not the short Notes cache.

Retry semantics:
- Exact replay records supplied evidence/observations; otherwise it returns a receipt.
- Similar wording is retained separately.
- Therefore, use identical text for an intentional duplicate/retry; do not alter it under the assumption it will deduplicate.

Authority/effects:
- Learn capture is zero-model evidence only. It creates no Action, Decision, promotion, rollout, implementation authority, or required follow-up.
- It must write a retained record, so this read-only session cannot execute either capture command. A normal writable host/workspace is required.
- A canonical Log entry or follow-up work would still require an Agent Ask.

Evidence and instruction path:
- Default instruction index selected `docs/agent-guidance/learning.md` for “command/subsystem/failure/retry/friction/notes”: `docs/agent-guidance/index.json:47-51`.
- Durable capture and non-authority rules: `docs/agent-guidance/learning.md:13-24, 33-36`.
- Installed Arcadia-role skill gives the exact capture syntax, uncertainty labels, and replay behavior: `/Users/pmark/.codex/skills/arcadia-role/SKILL.md:44-50`.
- QA is configured as independent, non-mutating, non-delegating; role lookup succeeded.
- Project scope/pointer: `PROJECT.md:4, 9-11`.
- The active Action is unrelated generation-failure handoff work: `docs/plans/escalate-rebuster-image-and-text-generation-failures-through-arcadia-ask.md:12-28`.

Read-only verification:
- CLI entry point available: `/Users/pmark/.local/bin/arcadia`.
- `arcadia learn --help` succeeded and exposes capture plus `search`.
- `arcadia learn search 'workflow fact tentative explanation retention duplicate retry' --scope project:rebuster` succeeded: `Matches: 0`.
- No literal scenario fact was supplied, so an exact-content duplicate search cannot be performed; the scenario-term search found no retained match.
- `docs/notes-to-self.md` is missing/unreadable. This is a reported limitation, not a blocker: learning guidance says to say so and not invent lessons (`docs/agent-guidance/learning.md:4-11`).

No files, records, worktrees, Git state, messages, or external state were changed.
```
