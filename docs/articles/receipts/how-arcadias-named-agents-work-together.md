# Field Notes evidence

- Article: [How Arcadia’s named agents work together](../2026-11-09-how-arcadias-named-agents-work-together.md)
- Source: [pmark/arcadia at `b00dd3ec2`](https://github.com/pmark/arcadia/tree/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739)
- Evidence snapshot: November 9, 2026, America/Los_Angeles.
- Eligibility: Operator-requested review draft. Evaluate the applicable milestone and cadence if the article is later proposed for publication.
- Publication rules: [Decision 0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md) and [Decision 0165](../../decisions/0165-may-decision-0120-s-automatic-field-notes-publication-use-the-arcadia-field.md).

| Claim | Primary evidence | Scope |
| --- | --- | --- |
| The operator used Iris for Field Notes design and requested Clara for a coordinator handoff article. | [Canyon Pass release](https://github.com/pmark/arcadia/pull/2385), [handoff article draft](https://github.com/pmark/arcadia/pull/2407), and the operator’s November 9 Field Notes sessions. | The PRs identify the artifacts. The operator’s account and session history establish the assignments and the staged walkthrough. |
| Names refer to roles and methods. The parent prepares the task brief, and provider sessions carry out the assignment. | [Profile contract](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/arcadia-semantics.md#roles-specializations-and-optional-names) and [brief procedure](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/session-roles-and-briefs.md#composable-specializations-and-optional-names). | Documents the behavior expected of agents. The profiles rely on the parent for translation. |
| Iris gives design help, and Rowan gave Ellis the Downlink design assignment. Clara writes and explains source-backed changes. | [Iris guidance](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/consultation.md#design-help), [Downlink](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/design/downlink.md), and [Clara’s editorial procedure](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/session-roles-and-briefs.md#clara-technical-writing). | Downlink records an actual assignment. The operator’s Clara catch-up session supplied the pull-request explainer example. Other suggested uses are illustrative. |
| Vida checks system health. Mira supplied the detached-descendant diagnosis for a stop-and-drain repair. | [Vida procedure](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/session-roles-and-briefs.md#vida-health-assessment) and [Mira’s handoff to Rowan and Ellis](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/reports/named-identities-2026-10-23.md#applying-the-profiles-to-the-critical-path). | The Vida example describes the documented assignment. The investigation report records the diagnosis and next proof. |
| Nadia critiqued the identity proposal. Sage examines code, and Quinn verifies behavior. | [Nadia’s critique](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/design/agent-naming-and-design-help/reviews/04-nadia-final-critique.md) and [role assignments](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/arcadia-semantics.md#roles-specializations-and-optional-names). | The proposed handoff checks are examples of how to brief separate, independent assignments. |
| Rowan coordinates, Signal supervises, and Flynn examines critical-path stalls. | [Signal guidance](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/signal.md), [Flynn’s assignment](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/agent-guidance/session-roles-and-briefs.md#flynn-momentum-keeper-supervisor-class-helper), and [November 7 run notes](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/docs/reports/relay-record-run-night-2026-11-07.md). | The run notes record instances of each responsibility during that run. |
| A request transcribed as “Clarissa” launched a writing helper. The name check and prompt-binding regression are proposed. | [Handoff article draft](https://github.com/pmark/arcadia/pull/2407), [role brief implementation](https://github.com/pmark/arcadia/blob/b00dd3ec2abeba3999a4c14c8d953ac9b42cc739/src/agentRoles/brief.ts), and Arcadia proposal `agentask_f62ee5d127bd89f338`. | The November 9 Codex session supplies the launch observation. The brief validates the selected role. The proposal supplies the requested test behavior. |

## Mechanical checks

The draft metadata and receipt path passed local checks. `node site/stage.mjs` excluded the draft and produced the same six staged posts, byte for byte, on the base and candidate.

## Independent review

- Verdict: PENDING
- Record the independent review against the exact draft PR revision.

## Delivery handoff

Draft for operator review.
