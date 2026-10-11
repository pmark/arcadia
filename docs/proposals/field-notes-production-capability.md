---
arcadia: v1
type: proposal
project: arcadia
question: Can Arcadia implement the Decision 0120 Field Notes publication capability and connect its production instruction file to governed cadence?
---

# Field Notes publication capability

The operator requested the efficient Field Notes production strategy in an
isolated worktree on 2026-10-10: "Do it in a worktree". This proposal preserves
the remaining implementation scope without changing the active Plan or queue.
[Issue #1211](https://github.com/pmark/arcadia/issues/1211) already tracks the
capability, with a prior revival trigger: autonomous production On and one
Action on Arcadia's own code completed without operator help. This request
supports preparing the workflow now; it does not silently amend that recorded
priority or replace its governed activation path.

Decision 0120 approves site/RSS publication after independent fact-checking,
with a link notification and an unpublish path. It does not prove the capability
exists. The [production instruction](../strategy/field-notes-production.md)
and templates now specify a bounded, evidence-first content package.

## Verified gap

As inspected on 2026-10-10, Arcadia's `blog.create-idea`, `blog.draft-post` and
`blog.prepare-schedule` create workspace Artifacts and operator review items;
they do not implement the standing publishing exception. The main tree of
`pmark/mission-control-site` has guides but no `/notes/` collection/routes or
RSS. Its `.github/workflows/deploy.yml` deploys production on a main push, so
merging a site PR is a production operation.

## Smallest follow-up

1. In the site repository, implement Field Notes routes, full-text RSS,
   approved-content/review validation and a reversible unpublish path.
   Keep this structural deployment separate from content-only publication.
2. In Arcadia, extend the existing blogging capability with Decision 0120
   verification, immutable content/reviewer bindings and retry-safe delivery
   receipts. Reconcile the site's own instructions before enabling the grant.
3. Connect the instruction file to the governed scheduling path: one check
   after each completed week, skip quiet windows, essays only for proven
   Milestones and at most monthly. Freeze an explicit timezone and first-run
   baseline; enforce ceilings, concurrency and pending delivery recovery.
4. Prove the production instruction's acceptance cases with offline fixtures,
   then verify one live site/RSS publication, notification and withdrawal
   within the approved scope.

No new runner, queue, cron job, paid service, account, social publishing or
email delivery is proposed. Credentials and broader deployment authority remain
separate gates. Reuse the existing blogging and publication surfaces; do not
build a local stand-in while this capability is missing.

Token impact: small for ship notes, medium for milestone essays. Deterministic
eligibility and evidence collection precede one bounded draft and independent
review, with one scoped repair/delta review. Analytics returns when a specific
story needs a dataset; social returns only under a new Decision.
