---
arcadia: v1
type: plan
slug: give-the-mission-control-site-repository-currently-ungoverned-no-agents-md
project: arcadia
status: active
milestone: "Give the mission-control-site repository (currently ungoverned: no AGENTS.md/CLAUDE.md/.arcadia workspace, only a bare .claude/launch.json) the same Arcadia-governed dev-agent tooling every other repo has, then place the operator-supplied session-naming sidebar screenshot as a real, tagged asset on the existing content page that already documents that exact behavior."
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-09-25
actions:
  - id: onboard-mission-control-site-tooling
    title: "Onboard the mission-control-site repository into Arcadia governance: run `arcadia init --profile arcadia` there, wire an AGENTS.md/CLAUDE.md pair the same way this repo does, and confirm a coding-agent session opened in that repo can resolve a dispatch brief."
    status: open
    responsibility: autonomous
    effort: session
    next_action: "Onboard the mission-control-site repository into Arcadia governance: run `arcadia init --profile arcadia` there, wire an AGENTS.md/CLAUDE.md pair the same way this repo does, and confirm a coding-agent session opened in that repo can resolve a dispatch brief."
    expected_artifact: Evidence satisfying Agent Ask onboard-mission-control-site-tooling
    clarification: clarified
    confidence: high
    source: Agent Ask mc-site-tooling-and-session-naming-image-2026-09-25
    acceptance_criteria:
      - "`arcadia init --profile arcadia` succeeds in the mission-control-site repository and creates its own Arcadia workspace and PROJECT.md."
      - The repository has an AGENTS.md/CLAUDE.md pair wired the same way as the arcadia repository.
      - A coding-agent session opened in the mission-control-site repository can run `arcadia next` and receive a dispatch brief.
    depends_on: []
    decisions: []
    references: []
  - id: place-session-naming-screenshot
    title: Add the operator-supplied session-naming sidebar screenshot to mission-control-site as a committed, tagged asset embedded on the coding-agent-session-management answer page (or a better-fitting existing/new answer page if review finds one), with descriptive alt text and a caption naming the session-naming feature.
    status: open
    responsibility: autonomous
    effort: session
    next_action: Add the operator-supplied session-naming sidebar screenshot to mission-control-site as a committed, tagged asset embedded on the coding-agent-session-management answer page (or a better-fitting existing/new answer page if review finds one), with descriptive alt text and a caption naming the session-naming feature.
    expected_artifact: Evidence satisfying Agent Ask place-session-naming-screenshot
    clarification: clarified
    confidence: high
    source: Agent Ask mc-site-tooling-and-session-naming-image-2026-09-25
    acceptance_criteria:
      - The image file is committed into the mission-control-site repository under a clearly named asset path (no third-party asset-service dependency).
      - It is referenced from an answers page with descriptive alt text and a caption naming the session-naming feature, tagged/categorized in that page's frontmatter or nearby content so its subject is discoverable.
      - It renders correctly on the deployed Cloudflare staging URL.
    depends_on: []
    decisions: []
    references: []
questions: []
decisions: []
current_action: onboard-mission-control-site-tooling
recommended_model: light
---

# Give the mission-control-site repository (currently ungoverned: no AGENTS.md/CLAUDE.md/.arcadia workspace, only a bare .claude/launch.json) the same Arcadia-governed dev-agent tooling every other repo has, then place the operator-supplied session-naming sidebar screenshot as a real, tagged asset on the existing content page that already documents that exact behavior.

Created as an inactive draft from accepted Agent Ask mc-site-tooling-and-session-naming-image-2026-09-25; creation changed no pointer. Current activation is recorded in frontmatter.
