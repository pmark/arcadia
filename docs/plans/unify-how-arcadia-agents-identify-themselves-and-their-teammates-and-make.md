---
arcadia: v1
type: plan
slug: unify-how-arcadia-agents-identify-themselves-and-their-teammates-and-make
project: arcadia
status: draft
milestone: Unify how Arcadia agents identify themselves and their teammates, and make design help available by function from any supported surface with visible provenance.
token_impact: medium
token_budget: Deterministic management and validation; one bounded implementation pass and scoped review per Action after activation. Additional attempts require a named failure and a finite repair budget.
updated: 2026-10-31
actions:
  - id: open-naming-and-design-help-decisions
    title: Open the briefing's operator choices as lettered Decisions once this Plan's records are on main.
    status: done
    responsibility: agent
    effort: session
    next_action: Completed via Agent Ask complete-open-naming-and-design-help-decisions-2026-10-31; no further action.
    expected_artifact: Evidence satisfying Agent Ask open-naming-and-design-help-decisions
    clarification: clarified
    confidence: high
    source: Agent Ask plan-unify-agent-naming-and-design-help-r2-2026-10-29
    why: "Persona automation, Iris, naming migration, Lead scope, brief home, depth and assurance wording are the operator's to choose."
    acceptance_criteria:
      - Decisions for persona automation, Iris, naming migration, Lead scope, design brief home and scope, design help depth, and the assurance wording are open, each as a lettered choice with consequences matching section 10 of the briefing.
      - Each Decision document is on main before the operator is asked to answer it.
    depends_on: []
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md"]
  - id: standardize-agent-naming-vocabulary
    title: Standardize the naming vocabulary in Arcadia guidance without changing any machine field.
    status: open
    responsibility: agent
    effort: session
    next_action: Standardize the naming vocabulary in Arcadia guidance without changing any machine field.
    expected_artifact: Evidence satisfying Agent Ask standardize-agent-naming-vocabulary
    clarification: clarified
    confidence: high
    source: Agent Ask gate-naming-design-actions-on-decisions-2026-10-29
    why: "Agents need one term per concept: signature, persona, identity capacity, instance reference, recorded peers, roster, Behavior named as an activity."
    acceptance_criteria:
      - Work starts only after the operator has answered the naming migration and Lead scope Decisions on main; otherwise the Action stops and reports which Decision is unanswered.
      - docs/arcadia-semantics.md, docs/agent-guidance/git-identity.md and docs/agent-guidance/session-roles-and-briefs.md use the briefing's canonical terms, keep the old phrase identity profile as a discovery synonym, and state that a signature is attribution, not proof.
      - Guidance states that Role briefs supply their configured identity capacity, other permitted critique resolves the critic capacity explicitly, and the critic capacity never admits independence.
      - The native-app Lead sole-writer restriction is stated wherever the Lead's operating contract is described.
      - No identity_role key, identity resolve flag, signature format or JSON field is renamed.
    depends_on: [open-naming-and-design-help-decisions]
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md"]
  - id: report-recorded-peers-with-coverage
    title: Report recorded peers with their IDs, status, scoped Action, observation time and coverage.
    status: open
    responsibility: agent
    effort: session
    next_action: Report recorded peers with their IDs, status, scoped Action, observation time and coverage.
    expected_artifact: Evidence satisfying Agent Ask report-recorded-peers-with-coverage
    clarification: clarified
    confidence: high
    source: Agent Ask plan-unify-agent-naming-and-design-help-r2-2026-10-29
    why: "The partners projection drops Session IDs and selects no claim ID, so agents cannot name teammates exactly or know what the query missed."
    acceptance_criteria:
      - The partners projection carries full Session and claim IDs, lifecycle status and the Action, with the Plan shown as unavailable when the source row has none.
      - Generated text labels the list recorded peers, states when the records were observed and which sources it covered, and never treats an empty or partial query as nobody else working.
      - A peer's capacity, persona and current runtime are printed as unknown unless a record supports them.
      - The legacy teammates JSON from identity resolve keeps its shape, and tests cover same-signature peers, prepared rows, claims without Sessions, missing tables and unknown capacity.
    depends_on: [standardize-agent-naming-vocabulary]
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md", "src/sessions/partners.ts", "src/codingAgents/agentIdentity.ts"]
  - id: render-bound-persona-and-instance-locators
    title: Show a bound persona and typed instance locators in assignment identity text, and omit them when unknown.
    status: open
    responsibility: agent
    effort: session
    next_action: Show a bound persona and typed instance locators in assignment identity text, and omit them when unknown.
    expected_artifact: Evidence satisfying Agent Ask render-bound-persona-and-instance-locators
    clarification: clarified
    confidence: high
    source: Agent Ask gate-naming-design-actions-on-decisions-2026-10-29
    why: "A name selects a profile, never an actor; exact identification needs a typed, scoped instance reference."
    acceptance_criteria:
      - Work starts only after the operator has answered the persona automation Decisions on main; otherwise the Action stops and reports which Decision is unanswered.
      - Assignment identity text shows the persona only when the brief bound one, and the generic identity resolve output shows no persona.
      - Instance references are typed and scoped (Session, host chat, host child with its parent, claim) and print unavailable rather than a bare interactive or subagent label.
      - The read-only reviewer identity variant is unchanged.
      - The implementation follows the operator's answer to the persona automation Decision.
    depends_on: [report-recorded-peers-with-coverage]
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md", "src/codingAgents/agentIdentity.ts", "src/agentRoles/brief.ts"]
  - id: add-design-route-to-consultation
    title: Add a function-first design help route to the Consultation Behavior and the guidance index.
    status: open
    responsibility: agent
    effort: session
    next_action: Add a function-first design help route to the Consultation Behavior and the guidance index.
    expected_artifact: Evidence satisfying Agent Ask add-design-route-to-consultation
    clarification: clarified
    confidence: high
    source: Agent Ask gate-naming-design-actions-on-decisions-2026-10-29
    why: "Design help should be requested by function, with Iris optional, using the Consultation Behavior that already exists."
    acceptance_criteria:
      - Work starts only after the operator has answered the design help depth and assurance wording Decisions on main; otherwise the Action stops and reports which Decision is unanswered.
      - "docs/agent-guidance/consultation.md describes quick design consultation, how the field is selected, when to offer a sustained design brief, and what each answer must show: guide and revision, applicability, provenance, confidence and gaps."
      - docs/agent-guidance/index.json has design-help triggers that route to it.
      - A request with no field guide gets disclosed exploratory advice, and is not refused solely because no guide exists.
    depends_on: [open-naming-and-design-help-decisions]
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md", "docs/agent-guidance/consultation.md"]
  - id: define-design-field-guide-format
    title: Define the design field guide format as data.
    status: open
    responsibility: agent
    effort: session
    next_action: Define the design field guide format as data.
    expected_artifact: Evidence satisfying Agent Ask define-design-field-guide-format
    clarification: clarified
    confidence: high
    source: Agent Ask plan-unify-agent-naming-and-design-help-r2-2026-10-29
    why: "Assurance in a field comes only from a guide whose entries carry provenance, scope and review dates."
    acceptance_criteria:
      - A documented format covers scope, revision, review date, per-entry provenance and confidence, applicability limits, competing frameworks and validation examples.
      - A guide entry missing provenance fails validation.
    depends_on: [add-design-route-to-consultation]
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md"]
  - id: create-portable-design-facilitation-skill
    title: Create one portable design facilitation skill discoverable by Codex, Claude Code and OpenCode.
    status: open
    responsibility: agent
    effort: session
    next_action: Create one portable design facilitation skill discoverable by Codex, Claude Code and OpenCode.
    expected_artifact: Evidence satisfying Agent Ask create-portable-design-facilitation-skill
    clarification: clarified
    confidence: high
    source: Agent Ask gate-naming-design-actions-on-decisions-2026-10-29
    why: "Sustained design work needs the revision 7 record method as a bounded Behavior that works the same in every harness."
    acceptance_criteria:
      - Work starts only after the operator has answered the Iris, design help depth and assurance wording Decisions on main; otherwise the Action stops and reports which Decision is unanswered.
      - One SKILL.md source exists under .agents/skills and .claude/skills, and a discovery check is recorded separately for Codex, Claude Code and OpenCode.
      - The skill states its trigger, finite allowance and deadline, and stop conditions, and keeps the field specialization separate from the record method.
      - Ready designs leave only as Agent Ask previews; the skill grants no authority and approves nothing.
      - The skill follows the operator's answers to the Iris, depth and assurance Decisions.
    depends_on: [define-design-field-guide-format]
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md", "docs/agent-guidance/skills.md"]
  - id: establish-design-brief-home
    title: Establish where sustained design briefs live, per the operator's brief home Decision.
    status: open
    responsibility: agent
    effort: session
    next_action: Establish where sustained design briefs live, per the operator's brief home Decision.
    expected_artifact: Evidence satisfying Agent Ask establish-design-brief-home
    clarification: clarified
    confidence: high
    source: Agent Ask gate-naming-design-actions-on-decisions-2026-10-29
    why: "Resuming a design across sessions, harnesses and co-owners needs one durable brief with a stable locator."
    acceptance_criteria:
      - Work starts only after the operator has answered the design brief home and scope Decisions on main; otherwise the Action stops and reports which Decision is unanswered.
      - Sustained design briefs have one documented home and stable locator consistent with the operator's answer, or the pilot is documented as limited to existing Projects.
      - An original capture links to the brief, and no harness keeps a separate copy.
    depends_on: [create-portable-design-facilitation-skill]
    decisions: []
    references: ["docs/design/agent-naming-and-design-help/README.md", "docs/design/agent-naming-and-design-help/arcadia-design-proposal-r7.md"]
questions: []
decisions: []
---

# Unify how Arcadia agents identify themselves and their teammates, and make design help available by function from any supported surface with visible provenance.

Created as an inactive draft from accepted Agent Ask plan-unify-agent-naming-and-design-help-r2-2026-10-29; creation changed no pointer. Current activation is recorded in frontmatter.
