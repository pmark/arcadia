---
arcadia: v1
type: plan
slug: plan-visibility
project: arcadia
status: complete
milestone: The operator can see every plan a repository holds and why an ungoverned one has not started
token_impact: none
token_budget: "Pure document parsing, no model calls — matches docket's own budget."
updated: 2026-08-26
actions:
  - id: add-plans-command
    title: Add a read-only command listing a repository's plans and their states
    status: done
    responsibility: codex
    effort: short
    clarification: clarified
    confidence: high
    next_action: Delivered as src/commands/plans.ts, registered as `arcadia plans` in src/cli.ts, tested in tests/plans-command.test.ts; no further work.
    expected_artifact: "`arcadia plans --repo <path> [--project <slug>]` listing every plan document, governed or not"
    source: "Operator request 2026-08-26: 'I don't want to lose track of all available plans... Arcadia needs a simple way to view a list of a project's plans and their states.'"
    depends_on: []
    acceptance_criteria:
      - "A governed plan (draft/active/complete/superseded) lists its status, milestone, and per-status Action counts."
      - "An ungoverned plan (dormant/proposed) is listed too, labeled distinctly, with no Action counts fabricated for it."
      - "An ungoverned plan carrying an \"If not now, then when?\" section surfaces that trigger text verbatim."
      - "An ungoverned plan with no such section says so explicitly, rather than rendering a blank line."
      - "A repository with no PROJECT.md fails with a named remedy rather than an empty listing."
      - "Reads only the filesystem, like docket: no workspace or database required."
  - id: surface-plans-on-project-detail
    title: Link to a Project's plans from its detail page, with a brief listing there too
    status: done
    responsibility: codex
    effort: short
    clarification: clarified
    confidence: high
    next_action: "Delivered: a Plans section on apps/dashboard/app/projects/[id]/page.tsx showing the four most relevant plans, linking to the new apps/dashboard/app/projects/[id]/plans/page.tsx full listing; both backed by GET /api/projects/[id]/plans, which resolves the Project's repo_path and slug from the workspace database and shells out to `arcadia plans`."
    expected_artifact: A Plans section on the Project detail page and a linked full-listing page, both real data
    source: "Operator request 2026-08-26: 'I want the plans to appear as a link from each project detail page, with a brief listing appearing on the project details page itself.'"
    depends_on: [add-plans-command]
    acceptance_criteria:
      - "The Project detail page shows a Plans section listing at least the active plan and up to three others, ordered active-plan first."
      - "A link from that section reaches a full listing of every plan the repository holds, governed or not."
      - "The full listing page shows the same per-plan fields the CLI does: status, milestone, Action counts when governed, and the activation note when not."
      - "A Project with no repo_path configured reports that explicitly rather than an empty or crashed section."
      - "Verified live against a real repository (PrivatePracticeNow/platform, 10 plans, one dormant with no stated trigger) rather than only type-checked."
decisions: []
---

# The operator can see every plan a repository holds

## Why this is its own plan, not folded into decision-queue-reconciliation

They read as related — both are about the operator losing track of governed
state — but they act on different objects. Decision-queue-reconciliation closes
review items whose questions are already answered. This lists plan *documents*
themselves, most of which have no review item at all. Mixing them would make
either plan's acceptance criteria describe two unrelated things.

## What existed before this

`docket` and `next` resolve exactly one thing: the current Action. Neither
says anything about a plan sitting at `draft`, `dormant`, or `proposed` —
those are invisible until the operator remembers to open `docs/plans/` and
read frontmatter by hand. `portfolio` aggregates at the Project level and
never lists plans individually.

## What was delivered

`arcadia plans --repo <path> [--project <slug>] [--json]`, following
`docket`'s own pattern exactly: reads `PROJECT.md` and `docs/plans/` off the
filesystem, no workspace or database needed, so it works in a fresh clone or a
cloud container the same as anywhere else.

For a governed plan (the four statuses Arcadia evaluates — `draft`, `active`,
`complete`, `superseded`) it reports status, milestone, and Action counts by
status, and marks the one matching the Project's `active_plan` pointer.

For an ungoverned plan (`dormant` or `proposed` — the two statuses
`docs/managed-documents.md` names as owned by a repository-local shim) it
reports the same identity fields, reads no Action data (there is none to
validate), and searches the plan's own body for an "If not now, then when?"
-style heading, surfacing the paragraph under it verbatim as the trigger.
When no such heading exists, it says so by name — `independent-client-site-
deployment` in PrivatePracticeNow/platform is exactly this case, found on the
first real run.

The same data reaches the dashboard. `GET /api/projects/[id]/plans` resolves
the Project's `repo_path` and `slug` directly from the workspace database
(the same lookup `getProjectMetadata`/`getProject` already do for every other
Project route) and shells `arcadia plans --repo <repoPath> --project <slug>`
through the existing CLI-JSON bridge in `lib/arcadia-cli.ts` — no second
implementation of plan discovery. The Project detail page gained a "Plans"
section showing the four most relevant plans (active pointer first, then
`active`, then `draft`, then everything else) and a link to a full listing
page reusing the identical row component, so "brief" and "everything" always
agree with each other.

## Deliberately not built

**No cross-repository aggregation.** `portfolio` already does that at Project
grain from the workspace database; duplicating it at plan grain for a command
that reads bare filesystem would mean resolving every registered repository
path with no workspace guarantee. The operator asked for "a project's plans,"
singular — `--repo` already answers that per repository, matching `docket`.
*If not now, then when?* — a second operator request naming the portfolio
view specifically, once this single-repo form is in daily use and its
limits are felt rather than guessed at.

**No structured `trigger:` frontmatter field.** Parsing prose under a
heading is honest about what Arcadia can validate: an ungoverned plan's
frontmatter is unvalidated by design, so treating a hand-typed trigger field
as structured data would silently misreport a plan that used different words.
*If not now, then when?* — the same trigger as
`decision-queue-reconciliation`'s "give deferral a trigger" item, since both
would add the same column to a different table.
