# Agent roles explainer evidence

This is an operator-requested draft for later adaptation into an Arcadia Mission
Control guide. It is not a publication receipt, Action settlement or live-use
claim. No governed Action exists for this writing request. Intake: #1351.

- Article: docs/articles/2026-10-12-why-agent-roles-make-collaborative-work-easier.md
- Source repository: pmark/arcadia
- Pinned source revision: `17f05f789b416bc091d47d14d433dc511cc58d52`
- Author identity: Cody Atlas <cody.atlas@agents.arcadia.local>
- Body words: 445
- Intended canonical URL and channels are template metadata, not publication
  evidence. No site deployment or RSS publication is requested.

## Claims and scope

| Article claim | Pinned evidence | Limit |
| --- | --- | --- |
| Arcadia defines seven roles and their responsibilities: Lead, Planner, Plan critic, Researcher, Implementer, Code reviewer, QA. | [Role registry](https://github.com/pmark/arcadia/blob/17f05f789b416bc091d47d14d433dc511cc58d52/config/defaults/agent-roles.json) and [shared role protocol](https://github.com/pmark/arcadia/blob/17f05f789b416bc091d47d14d433dc511cc58d52/.agents/skills/arcadia-role/SKILL.md) | Definition and procedure, not proof of automatic role dispatch. |
| A researcher has no production-mutation eligibility; specialization does not broaden authority; review remains independent. | [Shared role protocol](https://github.com/pmark/arcadia/blob/17f05f789b416bc091d47d14d433dc511cc58d52/.agents/skills/arcadia-role/SKILL.md) and registry. | Roles never grant production, ownership or other approval authority. |
| Supervision is a relationship rather than an eighth role, with friction and learning duties. | [Supervisor skill](https://github.com/pmark/arcadia/blob/17f05f789b416bc091d47d14d433dc511cc58d52/.agents/skills/arcadia-supervisor/SKILL.md) and approved Decisions 0113/0121. | An assigned duty does not prove a running supervisor. |
| Role definitions and brief commands are implemented; automatic delegation admission and event-triggered supervision remain future work. | [Merged foundation PR1342](https://github.com/pmark/arcadia/pull/1342), shared role and supervisor skills at the pinned revision. | No unattended orchestration claim. |

The CSV export is explicitly hypothetical. General capability statements, the
questions each role asks, clearer handoffs and reduced repeated explanation are
reasoned advice about the design, not measured productivity results. The article
contains no claim of a working CSV export, benchmark or completed supervisor
automation. Its advice preserves sole implementation ownership and independence.

## Validation and review

Frontmatter, word count, unique role coverage, receipt links and draft status are
checked before commit. A fresh independent editorial review is launched at PR
creation; its pinned-head verdict and required CI results are recorded in the
PR handoff. No pass is asserted in advance here.

Loaded guidance includes AGENTS.md, Constitution, current decision-card-contract
Action (overlap check only), context policy/index, operator-directed work, PR and
identity procedures, article README/templates, the Pages write-page writing
guidance and editorial checklist. Role evidence is from the canonical registry
and shared skills. No Plan, Action, Decision, queue or publication state changes.

## Delivery boundary

The operator’s follow-up authorizes a repository PR. The draft is stored under
`docs/articles/`; the separate external folder named Arcadia Articles has no
confirmed path/link. The existing article index is already changed by another
parallel candidate, so this PR leaves that index in its owner's custody. Add the
new article link when that candidate lands and the shared index can be reconciled.
The prior managed role-foundation checkout was absent when reuse was attempted;
the temporary article draft was intact and a new managed candidate was created.

Publication remains a separate step under Decision 0120 and its required proof.
