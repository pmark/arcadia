---
arcadia: v1
type: decision
id: "0067"
slug: decide-how-to-resolve-the-four-historical-duplicate-decision-numeric-ids-0004
project: arcadia
status: open
question: Decide how to resolve the four historical duplicate Decision numeric ids (0004 x2, 0005 x2) and the disposition of dangling review item R195, now that docs sync refuses any new id collision going forward.
gap_type: missing-decision
gate_question: resists_reversal
recommendation: Treat the checked-in slug as the canonical handle; leave the four duplicate numeric ids as a historical, non-unique display label; close R195 as stale.
options:
  - label: Treat the checked-in slug as the canonical handle; leave the four duplicate numeric ids as a historical, non-unique display label; close R195 as stale.
    consequence: "No Decision file is renamed. The validator this Action adds has no exception for pre-existing collisions, so all four duplicate-id files (0004 x2, 0005 x2) surface as named `docs sync` validation errors on every future run -- a permanent, low-severity signal, not a one-time one -- unless a small follow-up teaches the validator an explicit historical allowlist for these four ids so the noise stops. `arcadia decision approve 0004` (or 0005) also stays ambiguous by number alone if anyone ever runs it against these specific pairs -- all four are already approved or deferred, so this is dormant risk, not active risk. R195 is closed rejected rather than re-pointed, since no live Decision actually answers the question it was raised from; its target id (0053) now belongs to an unrelated Decision."
    recommended: true
  - label: Renumber the later-arriving file in each pair to the next free id (0004-remaining-protocol-increment -> 0068, 0005-recheck-readiness-hybrid -> 0069), then research and re-point R195 to whichever live Decision actually answers its original question, or close it if none does.
    consequence: "Restores a fully unique id space matching the assumption that the number is the handle, and docs sync goes fully clean with no follow-up needed. Costs two Decision file renames (git history preserved via rename detection, but any inbound reference to the old id/slug pair -- Mission Log entries, other Decisions' `decision:` links, external notes -- needs a repo-wide search before applying, and R195's correct re-target is not yet known and would need separate research to identify safely instead of guessing."
    recommended: false
confidence: high
plan: bootstrap-managed-production-to-build-flight-deck
updated: 2026-09-24
---

# Decision 0067: Decide how to resolve the four historical duplicate Decision numeric ids (0004 x2, 0005 x2) and the disposition of dangling review item R195, now that docs sync refuses any new id collision going forward.

## Options

- **Treat the checked-in slug as the canonical handle; leave the four duplicate numeric ids as a historical, non-unique display label; close R195 as stale.** (recommended): No Decision file is renamed. The validator this Action adds has no exception for pre-existing collisions, so all four duplicate-id files (0004 x2, 0005 x2) surface as named `docs sync` validation errors on every future run -- a permanent, low-severity signal, not a one-time one -- unless a small follow-up teaches the validator an explicit historical allowlist for these four ids so the noise stops. `arcadia decision approve 0004` (or 0005) also stays ambiguous by number alone if anyone ever runs it against these specific pairs -- all four are already approved or deferred, so this is dormant risk, not active risk. R195 is closed rejected rather than re-pointed, since no live Decision actually answers the question it was raised from; its target id (0053) now belongs to an unrelated Decision.
- **Renumber the later-arriving file in each pair to the next free id (0004-remaining-protocol-increment -> 0068, 0005-recheck-readiness-hybrid -> 0069), then research and re-point R195 to whichever live Decision actually answers its original question, or close it if none does.**: Restores a fully unique id space matching the assumption that the number is the handle, and docs sync goes fully clean with no follow-up needed. Costs two Decision file renames (git history preserved via rename detection, but any inbound reference to the old id/slug pair -- Mission Log entries, other Decisions' `decision:` links, external notes -- needs a repo-wide search before applying, and R195's correct re-target is not yet known and would need separate research to identify safely instead of guessing.

## Rationale

Issue #268 found docs/decisions/0004-docs-sync-write-back.md and 0004-remaining-protocol-increment.md sharing id 0004, and docs/decisions/0005-plan-milestone-span.md and 0005-recheck-readiness-hybrid.md sharing id 0005. Issue #267 found review item R195 (in the martianrover workspace) dangling-referencing docs/decisions/0053-decide-whether-arcadia-should-now-scope-the-separately-approved-action-that-docs.md, a file that was never committed under that id because 0053 was later reused for a different, unrelated Decision (docs/decisions/0053-what-may-arcadia-conclude-and-apply-automatically-and-what-must-always-be-escalated.md). docs sync now refuses any *new* id collision (this Action's own change), but the Action's acceptance criteria explicitly forbid renumbering these four historical documents without an open Decision first, since renaming a committed Decision file is hard to reverse cleanly and a reasonable person could weigh minimal-diff safety against strict id uniqueness differently. All four duplicate-id documents are already settled (three approved, one deferred) and inert -- nobody is actively running `arcadia decision approve 0004` against them -- which is why option 1 is recommended.

Proposed by Agent Ask decide-duplicate-decision-id-migration-v2-2026-09-24.
