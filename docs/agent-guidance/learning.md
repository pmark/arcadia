# Learn before repeating work

Before implementation, repair, validation, or handoff, run a targeted `rg` lookup
in the Project's `docs/notes-to-self.md` for commands, subsystem, and failure
symptoms. Then deterministically search retained lessons in that invoking Project
scope: `arcadia learn search "<terms>" --scope project:<slug>`. Search
`--scope arcadia` only when Arcadia-wide guidance is relevant. Read matching
entries and their cited evidence before experimenting. Repeat both lookups when
a new failure appears. If the Project has no notes file, say so; do not invent
lessons or copy another Project's private material.

Notes are a verified-remedy cache. Learn records retain operator statements,
observations, inferences and imports as evidence; they are never truth or
authority. Capture durable learning with `arcadia learn "<exact text>"
--scope project:<slug>` instead of making a throwaway learning draft. Follow
the notes file's capacity, expiry and correction rules; every cache removal
first requires a retained exact-content receipt. Prefer a source fix, guard,
or meaningful regression test to another workaround. Preserve failed receipts;
record operation, failure or wasted work, exact evidence, recovery and prevention
in the session's evidence report. Distinguish verified causes from hypotheses.
Before handoff, correct reusable prevention advice and name its changed paths.
Canonical Log entries and follow-up work still go through Agent Asks. Never
change files pinned by a live operator action without refreshed validation.

Batch bounded independent reads and reuse current receipts. Do not repeat an
unchanged failed operation or expand testing without new evidence. Deterministic
checks precede model review. Use the least costly sufficient configured model
and effort; escalate for a named unmet requirement or observed failure while
preserving packet bindings.

Two unchanged workflow refusals without new evidence require
[Hacker recovery](hacker-recovery.md) before another attempt. Explicit
stop-the-line requests activate it immediately. This changes diagnostic strategy,
not authority, admission or budget. Supervisors must recognize the pattern.

This retrieval obligation implements existing learning guidance. Decision 0050
and `build-agent-agnostic-learning-loop` retain ownership of bounded automatic
reflection. The current CLI handles deterministic intake and retention only;
it adds no worker or model call.
