# Discord Reply Router — Shared Seam

The single owner of bidirectional Discord reply machinery: outbound
`messageId → target` registry, per-user-ID authorization, reaction
acknowledgements, downtime tolerance, and threaded-reply dispatch to
feature-specific handlers.

Extracted because **two** features depend on it — the
[Daily Orientation Packet](../daily-orientation-packet/01-spec.md) correction
loop and the [Image Playground Phase 1b](../playground-image-loop/02-phase-1b-discord-subscriber.md)
subscriber. Building it twice would drift; both features consume it and supply
only a `ReplyHandler`.

**Specification only. Nothing here is implemented.**

- [00-spec.md](./00-spec.md) — scope, contract, authorization/failure rules,
  per-consumer usage, test plan, open questions.

It is a **shared prerequisite** in the cross-plan
[BUILD_ORDER.md](../BUILD_ORDER.md): build the router once, before either
feature's Discord-reply behavior.
