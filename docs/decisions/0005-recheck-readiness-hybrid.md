---
arcadia: v1
type: decision
id: "0005"
slug: recheck-readiness-hybrid
project: arcadia
plan: dispatch-contract-enforcement
action: recheck-readiness-at-approval
status: approved
question: A planning Decision can sit open while its plan document changes underneath it. Should approval re-resolve document readiness and refuse a packet whose prerequisites regressed, or is a packet immutable once built?
gap_type: missing-decision
recommendation: Recheck, but only when the plan document's own updated field moved since the packet was built -- full readiness on every approval is unnecessary cost, and immutability lets a stale packet execute against documents that have already changed their answer.
confidence: high
decided: 2026-07-31
answer: "Hybrid. Approval rechecks document readiness only when the plan document's updated field has moved since the packet was built. Unchanged: trust the snapshot, no re-read. Moved: re-resolve readiness through resolveActionReadiness and refuse if a blocker or clarification question is now present."
updated: 2026-07-31
---

# Recheck readiness at approval: hybrid

## Context

`assertManagedDocumentReadiness` checks readiness once, at `work plan` time,
when the packet is built. Approval (`review approve`) checked something
different: that the packet's content had not been tampered with (a sha256
digest) and that its internal links were consistent. It never asked whether
the plan document still said the Action was ready. A packet built while a
dependency was done, a required Decision was answered, and `current_action`
pointed here stayed approvable even if all three later became false, as long
as nobody touched the packet file itself.

That gap is a real crack in "checked-in documentation is authoritative" --
`CLAUDE.md`'s central rule -- landing at exactly the step where a planning Run
actually gets queued.

## Options considered

**Immutable once built.** Zero implementation cost; it was already the
behavior. Accepted risk: prerequisites can regress, required Decisions can
reopen, or `current_action` can move elsewhere between build and approval, and
approval would not notice.

**Recheck on every approval.** Closes the gap completely. Cost: a full
`resolveActionReadiness` call (a repository crawl) on every approval, and a
new failure mode where an approval flaps on document churn that does not
actually matter -- rewording an unrelated Action in the same plan file bumps
`updated` and would trigger a recheck that finds nothing wrong, which is
correct but not free.

**Hybrid (selected).** Recheck only when the plan document's own `updated:`
field has moved since the packet was built. The common case -- approve soon
after building, nothing has changed -- costs nothing beyond a string
comparison already available on the Decision. A document that moved is read
again, and approval is refused only if that re-read finds an actual blocker or
clarification question, not for the mere fact that something in the file
changed.

## Consequences

**Accepted, named gap:** the hybrid trusts `updated:` as the staleness signal.
A plan document edited without bumping that field -- readiness regresses but
the date does not move -- is not caught. This is deliberate, not an oversight:
`updated:` is already the field every other staleness check in the protocol
relies on (`stalenessOf` in `src/docs/sync.ts` compares exactly this field
against a database row's timestamp). Making the readiness recheck trust a
different, more expensive signal than the rest of the protocol would be
inconsistent for a gap this narrow. `tests/dispatch-journal.test.ts` covers
this case explicitly so the gap stays visible rather than silently patched.

**Implementation shape:**
- `ActionReadiness` (`src/docs/dispatch.ts`) now carries `planUpdated`, the
  plan document's own `updated:` field, alongside the blockers and question it
  already reported.
- The planning Decision's `context_json` now carries `planDocUpdated`, the
  plan document's `updated:` at the moment the packet was built
  (`src/execution/planningPreparation.ts`).
- `queueApprovedPlanningRun` (`src/execution/planningAuthorization.ts`) compares
  the two before the approval transaction opens -- not inside it, for the same
  reason `work plan`'s guard runs before its own transaction: a refusal that
  journals its own resolution and then rolls that journal entry back with
  everything else answers nothing.
- `parseActionDocRef`, previously private to `src/commands/work.ts`, moved to
  `src/docs/types.ts` as the inverse of `actionDocRef`, so both the build-time
  and approval-time checks call one implementation rather than two copies
  drifting apart -- the same discipline `CLAUDE.md` requires of
  `resolveActionReadiness` itself.
- `DispatchCommand` gained `"review.approve"`, so a recheck's outcome
  (triggered or not, blocked or clear) is journalled the same way `next` and
  `work.plan` resolutions already are.
