# Field Notes evidence for why-agent-roles-make-collaborative-work-easier

- Article: 2026-10-12-why-agent-roles-make-collaborative-work-easier.md
- Type: essay.
- Source revision: [88045ef97](https://github.com/pmark/arcadia/tree/88045ef9712fa0341bdc5be2df45eee2334e8eaa).
- Destination: [Field Notes](https://pmark.github.io/arcadia/posts/why-agent-roles-make-collaborative-work-easier/) and its [Atom feed](https://pmark.github.io/arcadia/feed.xml).
- Release: operator-directed November 9, 2026 batch in America/Los_Angeles, scoped to the four shortlisted essays. The standing automatic cadence remains separate.
- Previous feed check: November 9, 2026. The feed contained two ship notes, and this slug was absent.
- Governing destination: [Decision 0165](../../decisions/0165-may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field.md). The one-time batch Decision is recorded alongside the final release candidate.

## Claims

The summary is covered by the claims below. Suggested developer practices and hypothetical examples are editorial advice.

| ID | Claim | Pinned public evidence | Proof boundary |
| --- | --- | --- | --- |
| C1 | Seven registered roles separate coordination, planning, critique, research, development, code review and QA. A candidate has one writer at a time, and an independent reviewer checks the exact revision. | [Registered roles](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/config/defaults/agent-roles.json) · [Role rules](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/agent-guidance/session-roles-and-briefs.md) · [Review rules](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/agent-guidance/pull-requests.md#independent-review-gate) | This describes the repo's contract. The CSV export is a hypothetical example. |
| C2 | Ellis can be a planner or implementer by assignment; Clara is an implementer with a technical-writing specialization. | [Canonical role and profile definitions](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/arcadia-semantics.md#roles-specializations-and-optional-names) | Optional handles narrow a brief within the assigned role. |
| C3 | The registry and brief commands define and validate roles. Automatic governed admission of native delegates remains future work. | [Role commands](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/src/commands/roles.ts) · [Native dispatch scope](https://github.com/pmark/arcadia/blob/88045ef9712fa0341bdc5be2df45eee2334e8eaa/docs/agent-guidance/session-roles-and-briefs.md#native-dispatch-and-model-selection) | An eligible brief does not authorize or launch a session. |

## Mechanical checks

The candidate uses the Field Notes front matter, a public canonical URL, site and RSS channels, and a specific unfinished-work section. The article body is short-form.

## Independent review

- Verdict: HOLD pending the exact publication-package fact-check.

## Delivery handoff

Pending. The exact approved source, Pages run, canonical page, full-text Atom entry and link notification will be recorded on [release PR #2393](https://github.com/pmark/arcadia/pull/2393). To withdraw the article, set its source status to withdrawn in a reviewed PR and verify the next Pages build removes its page and feed entry.

## Earlier draft record

## Agent roles explainer evidence

### Editorial refresh, 2026-11-09

Source checked at [`2e5b841bd`](https://github.com/pmark/arcadia/tree/2e5b841bde29efa63e9f7fa77d1455deb6457444). The shortened CSV example is illustrative. Current role, writer, and independence claims are sourced to the [role procedure](../../agent-guidance/session-roles-and-briefs.md), [identity profiles](../../arcadia-semantics.md#roles-specializations-and-optional-names), and [review procedure](../../agent-guidance/pull-requests.md#independent-review-gate).

The claims and review below apply to the earlier draft. The refreshed version awaits independent fact-checking.

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

### Claims and scope

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

### Validation and review

Frontmatter, word count, unique role coverage, receipt links and draft status are
checked before commit. A fresh independent editorial review is launched at PR
creation; its pinned-head verdict and required CI results are recorded in the
PR handoff. No pass is asserted in advance here.

Loaded guidance includes AGENTS.md, Constitution, current decision-card-contract
Action (overlap check only), context policy/index, operator-directed work, PR and
identity procedures, article README/templates, the Pages write-page writing
guidance and editorial checklist. Role evidence is from the canonical registry
and shared skills. No Plan, Action, Decision, queue or publication state changes.

### Delivery boundary

The operator’s follow-up authorizes a repository PR. The draft is stored under
`docs/articles/`; the separate external folder named Arcadia Articles has no
confirmed path/link. The existing article index is already changed by another
parallel candidate, so this PR leaves that index in its owner's custody. Add the
new article link when that candidate lands and the shared index can be reconciled.
The prior managed role-foundation checkout was absent when reuse was attempted;
the temporary article draft was intact and a new managed candidate was created.

Publication remains a separate step under Decision 0120 and its required proof.
