# Evidence: glossary-of-arcadia-session-jargon

## Editorial refresh, 2026-11-09

Source checked at [`2e5b841bd`](https://github.com/pmark/arcadia/tree/2e5b841bde29efa63e9f7fa77d1455deb6457444). The [completed November Plan](../../plans/record-run-unattended-test-pins-20261107-part-2.md) and [Project pointer](../../../PROJECT.md) show that a completed Plan can remain selected after its current Action is cleared. The [profile table](../../arcadia-semantics.md#roles-specializations-and-optional-names) includes Flynn.

The claims and review below apply to the earlier draft. The refreshed version awaits independent fact-checking.

- Type: essay (draft; not published)
- Article: docs/articles/2026-11-03-glossary-of-arcadia-session-jargon.md
- Source repository and revision checked: pmark/arcadia@a4dd86dba (main, 2026-11-03)
- Tracking Issue: #2030
- Publication: none. No Field Notes, AMC, social or Discord delivery.

## Claims

| Term | Verified against |
| --- | --- |
| classifyRecoverySignals (pure, no model; one caller) | `src/production/recoverySignals.ts` header and export; sole use in `src/production/independentReview.ts` |
| classifySession (pure, closed state set; used by stall alert detail) | `docs/session-signal-classifier.md`; `src/production/sessionSignals.ts`; `src/production/redAlerts.ts` |
| Claude Code auto-mode classifier | Existence only, from the Claude Code Bash tool description ("auto-mode classifier when auto mode is active"). Its logic is not documented in this repository and is not described. |
| Work vocabulary, Behavior, profiles, Red Alert, Grant | `docs/arcadia-semantics.md` |
| Red alert triggers | `RED_ALERT_TRIGGERS` in `src/production/redAlerts.ts` |
| Pointer, Agent Ask, preview, settle | `AGENTS.md`; `docs/articles/2026-10-23-how-an-idea-becomes-governed-work.md`; `docs/settling-actions.md` |
| Queue, make-next | `docs/COMMANDS.md` "The Agent Queue" |
| go, broker, walk, claim | `src/agentSetup/arcadia-go.SKILL.md`; `src/goBroker.ts`; `observeQueueWalk` in `src/commands/go.ts`; `docs/working-copy-safety.md`; `docs/production-scheduling.md` ("walk order") |
| Tiers, Sonnet/Opus/Haiku | `docs/model-selection.md` |
| Rounds, blocking, CodeRabbit advisory, squash merge | `docs/agent-guidance/pull-requests.md` |
| Merge gate | `AGENTS.md`; `docs/autonomous-production-operator-guide.md` (Decisions 0060, 0080) |
| Subagent depth, helpers never delegate, roles | `docs/agent-guidance/session-roles-and-briefs.md`; `config/defaults/agent-roles.json` |
| Sandbox, Auto-fix | `docs/agent-guidance/native-app-sessions.md` |
| Pointer reconcile, base_not_synced | `src/git/pointerReconcile.ts`, `src/production/workerMerge.ts`, `src/production/tick.ts` (merged 2026-11-02, #2023) |
| Waiver | `src/production/independentReview.ts`, `src/production/reviewRepair.ts`, Decision 0169 (merged 2026-11-03, #2024) |
| START card, press, pre-mortem | `docs/agent-guidance/operator-actions.md`; `docs/managed-production-readiness.md` |
| Replay | `scripts/production-replay.ts` header |
| Constitution, brief, dispatch, handoff, preserve, stop the line, Process Critic, Hacker, rehearsal, lane, Discord | `CONSTITUTION.md`; `session-roles-and-briefs.md`; `arcadia-semantics.md` (Session); `AGENTS.md`; `working-copy-safety.md`; `principles.md`; `process-critic-brief.md`; `hacker-recovery.md`; rehearsal runbook; `production-scheduling.md`; `AGENTS.md` (Discord) |
| Mutant | `docs/evidence/managed-production-release-evidence-index.md`; `tests/qa-plan-sole-failure.test.ts` (comment) |

## Left out (could not verify a definition)

- The internals of the Claude Code auto-mode classifier.
- "Replay gate" as a named gate: the repository says "replay first" and "review/replay gates" without a single definition, so only "replay" is defined.
- `enroll` (broker operation; no definition found).
- Any red-alert trigger beyond the four in code.

## Staleness noted

`docs/session-signal-classifier.md` still says the classifier "is not wired into the worker tick and raises no alerts", but `src/production/redAlerts.ts` calls `classifySession`.
