# Daily Orientation Packet ("Today/Now") — Specification Set

A daily-use feature that keeps the operator oriented: a small **Context Ledger**
of what's currently true, a scheduled **Morning Packet** pushed to Discord, and a
**Correction Loop** that improves the ledger from replies. The stated blocker to
adopting Arcadia for personal daily use.

**Status: implemented and live in production** (`src/orientation/`,
`src/commands/orientation.ts`, `apps/discord-bot/src/orientation/`,
`apps/discord-bot/src/replyRouter/`). Docs 00–01 are the original
specification; doc 02 is a reliability follow-up written after the first
night of real use surfaced real gaps between "works as specified" and "I can
bet something important on this."

## Documents

| # | Doc | Purpose |
|---|---|---|
| 00 | [Findings](./00-findings.md) | Scheduler/Discord/ledger-placement investigation; overlap rulings (esp. vs `work_items`, `back_burner_items`, `dailyAdvantage`); why the reply seam is extracted. **Start here for background.** |
| 01 | [Spec](./01-spec.md) | Scope/non-goals, ledger schema, staleness rules, packet composition, reply-parsing contract + failure behavior, test plan, open questions. |
| 02 | [Reliability Follow-Up](./02-reliability-followup-context.md) | Portable context for continuing the design conversation elsewhere. Documents four real bugs found on the first live night (three silent/confusing failure modes, one missing capability) and the unresolved tension between Arcadia's cost-minimizing "never silently escalate to cloud" rule and this feature's actual job of never dropping something important. **Start here if picking this up fresh.** |

## Depends on

- [Discord Reply Router](../discord-reply-router/00-spec.md) — the shared
  bidirectional reply seam (also consumed by the Image Playground).
- The Intelligence service as a companion app (one `text.generate` call per
  reply).

## Headline findings

- **No scheduler engine exists.** Recurring work = launchd `StartInterval`
  pollers (`buildIngressServicePlist`). Use a **date-guarded, idempotent-per-day**
  packet job.
- **`dailyAdvantage` is not this.** It selects one codex-plannable Action
  (project-execution domain), not personal life/art/family context.
- **Boundary vs the task system is the main risk.** The ledger holds ~10
  orientation facts and **never writes to `work_items`**; "parked ideas" may be a
  view over `back_burner_items` rather than a second idea store.
- **The reply seam is shared** with the Image Playground and is extracted into its
  own spec so it is built once.

See the cross-plan [BUILD_ORDER.md](../BUILD_ORDER.md) — this feature is
recommended **first**.
