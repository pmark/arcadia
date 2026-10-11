---
arcadia: v1
type: plan
slug: add-the-missing-plans-project-dashboard-route-that-lists-one-project-s-plans
project: arcadia
status: draft
milestone: Add the missing /plans/<project> dashboard route that lists one Project's Plans.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-11
actions:
  - id: add-plans-project-route
    title: Serve a single Project's Plans at /plans/<project> in the Arcadia dashboard.
    status: open
    responsibility: agent
    effort: session
    next_action: Serve a single Project's Plans at /plans/<project> in the Arcadia dashboard.
    expected_artifact: Evidence satisfying Agent Ask add-plans-project-route
    clarification: clarified
    confidence: high
    source: Agent Ask plans-project-route-2026-10-11
    why: "Operator asked for the route; the Plan page already links Project context but the Project-level URL 404s."
    acceptance_criteria:
      - Loading /plans/<project-slug> in the dashboard renders that Project's Plans using the existing /api/projects/[id]/plans route and PlanListRow, with no new data path or stored state.
      - An unknown project slug shows the existing error state rather than a crash, and the /plans index links each Project to /plans/<project-slug>.
      - Dashboard typecheck and the affected tests pass, with a test or recorded page read proving the route renders for a real Project.
    depends_on: []
    decisions: []
    references: ["apps/dashboard/app/plans/[project]/[plan]/page.tsx", "apps/dashboard/app/projects/[id]/plans/page.tsx", "apps/dashboard/app/api/projects/[id]/plans/route.ts", "apps/dashboard/components/plans-list.tsx"]
questions: []
decisions: []
---

# Add the missing /plans/<project> dashboard route that lists one Project's Plans.

Created as an inactive draft from accepted Agent Ask plans-project-route-2026-10-11; creation changed no pointer. Current activation is recorded in frontmatter.
