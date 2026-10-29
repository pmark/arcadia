---
name: arcadia-handoff
description: Assess whether an Arcadia session should continue, prepare a handoff, or hand off before context exhaustion; preserve verified work and resume it safely. Use at a context-pressure checkpoint or for an explicit session handoff or resumption. Does not transfer custody or launch a replacement.
---

# Deliberate session handoff

Prefer a short, deliberate handoff before context exhaustion when practical.
Automatic compaction remains a fallback; this skill cannot guarantee avoiding it.
Keep the standard harness unmodified. Use existing explicit checkpoints, not a
new polling loop, hook, timer, supervisor service or session launcher.

## Assess the next bounded step

At a natural verified boundary, or before a large read, diagnostic or new batch,
ask whether the remaining usable context can comfortably hold **the next step,
its verification and durable preservation**. Keep a concise handoff current after
meaningful increments; maintaining it does not require starting a new session.

When supported host telemetry is available, record its source, observation time,
provider/version, current occupancy and effective compaction threshold with their
counting scope. Subtract occupancy from the threshold only if both count the
same context. Do not substitute cumulative token spend, account quota, a generic
model window or a supervisor's impression. Include expected tool output and an
explicit conservative allowance for verification, preservation and uncertainty.
Next-step cost is still an estimate, even when headroom is measured. Do not
invent a universal percentage or reserve; calibrate policy from observed sessions.

If telemetry is absent, stale or incompatible, say **heuristic; headroom unknown**.
Use a natural stopping point and expected batch size. Repeated rediscovery, lost
constraints or reopened conclusions prompt diagnosis; they do not prove context
exhaustion or justify restarting an unchanged failed approach. A supervisor
without telemetry has no more precise measurement than the worker.

Report one outcome with its evidence, uncertainty and next action:

- **Continue:** the next bounded step appears to fit; retain the checkpoint.
- **Prepare:** refresh the durable handoff now; avoid starting a large batch.
- **Recommend handoff:** preserve work at a safe boundary and use the existing
  authorized transfer route. Finish or safely stop and reconcile in-flight
  operations first; a warning alone must not interrupt a consequential operation.

Reassess at the next explicit checkpoint. Do not send repeated unchanged alerts.
A recommendation grants no dispatch, messaging, claim release or completion
permission. Missing host capabilities remain explicit boundaries.

## Preserve the handoff

Read the Project's indexed continuation, working-copy, Agent Ask and checkpoint
procedures for the operation; resolve them through its `AGENTS.md` and
`docs/agent-guidance/index.json`. An adopting Project without required guidance
must recover that guidance before the affected operation, not guess commands.

Use [the template](handoff-template.md). Save one concise handoff through the
existing checked-in-file or Agent Ask route, in the authorized candidate or
configured workspace. Chat is a pointer to that artifact, not its only custody.
Reference canonical records instead of creating a competing state store. Keep
facts, technical conclusions and supporting evidence; omit a transcript or
private reasoning. Mark unknowns and failures explicitly.

Derive changed paths from actual Git status/diff, including untracked work.
Record exact revisions and distinguish committed, pushed and local-only work.
Follow existing preservation/PR procedures; an external publication failure
remains a named boundary. Writing a handoff neither completes the Action nor
releases its owner. Keep discovered follow-up work in existing canonical intake.

## Resume safely

The receiver reads mandatory governance and the handoff, then verifies:

1. Current Plan/Action, Decisions, scope and acceptance still match the assignment.
2. Worktree, branch, HEAD, dirty/untracked work and evidence match the record;
   inspect changes since the recorded main-checkpoint cursor as required.
3. In-flight operations are reconciled before retrying them.
4. Actual custody and any required transfer permit this receiver to edit.

If facts changed or custody is unresolved, diagnose that discrepancy before the
recorded next edit. Reuse still-valid test evidence; rerun checks only when the
revision or uncertainty requires it. A fresh session should receive the concise
handoff and required source references, not a wholesale copy of the conversation.

Keep recommendation, artifact preservation, delivery receipt, custody transfer,
and resumed execution separate. Never infer one from another or from silence.
Do not move pointers, settle completion or widen authority to finish a handoff.

## Provider boundary

The workflow applies to Codex, Claude Code and OpenCode. Telemetry is optional;
use only the installed host's supported, verified capability. Codex documents
[`thread/tokenUsage/updated`](https://developers.openai.com/codex/app-server/)
and [compaction configuration](https://developers.openai.com/codex/config-reference/);
that does not prove an Arcadia integration receives those values. Verify the
installed version and counting scope before a measured recommendation. No live
telemetry integration for any provider is supplied by this skill. The heuristic
fallback supports all three without provider-specific tools or harness changes.
