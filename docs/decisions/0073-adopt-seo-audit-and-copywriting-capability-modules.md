---
arcadia: v1
type: decision
id: "0073"
slug: adopt-seo-audit-and-copywriting-capability-modules
project: arcadia
status: approved
question: Should Arcadia add the seo-audit and copywriting capability modules proposed in docs/proposals/site-copy-and-seo-capability-modules.md, built on a site-neutral engine that Private Practice Now originated?
gap_type: missing-decision
recommendation: "Adopt both modules on the proposal's sequence: PPN groundwork first, engine extraction when PPN's copy-audit runs clean on Mission Control for one release, then seo-audit, then copywriting audit, then drafting."
confidence: high
updated: 2026-09-28
answer: Adopt both modules on the proposal's sequence
decided: 2026-09-28
---

# Decision 0073: Adopt Seo Audit And Copywriting Capability Modules

## Context

Should Arcadia add the seo-audit and copywriting capability modules proposed in docs/proposals/site-copy-and-seo-capability-modules.md, built on a site-neutral engine that Private Practice Now originated?

## Resolution

Adopt both modules on the proposal's sequence. The operator gave this answer
directly on 2026-09-28 ("Ratify the Decision for both modules").

## Options considered

The options are listed in the proposal's "Decision requested" section:

- **Adopt both modules on the sequence above** (recommended, chosen).
- **Adopt `seo-audit` only.** Revisit `copywriting` when an Arcadia-governed
  Project other than Mission Control asks for copy help.
- **Keep it in PPN.** Arcadia gains nothing. Revisit if a second Arcadia
  Project needs a site audit.

## What this commits to

Nothing is built in Arcadia until step 2's trigger fires: PPN's copy-audit
mode must run clean against Mission Control for one release. Until then this
is a recorded direction, not queued work. The build order and deferrals are
the proposal's, unchanged.

## Provenance

- Proposal: `docs/proposals/site-copy-and-seo-capability-modules.md` (#744).
- PPN counterpart: `pmark/private-practice-now#178`
  (`docs/proposals/generalize-copy-and-seo-engine.md`).
- Evidence: `pmark/mission-control-site#52`, `pmark/private-practice-now#177`.
