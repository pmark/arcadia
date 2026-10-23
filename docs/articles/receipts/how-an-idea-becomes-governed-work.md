# Field Notes evidence: how-an-idea-becomes-governed-work

- Type: essay; operator-requested explainer, intended to become a guide on Arcadia Mission Control later.
- Article: docs/articles/2026-10-23-how-an-idea-becomes-governed-work.md
- Source repository and pinned revision: pmark/arcadia@280b094f0e956f8d55d67b6ed1d646cd60b3886f
- Cadence window: not assessed; operator-requested idea draft, dated in America/Los_Angeles.
- Evidence collection: repository documents at the pinned revision, read 2026-10-23.
- Previous verified publication/cutoff: none established for this article.
- Eligibility: explanatory draft; no shipped-work or Milestone claim. Publication eligibility unassessed.
- Decision: [0120](../../decisions/0120-decide-whether-agents-may-publish-field-notes-ship-notes-and-essays-to-the.md)
- The canonical URL is an intended destination; no page, RSS entry or delivery is claimed.

## Claims

| ID | Exact factual sentence, summary or number | Pinned public evidence | What it proves and its limits |
| --- | --- | --- | --- |
| C1 | An Ask is the single door into governed state; agents never hand-edit status, answers or pointers. | [agent-asks.md, "Asking Arcadia to change Project state"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rule. Document hygiene is a stated exception the article does not cover. |
| C2 | An Ask has `request_id`, Project, `intent` and `desired_result`; only `request_id` and `desired_result` are required everywhere. | [agent-asks.md, "The intents"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Schema summary; `arcadia agent-ask contract` is the live authority. |
| C3 | `intent: proposal` preserves evidence only, with no executable Action; preview records a pending proposal. | [agent-asks.md intents table and preview section](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C4 | Plan status is draft, active, complete or superseded. | [managed-documents.md, plan anatomy](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md) | `dormant` and `proposed` Plans are supporting records, omitted from the article for brevity. |
| C5 | Action fields: acceptance criteria, responsibility (autonomous, agent, requires_review, blocked), next step, dependencies. | [managed-documents.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md), [arcadia-semantics.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/arcadia-semantics.md) | Documented schema. |
| C6 | Decision definition and the `decision` intent gate (reasonable disagreement, resists reversal, approval boundary). | [arcadia-semantics.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/arcadia-semantics.md), [agent-asks.md, "Decision intent triage"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rule. |
| C7 | `PROJECT.md` names `active_plan`, the Plan names `current_action`; exactly one Action is current. | [managed-documents.md, "The pointer chain"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/managed-documents.md) | A second session may take the next unclaimed queue entry without moving the pointer; omitted for brevity. |
| C8 | The queue reads canonical Actions, stores only ordering, and a ready Action elsewhere waits for the pointer. | [COMMANDS.md, "The Agent Queue"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/COMMANDS.md); [agent-asks.md, settling section](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C9 | Preview writes receipts and a fingerprint, and nothing to Project documents or queue; a receipt is registration, not approval; Asks are never self-approving; neither requested_authority value lets an agent apply. | [agent-asks.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented rule. |
| C10 | Settlement writes the previewed effects and commits locally, never pushing. | [agent-asks.md, "Settling commits locally and never pushes"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C11 | `intent: plan` without `target_ref` creates a complete inactive draft Plan. | [agent-asks.md intents table](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. |
| C12 | Activation makes the Plan active and sets `current_action` to its first Action. | [operator-plan-amendments.md, "Plan activation"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/operator-plan-amendments.md) | Documented runner shape (`--activate --action`). "Does not merge or deploy" is an inference from its allowed effects list. |
| C13 | A `complete` Ask needs evidence for every criterion, verbatim and in order, against a candidate revision; any criterion not met refuses; settlement marks the Action done and resolves the next. | [agent-asks.md intents table and "One session completes one Action"](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/agent-guidance/agent-asks.md) | Documented behavior. Merge remains a separate gate per [settling-actions.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/docs/settling-actions.md). |
| C14 | Capability grants nothing. | [CONSTITUTION.md](https://github.com/pmark/arcadia/blob/280b094f0e956f8d55d67b6ed1d646cd60b3886f/CONSTITUTION.md) | Constitutional rule. |
| C15 | Worked example: a proposal on email copy for client sites, registered as an `intent: plan` Ask, settled into an inactive draft Plan with four Actions. | Operator-supplied account for 2026-10-22/23 in the Private Practice Now Project. | Not independently verified from a public record here; activation and completion are described as the governed path, not as observed events. |

## Mechanical checks

Front matter present; about 935 words including the diagram and table; no em
dashes; no placeholders; American spelling checked by grep; relative links only.

## Independent review

- Reviewer identity and independent lineage: pending; to be assigned by the Lead.
- Reviewed article and receipt revision: pending committed draft.
- Source revision: 280b094f0e956f8d55d67b6ed1d646cd60b3886f
- Report: pending; the author provides no independent approval.
- Verdict: HOLD for publication.
- Findings and resolution: pending.

## Delivery handoff

Draft only. No site or RSS publication, deployment, notification or unpublish
receipt exists. Committing, pushing or merging the draft does not publish it.
