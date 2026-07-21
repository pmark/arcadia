# Daily Orientation Packet ("Today/Now") — Specification Set

A daily-use feature that keeps the operator oriented: a small **Context Ledger**
of what's currently true, a scheduled **Morning Packet** pushed to Discord, and a
**Correction Loop** that improves the ledger from replies. The stated blocker to
adopting Arcadia for personal daily use.

**Specifications only. Nothing here is implemented.**

## Documents

| # | Doc | Purpose |
|---|---|---|
| 00 | [Findings](./00-findings.md) | Scheduler/Discord/ledger-placement investigation; overlap rulings (esp. vs `work_items`, `back_burner_items`, `dailyAdvantage`); why the reply seam is extracted. **Start here.** |
| 01 | [Spec](./01-spec.md) | Scope/non-goals, ledger schema, staleness rules, packet composition, reply-parsing contract + failure behavior, test plan, open questions. |

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
